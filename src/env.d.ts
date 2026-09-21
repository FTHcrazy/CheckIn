/**
 * 渲染层编译常量声明（值由 vite.config.ts 顶部的 define 注入）：
 *
 * __CHECKIN_LITE__ —— 精简构建开关（环境变量 CHECKIN_LITE=1 时为 true）：
 * 不打包 WorkerWindow，主窗口隐藏其入口按钮（HomeSidebar）。
 */
declare const __CHECKIN_LITE__: boolean;
