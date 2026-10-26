# AI 接入技术预研（R-AI-04）

> 需求编号：R-AI-04
> 类型：技术预研（纯文档，不动代码）
> 上游依赖：R-AI-01（配置层）、R-AI-02（起名增强）、R-AI-03（服务层架构）
> 状态：预研稿，待评审（流式选型已决策：流派 3 为主 + 流派 1 兜底，见预研点 4）
> 日期：2026-10-26

---

## 一、预研目标与范围

本预研只回答一个问题：**「AI 服务层 + 主进程调用通道 + ai.db」这套架构，在 CheckIn 现有代码基础上能否落地、怎么落地、有哪些坑。**

范围界定（与评审时一致）：

- ✅ 主进程 `ai-handlers.ts` 的实现方案
- ✅ 独立 `ai.db` 的生命周期桥接与 schema
- ✅ `safeStorage` 密钥加密链
- ✅ 流式输出的 IPC 方案（为后续润色/续写预留）
- ✅ Ollama 本地模型探测
- ❌ 不涉及具体 AI 功能的 UI/交互（属 R-AI-02 及后续 PRD）
- ❌ 不写任何生产代码（本预研是纯文档）

---

## 二、环境与依赖现状（预研前提）

| 项 | 现状 | 影响 |
|---|---|---|
| Electron | **44.9.0** | 极新，`safeStorage` / `net.fetch` / `fetch` 流式 / `AbortSignal.timeout` 全部原生支持，无需降级方案 |
| better-sqlite3 | ^13.0.3 | N-API，主进程直接 require 可用（与 novel-db 同款） |
| 主进程网络先例 | `novel-font-handlers.ts` 用 `net.fetch` | 已有成熟范式，AI 请求应复用而非重造 |
| safeStorage 使用先例 | **无**（全项目零使用） | 唯一需新增验证的点，见第五节 |
| 生命周期桥接范式 | `db.ts` 的 `registerUserDbLifecycle` + `novel-db.ts` 的 `registerNovelDbBridge` | ai.db 直接复制此范式 |
| handler 注册范式 | `main.ts` 里 `registerXxxHandlers()` 集中注册 | 新增 `registerAiHandlers()` 即可 |

---

## 三、五个预研点逐一结论

### 预研点 1：主进程 `ai-handlers.ts` 的网络实现

**结论：复用 `net.fetch`（Chromium 网络栈），不用 Node 原生 `fetch`。**

依据 `novel-font-handlers.ts` 第 85-107 行的成熟结论：

> `net.fetch` 走 Chromium 网络栈，自动跟随系统代理；Node 原生 fetch 不走代理，在代理环境下直连会 "fetch failed"；且 net.fetch 天然不暴露渲染层 CORS。

这条对 AI 调用**同样适用**，甚至更关键——用户可能在公司代理/特殊网络环境下用 DeepSeek/通义，`net.fetch` 是唯一稳妥选择。

**落点方案**：

```
ai-handlers.ts
├─ 读配置：从 ai.db 取 provider/endpoint/model/高级参数
├─ 解密 Key：safeStorage.decryptString
├─ 构造请求：OpenAI 兼容格式（POST /v1/chat/completions）
├─ 发请求：net.fetch(endpoint, { method:'POST', body, signal: AbortSignal.timeout(...) })
├─ 路由分支：
│   ├─ 非流式（起名）：await response.json() 一次性返回
│   └─ 流式（润色/续写）：见预研点 4
└─ 错误归一：HTTP status + error body → 可读文案（401/402/429/404/超时）
```

**必须遵守的既有约束**（来自 `main.ts` 与 handler 规范）：
- handler 只做转发 + 安全，不感知「起名/润色」业务语义；
- 参数校验放在 handler 入口（参照 `novel-font-handlers` 的 `typeof` 白名单校验）；
- 错误永远归一为 `{ ok: false, error: string }` 一句话文案，不抛原始异常给渲染层。

---

### 预研点 2：独立 `ai.db` 的生命周期与 schema

**结论：完整复制 `novel-db.ts` 的三段式——路径函数 + schema + 桥接注册。**

**（1）路径**：与 novel.db 同目录，随用户隔离：

```
user-data/{email-hash}/
├─ checkin.db
├─ novel.db
└─ ai.db        ← 新增
```

```ts
// electron/ai-db.ts
export function getAiDbPath(email: string): string {
  return path.join(getUserDataDir(email), "ai.db");
}
```

**（2）schema（首版只建一张表，已决策）**：

> **决策**：首版 `ai.db` **只建 `ai_config` 一张表**，其余（`ai_memory` / `ai_usage_log`）留到真正需要时再建，避免过早引入用不到的表。

```sql
CREATE TABLE IF NOT EXISTS ai_config (
  key TEXT PRIMARY KEY,        -- provider / endpoint / model / api_key_enc / advanced 等
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);
-- 演进位（首版不建，将来需要时增量 CREATE TABLE）：
-- ai_memory      -- 用户给 AI 的长期记忆/偏好（R-AI-01 预留）
-- ai_usage_log   -- 用量埋点（可选）
```

> 说明：`ai_config` 与 checkin.db 的 `config`、novel.db 的 `novel_config` 同构，Key 单独用 `api_key_enc` 键存加密串。

**（3）桥接注册 + edition 开关**：

```ts
// electron/ai-db.ts —— 桥接本身复制 novel-db.ts 第 640-647 行范式
export function registerAiDbBridge(): void {
  registerUserDbLifecycle({
    onSwitched: switchAiDb,
    onClosed: closeAiDb,
  });
  const email = getCurrentUserEmail();
  if (email) switchAiDb(email);
}
```

**edition 开关（已决策）**：`ai.db` **只在有 novel 模块打包的模式下存在**——即 `EDITION !== "lite"`（full / novel 有 novel 域，lite 无）。后续 checkin 窗口也接入 AI 时再放开到全版本。

```ts
// electron/main.ts —— 在 registerNovelDbBridge() 之后，与 novel 域注册同区
if (EDITION !== "lite") {
  registerAiDbBridge();
  registerAiHandlers();
}
```

> 依据：`main.ts` 现有范式里，novel 域 handler 全版本无条件注册、checkin 域用 `if (EDITION !== "novel")` 区分。ai.db 属 novel 域能力，故用 `if (EDITION !== "lite")` 对称地「仅 lite 不注册」。后续 checkin 接入时删掉这个判断即可放开。

**关键约束确认**（从 `db.ts` 生命周期注释读到的）：
- ai.db 挂载在「用户库就绪之后」（`onSwitched`），能安全读到当前 email 与用户目录；
- 单个监听者抛错不阻断其它监听者，也不阻断 checkin/novel 库——ai.db 挂了不该拖垮待办/正文。

---

### 预研点 3：`safeStorage` 密钥加密链

**结论：`safeStorage` 是 Electron 44 的成熟 API，唯一注意点是「加解密必须在 app ready 之后」，且解密失败要优雅降级。**

**现状**：项目零使用先例，这是本预研唯一「无先例可抄」的点。但 API 本身简单：

```ts
// 写（用户保存 Key 时）
const encrypted = safeStorage.encryptString(apiKey);  // → Buffer
// 存 ai.db 的 ai_config，key = 'api_key_enc'，value = encrypted.toString('base64')

// 读（发起 AI 请求时）
const buf = Buffer.from(storedBase64, 'base64');
const apiKey = safeStorage.decryptString(buf);        // → string
```

**两个必须处理的边界**：

1. **`safeStorage.isEncryptionAvailable()` 为 false**（极少数 Linux 无 keyring 环境）：`encryptString` 会抛错。降级策略——此时**拒绝保存 Key**并提示「当前系统不支持安全存储，无法保存密钥」，而不是明文落盘。绝不回退到明文。

2. **解密失败**（换机器 / keyring 变更 / 数据损坏）：`decryptString` 抛错 → 归一为「密钥已失效，请重新填写」，引导用户重新输入，不崩溃。

**安全分层结论**（与项目既有分层一致）：Key 的明文**只存在于主进程内存的瞬时变量里**，落盘的是 `safeStorage` 密文；渲染进程永远拿不到 Key（只能拿「是否已配置」这种布尔态）。

---

### 预研点 4：流式输出的落地方案（为润色/续写预留）

**结论：起名用非流式（简单），流式是「预研清楚方案、本期不实现」的预留项。流式主方案定为「流派 3（`protocol.handle` 内部端点）」，IPC 逐块转发（流派 1）作为不支持场景的兜底。**

**为什么起名不用流式**：起名是「一次请求返回一批名字」，10 个名字一起回来即可，流式打字机效果没有意义，反而增加复杂度。R-AI-02 的 FR-02 也是非流式。

#### 4.1 业界方案调研结论（决定选型依据）

调研了成熟 Electron AI 应用的三种主流流派（Cherry Studio、Claude Desktop、LobeHub 生态、assistant-ui 官方指南）：

| 流派 | 代表 | 做法 | 代价 |
|---|---|---|---|
| **流派 1：主进程转发流（IPC）** | Cherry Studio、Claude、掘金踩坑文共识 | 主进程读 Key + 发请求 + `webContents.send` 逐块推流（带请求 id） | 主进程背「流式搬运」苦力，需攒批控频 |
| **流派 2：渲染进程直连** | LobeHub `electron-cloud-llm-integration` | 渲染进程直接 fetch，Key 从主进程取回内存 | Key 下放渲染进程 + CSP/安全放行，安全让步 |
| **流派 3：`protocol.handle` 内部端点** | assistant-ui 官方 Pattern 2 | 渲染进程 fetch `app://local/api/ai/chat`，主进程 `protocol.handle` 接管转发 | 需 Electron ≥44.4 的 `request.initiatorOrigin` 校验 |

**选型结论（已决策）**：

- **主方案 = 流派 3（`protocol.handle`）**：渲染进程像「直连」一样 `fetch` 内部端点、自己拿标准 `ReadableStream` 读流、自己驱动打字机；主进程只做「读配置 + 解密 Key + `net.fetch` 模型接口 + 把 `Response` 流原样返回」，**不逐块搬运流**。完美契合「主进程是配置/密钥/记忆的管家，不是流式搬运工」的职责定位。项目 Electron 44.9 ≥ 44.4，版本满足。
- **兜底 = 流派 1（IPC 逐块转发）**：当 `protocol.handle` 流桥接在某些场景不可用（如个别平台对自定义 scheme 响应体的流式兼容问题）时，退回到主进程读块 + `webContents.send` 推流，带请求 id + 攒批控频。
- **流派 2（渲染进程直连）排除**：Key 下放渲染进程 + 依赖 CORS/安全放行，违背 R-AI-01「Key 不下放、请求走主进程」的安全硬约束。

#### 4.2 主方案（流派 3）落地要点

```
渲染进程                               主进程
  │ fetch('app://local/api/ai/chat') ──►│ protocol.handle('app') 拦截
  │  (标准 fetch，带 body)               │   ├─ 校验 initiatorOrigin === 渲染层 origin
  │                                     │   ├─ 读 ai.db 配置 + safeStorage 解密 Key
  │                                     │   ├─ net.fetch(模型接口，stream:true)
  │ ◄── 返回模型 Response（流）──────────│   └─ 把 Response 原样返回
  │  res.body.getReader() 逐块读        │  （主进程到此撒手，不逐块转发）
  │  自己 parse SSE / 驱动打字机        │
```

- 渲染进程拿到的是标准 `fetch` 响应 + `ReadableStream`，无需 IPC、无需 preload 流通道；
- 中止：渲染进程 `AbortController.abort()` → 主进程 `net.fetch` 的 `signal` 联动（流自然中断）；
- 请求来源校验：用 `request.initiatorOrigin` 只放行本应用渲染层 origin，防外部网页触达内部端点。

#### 4.3 兜底方案（流派 1）落地要点

- 流生命周期三态：`ai-stream-start` / `ai-stream-chunk` / `ai-stream-end`（+ `ai-stream-error`）；
- 渲染层用 `windowAPI.on/off` 订阅（preload 已有成熟订阅范式）；
- 中止：渲染层发 `ai-stream-abort` → 主进程 `AbortController.abort()`；
- 每块消息带「请求 id」防并发流串台；**主进程攒批（≥50ms 或 ≥N token）再推，禁止逐 token 推**（IPC 性能红线）。

---

### 预研点 5：Ollama 本地模型探测

**结论：一个 `net.fetch` 到 `localhost:11434/api/tags` 即可完成，无技术风险。**

```ts
// 探测：列出已下载模型
const res = await net.fetch('http://localhost:11434/api/tags', {
  signal: AbortSignal.timeout(2000),  // 短超时，本机探测 2s 足够
});
// res.json() → { models: [{ name: 'qwen2.5:7b', ... }] }
```

**关键点**：
- Ollama 暴露 OpenAI 兼容端点 `http://localhost:11434/v1/chat/completions`，所以**探测用 `/api/tags`，调用走 `/v1/` 那条 OpenAI 兼容路径**——两件事用两个端点；
- 本地调用时 `api_key` 留空即可（Ollama 不校验）；
- 短超时（2s）——本地服务探测不该让 UI 卡 60s；连不上就显示「未检测到 Ollama，请确认已启动」。

**隐私边界**：Ollama 是 `localhost`，数据不出本机，符合 R-AI-01「隐私/离线」路线。

---

## 四、文件清单（全部新增，零重构）

| 文件 | 动作 | 复用先例 |
|---|---|---|
| `electron/ai-db.ts` | 新增 | 复制 `novel-db.ts`（路径 + schema + 桥接）；随 edition 开关（`EDITION !== "lite"`） |
| `electron/handlers/ai-handlers.ts` | 新增 | 复制 `novel-font-handlers.ts` 的 net.fetch + 参数校验范式 |
| `src/shared/ai/ai-types.ts` | 新增 | 类型契约（请求/响应/错误） |
| `src/shared/ai/ai-client.ts` | 新增 | 调用入口，走 `electronAPI.ai` |
| `src/shared/ai/ai-context.ts` | 新增 | 上下文拼装（纯函数，本期起名只用简单描述） |
| `src/shared/ai/ai-errors.ts` | 新增 | 错误归一映射表 |
| `electron/preload.ts` | 增量 | `electronAPI.ai` 白名单（`trackedInvoke` 范式） |
| `src/shared/types/electron.d.ts` | 增量 | `AiConfig` / `AiGenerateResult` DTO |
| `electron/main.ts` | 增量 | `if (EDITION !== "lite") { registerAiDbBridge(); registerAiHandlers(); }` |

**结论：没有一处需要改现有模块，全部是「新增文件 + 新增注册行 + 新增白名单」。** 与 R-AI-03 架构决策文档的结论完全一致。

---

## 五、风险清单（按严重度排序）

| # | 风险 | 严重度 | 应对 |
|---|---|---|---|
| 1 | `safeStorage` 无先例，Linux 无 keyring 环境 `isEncryptionAvailable()=false` | 中 | 预研点 3 已定：不可用则拒绝保存 Key + 明确提示，绝不明文落盘 |
| 2 | 流式 SSE 解析需手写（`protocol.handle` 流桥接兼容性） | 中 | 主方案 protocol.handle（流派3），兼容性问题退回 IPC 转发（流派1，攒批控频）；起名用非流式 |
| 3 | 第三方 API 限流/额度（429/402） | 中 | 错误归一 + 明确文案（R-AI-01 FR-10 已覆盖），不做内置免费 Key |
| 4 | 代理环境直连失败 | 低 | 用 `net.fetch`（自动跟随系统代理）而非 Node fetch，已规避 |
| 5 | `ai.db` 仅 lite 版不初始化，后续 checkin 接入需放开开关 | 低 | 已决策：`EDITION !== "lite"` 时初始化；checkin 接入时删除判断即可 |
| 6 | 并发流串台 | 低 | 流式预留「请求 id」机制，本期不涉及 |

---

## 六、预研结论

**一句话：AI 接入在现有架构上完全可落地，零重构，唯一「无先例需新验证」的点是 `safeStorage`，其余全部有成熟先例可抄。**

三个最关键的预研发现（决定实现走向）：

1. **网络层必须用 `net.fetch`**（复用 `novel-font-handlers.ts` 先例），不能用 Node fetch——代理环境 + CORS 双重原因。
2. **ai.db 直接复制 `novel-db.ts` 的三段式**（路径/ schema/ 桥接），随 edition 开关（`EDITION !== "lite"`），首版只建 `ai_config` 一张表。
3. **流式本期不做**（起名非流式），但方案已定（`protocol.handle` 主方案 + IPC 转发兜底），为润色/续写预留了清晰路径。

---

## 七、遗留决策点（预研暴露，待你拍板）

1. **`protocol.handle` 流桥接的最小验证**：`net.fetch` 的 `Response` 流经 `protocol.handle` 返回给渲染进程后，`getReader()` 是否可用、`initiatorOrigin` 校验的精确写法——需一段最小验证钉死（属实现细节，非本次决策）。
2. **流式方案（预研点 4）是否在「润色/续写」立项时直接采用？** 本预研已把它定为主方案，届时无需再预研。

---

## 附：与三份既有 PRD 的一致性核对

| 核对点 | 结论 |
|---|---|
| 请求走主进程（R-AI-01 FR-09 / R-AI-03） | ✅ 本预研统一为 `net.fetch`，与「渲染进程直连会被 CORS 拦」一致 |
| 独立 ai.db 随用户隔离（R-AI-01 决策） | ✅ 复制 novel-db 桥接，路径 `user-data/{email-hash}/ai.db` |
| Key 加密存储（R-AI-01 FR-04） | ✅ `safeStorage`，明文仅主进程内存瞬时存在 |
| 起名非流式（R-AI-02 FR-02） | ✅ 起名走 `await json()` 一次性返回 |
| 服务层 `shared/ai/`（R-AI-03） | ✅ 文件清单与其一致，服务层只调 `electronAPI.ai` |
