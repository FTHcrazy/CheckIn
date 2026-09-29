/**
 * 行囊配置常量
 *
 * 只放「本模块私有」的常量与出厂值；跨模块复用的（如「当前境界」关系名）
 * 一律从既有配置导入，避免第二份事实源。
 */
import { LEVEL_RELATION, STORAGE_KEYS } from "../../novel-config";
import { PACK_MODULES, type PackModuleState } from "./types";

/** 「当前境界」关联名：与 R25 实体面板共用同一份定义（§9.7.3 唯一事实源） */
export const PACK_LEVEL_RELATION = LEVEL_RELATION;

/** 界面偏好落库键（即改即存，不进草稿；与 §8.6.2 的判据一致） */
export const PACK_UI_KEY = STORAGE_KEYS.packUi;

/** 出厂模块布局：全部启用，顺序即 PACK_MODULES */
export const DEFAULT_LAYOUTS: PackModuleState[] = PACK_MODULES.map((module, index) => ({
  key: module.key,
  enabled: true,
  sortOrder: index + 1,
}));

/** 面板宽度（与既有右栏共存，故比右栏更宽一档以便宫格视图） */
export const PACK_PANEL = {
  defaultWidth: 420,
  minWidth: 340,
  maxWidth: 620,
  debounceMs: 300,
  /** 窄窗降级阈值：可用宽度低于此值 → 全屏浮层 + 遮罩（§8.2 降级规则） */
  overlayBelow: 1100,
} as const;

/** 物品列表搜索防抖（B-3：≥20 条时实时过滤，防抖 200ms） */
export const INVENTORY_SEARCH_DEBOUNCE_MS = 200;

/** 物品数量长按连续增减：首次延迟与步进间隔 */
export const QTY_HOLD = { delayMs: 400, intervalMs: 60 } as const;

/** 货币进制模板（D-1：作者可「从模板创建」） */
export const CURRENCY_TEMPLATE: Array<{ name: string; ratioToBase: number }> = [
  { name: "金", ratioToBase: 10000 },
  { name: "银", ratioToBase: 100 },
  { name: "铜", ratioToBase: 1 },
];

/** 熟练度阈值模板（D-1：0-99 入门 / 100-499 熟练 / 500+ 大师） */
export const PROFICIENCY_TEMPLATE: Array<{ name: string; min: number; max: number | null }> = [
  { name: "入门", min: 0, max: 99 },
  { name: "熟练", min: 100, max: 499 },
  { name: "大师", min: 500, max: null },
];

/** 境界阶梯模板（D-1：从模板创建，一步到位） */
export const LADDER_TEMPLATE: Array<{ name: string; subLevels: number }> = [
  { name: "炼气", subLevels: 9 },
  { name: "筑基", subLevels: 9 },
  { name: "金丹", subLevels: 9 },
  { name: "元婴", subLevels: 9 },
  { name: "化神", subLevels: 1 },
];

/** 量纲体系的用途键：同一角色最多各一套（境界复用 R25，不在这里） */
export type UnitKind = "currency" | "proficiency";

/** 数量总数上限（F-5 负重是 P2，这里只做显示用的大数保护） */
export const QTY_MAX = 999999;
