# Changelog

## [1.1.0] - 2026-09-15

### Changed
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

### Fixed
- 修复编辑 Todo 标题时未输入工时标签会清空原工时的问题，并确保备注、完成状态和特别关注等附属信息保持不变。
- 优化 Todo 标题和备注的长文本展示，超过可配置字数后省略，并可通过悬停查看全文。
- 修复 Markdown 预览中单个 Enter 换行被合并为同一行的问题。
- 将 Todo 单项递归渲染逻辑抽离为独立的 `TodoListItem` 组件。

## [1.0.2] - 2026-09-15

### Fixed
- 修复 Todo 子任务输入框在中文输入法（IME）下被提前提交或失焦的问题。
- 修复新增任务输入框在中文输入时被误触发 Enter / Blur 导致拼音中断的问题。
- 为新建任务和子任务输入框增加 composition 状态保护，避免中文输入过程被中断。
- 验证通过：`pnpm exec tsc -p tsconfig.app.json --noEmit`。
