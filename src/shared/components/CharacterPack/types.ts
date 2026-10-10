/**
 * 行囊（CharacterPack）领域模型
 *
 * 与主进程 DTO 一一对应（单一事实源在 src/shared/types/electron.d.ts），
 * 这里只做「重命名别名 + 本模块私有的 UI 概念」，避免两处字段定义各自漂移。
 */
import type {
  PackAttributeDTO,
  PackBundleDTO,
  PackCharacterDTO,
  PackDraftDTO,
  PackItemDTO,
  PackLayoutDTO,
  PackLevelRungDTO,
  PackLevelSystemDTO,
  PackModifierDTO,
  PackNatureDTO,
  PackOpDTO,
  PackOwnerTypeDTO,
  PackPresetDTO,
  PackProtagonistDTO,
  PackRealmLinkDTO,
  PackRecordDTO,
  PackSavePayloadDTO,
  PackSkillDTO,
  PackSlotDTO,
  PackUnitSystemDTO,
} from "@/shared/types/electron";

export type {
  PackBundleDTO,
  PackDraftDTO,
  PackLevelRungDTO,
  PackLevelSystemDTO,
  PackRealmLinkDTO,
  PackRecordDTO,
  PackSavePayloadDTO,
};

/** 领域别名：本模块内部统一用不带 DTO 后缀的名字 */
export type PackCharacter = PackCharacterDTO;
export type PackAttribute = PackAttributeDTO;
export type PackSlot = PackSlotDTO;
export type PackItem = PackItemDTO;
export type PackSkill = PackSkillDTO;
export type PackModifier = PackModifierDTO;
export type PackUnitSystem = PackUnitSystemDTO;
export type PackLayout = PackLayoutDTO;
export type PackPreset = PackPresetDTO;
export type PackNature = PackNatureDTO;
export type PackOp = PackOpDTO;
export type PackOwnerType = PackOwnerTypeDTO;
export type PackLevelSystem = PackLevelSystemDTO;
export type PackLevelRung = PackLevelRungDTO;
export type PackRealmLink = PackRealmLinkDTO;
export type PackRecord = PackRecordDTO;
export type PackDraft = PackDraftDTO;
export type PackBundle = PackBundleDTO;
export type PackProtagonist = PackProtagonistDTO;

/** 效果性质的中文与徽标（§8.3 徽标图例：三者视觉必须一眼可分） */
export const NATURE_META: Record<
  PackNature,
  { label: string; badge: string; hint: string }
> = {
  passive: { label: "被动", badge: "被", hint: "载体在效即常驻生效，计入总属性" },
  sustained: { label: "持续", badge: "持", hint: "需单独开启才生效，开启时计入" },
  cast: { label: "释放", badge: "放", hint: "角色主动释放，永不参与属性汇总" },
};

export const OP_META: Record<PackOp, { label: string; symbol: string }> = {
  add: { label: "加算", symbol: "+" },
  percent: { label: "百分比", symbol: "+%" },
  mul: { label: "乘算", symbol: "×" },
  override: { label: "覆盖", symbol: "=" },
};

/** 模块键：布局配置、模块管理、渲染顺序都以它为准 */
export type PackModuleKey =
  | "summary"
  | "attributes"
  | "equipment"
  | "inventory"
  | "skills"
  | "realm"
  | "currency"
  | "status"
  | "note";

export interface PackModuleMeta {
  key: PackModuleKey;
  label: string;
  /** 模块管理面板里的一句话说明 */
  desc: string;
}

/** 模块清单（顺序即出厂默认顺序，模块管理里可拖拽改写） */
export const PACK_MODULES: PackModuleMeta[] = [
  { key: "summary", label: "总属性汇总", desc: "基础值 → 总览值，增量按被动 / 持续分段" },
  { key: "attributes", label: "人物属性", desc: "自定义属性定义与基础值，支持分组" },
  { key: "equipment", label: "装备栏", desc: "部位与槽位自定义，穿戴 / 卸下" },
  { key: "inventory", label: "物品栏", desc: "背包物品与数量快调" },
  { key: "skills", label: "技能栏", desc: "技能开关、熟练度与效果" },
  { key: "realm", label: "境界", desc: "复用 R25 等级体系，与实体面板同一份数据" },
  { key: "currency", label: "货币", desc: "自定义进制与自动进位" },
  { key: "status", label: "状态效果", desc: "Buff / Debuff：不挂在装备技能上的持续型效果" },
  { key: "note", label: "备注速记", desc: "作者自己看的临时备忘" },
];

/** 布局状态（**设定数据**：启用与顺序走草稿统一保存） */
export interface PackModuleState {
  key: PackModuleKey;
  enabled: boolean;
  sortOrder: number;
}

/**
 * 界面偏好（**即改即存**，走 config 键 `novel_pack_ui`）
 *
 * 判据（PRD §8.6.2）：改了这个值，别人的这本书会变吗？
 * 不会 → 属于「我在怎么用这个工具」，不进草稿、不计入未保存改动。
 */
export interface PackUiPrefs {
  /** 面板形态：reflow = 右侧让位；overlay = 窄窗降级（全屏浮层 + 遮罩） */
  form: "reflow" | "overlay";
  width: number;
  /** 模块折叠状态 */
  collapsed: Partial<Record<PackModuleKey, boolean>>;
  /** 物品栏视图 */
  inventoryView: "list" | "grid";
  /** 技能栏是否展示熟练度（关闭时相关 UI 完全缺席，而非置灰） */
  showProficiency: boolean;
  /** 自动保存兜底（G-3，可关闭，但关闭后关闭拦截仍生效） */
  autoSave: boolean;
  /** 已读「本章变动」标记的时间戳底线（F-2：24 小时过期 / 手动全部已读） */
  changedReadAt: number;
}

export const DEFAULT_UI_PREFS: PackUiPrefs = {
  form: "reflow",
  width: 420,
  collapsed: {},
  inventoryView: "list",
  showProficiency: false,
  autoSave: true,
  changedReadAt: 0,
};

/** 本章变动角标有效期（F-2） */
export const CHANGED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 估算模式的临时加成（REQ-037）
 *
 * **只活在内存里**：不落草稿、不进正式表、不计入未保存改动数 —— 它的语义就是
 * 「假设这些加成现在就生效，换算结果是多少」。面板一关就没了，这是刻意的：
 * 一旦它被持久化，就变成一条要维护的真数据，估算模式也就不再是「试算」。
 */
export interface EstimateEntry {
  id: string;
  /** 目标属性 id */
  attrId: string;
  op: PackOp;
  value: number;
}

/** 属性分组的默认值（B-1 支持分组） */
export const DEFAULT_ATTR_GROUP = "基础属性";

/** 属性模板（B-1：通用 / 玄幻 / 网游 一键套用） */
export interface AttrTemplateItem {
  name: string;
  groupName: string;
  baseValue: number;
  unit?: string;
}

export const ATTR_TEMPLATES: Record<string, AttrTemplateItem[]> = {
  通用: [
    { name: "力量", groupName: "战斗属性", baseValue: 10 },
    { name: "敏捷", groupName: "战斗属性", baseValue: 10 },
    { name: "体质", groupName: "战斗属性", baseValue: 10 },
    { name: "智力", groupName: "战斗属性", baseValue: 10 },
    { name: "气血", groupName: "基础属性", baseValue: 100 },
    { name: "法力", groupName: "基础属性", baseValue: 50 },
  ],
  玄幻: [
    { name: "气血", groupName: "基础属性", baseValue: 100 },
    { name: "真元", groupName: "基础属性", baseValue: 50 },
    { name: "神识", groupName: "基础属性", baseValue: 20 },
    { name: "根骨", groupName: "资质", baseValue: 10 },
    { name: "悟性", groupName: "资质", baseValue: 10 },
  ],
  网游: [
    { name: "攻击力", groupName: "战斗属性", baseValue: 100 },
    { name: "防御力", groupName: "战斗属性", baseValue: 80 },
    { name: "暴击率", groupName: "战斗属性", baseValue: 5, unit: "%" },
    { name: "闪避率", groupName: "战斗属性", baseValue: 5, unit: "%" },
    { name: "生命值", groupName: "基础属性", baseValue: 1000 },
    { name: "魔法值", groupName: "基础属性", baseValue: 500 },
  ],
};

/** 物品分类（B-3：3 个常见类别的快捷按钮） */
export const ITEM_CATEGORIES = ["装备", "丹药", "材料", "消耗品", "杂物"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** 稀有度（B-3 字段之一） */
export const RARITY_META: Record<string, { label: string; color: string }> = {
  common: { label: "普通", color: "var(--app-text-secondary)" },
  fine: { label: "精良", color: "var(--app-accent-green)" },
  rare: { label: "稀有", color: "var(--app-accent-blue)" },
  epic: { label: "史诗", color: "var(--app-accent-purple)" },
  legend: { label: "传说", color: "var(--app-accent-amber)" },
};

/**
 * 稀有度取值顺序（REQ-010：下拉菜单按它排列，从低到高）
 *
 * 单独导出而不是用 `Object.keys(RARITY_META)`：菜单顺序是**产品口径**（由弱到强），
 * 不该被一个「文案表」的键序顺带决定 —— 哪天有人为了分组把 META 重新排一遍，
 * 菜单就会跟着乱，而且不会有任何报错。
 */
export const RARITY_KEYS = ["common", "fine", "rare", "epic", "legend"] as const;
export type PackRarity = (typeof RARITY_KEYS)[number];

/**
 * 取稀有度的显示元信息（未知取值给中性兜底）
 *
 * 库里的 `rarity` 是自由字符串（历史数据 / 手工改库都可能有别的值），
 * 直接用 `RARITY_META[key]` 会得到 `undefined` → 圆点变成没有 background 的透明块，
 * 看着像「这条没设稀有度」而不是「这个值不认识」。
 */
export function rarityMetaOf(key: string): { label: string; color: string } {
  const meta: { label: string; color: string } | undefined = RARITY_META[key];
  if (meta) return meta;
  return { label: key || "未知", color: "var(--app-text-disabled)" };
}

/** 释放型效果的参数字段（REQ-040）：效果量单位 / 目标 */
export const CAST_UNITS = ["攻击力%", "法术强度%", "最大生命%", "固定伤害", "治疗量%"] as const;
export const CAST_TARGETS = ["自身", "单体", "群体", "区域"] as const;

/** 汇总分段色（被动 / 持续两段颜色需可区分且不喧宾夺主） */
export const NATURE_SEGMENT_COLOR: Record<PackNature, string> = {
  passive: "var(--app-text-secondary)",
  sustained: "var(--app-accent-blue)",
  cast: "var(--app-accent-amber)",
};

/** 未保存改动的提示文案阈值（G-3：≥5 处做一次轻微呼吸提示） */
export const DIRTY_BREATHE_AT = 5;

/** 草稿写入防抖（§9.6 问题 5：800ms 防抖 + 面板关闭时必写） */
export const DRAFT_DEBOUNCE_MS = 800;

/** 自动保存兜底（G-3：默认开，5 分钟无操作） */
export const AUTOSAVE_IDLE_MS = 5 * 60 * 1000;
