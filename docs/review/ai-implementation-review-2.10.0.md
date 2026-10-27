# AI 模块落地代码评审（基线 2.10.0）

> 评审对象：`src/shared/ai/**`、`electron/ai-db.ts`、`electron/handlers/ai-handlers.ts`
> 与全部 AI 消费方（NovelPage / SettingsWindow）
> 对照基准：`docs/prd/prd-ai-roadmap/ai-roadmap-batch-plan.md`（排期与完成判据）、
> `CHANGELOG.md` 2.6.0–2.10.0（宣称已交付）、`AGENTS.md`（架构纪律）
> 方法：源码通读 + 交叉 grep 验证「宣称 vs 实际」+ 跑全量 AI 单测 + `pnpm typecheck`

---

## 一、总体结论

**架构底盘是扎实的，度量与合规闭环是断的。**

- ✅ **纯函数层质量高**：`shared/ai/` 分层干净（client / context / prompt / hooks 各司其职），
  103 个单测全绿，`pnpm typecheck` 通过，架构守卫（域边界、PII 白名单、日志级别）齐全。
  AGENTS.md §2.2.2.1 的「主进程不感知业务结构」、§8.7 的 HTTP 豁免边界都守住了。
- ⚠️ **CHANGELOG 与排期文档对「完成度」的描述偏乐观**：本次评审在已标记 ✅ 的批次里
  发现 **3 项判据实际未达成**，另有 **5 项「代码写了但没人调用」的空转实现**。
- 🔴 **最严重的一条**：`ai_event` 只落了主进程看得见的 `trigger / success / fallback`，
  渲染层该回传的 `adopt / edit / cancel` **一次都没上报** → 看板「采纳率」恒为 0，
  而 B8 批次的准入条件（12/13 必须看采纳率）因此**永远无法满足**——
  整个「数据驱动排期」的设计前提落空。

**一句话**：B1 号称「让 AI 看得见」，实际只做到了「看得见调用」，没做到「看得见效果」。

---

## 二、落地对照矩阵

| 编号 | 排期文档口径 | CHANGELOG 口径 | 代码实际 | 判定 |
|---|---|---|---|---|
| M2 上下文装配 | ✅ 已交付 | 2.7.0 | `collector.ts` 5 个 intent 各有采集上限 | ✅ 属实 |
| M3 输出契约 | ✅ 已交付 | 2.7.0 | `output-spec.ts` 三层保险，19 用例 | ✅ 属实 |
| prompt 单一产地 | ✅ | 2.8.0 | `PROMPT_BUILDERS` 5 个意图，24 用例守卫 | ✅ 属实 |
| M1a `ai_event` 表 | ✅ 已交付 | 2.9.0 | 表与索引齐备；**但 `adopt` 类事件零上报** | ⚠️ 半交付 |
| M7 prompt 版本 | ✅ | 2.9.0 | `PROMPT_VERSIONS` + 增量迁移 + 落库 | ✅ 属实 |
| M8 可用性门控 | ✅ 已交付 | 2.9.0 | `useAiAvailability` **零消费者** | ⚠️ 半交付 |
| M1b 用量看板 | ✅ | 2.9.0 | 看板与诊断包齐备；**采纳率恒 0** | ⚠️ 半交付 |
| R-AI-06 文本变换 | ✅ | 2.9.1 | 5 种变换 + 意图子类型落库 | ✅ 属实 |
| R-AI-07 就地续写 | ✅ | 2.9.2 | 非流式候选浮层，走 `insertText` | ✅ 属实 |
| R-AI-09 章节摘要 | ✅ | 2.10.0 | 三列 + PRAGMA 迁移 + 守卫 | ✅ 属实 |
| M5 L3 授权 | ⚠️ 判据②未完成 | 2.10.0 | 常量/弹窗/估算/`l3_enabled` 齐；**设置页无开关** | ⚠️ 缺口确认 |
| M6 AI 溯源 | ✅（撤销待定） | 2.10.0 | `ai-provenance.ts` **全文件零消费者** | ⚠️ 半交付 |
| M4 流式 | 🔜 B5 | — | `stream:false` 硬编码两处，无流式端点 | ❌ 未开始 |

---

## 三、已实现且值得保持的部分

1. **prompt 单一产地**：`PROMPT_BUILDERS` + `prompt.test.ts` 遍历校验
   （漏 `outputFormat`、system 为空、意图漏登记直接红）。新增功能确实只需「写一个模板 + 登记一行」。
2. **输出解析三层保险**：`output-spec.ts` 的逐条 `{…}` 抢救（2.8.1 事故修复）设计正确，
   19 个用例覆盖了 `]` 误写、末尾截断、键名漏引号。
3. **域边界与合规硬约束**：`ai-domain-guard` 钉住「`ai_event` 不落正文/作品名/邮箱」、
   「AI 事件不进 `novel_usage_log`」、「写入静默失败不阻塞主链路」，且是源码断言，防回退。
4. **Key 安全**：`safeStorage` 加密落库、`hasApiKey` 布尔回流、渲染层永不接触明文。
5. **零新增 production 依赖**：`ai-estimate.ts` 自研 token 估算（中文×1.5 + 英文词×1.3），
   符合排期纪律 2。

---

## 四、差距清单（按严重度）

### G1 · [P0] 采纳 / 放弃事件从未上报 —— 度量闭环断在最后一公里

- **现象**：`logAiEvent()` 在 `ai-client.ts:112` 导出，`ai-event-log` 通道在主进程
  （`ai-handlers.ts:833`）完整实现（含 step 白名单校验），但**整个渲染层没有任何一处调用它**。
- **证据**：`grep -rn "logAiEvent" src/` 只命中 `ai-client.ts` 的定义本身。
  主进程侧 `writeEvent` 只产出 `trigger / success / fallback`（`ai-handlers.ts:418–486`），
  `adopt / edit / cancel` 三步无来源。
- **影响**：
  1. B1 判据②「起名 → 插入正文 落一条 `adopt`，采纳率因此可算」**未达成**；
  2. 看板「采纳率」恒为 0（`UsagePanel` 注释已自认：「若还没接采纳上报的功能，采纳率会显示为 0」）；
  3. B8 准入条件（R-AI-12 需 `ai_event` 跑满周期、R-AI-13 需先看采纳率）**永远不满足**，
     数据驱动排期失去依据；
  4. `ai_event.scope` 字段同样恒空，「授权拒绝率」无法统计。
- **建议**：这是**全表性价比最高的欠账**——通道已就绪，只差在 5 个确认/取消回调里补一行：
  起名插入正文、`handlePolishConfirm`、`handleContinuationConfirm`、`handleSummaryClose`、
  各浮层的「取消 / 关闭」。建议抽一个 `reportAiAdopt(intent, itemCount?)` 薄封装，
  并在守卫里源码断言「渲染层存在 `step: "adopt"` 的上报调用」。

### G2 · [P0] M8 门控 hook 零消费者 —— 「入口可消失」纪律未落地

- **现象**：`useAiAvailability` / `deriveAvailability` 只有自己的单测引用，
  起名 / 润色 / 变换 / 续写 / 摘要 / AI 记录**六个入口一个都没接**。
- **证据**：`grep -rn "useAiAvailability" src/` 仅命中 `hooks/useAiAvailability.ts`
  与其测试文件。
- **影响**：
  1. B1 判据③「未配置 AI 时三处入口隐藏 / 禁用并说明原因」**未达成**；
  2. 起名只能靠「请求失败后降级本地引擎 + 显示去设置」（`NameGeneratorPanel:259`），
     属于**事后补救**而非事前门控；润色 / 变换 / 续写 / 摘要连补救都没有，
     直接走 `not_configured` 错误路径；
  3. 每次误触发都写一条 `fallback` 事件，**污染 M1b 的失败率统计**——
     未配置被当成「调用失败」计入分母。
- **建议**：浮动工具栏 / 续写按钮 / 摘要闪电按钮 / AI 记录页统一接 `useAiAvailability`，
  `available === false` 时隐藏或禁用并挂 `reasonText`（文案已内置 5 种）。
  同时考虑：未配置导致的失败应落 `step:"fallback"` 但标记 `errorCode:"not_configured"`，
  让看板能把「没配置」与「调不通」分开统计。

### G3 · [P0] L3 总开关 Switch 缺失（已记录缺口，本次确认）

- **现象**：排期文档 §2.2 已标为缺口，代码侧确认属实且**比文档描述更严重**。
- **证据**：`AISection/index.tsx` 的 `draft` 状态（`:68–84`）**根本没有 `l3Enabled` 字段**，
  `useEffect` 回读（`:87–99`）也不映射 `config.l3Enabled`，`handleSave`（`:211`）不提交它。
  即：不只「没画开关」，而是整条读写链路都不存在该字段。
- **影响**：`l3_enabled` 一旦被首次弹窗置为 `"1"`（`useAiConsent.enableL3` → `saveAiConfig`），
  用户**在任何界面都无法关回去**。排期文档「可撤销承诺」无法兑现。
- **建议**：三步——① `draft` 加 `l3Enabled` 并在回读 useEffect 里映射；② `isDirty` 逐字段比较
  补上该字段（否则改了开关不点亮保存）；③ 在「高级」卡片加一个受 `draft.l3Enabled`
  绑定的 Switch，文案复用 `DATA_LEVEL_LABELS.L3`。可顺带把 `COMPLIANCE_NOTICE` 挂到它下面。

### G4 · [P1] L3 范围选择器是装饰品 —— 承诺与实现不一致

- **现象**：弹窗提供「仅本章 / 选中段落 / 最近 3 章」三档（`AiConsentDialog:76–88`），
  选中的值只写进 `useAiConsent` 的 `useState`（`useAiConsent.ts:23`），**流向到此为止**。
- **证据**：`handleSummaryConsentConfirm` → `doGenerateSummary(chapterId, chapterTitle)`
  不带 scope；`doGenerateSummary` 恒发 `chapter.content`（整章），
  `estimateText(chapter.content)` 也恒按整章估算。
- **影响**（需精确界定）：默认档是「仅本章」且实际只发本章，**不存在超发数据**；
  真实问题是「控件点了没效果 + 弹窗承诺了实现不支持的能力」，属交互诚实性问题，
  而非数据泄露。后续 08/10b/15 接入 L3 时若沿用这套 hook，会误以为 scope 已生效。
- **建议**：短期——摘要场景只有单档可用，隐藏选择器（或只留「仅本章」并将另两档标为
  「即将支持」）；长期——把 `scope` 作为 `doGenerateSummary` 的入参，并落进
  `ai_event.scope`（字段已建），让「授权拒绝率」真能算。

### G5 · [P1] M6 `ai-provenance.ts` 是死代码 —— 溯源是空壳

- **现象**：`makeAiProvenance` / `newBatchId` / `summaryModelOf` / `isAiGenerated`
  **零消费者**（除自己的单测）。摘要落库绕过了这一层。
- **证据**：`useNovelPage.ts:1076–1077` 直接 `const model = (await getAiConfig()).model;`
  再 `data.updateChapterSummary(chapterId, text, model)` —— 只写模型名字符串，
  `source` / `at` / `batchId` 三要素里只剩 `model`。
- **影响**：
  1. `batchId` 从未生成 → Q3 拍板的「按批次一键删除」**没有数据基础**；
  2. 「AI 参与占比」无法按批次聚合；
  3. 后续 R-AI-08（要素卡）/ R-AI-15（关系边）是真正的结构化产出，
     届时**没有可复用的溯源构造入口**，会各写一遍——正是 M6 要防的漂移。
- **建议**：二选一，别维持现状——
  ① **接上**：`doGenerateSummary` 里 `const prov = makeAiProvenance(model, Date.now(), newBatchId())`，
  至少把 `batchId` 落进 `ai_summary_model` 或新增一列；
  ② **降级承认**：若本版确实用不到批次撤销，就删掉 `newBatchId` / `makeAiProvenance`
  并在排期文档把 M6 从 ✅ 改为「来源标记已落地，批次撤销待结构化功能首用」。
  维持「有文件、有单测、没人用」的状态最危险——它会让人以为溯源已经做好了。

### G6 · [P1] `item_count` / `parsed_output` 口径污染

- **现象**：成功事件与日志无条件用 `splitNameItems(text)` 计算产出条数
  （`ai-handlers.ts:470–478`），而该函数是**起名专用**的行/顿号切分（`:514`）。
- **影响**：润色 / 变换 / 续写 / 摘要都是 **text 输出**，传入后会被按
  `、，；` 切成若干「条」→ `ai_event.item_count` 与 `ai_log.parsed_output`
  对这四个意图全是**无意义噪声**。看板「产出条数」与未来任何基于 item_count 的分析都会被污染。
- **建议**：按 intent 分流——`naming` 走 `splitNameItems`，其余置 `undefined`
  （结构化条数应由渲染层 `aiGenerateStructured` 回传，主进程本就不该猜）。
  可加一条守卫：断言 `writeEvent("success")` 的 `itemCount` 不来自无条件调用。

### G7 · [P2] 看板意图映射表缺 `summary`，且无单一产地守卫

- **现象**：`UsagePanel/INTENT_LABEL`（`:21–28`）仍是 2.9.x 的六个
  （naming / polish / test / generate / transform / continuation），**没有 `summary`**。
- **影响**：2.10.0 新增的摘要调用在看板上显示为原始英文 `summary`。
  更本质的是——`PROMPT_BUILDERS` 有守卫强制登记，但**消费侧的意图标签表没有**，
  以后每加一个功能就会漂移一次。
- **建议**：把 `INTENT_LABEL` 提为 `shared/ai/` 的单一产地（与 `PROMPT_INTENTS` 同源），
  加守卫断言「`INTENT_LABEL` 覆盖 `PROMPT_INTENTS` 全量」。

### G8 · [P2] 三处小口径问题

| 项 | 现象 | 建议 |
|---|---|---|
| `estimateCost` | 从未被调用（只有自己的单测）。弹窗 `estimate.cost` 可选，
`NovelPage:770` 只传 `chars/tokens` → 「费用约 ¥X」永不显示 | 接上单价常量表，或删掉该函数与弹窗的 cost 分支 |
| `char_count` | `writeEvent("trigger")` 记 `req.prompt.length`（`:418`），
不含装着书本上下文的 system prompt | 明确口径为「用户提示词字数」并改名，或并入 system 长度 |
| `getAiConfig` 二次 IPC | `doGenerateSummary:1076` 为拿模型名又发一次 IPC | 由主进程在生成响应里回带 `model`，省一次往返 |

---

## 五、未实现清单（确认零代码足迹）

以下编号经 grep 确认**没有任何业务代码**，仅在注释中被提及：

| 编号 | 功能 | 状态 |
|---|---|---|
| **M4** | 流式能力 | `stream:false` 硬编码于 `ai-handlers.ts:208/223`；无 `protocol.handle` 流式端点；无 `aiGenerateStream`；无中断 |
| **R-AI-08** | 实体抽取 → 一键建卡 | 无 |
| **R-AI-10a/10b** | 一致性校对（本地档 / AI 档） | 无（仅有 `aliases` 字段与注释里的规划） |
| **R-AI-11** | 卡文救援 · 剧情分支 | 无 |
| **R-AI-12** | 创作日报 / 写作复盘 | 无 |
| **R-AI-13** | 起名增强 v2（体系化） | 无（寓意 + genre 已落地，剩余部分未开工） |
| **R-AI-14** | 卡片字段补全 | 无 |
| **R-AI-15** | 人物关系建议 | 无 |
| **R-AI-16a/16b** | checkin 域 AI（含放开 edition） | 无 |
| **R-AI-17** | 就地问答条 | 无 |

> M4 是**唯一需要新增主进程网络能力**的事项（B5），其余均为纯功能层。

---

## 六、风险点汇总

| 风险 | 等级 | 说明 |
|---|---|---|
| 数据驱动排期失效 | 🔴 高 | 采纳率恒 0 → B8 准入条件不可满足，排期文档 §八的「不达标就砍」失去判据 |
| 合规承诺不可撤销 | 🔴 高 | L3 开启后无法关闭，与「可撤销」承诺直接冲突 |
| 「写了但没接」的空转实现 | 🟡 中 | `ai-provenance` / `estimateCost` / `useAiAvailability` / `logAiEvent` 四个文件
有实现、有单测、无调用方。单测全绿会**掩盖**它们没被使用——
测试覆盖率指标在这里是反向信号 |
| 度量口径污染 | 🟡 中 | G6（item_count 通吃）+ G2（未配置计入失败率）
会让看板数字好看但不可信，比没有看板更危险 |
| 排期文档与代码脱节 | 🟡 中 | 文档标 ✅ 的 M1a/M8/M6 实际半交付。
若不回改文档，后续批次会建立在错误的基线上 |
| 误触发写脏数据 | 🟢 低 | 无门控时每次误点都落 `fallback` 事件并消耗一次真实 HTTP 请求 |

---

## 七、改进建议（按执行次序）

**第一步 · 补齐度量闭环（半天，收益最大）**
1. 在 5 处确认/取消回调接 `logAiEvent({intent, step:"adopt"|"cancel"})` → 解锁 G1。
2. 补守卫：源码断言渲染层存在 adopt 上报调用点。

**第二步 · 兑现合规承诺（半天）**
3. 设置页 AI 分区加 L3 总开关 Switch（含 `draft` 字段 + `isDirty` + 保存链路）→ 解锁 G3。
4. 摘要场景隐藏无效的范围选择器，避免 G4 的假承诺。

**第三步 · 接上门控（1 天）**
5. 六个 AI 入口接 `useAiAvailability`，未配置即隐藏/禁用并说明 → 解锁 G2。
6. 主进程侧区分「未配置」与「调用失败」的事件口径。

**第四步 · 收口溯源与口径（1 天，可与 B5 并行）**
7. M6 二选一处理（接上 batchId / 降级承认）→ 解锁 G5。
8. `item_count` 按 intent 分流 → 解锁 G6。
9. `INTENT_LABEL` 提为单一产地 + 守卫 → 解锁 G7。

**第五步 · 回改文档**
10. 把 M1a / M8 / M6 在 `ai-roadmap-batch-plan.md` §2.1 的状态从 ✅ 改为 ⚠️ 半交付，
    并在 CHANGELOG 后续版本补一轮「补齐」条目。**不要为了文档好看维持错误基线**。

> 排期文档已写明「B5 开工前先补 L3 开关」——建议把 G1（采纳上报）**提到同一优先级**：
> 它比 L3 开关更便宜，且是唯一能阻止「后续功能无法评估」的欠账。

---

## 八、评审签核

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过 |
| AI 相关单测（11 文件 / 103 用例） | ✅ 全绿 |
| 架构守卫（域边界 / PII / 日志级别 / 摘要三列） | ✅ 齐全且有效 |
| 排期判据达成 | ⚠️ B1 判据②③ 未达成、B4 判据② 未达成 |
| 生产依赖增量 | ✅ 零新增 |
| 综合判定 | **架构合格，闭环不合格；建议先补度量与合规两项，再开 B5** |
