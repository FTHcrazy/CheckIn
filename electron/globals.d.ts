/**
 * 主进程侧编译常量声明（值由 vite.config.ts 的 define 注入）：
 *
 * __CHECKIN_EDITION__ —— 构建版本（环境变量 CHECKIN_EDITION，缺省 full）：
 * 与 electron/edition.ts 的清单配合，决定主窗口归属、close 语义与 IPC 注册范围。
 *
 * __CHECKIN_NO_MAP__ —— 本构建是否不含地图（由 buildExcludesMap 综合 edition 与
 * 窗口变体得出：lite 版不打包 map，nomap 变体亦剔除）：
 * 为 true 时 map 窗口及其 handler / IPC / 渲染层入口整组关闭。
 */
declare const __CHECKIN_EDITION__: "full" | "lite" | "novel";
declare const __CHECKIN_NO_MAP__: boolean;
