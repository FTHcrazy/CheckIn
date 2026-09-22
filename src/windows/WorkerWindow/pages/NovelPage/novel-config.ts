import type { BuiltinEntityType, EditorSettings } from "./types";

/**
 * 小说编辑器页面级配置与展示常量
 *
 * 所有尺寸照搬 UI 设计方案 §03 页面地图，色值一律用 var(--app-*) 令牌，
 * 保证四套主窗口主题切换后整体跟随（见 AGENTS.md 6.1.1 主题规范）。
 */

/** 三栏布局尺寸（设计方案 §03） */
export const LAYOUT = {
  topBarHeight: 44,
  leftRailWidth: 236,
  /** 右栏基准宽度（支撑面板改版：原 322 → 340） */
  rightRailWidth: 340,
  /** 右栏可拖拽下限：低于此值名卡 / chips 会被挤到换行 */
  rightRailMinWidth: 280,
  /** 右栏可拖拽上限：再宽会挤压正文最小可用宽度 */
  rightRailMaxWidth: 460,
  statusBarHeight: 32,
  /**
   * 正文舞台最小可用宽度：三栏（左 236 + 右 322）挤到低于此值时，
   * 自动收起左栏给码字区让位（右栏是用户按需打开的，不自动收）。
   * 默认 1200 宽窗口三栏全开可留 642px，不触发；小屏 / 半屏窗口才触发。
   */
  minStageWidth: 560,
  /** 快照抽屉宽度（D1） */
  drawerWidth: 300,
} as const;

/** 新建卷的默认存储名：展示时视为「未命名」不追加显示（左栏卷头与大纲板共用） */
export const UNNAMED_VOLUME = "未命名卷";

/**
 * userDb config 表存储键（PRD v0.5 步骤一）
 *
 * 设置与续写位置都是「单用户、低频写、整读整写」的小数据，
 * 复用既有 config 表（key-value）而不是为它们建新表。
 */
export const STORAGE_KEYS = {
  /** 排版与写作设置（R5 持久化） */
  settings: "novel_editor_settings",
  /** 上次续写位置：作品 / 章节 / 光标 / 滚动（R6） */
  position: "novel_editor_position",
  /** 自定义要素类型（R23）：CustomEntityTypeDef[] 整读整写 */
  entityTypes: "novel_entity_types",
  /** 起名工具收藏夹（R18 ④）：NameFavorite[] 整读整写，按作品持久化 */
  namingFavorites: "novel_naming_favorites",
  /** 起名工具自定义用字池（R18 ①）：NamingCustomPool 整读整写 */
  namingCustomPools: "novel_naming_custom_pools",
  /** 右栏宽度（支撑面板改版）：单个数字整读整写，270ms 防抖后落库 */
  panelWidth: "novel_panel_width",
} as const;

/** 续写位置记忆（R6）：变化后防抖落库 */
export const POSITION = {
  debounceMs: 500,
} as const;

/** 右栏宽度拖拽的持久化节奏：拖拽过程只动内存，停手才落库 */
export const PANEL_WIDTH = {
  debounceMs: 300,
} as const;

/** 保存时机（PRD §2） */
export const SAVE = {
  /** 输入停顿防抖 */
  debounceMs: 800,
  /** 强制 flush 兜底 */
  flushIntervalMs: 30_000,
  /** 每章保留快照版本数 */
  snapshotKeep: 20,
  /** 增量快照双阈值 */
  snapshotIntervalMs: 300_000,
  snapshotDeltaWords: 500,
} as const;

/** 标注层时序（设计方案 §05 标注层生命周期） */
export const ANNOTATION = {
  /** 防抖等待 */
  debounceMs: 300,
  /** hover 出卡延迟 */
  hoverOpenMs: 200,
  /** 移开后消失延迟 */
  hoverCloseMs: 100,
  /** 单次输入 decoration 计算预算 */
  budgetMs: 2,
} as const;

/** 轻提示自动消失时长（设计方案 §06 Toast） */
export const TOAST_DURATION_MS = 2400;

/**
 * 左栏拖拽排序的 dataTransfer MIME 标记（R9）
 *
 * 用自定义 MIME 而非 text/plain，drop 目标在 dragover 阶段
 * 仅凭 types 即可判断拖的是章节还是卷（getData 在 drop 前不可读）。
 */
export const DRAG_MIME_CHAPTER = "application/x-nv-chapter";
export const DRAG_MIME_VOLUME = "application/x-nv-volume";

/** 排版默认值（PRD §2 中文排版默认值） */
export const DEFAULT_SETTINGS: EditorSettings = {
  fontSize: 17,
  lineHeight: 1.9,
  paragraphSpacing: 0.6,
  indent: true,
  dailyGoal: 3000,
  wordCountMode: "withPunctuation",
  annotationTypes: ["character", "location", "faction"],
  numberStyle: "chinese",
  chapterSuffix: "章",
  volumeSuffix: "卷",
  confirmReorder: true,
};

/**
 * 章节 / 卷后缀快捷选项（R1 序号自定义）
 *
 * 数字样式（numberStyle）与后缀是两个独立配置：阿拉伯/中文数字 × 任意后缀
 * 自由组合，快捷项之外支持用户直接输入自定义后缀（见设置抽屉）。
 */
export const CHAPTER_SUFFIX_OPTIONS = ["章", "张", "回", "节"] as const;
export const VOLUME_SUFFIX_OPTIONS = ["卷", "部", "篇", "集"] as const;

/** 设置抽屉可调范围 */
export const SETTINGS_RANGE = {
  fontSize: { min: 14, max: 24, step: 1 },
  lineHeight: { min: 1.4, max: 2.4, step: 0.1 },
  paragraphSpacing: { min: 0, max: 1.6, step: 0.1 },
  dailyGoal: { min: 500, max: 20000, step: 500 },
} as const;

export interface EntityTypeMeta {
  label: string;
  /** 主色：头像底、名称、正文高亮描边 */
  color: string;
  /** 弱色：卡片底、筛选 chip 底、正文高亮底色 */
  colorWeak: string;
}

/**
 * 内置要素类型语义色
 *
 * 设计方案 §02 要求「类型色在正文高亮、卡片头像、筛选 chips 三处严格一致」，
 * 这里统一映射到主窗口的四套主题变量上，换肤自动跟随。
 * 自定义类型（ct-*）的 meta 不在这里——由 EntityTypeContext 派生（R23）。
 */
export const ENTITY_TYPE_META: Record<BuiltinEntityType, EntityTypeMeta> = {
  character: {
    label: "角色",
    color: "var(--app-primary)",
    colorWeak: "var(--app-primary-weak)",
  },
  location: {
    label: "地点",
    color: "var(--app-accent-green)",
    colorWeak: "var(--app-accent-green-weak)",
  },
  faction: {
    label: "势力",
    color: "var(--app-accent-purple)",
    colorWeak: "var(--app-accent-purple-weak)",
  },
  item: {
    label: "物品",
    color: "var(--app-accent-amber)",
    colorWeak: "var(--app-accent-amber-weak)",
  },
  level_system: {
    label: "等级体系",
    color: "var(--app-accent-blue)",
    colorWeak: "var(--app-accent-blue-weak)",
  },
  custom: {
    label: "自定义",
    color: "var(--app-text-secondary)",
    colorWeak: "var(--app-surface-active)",
  },
};

/** 要素库筛选顺序（内置部分）：全部在前，其余按语义分组；自定义类型追加在末尾 */
export const ENTITY_FILTER_ORDER: BuiltinEntityType[] = [
  "character",
  "location",
  "faction",
  "item",
  "level_system",
  "custom",
];

/** 选区标记工具条的快捷类型（O3）：保持内置四类，自定义类型走资料卡编辑 */
export const MARK_TYPE_OPTIONS: BuiltinEntityType[] = [
  "character",
  "location",
  "faction",
  "item",
];

/**
 * 「当前境界」关联名（R25）：绑定存 novel_links（toType='level' 指向
 * novel_levels.id），一个要素同时只持有一条当前境界绑定。
 */
export const LEVEL_RELATION = "当前境界";

/**
 * 自定义类型色板（R23）：具体色值，与四套主题的 var(--app-*) 解耦。
 * 取与内置语义色错开的中饱和色，弱色在使用处 color-mix 派生。
 */
export const CUSTOM_TYPE_PALETTE: readonly string[] = [
  "#e0559a",
  "#14b8a6",
  "#e8722a",
  "#8b5cf6",
  "#3b82f6",
  "#ca8a04",
  "#0ea5e9",
  "#64748b",
] as const;

/** 章节状态展示（PRD R1） */
export const CHAPTER_STATUS_META = {
  draft: { label: "草稿", color: "var(--app-text-disabled)" },
  done: { label: "完稿", color: "var(--app-success)" },
} as const;

/** 保存状态机展示（设计方案 §06） */
export const SAVE_STATE_TEXT = {
  idle: "待输入",
  pending: "输入中",
  saving: "保存中",
  saved: "已保存",
  failed: "已转入快照",
} as const;
