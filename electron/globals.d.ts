/**
 * 主进程侧编译常量声明（值由 vite.config.ts 的 define 注入）：
 *
 * __CHECKIN_LITE__ —— 精简构建开关（环境变量 CHECKIN_LITE=1 时为 true）：
 * 不打包 WorkerWindow 入口，主窗口隐藏入口按钮，worker-window-open 请求被忽略。
 */
declare const __CHECKIN_LITE__: boolean;
