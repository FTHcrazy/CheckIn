# Changelog

## [1.2.0] - 2026-09-16

### Added
- 新增 `WorkerWindow` 即关即销的临时工作窗口
  - 独立窗口目录 `src/windows/WorkerWindow/`，与其他窗口保持隔离，互不导入
  - `frame: false` 无边框设计，自带可拖动标题栏与关闭按钮，支持 `Esc` 快捷关闭
  - 关闭即销毁（`destroy()`），不驻留内存、不占用任务栏（`skipTaskbar: true`）
  - 重复触发打开时聚焦已有实例，避免重复创建
- 主页右下角新增 `WorkerFloatButton` 悬浮按钮，点击打开 Worker 窗口
  - 作为全局组件挂载于 `BaseWindow/App.tsx`，在所有业务页面均可见
  - 悬浮按钮沿用项目性能规范，仅过渡 `transform` / `box-shadow` / `background-color`
- 新增 `src/shared/ipc/workerWindowBridge.ts` 窗口级 IPC 桥接
  - 沿用显式注册 + 防重复守卫模式，避免模块副作用扩散
  - 提供 `worker-window-open` / `worker-window-close` 两个 IPC 通道
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
- `CodePage` 表格 `columns` 提升为模块级常量，避免每次渲染重建
- `scripts/start-electron.js` 显式透传 `VITE_OPEN_DEVTOOLS` 与 `VITE_DEVTOOLS_MODE`
- `activitiesTask` 高频日志收敛至 `debugLog()`，由 `CHECKIN_ACTIVITY_DEBUG=1` 控制

### Fixed
- 修复在渲染期写 ref 的隐患（`TodoPage`、`useTodoData`、`MemoPreview` 三处）
  - React 19 并发渲染下，被丢弃的渲染可能将 ref 写入过期数据，导致难复现的状态不一致
  - 统一改为在 `useEffect` 中同步 ref
- 修复新增任务的入场动画定时器未清理导致的卸载后 setState 问题
- 修复 `useDailyPage` 的 `refreshData` 未记忆化导致每次渲染重复拉取数据的问题
- 修复 `TodoOutlineSidebar` 在大纲条目缺失时可能读取空对象属性的问题

### Verified
- `npx tsc --noEmit`、`npx eslint src electron scripts`、`npm run build` 均通过

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
