# AI 路线图 · 架构复核与实现优先级重排

> **状态变更（2.7.0，2026-10-27）**：本文 §〇 K-01 / K-02 / K-03 与 §四 D2 所述的
> 「`context/` 不存在、润色只吃选中文本、PRD 待动工」**已闭环**——`shared/ai/context/`
> 的 `collector` / `output-spec` 与提示词层已落地，起名走 JSON + 寓意，
> 润色已注入命中人物卡与章节片段。
>
> **状态变更（2.8.0，2026-10-27）**：剩余两项也已闭环——`novel_works.genre` 已补（可空、
> 建书两步可跳过、作品菜单可事后补），调用日志查看面板已落地为设置窗口「AI 记录」页；
> 同时提示词收敛到 `context/prompt/`（原 `assembler.ts` 拆入、`ai-context.ts` 删除）。
> 以下正文保留当时判断依据，**勿据此排期**。
>
> **状态变更（2.8.1，2026-10-27）**：R-AI-01 ~ R-AI-05 已整组归档（`docs/archive/prd-ai/`）。
> 本文提出的元能力编号已在 [`ai-roadmap-batch-plan.md`](ai-roadmap-batch-plan.md) 做过裁决：
> 「用量看板」并入 **M1b**（不新占功能号），埋点事件走 **M1a**；本文的 M1–M8 定义仍然有效，
> 但**执行顺序与批次以排期文档为准**。

- **状态**：已复核（结论已被 2.7.0 / 2.8.0 实现超越）；**执行顺序见排期文档**
- **输入**：
  - `AGENTS.md`（架构与开发规范，重点 §1 分层 / §2 模块边界 / §2.2.2.1 AI 服务层铁律 / §6.1.2 / §6.5 / §6.7 / §6.8 / §8.4~§8.8）
  - `docs/archive/prd-ai/ai-architecture-decision.md`（R-AI-03）
  - `docs/archive/prd-ai/ai-context-and-output-spec.md`（状态：已评审**待动工**）
  - `docs/prd/prd-ai-roadmap/ai-future-directions-prd.md`（许清楚产出，12 项 + R-AI-17）
  - **代码实测**（本次复核的全部结论均以 `grep` / 读源码为准，见 §一）
- **基线版本**：**2.6.0**（`package.json`）
- **作者**：高见远（架构师）
- **日期**：2026-10-27

---

## 〇、口径纠正（先解决三处会误导排期的事实错误）

### 0.1 技术栈口径

团队简报写的是「React 18 + Electron 42 + antd 6」，与 `AGENTS.md` §9.1 及 `package.json` 实测不一致。**下文一律按实测值**：

| 项 | 简报口径 | 实测（`package.json` / `AGENTS.md` §9.1） |
|---|---|---|
| React | 18 | **^19.2.6** |
| Electron | 42 | **^44.9.0** |
| antd | 6 | **^6.6.2** |
| TypeScript | — | ~6.0.2 |
| Vite | — | ^8.0.12 |
| production dependencies | — | 仅 `better-sqlite3` / `docx` / `jszip` / `mammoth` |

### 0.2 成本量级定义（本文统一口径）

| 量级 | 判据 |
|---|---|
| **S** | ≤2 个文件、无新 IPC、无新表 |
| **M** | 新面板/新组件 + 复用 `shared/ai`；或 ≤3 个新文件 + ≤1 个新 IPC |
| **L** | 新 IPC + 主进程新增能力（如流式端点）+ 新上下文装配，牵动 ≥4 处契约文件 |
| **XL** | 需要向量检索 / embedding / 长文本索引 / **任何新的 production 依赖** |

### 0.3 评分口径

`优先级分 = 价值 V(1–5) ÷ 成本 C(S=1,M=2,L=3,XL=5) × 链路复用度 R(1–3)`
其中「链路复用度」指**该功能复用别人**的程度，而不是被别人复用（被复用是下游的收益，不计入本项，避免「供给方」功能被系统性高估）。

---

## 一、现状核实：PRD 声称「已落地」的资产逐条比对

> 这是本次复核最有价值的部分。**PRD 里有 4 处「可低成本复用」的判断建立在并未存在的代码之上**，若按 PRD 排期，工程会在第 2 周撞墙。

| # | PRD 声称 | 实测结论 | 证据 | 对排期的影响 |
|---|---|---|---|---|
| K-01 | 「`collector` / `assembler` / `output-spec`（json-array 输出契约）**已落地，直接复用**」（PRD §十一、R-AI-08） | ❌ **完全不存在**。`src/shared/ai/` 只有 4 个文件：`ai-client.ts` / `ai-context.ts` / `ai-context.test.ts` / `ai-errors.ts` / `ai-types.ts`；没有 `context/` 子目录 | `ls -R src/shared/ai/` | **R-AI-06/07/08/10/11/13/15 的成本全部要上调一档**。输出契约（json-array + 三层保险）是 07/08/10/11/15 的公共前置，必须先建 |
| K-02 | 「润色已自动灌入书名 / 题材 / 命中人物卡」（PRD R-AI-06） | ❌ 未落地。`buildPolishPrompt(ctx: { text })` **只吃选中文本**；`useNovelPage.runPolish` 调用处也只传 `{ text }` | `src/shared/ai/ai-context.ts` L53–75；`useNovelPage.ts` L709 | R-AI-06 拆成 06a（模板）/ 06b（上下文灌入），见 §二 |
| K-03 | `ai-context-and-output-spec.md` 的结论可当作既有能力 | ⚠️ 该文档状态是「已评审（**待动工**）」，Phase 1 的 7 项落地清单**一项都没做** | 文档文首「状态」行 + K-01 实测 | 该文档应视为**施工图**而非现状图 |
| K-04 | 「`ai_log` 已有 intent / model / duration / error_code，可复用」 | ⚠️ **半真**。`ai_log` 表与 `ai-log-list`/`ai-log-clear` 通道在，但 `intent` 在 `ai-handlers.ts` 里是**硬编码**的 `"generate"` / `"test"`，**无法区分起名与润色** | `electron/handlers/ai-handlers.ts` L347/363/380/457/466/488/506 | R-AI-05 的「成本最低」不成立 —— 必须先改**请求契约**，这不是 UI 活 |
| K-05 | 「埋点回收链路不存在」 | ✅ 属实，且**根因比 PRD 说的更靠底层**：不止是没有写埋点的代码，是 `AiGenerateRequest` 契约里根本没有 `intent` 字段，写也没处写 | `src/shared/ai/ai-types.ts` L53–62 | 见 K-04 |
| K-06 | 「已落地的 AI 日志有查看出口」 | ❌ `ai-log-list` / `ai-log-clear` **已注册、已类型化，但渲染层零消费者**，`ai-client.ts` 也没封装。目前是**只写不读** | `grep -rn "listLogs\|clearLogs" src/` 只命中 `electron.d.ts` | R-AI-05 唯一比 PRD 估计**更便宜**的地方：补一层 `ai-client` 封装 + 一个列表 UI 即可 |
| K-07 | 「`work.genre` 题材字段（Phase 2 已拍板补）」 | ❌ **全库零命中**。`novel_works` 只有 `id / name / created_at / deleted_at` 四列 | `grep -rn "genre" electron/ src/` 无结果；`electron/novel-db.ts` L77–82 | `genre` 是 06/07/09/11/13 的**公共输入**，必须从 R-AI-13 里拆出来提前建（见 D8） |
| K-08 | 「一致性校对依赖本地全文检索，可先本地召回」 | ✅ **属实，且比 PRD 说的更好用**：`searchAcrossBook(keyword, chapters)` 是渲染进程内对**已加载全量章节正文**的 `indexOf` 扫描（带命中计数与摘要切片），**零 IPC、零依赖**；且 `novel_setting_levels.aliases` 的建表注释明写「**也是一致性检查的词表来源**」 | `novel-service.ts` L189–217；`novel-db.ts` L196–217 | 检索与词表都已备好 → **R-AI-10 成本应大幅下调**，本地版应成为首版本体（见 D6） |
| K-09 | 「AI 润色已落地（PRD §〇）」 | ✅ 属实，但**只是最小版**（纯文本进出，无上下文、无流式、无输出契约） | `PolishPreview/index.tsx`、`useNovelPage.ts` L678–757 | 交互范式（选中→浮层预览→换一种→确认替换→失败不动原文）**确实是现成资产**，这条 PRD 判断成立 |
| K-10 | 「`novel_usage_log` + `logUsageEvent` 已存在」 | ✅ 属实。`novel_usage_log(event, payload, created_at)` + 索引 `(event, created_at)`；`logUsageEvent` 失败静默。**但无保留上限、无清理逻辑** | `novel-db.ts` L61–67；`novel-shared.ts` L22–31；`novel-handlers.ts` L428–438 | R-AI-05 若走这条通道需补保留策略；但**不建议**走（见 §二 R-AI-05 红线 A） |
| K-11 | 「关系图写入必须走 `novel-graph-commit` 单事务 + 唯一广播出口」 | ✅ 属实且**已有源码守卫**钉死（四条断言：写通道来自 novel-db / 四类写在单事务 / `ON CONFLICT DO NOTHING` / 端点归属校验先于 INSERT） | `electron/novel-graph-commit-guard.test.ts` | R-AI-15 必须复用 `useGraphCommit` → `commitGraph`，不得另起写入路径 |
| K-12 | 「本章摘要存储落点需架构师定」 | 本文给出结论：**`novel_chapters` 加列**（理由见 §五.2） | `novel-chapter-purge` 实测是**物理 DELETE 行**（L736–744） | 加列方案可天然随章节删除/清库清理，无需额外维护 |

---

## 二、12 项功能逐项可行性判定

### R-AI-05 · AI 用量与效果回流看板（元能力）

- **既有资产**：`electron/ai-db.ts`（`ai_log` 表 ✅、`ai_config` KV 表 ✅）；`ai-log-list` / `ai-log-clear` IPC ✅；`aiErrorMessage` 错误归一 ✅；`SettingsWindow/components/AISection` ✅（2.6.0 左导航右内容骨架，加一个子页成本低）。
- **需新增**：
  1. **契约改动**：`AiGenerateRequest` 加 `intent`（`ai-types.ts` → `electron.d.ts` → `ai-handlers.ts` → `ai-client.ts`，4 处）；`ai-handlers` 里三处硬编码 `"generate"` 改为取 `req.intent`。
  2. **新表 `ai_event`**（ai.db）：记产品维度步骤事件。理由：`adopt` / `edit` / `cancel` 是**用户事后动作**，发生在渲染进程、在请求返回之后数秒到数分钟，主进程出口处的 `ai_log` 结构上写不到。
  3. **新 IPC ×2**：`ai-event-log`（写 + 滚动清理）、`ai-event-stats`（聚合查询）。
  4. **新 IPC ×1**：`ai-export-diagnostics`（诊断包导出）。**不可复用** `novel-export-handlers` 的保存通道 —— 那是 novel 域通道（§2.1 域边界），且 `novel-export-file` 是 `writeFile(...,"utf8")`、二进制另有一条，语义不同。
  5. **UI**：`AISection` 下新增「用量与效果」子页；`ai-client` 补 `listAiLogs` / `clearAiLogs` 封装（沿用「面板只 import `shared/ai`」铁律）。
- **成本量级**：**M**（PRD 判「低/S」——**偏乐观**，见 D1）
- **架构红线**：
  - ⚠️ **红线 A（双库边界）**：PRD §十一提出「扩展 `novel_usage_log` + `logUsageEvent`」——**此路不可走**。`novel_usage_log` 在 novel.db，而 AI 是横切域（`ai.db` 独立存在的原因，见 `ai-db.ts` 文件头）。若把 AI 事件写进 novel.db：① lite 版无 novel 域但 R-AI-16 会放开 AI；② checkin 域的 AI 事件会污染小说库；③ 两库生命周期虽同源但**语义不同**。→ **规避方案**：AI 事件一律落 `ai.db` 的 `ai_event`。
  - ⚠️ **红线 D（§8.7）**：`ai-export-diagnostics` 是**文件保存**而非模型调用，**不享有** AI 的 §8.7 豁免；它必须是**语义化单通道**（只导出 AI 诊断包），不得做成通用文件转发。
  - ⚠️ **红线 J（§8.6）**：新增表 + 新 IPC = 必须升**次版本号**并同步 CHANGELOG。
- **主要风险与验证抓手**：
  | 风险 | 验证抓手（可断言） |
  |---|---|
  | `intent` 又被写死/漏传 | 新增 `electron/ai-domain-guard.test.ts`：断言 `ai-handlers.ts` 剥注释后**不出现** `intent: "generate"` 字面量；断言 `appendAiLog` 的 intent 来自入参 |
  | 事件表撑爆磁盘 | 断言 `ai_event` 写入路径**必须**调用清理函数；单测「保留上限 5000 条 / 90 天」的边界 |
  | 日志里混进正文 / 作品名（合规） | 源码守卫：断言 `ai-domain` 相关文件不出现 `content` / `work.name` 等正文与 PII 字段的写入；导出包字段白名单单测 |
  | 埋点阻塞主链路 | 断言 `logAiEvent` 内部有 `try/catch` 静默（与 `logUsageEvent` 同范式） |

---

### R-AI-06 · 文本变换工具箱

- **既有资产（真实可复用）**：`ai-client.aiGenerate` ✅；`PolishPreview` 浮层范式 ✅（选中→预览→换一种→确认替换→失败不动原文）；`useNovelPage.runPolish` 编排 ✅；`EditorPane.replaceRange` ✅（编辑器不感知 AI，铁律成立）。
- **需新增**：
  - **06a（模板层）**：`ai-context.ts` 新增 `buildTransformPrompt({ kind, text })`（`expand`/`condense`/`rewrite`/`tone`/`pov`）；`PolishPreview` 泛化为可承载「变换类型选择器 + 单结果预览」的形态（建议**原地改造**并保留导出名，避免大 diff）；`useNovelPage` 加 `runTransform(kind)`。
  - **06b（上下文灌入）**：依赖 K-01 的 `collector` —— **与 06a 解耦，随 M2 元能力在 2.8.0 落地**。
- **成本量级**：**M**（06a 单独为 S；含 06b 为 M）
- **架构红线**：
  - ✅ 不碰红线：无新 IPC、无新表、无新依赖、编辑器内核不改。
  - ⚠️ **红线 G（§6.1.2）**：浮层内的「变换类型」选择器必须用 `Segmented` / `Select`，不得手写按钮组；覆盖外观只改 `--ant-*` 变量。
  - ⚠️ **红线 B（AI 不 import novel）**：即使 06b 注入人物卡，也必须是调用方（`useNovelPage`）取好数据、以**纯字符串/结构对象**传入，`shared/ai` 不得出现任何 `@/windows` / `@/shared/novel` 的 import。
- **主要风险与验证抓手**：
  | 风险 | 抓手 |
  |---|---|
  | 未配置 AI 时出现死按钮（PRD §8.2） | 新增 `PolishPreview/index.test.tsx`（jsdom 真渲染）：断言 AI 不可用时入口**隐藏或 disabled + title 给出原因**，断言不存在「可点但无反应」的路径 |
  | 长文本超 token | `ai-estimate.ts` 纯函数单测（中文×1.5 + 英文词×1.3 的估算边界），并与设置项「单次最大字数」联动断言 |
  | 弱模型返回空/与原文一致 | 复用润色已有的「视为失败」判定，`useTransform` 行为单测（空串 / 等值 → 走 error 分支） |
  | `shared/ai` 被污染 | 新增 `src/shared/ai/ai-boundary-guard.test.ts`：全目录扫描，断言不出现 novel / windows / services 的 import |

---

### R-AI-07 · 就地续写

- **既有资产**：`shared/ai` ✅；`EditorPane.insertText` ✅；浮层范式 ✅；`outlineEntries`（`OutlinePanel` 数据）✅。
- **需新增（这是本文判定的最大增量）**：
  1. **流式能力：本项目零实现**。`ai-handlers.ts` 两处请求构造里 `stream: false` 是**写死的**（L195 / L210），既无 `protocol.handle` 端点，也无任何流式 IPC，渲染层 `ai-client` 只有 `aiGenerate`。→ 需新增 `electron/ai-stream.ts` + `main.ts` 注册 `protocol.handle` + `ai-generate-stream` 通道 + `aiGenerateStream(request, onChunk, signal)` + `ContinuationPreview` 的流式渲染与中断。
  2. **输出契约**（2–3 个候选）：当前 `AiGenerateData.items` 是 `string[]`，无 json-array、无解析与兜底 → 依赖 M3。
  3. **上下文**：光标前文截断 + 上一章摘要（依赖 R-AI-09）+ 大纲节点 + 命中人物卡 → 依赖 M2。
- **成本量级**：**L**（PRD 判「中」——偏乐观，见 D3）；**非流式降级版 = M**
- **架构红线**：
  - ⚠️ **红线 D（§8.7）**：流式是对 §8.7 豁免边界的**再次扩张**，必须在 `ai-architecture-decision.md` 五·A 追加一条说明：豁免范围从「主进程发 AI 请求」扩到「主进程托管 AI 流式端点」，且**仍然只服务 `electronAPI.ai` 这一个语义化入口**，不产生可被其它业务复用的通用流式代理。
  - ⚠️ **红线 C（凭据不出主进程）**：`protocol.handle` 端点的 URL 里**绝不能带 Key**；Key 仍只在主进程解密后注入 header。端到端：渲染层拿到的只能是一个一次性端点地址。
  - ⚠️ **`protocol.handle` 必须在 app ready 前注册**，且需与既有 `electron/app-protocol-cache.ts` 的协议实践对齐（不要另起一套协议前缀）。
- **主要风险与验证抓手**：
  | 风险 | 抓手 |
  |---|---|
  | 端点 URL 泄漏 Key | 新增 `electron/ai-stream-guard.test.ts`：断言端点构造不出现 `apiKey` / `Authorization` 拼接；断言端点带一次性令牌且可失效 |
  | 流式中断后连接泄漏 | 断言 `aiGenerateStream` 的 `AbortSignal` 路径会关闭 `ReadableStream` 并撤销端点 |
  | 续写偏离剧情 | 断言 `assembleContinuationStreamSpec` 输出里**必须**含大纲节点与命中人物卡（纯函数单测，传入缺失字段时应产出降级 prompt 而非静默省略；B5 已实现） |
  | 协议注册时机错误（静默 404） | 守卫断言 `main.ts` 中 `protocol.handle` 调用位于 `app.whenReady` **之前** |

---

### R-AI-08 · 实体/设定抽取 → 一键建卡

- **既有资产**：`novel-entity-save` IPC ✅；`EntityPanel` / `EntityDetail` ✅；`entities(type/name/aliases/summary/content)` ✅；本地 `searchAcrossBook` ✅（可做「已有卡名在正文的出处」召回）。
- **需新增**：
  1. `assembleExtractSpec` + json-array 输出契约（依赖 M3 —— **不存在，需先建**）。
  2. **新 IPC `novel-entities-save-batch`**：逐条调 `novel-entity-save` 会 N 次往返且非原子；批量建卡必须单事务。
  3. 候选确认 UI（带类型 / 置信度 / 出处句 / 与已有卡重名标注）→ 路线图里**体量最大的单个新面板**。
  4. 去重逻辑：与已有 `entities.name + aliases` 比对（纯函数，可单测）。
  5. 依赖 M5（L3 授权）与 M6（AI 产出来源标记）。
- **成本量级**：**L**（PRD 判「中」）
- **架构红线**：
  - ⚠️ **红线 B**：实体名集合由 `useNovelData` 取好以纯数组传入，`shared/ai` 不看 `NovelEntity` 类型。
  - ⚠️ **红线 H（§6.5/§6.7）**：若将来需要给 `entities` 加 `source`（AI/手工）列，必须走 `electron/novel-db.ts` 的增量迁移（当前 `novelArch = compat`），**不得**用 `refactor` 口径。
  - ⚠️ **红线 E（窗口隔离）**：候选面板属 NovelWindow 私有，放 `NovelWindow/.../components/`，不得进 `shared/components`（只有两个以上窗口用才允许进 shared，§2.2.1）。
  - ⚠️ **红线 G**：候选列表若达百条量级可用虚拟化，但必须满足「容器确定高度 + 共享 Portal 浮层」的例外条款（`novel-ui-kit.test.ts` 已守卫）。
- **主要风险与验证抓手**：
  | 风险 | 抓手 |
  |---|---|
  | 静默入库（最大合规/体验风险） | 断言 `EntityExtractPanel` 的写入路径**只能**由用户勾选列表驱动，源码里不存在「抽取完成即写库」的分支 |
  | 误抽/重名 | 去重纯函数单测（含别名、同音、空白归一化）；UI 断言重名项必须带「已存在，将更新」标记 |
  | 批量写非原子 | `novel-handlers` 守卫：断言批量写入包在 `db.transaction()` 内（参照既有 `novel-graph-commit-guard` 的写法） |
  | 章节超长 | `chunker.ts` 纯函数单测（滑窗重叠、合并去重、末尾短块处理） |

---

### R-AI-09 · 章节摘要与大纲回流

- **既有资产**：`novel-chapter-outline` IPC ✅（写 `outline_note`）；`novel-outline-entry-save` ✅；`OutlinePanel` ✅；`ChapterTree` 右键菜单 ✅；`SnapshotDrawer` 可作为展示范式 ✅。
- **需新增**：`assembleSummarySpec`（text 型输出，**不需要 json-array**，这是它比 08 便宜的关键）；新 IPC `novel-chapter-summary-save`；`novel_chapters` 加三列；摘要展示入口。
- **成本量级**：**M**
- **架构红线**：
  - ⚠️ **红线 H**：加列走 `PRAGMA table_info` 判列存在的增量迁移，落在 `electron/novel-db.ts`。
  - ✅ 不触碰双库边界（novel 数据落 novel.db）、不触碰 §8.7（无新网络能力）。
- **主要风险与验证抓手**：
  | 风险 | 抓手 |
  |---|---|
  | 摘要与章节生命周期不一致（删章后残留） | 断言摘要是 `novel_chapters` 的**列**（不是 KV 映射、不是独立表）；结合 `novel-chapter-purge` 的物理 DELETE 实测，加列方案天然清理 |
  | 用户无法区分「AI 摘要」与「自己写的备注」 | `ai_summary_at` / `ai_summary_model` 两列是**强制**的（可审计），断言 UI 必展示「AI 生成」标记 |
  | 摘要随正文更新而过期 | 建议存 `updated_at` 快照比对；断言 UI 在正文更新后给出「摘要可能已过期，重新生成」提示 |
- **架构决定（回应 PRD 待拍板 #4）**：**采用 `novel_chapters` 加列**，三列 `ai_summary TEXT` / `ai_summary_at INTEGER` / `ai_summary_model TEXT`。理由：① 随行删除自动清理（purge 物理删行，无孤儿）；② 无 join、无额外删除逻辑（KV 与独立表都要自己处理章节清理，违反 PRD 自己提的「可随章节删除清理」）；③ 与 `outline_note` 同位，语义并列。

---

### R-AI-10 · 一致性校对（「设定警察」）—— 建议拆 10a / 10b

- **既有资产（本条是本次复核的最大惊喜）**：
  - 本地召回**已经免费存在**：`searchAcrossBook(keyword, chapters)` 对已加载全量章节正文做 `indexOf` 命中计数 + 摘要切片，**零 IPC、零依赖**。
  - 比对基准**已经就位**：`novel_setting_levels.aliases` 的建表注释原文写的是「正文用词不一致时靠它归并，**也是一致性检查的词表来源**」；`entities.name + aliases` 提供人名比对基准。
- **需新增**：
  - **10a（纯本地，零 AI）**：`consistency-local.ts` 纯函数 —— 人名/别名近似串匹配（编辑距离 + 同音归一）+ 境界阶梯别名 vs 正文用词归并检查。产物是候选问题列表（类型/严重度/位置/证据句）。
  - **10b（AI 档）**：本地召回 Top-N 片段 → `assembleConsistencySpec` + json-array → 只把片段送模型。
  - `ConsistencyPanel` 结果列表 + 跳转定位（复用 `EditorPane` 定位能力与 `SearchPanel` 的高亮切片 `splitByKeyword`）。
- **成本量级**：**10a = M / 10b = M**（PRD 判「高」——**明显高估**，见 D6）
- **架构红线**：
  - ⚠️ **红线 I（§6.8）**：**绝不引入向量库 / embedding / 分词器生产依赖**。语义检索若真要做，路径是 **SQLite FTS5**（`better-sqlite3` 自带编译，无需新包），但要在 novel.db 建 FTS5 虚表 + 同步触发器（触及 §6.5 迁移与 novel-safety 清库逻辑），**必须先预研**（见 §八 Q13）。本路线图不立项。
  - ⚠️ **性能红线（新提出）**：`searchAcrossBook` 是**同步全量扫描**（其源码注释已警告「防抖每触发一次就是一遍全书级同步 CPU，会卡住输入法」）。一致性校对是全书级任务，直接在渲染线程跑必然卡 UI。
    → **规避方案二选一**（需拍板，Q12）：① Web Worker（Vite `?worker`，零新依赖）；② 分片 + `await` 让出（改动小、但仍有掉帧）。**禁止**为了省事把它搬进主进程逐章读库 —— 那会让小说正文经 IPC 全量往返。
  - ⚠️ **红线 G**：结果列表若达数百条需虚拟化，遵守确定高度 + 共享 Portal 条款。
- **主要风险与验证抓手**：
  | 风险 | 抓手 |
  |---|---|
  | 误报率高（PRD 列为最大风险） | **10a 先行本身就是抓手**：本地规则的误报基线可测（对同一本书跑两遍结果稳定）；AI 档接入后断言「AI 新增的候选必须带 evidence 字段，否则丢弃」 |
  | 只提示不自动改（PRD 原则） | 断言 `ConsistencyPanel` 不含任何写正文的调用路径（源码扫描 `replaceRange` / `updateChapterContent` 出现次数 = 0） |
  | 忽略记忆 | 「忽略此项」存 `ai_config` 或 `novel_config` 的 KV（复用既有 KV 表，零新表），断言复查时该 key 被过滤 |
  | 长任务卡 UI | 若选 Worker 方案，补一条测试断言「校对入口不直接调用 `searchAcrossBook`」 |

---

### R-AI-11 · 卡文救援 · 剧情分支建议

- **既有资产**：`OutlinePanel` ✅；`InspirationPanel` ✅（灵感速记，天然承接 AI 产出）；`novel-note-save` / `novel-outline-entry-save` IPC ✅（**产出落库通道现成，无需新 IPC**）。
- **需新增**：`assembleBranchSpec` + json-array（依赖 M3）；前文摘要上下文（依赖 R-AI-09）；两个面板各加一个受 M8 门控的入口。
- **成本量级**：**M**
- **架构红线**：✅ 无新增 IPC / 无新表 / 无新依赖。⚠️ 红线 E：入口分属 NovelWindow 内两个面板，禁止互相 import，共享的「候选列表 + 确认」形态若被 ≥2 处复用则抽到 `shared/components/AiCandidateList/`。
- **主要风险与验证抓手**：建议同质化 → 断言 `assembleBranchSpec` 输出必含「必须基于本书已有设定与未收伏笔」约束与风格旋钮参数；「换一批」不得复用同一 `temperature` 种子（可断言参数递增）。

---

### R-AI-12 · 创作日报 / 写作复盘（checkin × novel 联动）

- **既有资产**：`novel-usage-today` IPC ✅；`novel_usage_log` ✅；`goal_reach` 埋点 ✅；`HomePage` / `DailyPage` UI 范式 ✅。
- **需新增**：**新 IPC `novel-usage-range`**（区间聚合，现成的 `novel-usage-today` 只有当日口径）；HomePage 卡片或 SupportPanel 入口；AI 文案（一次 `text` 型调用，只喂数字）。
- **成本量级**：**M**
- **架构红线**：
  - ⚠️ **红线 E（窗口隔离，本条最主要）**：`HomePage`（BaseWindow）**禁止 import `NovelWindow` 的任何内容**（§2.2.0）。全部数据必须经 `novel` IPC。**实测补充**：`registerNovelDbBridge()` 在 `main.ts` L1117 是**无条件调用**的，所以 full/lite 版 novel.db 都会打开，技术上可行；但 lite 版没有小说窗口，novel.db 无数据 —— 周报在 lite 版无意义。
  - ⚠️ **红线 A**：聚合查询走 novel.db（数据本源），AI 文案调用走 ai.db 域，两域不得混写。
- **主要风险与验证抓手**：数据不足显空 → 断言「数据满 2 周才启用 AI 文案」的门控（PRD 已有此设计，需落成可断言的条件）；AI 失败时数字照常展示 → 断言文案区块可缺省而数字区块不受影响（组件单测）。

---

### R-AI-13 · 起名增强 v2

- **既有资产**：`NameGeneratorPanel` ✅（含插正文 / 建角色卡 / 收藏三个出口）；`naming/name-generator.ts` 本地规则引擎 ✅（**全项目最成熟的降级路径**）；`fallbackToLocal` 编排 ✅。
- **需新增**：批量体系化 prompt 模板 + 结果样式；`work.genre` 字段（**不存在**，D8）；依赖 R-AI-05 的 v1 数据。
- **成本量级**：**M**（含 `genre` 字段则为 M；PRD 判「低」）
- **架构红线**：⚠️ 红线 H：`ALTER TABLE novel_works ADD COLUMN genre`（增量迁移，可空、可跳过）；⚠️ 红线 G：`pack-ui-kit` 式 UI 守卫不适用本面板，但 `NameGeneratorPanel` 仍受 §6.1.2 约束。
- **主要风险与验证抓手**：v1 价值未验证就加深 → 建议落成**可断言的门槛**：单测/守卫无法断言业务指标，但可在 `AISection` 用量页把「起名触发/采纳」单独成行，作为人工裁决依据；**在 R-AI-05 数据跑满一个版本周期前不启动 v2**。

---

### R-AI-14 · 角色卡 / 设定卡字段补全

- **既有资产**：`shared/components/CharacterPack` ✅（NovelWindow + PackWindow 共用，符合 §2.2.1）；字段体系（角色/物品/技能/境界）✅；`SettingCenter` ✅。
- **需新增**：`assembleCardFillSpec` + json-array；逐字段采纳 UI；`CharacterPack` 内加一个受 M8 门控的「AI 补全」按钮。
- **成本量级**：**M**
- **架构红线**：
  - ⚠️ **红线 G（本条最硬）**：`CharacterPack` 有专门的 UI 守卫 `pack-ui-kit.test.ts`（禁止原生表单控件、自带造型控件必须以 `.ant-btn` 承载 + 清零点 mixin）。新增任何控件**必须**过这条守卫，否则打包不报错但暗色主题下会白底黑字。
  - ⚠️ **红线 E**：`CharacterPack` 是 shared 组件，被两个窗口共用 → AI 补全按钮在**无 AI 能力的窗口**（如未来 lite 版的行囊）必须可消失（M8）。
  - ⚠️ **红线 B**：`CharacterPack` 已有 import `shared/services/novel-shared` 的先例（该文件定义为「跨窗口最小依赖集」）；新增 AI 依赖只能 import `shared/ai`，**不得** import NovelWindow 私有类型。
- **主要风险与验证抓手**：补全与已有设定冲突 → 断言注入了已有要素卡做约束；整体覆盖 → 断言写入路径是**逐字段 merge** 而非整体替换（单测构造「用户手工改过某字段」的用例）。

---

### R-AI-15 · 人物关系建议

- **既有资产**：`RelationWindow` ✅；`useGraphCommit` → `commitGraph` ✅（单事务 + rev + 连点锁，三条硬约束已在 hook 里）；`novel-links-changed` 唯一广播出口 ✅；`novel-graph-commit-guard.test.ts` 守卫 ✅。
- **需新增**：`assembleRelationSpec` + json-array（依赖 M3）；候选边抽屉；**无新写入通道**。
- **成本量级**：**M**（PRD 判「中高」）
- **架构红线**：
  - ⚠️ **红线 E + 既有守卫（本条最关键）**：写入**必须**经 `useGraphCommit` 的 `commitGraph`，**不得**新增 `novel-link-add-batch` 之类的平行通道 —— 那会绕过 `novel-links-events.ts` 的唯一广播出口，造成「图与库不一致」。`novel-handlers` 里已有一个 `novel-link-add`（主窗口侧），**R-AI-15 不得复用它**（它不广播给 RelationWindow）。
  - ⚠️ 依赖 R-AI-08（先有要素卡才有节点）—— 但**不依赖** R-AI-10。
- **主要风险与验证抓手**：误判关系 → 断言候选**默认不勾选**（低置信尤其），且必须展示证据句；写入一致性 → **在既有 `electron/novel-graph-commit-guard.test.ts` 追加断言**：批量建边仍在单事务内、仍调用 `broadcastLinksChanged`。

---

### R-AI-16 · checkin 域轻量 AI —— 建议拆 16a / 16b

- **既有资产**：`LedgerPage` / `MemoPage` / `TodoPage` ✅；`shared/ai` ✅（checkin 域同样只 import 服务层，铁律天然成立）；分类预设播种（ledger）✅。
- **需新增**：
  - **16a（本地规则版，S）**：记账分类建议 = 关键词匹配历史分类。零 AI、零 edition 改动。
  - **16b（AI 版，M）**：放开 `main.ts` L1123–1125 的 `EDITION !== "lite"` 门控 + `SettingsWindow/App.tsx` L57 的 `SHOW_AI = !IS_LITE_EDITION` + `ai-db.ts` 文件头的开关说明；lite 版设置窗口 UI 适配；回归 `electron/edition.test.ts`。
- **成本量级**：**16a = S / 16b = M**
- **架构红线**：
  - ⚠️ **红线 F（edition 清单）**：放开 lite 会动 `electron/edition.ts` 的登记口径与 `edition.test.ts` 护栏，且 `SettingsWindow` 本身**已在 lite 的 `EDITION_WINDOW_ENTRIES` 里**（L52），所以是「同窗口内加页」而非「加窗口」—— 改动可控，但**必须**同步 `edition.ts` 注释与 `ai-db.ts` 文件头（三处注释都在声明「lite 不建库」，不同步就会留下一份会骗人的注释）。
  - ⚠️ **红线 D**：checkin 域的 AI 调用**同样只能走 `electronAPI.ai`**，不得为记账/备忘另开语义化 AI 通道之外的东西。
- **主要风险与验证抓手**：edition 门控漂移 → 在 `ai-domain-guard.test.ts` 增加断言：`main.ts` 的 `registerAiDbBridge` 门控条件与 `SettingsWindow/App.tsx` 的 `SHOW_AI` 必须**同真同假**（源码级字符串断言，两处都写死为 `lite` 判定）。

---

### R-AI-17 · 就地问答条（非独立窗口，条件触发）

- **与 PRD 一致的判断**：**维持「不新建独立 AI 聊天窗口」的决策**（R-AI-03 §一·1），理由与 PRD §4.1 一致，且 K-11/K-08 的实测进一步支持（就地形态可复用现有面板与本地召回）。
- **既有资产**：`SupportPanel` ✅（内嵌形态，不新增 edition 入口，符合 R-AI-03 与 §2.2.0）；`searchAcrossBook` 本地召回 ✅（**零成本**）；`SearchPanel` 的 `splitByKeyword` 高亮 ✅；`onSelectChapter` 跳转 ✅。
- **需新增**：输入条 + Top-N 召回排序 + 引用位置展示与跳转。**不需要 RAG、不需要向量库、不需要新依赖。**
- **成本量级**：**M**（PRD 判「高」——**明显高估**，见 D7）
- **架构红线**：
  - ⚠️ **红线 I**：明确禁止引入向量库 / embedding。索引若将来要建，必须落在用户本机的 SQLite（**FTS5 优先于向量**，零新包）。
  - ⚠️ **红线 D**：问答走 `electronAPI.ai`，**不为它开第二条 AI 通道**。
  - ⚠️ **性能红线**：同 R-AI-10 —— Top-N 召回走的是同步全量扫描，需分片让出或 Worker。
- **主要风险与验证抓手**：
  | 风险 | 抓手 |
  |---|---|
  | 召回质量差（真实门槛，不是工程量） | 先把 `searchAcrossBook` 的召回**单独**做成可测：给定 5 组「语义型提问 → 期望章节」样本，断言 Top-N 命中率；不达标就先扩召回器（关键词 AND/OR + 要素名 + 章节标题加权），**仍然零依赖** |
  | 降级为普通检索（PRD 设计的优点） | 断言 AI 不可用时输入框退化为全书检索且功能不消失（组件单测） |
  | 触发条件未满足就立项 | 断言（文档级）：触发条件改为「10a 的本地召回 + 模型总结链路已在真实书上验证可用」，取代不可校准的「渗透 ≥40%」 |

---

## 三、优先级重排（本文核心）

### 3.1 重排总表

| 编号 | 功能 | V | C | R | 分 | **本文 P 级** | PRD P 级 | 变动 |
|---|---|---|---|---|---|---|---|---|
| **M1/M8** | 事件回流契约 + 入口可消失门控（并入 R-AI-05） | 4 | M(2) | 3 | 6.0 | **P0** | P0 | 成本上调 |
| **R-AI-06** | 文本变换工具箱（06a 模板 / 06b 上下文） | 5 | M(2) | 3 | 7.5 | **P0** | P0 | 拆分 |
| **R-AI-09** | 章节摘要与大纲回流 | 4 | M(2) | 3 | 6.0 | **P0** ↑ | P1 | **上调** |
| **R-AI-10a** | 一致性校对·纯本地版 | 4 | M(2) | 3 | 6.0 | **P0** ↑ | （PRD 视作兜底） | **上调为本体** |
| **R-AI-07** | 就地续写（**非流式版**） | 5 | M(2) | 3 | 7.5 | **P0** | P0 | 先降流式 |
| **R-AI-05** | 用量与效果看板（UI + 导出） | 4 | M(2) | 3 | 6.0 | **P0** | P0 | 成本上调 |
| **M2/M3/M7** | 上下文装配 + 输出契约 + prompt 版本 | — | — | — | — | **P0（元能力）** | — | 新增 |
| **R-AI-08** | 实体抽取 → 一键建卡 | 5 | L(3) | 2 | 3.3 | **P1** ↓ | P0 | **下调** |
| **R-AI-10b** | 一致性校对·AI 档 | 5 | M(2) | 2 | 5.0 | **P1** | P1 | 拆分 |
| **R-AI-11** | 卡文救援 · 剧情分支 | 4 | M(2) | 2 | 4.0 | **P1** | P1 | — |
| **R-AI-15** | 人物关系建议 | 3 | M(2) | 3 | 4.5 | **P1** ↑ | P2（3.0） | **上调** |
| **R-AI-17** | 就地问答条（条件触发） | 4 | M(2) | 3 | 6.0 | **P1（条件）** | P2（3.0，成本高） | **成本下调** |
| **M4** | 流式能力 | — | L(3) | 3 | — | **P1** | — | 独立排期 |
| **R-AI-16a** | 记账分类建议（本地规则） | 3 | S(1) | 1 | 3.0 | **P1** | P2 | **上调为独立项** |
| **R-AI-12** | 创作日报 / 写作复盘 | 3 | M(2) | 1 | 1.5 | **P2** ↓ | P1（2.9.x） | **下调** |
| **R-AI-14** | 卡片字段补全 | 3 | M(2) | 2 | 3.0 | **P2** | P2 | — |
| **R-AI-13** | 起名增强 v2 | 2 | M(2) | 1 | 1.0 | **P2** | P2 | 拆出 genre |
| **R-AI-16b** | checkin 域 AI（放开 edition） | 3 | M(2) | 1 | 1.5 | **P2** | P2 | 拆分 |

### 3.2 与产品经理判断不一致的地方（逐条）

| # | 分歧点 | PM 判断 | 本文判断 | 理由 |
|---|---|---|---|---|
| **D1** | R-AI-05 成本 | 低（表与通道都在，只差 schema + 一个 UI） | **M**（1 新表 + 3 新 IPC + 4 处契约改动） | `intent` 在主进程是**硬编码** `"generate"`（K-04），不先改契约，`ai_log` 永远分不出功能；`adopt/edit` 是渲染侧事后事件，主进程出口写不到，必须新表 `ai_event`；导出不能复用 `novel-export-*`（域边界）。**P0 不变，理由反而更强**：这是契约层欠债，不补则后续每个功能的度量都是零 |
| **D2** | 「collector/assembler/json-array 输出契约已落地，直接复用」 | 已落地 | **完全不存在**（K-01） | `src/shared/ai/` 只有 4 个文件，无 `context/` 子目录；`ai-context-and-output-spec.md` 状态是「待动工」。**建议 PM 修订 PRD §十一对应那一行**，否则工程会按零成本排期 |
| **D3** | R-AI-07 成本与做法 | 中（需流式 + 前文/摘要上下文） | **L**；建议 2.8.0 先上**非流式**（M），流式作为 M4 元能力独立排期 | `stream: false` 在 `ai-handlers.ts` 里写死两处，全仓无 `protocol.handle` 流式端点、无流式 IPC、无渲染层消费者。这是整份路线图**唯一需要主进程新增网络能力**的功能，把它和「新功能」捆在一个版本里风险过高 |
| **D4** | R-AI-08 vs R-AI-09 的先后 | 08 在 2.8.0 首位，09 紧随 | **09 在前**（2.9.0），08 退到 2.11.0 | 09 是**最便宜的 L3 消费者**：text 型输出（不需 json-array）、无候选确认 UI、无批量写、无去重。先做 09 能用最低成本趟出 M5（L3 授权）+ M6（落地通道）两条元能力，08 再踩着走。且 09 是 07（P0）与 11 的**上游上下文**。PRD 让最贵的 L3 功能先去趟基建，顺序反了 |
| **D5** | R-AI-08 的 P 级 | P0 | **P1**（阶段四首位） | 成本是 L（批量写 IPC + 路线图最大新面板 + 去重 + L3 授权）；它是**供给方**（被 10/15 复用）而非复用方，按本文口径复用度只有 2，得分 3.3。更关键：它的下游 10a **靠用户手工建的卡就能跑起来**，抽取是加速器不是前置 |
| **D6** | R-AI-10 的成本与定位 | 成本高 / 本地版是「建议必须做的兜底」 | **10a 纯本地版是首版本体**（M），10b AI 档随后（M） | 本地召回**已免费存在**（`searchAcrossBook` 内存扫描，`novel-service.ts` L189）；`novel_setting_levels.aliases` 建表注释明写「也是一致性检查的词表来源」——**数据模型与检索都已为它备好**。10a 零 token、零 L3 授权摩擦、结果可复现，还能给 10b 提供误报基线。这是全路线图性价比最高的一项 |
| **D7** | R-AI-17 的成本与触发条件 | 高成本 / 触发阈值「AI 渗透 ≥40% + 反馈 ≥10 次」 | **成本 M**；触发条件改为「10a 的本地召回 + 模型总结链路在真实书上验证可用」 | 同 D6，召回零成本、无新依赖。真正的门槛是**召回质量**（关键词匹配对语义提问差），不是工程量。渗透率阈值在没有数据回流前**不可校准**（PRD 自己也标了【估算】） |
| **D8** | `work.genre` 的归属 | 绑在 R-AI-13（P2 / 3.0） | **拆出，作为 2.8.0 元能力** | 全库 `grep genre` 零命中（K-07）。题材是 06/07/09/11/13 **五个功能的公共输入**，绑在 P2 上等于让前四个功能在 2.7–2.9 全部用弱兜底 |
| **D9** | R-AI-15 的位置 | P2 / 3.0 | **P1 / 2.12.0**（在 08 之后） | 08 落地后，15 只剩「候选抽屉 + 复用既有 `commitGraph`」两块，边际成本 M，且复用度 3（复用 08 的抽取上下文、M3 的输出契约、既有的图事务与广播）。比 3.0 池里的 13/14 更值得提前 |
| **D10** | R-AI-12 的位置 | P1 / 2.9.x | **P2 / 3.0 池，视数据成熟度随时插入** | ① 它的价值依赖 `ai_event` 数据成熟度，PM 自己也写「冷启动期只展示客观数字」—— 早于数据上线只会展示空卡片；② 它是唯一跨 checkin/novel 两域的功能，受窗口隔离硬约束，且 lite 版 novel.db 无数据使其无意义；③ 复用度仅 1 |
| **D11** | 版本号形态 | 2.7.x / 2.8.x / 2.9.x / 3.0 | 阶段名可以这么叫，但**版本号必须是连续次版本**：2.7.0 → 2.8.0 → 2.9.0 → 2.10.0 → … | **AGENTS.md §8.6 硬规定**：「有架构调整、新增页面/模块/数据层时升次版本号；无架构改动的小功能与修复只升修订号」。本路线图几乎每一项都带新表或新 IPC，**落成 2.7.1 / 2.8.1 是违规的**。这是本次复核发现的一处规范冲突 |
| **D12** | R-AI-16 的做法 | P2 / 3.0，先只做记账分类 | 同意方向，但**拆 16a 本地规则版（S，可提前）/ 16b AI 版（M，需放开 edition）** | 分类建议用本地关键词匹配历史分类能做到七八成，是**零成本收益**；而 AI 版要动 `main.ts` 的 edition 门控 + SettingsWindow 的 `SHOW_AI` + `edition.test.ts` 回归，成本全在门控改造上，与功能本身无关 |
| **D13** | 技术栈口径 | 简报写 React 18 / Electron 42 | 按 `AGENTS.md` §9.1：React 19.2 / Electron 44.9 / antd 6.6 / TS 6.0 / Vite 8 | 见 §0.1。涉及 antd 6 的 API 差异（如 `classNames.popup` 取代 `popupClassName`、Modal 结构改为 `.ant-modal-container`），按 6.6 的口径写样式，照 v5 写会静默失效 |

### 3.3 我的排序（一句话版）

> **先补契约（intent + 事件表）→ 做最便宜的高频功能（06）→ 趟出 L3 基建（09）→ 用免费的本地能力拿差异化（10a）→ 再上贵的沉淀功能（08）→ 最后才是扩面与低频（12/13/14/16）。**

---

## 四、必须先建的横切元能力

> 不先建这些，后面每个功能都会各造一遍轮子，且每造一遍都会重新踩一遍红线。

| 编号 | 元能力 | 为什么必须先建 | 阻塞了谁 | 建议落点版本 |
|---|---|---|---|---|
| **M1** | **意图与事件回流契约**：`AiGenerateRequest.intent` + `ai_event` 表 + 保留上限 + `ai-client` 封装 | 埋点零落地的根因在**契约层**不在 UI 层（K-04/K-05）。不补，R-AI-13 的「等 v1 数据说话」、R-AI-12 的「数据成熟度」、R-AI-17 的「渗透阈值」全都无法裁决 | 全部 | **2.7.0（最先）** |
| **M8** | **AI 可用性门控**：`useAiAvailability()`（配置态 / 不可用原因 / L3 授权态），统一「入口要么隐藏、要么禁用+说明、要么有本地兜底」 | PRD §8.2 的「入口可消失」原则目前**每个功能各写一遍**判断；抽成 hook 才能被守卫断言 | 全部 | **2.7.0（与 M1 同批）** |
| **M3** | **输出契约**：`output-spec.ts`（`text` / `json-array` + 三层保险：prompt 强约束 → 结构化解析 → 启发式兜底）+ 解析器单测 | 07/08/10/11/13/15 **六个功能**都要 json-array，现在一个都没有（K-01） | 07/08/10/11/13/15 | **2.7.0（text 分支）→ 2.8.0（json-array 分支）** |
| **M2** | **上下文装配器**：`shared/ai/context/` 的 `collector` + `assembler` + `BookSnapshot`（**结构类型，AI 层自声明，不 import novel**）+ 截断策略 + `chunker` | 06b/07/09/11/13 都要「按 intent 最小化采集 + 截断」，不抽就是每处一份拼装 | 06b/07/09/11/13 | **2.8.0** |
| **M7** | **prompt 模板与版本管理**：`shared/ai/prompts/registry.ts`（意图 → 模板 + version），version 落进 `ai_log`/`ai_event` | 没有版本就无法做效果归因（「换了 prompt 之后采纳率变了吗」），PRD 的阶段验证问题 4（哪种变换最被需要）也需要按模板维度聚合 | 全部（归因） | **2.8.0（与 M2 同批）** |
| **M5** | **L3 数据出境授权与范围选择器**：分级常量 + 授权弹窗 + 总开关（复用 `ai_config` KV，**零新表零新 IPC**）+ 范围选择 + 成本估算文案 | 08/09/10/15/17 五个功能都要，逐个做会出现五份不一致的授权文案 | 08/09/10/15/17 | **2.9.0（首个 L3 功能之前）** |
| **M6** | **AI 产出落地通道（可撤销 / 可审计 / 可沉淀）**：来源标记构造器（`source=ai` + 模型 + 时间戳）+ 一键撤销 + 「AI 参与占比」的统计口径 | PRD §8.1「AI 产出必须沉淀」目前只是原则，没有承载物；「AI 参与占比」（待拍板 #2）也必须先有来源标记才能算准 | 08/09/15 + R-AI-05 占比统计 | **2.9.0（与 M5 同批）** |
| **M4** | **流式能力**：`protocol.handle` 主方案 + IPC 兜底 + 渲染层 `aiGenerateStream` + 中断 | 07 的体验上限；也是未来长任务（批量摘要、全书校对）的通用能力 | 07（升级）/ 未来长任务 | **2.10.0（07 非流式先上）** |

**落地顺序**：`M1 + M8` → `M3(text)` → `M2 + M3(json-array) + M7` → `M5 + M6` → `M4`

> ⚠️ 顺序纪律：M5 **不能**晚于第一个 L3 功能；M2/M3 **不能**晚于第一个需要结构化输出的功能（07 非流式也要 2–3 个候选，所以 M3 的 json-array 分支必须早于 07，即 **2.7.0 就得有**，07 放 2.8.0）。

---

## 五、数据模型增量

### 5.1 ai.db 新增（`electron/ai-db.ts`）

```sql
-- 产品维度事件表（与技术日志 ai_log 分工，见 5.3）
CREATE TABLE IF NOT EXISTS ai_event (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  intent       TEXT    NOT NULL,   -- naming/polish/transform/continuation/extract/
                                   --   summary/consistency/branch/report/qa/card/fill
  step         TEXT    NOT NULL,   -- trigger|success|fallback|adopt|edit|cancel
  provider     TEXT,               -- openai/ollama（trigger 时可能为空）
  model        TEXT,
  prompt_ver   TEXT,               -- M7：prompt 模板版本，用于效果归因
  duration_ms  INTEGER,
  error_code   TEXT,               -- 归一化错误码；成功为空
  item_count   INTEGER,            -- 产出条数（json-array 场景）
  char_count   INTEGER,            -- 送模型的正文字数（只记字数，不记正文）
  scope        TEXT,               -- selection|chapter|book —— L3 范围，用于授权拒绝率统计
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ai_event_intent_step ON ai_event(intent, step);
CREATE INDEX IF NOT EXISTS idx_ai_event_created     ON ai_event(created_at DESC);
```

**纪律**：
- 时间口径：沿用 `ai_log` 的 `datetime('now','localtime')` 字符串，**同库内不得混入 UTC**（否则按日期聚合会错行）。
- 保留策略：`ai_event` 滚动清理（默认最近 5000 条 **或** 90 天，可在设置里配），清理挂在写入路径上；`ai_log` 现有**无保留上限**（K-10），同批补 30 天清理。
- 字段白名单：**只记元数据**，`char_count` 记字数不记正文，不记作品名 / 章节标题 / 邮箱。
- 迁移方式：`CREATE TABLE IF NOT EXISTS` + 后续加列走 `PRAGMA table_info` 判列（§6.5）。
- 导出包（`ai-export-diagnostics`）**只出 `ai_event` + 脱敏的 `ai_log` 元数据**（intent/model/duration_ms/error_code），正文截断字段一律不出。

### 5.2 novel.db 增量（`electron/novel-db.ts`，全部走增量迁移）

```sql
-- R-AI-09：章节摘要（回应 PRD 待拍板 #4，架构结论 = 加列）
ALTER TABLE novel_chapters ADD COLUMN ai_summary       TEXT;     -- AI 摘要正文
ALTER TABLE novel_chapters ADD COLUMN ai_summary_at    INTEGER;  -- 生成时间戳（NULL = 未生成）
ALTER TABLE novel_chapters ADD COLUMN ai_summary_model TEXT;     -- 来源模型（手工编辑后置空 → 可审计）
-- 可选：需要「哪些章还没摘要」的批量扫描时
CREATE INDEX IF NOT EXISTS idx_novel_chapters_summary_at
  ON novel_chapters(work_id, ai_summary_at);

-- M2 / R-AI-13：题材（可空、可跳过）
ALTER TABLE novel_works ADD COLUMN genre TEXT;
```

**为什么是加列而不是 `novel_config` 映射或独立表**（PRD 待拍板 #4）：
1. `novel-chapter-purge` **实测是物理 `DELETE FROM novel_chapters`**（L736–744）→ 加列方案**自动随章节清理**，零维护；
2. `novel_config` 是 KV，删章时需要额外删 key，且 `ai_summary_at` 这类结构化查询做不了 → 违反 PRD 自己提的「可随章节删除清理」；
3. 独立表要多一个 join，且删章/清库/模板重置都要补清理路径，是三处漏删风险。

**迁移纪律（§6.5 / §6.7）**：
- 当前 `novelArch = "compat"`，**必须**走增量迁移，写在 `electron/novel-db.ts` 自己的建表函数里，**不得**动 `electron/db.ts`；
- 加列用 `PRAGMA table_info(novel_chapters)` 判列存在后再 `ALTER`，新列可空；
- 所有 `novel_*` 全表 SQL 必须带 `deleted_at IS NULL`；任何删除/清理 SQL 必须带**时间下界**（既有 novel-safety 纪律）；
- `novel-safety-handlers` 的回收站恢复逻辑**不需要改**（列随行走）。

### 5.3 `ai_log` 与 `ai_event` 双表并存的必要性

| 表 | 定位 | 保留 | 是否含正文截断 | 消费者 |
|---|---|---|---|---|
| `ai_log`（既有） | **技术排障**：「这次调用为什么失败/为什么这么答」 | 30 天 | 是（prompt/output 各 ~4000 字） | 诊断包（脱敏）、prompt 调优 |
| `ai_event`（新增） | **产品度量**：「哪个功能被用了多少次、采纳率多少」 | 5000 条 / 90 天 | **否**（只有 char_count） | 看板、导出包、版本决策 |

> 不能合并：`ai_log` 存正文截断，做产品指标源在合规上不成立（导出包会被正文污染）；`ai_event` 要记「adopt/edit」这类主进程看不到的动作，塞不进 `ai_log` 的「请求出口写一条」模型。

---

## 六、依赖包影响评估

**结论：12 项功能 + 8 条元能力，无一需要新的 production 依赖。**

| 需求 | 想引入的包 | 判定 | 替代方案 |
|---|---|---|---|
| token 估算（范围选择器、用量看板） | `tiktoken` / `js-tiktoken` / `gpt-tokenizer` | ❌ **禁止**。渲染层依赖必须放 devDependencies（§6.8），且 wasm/词表会进 asar | 自研纯函数 `ai-estimate.ts`：中文字符 ×1.5 + 英文词 ×1.3 + JSON 结构开销常数。**必须配单测**（§6.6 纯函数最低覆盖） |
| 语义检索 / 全书 RAG | `hnswlib-node` / `sqlite-vss` / `faiss-node` / `vectra` | ❌ **明确禁止**。① production dependencies 只允许 4 个（`packaging-guard.test.ts` 已断言）；② 原生模块需 `node-gyp` + `asarUnpack`，与 §6.8 三条铁律冲突；③ 无后端，索引落本地会让 ai.db 体积失控 | **三级替代**：① 现有 `searchAcrossBook` 内存扫描（零成本，已在用）；② 召回器增强（关键词 AND/OR + 要素名 + 章节标题加权 + TF 排序），纯函数，零依赖；③ 若真要索引 → **SQLite FTS5**（`better-sqlite3` 自带编译，零新包，但需在 novel.db 建虚表 + 同步触发器，触及 §6.5 迁移） → **需先预研**（Q13） |
| 长文本分块 | `langchain` / `llamaindex` | ❌ 禁止（体积与依赖树都失控） | `shared/ai/context/chunker.ts` 纯函数（按段落滑窗 + 重叠 + 合并去重），单测覆盖 |
| 长任务不卡 UI | `comlink` / `workerpool` | ❌ 不需要 | Vite 原生 `?worker` 导入（零依赖）；或分片 + `await` 让出 |
| 流式 | — | ✅ 零新增 | Electron `protocol.handle` + `net.fetch`（项目已用，见 `ai-architecture-decision.md` 五·A） |
| 导出诊断包 | — | ✅ 零新增 | 主进程 `dialog.showSaveDialog` + `fs`（`memo-handlers` / `novel-export-handlers` 已有先例，但**需新建 AI 域自己的通道**，不得复用） |

**排序/差异/编辑距离**（10a 需要）：`novel-utils.ts` / 自研纯函数即可，不引 `fastest-levenshtein`（若引，必须放 devDependencies 且走渲染层）。

> ⚠️ 一条纪律建议：在 `electron/packaging-guard.test.ts` 里补一条断言或注释，明确「AI 相关功能**不得**以任何理由扩充 production dependencies」——这类欠债的特点是「加了当时不报错，三个月后 asar 从 40MB 变 200MB 才发现」。

---

## 七、版本切分

> ⚠️ **先读 D11**：按 §8.6，本路线图每一阶段都含新表/新 IPC，因此**每一阶段都必须占一个次版本号**。「2.7.x」在产品节奏文档里可以这么写，落到 `CHANGELOG.md` + `package.json` 时必须是 2.7.0 / 2.8.0 / 2.9.0 / 2.10.0 …

### 阶段一 · 2.7.0 —— 「让 AI 高频化，并且看得见」

**功能集合**：M1（事件回流）+ M8（可用性门控）+ M3（输出契约，text 分支）+ **R-AI-06a**（文本变换模板）+ R-AI-05 看板 UI

**新增/修改文件清单**：

| 文件 | 动作 |
|---|---|
| `src/shared/ai/ai-types.ts` | 改：`AiGenerateRequest` 加 `intent` / `outputFormat` / `count`；`AiGenerateData.items` 结构扩展 |
| `src/shared/ai/ai-client.ts` | 改：`aiGenerate` 透传 intent/outputFormat；新增 `listAiLogs` / `clearAiLogs` / `logAiEvent` / `exportAiDiagnostics` |
| `src/shared/ai/ai-context.ts` | 改：新增 `buildTransformPrompt({ kind, text })`（5 种变换） |
| `src/shared/ai/ai-events.ts` | 新增：intent / step 枚举、保留上限常量、事件载荷类型 |
| `src/shared/ai/ai-events.test.ts` | 新增 |
| `src/shared/ai/ai-estimate.ts` + `ai-estimate.test.ts` | 新增：token/费用估算纯函数 |
| `src/shared/ai/hooks/useAiAvailability.ts` + `.test.ts` | 新增（M8） |
| `src/shared/ai/ai-boundary-guard.test.ts` | 新增：`shared/ai/**` 不得 import novel / windows / services |
| `electron/ai-domain-guard.test.ts` | 新增：ai-handlers 只 import `../ai-db`；不出现硬编码 intent；事件写入带清理 |
| `electron/ai-db.ts` | 改：新增 `ai_event` 表 + 2 个索引 + 滚动清理；`ai_log` 补 30 天清理 |
| `electron/handlers/ai-handlers.ts` | 改：intent 取自请求（3 处硬编码）；新增 `ai-event-log` / `ai-event-stats` / `ai-export-diagnostics` |
| `electron/preload.ts` | 改：3 个新通道白名单 |
| `src/shared/types/electron.d.ts` | 改：4 个新 API 签名 |
| `src/windows/SettingsWindow/components/AISection/components/UsagePanel/index.tsx` + `index.scss` | 新增：用量与效果子页（复用 2.6.0 的四段组织风格） |
| `src/windows/SettingsWindow/components/AISection/index.tsx` | 改：挂载子页 + 导出诊断包按钮 |
| `src/windows/NovelWindow/pages/NovelPage/components/PolishPreview/index.tsx` + `index.scss` + `index.test.tsx` | 改/新增：泛化为可承载变换类型选择器；补「入口可消失」单测 |
| `src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts` | 改：`runTransform(kind)` 编排（与 `runPolish` 并列） |
| `src/windows/NovelWindow/pages/NovelPage/NovelPage.tsx` | 改：浮层 props 接线 |
| `CHANGELOG.md` / `package.json` | 改：2.7.0 |

**本阶段结束时的可验证状态**：
1. `pnpm test` 全绿，且新增 4 个守卫 / 单测文件；
2. 配置 AI 后，设置窗口「AI 配置 → 用量与效果」能看到「本月 N 次 · 各功能分布 · 采纳率 · 平均耗时」，且**能区分起名与润色**（`intent` 生效）；
3. 编辑器选中文本 → 浮动工具栏出现「扩写 / 精简 / 改写 / 换语气 / 转视角」→ 预览 → 确认替换；**未配置 AI 时该分组不出现**（M8 生效）；
4. 一键导出诊断包，包内**不含任何正文与作品名**（字段白名单单测）；
5. `pnpm analyze:asar` 分区数据与 2.6.0 持平（production dependencies 仍为 4 个）。

---

### 阶段二 · 2.8.0 —— 「让 AI 懂这本书（上）：上下文与续写」

**功能集合**：M2（上下文装配）+ M3（json-array 分支）+ M7（prompt 版本）+ `work.genre` 字段 + **R-AI-07（非流式版）**

| 文件 | 动作 |
|---|---|
| `src/shared/ai/context/types.ts` | 新增：`BookSnapshot` / `AiBookContext` / `PromptSpec`（**结构类型，不 import novel**） |
| `src/shared/ai/context/collector.ts` + `.test.ts` | 新增：按 intent 最小化采集 + 截断 |
| `src/shared/ai/context/assembler.ts` + `.test.ts` | 新增：`assembleNamingSpec` / `assemblePolishSpec` / `assembleTransformSpec` / `assembleContinuationStreamSpec`（续写实际落地为流式版，原 `assembleContinuationSpec` 非流式变体已废弃） |
| `src/shared/ai/context/chunker.ts` + `.test.ts` | 新增：长文本分块 |
| `src/shared/ai/context/output-spec.ts` + `.test.ts` | 新增：`OutputFormat` + JSON 指令模板 + 三层保险解析 |
| `src/shared/ai/prompts/registry.ts` + `.test.ts` | 新增（M7）：意图 → 模板 + version |
| `electron/novel-db.ts` | 改：`ALTER TABLE novel_works ADD COLUMN genre`（PRAGMA 判列） |
| `electron/handlers/novel-handlers.ts` | 改：work 增改 DTO 带 `genre` |
| `src/windows/NovelWindow/pages/BookshelfPage/**`（建书/编辑） | 改：题材选择（可跳过，弱兜底文案） |
| `src/windows/NovelWindow/pages/NovelPage/components/ContinuationPreview/index.tsx` + `index.scss` + `index.test.tsx` | 新增：候选列表浮层 |
| `src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts` | 改：`runContinuation` 编排 + `insertText` 落地 |
| `src/windows/NovelWindow/pages/NovelPage/NovelPage.tsx` | 改：入口接线 |
| `src/shared/types/electron.d.ts` / `electron/preload.ts` | 改：genre 相关 DTO |
| `CHANGELOG.md` / `package.json` | 改：2.8.0 |

**可验证状态**：① 起名/润色/变换的 prompt **自动带上书名 + 题材 + 命中人物卡**（collector 单测 + 日志里能看到注入内容）；② 光标处续写出 2–3 个候选，确认后插入，失败不动原文；③ 弱模型返回不规范 JSON 时走三层保险兜底而非白屏（output-spec 单测）；④ 建书时可选题材且可跳过。

---

### 阶段三 · 2.9.0 / 2.10.0 —— 「趟出 L3 基建 + 流式」

**2.9.0 功能集合**：M5（L3 授权 + 范围选择器）+ M6（AI 落地通道）+ **R-AI-09（章节摘要）**

| 文件 | 动作 |
|---|---|
| `src/shared/ai/ai-consent.ts` + `.test.ts` | 新增：L1/L2/L3 分级常量、范围枚举、估算文案 |
| `src/shared/components/AiConsentDialog/index.tsx` + `index.scss` | 新增（antd Modal；放 shared 是因为会被 ≥2 个面板复用） |
| `src/shared/hooks/useAiConsent.ts` + `.test.ts` | 新增：总开关（复用 `ai_config` KV，**零新表零新 IPC**）+ 本次范围 |
| `src/shared/ai/ai-provenance.ts` + `.test.ts` | 新增（M6）：来源标记构造器 + 可撤销记录 + 占比统计口径 |
| `electron/novel-db.ts` | 改：`novel_chapters` 加 `ai_summary` / `ai_summary_at` / `ai_summary_model` 三列 + 可选索引 |
| `electron/handlers/novel-handlers.ts` | 改：新增 `novel-chapter-summary-save` |
| `electron/preload.ts` / `src/shared/types/electron.d.ts` | 改：新通道 |
| `src/windows/NovelWindow/pages/NovelPage/components/ChapterTree/**` | 改：右键「生成本章摘要」入口（受 M8 门控） |
| `src/windows/NovelWindow/pages/NovelPage/components/SummaryDrawer/index.tsx` + `index.scss` | 新增（参照 `SnapshotDrawer` 范式） |
| `src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts` | 改：`runChapterSummary` |
| `CHANGELOG.md` / `package.json` | 改：2.9.0 |

**2.10.0 功能集合**：M4（流式）+ R-AI-07 升级为流式版

| 文件 | 动作 |
|---|---|
| `electron/ai-stream.ts` | 新增：`protocol.handle` 流式端点（`net.fetch` SSE → `ReadableStream`），与 `app-protocol-cache.ts` 的协议实践对齐 |
| `electron/ai-stream-guard.test.ts` | 新增：端点 URL 不含 Key；注册时机在 `app.whenReady` 之前；中断可撤销端点 |
| `electron/main.ts` | 改：注册 `protocol.handle`（**在 ready 之前**） |
| `electron/handlers/ai-handlers.ts` | 改：`ai-generate-stream` 返回一次性端点地址；IPC 兜底分支 |
| `src/shared/ai/ai-client.ts` | 改：`aiGenerateStream(request, onChunk, signal)` |
| `electron/preload.ts` / `src/shared/types/electron.d.ts` | 改 |
| `ContinuationPreview` | 改：流式渲染 + 中断按钮 |
| `docs/archive/prd-ai/ai-architecture-decision.md` | 改：五·A 追加「流式端点」的豁免边界说明（**红线 D 的文档同步**） |
| `CHANGELOG.md` / `package.json` | 改：2.10.0 |

**可验证状态**：① 首次触发 L3 功能弹出授权弹窗，展示将发送字数与范围选择，关掉总开关后所有 L3 入口隐藏且**给出原因**；② 章节摘要生成后带「AI 生成」标记与模型名，删章后摘要不残留；③ 续写流式逐字输出，可中断，中断后主进程连接被释放（守卫断言）。

---

### 阶段四 · 2.11.0 / 2.12.0 —— 「沉淀资产与差异化」

**2.11.0 功能集合**：**R-AI-08**（实体抽取建卡）+ **R-AI-10a**（纯本地一致性校对）

| 文件 | 动作 |
|---|---|
| `src/shared/ai/prompts/registry.ts` | 改：`assembleExtractSpec` |
| `src/windows/NovelWindow/pages/NovelPage/components/EntityExtractPanel/index.tsx` + `index.scss` + `index.test.tsx` | 新增：候选列表（类型/置信度/出处句/重名标注）+ 勾选确认 |
| `src/windows/NovelWindow/pages/NovelPage/utils/dedupe-entities.ts` + `.test.ts` | 新增：与已有卡去重（别名/同音/空白归一） |
| `electron/handlers/novel-handlers.ts` | 改：新增 `novel-entities-save-batch`（**单事务**） |
| `electron/preload.ts` / `src/shared/types/electron.d.ts` | 改 |
| `src/windows/NovelWindow/pages/NovelPage/utils/consistency-local.ts` + `.test.ts` | 新增（10a）：人名/别名近似匹配 + 境界别名归并，纯函数 |
| `src/windows/NovelWindow/pages/NovelPage/components/ConsistencyPanel/index.tsx` + `index.scss` + `index.test.tsx` | 新增：问题列表 + 跳转定位 + 忽略记忆 |
| `src/windows/NovelWindow/pages/NovelPage/workers/consistency.worker.ts` | 条件新增（取决于 Q12） |
| `electron/novel-db.ts` | 改（若需 `source` 列）：`ALTER TABLE novel_entities ADD COLUMN source` |
| `CHANGELOG.md` / `package.json` | 改：2.11.0 |

**2.12.0 功能集合**：**R-AI-10b**（AI 校对）+ **R-AI-11**（卡文救援）+ **R-AI-15**（关系建议）

| 文件 | 动作 |
|---|---|
| `src/shared/ai/prompts/registry.ts` | 改：`assembleConsistencySpec` / `assembleBranchSpec` / `assembleRelationSpec` |
| `src/shared/components/AiCandidateList/index.tsx` + `index.scss` + `.test.tsx` | 新增：抽出 08/10b/11/15 共用的「候选 + 证据 + 勾选」形态 |
| `src/windows/NovelWindow/pages/NovelPage/components/ConsistencyPanel/**` | 改：接 AI 档 |
| `src/windows/NovelWindow/pages/NovelPage/components/OutlinePanel/index.tsx` | 改：分支建议入口（M8 门控） |
| `src/windows/NovelWindow/pages/NovelPage/components/InspirationPanel/index.tsx` | 改：「卡文急救」入口 + 存为灵感速记 |
| `src/windows/RelationWindow/components/RelationSuggestDrawer/index.tsx` + `index.scss` + `.test.tsx` | 新增（15） |
| `src/windows/RelationWindow/hooks/useGraphCommit.ts` | **不改逻辑**，仅被复用（禁止新增 `novel-link-add-batch`） |
| `electron/novel-graph-commit-guard.test.ts` | 改：追加「批量建边仍在单事务 + 仍走 broadcastLinksChanged」断言 |
| `CHANGELOG.md` / `package.json` | 改：2.12.0 |

**可验证状态**：① 一章抽取出的候选需**人工勾选**才入库，重名项明确标注（源码守卫断言不存在自动入库分支）；② 10a 在**完全不配置 AI** 的情况下也能查出人名不一致（这是它作为首版本体的证明）；③ 关系建议写入后图与库一致、其它窗口收到 `novel-links-changed`；④ 一致性与关系建议的候选都走同一个 `AiCandidateList`。

---

### 阶段五 · 3.0.0 —— 「扩面与深耕（视数据决定）」

**功能集合**：R-AI-12（创作日报）/ R-AI-13（起名 v2）/ R-AI-14（卡片补全）/ R-AI-16a+16b（checkin 域）/ R-AI-17（条件触发）

| 文件 | 动作 |
|---|---|
| `electron/handlers/novel-handlers.ts` | 改：新增 `novel-usage-range`（区间聚合） |
| `src/windows/BaseWindow/pages/HomePage/components/WeeklyReportCard/**` | 新增（12）；**不得 import 任何 NovelWindow 内容** |
| `src/windows/NovelWindow/pages/NovelPage/components/NameGeneratorPanel/index.tsx` | 改（13）：体系化模式 |
| `src/shared/components/CharacterPack/components/**` | 改（14）：AI 补全按钮；**必须过 `pack-ui-kit.test.ts`** |
| `electron/main.ts` | 改（16b）：放开 `EDITION !== "lite"` 门控（L1123–1125） |
| `src/windows/SettingsWindow/App.tsx` | 改（16b）：`SHOW_AI` 放开（L57） |
| `electron/ai-db.ts` 文件头注释 | 改（16b）：同步 edition 说明（否则留下会骗人的注释） |
| `electron/handlers/ledger-handlers.ts` + `LedgerPage` | 改（16a 先做）：本地关键词分类建议 |
| `src/windows/NovelWindow/pages/NovelPage/components/SupportPanel/components/AiAskBar/**` | 新增（17，条件）：就地问答条 + 复用 `searchAcrossBook` 召回 |
| `CHANGELOG.md` / `package.json` | 改：3.0.0 |

**本阶段的准入条件（重要）**：R-AI-13 **必须**先看过 R-AI-05 跑满一个版本周期的起名触发量/采纳率；R-AI-17 **必须**先验证本地召回在真实长篇上的命中率。**不达标就砍，不要因为排期空着就填进去。**

---

## 八、待明确事项

### 8.1 沿用 PRD §十 的裁决（架构侧补充意见）

| # | PRD 问题 | 架构侧意见 |
|---|---|---|
| 1 | 数据回流形态（本地看板 / +opt-in 导出 / 预留上报） | 建议 **②本地看板 + 主动导出**。补充：无论选哪个，`intent` 契约 + `ai_event` 表**都必须先建**；若考虑未来上报，现在只需在 `ai_event` 里留一个可空的 `reported_at` 列（向前兼容、零成本），**不要**现在就建上报通道 |
| 2 | 是否接受「AI 参与占比」对用户可见 | 建议**后置**。架构侧前提：只有 M6 的来源标记落地后，占比才不是估算。先有标记，再谈展示 |
| 3 | 续写默认输出长度上限 | 建议做成 `ai_config` 里的**高级参数**（不硬编码），默认 600 字；设置项与 `ai-estimate` 的估算联动 |
| 4 | 章节摘要存储落点 | **架构已定**：`novel_chapters` 加三列（理由见 §5.2）。仍需产品确认的是：**是否允许用户手工编辑摘要**（若允许，手工编辑后应把 `ai_summary_model` 置空以区分来源） |
| 5 | L3 默认授权范围 | 建议默认「仅选中 / 仅本章」，**不提供「全书」档**（成本与隐私都不可控）；R-AI-10 / R-AI-17 走「本地召回 → 只送片段」，本来也不需要全书档 |
| 6 | 是否补 `work.genre` | **建议补，且提前到 2.8.0**（见 D8） |
| 7 | checkin 域是否放开 edition | 建议**先做 16a 本地规则版（S）**，16b（放开 edition）等 lite 用户规模依据 |
| 8 | R-AI-17 触发阈值 | 建议改为「10a 的本地召回 + 模型总结链路在真实长篇上验证可用」，取代不可校准的渗透率阈值（见 D7） |
| 9 | 起名是否加「寓意」字段 | 建议**关闭此项**（`ai-context-and-output-spec.md` 已拍板首版即上 JSON + 寓意，该项已被吸收） |
| 10 | 是否突破起名 6/10/12 数量档 | 建议并入 R-AI-13 一并决策，v1 不动 |
| 11 | ai.db 是否随 edition 开关 | 与 #7 联动；当前 `EDITION !== "lite"` 保持不变，直到 16b 立项 |

### 8.2 架构侧新增的待拍板 / 待预研

| # | 问题 | 为什么必须拍板 | 建议 |
|---|---|---|---|
| **Q12** | **长任务（全书校对 / 批量摘要）是否引入 Web Worker？** | `searchAcrossBook` 是**同步全量扫描**（源码注释已警告会卡输入法）。直接跑必然卡 UI，搬到主进程又会让小说正文经 IPC 全量往返 | 二选一：① Web Worker（Vite `?worker`，零新依赖，但 vitest jsdom 无 Worker，需补测试策略）；② 分片 + `await` 让出（改动小、仍可能掉帧）。建议先做一次半日预研对比 |
| **Q13** | **是否允许为语义检索引入 SQLite FTS5？** | 这是「要不要真的建本地索引」的岔路口。FTS5 零新包（`better-sqlite3` 自带编译），但要在 novel.db 建 FTS5 虚表 + 同步触发器，触及 §6.5 迁移与 novel-safety 的清库逻辑 | **先做 1 天预研**：① 确认 `better-sqlite3` 的构建确已开启 `SQLITE_ENABLE_FTS5`（实测一条 `CREATE VIRTUAL TABLE ... USING fts5`）；② 确认中文分词需 `unicode61` + 自行分词的代价；③ 评估与「模板重置 / 回收站」的交互。预研通过前，R-AI-17 只走内存召回 |
| **Q14** | **是否接受 `ai_log` 与 `ai_event` 双表并存？** | 影响导出包内容、合规口径与磁盘占用 | 建议**并存且严格分工**（见 §5.3）。若不接受，替代方案是「`ai_log` 拆成元数据表 + 正文表」，但改造量更大且要动既有代码 |
| **Q15** | **AI 产出的「可撤销」粒度是什么？** | 文本类（06/07）可复用编辑器 undo；**结构化类（08/15 建卡建边）没有 undo 栈**，撤销要怎么给？ | 建议：结构化产出在落地时记录「来源 = ai + 批次 id」，提供**按批次**一键删除（M6 的一部分），而不是通用 undo。需产品确认交互 |
| **Q16** | **AI 功能的 UI 落在哪个窗口？** | 用量看板（R-AI-05）与创作日报（R-AI-12）都涉及设置窗口 / 主窗口 / 小说窗口的归属，牵动 §2.2.0 窗口隔离与 edition 清单 | 建议：用量看板 → SettingsWindow AI 配置页（已定）；创作日报 → 若仅 novel 域则放 SupportPanel，**若要做 checkin 联动才进 HomePage**，且必须经 IPC |

### 8.3 需要修订的既有文档（本次未改，列出清单）

| 文档 | 需修订内容 |
|---|---|
| `docs/prd/prd-ai-roadmap/ai-future-directions-prd.md` | §十一 第 5 行「R-AI-08/10/15 依赖 collector/assembler/json-array 输出契约（**已落地，直接复用**）」→ 改为「**待建，见元能力 M3**」；§六 横向表的成本列按本文重排 |
| `docs/archive/prd-ai/ai-context-and-output-spec.md` | 文首状态「已评审（待动工）」建议保留，但补一行「截至 2.6.0 **未动工**，本文件是施工图」 |
| `docs/archive/prd-ai/ai-architecture-decision.md` | 五·A 追加「流式端点（`protocol.handle`）」的豁免边界（2.10.0 时）；§七 RK-01 的流式方案状态从「预研」改为「未实现」 |
| `AGENTS.md` | 见 §九 |
| `docs/README.md` | 按 §8.8 补本文索引行（**本次未改**，因复核任务限定「只产出文档」） |

---

## 九、对 `AGENTS.md` 的增补建议（本次未改，供责任人执行）

建议在 `AGENTS.md` §2.2.2.1「AI 服务层铁律」下追加 5 条，并在 §8 检查清单里加一条「新增 AI 功能」：

1. **AI 上下文加工层与 prompt 模板层**：`src/shared/ai/context/`（collector / assembler / chunker / output-spec）与 `src/shared/ai/prompts/`（registry + version）是 AI 服务层的组成部分，同样**不得 import novel 任何模块**；`BookSnapshot` 必须是 AI 层自声明的**结构类型**，不得 `import type` novel 的实体类型。
2. **AI 事件的双表分工**：`ai_log` 只服务排障（含正文截断，30 天），`ai_event` 只服务度量（纯元数据，5000 条 / 90 天）。**AI 事件一律落 ai.db，不得写入 `novel_usage_log`**（域边界）。
3. **L1 / L2 / L3 数据分级与 L3 授权**：承接 PRD §五，作为所有 AI 功能的通用约束；L3 功能必须走统一授权组件与范围选择器。
4. **AI 入口可消失**：AI 不可用时，入口必须隐藏 / 禁用并说明原因 / 有本地兜底，**禁止「点了没反应」与「空聊天框」**。
5. **AI 产出必须沉淀，且必须可溯源可撤销**：结构化 AI 产出（名字/要素卡/摘要/关系边/大纲节点）必须提供「存入用户库」的出口，并带来源标记（模型 + 时间 + 批次）。
6. **AI 功能不得扩充 production dependencies**：token 估算、分块、检索、排序一律自研纯函数；**禁止向量库 / embedding / 分词器进入 `dependencies`**。
7. **§8 新增检查清单「新增 AI 功能」**：intent 是否登记进 `ai-events.ts` 的枚举 / 是否接 M8 门控 / 输出是否声明 `OutputFormat` / 结构化产出是否有来源标记 / L3 是否走统一授权 / 是否新增了 production 依赖 / 是否同步 `ai-architecture-decision.md` 的豁免边界。

---

## 十、一句话总结

> **这份路线图最大的问题不是「功能选得对不对」，而是「成本被系统性低估了一档」** —— 低估的根源是三份文档把「已评审」当成了「已落地」（collector / output-spec / genre / intent 契约 / 流式，五项全部为零）。
> 补上 M1（intent 契约 + 事件表）与 M3（输出契约）这两笔欠债之后，**09 与 10a 会变成全表性价比最高的两项**，而原本被放在 2.8.0 首位的 08 应该退到阶段四 —— 这是本次重排与产品经理最大的两处分歧。

---

> 本方案为产品设计参考，具体实施请结合公司合规与法务要求确认。
