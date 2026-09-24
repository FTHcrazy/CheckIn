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
  /**
   * 缩放范围（无级缩放前提）
   * 地形改由 WebGL 每像素采样渲染后不再受「离屏位图倍率」限制，
   * 故上限大幅放开（可放大于 4× 看清单格纹理），下限松开便于跨尺度缩略。
   */
  minScale: 0.02,
  maxScale: 16,
} as const;

/** 栅格分辨率候选（开放问题 ①） */
export const RES_PRESETS = [
  { key: "64x40", cols: 64, rows: 40, label: "64×40" },
  { key: "80x50", cols: 80, rows: 50, label: "80×50（默认）" },
  { key: "120x75", cols: 120, rows: 75, label: "120×75（高清）" },
] as const;

export const DEFAULT_RES = "80x50";

/**
 * 约束模板清单（RM8① 可多选组合）。
 *
 * 分两组：
 * - `base` 基础格局：通用世界地理形态，任意题材都能用；
 * - `hot` 热门小说格局：网文高频世界观（九州/十万大山/南疆沼泽/赤炎火山/裂谷/
 *   群岛/东荒/古战场/千里平原），勾一个就能出「读者一眼认得出」的格局。
 *
 * 每条 desc 即「提示词语义」——文案只描述**大格局**，细节交给噪声与手改。
 */
export const TEMPLATE_OPTIONS = [
  // ── 基础格局 ──
  { key: "threeSea", group: "base", name: "三面环海", desc: "西/东/南三侧入海，北侧与大陆相连" },
  { key: "island", group: "base", name: "四面环海", desc: "孤岛，四周皆海" },
  { key: "centralContinent", group: "base", name: "中央大陆", desc: "大陆居中四方临海，九州格局的底子" },
  { key: "westDesert", group: "base", name: "西面沙漠", desc: "西侧干旱，沙丘连绵" },
  { key: "northSnow", group: "base", name: "北境雪原", desc: "北方覆雪，雪山雪原" },
  { key: "centerLake", group: "base", name: "中央大湖", desc: "大陆中央内陆湖" },
  { key: "bigRiver", group: "base", name: "大河贯境", desc: "主干河流 + 支流" },
  { key: "barren", group: "base", name: "荒芜大陆", desc: "整体干旱，少植被" },
  // ── 热门小说格局 ──
  { key: "tenThousandMountains", group: "hot", name: "十万大山", desc: "山脉自北向南连绵，山国格局：山多平原少、崖壁密布" },
  { key: "southSwamp", group: "hot", name: "南疆沼泽", desc: "南部低洼水乡，沼泽与河网成片" },
  { key: "volcanic", group: "hot", name: "赤炎火山", desc: "火脉纵横，熔岩成片，土色焦黑" },
  { key: "riftCanyon", group: "hot", name: "裂谷天堑", desc: "一条深谷自北向南贯通全图，两岸崖壁对立" },
  { key: "archipelago", group: "hot", name: "群岛海域", desc: "碎岛散布、海面为主，航海与渡海世界" },
  { key: "eastWaste", group: "hot", name: "东荒戈壁", desc: "东侧干旱荒原，碎石与沙砾遍布" },
  { key: "ruinFields", group: "hot", name: "古战场废墟", desc: "大片废墟碎石夹杂断墙，上古战场遗迹" },
  { key: "plains", group: "hot", name: "千里平原", desc: "低起伏的大平原，山地稀少、视野开阔" },
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
