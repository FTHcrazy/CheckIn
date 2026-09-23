/**
 * MapPage 配置常量（PRD novel-map §4 产品结构 + §5.1 图例规格）
 */

export const LAYOUT = {
  /** 顶栏高度（WindowHeader 由通用组件提供 34px 拖动条 + 46px 顶栏） */
  topBarHeight: 46,
  /** 左栏宽度（标注列表，可收起） */
  sidebarWidth: 240,
  sidebarMinWidth: 200,
  sidebarMaxWidth: 320,
  /** 右栏属性面板宽度 */
  propsWidth: 280,
  /** 底部状态条高度 */
  statusBarHeight: 32,
  /** 画布默认缩放 */
  defaultScale: 0.75,
  /** 缩放范围 */
  minScale: 0.1,
  maxScale: 4.0,
} as const;

/** 栅格分辨率候选（开放问题 ①） */
export const RES_PRESETS = [
  { key: "64x40", cols: 64, rows: 40, label: "64×40" },
  { key: "80x50", cols: 80, rows: 50, label: "80×50（默认）" },
  { key: "120x75", cols: 120, rows: 75, label: "120×75（高清）" },
] as const;

export const DEFAULT_RES = "80x50";

/** 约束模板清单（RM8① 可多选组合） */
export const TEMPLATE_OPTIONS = [
  { key: "threeSea", name: "三面环海", desc: "西/东/南三侧入海，北侧与大陆相连" },
  { key: "island", name: "四面环海", desc: "孤岛，四周皆海" },
  { key: "westDesert", name: "西面沙漠", desc: "西侧干旱，沙丘连绵" },
  { key: "northSnow", name: "北境雪原", desc: "北方覆雪，雪山雪原" },
  { key: "centerLake", name: "中央大湖", desc: "大陆中央内陆湖" },
  { key: "bigRiver", name: "大河贯境", desc: "主干河流 + 支流" },
  { key: "barren", name: "荒芜大陆", desc: "整体干旱，少植被" },
] as const;

/** 符号风格（开放问题 ⑦） */
export const STYLE_OPTIONS = [
  { key: "A", name: "圆润" },
  { key: "B", name: "尖锐" },
  { key: "C", name: "简约" },
] as const;

/** 标注类型（RM3） */
export type AnnotationKind = "pin" | "area" | "label" | "line";

/** 标注图标分类（RM3 地点钉按要素类型取色） */
export const KIND_COLORS: Record<string, string> = {
  city: "var(--app-primary)",
  town: "var(--app-accent-green)",
  village: "var(--app-accent-green)",
  pass: "var(--app-accent-orange)",
  mountain: "var(--app-accent-purple)",
  river: "var(--app-primary)",
  forest: "var(--app-accent-green)",
  custom: "var(--app-text)",
};

/** 自动保存防抖间隔（对齐编辑器心智 800ms） */
export const AUTOSAVE_DEBOUNCE_MS = 800;
