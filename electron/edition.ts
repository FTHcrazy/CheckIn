/**
 * 构建版本（edition）单一事实源。
 *
 * 一个环境变量 `CHECKIN_EDITION` 决定本次构建的形态，由 vite.config.ts
 * 读取后以编译期常量 `__CHECKIN_EDITION__` 注入到渲染层 / 主进程 / preload
 * 三处 define（对齐规则见 vite.config.ts）。本模块同时被两侧引用：
 *
 * - vite.config.ts（构建期）：按版本生成 rollupOptions.input 窗口入口
 * - electron/main.ts（运行期）：按版本决定主窗口、close 语义与 IPC 注册
 *
 * 版本语义：
 * - full  ：完整版。base 为主窗口（隐藏到托盘），novel 为即关即销的子窗口；
 *           SettingsWindow 承载外观 / 账号 / 个人资料（base 头部入口唤起）
 * - lite  ：精简版。不打包 novel 窗口，主窗口隐藏 novel 入口
 * - novel ：小说版。NovelWindow 升级为主窗口（登录后唤起，关闭进托盘），
 *           附带 SettingsWindow（外观 / 账号 / 个人资料）；不打包 base
 *
 * 注意：novel 版与 full 版共享同一 userData 目录（productName 未变），
 * 用户数据 / novel_* 表天然互通，无需任何数据迁移。
 */

export type CheckInEdition = "full" | "lite" | "novel";

/** 窗口入口 key，与 windowManager 注册名保持一致（base 例外：注册名为 "main"） */
export type WindowEntryKey = "base" | "login" | "novel" | "pack" | "settings";

/** 入口 key → 渲染层 HTML 路径（相对项目根，dev 与 app:// 协议同用该相对路径） */
export const RENDERER_ENTRY_PATHS: Record<WindowEntryKey, string> = {
  base: "src/windows/BaseWindow/index.html",
  login: "src/windows/LoginWindow/index.html",
  novel: "src/windows/NovelWindow/index.html",
  pack: "src/windows/PackWindow/index.html",
  settings: "src/windows/SettingsWindow/index.html",
};

/** 各版本编译的窗口入口清单（vite input 与主进程可加载窗口的唯一依据） */
export const EDITION_WINDOW_ENTRIES: Record<CheckInEdition, WindowEntryKey[]> = {
  full: ["base", "login", "novel", "pack", "settings"],
  lite: ["base", "login", "settings"],
  novel: ["login", "novel", "pack", "settings"],
};

/** 各版本的主窗口入口：full/lite → base，novel → novel */
export const PRIMARY_WINDOW_ENTRY: Record<CheckInEdition, WindowEntryKey> = {
  full: "base",
  lite: "base",
  novel: "novel",
};

function isCheckInEdition(value: string): value is CheckInEdition {
  return value === "full" || value === "lite" || value === "novel";
}

/** 从环境变量解析版本；缺省 / 非法值回落 full 并告警（构建脚本应显式传值） */
export function resolveEditionFromEnv(source?: NodeJS.ProcessEnv): CheckInEdition {
  const raw = (source ?? process.env).CHECKIN_EDITION;
  if (raw === undefined || raw === "") return "full";
  if (isCheckInEdition(raw)) return raw;
  console.warn(
    `[edition] 非法 CHECKIN_EDITION="${raw}"，回退为 "full"（合法值：full | lite | novel）`,
  );
  return "full";
}
