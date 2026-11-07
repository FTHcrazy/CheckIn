/**
 * 地图画布文档模型
 *
 * 与 PRD §7 的 `novel_maps.content` JSON 结构对齐，便于后续接持久化。
 * 本阶段仅内存态（不落库），但结构保持一致，避免后续迁移。
 */
import { hslToRgb, normalizeRegionSchema } from "./regions";
import type { MapRegion, Point, RegionLevelDef } from "./regions";
import { normalizeLayerState } from "./layerState";
import type { MapLayerStateMap } from "./layerState";

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
  /**
   * 大陆底色（`0xRRGGBB`，来自 `land.ts` 的 `LAND_BASE_COLORS`）。
   *
   * 【缺省 = 羊皮纸】老文档没有这个字段，烘焙回落 `COAST_FILL.color` ——
   * 与 2.40.0 及以前的渲染逐字节一致。
   */
  baseColor?: number;
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

/**
 * 一条折线要素（河流 / 道路 / 山脊 / 边界）。
 *
 * 【为什么是一套类型 + `kind`，而不是每种线各建一个类型】见 B4 PRD D5：
 * 它们的**几何与编辑方式完全相同**（拖节点、插点、删点），只有外观与语义不同。
 * 按 `kind` 分类型会让"移动节点"这类代码写五遍，且新增一种线要改五处。
 *
 * 【`closed` 只描边、不填充】见 D6：`regions` 已占 polygon 语义（tiling 划分），
 * 再加自由填充面就要处理与区块的重叠、填充混合、导出与子图裁剪四套规则。
 * 湖泊 / 势力范围用闭合折线描边已够用；真要上色是独立需求。
 */
export interface MapPolyline {
  /** 实例唯一 id（`pl_` 前缀） */
  id: string;
  /** 语义类型（决定默认样式与图标，不影响几何） */
  kind: "road" | "river" | "ridge" | "border" | "route";
  /** 样式档 id（见 B4 PRD §4.4 的样式表）；`kind` 只是默认样式的来源 */
  styleId: string;
  /** 世界坐标控制点；首尾是端点，中间是控制点（渲染时走 Catmull-Rom 平滑） */
  points: Point[];
  /** `true` = 首尾相连（湖泊 / 势力范围轮廓），v1 只描边 */
  closed: boolean;
  /** 归属层级，语义同 `MapElement.level`（`null` = 层级无关，任何缩放都可见） */
  level: number | null;
  /** 语义标签（「官道」「清河」），纯展示，不等于 `kind` */
  label?: string;
  /**
   * 线宽倍数（属性面板的滑杆，`0.5 ~ 2.5`，缺省 1）。
   *
   * 【为什么是"倍数"而不是绝对线宽】样式档负责"这条线该多粗"的手感，
   * 用户只需要在同一档内微调（"我这块地的官道略细一点"）。存倍数后，
   * 换样式档不会把用户调过的粗细一起丢掉 —— 存绝对值就会。
   *
   * 可选 + 零写入：没拖过滑杆的线不写这个字段。
   */
  widthScale?: number;
}

/**
 * 一张嵌套子地图（区块内嵌的独立地图）。
 *
 * 【为什么是「独立坐标系 + 独立内容」而不是「把父图一部分切开复用」】
 * 子图的 land / regions / elements / labels 全部在**子图本地坐标**里表达，
 * 与父图零耦合 —— 它是另一张完整的小地图，只是被「装进」了父图的某个区块里。
 * 这样它才能独立编辑、独立换风格、独立换底图，也能被任意复用（同一张子图
 * 贴到多个区块）。
 *
 * 【递归定义】`regions` 里的每个区块又可以有 `submap`，于是「无级嵌套」——
 * 国家图里嵌郡图、郡图里嵌城图…… 理论上无限深。
 */
export interface MapSubmap {
  /** 实例唯一 id（`sm_` 前缀） */
  id: string;
  /** 子图自己的世界范围（相对子图本地坐标），子图内部一切几何以此为参照 */
  bounds: Rect;
  /** 子图自己的陆地（null = 只有底图海面，未生成陆地） */
  land: MapLand | null;
  /** 子图自己的区块树（递归：子图的区块还能再嵌子图） */
  regions: MapRegion[];
  /** 子图自己的素材 / 标注（复用 MapElement / MapLabel，level 语义在子图局部） */
  elements: MapElement[];
  labels: MapLabel[];
  /**
   * 子图自己的折线（复用 `MapPolyline`，坐标在**子图本地**）。
   *
   * 可选 + 零写入：老子图不写值，读点走 `submapPolylines`。
   * B4-1 只落数据模型（子图内画线的入口留到 B4-2 之后，见 PRD §9-3）。
   */
  polylines?: MapPolyline[];
  /** 子图可独立换风格 */
  style: MapStyle;
  /** 子图可独立换底图（默认继承父图） */
  baseImageId: string;
  /**
   * 子图自己的层级定义（长度 = 层数，1~4）。
   *
   * 【缺省继承父文档 schema】读时回落（`regionSchemaOf(submap)` 会拿到**子图自己**的；
   * 子图缺字段时调用方传父文档那份进来，不写值 —— 避免复制漂移）。
   * 本轮**只加字段，不加消费逻辑**：子图内部的区域编辑没有可达路径（架构 §6-9）。
   */
  regionSchema?: RegionLevelDef[];
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
  /**
   * 折线要素（河流 / 道路 / 山脊 / 边界）。**可选**：老文档不写值。
   *
   * 【与 `regions` / `elements` 的"可选性"不一致，是有意的】那两个是老字段
   * （B4 之前就在），已经按 `[]` 落库；`polylines` 是新字段，按零写入原则
   * 不补默认值 —— 读点统一走 `docPolylines(doc)`，禁止各处写 `?? []`。
   */
  polylines?: MapPolyline[];
  /**
   * 逻辑图层的显隐 / 锁定状态。**可选**：老文档不写值（零写入）。
   *
   * 读写一律走 `layerState.ts` 的 `layerVisibleOf` / `layerLockedOf`：
   * `region.visible` 不在这里（事实源是 `showRegions`，见 B4 PRD D4）。
   */
  layerState?: MapLayerStateMap;
  /**
   * 层级定义（长度 = 层数，1~4）。**可选**：老文档不写值，读时回落默认 4 级。
   *
   * 【为什么必须放文档而不是常量】
   *   ① 需求要求用户可改且要持久化（关掉窗口再打开配置还在）；
   *   ② 手画模式下 `regions` 可能是空数组，此时没有任何地方能推导出"层数/层级名"
   *      （`levelCountsOf([])` 返回 `[]`）—— 零区块状态下层级定义必须有独立宿主；
   *   ③ 子图内嵌自己的 `regions`，也应能内嵌自己的 schema。
   *
   * 【零写入原则】`createEmptyDocument()` / `migrateDoc` 都**不写**这个字段
   * （只做"非法则剔除"），老文档形状因此逐字节不变；写值只发生在用户真的改了配置之后。
   */
  regionSchema?: RegionLevelDef[];
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
   * 不透明度（0.1 ~ 1）。
   *
   * 【为什么可选而不是必填】v2.20 之前的文档没有这个字段：落库的 `doc_json` 一定
   * 比"当前代码"老，老素材必须按 `1` 读 —— 在**读点**兜底（`elementOpacityOf`）
   * 而不是迁移时补值，是本模型"宁可多带一个字段、迁移不替用户重排数据"原则的
   * 延续（见 `migrateDoc`）。
   */
  opacity?: number;
  /**
   * 色相（度，0 ~ 360）。
   *
   * `0` 与缺省都读作**原色**（渲染时 tint 白 = 不改色）。用"色相"而不是 RGB 值：
   * 一个滑杆就能表达"染成什么颜色"，且同一素材换个色相就是变体（生成器 B3
   * 靠它做"同素材不同色"的抖动）。
   */
  tint?: number;
  /**
   * 是否左右镜像翻转（观感批次 C · P1-4「镜像翻转破重复」）。
   *
   * 【为什么可选而不是必填】与 `opacity` / `tint` 同款理由：落库的 `doc_json`
   * 一定比"当前代码"老，旧存档没有这个字段，读点必须兜底 —— 在**读点**
   * （`elementFlipXOf`）回落 `false`（原样渲染），而不是迁移时补值，
   * "宁可多带一个字段、迁移不替用户重排数据"的原则延续。
   *
   * 【为什么是布尔而不是角度】一键成图只需要"这一张贴不翻"两种状态；
   * 任意角度镜像属于旋转变换的范畴，等真有需求再加字段。
   */
  flipX?: boolean;
  /**
   * 放置时所处的层级序号（2.40.0 起默认三级：0 = 国家 / 1 = 郡 / 2 = 城；
   * 老四级文档仍是 0 = 大陆 … 3 = 郡。见 lod.ts 的 `activeLevel`）。
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
 *
 * 【唯一的例外：`regionSchema` 非法则剔除】它是本模型里唯一有"合法形状"判据的
 * 可选字段（1~4 级、每级 `name: string` / `count: 正整数`）。非法值若原样带过，
 * 就会**被写回存档**——存档里躺着脏数据，将来任何一处裸读 `doc.regionSchema`
 * 的代码都会炸，而"读路径都走 `regionSchemaOf`"只是一条口头约定，不是类型保证。
 * 因此这里用 `normalizeRegionSchema` 判一次：非法则 `delete`。
 *
 * ⚠️ 这**不违反零写入原则**：只删不加。没有该字段的老文档，迁移后
 * `hasOwnProperty('regionSchema') === false` 仍然成立（写值只发生在用户真的改了
 * 配置之后）。合法的值也**原样保留**（不替换成 `normalizeRegionSchema` 的规范化
 * 副本）——迁移函数不替用户重排数据。
 */
export function migrateDoc(raw: unknown): MapDocument {
  const src: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const style = src.style;
  const out: MapDocument = {
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
  // `hasOwnProperty` 先判一次：没有该字段的文档到此为止，`out` 的形状逐字节不变。
  // （`delete` 一个不存在的键虽然无害，但显式判一次让"零写入"在代码上可见。）
  if (
    Object.prototype.hasOwnProperty.call(out, "regionSchema") &&
    normalizeRegionSchema(out.regionSchema) === null
  ) {
    delete out.regionSchema;
  }
  // `layerState` 同理：只删不加。未知层 key、非布尔值、以及 `region.visible`
  // （双源，见 B4 PRD D4）在这里被剔除；剔完为空则整个字段删掉，
  // 保证"从没碰过图层面板"的文档迁移后形状逐字节不变。
  if (Object.prototype.hasOwnProperty.call(out, "layerState")) {
    const normalized = normalizeLayerState(out.layerState);
    if (normalized === null) delete out.layerState;
    else out.layerState = normalized;
  }
  // `polylines` 只有"存在且不是数组"这一种非法形态（元素结构由编辑动作保证）。
  // 同样只删不加：没有该字段的老文档不受影响。
  if (
    Object.prototype.hasOwnProperty.call(out, "polylines") &&
    !Array.isArray(out.polylines)
  ) {
    delete out.polylines;
  }
  return out;
}

/** 生成实例 id（时间戳 + 随机后缀，会话内足够唯一） */
export function createElementId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 生成标注 id（与 `createElementId` 同款，前缀区分 `lb_`） */
export function createLabelId(): string {
  return `lb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 生成子地图 id（`sm_` 前缀，与 `createElementId` 同款） */
export function createSubmapId(): string {
  return `sm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 生成折线 id（`pl_` 前缀，与其余 id 同款） */
export function createPolylineId(): string {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 文档里的折线（读点唯一出口）。
 *
 * 与 `docPolylines` 一起收口，是为了让"新字段可选"这件事只在这一处兜底：
 * 渲染、命中测试、面板计数、导出各自写一次 `doc.polylines ?? []`，将来
 * 改成必填字段时就要满仓库找。返回只读数组，调用方不得就地修改。
 */
export function docPolylines(doc: Pick<MapDocument, "polylines">): readonly MapPolyline[] {
  return doc.polylines ?? [];
}

/** 子图里的折线（读点唯一出口，理由同 `docPolylines`） */
export function submapPolylines(
  submap: Pick<MapSubmap, "polylines"> | null | undefined,
): readonly MapPolyline[] {
  return submap?.polylines ?? [];
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

/* ───────────────── 素材外观属性（R-MAP-23：属性面板四件套的数据侧） ───────────────── */

/** 不透明度下限。不给 0：全透明的素材点不中、找不到、删不掉，是个陷阱 */
export const ELEMENT_OPACITY_MIN = 0.1;
/** 不透明度上限 */
export const ELEMENT_OPACITY_MAX = 1;
/** 色相"原色"值（0° = 未染色，渲染层据此跳过 tint） */
export const ELEMENT_TINT_NONE = 0;

/**
 * 素材的**有效**不透明度（读点兜底的唯一出口）。
 *
 * 非法值（缺字段 / 越界 / NaN）一律回落 1：素材出现在画面上却看不见，
 * 比"稍透明一点"严重得多 —— 兜底方向永远朝"可见"。
 */
export function elementOpacityOf(el: Pick<MapElement, "opacity">): number {
  const v = el.opacity;
  if (typeof v !== "number" || !Number.isFinite(v)) return ELEMENT_OPACITY_MAX;
  return Math.min(ELEMENT_OPACITY_MAX, Math.max(ELEMENT_OPACITY_MIN, v));
}

/** 素材的**有效**色相（缺字段 / 非法值 → 原色 0） */
export function elementTintHueOf(el: Pick<MapElement, "tint">): number {
  const v = el.tint;
  if (typeof v !== "number" || !Number.isFinite(v)) return ELEMENT_TINT_NONE;
  return Math.min(360, Math.max(0, v));
}

/**
 * 素材的**有效**镜像翻转（读点兜底的唯一出口）。
 *
 * 【为什么严格判 `=== true`】旧存档没有这个字段（读作 false），但用户也可能
 * 从外部导入 / 手改 doc_json：任何非布尔真值（如字符串 `"true"`）都不该
 * 触发翻转 —— 翻转是渲染变换，脏数据宁可不翻（和 `opacity` 兜底朝"可见"、
 * 这里兜底朝"原样"同一方向：默认永远安全）。
 */
export function elementFlipXOf(el: Pick<MapElement, "flipX">): boolean {
  return el.flipX === true;
}

/**
 * 色相 → Pixi tint 颜色值（0xRRGGBB）。
 *
 * 【为什么在数据层而不是渲染层】`elementWeight` / `elementSizeFactor` 同款理由：
 * 选中框、命中测试与渲染共用同一套取值规则，规则写在任何"其中一处"都会漂移。
 * 【为什么固定 s=0.62 / l=0.5】全饱和（s=1）会把素材染成荧光色；0.62 在
 * 深色底图上是"清晰可辨但不刺眼"的着色强度 —— 与 `manualRegionColor` 的
 * 取值经验一致（见 regions.ts）。
 */
export function tintColorOf(hue: number): number {
  if (hue <= 0) return 0xffffff;
  return hslToRgb(hue, 0.62, 0.5);
}
