# Changelog

> 历史归档：2.0.0 之前的版本已按次版本拆到 `changeLogHistory/`
> （当前归档到 1.46.2，索引见 `changeLogHistory/README.md`）。
> 主文件只保留最近若干个次版本，超过 800 行时按 AGENTS.md §8.6 继续分流。

## [2.10.5] - 2026-10-28

### Fixed

- **AI 续写每次都被自己的端点拒成 403（弹窗里显示一句英文 `Forbidden`）**：
  `ai-stream://` 端点的身份校验读的是请求头 `Origin`，但自定义 scheme 的跨
  scheme fetch **根本不会发送这个头**（实测 `protocol.handle` 收到的只有
  accept / content-type / user-agent；Electron 原生的 `request.initiatorOrigin`
  才有值）。于是 `isTrustedInitiator("")` 恒为 false，打包版（页面 origin 为
  `app://`）的每一次续写都 403；dev 下页面 origin 是 `http://localhost:5173`，
  恰好命中放行分支，所以开发期一直看不出来。主进程日志留痕是那句尾随空值的
  「拒绝非本应用来源的流式请求: 」。
  - **改成一次性令牌**：渲染层每次发起前经 `ai-stream-token` IPC 领一张 32 字节
    随机令牌，随 `x-ai-stream-token` 头下发，端点在路径校验之后核销（命中即删，
    重放无效、60s 过期、未核销数量有上限）。这正是 PRD 红线 C 原本要求的
    「端点带一次性令牌且可失效」，此前只落到 Origin 上。
  - **Origin 彻底退出放行判断**，只留在拒绝日志里作排障线索；守卫
    `ai-stream-guard.test.ts` 补反向断言（源码里不许再出现 `isTrustedInitiator`
    与 `startsWith("app://")`）。
  - **端点常量收口**：scheme / host / path / 令牌头名统一到
    `src/shared/ai/ai-stream-protocol.ts`，主进程与渲染层同源引用，不再靠注释
    「保持一致」。
  - 拒绝时的响应体改成中文（「AI 通道校验失败，请重启应用后重试」），浮层不再
    把英文状态词当错误文案展示。
  - 新增行为单测 `electron/ai-stream-token.test.ts`（单次有效 / 过期 / 伪造 /
    上限淘汰）与 `src/shared/ai/ai-client-stream-token.test.ts`（每次现领令牌、
    非 2xx 文案原样抛出）。

## [2.10.4] - 2026-10-28

### Added

- **帮助中心新增「AI 创作助手」分区（11 条词条）**：AI 相关能力此前只存在于按钮与
  快捷键里，帮助中心（F1）一条都查不到——配置在哪、续写怎么停、摘要的闪电图标
  藏哪、为什么按钮是灰的，全得靠试。现在按「配置 → 用法 → 隐私与记录」排列：
  配置 AI 服务 / 本地模型 / AI 起名 / 润色选中段落 / 文本变换 / AI 续写 /
  章节摘要 / 整章内容授权 / AI 记录 / 用量与效果 / AI 不可用。
- **AI 相关 FAQ 补 4 条**：按钮灰了怎么办、内容传到哪（含「本地 Ollama 不出本机」）、
  点闪电图标会不会重复扣费、AI 起名失败为什么还给一批名字。
- **维护契约（防回退）**：`guide-doc.test.ts` 遍历 `AI_INTENT_LABELS`（AI 能力的
  单一产地）要求每个意图在手册里都有可检索词条，另校验词条名全局唯一、每条都能
  被搜索命中、词条名不超过 8 字（索引列定宽 96px）。新增 AI 功能只在代码里落地、
  不写手册，测试直接红。

### Changed

- `AGENTS.md` 新增 §8.9「新增用户可见功能（帮助手册同步，强制）」：词条要用用户会搜
  的说法、入口或文案变了要同步改词条、新窗口没挂 `HelpCenter` 就先挂上。
- 「工具」词条补上「可选 AI 起名」，指向新分区。

## [2.10.3] - 2026-10-28

### Added

- **续写复用「上一章摘要」**（R-AI-09 的第二消费方）：摘要此前只给作者看——点 ⚡
  弹一次浮层，然后躺在 `novel_chapters.ai_summary` 里没有第二个消费方。断更回来
  在新章开头续写时，模型只拿到「光标前 1000 字」，而那里几乎是空的，于是会把已死
  的角色写活、把上一章刚揭穿的秘密再当悬念讲一遍。现在续写模板多一段
  【上一章摘要】，与「已经发生、不得矛盾、不要复述」的约束。
  - **按需注入**：仅当前文短于 `CONTINUATION_SUMMARY_MIN_BEFORE_CHARS`（300 字）
    时才带摘要。连续写作时光标前就是上一段的剧情，摘要不但冗余还会与前文打架。
  - **阈值只有一个产地**：调用方只管「有就传」，丢弃判断留在模板层，
    避免每个入口各配一套口径。
  - **降级安全**：摘要为空 / 上一章不存在（当前是第一章）/ 连写多章未生成摘要，
    都静默省略该段，不产出空的【上一章摘要】残段。

### Changed

- `continuation` 模板 v1 → **v2**（历史 AI 记录里可区分「带摘要」与「不带摘要」的分界）。
- `runContinuation` 取上一章的方式与摘要 / 目录同源：按 `data.groups`（卷序 + 卷内
  章序）扁平化后取前一位，不用扁平 `chapters`——后者不带卷序，会跨卷错位。
- 新增守卫 `useNovelPage-continuation-summary-guard.test.ts`（5 条：取 `aiSummary` →
  下发模板 → 阈值不许复制到调用方 → 卷序取章 → 不拿 `outlineNote` 冒充摘要），
  `prompt.test.ts` 增 3 条（注入 / 前文长则丢弃 / 空摘要静默省略）。

## [2.10.2] - 2026-10-28

### Fixed

- **「查看 AI 摘要」不再偷偷重新生成**：章节行图标在已有摘要时文案是「查看 AI 摘要」，
  实际却无条件发起一次新的 AI 调用——扣一次 token、覆盖原有摘要，还会把刚回填的
  一句话梗概再改一遍。现在 `runChapterSummary(chapterId, force = false)`：已有摘要
  只展示已存内容（本地读库，连 AI 可用性门控都不看，AI 停用了也能翻旧摘要）；
  浮层里的「重新生成」是唯一的 `force = true` 入口。

### Added

- **章节摘要的「大纲回流」**：AI 摘要与大纲板每章的「一句话梗概」本是同一个信息位
  （`ai_summary` vs `outline_note`），却长期各写一份——摘要只在左栏 ⚡ 浮层里，
  回到大纲 tab 仍是空白虚线框，作者得自己再写一遍。现在摘要模板一次产出两段
  （`【一句话】` + `【摘要】`，由 `parseSummaryReply` 拆分）：一句话回填
  `novel_chapters.outline_note`，长摘要仍落 `ai_summary`，两个粒度各归其位。
  - **本章无手写梗概**：生成完直接填入，浮层提示「已填入大纲 · 可在右栏「大纲」直接改」；
  - **已有手写梗概**：不覆盖，浮层并列显示手写原文与 AI 的一句话，由用户点
    「覆盖为这句」决定——覆盖的是作者自己写的字，按钮本身就是确认，不再叠一层弹窗；
  - **模型没按标记返回**：一句话留空、整段当摘要，不猜一句话去污染大纲板
    （大纲是「扫一眼看整卷走向」的地方，错一行比空一行更糟）；
  - **只给了一句话没给摘要**：仍按摘要落库，不让一次已付费的生成作废。

### Changed

- `summary` 模板 v2 → **v3**：约束改为两段式（`【一句话】` ≤30 字 + `【摘要】` 150–300 字），
  并把原来的「不要输出标题」改成「除这两个标记外不要其它标题」——否则模型会把
  刚要求的分段标记一起省掉。
- `SummaryPreview` 增加一句话梗概区块：浮层是 elevated，这块要「凹」下去，回退一档
  用 `--app-surface`（§6.1.3 分层）。
- 新增守卫 `useNovelPage-outline-backflow-guard.test.ts`（7 条：拆分 → 条件写入 →
  冲突不覆盖 → 覆盖回调接线 → 浮层状态 → prompt 两段式）与
  `SummaryPreview/index.test.tsx`（4 条浮层行为）。

## [2.10.1] - 2026-10-28

### Fixed

- **流式续写不再绕过 AI 观测**：此前 `ai-stream://` 通道既不写 `ai_log` 也不写
  `ai_event` 的 trigger / success —— 「AI 记录」页看不到续写、看板只剩渲染层的
  adopt / cancel，采纳率的分母凭空消失。现在主进程按与非流式同一套口径落库
  （trigger 于发起、success 于流读完、cancel 于用户中断），流式失败也走
  `httpStatusToError` + `aiErrorMessage` 归一文案与 `x-ai-error-code` 响应头。
- **`contextLen` 从装饰配置变成真预算**：`collector` 新增 `inputCharBudget` /
  `snippetBudget` / `clipChapterForPrompt`。摘要按 `contextLen` 对整章做首尾裁剪
  （导入书的超长单章不再直接撞上下文上限），润色 / 变换的片段预算随配置缩放。
- **润色的「章节片段」不再恒定取章首**：快照不再携带整章，改由调用方以选区为中心
  前后各半切片（`chapterSnippetAround`）—— 章末段落润色终于能看到自己那一段的上下文。
- **续写「当前剧情节点」接线**：`assembleContinuationStreamSpec` 的 `outlineNode`
  早已支持（含单测），但调用方一直没传；现在按当前章对应的大纲节点注入。
- **续写确认按快照光标插入**：改用 `replaceRange(cursor, cursor, text)`，流式期间
  随手选中别的段落不会被当成「替换目标」覆盖掉。
- **AI 编排补 reject 兜底**：起名 / 润色 / 变换三处裸 `await` 加 try / catch / finally，
  `ai.db` 未就绪导致的 IPC reject 不再让按钮或浮层永久 loading。
- **多流重入竞态**：续写引入流序号 `continuationSeqRef`，旧流的 catch / 旧块回来
  不再污染新流状态，也不会把新流的 ref 清空导致无法中断。
- **采纳埋点跟着真实副作用走**：编辑器 ref 为空（书架视图 / 章节未挂载）时不再上报 adopt。
- **`ai-client` 入口全部 async 化**：窗口未就绪时 `window.electronAPI.ai` 是同步
  TypeError，调用方的 `.catch` 接不住（qa 的 Esc 分层关闭测试直接崩在这条上）。
- **SummaryPreview 的 token 与按钮清零**：`--app-danger` → `--app-error`；
  `--app-bg-elevated`（不存在的 token，深色主题下白底浅字）→ `--app-surface-elevated`；
  四个按钮补 `.ant-btn` 清零点（§6.1.2），并把 `SummaryPreview` / `ContinuationPreview`
  登记进 elevated 白名单。
- `electron/ai-db.ts` / `handlers/ai-handlers.ts` 的写库失败日志改用
  `logAlways`（§6.3.1：主进程不再用裸 `console`）。

### Added

- **`ai_log` 增加 30 天保留期**：调用记录含提示词与模型输出（各截断 4000 字），
  此前永久留存且只增不减。现在按 `created_at` 淘汰超过 30 天的行 —— 写入后顺带
  清理（1 小时节流，`ai_log` 行宽，不必每条都扫索引）+ 启动 / 切库时强制清一次
  （长时间不调 AI 也能生效）。只按天数、不设条数上限：密集调 prompt 的那天不该
  把前一天的记录挤掉。设置页「调用记录」的说明同步标注保留期。
- **`ai_event.scope` 有真实数据**：`AiGenerateRequest` 新增可选 `scope`，摘要等 L3
  功能随请求下发，主进程写 trigger / success 时一并落库；渲染层的 adopt / cancel
  （含「取消授权」）也带范围。授权范围分布与拒绝率终于可统计。摘要浮层同时显示
  「范围 仅本章 / 选中段落 / 最近 3 章」，事后能看出这条摘要是按什么范围生成的。

### Changed

- **L3 授权范围真正约束发送内容**：弹窗的「仅本章 / 选中段落 / 最近 3 章」此前只写进
  `useAiConsent` 的 useState 就断了——发送端恒发整章、估算恒按整章算，「控件点了没效果」
  （review G4）。现在 `collector.buildChapterScopePayload` 是唯一的「范围 → 发送正文」
  构造点：`chapter` 发本章、`selection` 只发选中段落、`recent3` 发本章 + 前两章（预算
  60/25/15）。「选中段落」没有选区时**拒绝发送**并说明，绝不退回整章。范围同时进 prompt
  （`【选中段落】` / `【前情】` 段落 + 对应约束，`summary` 模板 v2），否则模型会拿片段
  编全书。弹窗不再隐藏选择器、标题随范围变、估算随范围实时重算、无内容可发时禁用「同意」。
- **意图联合类型收敛为一处**：删掉 `collector.AiIntent`，改用 `PromptIntent`
  （`PromptIntentMap` 的键，type-only import）。`LIMITS` 从 `as const` 改为
  `Record<PromptIntent, CollectLimits>`——新增意图漏登记现在是**编译错误**，
  不再是运行期 `LIMITS[intent]` 取到 undefined 静默炸采集。
- **润色与五种文本变换合并为一条编排**（`runRewrite`）：消除两段近乎逐行重复的
  「选段 → 预览 → 回填」逻辑，顺带获得「在途结果不覆盖新面板」的守卫。
- `collector` 的 `BookSnapshot.chapterSnippet` 语义改为「调用方已定位的片段」，
  本层只保留 4000 字防呆截断。
- `SettingsDrawer/FontPicker` 改为目录组件（`FontPicker/index.tsx` + `index.scss`，§5.2）。

## [2.10.0] - 2026-10-27

### Added

- **L3 数据出境授权（M5）**：新增 `ai-consent.ts` 分级常量（L1/L2/L3）、`ai-estimate.ts`
  token 估算纯函数（中文字符 ×1.5 + 英文词 ×1.3，自研、零新依赖）、`useAiConsent` hook、
  共享授权弹窗 `AiConsentDialog`。`ai_config` 加 `l3_enabled` 总开关（复用既有 KV，
  零新表零新 IPC）。
  - 首次触发 L3 功能弹授权：展示将发送字数 / token 估算 + 范围选择
    （仅本章 / 选中段落 / 最近 3 章，**不提供「全书」档**，Q4 拍板）。
  - 本地模型（Ollama）时明确提示「内容不出本机」；合规提示位
    （「不中转、不存储作品内容」）文案唯一产地。
- **AI 产出来源标记（M6）**：新增 `ai-provenance.ts` 来源标记构造器
  （`source=ai` + 模型 + 时间戳 + 批次 id），摘要落库带 `ai_summary_model`
  来源标记，手工编辑清空标记以区分「AI 生成」与「自己写的」。
- **章节 AI 摘要（R-AI-09）**：`novel_chapters` 加 `ai_summary` / `ai_summary_at` /
  `ai_summary_model` 三列（PRAGMA 探测增量迁移，随删章物理清理，零孤儿）；
  新增 `novel-chapter-summary-save` 通道 + `assembleSummarySpec` 模板（text 输出）；
  章节行悬浮闪电按钮触发生成，`SummaryPreview` 浮层展示并显眼标注「AI 生成 · 模型名」，
  支持重新生成。摘要可被续写复用为「上一章摘要」上下文。

## [2.9.2] - 2026-10-27

### Added

- **AI 就地续写**（R-AI-07 非流式版）：光标停在卡住的地方，点顶栏「续写」，
  让 AI 顺着光标前文（截断 1000 字）往下写 2–3 个候选，点某一条即插入光标处
  （走编辑器 `insertText`，可 Ctrl+Z 撤销）。候选浮层显眼标注「AI 建议，请自行改写」，
  定位是**跳板而非代笔**；失败在浮层内报错、绝不写入原文。
  - 上下文：书名 / 题材 / 命中人物卡（复用 `matchEntitiesInText`），前文走独立的
    【前文】段（非 chapterSnippet——续写要的是光标前，不是章头）。
  - 输出契约：新增 `CONTINUATION_OUTPUT_FORMAT`（json-array `{text}`），复用 M3 的
    三层保险解析，弱模型返回坏 JSON 也能救回候选。
  - `ai_log.intent` 落库 `continuation`，AI 记录页可筛选「续写」。
  - 编辑器新增 `getTextBeforeCursor` 能力（取光标前 N 字 + 光标偏移，供确认时精确定位）。

## [2.9.1] - 2026-10-27

### Added

- **文本变换工具箱**（R-AI-06）：把「润色」从一个按钮升级成一组动词——选中一段字，一键
  **扩写 / 精简 / 改写 / 换语气 / 转视角**。完全复用润色的「选中 → 预览 → 确认」链路，
  差别只在 `buildPromptSpec("transform")` 的角色定位与约束清单；右键菜单「AI 润色」分组
  泛化为「文本变换」分组（润色单列 + 五种变换分列），预览浮层标题与「换一种」文案按
  变换类型自适应。替换仍走编辑器 undo，失败仍在浮层内报错不替换原文。
- **变换的度量可区分**：`ai_log.intent` 落库为 `transform:expand` / `transform:condense` /
  `transform:rewrite` / `transform:tone` / `transform:pov`（子类型由 `TRANSFORM_INTENT_SUB`
  单一产地映射），AI 记录页的意图标签与筛选下拉同步识别这五种变换，看板能看出各变换的
  使用分布。润色仍走 `polish` 意图，不与变换混用。

## [2.9.0] - 2026-10-27

### Added

- **AI 产品事件表 `ai_event`**（M1a）：在 `ai.db` 新增与 `ai_log`（技术排障日志）严格分工的
  产品度量表——只记元数据（intent / step / provider / model / prompt 版本 / 耗时 / 错误码 /
  产出条数 / 正文字数 / L3 范围），**绝不记正文、作品名、邮箱**。`trigger` / `success` /
  `fallback` 由主进程在请求出口自动落；`adopt` / `edit` / `cancel` 这类请求返回之后的事后
  动作由渲染层经 `ai-event-log` 回传（白名单校验）。写入带滚动清理（5000 条 / 90 天），
  失败静默，绝不阻塞写作主链路。
- **prompt 版本落库**（M7）：`ai_log` 增量迁移补 `prompt_version` 列，`context/prompt/registry.ts`
  新增 `PROMPT_VERSIONS` 常量与 `promptVersionOf`，落日志时自动带上版本——改了 prompt 之后
  前后效果终于可对照归因。
- **AI 可用性门控 hook `useAiAvailability`**（M8）：统一「AI 现在能不能用、为什么不能用」的
  判断口径（disabled / no_model / missing_key / no_endpoint / unavailable），配纯函数
  `deriveAvailability` 供单测。后续每个新 AI 入口据此决定隐藏 / 禁用并说明 / 本地兜底，
  不再各写一遍散装判断。
- **用量与效果看板**（M1b）：设置窗口新增「用量与效果」页，展示近 30 天调用次数、各 intent
  分布、采纳率、平均耗时（全部下推 SQL 聚合），并配「导出诊断包」——只出脱敏的 `ai_event`
  与 `ai_log` 元数据（intent / model / 耗时 / 错误码），不含正文与密钥，供用户主动回传排查。

- **起名结果的寓意可插入正文**：卡片新增「插入寓意」按钮（仅 AI 起名有寓意时出现），
  按 `名字：寓意` 插到光标处。此前寓意只能复制出来手动拼，而它本身就是一句现成的命名释义，
  作者常要写进人物出场段或设定清单。
- **书架书卡展示题材**：网格视图单独一行、列表视图并进信息行（列表行高是硬约束，不能多一行）；
  未设置题材显示「题材：未归属」并压一档色。跳过题材不等于没有这一栏，留空只会让人以为没做这个字段。
- **AI 配置页「获取 Key」外链引导**：Key 输入框右侧按端点域名给出「获取 Key」，点开直达厂商的密钥页
  （DeepSeek / 通义千问 / 智谱 GLM / OpenAI）。预设与 Key 页地址收敛到 `shared/ai/ai-providers.ts`
  单一产地，渲染层与主进程共用；外链 URL 永远来自受控常量、不接受任意输入，
  不让 `shell.openExternal` 变成协议跳板。
- **Ollama 自动列出已下载模型**：切到本地模型时自动探测一次 `/api/tags`（8s 超时，
  「未启动」与「超时」分开提示），模型名改为可输入可选的下拉框并配刷新按钮。
  此前只能手填，拼错表现为「连接成功但模型不存在」，错误要到调用期才暴露。
- **起名降级提示补「去设置」**：AI 未配置或调用失败时，提示条右侧给一个直达入口，
  跳到设置窗口的「AI 配置」分区。原本文案只说要配置，用户还得自己找窗口再找分区。
- **设置窗口可被其他窗口拉起**：`sendTo("settings", …)` 支持按需建窗
  （`WINDOW_CREATORS` + `CROSS_EDITION_WINDOWS` 放行，lite 版其余窗口仍受黑屏防护），
  窗口未就绪时按 `queue` 补投；设置窗口新增 `settings-section-jump` 事件，
  只接受 `PAGES` 中真实存在的分区 id（lite 版没有 AI 页，非法 id 一律忽略）。

### Fixed

- **AI 起名的合法数组被判成「格式不对」**：模型把某条的 `}` 写成 `]`
  （`…无上手段。"],{"name":"沈延寿" …`）导致整串 `JSON.parse` 失败，旧逻辑退回「按行切」，
  而坏数组是一整行 → 第一张卡成了名字 `[{"name"`，其余全是本地补齐。解析层补第 2.5 层保险：
  字符串感知地逐个抠 `{…}` 切片单独 parse（`]` 误写、末尾截断、键名漏引号都能救回），
  坏对象只丢自己；彻底救不回来时，主字段含 JSON 标点的记录一律判废、按行兜底也拒绝切
  JSON 残片，面板只留本地结果 —— 半截数组不再出现在作者眼前。
- **润色结果段落间多出空行**：模型输出习惯段间空一行，而结果是按选区**整段回填**的，
  多出来的空行只能由作者一行行手删。现在两头治：prompt 里钉死「沿用原文换行与分段，
  不得加空行」，客户端再用 `alignParagraphBreaks` 按**原文**的分段习惯归一
  （原文单换行分段 → 结果也不留空行；原文本来就空行分段 → 保留）。只动换行，不碰文字。
- **AI 记录页折叠箭头贴死卡片左缘**：给 header 补左内边距 + 箭头右间距，展开后的正文
  按「内边距 + 箭头 + 间距」对齐摘要列。顺带修掉一处**静默失效**的样式：
  v6 的内容容器是 `.ant-collapse-body`，`.ant-collapse-content-box` 是 v5 的名字，
  写了等于没写（表现就是「内边距怎么调都不生效」）。
- **起名结果卡在窄侧栏被截断**：结果栅格原写死两列，而侧栏最窄 280px（内容区约 255px），
  每列被压到约 124px，卡内 5 颗 24px 图标按钮正好要 124px，再加内边距必然溢出，
  被滚动区的 `overflow-x: hidden` 直接裁掉（名字与按钮都被切一半）。改为
  `repeat(auto-fill, minmax(148px, 1fr))` 让列数跟着宽度走：窄面板降为单列，默认 340px
  仍是两列；操作行再补 `flex-wrap: wrap` 兜底，宁可折行也不横向溢出。

## [2.8.0] - 2026-10-27

### Added

- **作品题材 `genre`**（可空、非必填）：AI 起名 / 润色的风格锚点。
  - `novel_works` 增量补列（`ALTER TABLE … ADD COLUMN genre TEXT`，PRAGMA 判列后执行），
    老作品一律视为「未设置」，无需回填。
  - **书架「新建作品」改两步**：① 书名（必填）→ ② 题材（可从常见分类里选，也可手动填写，
    可「跳过」）。拆成两步是因为并排会让「题材」看起来同样必填，作者要纠结半天才敢点确定。
  - **编辑器作品菜单新增「设置题材」**：建书时跳过、事后想补也能补；菜单项直接显示当前题材。
    编辑器内的「新建作品」是码字途中的顺手动作，题材以可留空的输入框给出，不套两步流程。
  - 题材缺失时，AI 层按「书名 + 已有要素的用字风格」弱兜底，并在 prompt 里**如实说明**
    「题材未设置」，不伪造风格。
- **设置窗口新增「AI 记录」页**（R-AI-05 收尾）：分页列出 `ai_log` 每次调用
  （时间 / 意图 / 模型 / 耗时 / 成功或错误原因），展开可看系统提示词、用户输入、模型输出；
  支持按意图筛选与一键清空。与「AI 配置」分开成两页——配置是设一次的动作，
  记录是调 prompt 时反复回看的动作，混在一页会让长列表把保存按钮淹掉。
  `ai-log-list` 新增 `intent` 过滤参数（在 SQL 里过滤，避免「只筛当前页」的假空态）。

### Changed

- **提示词收敛为唯一产地 `src/shared/ai/context/prompt/`**：
  `sections.ts`（公共段落：角色 / 作品背景 / 要素 / 境界 / 人物 / 章节片段 / 约束 / 输出契约）
  + `naming.ts` / `polish.ts`（各功能模板）+ `registry.ts`（`PROMPT_BUILDERS` / `buildPromptSpec`）。
  - **删除 `ai-context.ts`**：早期单轮模板 `buildNamingPrompt` / `buildPolishPrompt` 的语义
    已并入新模板（类型 / 风格 / 性别 / 数量 / 避重 + 润色四条基本约束一条不少）。
  - 原 `assembler.ts` 拆入 `prompt/`，调用方改用 `buildPromptSpec("naming" | "polish", …)`；
    新增功能仍是「写一个模板 + 注册表登记一行」，服务层与主进程零改动。
  - 注册表加了守卫：模板漏声明输出契约、角色句不在首句、意图漏登记都会直接红。
- **AI 调用日志不再受日志级别过滤**：改用 `logAlways` 写出（与 IPC 记录同一个绕过出口）。
  此前 AI 记录走 `log("debug", …)`，默认 `info` 级别下**整批消失**——而这正是排查
  「模型为什么答歪了」的唯一线索。失败行同时提一级到 `warn`。
- **诊断页文案统一**：去掉「IPC 通信单独存文件」的旧口径，改为「IPC 调用与 AI 调用按 DEBUG 级
  强制写入同一份窗口日志」，开关名由「记录 IPC 通信」改为「记录 IPC 调用」并说明同文件对齐。

## [2.7.0] - 2026-10-27

### Added

- **AI 上下文加工层 `src/shared/ai/context/`**（R-AI-05）：把「作者每次手填要求」升级为
  「系统自动聚合本书设定」。
  - `collector.ts`：`BookSnapshot → AiBookContext`，按意图（naming / polish）决定采集字段与
    截断长度（要素 40/20 条、章节片段 800 字、已用名 40 条），避免把整本书塞进 prompt；
    并新增 `matchEntitiesInText` **反向匹配**——拿人物卡的名字/别名去句子里找，
    解决「划词是一整句、正向等值匹配命中率极低」的问题（单字名不参与，人物优先）。
  - `assembler.ts`：`assembleNamingSpec` / `assemblePolishSpec` 产出 `PromptSpec`
    （角色 / 上下文 / 约束 / 输出契约四段）。**新增 AI 功能 = 新增一个模板**，
    服务层与主进程零改动。
  - `output-spec.ts`：`OutputFormat`（text / json-array）契约 + 格式指令生成 +
    三层解析保险（prompt 强约束 → 最小 `[`~`]` 切片 JSON 解析 → 启发式兜底）。
- **起名结果带「寓意」**：输出改为 `json-array {"name","meaning"}`，结果卡在名字下方显示
  寓意（两行截断，hover 看全文）；模型不遵 JSON 时走文本兜底并在面板提示「寓意可能缺失」。
- **起名上下文自动灌入**：书名 / 题材 / 本书要素 / 境界体系 / 已用名自动进 prompt，
  描述输入框降级为「可选补充」（不填也能按本书设定起名）。
- **润色识别人物卡**：选区（及章节片段）中出现的角色自动带 `姓名 + 类型 + 简介` 注入
  prompt，并追加「保持人物性格与称呼」约束；一次最多 6 张，未命中不注入。
- **AI 调用日志**：`ai.db` 新增 `ai_log` 表（意图 / 模型 / prompt / 输出 / 错误码 / 耗时），
  IPC 通道 `ai-log-list`、`ai-log-clear` 已就绪（查看面板待接）。

### Changed

- **日志不再拆 `ipc.log`**：IPC 通信记录按 **DEBUG** 级别并入所属窗口当天的
  `YYYY-MM-DD.log`（模块名 `ipc`），与业务日志同一时间轴；仍只记失败与 >300ms 慢调用，
  仍受「记录 IPC」开关控制。
- **AI 调用同时写入本地日志**（模块名 `ai`，DEBUG 级）：prompt / output 各留 600 字预览，
  失败额外提一级到 `warn`，避免调高日志级别后看不见失败。
- `ai-context.ts` 标记为历史遗留：早期单轮模板保留但不再扩展，
  新增功能一律走 `context/assembler`（两套 prompt 并存必然漂移）。
- `AiGenerateRequest` 新增可选 `intent`（仅用于日志归类，服务层不解释）。

### 说明

- `ai_log` 表用 `CREATE TABLE IF NOT EXISTS` 幂等建表，存量 `ai.db` 下次打开自动补表，
  无需迁移脚本。
- 未落地：`novel_works.genre` 题材字段（Phase 2，需改建书 UI，可跳过）、调用日志查看面板。

## [2.6.3] - 2026-10-27

### Changed

- **子页面顶部导航条下线，返回入口收进窗口标题栏**：待办 / 日期活动 / 备忘 / 记账 /
  代码 / 资讯六个页面的 `Page` 不再渲染 52px 高的 NavHeader 卡片，那条栏只有一个
  「返回」功能却把内容区往下压了 76px。纵向空间全部归还内容区，六个页面容器顶部
  统一补 12px 内边距（原先由导航条提供），横向与底部间距不变；
  `TodoPage` 的 `height: calc(100% - 80px)` 魔法高度一并改为 `flex: 1; min-height: 0`。
- **`WindowHeader` 新增左侧 `leading` 插槽**（`no-drag` 区）：主窗用它承载
  「返回首页 ｜ 当前页面名称」——原先左侧只有一颗小按钮、右边一大片空白，
  现在补上页面名称后成为「动作 │ 位置」的完整信息对，右侧设置与窗口按钮也有了配重。
  页面名称表 `PAGE_TITLES` 与路由表同文件维护，首页不渲染该区。
- 删除 `shared/components/NavHeader`（唯一使用方 `Page` 已不再需要）。

### Fixed

- **子页面被直接打开 / 刷新后点返回会落到空白页**：history 里没有上一页时
  （初始 location 的 `key` 恒为 `default`）改为退回首页兜底。
- 标题栏 `text` 变体按钮的取色变量按 antd v6 实测产物修正为
  `--ant-button-text-text-*` 一族（单 `text` 的旧名在 text 变体下不被读取，
  写了静默无效），hover 背景仍走 `--ant-button-text-hover-bg`。

## [2.6.2] - 2026-10-27

### Changed

- **「查询当月」按钮日期范围**：从「本月 1 号 ~ 今天」改为「本月 1 号 ~ 月底最后一天」，
  与日期选择器「可选到当月月底」的放开保持一致（`getThisMonthRange` 返回整月区间）。

### Fixed

- **CodePage 工作日统计口径修正**：
  - 「本月剩余日均」改用存量缺口模型，剩余工作日从「明天」起算，修掉「今天产出既计入
    已产出、又占一个剩余工作日」导致的缺口虚高；
  - 「选中区间剩余日均」改名为「选中区间日均产出」，只展示区间日均产出效率，删除原先
    与「本月剩余日均」口径自相矛盾的缺口预测；
  - 魔法数字 200 抽成 `DAILY_TARGET` 常量（趋势线 / 目标文案 / 两卡片统一引用）；
  - 补登记 2026-10-10 国庆调休补班日，10 月工作日由 17 修正为 18。

### Added

- **动态节假日数据源**：新增 `code-holiday.ts`，联网拉取 jieri8.com 免费节假日接口
  （渲染进程 fetch，符合 §8.7 契约，不新增 IPC 通道），按年缓存到 localStorage，
  拉取失败 / 未公布年份回退内置硬编码表兜底。`isWorkdayWith` / `calcWorkdaysWith`
  支持「动态数据优先、硬编码兜底」，所有工作日统计（日均产出 / 剩余日均 / 趋势图）
  统一走动态数据源，无需每年手工更新调休表。

## [2.6.1] - 2026-10-26

### Added

- **设置窗口抽出两条公共原语**：`components/SettingsActionBar`（页面底部常驻操作条，
  左侧状态 / 右侧动作插槽）与 `styles/settings-controls.scss`（次级 / 危险 / 主色三态按钮）。
  此前「次级描边按钮」在 AI、诊断、快捷键三处各写 20 行组件变量，账号页的危险按钮是
  第四份拷贝 —— 改一次圆角要改四个文件，先漏的通常是 hover 描边色。
- `SettingsWindow/index.scss` 新增 `.settings-page__stack`：卡片与操作条摊在同一层，
  `min-height: 100%` 让内容不足一屏时操作条也贴页面底部。

### Changed

- **保存手感收敛为一条规则**：只要这一页存在「需要确认 / 可重置」的动作，动作就落在
  底部常驻条上，位置在 900×680 下切页不跳。
  - 诊断页从「改一项立即落库、调三次保留天数弹三个『已保存』」改为草稿 + 一次提交；
  - 个人资料改为「无改动不可保存」，判据是**值比较**而非 `isFieldsTouched`
    （改了又改回去不该显示未保存）；
  - 快捷键页用 `state="hint"` 模式：左侧写「修改后立即生效，无需保存」，右侧放「恢复默认」，
    原先卡内的 footer 与「应用外」说明一并上移；
  - 账号页不放操作条（退出登录是动作不是配置，常驻条上容易被误点）；
  - 保存成功的 toast 统一为「已保存」。
- 操作条左右内边距取 16px（= 卡片行内边距），状态点与按钮因此和上方行内控件落在
  同一条竖线上（原先按钮整体右移 15px）；字段内边距 10px → 12px，与 `.settings-item`
  的行节奏对齐。
- 删除 `AccountSection/index.scss`（唯一内容就是那份危险按钮拷贝）。

### Fixed

- 新增「统一手感」守卫四条：`.settings-page__stack` 必须 `min-height: 100%`、
  操作条必须 sticky + `bottom: 0` + `margin-top: auto` + `flex: none` 且底不透明、
  各分区样式**不许再出现** `--ant-control-height`（即不许再手写按钮造型）、
  状态文案只允许出现在 `SettingsActionBar` 一处。
- 新增 `SettingsActionBar` 组件测试（dirty / saved / hint / 无状态四态）。

## [2.6.0] - 2026-10-26

### Added

- **设置窗口新增「AI 配置」页**：原 AI 分区挤在一条长滚动流里（服务商 / 地址 / 模型 /
  Key / 折叠的高级参数混排），现在独立成页并按「总开关 → 连接方式 → 连接凭据 →
  高级参数」四段组织。连接方式改成两张大按钮单选（自定义接口 / 本地 Ollama），
  服务商下拉**选中即填入**推荐地址与模型（改过任一项即回「自定义」，不出现
  「选了 DeepSeek 但地址是别家」的假状态）；Key 旁常显「已保存」小签。
  操作按钮收进底部常驻条：左侧常显「有未保存的更改 / 已保存」，`保存` 仅在有改动
  时可点，「测试连接」仍走「先落库再测」并在 title 里明示。
- `shared/components/WindowHeader` 新增 `maximizable` 属性（默认 `true`）：
  固定尺寸窗口可以隐藏「最大化」按钮，避免点了没有反应的假入口。

### Changed

- **设置窗口骨架从「单列分区长滚动」改为「左分类导航 + 右内容页」，窗口固定 900×680**
  （`resizable: false` / `maximizable: false`）。左栏按「通用 3 / 账户 2 / 高级 1」
  分组，右栏页头（标题 + 一句话说明）固定、只有页面内容各自滚动；非当前页用
  `display: none` 隐藏**而不卸载**，切页不丢 AI 配置草稿与资料表单。
  理由：6 个入口纵向堆叠时总高度远超窗口，滚动位置与「我在改哪一类」无关。
- 分区卡片不再重复页头标题（外观 / 个人资料 / 账号 / 诊断 / 快捷键去掉标题条），
  分隔线统一由 `.settings-section__body > * + *` 发放，`.settings-item`（左文右控件）
  与新增的 `.settings-field`（竖排字段）混排不再断线。
- 个人资料表单宽度收在 400px、保存按钮从铺满整行的 block 改回常规尺寸；
  初始载入只置禁用，转圈只表示「保存中」。
- 账号「退出登录」由原生 `<button>` 换成组件库 `Button` + 清零点 mixin（AGENTS §6.1.2）；
  诊断 / 快捷键的次级按钮高度与同行 Select / InputNumber 统一为 32px。
- 快捷键页顶部说明去重：页头已说明「点键位即改、即时生效」，卡内只留 Esc / Backspace。

### Fixed

- 设置页布局守卫按新骨架重写：定高滚动区改判 `flex: 1` + `min-height: 0`
  （`height: 100%` 会与固定页头叠加、把内容顶出窗口），并补「非当前页 display:none」
  「左栏定宽不收缩」「右栏 min-width/min-height 归零」三条断言，钉住的是
  「内容超高只由滚动区承担」这个意图，而不是旧写法的字面量。

## [2.5.1] - 2026-10-23

### Changed

- **文档治理：`docs/` 按「是否还有约束力」三级重排**（规范落 `AGENTS.md` §5.3 / §8.8）。
  原 13 份文档平铺在 `docs/` 与 `docs/prd/`，活规范、一次性审查报告、已交付过程稿混在一起，
  无法判断哪份还能约束代码。现分三级：`docs/spec/`（活规范，违反即缺陷）、
  `docs/review/`（审查报告，清单里未闭环的待办仍可执行）、`docs/archive/`（已闭环/已作废，
  只读留档），并新增 `docs/README.md` 作唯一导航索引（每篇标注一句话结论与闭环版本）。
  新增需求稿约定放 `docs/prd/<需求编号>-<主题>.md`，交付后整组移入 `docs/archive/prd-<编号>/`。
- R27 关系网络 7 篇立项过程稿（scope / preresearch / acceptance / analysis / delta-v2 /
  architecture-decision-v2 / batch-plan-v2）归档至 `docs/archive/prd-r27/`，
  `r27-architecture-decision-v2.md` 补齐组内前缀；1.47.0 视觉改造方案与验收对照归档至
  `docs/archive/visual-polish/`；图形主题化规范移至 `docs/spec/`。
  归档时只在标题下补「已归档 · 闭环版本 · 现行为准的去处」，正文未改。
- `AGENTS.md` 目录树补 `docs/` 与 `changeLogHistory/`，并新增 §5.3（三级目录、命名规则、
  归档与删除判定、移动文档的引用自查）、§8.8（文档变更检查清单）。

### Removed

- 删除 `docs/prd/r27-relationship-network-batch-plan.md`（v1 排期）：方案基线是**已作废的
  页内浮层**（后续 delta-v2 改为独立窗口 `RelationWindow`），工作量 19.0 人日与 6 批划分
  均为无效数据，正文已无任何可执行条款。
- 删除 `.cache-shots/`（16 张 2026-09-29 的临时界面截图，`.gitignore` 已忽略、无任何引用）。
- 删除 `AGENTS.md` §6.8 中对 `docs/packaging/bundle-slimming-2.0.0.md` 的引用
  （该文件此前已删，体积数据与结论本就在本节与 CHANGELOG 内），
  明确改为指向 CHANGELOG 对应条目，避免「同一事实两处维护」。

### Fixed

- `README.md` 三处过时内容：① 「`pnpm electron:setup` 为 Electron 编译 better-sqlite3」
  已不成立（13.x 起 Node-API 免编译）；② 把「Electron 二进制缺失 / `pnpm dev` 卡住」
  归因为「pnpm ≥10 拦截 electron postinstall」是**已被证伪的旧结论**（Electron 42+ 无
  postinstall，真因是首次 `require` 时无镜像无超时的同步下载），改为 `pnpm ensure:electron` /
  `pnpm dev:doctor` 的正确处置，并补「二进制看着齐全仍秒退 = 解压不完整」的形态；
  ③ pnpm 9 的构建脚本白名单位置写错（写成 `package.json` 的 `pnpm` 字段，实际在
  `.npmrc` 的 `only-built-dependencies[]`）。顺带修重复的小节编号（两个「5.」）。
- `pnpm-workspace.yaml` 注释称「`package.json` 的 `pnpm.onlyBuiltDependencies` 是 pnpm 9
  唯一认的位置」，与 `.npmrc` 注释及实测矛盾，改为 `.npmrc`。
- `src/shared/novel/guide-doc.ts` 文件头仍指向已删除的 `docs/novel-onboarding-guide.html`
  （「改文案同步三处」实为两处），改为以本文件为唯一内容源。
- `docs/spec/graphic-theming-spec.md` 的配套文档路径随归档更新。

## [2.5.0] - 2026-10-23

### Added

- **回收站从「数据安全」弹窗拆成独立页面**（`pages/RecycleBinPage`，设计稿见 Ardot
  「CheckIn · 回收站页面设计」的默认 / 空态两屏）。书架顶栏新增「回收站」入口，图标用
  设计给的 `recycle-bin.svg`（`?raw` 内联，`fill=currentColor` 才能跟着主题色走），带条目数
  角标。弹窗只留「全量备份 / 从备份恢复」—— 回收站要逐条判断「捞回还是销毁」，需要类型 /
  归属作品 / 规模 / 剩余天数 / 两个动作的横向空间，560px 的弹窗里每行只能靠省略号过日子。
- 页面能力：类型分段（全部 / 作品 / 卷 / 章节，各带计数）、关键词搜索（同时匹配条目名与
  所属作品名 —— 章节名往往认不出来，作者记得的是书名）、按删除时间倒序、剩余天数分档
  （≤3 天转警示色、今天到期与已过期转错误色）、勾选后批量恢复 / 批量彻底删除、清空回收站、
  进入页面即清理过期条目并提示清理了几项。
- 统计条：可恢复条目（按类型拆分）/ 保留期 / 最近一次删除；页面底部「恢复规则」写明
  同批删除、原位置被占时落到同级末位、过期自动清理，减少「点恢复之前」的犹豫。
- 书架区新增二级页面状态 `shelfScreen`（`useEntityJumpStore`）：进回收站不再借道 `view`，
  关系图跳转的 `onShelf` 判定不会被误判成「不在书架」；打开作品 / 返回书架 / 导入三个出口
  都会把它同步归零，不会回到书架时还停在上次的二级页面。

### Changed

- 书架顶栏「数据安全」与「回收站」拆成两颗入口按钮，角标从前者移到后者。
- 卷 / 章节删除确认框里的恢复路径改为「书架「回收站」里恢复」（旧文案指向的弹窗已不含回收站）。
- **书架顶栏布局收敛**（真机反馈「头部按钮太密集」）：原先右侧是「搜索 + 四颗带文字的描边
  胶囊 + 主按钮」六件平铺，视觉上像一排并列的按钮、主次全糊在一起。现在收成三段 ——
  `书架·规模摘要 │ 搜索 │ 工具条 + 新建作品`，工具条用一条竖分隔线分组。其中只有
  「全局设定中心」保留文字（跨书共享库是本页最需要被发现的次级入口，也是新手引导第 6 步的
  锚点），数据安全 / 回收站 / 导入降为 32px 纯图标，语义交给 Tooltip 与 `aria-label`；
  规模摘要从 primary-weak 胶囊降为静音小字 —— 它与下方四张统计卡是同一个数字，顶栏再放一颗
  同色色块只会跟主按钮抢焦点。
- **窗口标题栏徽标跟随二级页面**：进回收站后标题栏显示「回收站」，不再一直写「书架」
  （`badge` 由只读 `view` 改为同时读 `shelfScreen`）。
- **回收站页头固定**：改为「页头 + 滚动区」两段结构，页头（返回 / 刷新 / 清空回收站）
  不随列表滚动 —— 条目一多，滚到列表底部还想动它时不必先滚回顶部。试过 `position: sticky`
  配负 margin 抵消父 padding：实测吸附点会偏一个 padding 高度，且窄窗改了 padding 之后
  负 margin 要跟着改，漏一处就从页头两侧漏出滚动内容，耦合更脆。
- 窄窗口（≤1240px）下搜索框与工具条同步收紧内边距与图标位宽度，摘要文字在 ≤1080px 让位。

### Removed

- `DataSafetyModal` 里的回收站列表、批量操作与过期清理逻辑（连同其单测）全部迁到
  `RecycleBinPage`；彻底删除仍按类型分派到各自既有的级联通道，渲染层没有新增任何删除顺序。

## [2.4.0] - 2026-10-23

### Added

- **删除兜底扩展到卷 / 章：章节 / 卷删除也进回收站（2.3.0 只做了作品级）**：
  `novel_volumes` / `novel_chapters` 各增列 `deleted_at`（逐表 pragma 探测后 ALTER，
  可空即「全部在架」，老库无需回填）。日常删除从物理级联改为软删除 —— 正文、历史快照、
  大纲条目全部留在原处，恢复只清标记，不需要任何重建逻辑。
- **删卷时卷与其内章节写同一个时间戳**，这个相同值就是「同一批」的判据：恢复卷只带回
  这一批，删卷之前单独删掉的章节仍留在回收站里各归各的；回收站列表也不把随卷删掉的章节
  重复列一遍（卷条目已经代表它们了）。
- 回收站面板支持三类条目：类型标签（作品 / 卷 / 章节）+ 所属作品与卷名，
  恢复与彻底删除按类型分派到各自的级联通道。

### Changed

- 装载层 `novel-editor-load` 过滤已删卷章；指向已删卷章的大纲条目（伏笔）同样挡在装载层之外
  （数据不删，卷章恢复后条目自动重现）。
- `novel-chapter-save` 拒绝写入已进回收站的章节：删除瞬间压在队列里的自动保存不能改掉
  回收站里的正文，否则恢复出来的就不是删除那一刻的样子。
- 恢复时原位置若已被占（软删除期间剩余卷章被重排成紧凑序号），自动落到同级末位 ——
  直接写回原 sort 会造成两章同号，目录顺序变得不确定。
- 恢复单章时若父卷也在回收站（「先单独删了这一章、随后删了整个卷」），先把卷本身放出来，
  否则恢复出来的章挂在一个不存在的卷上等于「恢复了但看不见」。
- 章节树删除确认文案改为「将移入回收站，可在书架「数据安全」里恢复」，主按钮「移入回收站」，
  并去掉「不可恢复」的旧措辞（软删除下它已经是错的）。

## [2.3.0] - 2026-10-23

### Added

- **novel 域一键全量备份 / 恢复（产品走查 P0 · 数据安全）**：书架顶栏新增「数据安全」入口，
  把整库（作品 / 卷章正文 / 要素 / 设定 / 行囊 / 关系图 / 全局设定引用）打成一个 zip
  （`manifest.json` + `novel.db`）。备份前先 `PRAGMA wal_checkpoint(TRUNCATE)`，否则 WAL 里
  尚未合并的写入（往往是最后几章）会缺席备份包。恢复分两步：选包后**只读清单做预览**
  （导出时间 / 作品 / 卷章 / 字数 / 包大小），确认后才覆盖；覆盖前校验清单
  （`app` / `kind` / `format`）与 SQLite 文件头，再**先关库 → 自动留底
  `novel.db.before-restore-<时间戳>` → 写新库 → 重开库跑增量迁移**，写失败自动把留底回滚
  回去（「恢复失败」不等于「数据没了」）。
- **删除兜底：作品回收站（软删除 + 30 天可恢复）**：`novel_works` 增列 `deleted_at`
  （增量迁移，可空即「全部在架」，老库无需回填）；删除作品从物理级联改为移入回收站 ——
  卷章正文 / 要素 / 设定 / 行囊全部留在原处，恢复只清标记，不需要任何重建逻辑。
  书架顶栏按钮挂回收站角标，面板内可恢复 / 彻底删除 / 清空，超过 30 天的条目在打开面板时
  自动清除。彻底删除复用既有 `novel-work-delete` 单事务级联通道，不另写第二份删除顺序。
- 守卫 `electron/novel-safety-guard.test.ts`：钉住「装载必须过滤回收站」「日常删除必须是
  软删除」「恢复必须先关库再写文件、先留底后删旧文件、失败回滚」「备份先 checkpoint 再读文件」；
  `electron/novel-safety-utils.test.ts` 覆盖清单校验 / SQLite 文件头 / 保留期边界；
  `DataSafetyModal/index.test.tsx` 覆盖备份、恢复预览、回收站恢复与过期清理。

### Changed

- 删除作品的确认文案改为「移入回收站，30 天内可原样恢复」，不再写「此操作不可恢复」；
  主按钮文案由「删除」改为「移入回收站」。

## [2.2.2] - 2026-10-22

### Added

- **阅读模式（排版抽屉 · 阅读组）**：开启后正文只读并隐藏光标，标注 / 选区 / 悬浮卡照常；
  在章节首／尾继续**同向**滚动即加载上一章（落在文末）／下一章（落在文首），
  一次滚动手势只翻一章，连续阅读不打断。只读态走 `EditorView.editable` +
  `EditorState.readOnly` 的 compartment 热切换，不重建编辑器；翻章判定用滚轮方向意图
  而非「是否停在边界」，避免新章刚打开 `scrollTop=0` 被误判成到顶而弹回上一章。
  新增守卫 `EditorPane/read-mode-guard.test.ts`（方向意图 / 短章阈值 / 手势只翻一章）。

### Fixed

- **正文字体「点应用不生效、重启才生效」**：`@font-face` 是懒加载的，点应用那一刻字体文件
  才真正开始下载（霞鹜文楷全量 19MB），正文先渲染 fallback，且 CodeMirror 的字体度量缓存
  不主动重测，视觉上「没换」。改为应用非空字体时先 `document.fonts.load()` +
  `document.fonts.ready` 等到字形就绪，再回写 `settings.paperFont`；加载失败不阻塞、回退系统字。
- **正文预览与应用的字体被 CORS 拦死（控制台 `novel-font://` 全部 ERR_FAILED）**：
  `novel-font` 的自定义协议特权缺 `standard` / `corsEnabled`，从 `http:` 源跨协议加载在
  scheme 层就被拒，响应头根本没机会出场，因此「思源宋体 / 思源黑体」预览长得一模一样。
  特权注册与 `app` 协议对齐后正常加载，两款字体预览与应用均可见差异。

### Changed

- **排版抽屉（设置面板）重排**：按「排版 / 阅读 / 正文字体 / 写作目标 / 章节与卷命名 /
  正文高亮类型」分块，块间统一实线分隔、块内行距收紧；开关改为右侧 `auto` 列 +
  `justify-self: end`（原先落在 `1fr` 列被 Grid 的 stretch 拉成 200px「长条开关」），
  并统一为 antd `size="small"`、与标题行顶对齐；说明文案收到标题正下方并精简，
  消除孤字换行；后缀胶囊由 3+1 锯齿改为 4 列等分，「自定义」输入框回到行内成为
  「自定义」标签的控件。

## [2.2.1] - 2026-10-22

### Fixed

- **关系图要素池行尾图标按钮的 hover 背景相对图标右偏**：`ant-button-reset` 把 antd 的
  `justify-content: center` 改成 `normal`（整行文字要左贴），纯图标按钮没补回居中——
  14px 图标贴在 24px 盒子的左沿、右侧空出 10px，hover 时就是「背景整块偏右」。
  `PoolRow` 的「上图 / 移出」按钮与节点卡、关系卡的两个关闭按钮统一补
  `justify-content: center`，行尾按钮另补 `:focus-visible` 焦点环（自身背景已交给行盒）。
  同时把「图标不叠自己的 hover 背景」真正落地：antd 会在
  `.ant-btn-color-default.ant-btn-variant-text`（0,2,0）上重新声明
  `--ant-btn-bg-color-hover`，与 `.rel-pool__act.ant-btn`（0,2,0）同特异性、谁后注入谁赢，
  原声明时灵时不灵（图标区多出一块与行高亮不同色的圆角块）；清零改挂祖先类
  `.rel-pool__row .rel-pool__act.ant-btn`（0,3,0）后与注入顺序无关。
- **novel 窗口控制台 `[antd: Modal] maskClosable is deprecated` 告警**：antd v6 已用
  `mask.closable` 取代 `maskClosable`。行囊「有改动未保存」拦截框、跨作品跳转确认框、
  记账快速记账弹窗三处一并替换为 `mask={{ closable }}`（只改点击遮罩是否关闭，
  遮罩本身照常渲染）。

### Added

- 守卫 `src/windows/RelationWindow/icon-align-guard.test.ts`：钉住「清零点之后纯图标
  按钮必须自己补 `justify-content: center`」与「hover 背景清零必须挂在祖先类上」，
  前者是上图 / 移出图标错位的根因，后者是清零失效的根因。

## [2.2.0] - 2026-10-21

### Added

- **人物关系网络独立窗口（R27）**：新窗口 `RelationWindow`（`novel` / `full` 打包，`lite` 不打包），
  左侧要素资料池 + 中间力导向画布 + 右侧节点 / 边详情三栏；池子列出本书全部要素并常驻
  「未上图 N」，按类型分组可折叠，支持名称 / 别名 / 简介检索、拖入拖回与一键上图。
- **图上建关系走单事务通道 `novel-graph-commit`**：一次提交写入「新建关系 + 备注 + 画布坐标」，
  `rev` 由主进程接管做乐观锁（`stale` 整体回滚），同 id 重复提交幂等；成功后广播
  `novel-links-changed` 增量，主窗口右栏三处（关联数 / 关系列表 / 面板）就地更新，不重载 bundle。
- **画布记忆按作品单键持久化**（`novel_config` 的 `novel_rel_graph_v1:<workId>:g1`）：成员集合、
  节点坐标与视口（缩放 + 平移）一并存住，重开窗口恢复上次的位置与视野；首次打开按布局自动铺开一次。
- **导出 PNG**：`capturePage` 取景 + 独立的二进制落盘通道（`writeFile` 不带 encoding），
  可选「先适应画布再导出」；导出期间工具栏整块不渲染，另用纯 CSS 抑制缩放控件、
  密度提示条与选中态，图面一个像素都不挪。
- **资料卡「在主窗口打开」的三态跳转**：书架主页 → 直接切到目标作品并开卡；同一本书 →
  直接开卡；另一本书 → 只把主窗口抬到最前，弹确认（**取消 / 保存后跳转**），确认后先
  `flushSave` 落库再切书；主窗口已被关闭时由 `window-send-to` 的 `create` 拉起。
  画布节点双击走同一入口。
- **跨窗口消息统一的待投递队列**（`electron/window-pending.ts`）：`window-send-to` 支持
  `create`（窗口没开就拉起）与 `queue`（先入队），新窗口装载后由 preload drain 并补投给
  监听者。此前每种跳转都要在主进程单独维护一对 IPC，现在主进程只认识窗口名。
- **跳转判定堵死「静默切书」的最后两条通道**：① 能力句柄增加 `ready()`——编辑器数据
  装载完成前 `activeWorkId()` 恒为空串，此前被当成「空态直开」，判定与执行之间状态一变
  就成了无声切书；现在未就绪一律挂起，就绪后按真实作品 id 重判。② 主窗口若是**刚被这条
  跳转拉起来的**，不再走「书架直切」——先按上次位置恢复编辑器，把跳转挂起，句柄就绪后
  重判：同书直开卡，异书照常弹确认框。判定与执行改用同一份快照，不再中途重读 getter。
- **跳转状态机收口 `useEntityJumpStore`（zustand）**：视图 / 编辑器挂载 / 打开请求 /
  能力句柄 / 挂起与待确认跳转全部进 store，判定永远读当下状态。修掉三类真机时序故障：
  IPC 监听随视图切换反复摘挂导致消息静默丢失（只唤起、不切书不弹窗）；挂起的跳转在
  「返回书架」的视图切换间隙被重判成书架直切（返回书架却切书、书架页冒确认框）；挂起后
  稳定态再无依赖变化、永远等不到重判。现在监听只注册一次、回书架**同步**作废挂起跳转、
  句柄就绪立即重判 + 300ms 兜底重试。

### Changed

- 版本升到 `2.2.0`（新增独立窗口与新数据通道，按 §8.6 升次版本号）。
- 移除未被任何生产代码调用的 `rebaseOnRemote`（死代码会让人误以为图窗口已有跨窗口冲突合并）。
- `useNovelData` 的 `novel-links-changed` 监听按 `workId` 过滤：图窗口停在 A 书、主窗口已切到 B 书时，
  A 的增量不再并进 B 的 `bundle.links`（缺省 workId 仍按 id 合并）。

### Fixed

- **关系写入路径补齐守卫**：自环、空关系名、超长关系名（>24 字）在事务第一步直接拒绝
  （`invalid-link`），不再只依赖渲染层 `checkDraft()`；入库前统一 `trim`。
- **导出的 PNG 里不再出现右上角操作按钮**：三处一起修 —— ① `is-exporting` 由 `exporting`
  声明式驱动（React 重渲染按模板重写 class 时不会把命令式类名抹掉）；② 工具栏在导出态
  `display:none`（用户点的正是那颗「导出」，菜单挂在 body portal、退场动画没走完就会进图）；
  ③ 取景前多等 120ms 并让窗口 `invalidate()` 重绘 —— `capturePage` 会返回「上一帧」，
  此前截到的就是点按钮那一刻的画面。
- **异书跳转不再「先切书、再弹确认」**：`rel-open-entity` 只在窗口根监听一次，判定走
  纯函数 `resolveEntityJumpAction`（书架 / 同书 / 异书 / 挂起 / 忽略），`confirm` 分支只挂起弹窗，
  切书严格发生在「保存成功」之后。另补两处同源隐患：① 编辑器正在重挂载（HMR / StrictMode）时
  能力句柄短暂为空，旧兜底会「直接切过去开卡」——现在改为挂起，句柄就绪后按真实作品 id 重判；
  ② 同一条消息被重复投递（收件箱补投 + 实时投递）时只处理一次，不会二次切书或弹第二个框。
- **`window-send-to` 的 `create` 以前从未生效**：preload 把 `raise` 与 `options` 摆在两个位置参数上，
  主进程只按第 4 位读，`{create:true}` 被丢掉 —— 主窗口关掉后点「在主窗口打开资料卡」既不创建
  也不入队，只回一个 `delivered:false`，用户看到「主窗口没能打开」。选项读写收进
  `electron/window-send-options.ts`（`buildWindowSendOptions` / `readWindowSendOptions`），
  两侧互逆 + 旧位置参数形状各有单测；主进程同时读第 4 / 第 5 位，两份产物热重启错位也不会复发。
- **类型分类 tab 不再被切成一半**：切筛选时只在选中项被遮住时挪动，且只挪到「整颗可见 +
  8px 留白」；原先的「居中」必然把左邻 chip 推出容器，第一个分类只剩半个字。
- **去重改为无向判定**：A→B 与 B→A 的同名关系视为同一对，与渲染层「重复 → 合并」的口径一致，
  不再出现「弹层说合并 +1、库里却新插一行」。
- **画布记忆读失败不再按「首次打开」处理**：读取异常时按空白画布打开、只给提示，
  不再重新布局 / 播种 / 立刻写回（一次瞬时故障就会覆盖用户摆好的坐标）；该状态下禁止写回，
  「刷新 / 重新载入」成功后才恢复写。
- **坐标写库串行化**：多次 flush 挂在同一条 promise 链上，避免并发写导致磁盘 `rev` 倒退
  （之后每次提交都被误判 `stale`）；`dirty` 只在最后一次写入成功后清零。
- **坐标没写进去就中止提交**：`flush` 失败时不再带本地旧 `rev` 继续提交，
  错误提示改为「坐标没能保存」，与 `stale`（别处改过）区分开。
- 画布节点不进 Tab 序（`nodesFocusable={false}`）：200 个节点不再堵死键盘焦点序列，
  键盘路径统一由左侧池子承担。
- 「重新载入」不再恒报成功：`reload` 返回 `false` 时提示失败原因，避免用户在同一个
  `stale` 错误上反复重试。
- 窗口标题带作品名（`<作品名> · 关系网络`），多窗口切换时能分清是哪本书。
- 重复唤起图窗口不再静默换书：主窗口切到 B 后点开已存在的图窗口（主进程会补发
  `relation-window-context`），现在与 `novel-work-changed` 同口径挂起、由横幅确认，
  未确认的连线与未落库坐标不会被跳过。
- `electron/window-load-guard.test.ts` 补登记 `createRelationWindow`：此前装载守卫未纳入清单，
  失败时只会静默黑窗，测试也不会红。
- **更新日志分流脚本分组键修正**：`scripts/split-changelog.mjs` 此前只按数字 `minor` 分组，
  `1.46 > 2.0` 于是 1.46 被当成「最新次版本」留在主文件、2.0.0 反被归档（指针写着
  「归档到 2.0.0」却只保留 1.46.1 之后）。改为按 `major.minor` 双键分组与排序，
  并修掉「块之间不空行」的问题；新增 `electron/changelog-archive-guard.test.ts` 钉住
  「主文件保留的次版本必须严格新于所有归档」等 4 条不变量。

## [2.1.2] - 2026-10-20

### Changed

- **打包体积：`app.asar` 13.67 → 6.50 MiB（−52.5%），安装包 99.78 → 98.82 MiB（−0.96 MiB）**。  
  运行期依赖（`docx` / `mammoth` / `jszip` / `pako` / `bluebird` / `xml-js` / `underscore`）
  各自带了同一份代码的多种构建产物，而 Node `require` 只走 `exports.require` / `main` 指向的
  那一个 —— 浏览器 UMD/IIFE 版、ESM 版、包内 `dist/` 预打包副本、`node-addon-api` 纯头文件
  全是死重，合计 ~7 MiB 原始体积。逐条写进 `build.files` 排除，`docx` 只保留
  `dist/index.cjs`、`underscore` 只保留 `underscore-node.cjs` 链路。  
  同时补 `!**/node_modules/@types/**`：原有 `!node_modules/@types/**` 匹配不到
  `docx/node_modules/@types/**` 这类嵌套路径。
- **install 与运行期无任何行为变化**：打包产物解包后按包名（走 `exports`，与运行期一致）
  require 全部通过，并用「`docx` 生成 → `mammoth` 解析回来」的闭环 + `jszip` 往返 +
  `better-sqlite3` 真实 SQL 验证。`electron/packaging-guard.test.ts` 新增 11 条断言，
  含「任何运行期依赖不得被整包排除」的反向守卫。

### Docs

- 新增 `docs/packaging/bundle-slimming-2.1.2.md`：记录**压缩视角**的体积账
  （`app.asar` 压缩率 7.9:1、`.pak` 1.01:1、`CheckIn.exe` 占安装包 65.4%），
  解释「asar 再省 7.5 MiB 只换来 0.96 MiB 安装包」的原因，并列出剩余可动项
  （`resources.pak` 里 4.8 MiB Chromium 内置 FLAC 音效、`chrome_200_percent.pak`、
  `dxil.dll`、BCJ2 因 NSIS 内置解压器不支持而不可用）及其风险。

## [2.1.1] - 2026-10-20

### Fixed

- **修复 pnpm 9 环境下 `pnpm install` 必然失败（`gyp ERR! find VS`）**。  
  `better-sqlite3@13` 已无 `install` 脚本，但包内保留 `binding.gyp`；npm/pnpm 的既有约定是
  「有 `binding.gyp` 且无 `install` 脚本 → 默认执行 `node-gyp rebuild`」，于是没有 VS C++
  工作负载的机器会 `gyp ERR! find VS` 并让整个安装以 `exit 1` 结束。  
  根因是白名单位置：`pnpm-workspace.yaml` 里的 `allowBuilds` / `onlyBuiltDependencies`
  **pnpm 9 完全不读**（实测 9.15.9，连 `nodeLinker` 也不读，布局靠 `.npmrc` 的
  `node-linker=hoisted` 兜住）。现改为在 `.npmrc` 用 `only-built-dependencies[]` 声明 ——
  这是 pnpm 9 唯一生效的位置，pnpm 10+ 侧仍读 `pnpm-workspace.yaml` 的 `allowBuilds`，
  两套并存且语义一致。  
  同时移除 `package.json` 的 `pnpm` 字段：pnpm 11 已完全不读它，每次安装都会打印
  `The "pnpm" field in package.json is no longer read by pnpm` 警告。
- **修正文档中一条错误结论**：原文称「`better-sqlite3` 13 起无 install 脚本，白名单对它
  不再起作用」——没有 `install` 脚本不等于不会构建。AGENTS.md §8.7 已改为
  「必须显式 `allowBuilds: better-sqlite3: false`」，并补了 pnpm 9 / 11 配置来源对照表。

### Changed

- `README.md` 新增排查项「pnpm 9 安装失败 `gyp ERR! find VS`」，含现象、根因、处理与两个
  附带注意（pnpm 9 会重写 `pnpm-lock.yaml` 丢掉 pnpm 11 的 peer 后缀，装完应
  `git checkout -- pnpm-lock.yaml`；根治办法是 `corepack enable` 统一到 11）。

## [2.1.0] - 2026-10-20

### Changed

- **Electron `42.4.1` → `44.9.0`**（Chromium 148 → 152、Node 24.15 → 24.22、ABI 146 → 149）。  
  **业务代码零改动**：44 的破坏性变更（渲染进程不再暴露 `clipboard`、移除 Win ia32 / macOS 12
  预编译、`net.request` 强制 `Sec-Fetch-Mode`、移除 Unity、`select-client-certificate` 等）本仓
  **一条都没命中** —— 6 处复制全走 `navigator.clipboard`，全仓无 `net.request` / `net.fetch`，
  仅出 win-x64，preload 未透出 clipboard。  
  44 把 ANGLE 改为静态链入，`libEGL.dll` / `libGLESv2.dll` 不再分发（−8.09 MiB），但
  `electron.exe` 232,313,344 → 247,184,896 B（+14.18 MiB）、`resources.pak` 6,876,399 →
  12,436,085 B（+5.30 MiB）、`chrome_*_percent.pak` +1.59 MiB。**分发包未压缩合计
  300.82 → 314.13 MiB（+13.31 MiB）**，`release/win-unpacked` 269.09 → 282.17 MiB（+13.08 MiB）。
  即：**升级本身不带来瘦身，省下的 8 MiB 被 Electron 自身的增长吃掉**。安装包
  85.26 → **99.78 MiB（+14.52 MiB / +17.0%）** —— 增量集中在 `electron.exe` 与
  `resources.pak`，两者压缩率低于均值，所以安装包增幅略高于未压缩增幅。
- **`better-sqlite3` `12.11.1` → `13.0.3`（NAN → Node-API）**：13.0 起改为 N-API，8 个平台的
  预编译二进制随 npm 包分发（`prebuilds/*.node`），**与 Electron ABI 彻底解耦**，升 Electron
  不再需要按 ABI 重编译。
- **移除整条原生模块重编译链路**：删除 `scripts/rebuild-native.mjs`、`electron:rebuild` 脚本、
  `@electron/rebuild` 直接依赖，`electron:setup` 简化为 `pnpm install && pnpm ensure:electron`；
  `dev-doctor` 的检查路径由 `better-sqlite3/build/Release/better_sqlite3.node` 改为
  `better-sqlite3/prebuilds/win32-x64.node`。
- **`electron-builder` `25.1.8` → `26.17.0`**：v26 移除 `app-builder-bin`，原生模块处理改由
  `@electron/rebuild` 接管（已是 `app-builder-lib` 的直接依赖）。本项目 `npmRebuild: false`，
  打包时**不会**触发重建 —— 这正是 N-API 方案"零重编译"能成立的前提。
- **打包白名单跟进新二进制路径（关键）**：`asarUnpack` 由
  `node_modules/better-sqlite3/build/Release/*.node` 改为
  `node_modules/better-sqlite3/prebuilds/win32-x64.node`。13.x 里 `build/Release` **根本不存在**
  （解析路径见 `lib/binding.js` 的 `getPrebuildPath()`），不改就是**静默失效**、运行期
  `Cannot locate the bindings file`。  
  同时 `build.files` 增加 4 条排除，剔除另外 7 个平台的预编译（`darwin-*` / `linux-*` /
  `linuxmusl-*` / `win32-arm64`，合计约 18 MiB 纯冗余）。实测产物：`app.asar` 14,447,397 →
  14,338,215 B（−0.10 MiB），`app.asar.unpacked` 里**只有一个** `prebuilds/win32-x64.node`
  （1,989,632 B），非本平台 `.node` 数量为 0。
- **pnpm 侧三处修正**（否则 `pnpm install` 直接 exit 1）：
  - `allowBuilds.better-sqlite3: false`：13.x 包内没有 install 脚本却留着 `binding.gyp`，
    而 npm/pnpm 的既有约定是「有 `binding.gyp` 且无 install 脚本 → 默认执行 `node-gyp rebuild`」，
    无 VS C++ 工作负载的机器会 `gyp ERR! find VS` 把整个安装带崩。显式拒绝构建即可直接用预编译。
    ⚠️ **该字段是 pnpm 11 才认的**，`pnpm -v` 为 9.x 时会被忽略（本次踩到），需用
    `npx pnpm@11.25.0 install`。
  - `overrides.fast-uri: 3.1.8`：ajv 的传递依赖 3.1.9 发布于安装当天，触发 pnpm 11 的
    `minimumReleaseAge` 供应链策略拦截；钉到上一个补丁版，而不是给新包开豁免口子。
  - `overrides.electron-builder-squirrel-windows: 26.17.0`：对齐 `app-builder-lib@26` 的精确
    peer，消除告警并清掉整棵 `app-builder-lib@25` 老树（本项目只用 nsis）。

### Fixed

- **`packaging-guard.test.ts` 的 `asarUnpack` 断言路径**同步更新（原来写死
  `build/Release/`，升级后会假红），并新增「排除非本平台预编译」不变量。
- **`after-pack.js` 注释按 44 复核**：清单内 7 个文件在 44 的 dist 中全部仍存在、且**没有新增**
  可清理文件；`dxil.dll`（1.44 MiB）继续保留 —— ANGLE/Dawn 的 HLSL 编译有 DXC
  （`dxcompiler.dll`+`dxil.dll`）与 FXC（`d3dcompiler_47.dll`）双路径，删掉本地 DXC 会回退到
  系统目录自带的 FXC，留 1.44 MiB 作回滚缓冲。实测 afterPack 单次清理 54.76 MB。

### 待实机验证（沙箱无法启动 GUI，无法代跑）

升级后必须人工确认：① 6 个透明无边框圆角窗口的四角渲染与阴影；② 托盘反复显示/隐藏是否闪白；
③ `图形` 相关崩溃（若白屏，优先把 `dxcompiler.dll` 从 `DELETE_FILES` 移除）；④ 模板下载落盘位置
与 toast「已下载到「下载」文件夹」是否一致；⑤ SQLite 读写与用户切换。完整 14 项清单见
`docs/electron-44-upgrade-precheck.md` §7。

## [2.0.0] - 2026-10-19

### Changed

- **打包依赖归位**：`package.json` 的 production `dependencies` 由 23 个收到 **4 个** ——  
  只保留主进程运行期真正 `require` 的 `better-sqlite3` / `docx` / `jszip` / `mammoth`。  
  `antd`（57.08 MiB）、`@ant-design/icons`（11.59）、`react-dom`（6.98）、  
  `framer-motion`（4.44）、`react-router`（3.61）、`motion-dom`（3.10）、  
  `lunar-typescript`（1.22）、`@codemirror/*`、`@dnd-kit/*`、`codemirror`、`dayjs`、  
  `marked`、`react`、`react-virtuoso`、`zustand` 共 19 个纯渲染层依赖迁到  
  `devDependencies`（版本区间不变，只换 section）。依据：这些包在 `electron/**` 中  
  零导入，且早已被 Vite 打进 `dist`。electron-builder 会把 `dependencies` 整棵依赖树  
  塞进 `app.asar`，这份是 100% 冗余，**没有任何运行期症状，只有安装包悄悄胖 5 倍**。
- **`app.asar` 117.34 MiB → 13.78 MiB（−88.3%，123,035,304 → 14,447,397 B）**；  
  其中 `node_modules` 逻辑体积 121.89 MiB → 11.81 MiB（−90.3%），asar 内文件数  
  19,579 → 1,162（−94.1%），包数 160 → 62。剩下的全部是上面 4 个包及其真实传递依赖  
  （`docx` 4.32 MiB / `mammoth` 2.26 / `better-sqlite3` 1.86 / `pako` 759.5 KiB /  
  `jszip` 721.9 / `underscore` 594.6 / `xml-js` 375.2 KiB，其余 55 个包均 < 200 KiB）。
- **`asarUnpack` 收窄到原生模块本体**：`node_modules/**/*.node` →  
  `node_modules/better-sqlite3/build/Release/*.node`。原写法命中一条 `.node` 即触发  
  smartUnpack 把整个包外置，连带 `deps/sqlite3.c`（9.8 MB）、`src/*.cpp`（162 KB）等  
  编译期物料一起进安装包。`app.asar.unpacked` 因此从 11.73 MiB 降到 **1.86 MiB（−84.2%）**，  
  目录里只剩 `build/Release/better_sqlite3.node` + `lib/` + `LICENSE` + `package.json`。
- **`build.files` 增加 node_modules 冗余排除**：`*.map` / `*.md` / `*.d.ts` /  
  `{test,tests,__tests__,spec,docs,example,examples,benchmark}/**` / `@types/**` /  
  `better-sqlite3/{deps,src}/**`。其中 `@types` 一条针对 docx 把 `@types/node` 声明成  
  运行时依赖（纯类型，无运行期用途）。
- **locale 裁减前置到打包阶段**：新增 `build.electronLanguages: ["zh-CN","en-US"]`，  
  替代 `after-pack.js` 事后删 53 个 `.pak` 的兜底；`locales/` 由 55 个文件（48 MB）  
  降到 2 个，`afterPack` 的 locale 清理退化为兜底（配置被改回默认时仍能收口）。
- **`release/win-unpacked` 383 MiB → 269 MiB（−29.7%，401,103,686 → 282,160,683 B）**。
- **安装包 101.48 MiB → 85.26 MiB（−16.0%，106,407,729 → 89,402,895 B）**，  
  `compression: "maximum"` 不变；剩余大头是 Electron 自身的 `CheckIn.exe`（232 MB）  
  与 `icudtl.dat` / `resources.pak`，非本次治理范围。
- **`scripts/after-pack.js` 清理逻辑可核对**：删除清单移除死条目 `LICENSE.electron.txt`  
  并显式保留 `LICENSE`（Electron 的 MIT 许可证必须随分发保留）；`dxil.dll`（1.44 MB）  
  明确不删 —— 它与已删的 `dxcompiler.dll` 配套，本次不升级 Electron、无法实机验证  
  GPU 回退路径，1.44 MB 收益不值得白屏风险（待 Electron 44 实机回归后评估）。  
  缺失文件不再静默（debug 级），结尾打印「共节省 X MB / 剩余 locales 数量」  
  （本次实测：删除 Chromium 物料 54.54 MB，剩余 locales 2）。

### Added

- **`scripts/analyze-asar.mjs` + `pnpm analyze:asar`**：读 asar header（`getRawHeader()`，  
  不解包）输出顶层分区体积、node_modules 按包排序（≥ 200 KiB）、分区小计与总逻辑体积；  
  `--json` 便于前后对比，末尾固定打印 `ASAR_BYTES=<磁盘真实字节>` 供脚本取数。  
  用途：改动打包配置后一条命令留痕，不再靠猜。
- **`electron/packaging-guard.test.ts`（5 组 / 10 个测试用例）**：钉死四条不变量 ——  
  production `dependencies` 严格等于 `['better-sqlite3','docx','jszip','mammoth']`；  
  `vite.config.ts` 里 external 的包必须都在 `dependencies` 且双向一致（防「打包后  
  Cannot find module」）；`build.files` 必带 `@types` 与 `better-sqlite3/{deps,src}` 排除；  
  `asarUnpack` 只允许 better-sqlite3 的 `.node`；`version` 为合法 semver 且 major ≥ 2。  
  解析源码做断言前统一 `stripComments()`（§6.6）。
- **`AGENTS.md` §6.8「打包与依赖归位规范（2.0.0）」**：三条铁律 ——  
  ① 判断 `dependencies` / `devDependencies` 的唯一标准是「主进程运行时是否 `require` 它」，  
  渲染层依赖即使被 import 也必须进 `devDependencies`；② 新的主进程 Node 依赖必须**同时**  
  进 `vite.config.ts` 的 external 与 `package.json` 的 `dependencies`；③ 原生模块  
  `asarUnpack` 必须精确到 `.node`，改动打包配置后必须 `pnpm analyze:asar` 留痕。  
  同步更新 §8.5 的 external 清单说明。
- **`docs/packaging/bundle-slimming-2.0.0.md`**：本次治理的完整取证记录 ——  
  问题定位（四条证据链）、改动清单（文件:位置 + 为什么）、优化前后体积对比表、  
  可复制的验证命令、未做项与后续（Electron 44 / `dxil.dll` / electron-builder 26）。
- **`@electron/asar@^3.4.1` 显式进 `devDependencies`**：`analyze-asar.mjs` 直接用到  
  它的 `getRawHeader()` / `listPackage()`，不再依赖「electron-builder 的传递依赖恰好被  
  hoist 到根目录」这种运气；同时补上 `scripts/split-changelog.mjs` 在「无需分流」  
  场景下直接退出的分支（原来会在 `archived[0]` 上抛 TypeError）。

### Fixed

- **`pnpm-lock.yaml` 的 importers 与依赖归位不一致**：`pnpm install --lockfile-only`  
  重写 `importers['.']`，19 个包从 `dependencies` 落到 `devDependencies`（锁版本不变）。
