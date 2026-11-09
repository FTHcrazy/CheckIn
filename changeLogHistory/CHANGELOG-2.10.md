# Changelog · 2.10.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.10.6] - 2026-10-28

### Fixed

- **划词右键菜单在正文底部被截断，下半截功能点不到**：菜单项随「文本变换 /
  记入行囊 / 新建资料卡 / 绑定到现有资料卡」一路增加到近 500px 高，而落位仍在
  沿用早期的「约 190×320」估算夹取。菜单是 `.nv-page__stage`（`overflow: hidden`）
  里的绝对定位浮层，底边一越过 stage 下沿就整块被裁，且没有滚动条——
  实测（760×550 的 stage、10 条绑定项）：旧实现把菜单底推到 742px，
  **超出 192px**，最后一条绑定项完全落在裁切区外。
  - **改为实测落位**：`EntityContextMenu` 在 layout effect 里量自己的
    `scrollHeight`（不用 `offsetHeight`，否则套了 `max-height` 之后会量到压缩高度、
    越算越矮），连同 stage 的 `clientWidth/clientHeight` 交给新的纯函数
    `placeContextMenu`：下方放得下就地展开 → 放不下翻到光标上方 → 上下都放不下
    才夹到底部留白并给 `max-height` 让菜单内部滚动。同一组几何用例下六种位置
    全部 `overflowsBottom: false`，最后一项可被 `elementFromPoint` 命中。
  - **去掉 EditorPane 里的估算常数**（`stageRect.height - 320` /
    `width - 208`）：坐标只负责「相对 stage」，落位责任单一归菜单组件。
  - **样式兜底**：`.nv-ctxmenu` 补 `max-height: calc(100% - 16px)` +
    `overflow-y: auto` + `box-sizing: border-box`，即使 JS 量不到 stage 尺寸，
    菜单也不会再被 `overflow: hidden` 切掉（不计 border-box 会多出 14px 顶出下沿）。
  - 新增 `placement.test.ts`（9 条几何用例）与 `ctx-menu-placement-guard.test.ts`
    （实测高度 / 落位收口 / 旧常数反向断言 / 样式兜底），防止「菜单再加几项
    就复发」。

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
