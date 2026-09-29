/**
 * 渲染层版本常量（编译期注入，见 vite.config.ts 的 define 与 env.d.ts 声明）。
 *
 * 业务代码禁止直接引用 `__CHECKIN_EDITION__`，统一从这里取派生布尔，
 * 保证版本判断散点可检索、可替换（electron/edition.ts 是主进程侧事实源）。
 */
export const CHECKIN_EDITION = __CHECKIN_EDITION__;

/** 完整版：所有窗口与业务模块齐备 */
export const IS_FULL_EDITION = CHECKIN_EDITION === "full";
/** 精简版：不含小说 / 地图 / 设置窗口 */
export const IS_LITE_EDITION = CHECKIN_EDITION === "lite";
/** 小说版：NovelWindow 为主窗口，附 SettingsWindow，不含 base/map */
export const IS_NOVEL_EDITION = CHECKIN_EDITION === "novel";
