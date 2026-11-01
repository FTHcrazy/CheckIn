/**
 * 地图画布文档模型
 *
 * 与 PRD §7 的 `novel_maps.content` JSON 结构对齐，便于后续接持久化。
 * 本阶段仅内存态（不落库），但结构保持一致，避免后续迁移。
 */
import type { MapRegion, Point } from "./regions";

/**
 * 世界坐标点。
 *
 * 真正的声明在 `regions.ts`（区块几何与它同域），这里只做**类型复导出**：
 * 两处各写一份 `interface Point` 虽然结构相容，但一旦将来给其中一边加字段，
 * 另一边就会静默地不再等价 —— 而坐标是本模块里传播最广的类型。
 */
export type { Point } from "./regions";

/** 世界矩形（与 regions.ts 的 RegionBounds 结构一致） */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 陆地 —— 只存几何，不存位图。
 *
 * 位图（海岸烘焙纹理）是**派生物**：换风格、换分辨率都要重画，
 * 存进文档反而成为负担（撤销栈会抱着一张 4096² 的纹理跑）。
 */
export interface MapLand {
  /** 生成种子，同种子必得同一形状（撤销/重做与截图比对都靠它） */
  seed: number;
  /** 一个或多个岛，每个是闭合多边形（首尾不重复存），世界坐标 */
  polygons: Point[][];
  /** 生成时用的世界矩形（整张纸）；烘焙时据此算纹理原点与尺寸 */
  bounds: Rect;
}

/**
 * 全局风格预设。
 *
 * 三档是**枚举**而不是数值：风格切换要触发海岸重烘（`bakeKey` 含它），
 * 连续数值会让"切回去"也产生新 key，白白重建一次几十毫秒的 RenderTexture。
 */
export type MapStyle = "none" | "parchment" | "ink";

/**
 * 标注字号档（世界单位，靠 `scale = 1/scale` 在屏幕上恒定）。
 *
 * 【为什么是数组 + 派生类型，而不是直接写联合字面量】三档既要给类型用、也要给
 * 工具栏的下拉渲染用。分两处写就会出现"类型是三档、下拉里是两档"这种只在点了
 * 才知道的错位。这里数组是唯一事实源，类型由它派生。
 *
 * 【为什么是"手动选"而不是按层级自动绑】(PRD §4.4) 地名是给人读的，字号该由
 * 编辑者按"这块地方重不重要"决定；跟着层级走会让同一条地名在缩放过程中不断
 * 变形，反而读不成句。
 */
export const LABEL_SIZES = [10, 12, 16] as const;

/** 标注字号档 */
export type MapLabelSize = (typeof LABEL_SIZES)[number];

/** 地名标注 */
export interface MapLabel {
  /** 实例唯一 id（`lb_` 前缀，见 `createLabelId`） */
  id: string;
  /** 文本内容 */
  text: string;
  /** 世界坐标：水平居中锚点 */
  x: number;
  /** 世界坐标：锚点位置 */
  y: number;
  /** 字号档 */
  size: MapLabelSize;
  /**
   * 归属层级；`null` = 层级无关（任何缩放都可见）。
   *
   * 与素材同一套规则（见 `MapElement.level`）：在郡那一级起的地名属于郡的世界，
   * 缩到洲去看时不该还在，否则"大地图上一堆小地名"会把画面糊死。
   */
  level: number | null;
  /** 联动素材 id；有值时随素材移动、删除（不留孤儿标注） */
  elementId?: string;
  /** 避让偏移（世界单位，向下为负）；只由渲染层写，不进撤销栈 */
  offsetY?: number;
}

/** 画布文档 */
export interface MapDocument {
  /** 文档结构版本号，便于后续迁移（2 = 本次渲染观感改造，见 PRD §6.5） */
  version: number;
  /** 底图标识 */
  baseImageId: string;
  /** 陆地几何；`null` = 未生成（此时不画海岸四层，画面退回老观感） */
  land: MapLand | null;
  /** 全局风格预设（"none" = 原色，不挂任何滤镜） */
  style: MapStyle;
  /** 地名标注 */
  labels: MapLabel[];
  /**
   * 分区显隐开关（默认 true）。
   *
   * 存进文档而不是纯 UI 状态：它影响画面（关掉 = 给读者看的成品图），
   * 用户会期望"切错了能撤销"（PRD §6.2），因此必须随撤销栈一起回滚。
   */
  showRegions: boolean;
  /** 已放置的素材 */
  elements: MapElement[];
  /** 随机生成的区块划分（空数组 = 未分区） */
  regions: MapRegion[];
}

/** 已放置的素材实例 */
export interface MapElement {
  /** 实例唯一 id */
  id: string;
  /** 素材类型 id（对应 sprites.ts 的 SPRITES[].id） */
  spriteId: string;
  /** 世界坐标：水平中心 */
  x: number;
  /** 世界坐标：底部锚点（贴图"脚底"位置，便于地形贴合） */
  y: number;
  /** 元素自身缩放（相对 baseWidth/baseHeight） */
  scale: number;
  /** 旋转角度（度），本阶段恒为 0，预留给后续 */
  rotation: number;
  /**
   * 放置时所处的层级序号（0 = 大陆 … 3 = 郡，见 lod.ts 的 `activeLevel`）。
   *
   * 【为什么素材要记层级】素材不是"浮在地图上的一层贴纸"，而是某个尺度下的地形：
   * 在郡那一级摆的山，属于郡的世界；缩到洲/国家去看时它就该退场，否则会看到
   * 一堆与当前尺度不匹配的小山散在整张图上。
   * 渲染时按该层级的权重做 alpha（见 `elementWeight`），因此素材与区块边界
   * 同呼吸 —— 层级淡出它就淡出，切到别的层级它就消失。
   *
   * `null` = 层级无关：在生成区块之前放置的素材（那时还没有任何层级可言），
   * 任何缩放下都可见。缺字段同样按 `null` 读，老数据不会因此消失。
   */
  level: number | null;
}

/** 创建空文档 */
export function createEmptyDocument(): MapDocument {
  return {
    version: 2,
    baseImageId: "base-1",
    land: null,
    style: "none",
    labels: [],
    showRegions: true,
    elements: [],
    regions: [],
  };
}

/**
 * 文档迁移（纯函数）：v1 → v2，缺字段补默认值，未知字段**原样保留**。
 *
 * 【为什么不做 strict 白名单】文档将来要落库（`novel_maps.doc_json` 单列），
 * 而落库的数据一定比代码"老"：某个版本多出来的字段若被这里丢掉，
 * 用户升级后打开旧地图就会静默丢失内容。宁可多带一个字段，不可少带一个。
 */
export function migrateDoc(raw: unknown): MapDocument {
  const src: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const style = src.style;
  return {
    ...(src as unknown as MapDocument),
    version: 2,
    baseImageId: typeof src.baseImageId === "string" ? src.baseImageId : "base-1",
    land: (src.land as MapLand | null | undefined) ?? null,
    style: style === "parchment" || style === "ink" ? style : "none",
    labels: Array.isArray(src.labels) ? (src.labels as MapLabel[]) : [],
    showRegions: typeof src.showRegions === "boolean" ? src.showRegions : true,
    elements: Array.isArray(src.elements) ? (src.elements as MapElement[]) : [],
    regions: Array.isArray(src.regions) ? (src.regions as MapRegion[]) : [],
  };
}

/** 生成实例 id（时间戳 + 随机后缀，会话内足够唯一） */
export function createElementId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 生成标注 id（与 `createElementId` 同款，前缀区分 `lb_`） */
export function createLabelId(): string {
  return `lb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 新建标注的默认字号档。
 *
 * 放在数据层而不是渲染层：它是**文档的默认值**（写进 `MapLabel.size`），
 * 与 `MapCanvas` 无关。若定义在 `labelSync.ts`，`useMapEditor` 就得反过来
 * import 一个组件目录里的模块 —— 状态层依赖渲染层，是最难拆的一类耦合。
 */
export const LABEL_DEFAULT_SIZE: MapLabelSize = 12;

/**
 * 联动素材的地名与素材锚点的垂直距离（世界单位）。
 *
 * 素材的 `y` 是**脚底**（贴地的那一点），地名要浮在它的"头顶"之上，
 * 所以是减而不是加。8 个单位在郡那一级（自然缩放 ≈ 2.2）约等于 18 屏幕像素，
 * 正好一个字的行高 —— 贴着但不压住贴图。
 */
export const LABEL_ABOVE_ELEMENT = 8;
