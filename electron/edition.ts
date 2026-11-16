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
 *           SettingsWindow 承载外观 / 账号 / 个人资料（base 头部入口唤起）；
 *           附 PackWindow / GlobalSettingWindow（均属 novel 域）；
 *           MapWindow 为即关即销的地图编辑器子窗口（base 头部入口唤起）
 * - lite  ：精简版。不打包 novel / map 窗口，主窗口隐藏对应入口（全局设定窗亦缺席）
 * - novel ：小说版。NovelWindow 升级为主窗口（登录后唤起，关闭进托盘），
 *           附带 SettingsWindow（外观 / 账号 / 个人资料）、MapWindow（架空地图，
 *           属 novel 域，从工具箱唤起）；不打包 base
 *
 * 注意：novel 版与 full 版共享同一 userData 目录（productName 未变），
 * 用户数据 / novel_* 表天然互通，无需任何数据迁移。
 */

export type CheckInEdition = "full" | "lite" | "novel";

/**
 * 窗口变体后缀（可选，缺省空串 = 不变）。
 *
 * 与 edition（full | lite | novel）正交：edition 决定「哪些窗口组」参与构建，
 * variant 在同一 edition 内进一步**剔除**某些功能窗口。当前唯一取值 `nomap`
 * 表示剔除地图（map）窗口及其全部逻辑与接口；日后新增其它功能窗口（如
 * `norelation` / `nopack`）时，只需在下面两张映射表各加一行，不必再改
 * 解析逻辑与派生函数。
 *
 * 环境变量：`CHECKIN_WINDOW_VARIANT`（对应 package.json 指令的可选后缀参数）。
 */
export type WindowVariant = "" | "nomap";

/** 窗口入口 key，与 windowManager 注册名保持一致（base 例外：注册名为 "main"） */
export type WindowEntryKey =
  | "base"
  | "login"
  | "novel"
  | "pack"
  | "relation"
  | "settings"
  | "globalSetting"
  | "map";

/** 入口 key → 渲染层 HTML 路径（相对项目根，dev 与 app:// 协议同用该相对路径） */
export const RENDERER_ENTRY_PATHS: Record<WindowEntryKey, string> = {
  base: "src/windows/BaseWindow/index.html",
  login: "src/windows/LoginWindow/index.html",
  novel: "src/windows/NovelWindow/index.html",
  pack: "src/windows/PackWindow/index.html",
  // 人物关系网络独立窗口（R27）：可拖拽建模，属 novel 域（full / novel 打包）
  relation: "src/windows/RelationWindow/index.html",
  settings: "src/windows/SettingsWindow/index.html",
  // 全局设定中心独立窗口（1.4x，属 novel 域：full / novel 打包，lite 不打包）
  globalSetting: "src/windows/GlobalSettingWindow/index.html",
  // 地图编辑器独立窗口（checkin 域：full / novel 打包，lite 不打包）
  map: "src/windows/MapWindow/index.html",
};

/** 各版本编译的窗口入口清单（vite input 与主进程可加载窗口的唯一依据） */
export const EDITION_WINDOW_ENTRIES: Record<CheckInEdition, WindowEntryKey[]> = {
  full: [
    "base",
    "login",
    "novel",
    "pack",
    "relation",
    "settings",
    "globalSetting",
    "map",
  ],
  // lite 无 novel 域：全局设定中心属 novel 域，同理不登记
  lite: ["base", "login", "settings"],
  // novel 版：小说窗口为主窗口，附带 pack / relation / map（地图编辑器，属 novel 域）
  novel: ["login", "novel", "pack", "relation", "map", "settings", "globalSetting"],
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

/** 合法变体后缀集合（与 WindowVariant 联合类型同步维护） */
const WINDOW_VARIANTS: readonly WindowVariant[] = ["", "nomap"];

/**
 * 变体 → 需从入口清单中剔除的窗口 key。
 *
 * 这是「后缀机制」的**唯一事实源**：新增变体后缀只需在此加一行（并在
 * WINDOW_VARIANTS 登记合法值），派生逻辑与渲染/主进程侧开关全部随之生效，
 * 无需触碰其它文件。
 */
export const WINDOW_VARIANT_ENTRY_EXCLUSIONS: Record<WindowVariant, WindowEntryKey[]> = {
  "": [],
  // nomap：剔除地图编辑器窗口，map 相关 IPC / 逻辑随之整组关闭（见 main.ts / preload.ts）
  nomap: ["map"],
};

function isWindowVariant(value: string): value is WindowVariant {
  return (WINDOW_VARIANTS as readonly string[]).includes(value);
}

/** 从环境变量解析窗口变体；缺省回落空串，非法值告警后回落空串 */
export function resolveWindowVariantFromEnv(source?: NodeJS.ProcessEnv): WindowVariant {
  const raw = (source ?? process.env).CHECKIN_WINDOW_VARIANT;
  if (raw === undefined || raw === "") return "";
  if (isWindowVariant(raw)) return raw;
  console.warn(
    `[edition] 非法 CHECKIN_WINDOW_VARIANT="${raw}"，回退为 ""（合法值：${WINDOW_VARIANTS.filter(Boolean).join(" | ")}）`,
  );
  return "";
}

/**
 * 派生某个版本在指定变体下的最终窗口入口清单（vite input 与主进程可加载窗口的唯一依据）。
 *
 * = EDITION_WINDOW_ENTRIES[edition] 剔除 WINDOW_VARIANT_ENTRY_EXCLUSIONS[variant]。
 * 变体只做减法（不新增窗口），保证「不传后缀」时行为与旧版完全一致。
 */
export function resolveWindowEntries(
  edition: CheckInEdition,
  variant: WindowVariant,
): WindowEntryKey[] {
  const excluded = new Set(WINDOW_VARIANT_ENTRY_EXCLUSIONS[variant]);
  return EDITION_WINDOW_ENTRIES[edition].filter((key) => !excluded.has(key));
}

/**
 * 便捷判定：该变体是否剔除了 map 窗口。
 *
 * 只反映 variant 这一个维度；构建期最终口径请用 `buildExcludesMap` —— 它同时
 * 看 edition（lite 版本就不含 map），避免单看变体在 lite 版漏判。
 */
export function variantExcludesMap(variant: WindowVariant): boolean {
  return WINDOW_VARIANT_ENTRY_EXCLUSIONS[variant].includes("map");
}

/**
 * 本构建是否不含地图功能（编译期注入 `__CHECKIN_NO_MAP__`，三进程共用同一取值）。
 *
 * 以窗口入口清单为唯一依据：`resolveWindowEntries` 已把 edition（lite 不登记 map）
 * 与 variant（nomap 剔除 map）叠加完毕，这里只判结果。这样 lite 版不会因只看
 * variant 而在标题栏留下一个点了没反应的地图死按钮。
 */
export function buildExcludesMap(
  edition: CheckInEdition,
  variant: WindowVariant,
): boolean {
  return !resolveWindowEntries(edition, variant).includes("map");
}
