# AI 上下文加工层 & 输出模板规范 · 预研设计

> **已归档 · 2026-10-27 · 闭环版本 2.8.1**
> 本文为过程留档，**不再修改**（结论与当时的判断依据原样保留）。
> 现行为准的去处：代码本身；后续 AI 功能排期见
> [`ai-roadmap-batch-plan.md`](../../prd/prd-ai-roadmap/ai-roadmap-batch-plan.md)。


- **状态**：**全部落地（Phase 1 = 2.7.0，Phase 2 = 2.8.0）**
- **输入**：R-AI-02（起名增强已落地）、R-AI-03（润色已落地）、`ai-architecture-decision.md`（服务层分层）、`ai-technical-preresearch.md`
- **基线**：代码版本 2.8.0
- **落地对照（2.8.0 实测）**：
  - `src/shared/ai/context/output-spec.ts` — `OutputFormat` / `buildOutputInstruction` / `parseOutput`（三层保险）✅
  - `src/shared/ai/context/collector.ts` — `collectBookContext` / `matchEntitiesInText` ✅
  - `src/shared/ai/context/prompt/` — **提示词唯一产地**（2.8.0）：`sections.ts` 公共段落 + `naming.ts` / `polish.ts` 模板 + `registry.ts`（`PROMPT_BUILDERS` / `buildPromptSpec`）。
    原 `assembler.ts` 已拆入此目录，早期 `ai-context.ts`（`buildNamingPrompt` / `buildPolishPrompt`）已删除 ✅
  - `ai-client.aiGenerateStructured` — 按契约解析（解析在渲染层，主进程不感知）✅
  - 起名：自动灌入上下文 + JSON 寓意展示 + 描述可选 ✅
  - 润色：命中人物卡 + 章节片段注入 ✅
  - AI 调用日志：`ai.db.ai_log` 表 + 本地 **DEBUG** 级日志（`logAlways`，不受级别阈值过滤）✅
  - `work.genre` 题材字段（Phase 2，2.8.0）：可空列 + 书架两步建书 + 作品菜单可补 ✅
  - 调用日志查看面板（2.8.0）：设置窗口「AI 记录」独立页（分页 / 意图筛选 / 展开看 prompt 与输出 / 清空）✅
- **目标**：解决三个当前痛点——① 每次 AI 调用都要作者手工输入要求（类型/风格/书名等），不智能；② AI 输出靠 `split("\n")` + 正则切分，无契约、脆弱；③ 缺 AI 调用日志，无法复盘/调优 prompt。

## 决策记录（已拍板，替换第七节「待拍板」）

| 项 | 决策 |
|---|---|
| 起名输出 | **首版即上 JSON + 寓意**（`json-array {name, meaning}`） |
| 题材 `genre` | **补字段，但非强制步骤**：建书/编辑时可从常见分类（仙侠/都市/西幻/科幻/悬疑等）选择或手动填写，**可跳过**；跳过时起名/润色用「书名 + 要素卡类型」弱兜底 |
| 起名上下文 | 自动灌入（书名/已用名/人物风格锚点）与面板已有选择器（类型/风格/性别/数量）**叠加**而非替代——选择器是显式意图，上下文是系统补充 |
| 润色识别人物卡 | **支持**：反向匹配为主——遍历人物卡，检查 `name/aliases` 是否出现在「选区 + 前后文窗口」中，命中（通常 1-3 张）则注入 `name + type + summary` 进润色 prompt |
| AI 对话日志 | **首版即落地**：`ai.db` 新增 `ai_log` 表，记录每次调用的输入/输出/耗时/错误，方便 prompt 调优 |

---

## 一、问题定性

### 1.1 现状的两个结构性缺陷

| 缺陷 | 现状表现 | 根因 |
|---|---|---|
| **上下文不聚合** | `NameGeneratorPanel` 每次要作者填「类型 / 风格 / 描述」，书名、本书已用名、人物卡等**已有数据没被自动带入** | `buildNamingPrompt` 是纯手工拼装，调用方只传「用户当场输入」，不传「本书已有设定」 |
| **输出无契约** | 起名结果靠 `splitNameItems()` 用正则切 `\n`、顿号、序号前缀；模型多输出一句「以下是几个名字：」就会污染结果 | 没有「输出格式约定」，客户端靠启发式解析，弱模型极不稳定 |

### 1.2 本次预研要回答的两个问题

1. **上下文加工**：如何让「作者只给意图」→ 系统自动聚合本书已有设定（书名 / 类型 / 已用名 / 人物卡 / 章节片段）→ 拼出贴合本书的 prompt？
2. **输出约束**：如何让 AI 输出**结构化、可稳定解析**，同时兼容弱模型（Ollama / 本地小模型）？

---

## 二、总体方案：三层职责 + 两条硬边界

```
┌──────────────────────────────────────────────────────────────┐
│ 功能面板层（NameGeneratorPanel / 右键润色 / 未来续写）          │
│   只给「意图」+ 少量必要描述；从 useNovelData 取数据 → 传纯对象  │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ ★ AI 上下文加工层（新增 src/shared/ai/context/）               │
│   ① collector.ts     纯函数：bookSnapshot → AiBookContext     │
│   ② prompt/（2.8.0）  唯一产地：sections 公共段 + naming /     │
│                      polish 模板 + registry（buildPromptSpec）│
│   ③ output-spec.ts   输出契约：OutputFormat + 三层解析保险      │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ AI 服务层（ai-client / ai-context，职责微调但不越界）           │
│   只做「发请求 + 按 outputSpec 解析 + 错误归一」                │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
│ 主进程 ai-handlers（现状不动：读配置 / 解密 / 发请求 / 归一）    │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 两条硬边界（延续既有铁律，不破坏）

1. **加工层不 import novel 的 React hooks / store**：只接收「纯数据对象」（`BookSnapshot`），由调用方在页面层 `useNovelData` 取好传进来。保持「AI 层不 import novel」的既有边界，`collector` / `assembler` 是纯函数，可独立单测。
2. **输出解析不侵入主进程**：主进程 `ai-handlers` 继续只做「发请求 + 错误归一」，**不做业务级解析**。结构化解析发生在**服务层**（`ai-client` 拿到 `text` 后按 `outputSpec` 解析）。这样主进程对「起名/润色/续写」依然无感知。

> 与 R-AI-03「编辑器不感知 AI」是同一条哲学在不同层的落地：**下层只暴露通用能力，上层才懂业务语义**。

---

## 三、上下文加工层设计

### 3.1 数据源盘点（基于现状）

| 数据源 | 字段 | 现状 | 起名 | 润色 | 优先级 |
|---|---|---|---|---|---|
| 作品名 | `work.name` | ✅ 已有 | ✅ 贴合书名气质 | ✅ | P0 |
| 要素卡 | `entities[]`（type/name/summary/content） | ✅ 已有 | ✅ 避重名 + 风格锚点 | ✅ 理解人物 | P0 |
| 已用名 | 从 entities 的 name+aliases 派生 | ✅ 可算 | ✅ 避重 | — | P0 |
| 境界体系 | `realmCategory.levels` | ✅ 已有 | ✅ 贴合世界观 | — | P1 |
| 当前章节片段 | `activeChapter.content` | ✅ 已有 | — | ✅ 看前后文 | P1 |
| 卷/章节名 | `volumes`/`chapters` | ✅ 已有 | ✅ 避地名冲突 | — | P1 |
| 大纲 | `outlineEntries` | ✅ 已有 | — | ✅ 情节走向（续写） | P2 |
| **题材/风格** | `work.genre` | ✅ **已有（2.8.0）** | ✅ 自动匹配风格 | ✅ | 可空；缺失时弱兜底 |

### 3.2 题材字段：两条路 + 结论

- **A. 补 `genre` 字段**：作者建书时选一次题材（仙侠/都市/西幻…），后续起名/润色自动复用。最干净、零推理开销，但要改 `NovelWork` schema + 建书 UI。
- **B. 模型推断**：把书名+要素卡+章节样本喂给 AI 先推断题材。零改 schema，但多一次调用、首版就有不确定性、且推理结果无法持久复用。

> **预研结论**：**采用 A（补字段）**，2.8.0 已落地：`novel_works.genre`（可空）+ 书架两步建书 + 作品菜单「设置题材」事后可补。`genre` 缺失时仍用「书名 + 要素卡类型」做**弱兜底**（不阻塞、不猜错）。理由：题材是「建书时的一次性输入、全书长期复用」的高价值元数据，补字段一劳永逸，符合「小白免输入」目标。

### 3.3 `AiBookContext`（归一化产物，collector 输出）

```ts
/** 归一后的本书上下文（collector 的输出，prompt 模板的输入） */
export interface AiBookContext {
  work: {
    name: string;
    genre?: string;           // 题材（2.8.0 起有，可空）
  };
  /** 要素卡摘要（起名避重 + 风格锚点；润色理解人物） */
  entities: Array<{
    type: string;             // 人名/地名/势力/物品…
    name: string;
    summary?: string;         // 截断后的摘要，避免撑爆 contextLen
  }>;
  /** 境界体系名（可选） */
  realmLevels?: string[];
  /** 当前章节片段（可选，润色用，截断） */
  chapterSnippet?: string;
  /** 需避开的已用名（起名用） */
  excludeNames?: string[];
}

/** 调用方从 useNovelData 取好后传给 collector 的原始快照 */
export interface BookSnapshot {
  workName: string;
  workGenre?: string;
  entities: Array<{ type: string; name: string; aliases?: string[]; summary?: string }>;
  realmLevels?: string[];
  chapterSnippet?: string;
  /** 已用名，若不传则 collector 从 entities.name+aliases 派生 */
  excludeNames?: string[];
}
```

### 3.4 采集策略：按 intent 最小化 + 截断

`collector` 按 `intent` 决定**采集哪些字段 + 截断多长**，避免把所有东西塞进 prompt 撑爆 `contextLen`：

| intent | 采集字段 | 截断策略 |
|---|---|---|
| `naming` | work.name、genre、entities（type+name）、excludeNames、realmLevels | 每卡 summary 不采集（起名只需名字）；excludeNames 上限 40 条 |
| `polish` | work.name、genre、entities（type+name+summary）、chapterSnippet | chapterSnippet 上限 ~800 字；entities 上限 20 条 |
| `continuation`（预留） | 全量 + outline | 后续定义 |

---

## 四、输出模板规范（本次重点：约束性强）

### 4.1 输出契约的统一抽象

在服务层定义 `OutputFormat` 枚举，每个 AI 功能**显式声明它期望的输出格式**，由服务层统一「注入格式指令 + 解析 + 兜底」。

```ts
/** AI 输出格式契约（调用方声明，服务层负责注入指令 + 解析 + 兜底） */
export type OutputFormat =
  /** 纯文本：润色结果等无结构需求 */
  | { kind: "text" }
  /** JSON 数组：起名等「一批结构化条目」 */
  | {
      kind: "json-array";
      /** 每个元素的字段 schema（如起名的 name + meaning） */
      fields: Array<{ key: string; type: "string" | "number"; label: string }>;
    };
```

### 4.2 强约束的三层保险（约束性强的核心）

**第一层：prompt 强约束（写死 JSON 契约 + 反例）**

`assembler` 生成的 system prompt 里，对 `json-array` 格式写死：

```
你必须只输出一个合法的 JSON 数组，不要输出任何其它文字、解释、代码块标记或 Markdown。
每个元素是一个对象，字段如下：{"name": "字符串", "meaning": "字符串"}
示例：[{"name":"凌霜","meaning":"清冷孤傲"}]
严禁输出形如「以下是几个名字：」的前缀，严禁使用代码块（```）包裹。
```

**第二层：结构化解析（服务层，非启发式）**

`ai-client` 按 `outputSpec` 解析，不再用 `split("\n")` + 正则：

- 提取候选 JSON 段：优先 `JSON.parse` 整个返回；失败则用「最小 `[` 到最大 `]`」切片再 parse（容错模型夹带前后缀）。
- 校验字段：每个元素必须有声明的字段，缺失/类型不符的**丢弃该元素**（不污染整批）。
- 数量过滤：截取到期望 `count`。

**第三层：降级兜底（弱模型不遵循 JSON 时）**

- JSON 解析彻底失败 → 回退到「按换行/分隔符切」的旧启发式（保底有结果）。
- 回退也失败 / 空结果 → 服务层返回 `ok:false` + 明确错误，**触发调用方的「本地规则引擎」降级**（R-AI-02 已有的叠加降级，不阻塞）。

### 4.3 各功能输出模板（首版落地）

| 功能 | OutputFormat | 解析产物 | 说明 |
|---|---|---|---|
| 起名 | `json-array`：`{name, meaning}` | `items: Array<{name, meaning}>` | 顺手收口「寓意」待办 |
| 润色 | `text` | `text: string` | 输出即一段文字，无结构 |

> 起名从「每行一个名字」升级为「JSON 带寓意」，一步到位承载「寓意」字段，且解析稳定。

### 4.4 为什么不是「纯 JSON 万能」

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 全 JSON | 结构强 | 弱模型不严格遵循，润色等纯文本场景是「为结构而结构」 | ❌ |
| 纯文本 + 启发式 | 改动小 | 就是现状的脆弱点 | ❌ |
| **按功能声明格式 + 三层保险** | 约束强 + 弱模型可降级 | 需新增 output-spec 层 | ✅ 采用 |

---

## 五、PromptSpec 与 prompt 模板层

模板层把「归一上下文 + 用户意图」拼成服务层可直接消费的 `PromptSpec`：

```ts
export interface PromptSpec {
  system: string;          // 含：角色定位 + 上下文约束 + 输出契约指令
  prompt: string;          // 用户可见主体（描述 / 待润色文本）
  outputFormat: OutputFormat;
  /** 期望条目数（json-array 场景） */
  count?: number;
}
```

各功能一个模板（`prompt/naming.ts` / `prompt/polish.ts` / 未来 `continuation.ts`），
在 `prompt/registry.ts` 登记一行即可按意图分发（`buildPromptSpec`）——
**新功能只新增模板，不改服务层**，这是「扩展性强」的落点。
`prompt/sections.ts` 收了所有公共段落（角色 / 作品背景 / 要素 / 境界 / 人物 / 章节片段 / 约束 /
输出契约），保证「改一处 = 所有功能同步」，不会再出现两套 prompt 漂移。

---

## 六、落地清单与分阶段

### Phase 1（零 schema 变更，本次可落地）

| 动作 | 文件 | 说明 |
|---|---|---|
| 新增 `output-spec.ts` | `src/shared/ai/context/output-spec.ts` | `OutputFormat` 类型 + JSON 指令模板 + 解析器 + 降级兜底 |
| 新增 `collector.ts` | `src/shared/ai/context/collector.ts` | `BookSnapshot → AiBookContext`，纯函数 |
| 新增 `prompt/` | `src/shared/ai/context/prompt/`（2.8.0 定稿）| `sections.ts` 公共段落 + `naming.ts` / `polish.ts` + `registry.ts`（`buildPromptSpec`）；原 `assembler.ts` 已并入，`ai-context.ts` 已删除 |
| 改 `ai-types.ts` | `AiGenerateRequest` / `AiGenerateData` | 请求加 `outputFormat`；响应 `items` 改 `Array<{name, meaning}>`（或泛型） |
| 改 `ai-client.ts` | 解析逻辑 | 按 `outputFormat` 解析 + 兜底，替换 `splitNameItems` |
| 改 `NameGeneratorPanel` | 起名面板 | 从 `useNovelData` 取 `BookSnapshot`，自动灌入书名/类型/已用名；作者描述变「可选」；结果展示「寓意」 |
| 改 `PolishPreview` / 润色链 | 润色 | 自动带书名 + 相关人物卡 + 章节片段 |

### Phase 2（需补字段，2.8.0 已完成）

- ✅ `NovelWork` 加 `genre`（可空），书架建书第二步选题材（可跳过），作品菜单可事后补；
  起名/润色自动匹配风格。
- ✅ 润色上下文正式接入章节片段 + 人物卡。

### Phase 3（进阶，复用同一层）

- 续写 / 情节建议：复用 `collector` + `AiBookContext`，只新增 `assembleContinuationSpec` 模板。

---

## 七、决策结论（已拍板）

见文首「决策记录」。三点均已定：起名 JSON+寓意、genre 补字段但可跳过、润色反向匹配人物卡；另追加「AI 对话日志」为 Phase 1 必做项。

---

## 八、AI 对话日志（调优支撑，Phase 1 必做）

### 8.1 定位

每次 AI 调用（起名/润色/测试连接）在主进程侧落一条日志到 `ai.db` 的 `ai_log` 表，记录**输入 prompt / 输出结果 / 模型与端点 / 耗时 / 错误码**，供作者复盘「模型为什么这么答」、调优 prompt 时比对历史。

### 8.2 表结构

```sql
CREATE TABLE IF NOT EXISTS ai_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent TEXT NOT NULL,             -- 功能意图：naming / polish / test / continuation…
  provider TEXT NOT NULL,           -- openai / ollama
  model TEXT NOT NULL,              -- 模型名
  system_prompt TEXT,               -- 系统提示词（脱敏后）
  user_prompt TEXT,                 -- 用户提示词（脱敏后）
  raw_output TEXT,                  -- 模型原始返回（脱敏后）
  parsed_output TEXT,               -- 结构化解析结果（JSON 序列化）
  error_code TEXT,                  -- 归一化错误码；成功为空
  error_message TEXT,               -- 错误文案；成功为空
  duration_ms INTEGER NOT NULL,     -- 耗时
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ai_log_created ON ai_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_log_intent ON ai_log(intent);
```

### 8.3 落日志的时机与脱敏

- **落点**：`generateInternal` / `testConnectionInternal` 的**出口处**（成功与失败都记），在 `ai-handlers.ts` 内，与请求同进程，零额外 IPC。
- **脱敏铁律**：日志**绝不含明文 API Key**；`system_prompt` / `user_prompt` / `raw_output` 记的是「发送给模型」和「模型返回」的文本，本身不含 Key（Key 在 header，不在 body），故天然安全。但仍做**长度截断**（prompt/output 各上限 ~4000 字），避免长章节撑爆日志表。
- **不含 PII**：不记用户邮箱、不记作品全文（只记本次拼好的 prompt 片段）。

### 8.4 查询通道

- 新增 IPC：`ai-log-list`（分页查询，倒序，可按 `intent` 过滤）、`ai-log-clear`（清空）。
- 渲染层入口（2.8.0 定稿）：**设置窗口 → 「AI 记录」独立页**，而不是塞进 AI 配置分区。
  理由：配置是「设一次」的动作，记录是「调 prompt 时反复回看」的动作，混在一页会让长列表
  把「保存」按钮淹掉。页面提供分页、按意图筛选、展开看三段（系统提示词 / 用户输入 / 模型输出）、
  一键清空；筛选在 SQL 层做（前端只筛当前页会造成「筛完变空」的假象）。
- 数据随用户隔离（`ai.db` 本身已随用户），无额外工作。
- **写入不受日志级别阈值过滤**（`logAlways`）：AI 记录与 IPC 记录走同一个绕过出口，
  否则默认 `info` 级别下整批消失——而那正是排查「模型为什么答歪」的唯一线索。

### 8.5 对「调优」的价值

| 场景 | 日志能帮上什么 |
|---|---|
| 起名总跑偏 | 回看某次 `system_prompt` 是否漏了「类型/风格」约束，`raw_output` 是否被模型夹带了前后缀 |
| 弱模型不遵 JSON | 看 `parsed_output` 是否为空、`raw_output` 是否是纯文本 → 校准「三层保险」的阈值 |
| 润色不贴人设 | 看某次 `system_prompt` 里是否真的注入了命中的人物卡 `summary` |
| 成本/耗时 | 按 `intent` 聚合 `duration_ms`，识别慢调用 |

---

## 九、与既有文档的关系

- 本预研是 `ai-architecture-decision.md` §3.3「上下文最小化」原则的**正向细化**：从「调用方传上下文」升级为「调用方传数据快照，系统统一聚合+截断」。
- 不推翻「AI 不 import novel」「主进程不解析业务」「编辑器不感知 AI」三条既有铁律，只在服务层之上新增一层纯函数加工层。

> 本方案为产品设计参考，具体实施请结合公司合规与法务要求确认。
