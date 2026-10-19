# Changelog · 1.45.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [1.45.1] - 2026-10-16

### Changed

- **`AGENTS.md` §6.7「架构重构模式开关」的声明块改回 `compat`**：声明块写的是
  `"novelArch": "refactor"`，而同节「变更记录」里 1.33.0 / 1.36.0 / 1.39.0 三次都写明
  「已按本节第 4 条改回 `compat`」—— 声明块是**唯一事实源**、变更记录只是历史，
  两者长期打架会让下一次会话按错误的状态开工（1.45.1 这一轮的全部修复都是**按
  `compat` 语义**做的：写增量迁移、不丢老数据）。已把声明块改为 `compat`，
  并在声明块下补一行提示「取值以声明块为准，不要拿变更记录反推当前值」。

- **校正 `AGENTS.md` 与实现的文档漂移**（走查 E1~E15，纯文档、无代码改动）：窗口表补
  `PackWindow` / `GlobalSettingWindow`（§2.2.0 原只列 4 个，实现是 6 个）；BaseWindow
  页面列表去掉不存在的 `UserPage`、补 `Ledger` / `News` / `Home`；`shared/services` 补
  checkin / ledger / news / novel-shared，`shared/styles` 补 widget / scrollbars，
  `shared/components` 收敛为「代表性子集 + 其余略」；NovelWindow 目录树补
  `BookshelfPage`；主进程目录树补 `novel-db.ts` / `edition.ts` / `httpSession.ts`（§1.1
  架构图与 §9.2 索引同步补双库与 session 两处）；§6.3 把「IPC 注册在 `main.ts`」更正为
  `handlers/xxx-handlers.ts`（main.ts 只注册窗口级通道）；§6.7 存储锚定
  `electron/novel-db.ts` 并显式排除 `db.ts`；vite external 补 `jszip`（§5.1 与 §8.5 两处）；
  pnpm 构建白名单位置由 `package.json`（该字段根本不存在）更正为 `pnpm-workspace.yaml`；
  删除幽灵组件引用 `EmptyState` 与方向已反转的「SCSS 变量不足」债务条目。
  目录树/清单类一律改「代表性子集 + 完整清单以目录为准」，避免下次再漂移。

- **设定 DTO → 领域对象的映射收口成唯一实现**（走查 N-06）：同一套字段映射在渲染层写了
  两份 —— `NovelPage.tsx` 的 `refreshGlobalCategories`（逐字段直传、**无任何兜底**：
  `note` 缺失就是 `undefined`、`levels` 非数组直接抛）与 `GlobalSettingWindow` 的
  `useGlobalSetting.toCategory` / `toLevel`（带 `?? ""` / `?? 1` / `Array.isArray` 的防御）。
  两者对**合法 DTO** 输出一致，差异只在「缺字段 / 坏结构」时暴露 —— 而这恰是 IPC 边界
  最常见的输入形态，且加一列就会漏一处。现合并为 `src/shared/novel/setting-mappers.ts`
  的 `toSettingLevel` / `toSettingCategory(dto, { workId, withRefCount })`，口径取防御更
  完备的那一份，两处调用点改为调用它：
  - 形态差异（作品归属 `workId`、引用计数 `refCount`）走 `options` 承载，不改函数体 ——
    全局域传 `{ workId: "", withRefCount: true }`。⚠️ 漏传 `withRefCount` 会**静默**丢掉
    列表里的「N 部书引用」徽标（REQ-041），已用从**装载结果**读取的测试钉住。
  - 14 个字段逐一对照，唯一行为差异是 `levels` 的兜底由 `(dto.levels ?? []).map` 变为
    `Array.isArray(dto.levels) ? … : []` —— 合法 DTO 完全一致，坏数据（非数组）不再抛
    `TypeError`，属**升级**。
  - 影响范围：渲染层两份映射 → 一份；对外 IPC 契约与 UI 无变化。

- **正文字数统计口径收口**（走查 N-07）：渲染层有两份 `countWords`，口径不同 ——
  `NovelPage/novel-utils.ts` 按**码点**（`/\S/gu`），
  `BookshelfPage/import/novel-import-parser.ts` 按 **UTF-16 码元**（`\s` 不带 `u`）。
  BMP 文本结果一致，但含**星平面字符**（emoji、CJK 扩展 B 区）时差 1：编辑器按码点、
  导入按码元 ⇒ **导入进来的章节字数莫名比编辑器里显示的多**。现统一到
  `src/shared/novel/word-count.ts` 的 `countWords(text, mode)`，口径按**码点**（与编辑器
  现行那份逐字节一致）；`novel-utils.ts` 改为 re-export（既有引用路径不变），导入解析器
  保留原函数名与签名、内部改调共享实现（调用方零改动）。导入路径对星平面字符的计数因此
  由「码元」变为「码点」，这是一次**有意的口径统一**。
  - ⚠️ 走查原文称「渲染层 + 主进程各一份」——**核实后不成立**：主进程只经 IPC **接收**
    前端算好的 `wordCount`、不做统计。真实分歧只在上面这两处渲染层实现之间。

### Fixed

- **「全局设定中心」窗口点不开**（1.45.0 真机反馈）：静态链路（书架按钮 → preload
  白名单 → `ipcMain` 监听 → 入口清单）逐环核对都是通的，真正让窗口「点了什么都不
  发生」的是**产物陈旧 + 失败路径全静默**这两件事叠加 —— 任意一条单独命中都表现为
  同样的「无反应、无报错、无日志」：
  - **装载失败不再静默且必有窗口**：各功能窗口一律 `show: false`，只在
    `did-finish-load` 里 `show()`。一旦装载失败（`dist/` 里没有该窗口的 HTML →
    `app://` 读盘 ENOENT；或运行中的主进程还是旧代码、根本没有这条 IPC 监听），
    `did-finish-load` 不会触发 → 窗口永不出现、主进程一行日志都没有。
    `electron/main.ts` 新增 `attachWindowLoadGuard()`，Base / Novel / Settings /
    Pack / GlobalSetting / Login 六个窗口统一接入：打印 `did-fail-load`
    （errorCode / errorDescription / validatedURL）与 `render-process-gone`，
    并在 `did-finish-load` 之外用 3s 超时兜底 `show() + focus()` ——
    显示一个错误页也好过什么都不显示。主窗口的兜底走自己的登录闸门（不无条件 show），
    装载失败同样标记「就绪」，避免登录后没有任何窗口可显示。
  - **`global-setting-window-open` 加一行明确日志**（「收到 …，开始创建窗口」）：
    终端里一眼分清「点击没到达主进程」（主进程陈旧 / 白名单）与「窗口创建环节失败」。
  - **过滤 ERR_ABORTED(-3)**：`did-fail-load` 在**导航被主动取代**时报 -3（重定向、
    被新的 `loadURL` 顶掉、装载途中窗口被关闭），那不是装载失败。不过滤的话，
    dev 下正常热重载窗口就会打印一行「装载失败」并把错误页顶到用户面前 ——
    与这条修复要治的「静默」正好相反，是自造的误报噪音。
  - 影响范围：仅新增日志与兜底显示；正常路径行为不变 —— 行囊上下文的下发时序、
    单实例唤起语义、`attachCloseGuard` 行为均保持原样。
- **渲染层与 preload 版本错位导致的白屏**：`useGlobalSetting.reload()` 原先直接调用
  `api.globalSettingLoad()`，当 `window.electronAPI.novel` 存在但缺这个方法时是
  **同步 TypeError**，而 `reload` 由 `useEffect` 调用 → React 卸载整棵树，用户看到
  一片白屏。现改为显式判空，失败统一落到**可见错误态**（「全局设定库装载失败」+
  原因 + 「重试」），不再与「库里一个设定都没有」的空态混淆。
  影响范围：仅 `GlobalSettingWindow` 的装载分支，写操作与 `SettingCenter` 契约不变。
- **主进程改了不生效（dev）**：`vite.config.ts` 两处 `onstart` 都是空函数，
  `vite-plugin-electron` 仍以 watch 模式重建 `dist-electron/`，但运行中的 Electron
  不会重启 —— 渲染层靠 HMR 已经是新代码，主进程还是旧的，表现与「功能坏了」完全
  一样（新增 IPC 通道 / 新窗口点了没反应且无日志）。
  `scripts/start-electron.js` 现在自己监视 `dist-electron/*.js`（400ms 防抖，
  只认 `.js`，忽略 `.map`），产物一变即重启子进程并打印原因；
  二进制缺失的 fail-fast 守卫、`ELECTRON_RUN_AS_NODE` 清理与「静默秒退」诊断全部保留
  （热重启后的首次失败会额外提示优先看编译报错）。
  另修一处**关机竞态**：防抖定时器触发后 `restartPending` 置位并 kill 子进程，
  若用户在 close 事件到达之前按 Ctrl+C（或 `concurrently -k` 发来 SIGTERM），
  重启分支会把 Electron **又拉起来** —— 表现为「Ctrl+C 之后窗口又冒出来」，还得再杀一次。
  现在重启分支要求 `!shuttingDown`，`shutdown()` 同时复位该标记。
- **书窗口的「引用实时同步」实际不生效（走查 P0-1）**：1.45.0 的实时同步只做在主进程
  —— 全局库写成功后会按 `source_global_id` 把新值 upsert 进本书的 `novel_setting_*`
  镜像行，**库里的数据是对的**；但编辑器窗口的内存快照（`useNovelData` 的 `bundle`）
  从不跟进：全仓只有全局设定中心窗口自己订阅了 `global-setting-changed`。于是
  「在全局库里改名 → 回书窗口，设定中心还是旧名字」，要切作品或重开窗口才看得到，
  1.45.0 写的「即时跟随」不成立。
  现在书窗口数据层也订阅该广播，收到后**只重读设定并就地合并**：
  - 只换 `settings` 一张表：走 `novel-editor-load` 的 `includeContent = false`
    （正文是唯一大字段，不进 IPC），`chapters` / 编辑器草稿 / 关联一律不动 ——
    这保住的是「本章 `chapter` **对象引用不变**」这条不变量：`NovelPage` 把它作为
    `activeChapter` 传给**没有 key** 的 `EditorPane`（`NovelPage.tsx:510`），而
    EditorPane 取的是 `draft ?? chapter?.content`——引用一变就可能重挂载 / 重新灌入，
    正在编辑的正文基线随之被顶掉（整体 `load()` 会换掉 chapters 的每个对象，正是
    这样踩的雷）；
  - 只替换**引用态**的行（判据看「当前行是不是引用」，覆盖全局项被删后就地固化、
    `sourceGlobalId` 变 null 的那一行）；书内自建分类的编辑照旧不受影响；
  - 本书没有任何引用项时不发请求（整条链路不空转）；装载在途时跳过
    （装载响应本身就带库内最新值）。
  - 影响范围：仅 `NovelWindow` 编辑器数据层；IPC 通道 / preload / 主进程均未改动。
- **设定中心组件树脱离「组件库优先」守卫（走查 P1-1）**：UI-10 拆分时设定中心从
  `pages/NovelPage/components` 迁到 `src/shared/components/SettingCenter`，而
  `novel-ui-kit.test.ts` 的扫描根写死 `src/windows/NovelWindow` —— 那一整棵组件树
  从此不再受 §6.1.2 约束（原生控件、`<Button>` 嵌 `<Button>`、漏清零点都不会报）。
  扫描根扩为「NovelWindow ∪ SettingCenter」后扫出两处：
  - `nv-sc__publish`（分类卡「放置到全局」）**确有一处静默失效**：文字色写成
    `&__publish { color: …; &:hover { color: … } }`，hover 那一条特异性只有
    (0,1,0)+伪类，会被 antd 的
    `.ant-btn-color-default.ant-btn-variant-outlined:not(:disabled):hover`（0,4,0）
    压掉 —— 表现为「鼠标一掠过就变回默认字色」。现改为挂在
    `.nv-sc__publish.ant-btn` 上、只覆盖 default 变体的三个颜色变量，尺寸仍由
    `size="small"` 给（不清零）。
  - `nv-sc__from-global`（左栏「从全局库选择」）只补了一条 `margin-top`
    （antd 不接管的布局属性），造型完全交给组件库。
    两处按「不需要清零点」收录进守卫的 `NO_RESET_NEEDED` 并写明理由，未做清零 ——
    清零要把同排按钮的高度 / 描边手工复刻，antd 升版即不齐。
  - 影响范围：`SettingCenter` 内两个按钮类的写法（其中一处修掉真正失效的声明），
    以及守卫的扫描范围。

- **全局设定窗口「窗口套弹窗」**（真机反馈）：独立窗口里整窗又套了一张 antd Modal ——
  窗口标题栏写「全局设定中心」，浮层标题再写一遍「全局设定中心」，右上角多出第二枚
  关闭叉，还多一层遮罩（为了点得到窗口的最小化 / 最大化 / 关闭三键，窗口侧被迫把
  标题栏 `z-index` 抬到遮罩之上）。根因是复用本书设定中心时只换了**数据源**、
  没换**外壳**：本书域的设定中心是浮在编辑器之上的可关闭浮层，而独立窗口整窗就是
  这一张设定中心。
  `SettingCenter` 新增 `variant?: "modal" | "panel"`：`panel` 形态**不再渲染外层
  Modal**，组件直接铺满宿主容器（`GlobalSettingWindow` 传 `variant="panel"`）。
  - 主体 JSX 抽成一个变量供两种外壳共用，不复制第二份 —— 复制会让标题 / 空态 /
    四个弹窗在两条形态里各自漂移，改一处漏一处；
  - 原浮层标题里的「跨书共享」pill 移到窗口标题栏的徽标插槽，语义不丢；
  - 高度改由 flex 分配（`flex: 1` + `min-height: 0` 给 `__body-grid` 确定高度，
    左栏与阶梯行各自的滚动链照旧生效），不再用浮层时代的 `calc(100vh - 260px)`
    硬算 —— 那个 260px 会随标题栏 / 工具头高度变化而失准。
  - ⚠️ 行为变化：`panel` 形态下 `onClose`（Esc / 点遮罩）不再生效，关窗只走窗口三键。
    这是有意的 —— 本窗口是设定编辑器，行内编辑改到一半被 Esc 连窗一起收掉会丢草稿。
  - 影响范围：`SettingCenter` 的呈现外壳（`source` / 回调契约 / 数据流一律未动）；
    本书域浮层形态行为不变（`variant` 缺省仍是 `modal`）。

- **分类卡「放置到全局」的文字色不跟随主题**（1.45.1 真机反馈）：上一轮把它的文字色
  修成「挂 `.ant-btn` 变量」之后，取的仍是 `--app-accent-teal`。按 §6.1.1，强调色是
  「数据卡 / 功能卡的彩色标识」，**跨主题基本恒定**：无头 Chrome 跑真实产物 + antd
  运行时 CSS 实测四套主题的计算色为 `#2fa57e / #4fa88c / #2fa57e / #4fd0a5` ——
  `aurora` 与 `mint` **完全相同**、`cream` 只差一点，只有暗色明显不同，于是换肤时
  这颗按钮「看着不动」。
  - 改为 `--app-primary`（各主题的**身份色**：蓝 / 橘 / 绿 / 淡紫），三态分别给
    `primary` / `primary-strong` / `primary-active`，hover 与按下才有反馈
    （暗色的 `strong` 是**提亮**，符合 `themes.scss` 里那条约定方向）。实测四套主题
    计算色变为 `rgb(91,108,249)` / `rgb(232,131,74)` / `rgb(47,165,126)` / `rgb(123,140,255)`。
  - 影响范围：单条 CSS 变量规则；`.nv-sc__publish.ant-btn` 的写法与「不清零」结论不变。

- **6 处常驻中性底误用交互态色 `--app-surface-hover`**（走查 N-08）：`--app-surface-hover`
  按 `themes.scss` 的分层说明，本义是「**相对所在面的交互态**」，只允许出现在
  `:hover / :active / :focus` 里，或写在属性名自带状态的 `--ant-*-hover-bg` 上；
  静态铺开会让整屏比其它模块重一档（旧守卫只扫 `--app-surface-active`，这一类因此
  一直没有红灯）。逐处按「最近一个真正画了背景的祖先」核验基面后归正：
  - 贴 `--app-surface` 的槽（设定窗口分区标题条 / 备忘预览表格隔行 / 写作状态条进度槽 /
    书架续写进度槽）→ `--app-surface-alt`；
  - 贴浮层 `--app-surface-elevated` 的槽（悬浮资料卡标签 `.nv-pop__tag`，elevated 上
    1.127~1.134 明显过重）→ `--app-surface`；
  - 工具箱状态 chip `.nv-tools__state`：非 live 的 chip 只落在 `.is-planned` 卡上，
    而该卡底是 `--app-surface-alt` ⇒ 基面是 alt，**槽要取高一档的 `--app-surface`**
    （取 alt 会与基面同色消失、取 hover 是禁用的交互态档）。这是本轮唯一「底色方向
    由凹变凸」的一处，需真机确认观感。
  - 顺带更正两处失真表述：`StatusBar/index.scss` 的原注释称该槽「贴在页面底
    `--app-bg` 上」（实际宿主 `.nv-status` 铺的是 `--app-surface`）；
    `themes.test.ts` 的守卫 docstring 把「状态条 / 书架进度条轨道」当作「贴 `--app-bg`
    用 `surface-hover`」的范例（同样与实现相反）。
  - ⚠️ **复核后判定为合法、刻意保留**（判据不是「用了 hover 档就是错」，而是**相对它
    真正贴着的那一面差几档**）。用脚本扫全仓 `background*: var(--app-surface-hover|active)`
    共 38 处，逐处向上取规则头，34 处落在 `:hover / :focus-visible / .is-active` 里
    （合法交互态），其余四处全部核到基面为 `--app-surface-alt`：
    `.nv-panel__tabs`（SupportPanel/index.scss:187）、`panel-primitives.scss` 的
    `.nv-sub`(:98)、检索面板骨架条(SearchPanel:48)、`EntityDetail` 的 `&__tag`(:277)
    —— `.nv-panel`（SupportPanel/index.scss:32）本身就是 alt 档底，取 hover 档恰好是
    「比基面再深一档」的凹槽（四主题 alt→hover ≈1.05），**方向正确**；改用
    `--app-surface-alt` 反而会与基面同色消失。
    另有 `NovelTopBar` 的 `--ant-button-default-bg: var(--app-surface-hover)`：
    顶栏底 `--app-header-bg` 与 `--app-surface` 同值，改用 alt 后四主题实测只差
    1.027~1.052，六颗图标又会退回 1.42.0 要修的「一排灰点」，且该三档已被
    「顶栏 chip 底色三档」守卫钉死 ⇒ 属有意决策，不动。
    以上结论已写进 `themes.test.ts` 的 N-08 守卫 docstring，免得下一轮重复翻账。
  - 影响范围：6 条 CSS 变量规则 + 2 处注释 + `themes.test.ts` 新增一条精确清单守卫
    （**只含显式文件/选择器清单，不扫全仓**，避免误伤合法的 `:hover`）。

- **全局设定中心删除分类的二次确认用了原生 `window.confirm`**（走查 N-05）：原生弹窗在
  Electron 里与主题完全脱钩（暗色下是一块系统白底）、无法走组件库统一交互，且违反
  §6.1.2「UI 一律组件库」。改为 antd `Modal.useModal()` 的**实例方法** `modal.confirm`：
  - 为什么不用静态 `Modal.confirm`：它新建独立 React root、脱离 `ConfigProvider`，而本
    应用用 `cssVar: { prefix: "ant" }` + `hashed: false` —— 脱离上下文后拿不到主题变量，
    暗色主题会掉色。`modalContextHolder` 因此由 `GlobalSettingWindow/App.tsx` 渲染在
    `ThemeProvider` / `ConfigProvider` **子树内**（模态框的 DOM 仍 portal 到 body，继承靠
    的是 React context）。
  - 语义不变：`refCount === 0` 直接删（不打扰）；`refCount > 0` 才弹确认（文案含引用数）；
    确认才发删除 IPC，取消即返回。确认框不硬编码任何色值，全走 antd token。

- **全局设定中心有一组「点了没反应的假入口」**（走查 N-04）：`App.tsx` 给 `SettingCenter`
  传了 5 个**空实现**的模板回调（`onSaveTemplate={() => {}}`、`templates={[]}` …），而组件
  **无条件渲染**模板入口 —— 点「模板库」是一片空列表、点「另存为模板」什么都不发生，
  是对用户的假承诺。
  - 改为**显式可选**：5 个模板 props 齐备才算「本形态提供模板能力」（`hasTemplateCapability`
    为唯一判据），调用方改为**不传**而不是「传个假的」（已删掉那 5 个空实现）。
  - ⚠️ 门控**只覆盖模板相关**：`SaveTemplateModal`、「另存为模板」菜单项、模板库弹窗内的
    「我的模板」区块（弹窗新增 `showTemplates`）。**「模板库」入口与空态 CTA「套用内置预设」
    必须保留** —— 内置预设是**纯本地能力**（`setting-presets.ts` 的 `SETTING_PRESETS` 常量
    + 必填 prop `onApplyPreset`，全局库有真实实现），把它们一并门控会让全局库白白丢掉
    「套用内置预设」。本轮修正过一次这种过度收紧（先按同一判据全收，再拆成两个判据）。
  - 弹窗里「我的模板 · 全局库暂不支持另存模板」那句假区块也删了：它下面跟着一个恒空列表，
    仍然是假承诺。
  - 影响范围：`SettingCenter` 的 props 契约（模板 5 项由必填改为可选）+ 4 处渲染门控；
    预设能力、本书形态行为不变。

### Tests

- `src/windows/GlobalSettingWindow/App.test.tsx`（6 例）钉住上面第二、三、四条：
  装载成功后设定中心确实挂出，且**反面断言 `document.body` 下没有 `.ant-modal`**
  —— 这正是「窗口套弹窗」的形态，只断言「挂出来了」会漏掉它；「跨书共享」徽标仍在；
  `novel.globalSettingLoad` 缺席 / `electronAPI` 整体缺失 / IPC 拒绝三种形态都
  **不抛异常**且渲染出错误态 + 「重试」（且此时不能连空壳设定中心一起挂出来 ——
  空库与装载失败是两件事）；「重试」重新装载成功后进入设定中心。
- 新增 `useNovelData.global-setting-sync.test.tsx`（6 例）钉住 P0-1 的刷新语义：
  本书无引用项时不发 IPC 且不换引用；有引用项时只换引用行、`chapters`（正文基线）
  与自建分类原样保留；全局项被删后的固化行同样跟随；装载在途跳过、装载后恢复跟随；
  卸载按同一 handler 引用退订；**广播刷新不触碰编辑器草稿**（脏 `draftMap` 引用不变 +
  当前章对象引用不变 —— 这条断言缺位时，把刷新改成整体 `load()` 不会有任何红灯）。
- `electron/global-setting-guard.test.ts` 增 4 例**源码级守卫**（书窗口侧订阅落点：
  订阅 / 成对退订 / 只换 settings 不碰 chapters / 跟随判据与在途闸门）；
  `novel-ui-kit.test.ts` 增 3 例扫描范围守卫（两个根都真的贡献样本、跨根文件
  报出的路径可定位），并补齐 `NO_RESET_NEEDED` 的收录理由。
- `electron/window-load-guard.test.ts` 的「超时兜底」断言由 `toContain("setTimeout")`
  改为钉住完整链路（`setTimeout` 回调体内必须真的 `reveal("装载超时兜底")`、用可配置
  时限、`已显示` 与 `窗口已关闭` 两条路径都清定时器）—— 原写法是**假阳性**：回调里
  什么都不做照样通过；另增 1 例钉住 `did-fail-load` 的 -3 过滤且发生在日志与 reveal 之前。
- 新增 `electron/dev-restart-guard.test.ts`（3 例）钉住热重启脚本：close 重启分支必须
  排除「正在关机」、`shutdown()` 复位 `restartPending` 并作废防抖定时器、
  只对 `dist-electron/*.js` 触发（`.map` 忽略）。
- `novel-ui-kit.test.ts` 增 2 例钉住「放置到全局」的文字色**跟随主题**：编译该组件
  SCSS 后断言三态取 `--app-primary` / `-strong` / `-active`，并断言块内不得自写
  `color` 属性（会被 antd (0,4,0) 的状态规则压掉）。变异：把 token 退回
  `--app-accent-teal` → RED，还原后 158/158 GREEN。
- `themes.test.ts` 增 1 例「常驻中性底：槽位不借交互态 token」（N-08 精确清单）：
  用**显式文件 + 编译后选择器**清单（6 处）断言其 `background` 取到与基面差一档的
  静态 token，并反面断言不含 `--app-surface-hover` / `--app-surface-active`。
  刻意**不扫全仓**（那会误伤合法的 `:hover`，并把 `NovelTopBar` 等已复核为合法的例外
  一起拖红 —— 该 docstring 里已把例外逐处连理由写明，免得下轮重复翻账）。
  变异：把 `SettingsWindow` 与 `HoverEntityCard` 两处改回 `surface-hover`
  → 均精确报红；还原后 md5 一致。
- `SettingCenter/index.test.tsx` 扩写「模板能力门控（N-04）」：不传模板 props 时
  `document.body` 下（含弹窗 portal）无「另存为模板」菜单项、「我的模板」区块与
  `SaveTemplateModal` 文案，但「模板库」入口与空态 CTA **仍在**、点开能看到内置预设
  并且**真的调到 `onApplyPreset`**（只断渲染不算证明它有牙）；传全 props 时「我的模板」
  区块出现。另加一条**源码守卫**钉住「本形态是**没给**、不是给了个假的」——
  `index.tsx` 不得出现 `=> {}` 空实现兜底。变异：把「模板库」入口重新包回门控 → 红；
  把 `onDeleteTemplate` 退回 `?? (() => {})` → 红；两次还原后 md5 与变异前一致。
- 新增 `src/shared/novel/setting-mappers.test.ts`、`src/shared/novel/word-count.test.ts`；
  `GlobalSettingWindow/hooks/useGlobalSetting.test.tsx` 覆盖删除确认的确定/取消两条路径
  （取消不得发第二次 IPC），并从**装载结果**读 `settings[0].refCount` 钉住「调用点漏传
  `withRefCount` 即静默丢徽标」—— 直接调映射函数测不到这条缝。变异：去掉
  `withRefCount` → `expected undefined to be 7` 报红，其余用例仍绿。
- 新增 `useNovelData.global-setting-sync.test.tsx`、`GlobalSettingWindow/App.test.tsx` 等
  未跟踪测试文件已纳入工作区（本轮交付的测试面：`src/shared/novel`、
  `src/shared/components/SettingCenter`、`src/windows/GlobalSettingWindow`、
  `src/shared/theme`、`src/windows/NovelWindow/novel-ui-kit.test.ts`）。

## [1.45.0] - 2026-10-16

### Added

- **全局设定中心（跨书共享设定库，独立窗口）**：一本书里维护的设定分类与等级，可以
  一键放到「全局库」，供其他作品引用——同一套「境界体系」不必在每本书里重建一遍。
  - **入口**：书架顶栏新增「全局设定中心」（`ClusterOutlined` + 文字标签），点开为
    **独立窗口**（单实例，与行囊窗口同范式；已开则只聚焦不新开）。full / novel 版
    包含，lite 版不含。
  - **引用 = 实时同步**：本书设定中心左栏新增「从全局库选择」，可多选全局分类引入。
    引入后是**引用**而非副本——全局侧改名 / 调层级顺序 / 增删等级，引用它的每本书
    即时跟随（跨窗口广播 `global-setting-changed`，带「排除发送窗口」的防回声逻辑）。
  - **引用项只读，且权威在主进程**：被引用的分类在本书侧显示「全局 · 自动同步」徽标，
    编辑 / 删除 / 排序 / 批量生成 / 拆分层级等 **10 个写入通道**一律收走入口，且主进程
    写通道首行校验 `source_global_id` 非空即拒——UI 禁用只是第二层，防绕过。
  - **放置到全局（复制上架）**：本书分类「放置到全局」→ 复制一份到全局库，**本书不
    受影响**。命中同名走冲突三选，默认「新建为副本」；`kind='realm'` 撞车默认不替换；
    本书已有境界体系时，引入全局境界降级为普通分类（保住「每书至多一个境界体系」）。
  - **全局删除不丢数据**：删除被引用的全局项需二次确认；确认后引用方**就地固化为本书
    副本**（内容保留、可继续编辑，标注「原全局项已删除，已转为本书副本」），且不动
    该书既有的 `novel_links` 关系。
  - **数据落点**：新增两张全局表 `novel_global_setting_categories` /
    `novel_global_setting_levels`（不带 `work_id`——与本书域物理分表，避免与「空
    workId 播种垃圾数据」的既有语义冲突）；本书侧新增可空列 `source_global_id` /
    `detached_from_name` 记录引用来源。全部走启动期 `pragma table_info` 探测 +
    `ALTER TABLE ADD COLUMN` / `CREATE TABLE IF NOT EXISTS` 增量迁移，老库新库结构
    收敛一致。每库至多一个境界体系由 `WHERE kind='realm'` 偏唯一索引 + 三处应用层
    校验共同兜底。
  - **导出**：全局库支持导出 JSON（模板库 / 导入列为后续项）。
- **要素境界可选「小境界」**：未拆分小层级、但 `sub_levels > 1` 的境界阶，现可直接点选
  「第 N 层」（阶下方的层号 chip 组），与「已拆分的初期 / 中期 / 后期 / 圆满」互斥
  呈现；再点当前层即解除绑定。此前最多只能选到「阶」，表达不了「筑基第七层」。
- **引导新增第 6 步「一套设定，多本书共用」**（书架视图，可关闭；1–4 强制段不变）。
- **架构调整**：设定中心三栏组件从 `NovelPage/components` 提升到
  `src/shared/components`（新增 `source: "book" | "global"` 入参）；提升时**保留了
  本书侧 UI-10 的拆分结果**（`components/` 8 个子组件 + `hooks/useSettingCenter` +
  `setting-primitives.scss` 随迁，而非回退成单体），NovelPage 直接引用 shared，原路径
  不再留垫片；设定纯函数与编号中文转换下沉 `src/shared/novel/*`（旧路径同样留垫片）；
  两个设定域 handler 的共有内核（rank 三件套 / 引用只读守卫 / 建立引用·同步·固化·
  上架·引用计数）抽出为 `novel-setting-shared.ts`，单向依赖无环。
- **类型管理入口更显眼**：要素面板的纯图标按钮改为「图标 + 文字」（热区 28px），并在
  空态补充引导 CTA。

### Changed

- **顶栏「本书设定」改为 toggle**：与「行囊 / 排版与偏好 / 快照」一致，再点一次关闭
  （此前它只开不关）。
- **行囊境界文案**：由 `筑基 1/4` 改为 `筑基 * 初期 1/4`、`练气 * 第七层 7/13`
  （`阶 * 小层名 进度`）；数字是否转中文跟随本书「编号样式」设置，无小层名时回退原
  格式，`sub_levels <= 1` 只出阶名。
- **出场章节列表行间距**：4px → 8px（`APPEAR_ROW_HEIGHT` 34 → 38 成对调整，保证虚拟
  列表行高一致、滚动不跳白条）。
- **工具卡描述换行**：描述文字不再撑破卡片。根因是它继承了 antd `.ant-btn` 的
  `white-space: nowrap`（`ant-button-reset` 未清零），现显式改回 `normal` +
  `overflow-wrap: anywhere`。
- **引导第 5 步主按钮**：跨视图那一步文案变为「下一步 · 去书架」，点击后**自动切回
  书架**续播第 6 步（此前点了整屏无反馈、要用户自己想到返回书架）。判据取自「前后两步
  视图不同」，不写死步号，1→2→3→4→5 行为逐字不变。
- `formatSubLevel` 的 `{n}` 模板由「只替换首个」改为全局替换，与拆分预览 `previewSplit`
  同口径（当前仓库内无多占位模板，属预防性对齐）。

### Fixed

- **「行囊 / 本书设定要点两次才出窗口」**：真因不是抽屉遮罩，而是「上一层全视口浮层
  （Modal / 引导蒙层）以『点击即关』收自己」与「这两颗按钮只开不关」在同一次点击上
  争用——第一击被上层收走，按钮根本没接到。修法：抽屉的「点外部关闭」从覆盖式捕获
  遮罩改为**文档级 `mousedown` 分流**（只关自己，绝不 `preventDefault` /
  `stopPropagation`，同一次点击既关抽屉又触发被点元素），并把这两颗按钮改为 toggle。
  「点抽屉外部关闭」的既有能力完整保留，`Esc` 逐层关闭链（设定中心 → 排版 → 快照 →
  专注）不受影响，连续开合 20 次无监听器泄漏。
- **伏笔的章节名可点击跳转**：大纲面板里伏笔条目的来源章节名改为链接，点击切换到该章；
  卷级伏笔（没有具体章）仍为纯文本、不可点。
- `guide-state.ts` 中「红点显示条件」的注释与实现不符（实现为 `state !== "done"` 时
  显示，即 done 必消失），已改正注释，行为未变。
