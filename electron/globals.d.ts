/**
 * 主进程侧编译常量声明（值由 vite.config.ts 的 define 注入）：
 *
 * __CHECKIN_EDITION__ —— 构建版本（环境变量 CHECKIN_EDITION，缺省 full）：
 * 与 electron/edition.ts 的清单配合，决定主窗口归属、close 语义与 IPC 注册范围。
 */
declare const __CHECKIN_EDITION__: "full" | "lite" | "novel";
