# Changelog

## [1.4.1] - 2026-09-17

### Changed
- 主题色值枚举扩充至 55 项（较 1.4.0 增加 14 项），四套主题保持同一变量集合：
  - 新增底色 `surface-active`（按下态）、`sidebar-bg`、`input-bg`、`splitter`（分隔线）
  - 新增文本 `text-disabled`；主色新增 `primary-active`（按下态）
  - 新增语义色 8 项：`success` / `warning` / `error` / `info` 及各自的 `-weak` 弱底
  - antd token 同步补齐 `colorTextDisabled` / `colorSplit` / `colorSuccess` / `colorWarning` /
    `colorError` / `colorInfo` / `colorLink`，弹层与表单不再沿用 antd 默认蓝
- 全量页面样式变量化，消除暗色主题下的割裂（此前仅共享层接入主题，业务页仍为浅色硬编码）：
  - Todo：`TodoListItem` / `TodoOutlineSidebar` / `TodoSection` / `TodoToolbar`
  - Memo：`MemoPage` / `MemoSidebar` / `MemoListItem` / `MemoHeader` / `MemoEditor` / `MemoPreview`
  - Daily：`index.scss` 日历面板与时间带的白底、分割线、选中态全部改为主题变量
  - Code：趋势图基线、柱体、数值与日期文字改为主题变量
  - 共享：`WorkerFloatButton` 改用 `--app-primary` 系列与主题阴影；`ThemeSwitcher` 色块描边改用 `--app-border-strong`
  - TSX 内联色一并收敛（`CodePage` 增减行/统计值、`TodoOutlineSidebar` 分组色、
    `MemoListItem` 图标色、`TodoToolbar` 搜索图标、活动提醒默认色）
- `shared/styles/variables.scss` 标注颜色变量已废弃：新样式一律用 `--app-*`，避免暗色下残留浅色

### Removed
- 移除 `WindowHeader` 与 `LoginWindow` 的主题切换器：主题切换入口统一收敛到首页侧边栏底部，
  避免同一功能在多处出现且与窗口标题栏职责混淆

### Verified
- `pnpm test`：56/56 通过（6 个测试文件，含四套主题变量集合一致性校验）
- `pnpm typecheck`（tsc -b，strict 开启）：0 错误
- `pnpm lint`：0 错误（仅剩 CodePage 既有 exhaustive-deps 警告）
- `vite build` 通过

## [1.4.0] - 2026-09-17

### Added
- 新增四套主题（柔雾紫蓝 aurora / 奶油暖橘 cream / 薄荷清新 mint / 月夜暗色 midnight）
  - `shared/styles/themes.scss` 统一 `--app-*` CSS 变量（底色、描边、文本、主色、强调色、圆角、阴影、滚动条），
    业务样式一律写 `var(--app-*)`，切换 `<html data-theme>` 即整体换肤
  - `shared/theme/` 主题模块：`themes.ts`（主题清单与 antd 色板）、`theme-storage.ts`（读写/落盘/首帧初始化）、
    `ThemeProvider.tsx`（内聚 ConfigProvider，暗色走 `darkAlgorithm`）、`theme-context.ts`（`useTheme`）
- 新增 `shared/components/ThemeSwitcher/`：色块式主题切换器，切换后写 localStorage 并通过
  `windowAPI.broadcast('theme-changed')` 广播，三个窗口实时同步
  - 主窗口 / Worker 窗口挂在 `WindowHeader` 右侧；登录窗口无标题栏，固定在右上角
- 首页改造为侧边导航布局：图标导航栏 + 问候/搜索 + 快捷操作行（含首页直建待办）+ 数据概览 + 功能卡网格 + 用户信息横条
  - 数据概览取真实数据：待办未完成数、今日代码产出、备忘篇数、本月打卡天数（任一项失败只该项显示「—」）
- 新增 15 个主题单测（`themes.test.ts` / `theme-storage.test.ts`），其中一项校验
  `THEME_LIST` 与 `themes.scss` 的变量集合完全一致，防止新增主题漏写变量导致换肤后局部掉色

### Changed
- 三个窗口入口统一接入 `ThemeProvider`（内部已含 ConfigProvider），并在 `createRoot` 前调用
  `initThemeFromStorage()`，避免暗色主题首帧白闪
- 共享样式变量化：`window-shell.scss`、`NavHeader`、`WindowHeader`、Login/Worker/Base 的 `index.scss`
  全部改用主题变量，移除硬编码色值
- `HomePage` 业务逻辑下沉到 `hooks/useHomeOverview.ts`（数据）与 `hooks/useHomeActions.ts`（交互），
  卡片拆为 `components/HomeSidebar` / `components/HomeStats` / `components/FeatureCard`

### Removed
- 移除 `shared/styles/antd-theme.ts`：其职责已由 `ThemeProvider` 接管，避免两套 ConfigProvider 配置并存

### Verified
- `pnpm test`：56/56 通过（6 个测试文件）
- `pnpm typecheck`（tsc -b，strict 开启）：0 错误
- `pnpm lint`：0 错误（仅剩 CodePage 既有 exhaustive-deps 警告）
- `vite build` 通过，主题样式随各窗口 chunk 正确产出

## [1.3.0] - 2026-09-17

### Added
- 新增单元测试能力（vitest 4 + @testing-library/react + jsdom）
  - 新增 `vitest.config.ts`（独立于 `vite.config.ts`，测试环境不引入 Electron 插件）与 `vitest.setup.ts`
  - 新增 `pnpm test`（全量运行）与 `pnpm test:watch`（watch 模式）
  - 新增 41 个单元测试：`todo-utils`（工时标签解析/格式化）、`memo-utils`（HTML 转义/搜索高亮）、`code-utils`（工作日/节假日/调休计算）、`daily`（时间换算），测试文件与被测代码同目录就近存放
  - `AGENTS.md` 新增「6.6 单元测试规范」与「8.7 修改与交付检查」：修改功能前后必须运行对应单测，防止修复引入回归
- `tsconfig.app.json` / `tsconfig.node.json` 开启 `strict` 模式，全量代码零错误通过

### Changed
- `shared/services/code.ts` 的 Git Webhook 请求由渲染进程 `fetch` 改走主进程 `httpRequest`
  - `Cookie` 是浏览器 forbidden request header，渲染进程设置会被静默忽略导致请求未认证；主进程 `https.request` 可正常携带
- `typecheck` 脚本由 `tsc --noEmit` 修正为 `tsc -b`：根 tsconfig 为 solution-style（`files: []`），原命令实际未检查任何文件
- `AGENTS.md` 同步现状：登记 `WorkerWindow` 窗口与 `electron/handlers/` 拆分；页面表更新为分层 hooks（Todo/Memo/Daily/Code）；技术债务表移除已解决项
- ESLint 重新开启 `react-hooks/exhaustive-deps` 并修复全部 5 处警告（`useCodePage` 的 `loadMonthOutput`/`loadData` useCallback 化、`useTodoEditorState` 解构稳定引用）
- **性能优化**：`useCodePage` 的 `summaryStats` 统计由每次渲染重算改为 `useMemo`（数据最多 9999 条，此前每次 Table 渲染都全量 reduce）

### Fixed
- 修复 Memo 搜索高亮破坏 HTML 实体的问题：搜索词含 `&` / `<` 等字符时会命中转义实体（如 `&amp;`）的中间片段，把 `&amp;` 切断为 `&` + `amp;`；现在搜索词先做 HTML 转义再匹配，`<mark>` 始终包裹完整实体
- 修复 `window-broadcast` 不识别 Worker 窗口的问题：发送者名称只匹配 main/login，Worker 窗口广播时不会排除自己；改为 `windowManager.getNameOf()` 按实例反查
- 统一 `activitiesTask` 轮询间隔：启动 30s、睡眠唤醒恢复后 10s 且注释互相矛盾，收敛为常量 `POLL_INTERVAL_MS = 30s`（恢复时立即检查一次，不丢通知）
- `LoginWindow/main.tsx` 导入路径统一为 `@/` 别名（原为相对路径，与其他窗口不一致）

### Removed
- 移除 `todo-utils.ts` 中无任何使用方的 `getTotalRemainingWorkHour`（O(n²) 递归实现，`useTodoData` 已有 Map 索引版同逻辑）

### Verified
- `pnpm test`：41/41 通过（4 个测试文件）
- `pnpm typecheck`（tsc -b，strict 开启）：0 错误
- `pnpm lint`：0 错误、0 警告

## [1.2.0] - 2026-09-16

### Added
- 新增 `WorkerWindow` 临时工作窗口
  - 独立窗口目录 `src/windows/WorkerWindow/`，与其他窗口保持隔离，互不导入
  - 标准窗口行为：显示在任务栏，标题栏由通用 `WindowHeader` 提供（拖动 + 最小化/最大化/关闭），支持 `Esc` 快捷关闭
  - 不拦截 close 事件，关闭即随实例销毁，重新打开即全新实例
  - 重复触发打开时聚焦已有实例，避免重复创建
- 主页右下角新增 `WorkerFloatButton` 悬浮按钮，点击打开 Worker 窗口
  - 挂载于 `HomePage` 内，仅主页展示，切换到子页面后不再出现
  - 悬浮按钮沿用项目性能规范，仅过渡 `transform` / `box-shadow` / `background-color`
- 新增通用 `WindowHeader` 窗口级标题栏组件（`shared/components/WindowHeader/`）
  - 整条标题栏为拖动区，右侧提供最小化 / 最大化(还原) / 关闭三个控制按钮，支持可选 `title` / `icon` 标题
  - 主窗口与 Worker 窗口均已接入：BaseWindow 不传标题（页面有自己的头部），Worker 传 `title="Worker"`
  - 最大化状态由主进程推送（`window-maximize-state`），挂载时主动查询一次，图标随状态切换
  - 最大化时 `<html>` 挂 `is-window-maximized` 类，`.window-shell` 自动切换为方角（避免屏幕四角露出透明缺口）
  - 双击标题栏可直接切换最大化（Electron 拖动区的系统行为）
  - 新增 `window-control` / `window-maximize-query` IPC 通道；`window-control` 的 payload 为动作字符串本身；`close` 走 `win.close()`，由各窗口自身 close 语义决定行为（主窗口隐藏到托盘）
  - `preload.receive` 现返回取消订阅函数，组件卸载时可移除监听，避免重复注册
- 新增本地调试便捷入口
  - `Ctrl+Shift+I` / `F12` 可随时切换 DevTools（主窗口、登录窗口、Worker 窗口均支持）
  - 应用级 `globalShortcut` 兜底，窗口失焦时仍可唤出调试面板
  - 新增 `pnpm dev:debug`（启动即开 DevTools）与 `pnpm dev:debug:log`（附带主进程轮询日志）
  - 支持 `VITE_DEVTOOLS_MODE` 控制 DevTools 打开方式（默认 `detach` 独立窗口）

### Changed
- **性能优化**：路由级懒加载，`BaseWindow/App.tsx` 六个页面改为 `lazy()` + `Suspense`
  - 入口 chunk 由整体体积降至 46KB，`DailyPage`(307KB)、`TodoPage`(148KB) 转为按需加载
- **性能优化**：antd 主题开启 `cssVar` 变量模式并关闭 `hashed`
  - antd 样式表体积从数百 KB 降至约 3KB
- **性能优化**：列表渲染链路优化
  - `TodoListItem`、`TodoSection`、`TodoOutlineSidebar` 增加 `memo()`，稳定回调引用
  - `TodoPage` 将 `data`/`editor`/`view` 收敛至 ref，避免 Virtuoso 全量重渲染
  - `renderItem`、`itemContent`、`groupContent` 全部改用 `useCallback` 固定引用
- **性能优化**：数据计算去重与索引化
  - `useTodoData` 剩余工时递归由 `Array.find` 改为 `Map` 索引，消除 O(n²)
  - `TodoOutlineSidebar` 组偏移量由 `slice + reduce` 改为预计算前缀和
  - `useTodoViewState` 复用 `previousDoneRef` Map，不再每次重建
  - `DailyPage` 农历与节日结果增加模块级缓存，避免每次渲染重复计算 42+ 次
- **性能优化**：动画属性改为仅使用合成层属性
  - 大纲收起由过渡 `width` 改为 `transform: translateX()`，消除布局抖动
  - Todo 分区折叠移除 `flex` / `max-height` 过渡，仅保留 `opacity`
  - `todo-flash` 由 `background` 改为 `box-shadow`，`todo-enter` 时长收紧
  - 首页 `BorderBeam` 默认暂停动画，指针进入才播放，空闲时零动画开销
- **性能优化**：Memo 编辑器输入路径优化
  - `highlightText` 在无搜索词时短路返回，避免每次按键对全文执行 `escapeHtml`
  - `MemoPreview` 代码块按钮重构 effect 依赖收窄至 `html`
- **窗口外观**：三个窗口（BaseWindow / LoginWindow / WorkerWindow）统一改为圆角窗口
  - 主进程侧抽出 `ROUNDED_WINDOW_OPTIONS`，统一应用 `frame: false` + `transparent: true` + `backgroundColor: "#00000000"` + `hasShadow: false` + `roundedCorners: true`
  - 抽出 `createWebPreferences()`，避免三处 `webPreferences` 重复定义
  - 新增共享样式 `src/shared/styles/window-shell.scss`（`$window-radius: 12px`），提供 `.window-shell` / `.window-shell__body` 外壳，负责圆角、边框与投影
  - 三个窗口的 `index.html` 根节点统一加 `class="has-window-shell"`，`body` / `#root` 背景改为 `transparent`，圆角交由外壳绘制
  - 拖动区适配：`NavHeader`（主窗口）、`.login-window`（登录窗口）、`.worker-titlebar`（Worker 窗口）声明 `-webkit-app-region: drag`，内部可点击元素补 `no-drag`；窗口整体圆角继承自外壳（`border-radius: inherit`）
- `CodePage` 表格 `columns` 提升为模块级常量，避免每次渲染重建
- `scripts/start-electron.js` 显式透传 `VITE_OPEN_DEVTOOLS` 与 `VITE_DEVTOOLS_MODE`
- `activitiesTask` 高频日志收敛至 `debugLog()`，由 `CHECKIN_ACTIVITY_DEBUG=1` 控制

### Fixed
- 修复上一轮性能优化引入的 Todo 交互失效问题
  - `renderItem` 把 `editingId` / `childInputFor` / `flashIds` / `enterIds` 等显示状态藏进 ref，
    依赖里只剩稳定 handler，导致点击「新增子项」、双击编辑等纯 UI 状态变化不产生任何新 props，
    Virtuoso 不重渲染可见行——按钮看似无效，直到下一次数据变化（如保存备注）才把滞留状态一次性吐出
  - 修复：显示状态改为 `renderItem` 的真实依赖（基础类型/Set 引用，仅状态变化时重建），
    数据 handler 仍走 ref 保持稳定；Esc 关闭输入框等交互随之恢复正常
- 修复 WindowHeader 控制按钮在不带标题的窗口（BaseWindow）下显示在左侧的问题
  - `space-between` 布局在唯一子元素时落在起点，`.window-header__controls` 补 `margin-left: auto` 保证始终靠右
- 修复主窗口从托盘恢复时闪烁的问题
  - 透明窗口（`transparent: true`）在 `hide()` → `show()` 切换时 Chromium 重放窗口动画导致可见闪烁（Electron/Chromium 已知渲染问题）
  - Windows 下禁用窗口管理器动画：`app.commandLine.appendSwitch("wm-window-animations-disabled")`
- 修复 WindowHeader 三个控制按钮点击无效的问题
  - 渲染层发送 `{ action }` 对象，主进程 `switch` 按字符串匹配导致永远不命中
  - 统一约定：`window-control` 的 payload 为动作字符串本身，主进程同时兼容两种形式
- 修复主窗口主页无法拖动的问题
  - 根因：HomePage 自带头部不含拖动区，NavHeader 仅存在于子页面，主页没有任何可拖动区域
  - `NavHeader` 回归纯页面级头部（移除 `-webkit-app-region` 拖动声明），窗口拖动职责上移至 `WindowHeader`
- 修复引入窗口标题栏后页面高度溢出的问题
  - WindowHeader 占用 34px 后 `.window-shell__body` 不再等于视口高度，
    `Page`、HomePage、`app-route-fallback` 由 `100vh` 改为 `100%`，
    DailyPage / TodoPage 的 `calc(100vh - Xpx)` 同步改为 `calc(100% - Xpx)`，避免页面底部被裁剪 34px
- 修复在渲染期写 ref 的隐患（`TodoPage`、`useTodoData`、`MemoPreview` 三处）
  - React 19 并发渲染下，被丢弃的渲染可能将 ref 写入过期数据，导致难复现的状态不一致
  - 统一改为在 `useEffect` 中同步 ref
- 修复新增任务的入场动画定时器未清理导致的卸载后 setState 问题
- 修复 `useDailyPage` 的 `refreshData` 未记忆化导致每次渲染重复拉取数据的问题
- 修复 `TodoOutlineSidebar` 在大纲条目缺失时可能读取空对象属性的问题

### Verified
- `npx tsc --noEmit`、`npx eslint src electron scripts`、`npm run build` 均通过
- 构建产物确认三个 HTML 入口齐全：`BaseWindow/index.html`、`LoginWindow/index.html`、`WorkerWindow/index.html`

## [1.1.0] - 2026-09-15

### Changed
- Memo 文件列表支持双击文件名进入输入框并重命名文件。
- **状态管理规范落地**：TodoPage 和 MemoPage 直接组合分层 Hook，并将页面局部交互状态与复制逻辑下沉到直接使用组件。
- **开发规范**：补充状态管理约束，要求 Hook 状态优先在直接使用组件中消费，减少不必要的父组件状态透传。
- **架构重构**：将所有数据库操作从渲染进程迁移至主进程，消除 SQL 注入风险
  - 新增语义化 IPC 通道：`activity-list/add/update/delete`、`todo-list/add/update/toggle` 等
  - 移除通用 `db-all/get/run/exec` 通道，渲染进程不再直接传递 SQL
  - 主进程 handlers 模块化管理：`electron/handlers/activity-handlers.ts`、`electron/handlers/todo-handlers.ts`
- **窗口管理**：引入 `WindowManager` 统一管理所有窗口实例
  - 替换散落的 `mainWindow`/`loginWindow` 模块级变量
  - 支持跨窗口通信：`windowAPI.broadcast()`、`windowAPI.sendTo()`
  - 活动提醒改用 `windowManager.broadcast('activity-notify', ...)` 广播
- **类型定义**：重构 `electron.d.ts`，新增 `activity`、`todo`、`windowAPI` 语义化接口

### Removed
- 删除 `src/windows/BaseWindow/pages/TodoPage/todo-db.ts`（类型已迁移至 `types.ts`，初始化逻辑已在主进程完成）

### Added
- 新增 Memo 页面左侧文件列表名称支持双击修改
- Todo 备注支持点击复制，并在复制成功后显示短暂提示。
- 优化 Todo 标题和备注的长文本展示，超过可配置字数后省略，并可通过悬停查看全文。

### Fixed
- 修复开发模式自动打开 DevTools 导致页面渲染和弹窗响应明显变慢的问题，保留 `VITE_OPEN_DEVTOOLS=1` 调试开关。
- 优化 Todo 列表渲染：稳定数据与编辑状态回调，缓存子任务索引和剩余工时，减少列表项重复计算与重渲染。
- 修复 Todo 分区展开时已完成列表被卸载并从顶部闪动收缩的问题，保留列表位置并平滑过渡内容高度。
- 修复编辑 Todo 标题时未输入工时标签会清空原工时的问题，并确保备注、完成状态和特别关注等附属信息保持不变。
- 修复 Markdown 预览中单个 Enter 换行被合并为同一行的问题。
- 将 Todo 单项递归渲染逻辑抽离为独立的 `TodoListItem` 组件。
- 拆分 Todo 页面数据、编辑状态和视图状态，降低 `useTodoPage` 与页面组件的职责耦合。
- 移除仅负责转发的 `TodoModals` 包装组件，直接在 TodoPage 中使用备注和工时弹窗。
- 按通用页面规范拆分 MemoPage 的数据、编辑和视图状态，收缩 `useMemoPage` 为组合层。

## [1.0.2] - 2026-09-15

### Fixed
- 修复 Todo 子任务输入框在中文输入法（IME）下被提前提交或失焦的问题。
- 修复新增任务输入框在中文输入时被误触发 Enter / Blur 导致拼音中断的问题。
- 为新建任务和子任务输入框增加 composition 状态保护，避免中文输入过程被中断。
- 验证通过：`pnpm exec tsc -p tsconfig.app.json --noEmit`。
