/**
 * 一键成图生成器（R-MAP-21，B3）—— 纯函数引擎
 *
 * **生成的是"对象"，不是"画面"**（review §5.3）：输入地形配方 + seed，
 * 输出陆地几何 + 素材实例布点（可编辑的 MapElement 前身）， 地名分配
 * 独立成档（`assignPlacementNames`），区块树仍由既有 `generateHierarchy`
 * 在 hook 层补齐（复用同一套几何，生成器不重复实现）。
 *
 * ── 确定性 ──
 * 同 seed + 同参数 ⇒ 逐实例坐标相同（review §5.3 铁律 1）。四条 mulberry32
 * 子流各自加盐，互不干扰：
 *   · 陆地   `landSeedOf`   —— 复用 land.ts 的形状算法
 *   · 素材   `elementSeedOf`—— 分区选材 + 布点 + 抖动（聚落选址也走这条）
 *   · 地名   `nameSeedOf`   —— 只换地名时不惊动前两者
 *   · 水系   `waterSeedOf`  —— 河湖独立成层（2.44.0）
 * 「换一张」= 全新 base seed；五档局部重掷 = 子流盐值再混一个自增计数
 * （交互动作，不承诺跨会话复现——复现看工具栏的 seed 指示 + 同参数重生成）。
 *
 * ── 取料纪律（架构 §六 铁律）──
 * 素材池由调用方**注入**（`pool`），本文件禁止 import sprites.ts ——
 * 否则用户导入素材（S2）进不了配方。尺寸与类别同理经 `sizeOf` 注入。
 *
 * 本文件无 IO、无 React、无 PIXI；import 白名单：
 * ./terrain ./terrain-assets ./mapRecipe ./settlements ./roads ./water
 * ../types ../land ../regions（后两者纯几何）。
 */

import {
  generateLand as buildLand,
  insetLand,
  landBBoxOf,
  landColorOf,
  pointInLand,
  type LandShapeId,
} from "../land";
import type { MapLabelSize, MapLand, MapPolyline, Rect, TerrainBandGrid } from "../types";
import { expandTerrainMix, RANDOM_CHOICE, type MapRecipe } from "./mapRecipe";
import { buildRoadNet, roadCostOfCells } from "./roads";
import {
  planSettlements,
  settlementCountsOf,
  settlementTierOf,
  SETTLEMENT_SPRITES,
  type SettlementSite,
  type SettlementTier,
} from "./settlements";
import { TERRAIN_META, type TerrainKind } from "./terrain";
import { flippableOf, mulberry32, pickTerrainSprites, type SpriteSource } from "./terrain-assets";
import { buildWaterNet } from "./water";
import { zoneAtY, type SpriteZone } from "./zones";

/* ─────────────────── 子流盐值 ─────────────────── */

/** 陆地子流盐（与 element/name 流互不干扰） */
export function landSeedOf(seed: number): number {
  return ((seed ^ 0x9e3779b9) >>> 0) || 1;
}
/** 素材布点子流盐 */
export function elementSeedOf(seed: number): number {
  return (seed ^ 0x85ebca6b) >>> 0;
}
/** 地名子流盐 */
export function nameSeedOf(seed: number): number {
  return (seed ^ 0xc2b2ae35) >>> 0;
}
/**
 * 水系子流盐（2.44.0）。
 *
 * 【为什么必须独立】河湖是**后加的**一层：若与素材共用 `elementSeedOf`，
 * 加进来那一刻所有素材的坐标会整体位移（同一 seed 的老图对不上，回归测试也
 * 会连片变红）。独立子流让"布点"与"水系"各自可复现、互不惊动。
 */
export function waterSeedOf(seed: number): number {
  return (seed ^ 0x7f4a7c15) >>> 0;
}

/* ─────────────────── 参数与产物 ─────────────────── */

/**
 * 丰度档：**格网边长**（世界单位）。
 *
 * 【2.42.0 对齐逆向源码 —— 密度的入口是格子边长，不是总数】参考实现的三档密度
 * （配置页 `lcw_f_size_0/1/2`）改的就是格网边长 `36 / 54 / 72`，相对间距恒定：
 * 密档格子小、素材跟着小（`grid > 50 → w += 0.1` 的反向），疏档反之，画面不会
 * "小图挤、大图空"。总数不再是入口 —— 每块陆地格铺 1~3 层（魔幻风 3 层，
 * `decoded.js@551871`），铺多少由陆地面积与格边长自然决定。
 *
 * 【三档数值是源值】36/54/72 直接取自逆向源码（默认 36，`oa=36` / `Ma=oa/36`），
 * 单位按"参考页面像素 ≈ 本项目世界单位"映射（两边画布量级相当，见
 * docs/review §3.3 的换算说明）。
 */
export type GeneratorRichness = "sparse" | "standard" | "dense";

export const GRID_SIZES: Record<GeneratorRichness, number> = {
  sparse: 72,
  standard: 54,
  dense: 36,
};

export const RICHNESS_LABELS: Record<GeneratorRichness, string> = {
  sparse: "稀疏",
  standard: "标准",
  dense: "繁密",
};

/** 档位：成图 = 陆地 + 素材 + 地名；骨架 = 只出陆地（不铺素材） */
export type GeneratorMode = "full" | "skeleton";

/* ─────────────────── 面板控制（对齐逆向目标） ───────────────────
 *
 * 逆向目标（架空大陆自动生成器）的面板里，除"形状 / 底色"之外真正影响**渲染结果**
 * 的是三组开关，本项目在此一一对应：
 *
 *   · 「生成内容」按类目勾选      → `GeneratorContents`（草地/森林/沙漠/浅海/两极冰雪/城镇/遗迹）
 *   · 「山体」「河流」各有密度档  → `mountainDensity` / `riverDensity`
 *   · 「要素大小」正常/较小/最小  → `elementSize`（全局素材倍率）
 *
 * 它们都落在**配方层**（改 `terrainMix` 与全局体量倍率），不动布点算法本身 ——
 * 逆向目标的这三个开关也是"同一套布点、换配方"，不换骨架。
 */

/**
 * 生成内容的类目键。
 *
 * 【为什么是"地形组"而不是"素材类目"】配方本来就是按 `TerrainKind` 写的
 * （`recipe.terrainMix`），拿素材类目做开关会与配方对不上（雪原素材跨越
 * `snow` 与 `mountain` 两个类目）。按地形组关，语义是"这张图上不要雪"，
 * 比"不要 snow 类素材"更贴用户心智，也保证 `expandTerrainMix` 的输入形状不变。
 *
 * 【与逆向目标的差异】逆向目标还有「大陆边线」「道路」「国家」三项：前两项是
 * **渲染层**能力（海岸烘焙 / 折线层），不在生成器范围；「国家」对应本项目的
 * `withRegions` 开关，已存在。所以这里只列素材侧的地形组。
 */
export type ContentKey = "grass" | "forest" | "desert" | "shallow" | "polar" | "settlement" | "ruin";

/**
 * 类目键 → 覆盖的地形。
 *
 * ⚠️ **山体族（mountain / highland / volcano）刻意不在任何类目里**：参考面板中
 * 山不是勾选项，它由「山体：多/少/无」单独控制（见 `MOUNTAIN_TERRAINS`）。
 * `resolveTerrainMix` 因此按**黑名单**剔除（只剔"被关掉的类目里的地形"），
 * 未覆盖的地形一律保留 —— 否则关一个类目会把配方里 55% 的山一起抹掉。
 */
export const CONTENT_TERRAINS: Record<ContentKey, readonly TerrainKind[]> = {
  grass: ["grassland", "plain", "hill", "valley"],
  forest: ["forest", "jungle", "swamp"],
  desert: ["desert", "oasis"],
  shallow: ["sea", "coast"],
  polar: ["snowfield", "tundra"],
  settlement: ["settlement"],
  ruin: ["landmark"],
};

export const CONTENT_LABELS: Record<ContentKey, string> = {
  grass: "草地",
  forest: "森林",
  desert: "沙漠",
  shallow: "浅海",
  polar: "两极冰雪",
  settlement: "城镇",
  ruin: "遗迹",
};

/** 类目勾选态（缺省全开 —— 与逆向目标的默认勾选一致） */
export type GeneratorContents = Record<ContentKey, boolean>;

export const CONTENT_KEYS = Object.keys(CONTENT_TERRAINS) as ContentKey[];

export function defaultContents(): GeneratorContents {
  return CONTENT_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: true }),
    {} as GeneratorContents,
  );
}

/**
 * 分族密度档（逆向目标的「山体」「河流」）。
 *
 * 【为什么倍率是 1.9 / 0.45 而不是 2 / 0.5】配方份额是**相对值**，乘完之后会
 * 重新归一化；用 1.9 与 0.45 让「多」与「少」在归一化后仍明显偏离中位，
 * 又不至于把另一族挤到看不见（"多山体"不该变成"没有森林"）。
 */
export type DensityLevel = "normal" | "more" | "less" | "none";

export const DENSITY_FACTOR: Record<DensityLevel, number> = {
  normal: 1,
  more: 1.9,
  less: 0.45,
  none: 0,
};

export const DENSITY_LABELS: Record<DensityLevel, string> = {
  normal: "正常",
  more: "多",
  less: "少",
  none: "无",
};

/** 「山体」档覆盖的地形（与 `TERRAIN_LAYER` 的 1.5/2 两档同族：起伏地貌） */
export const MOUNTAIN_TERRAINS: readonly TerrainKind[] = [
  "mountain",
  "highland",
  "volcano",
  "hill",
  "valley",
];

/** 「河流」档覆盖的地形（内陆水系；湖泊跟河流一起增减，海湾不归它管） */
export const RIVER_TERRAINS: readonly TerrainKind[] = ["river", "lake"];

/** 要素大小档（逆向目标的 正常 / 较小 / 最小） */
export type GeneratorElementSize = "normal" | "small" | "tiny";

export const ELEMENT_SIZE_FACTOR: Record<GeneratorElementSize, number> = {
  normal: 1,
  small: 0.82,
  tiny: 0.66,
};

export const ELEMENT_SIZE_LABELS: Record<GeneratorElementSize, string> = {
  normal: "正常",
  small: "较小",
  tiny: "最小",
};

/** 五档重掷（review §5.3 铁律 3：全部 / 只陆地 / 只素材 / 只地名 / 只分区） */
export type GeneratorGear = "all" | "land" | "sprites" | "names" | "regions";

/** 生成器参数（UI 弹层与五档重掷共用的形状） */
export interface GeneratorParams {
  richness: GeneratorRichness;
  mode: GeneratorMode;
  /**
   * 生成内容开关。缺省（undefined）= 全开 —— 老调用方 / 老测试不改也能拿到
   * 与 2.39.0 完全一致的图（这条是**兼容承诺**，不是"顺手给个默认"）。
   */
  contents?: GeneratorContents;
  /** 山体密度档，缺省 `normal` */
  mountainDensity?: DensityLevel;
  /** 河流密度档，缺省 `normal` */
  riverDensity?: DensityLevel;
  /** 要素大小档，缺省 `normal`（= 2.39.0 的体量） */
  elementSize?: GeneratorElementSize;
  /**
   * 大陆形状档（12 种，或 `RANDOM_CHOICE` = 随机）。
   *
   * 2.45.0 起缺省不再是「正常」：热门地图删掉后，一键成图的默认语义是
   * **每点一次都是一张没见过的图**，形状与底色也跟着 seed 抽（见 `mapRecipe`）。
   */
  shapeId?: LandShapeId | typeof RANDOM_CHOICE;
  /** 大陆底色档（`LAND_BASE_COLORS` 的 id，或 `RANDOM_CHOICE` = 随机） */
  landColorId?: string;
  /** 是否同时划分区块（默认关，承接 R-REG-02） */
  withRegions: boolean;
  /** 是否生成地名（成图档生效） */
  withLabels: boolean;
}

/** 参数的规范化形态（缺省值只有一处定义，UI 与生成器共用） */
export interface ResolvedGeneratorTuning {
  contents: GeneratorContents;
  mountainDensity: DensityLevel;
  riverDensity: DensityLevel;
  elementSize: GeneratorElementSize;
}

export function resolveGeneratorTuning(
  params: Partial<
    Pick<GeneratorParams, "contents" | "mountainDensity" | "riverDensity" | "elementSize">
  >,
): ResolvedGeneratorTuning {
  return {
    contents: { ...defaultContents(), ...(params.contents ?? {}) },
    mountainDensity: params.mountainDensity ?? "normal",
    riverDensity: params.riverDensity ?? "normal",
    elementSize: params.elementSize ?? "normal",
  };
}

/**
 * 配方 → 调整后的配比（内容开关 × 分族密度）。
 *
 * 【为什么改 share 而不是改总数】总数（`RICHNESS_TOTALS`）是"整张图铺多密"的总闸，
 * 关掉"两极冰雪"腾出来的份额应该分给剩下几族（图不会因此变稀），而不是让整张图
 * 少 15% 的素材。所以这里**只动份额并重新归一化**，总数仍由丰度档决定。
 *
 * 【全关 / 全零的兜底】所有份额都被关掉或乘成 0 时返回空数组，`generateMap`
 * 于是只出陆地（与骨架档同一条出口），不抛错、不产生空配方的幽灵环。
 */
export function resolveTerrainMix(
  recipe: MapRecipe,
  tuning: ResolvedGeneratorTuning,
  total: number,
): { terrain: TerrainKind; count: number }[] {
  /**
   * 【"没被任何类目覆盖的地形"一律放行】山体族（mountain / highland / volcano）
   * 刻意**不属于任何内容类目** —— 参考面板里山也不是勾选项，它由「山体：多/少/无」
   * 那一档单独控制。若按"在启用集合里才保留"来写，山体族会被内容开关整族抹掉
   * （配方里 55% 的山凭空消失，实测让 9 条既有用例连带变红）。
   * 所以判据是**黑名单**：只有"属于某个被关掉的类目"的地形会被剔除。
   */
  const disabled = new Set<TerrainKind>();
  for (const key of CONTENT_KEYS) {
    if (tuning.contents[key]) continue;
    for (const t of CONTENT_TERRAINS[key]) disabled.add(t);
  }
  const mountainFactor = DENSITY_FACTOR[tuning.mountainDensity] ?? 1;
  const riverFactor = DENSITY_FACTOR[tuning.riverDensity] ?? 1;

  const adjusted = recipe.terrainMix
    .filter((m) => !disabled.has(m.terrain))
    .map((m) => {
      const factor = MOUNTAIN_TERRAINS.includes(m.terrain)
        ? mountainFactor
        : RIVER_TERRAINS.includes(m.terrain)
          ? riverFactor
          : 1;
      return { terrain: m.terrain, share: m.share * factor };
    })
    .filter((m) => m.share > 0);

  const sum = adjusted.reduce((acc, m) => acc + m.share, 0);
  if (adjusted.length === 0 || !(sum > 0)) return [];
  return expandTerrainMix(
    { ...recipe, terrainMix: adjusted.map((m) => ({ ...m, share: m.share / sum })) },
    total,
  );
}

/**
 * 一条素材布点（MapElement 的前身，尚无实例 id）。
 * `terrain` 记录它来自哪个配方——「只换地名」按它重查名池；
 * `zone` 记录它取用的地貌带，摘要按带统计（雪带/主带/草带/沙带各多少）。
 */
export interface SpritePlacement {
  spriteId: string;
  /** 世界坐标：x 水平中心 / y 底部锚点（与 MapElement 同语义） */
  x: number;
  y: number;
  scale: number;
  /** 角度（度）。小幅抖动破"复制粘贴感"（review §5.4 变换） */
  rotation: number;
  /**
   * 是否左右镜像（P1-4「镜像翻转破重复」）。按素材 `flippable` 以 50% 概率
   * 摇出：同一张贴图一正一反，观感素材量翻倍且不用新图。走素材子流
   * `rng`，同 seed 逐实例可复现（与坐标 / 缩放同一铁律）。不可翻的素材
   * 恒为 `false`（有朝向的人造物翻了会说谎，见 sprites.ts 的 `flippable`）。
   */
  flipX: boolean;
  terrain: TerrainKind;
  /** 取用的地貌带（见 zones.ts） */
  zone: SpriteZone;
  /**
   * 聚落层级（2.46.0）。只有 `terrain === "settlement"` 的布点带。
   *
   * 【为什么要有这个字段】元素类型里只有 `spriteId`，而层级→素材是**多对一**：
   * `city-mid` 同时是大城的第三顺位和城镇的第一顺位，`village-a` 同时是城镇与
   * 村落的候选。靠 `settlementTierOf(spriteId)` 反查必然把"城镇"读成"大城"
   * （`city-mid` 先命中 city 链），于是点名时给镇套了大城的字号。
   * 选址阶段本来就知道它是哪一档，直接带过来，反查只作为老文档的兜底。
   */
  tier?: SettlementTier;
}

export interface GenerateMapOptions {
  seed: number;
  /** 整张纸的世界矩形（hook 传 BASE_BOUNDS，本文件不 import store） */
  bounds: Rect;
  recipe: MapRecipe;
  richness: GeneratorRichness;
  mode: GeneratorMode;
  /** 素材池（本地打包 + 将来的导入池归一后注入；禁直接 import SPRITES） */
  pool: readonly SpriteSource[];
  /**
   * spriteId → 渲染尺寸（碰撞用）。SpriteSource 不带尺寸（导入素材在
   * 标注期才量），由调用方从登记表注入；未登记的 id 走缺省。
   */
  sizeOf?: (spriteId: string) => { width: number; height: number };
  /**
   * 素材子流种子覆盖（「只换素材」档用：陆地不变、布点重摇）。
   * 缺省 = `elementSeedOf(seed)`。
   */
  elementSeed?: number;
  /**
   * 面板控制（内容开关 / 分族密度 / 要素大小）。缺省 = 全开 + 正常 + 正常，
   * 与 2.39.0 的产物逐实例一致（兼容承诺见 `GeneratorParams`）。
   */
  tuning?: ResolvedGeneratorTuning;
  /**
   * 大陆形状档（land.ts 的 `LandShapeId`）。缺省「正常」= 与 2.40.0 的陆地
   * 逐字节一致（形状只改岛数/朝向/母形，不碰侵蚀管线）。
   */
  shape?: LandShapeId;
  /** 大陆底色（land.ts 的 `LAND_BASE_COLORS` 的 id）；缺省 = 羊皮纸（现状色） */
  landColorId?: string;
}

export interface GeneratedMap {
  land: MapLand;
  placements: SpritePlacement[];
  /**
   * 地貌纹理带栅格（2.43.0）：布点用的同一份格网，每格的气候带。
   * 渲染层据此平铺草地 / 沙漠 / 冰原纹理（参考实现 `grid_size:64` 的
   * createPattern 面纹理层）。骨架档不带。
   */
  bands?: TerrainBandGrid;
  /**
   * 水系折线（2.44.0）：河流 + 湖泊（外环填充 + 内环等深线）。
   *
   * 【为什么是产物而不是渲染期派生】河湖是**可编辑要素**（拖节点、改样式、
   * 删掉），必须进文档、进撤销栈；渲染期临时画的河一改陆地就消失，
   * 用户没法修。骨架档为空数组（没有陆地就谈不上水系）。
   */
  polylines: MapPolyline[];
}

/* ─────────────────── 布点骨架：格网 + 层叠 + 丛簇（2.42.0 对齐逆向源码） ───────────────────
 *
 * 对齐对象与证据（`decoded.js`，见 docs/review/map-vs-reference-render-analysis.md §3.3/§3.4）：
 *   · 格网边长 36/54/72（`GRID_SIZES`，上文）；格越过了 50 → 素材基准 +10%；
 *   · 主循环每格按**地貌带**取池与参数：丘陵（草带）w=.5 / 抖动 0~12% / 旋转 ±15° /
 *     主动弃格（D>6% 直接跳过，≈50% 留白）、沙丘（沙带）w=.5 / 12% / ±5°、
 *     雪山（雪带）w=.18 / 7% / ±5°、主池 w=.11 / 4% / ±5°（`@551871`）；
 *   · 魔幻风每格叠 **3 层**（基准层 + 两层错位 `+10`，`@551871` 的 `_0/_1/_2`）；
 *   · 森林走独立的**丛簇**管线：连通性先验（8 邻域同类 0 个不出、1 个约 55%、
 *     ≥2 个约 73%）、候选去重（曼哈顿距离 <4 格）、每丛 3 个 + 按四邻方向追加
 *     0~4 个（`@562661`）。
 *
 * 【w 的归一去哪了】参考的 w（.11~.5）是**它自己素材池**的像素→页面归一；本项目
 * 的等价物是 `TERRAIN_SCALE`（按地形配方的体量归一，比例已对齐参考成图
 * "最大素材宽 / 最长陆轴 ≈ 8~12%"，见 2.37.0 审计）。直接照抄 w 会把草带丘陵
 * 放大到主池的 4.5 倍（参考的丘陵贴图本来就小一截）—— **双份归一**。因此这里
 * 对齐的是 w 的**结构**（分带差异、抖动幅度 D、弃格阈值、旋转、层数、格网补偿），
 * 体量归一仍走 `TERRAIN_SCALE`；带间相对体量由分带选材（不同贴图）承担。
 */

/**
 * 各地貌带的布点参数（逆向源值，`decoded.js@551871`）。
 *
 * - `dAmp`：体量抖动幅度 D（实例基准 = 基准 × (1 + D)，D ~ U[0, dAmp)）；
 * - `rot`：旋转幅度（度）；
 * - `skipOver`：弃格阈值 —— D 超过它整格跳过（主动留白）。只有草带（丘陵）有，
 *   `6<D` → D∈[0,.12) 均匀丢弃一半格子。
 */
const BAND_PARAMS: Record<
  SpriteZone,
  { dAmp: number; rot: number; skipOver?: number }
> = {
  core: { dAmp: 0.04, rot: 5 },
  snow: { dAmp: 0.07, rot: 5 },
  grass: { dAmp: 0.12, rot: 15, skipOver: 0.06 },
  desert: { dAmp: 0.12, rot: 5 },
};

/** 格网边长超过该值 → 素材基准 +10%（逆向：`50<g&&50<h → w+=.1`） */
const GRID_SIZE_COMP_THRESHOLD = 50;
const GRID_SIZE_COMP = 0.1;

/** 魔幻风每格层叠数（逆向 `_0/_1/_2` 三层） */
const LAYERS_PER_CELL = 3;

/**
 * 层间错位（世界单位，逆向源值）：基准层在格心，其余各层向右下错开 10
 * （参考的 `-40 → -30` 差值；锚点语义不同，取**相对错位**而不是绝对偏移）。
 */
const LAYER_OFFSET = 10;

/**
 * 森林族丛簇参数（逆向源值，`decoded.js@562661`）。
 *
 * - `SCALE_JITTER`：实例体量抖动 ±10%（参考 `D=10` → `±10/100`）；
 * - `EDGE_RATIO`：丛内抖动半径 = 丛直径（素材宽 × 体量 + 50 呼吸边）的 1/5；
 * - `SPREAD_MIN/MAX`：四邻追加实例的错位 = 直径的 1/3 ~ 1/2；
 * - `DEDUP_CELLS`：候选格去重的曼哈顿距离（格数）。
 */
const FOREST_SCALE_JITTER = 0.1;
const FOREST_EDGE_RATIO = 1 / 5;
const FOREST_BREATHING = 50;
const FOREST_SPREAD_MIN = 1 / 3;
const FOREST_SPREAD_MAX = 1 / 2;
const FOREST_DEDUP_CELLS = 4;

/** 森林族地形（走丛簇管线） */
const FOREST_TERRAINS: readonly TerrainKind[] = ["forest", "jungle", "swamp"];

/**
 * 平原格占比：**目标**，只用来把配方份额换算成格数（见 `generateMap`）。
 *
 * 留白由「配额之外没被认领的格」产生（见 `assignTerrainByGrowth`）：
 * 没被任何配方认领的格 `terrain = null`，就是平原 —— 连成片的空地，
 * 不是随机麻点。
 */
const PLAIN_CELL_RATIO = 0.18;

/** 单个实例的落位尝试次数；耗尽就少一个（拥挤时密度自适应回落） */
const PLACE_ATTEMPTS = 12;

/**
 * 分带接缝的过渡带宽度（相对陆地高度，两侧各一半）。
 *
 * 【为什么需要它】纬度硬切会在整张图上留一道**水平直线**——颜色/画风沿着
 * 一条 1 像素的线突变，比不分带更扎眼。接缝两侧按比例随机落到相邻带，
 * 一条硬线就摊成了 8% 高度的渐变。
 */
const ZONE_BLEND = 0.08;

/**
 * 地形配方 → 体量系数（**比例和谐的执行点**）。
 *
 * 【为什么需要它】素材的 `baseWidth` 是"这张图本身画多大"，不是"它在图上该多大"：
 * 一座城的贴图（135×130）和一条山脉（200×127）体量相当，按原尺寸摆出来，
 * 城堡会和山一样高 —— 参考实现里城郭只有山峰的三分之一高，因为它的素材池
 * 按**用途**分组后再各自归一，而不是全池共用一个尺度。
 *
 * 这些系数就是"各组各自的归一"：山地/高原是主景（1.0），丘陵次之，森林成片
 * 但要低于山脊，河流湖泊是地表纹理（更小），聚落与遗迹是**点符号**（最小，
 * 只需认得出、放得下地名）。改这里就能整体调"什么该大、什么该小"。
 */
const TERRAIN_SCALE: Record<TerrainKind, number> = {
  mountain: 1,
  highland: 0.95,
  volcano: 0.95,
  hill: 0.75,
  valley: 0.8,
  forest: 0.72,
  jungle: 0.72,
  desert: 0.85,
  oasis: 0.62,
  swamp: 0.78,
  lake: 0.8,
  river: 0.7,
  coast: 0.72,
  sea: 0.78,
  plain: 0.55,
  grassland: 0.55,
  snowfield: 0.58,
  tundra: 0.55,
  settlement: 0.52,
  landmark: 0.48,
};

/**
 * `TERRAIN_SCALE` 的**整体体量总闸**（问题 1「素材过大」修复）。
 *
 * 【为什么单独压一个系数而不是重写整张表】素材最终渲染尺寸 = `baseWidth × scale`，
 * 而 `scale = clusterScale × sizeScale × TERRAIN_SCALE[terrain] × 微调`。山（baseWidth
 * 200）在最坏情况下 ≈ 200×1.14×1.32×1.1 ≈ 331 世界单位，而单岛实测只占纸面 36%~51%，
 * 一座山占陆地宽 63%~90% —— 陆地像小岛、素材像巨人。
 *
 * 【两轮收敛的实测口径】最大素材渲染宽 / 最长陆轴：0.6 时 ≈16%，0.42 时 p50≈12.0% /
 * max≈15.6%（审计测试逐 seed 实测）。0.32 时 p50≈9.1% / max≈11.9%。
 *
 * 【2.43.0 再降一档 —— 对齐参考成图的**仙侠体量档**】新取证（review 序 11 / E1）：
 * 参考的符号体量是**分风格档位**，草带/沙丘 `w=.5`（默认魔幻）/ 仙侠 `w=.15` /
 * 羊皮纸 `w=.2`。此前 0.32 校准用的"参考成图 8~12%"量到的是**默认风格**的档；
 * 用户指认的对齐对象（图 2）是仙侠档 —— 山只占陆轴 3~5%，小而密、彼此不挤。
 * 本轮 ×0.18（= 0.32 × 0.56，对齐 0.15/0.5 与观感下限的折中），预期 p50 ≈ 5% /
 * max ≈ 6.7% —— 同样的格网数量下**有效密度**立刻起来，不再被大单体挤出避让空地。
 * **相对关系（点符号 < 地表 < 山地）一字不动**。
 *
 * 【为什么不动 `sprites.ts` 的 baseWidth】那是素材固有画幅，是碰撞/命中测试/面板
 * 预览的基准，改它会让手动落位、命中与预览一起漂移。一键成图只走这套系数，改这里
 * 才是最小、最安全的切口。
 */
const TERRAIN_SCALE_OVERALL = 0.18;

/**
 * 地形 → z 层档位（数字越大越靠上、越晚绘制）。
 *
 * 【为什么需要一张独立的层表，而不是继续只按 y 排】脚底 y 升序只能表达"前后遮挡"，
 * 表达不了"内容层级"：一座山脚底 y 比一片树林大（更靠下），却可能被树林压住 ——
 * 参考实现里山体永远是主景，森林、沼泽这类地表铺底，聚落/遗迹点符号在最上。
 * 于是排序改成**先按层、同层再按 y**：层小的先画（被压底），层大的后画（压别人）。
 *
 * 档位是**手绘的"先浅后深"直觉**，不是渲染栈：
 *   0   森林/丛林/沼泽 —— 成片的地表植被，最该被山与水压住；
 *   1   河流/湖泊/海岸/海洋 + 地表纹理（沙漠/平原/草原/雪原/冻原）—— 底图层；
 *   1.5 丘陵/山谷 —— 过渡地貌，压地表但让山地；
 *   2   山地/高原/火山 —— 主景山体；
 *   3   聚落/遗迹/绿洲 —— 点符号，永远在最上（下面盖不住一个村子）。
 */
const TERRAIN_LAYER: Record<TerrainKind, number> = {
  forest: 0,
  jungle: 0,
  swamp: 0,
  river: 1,
  lake: 1,
  coast: 1,
  sea: 1,
  desert: 1,
  plain: 1,
  grassland: 1,
  snowfield: 1,
  tundra: 1,
  hill: 1.5,
  valley: 1.5,
  mountain: 2,
  highland: 2,
  volcano: 2,
  settlement: 3,
  landmark: 3,
  oasis: 3,
};

/**
 * 每格的调色板容量（同格最多几种素材轮换）。
 *
 * 【为什么是 4】池子按地形分下来，一个配方的"一族"往往只有三四张（沼泽 4 张）。
 * 3 的话同一格内必有重复，4 至少让一簇里的 3~4 个实例各不相同 —— 素材总量
 * 不够时，这是"少一点贴纸感"最便宜的一招。
 */
const PALETTE_SIZE = 4;

/**
 * 跨格防呆碰撞盒收缩系数。
 *
 * 【为什么是 0.35 且**同簇不参与**】手绘山脉本来就层叠着画：同一个丛簇里
 * 三座山互相压边才出厚度，所以同簇一律放行。跨格才拦，且只拦"几乎整个
 * 压住"——0.35 意味着两个核心盒中心拉开即可，边缘怎么叠都行。
 */
const CORE = 0.35;
/** 碰撞盒外扩（呼吸边，作用在收缩后的核心盒上） */
const COLLIDE_PAD = 2;

/** 碰撞注册表：均匀网格，cell 尺寸按最大素材近似取常量 */
const GRID_CELL = 64;

interface ColliderEntry {
  /** 所属丛簇：同簇不参与碰撞（刻意层叠） */
  cluster: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Collider {
  add(cluster: number, x0: number, y0: number, x1: number, y1: number): void;
  hits(cluster: number, x0: number, y0: number, x1: number, y1: number): boolean;
}

function createCollider(): Collider {
  const cells = new Map<number, ColliderEntry[]>();
  const key = (cx: number, cy: number) => cx * 100000 + cy;
  return {
    add(cluster, x0, y0, x1, y1) {
      const cx0 = Math.floor(x0 / GRID_CELL);
      const cx1 = Math.floor(x1 / GRID_CELL);
      const cy0 = Math.floor(y0 / GRID_CELL);
      const cy1 = Math.floor(y1 / GRID_CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const k = key(cx, cy);
          const list = cells.get(k);
          if (list) list.push({ cluster, x0, y0, x1, y1 });
          else cells.set(k, [{ cluster, x0, y0, x1, y1 }]);
        }
      }
    },
    hits(cluster, x0, y0, x1, y1) {
      const cx0 = Math.floor(x0 / GRID_CELL);
      const cx1 = Math.floor(x1 / GRID_CELL);
      const cy0 = Math.floor(y0 / GRID_CELL);
      const cy1 = Math.floor(y1 / GRID_CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const list = cells.get(key(cx, cy));
          if (!list) continue;
          for (const r of list) {
            if (r.cluster === cluster) continue;
            if (x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0) return true;
          }
        }
      }
      return false;
    },
  };
}

/* ─────────────────── 格网 ─────────────────── */

/** 一个网格单元 = 一个丛簇的容器 */
interface Cell {
  /** 格中心（世界坐标） */
  x: number;
  y: number;
  col: number;
  row: number;
  /** 是否含陆地：中心或四角任一落在陆地内（沿海格的中心常落在海上） */
  land: boolean;
  /** 区域生长分配到的地形；null = 无陆地 */
  terrain: TerrainKind | null;
}

/** 探针内缩比例（相对格边长）：用四角探针认领「中心在海上但压着海岸」的格 */
const CELL_PROBE = 0.3;

/**
 * 陆地实测包围盒。
 *
 * 【为什么不用 `land.bounds`】那是整张纸，陆地面通常只占中部 55%~70%；
 * 拿纸张当分带基准会把雪带整个压在海上，南北两头永远用不到 ——
 * 分带与格网都必须跟着陆地走。
 */
/** 陆地包围盒（几何口径的唯一出处见 `land.ts` 的 `landBBoxOf`） */
function landBBox(land: MapLand): Rect {
  return landBBoxOf(land);
}

function cellHasLand(land: MapLand, x: number, y: number, size: number): boolean {
  if (pointInLand({ x, y }, land)) return true;
  const d = size * CELL_PROBE;
  return (
    pointInLand({ x: x - d, y: y - d }, land) ||
    pointInLand({ x: x + d, y: y - d }, land) ||
    pointInLand({ x: x - d, y: y + d }, land) ||
    pointInLand({ x: x + d, y: y + d }, land)
  );
}

function buildGrid(
  land: MapLand,
  box: Rect,
  cellSize: number,
): { cells: Cell[]; cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil(box.width / cellSize));
  const rows = Math.max(1, Math.ceil(box.height / cellSize));
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = box.x + (col + 0.5) * cellSize;
      const y = box.y + (row + 0.5) * cellSize;
      cells.push({ x, y, col, row, land: cellHasLand(land, x, y, cellSize), terrain: null });
    }
  }
  return { cells, cols, rows };
}

function neighborsOf(cells: readonly Cell[], cols: number, rows: number, cell: Cell): Cell[] {
  const out: Cell[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue;
      const c = cell.col + dc;
      const r = cell.row + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      out.push(cells[r * cols + c]);
    }
  }
  return out;
}

/**
 * 一片地形平均铺几格就另起一片（决定「几条山脉」而不是「一整块山地」）。
 *
 * 【为什么要多片而不是一片】单一区域生长会长出**一整块**主地形，读者看到的是
 * 「左边全是山、右边全是林」这种两分天下；参考实现的一张图里有 5~6 条互不相连
 * 的山脉，中间夹着平原。拆片之后，同一地形分散成几片，页面上才有「山脉」这个
 * 层级（片与片之间就是平原）。
 */
const CELLS_PER_PATCH = 7;

/** 同一地形最多拆几片（上限防碎：份额再大也不会碎成芝麻） */
const MAX_PATCHES = 4;

/**
 * 区域生长分配地形（「配方成片 + 平原留白」的机制）。
 *
 * 每种地形按配额**长出若干片互不相连的斑块**（`CELLS_PER_PATCH`），
 * 每片从随机种子格起步、沿边界吞格，边界因此自然咬合（不是参考实现那种
 * 圆形半径边界）。
 *
 * 【未认领的格一律留空 —— 这是本项目之前最缺的一环】旧实现把剩余格全部
 * 归给主地形（份额最大者），于是"预留 30% 留白"被主地形填满：预设写
 * mountain 55%，实际产出 83% 的山，整张纸看不到一块平原。现在剩余格
 * `terrain` 保持 `null`（= 平原），留白才真的留得下来。
 *
 * @returns 无返回值：主地形的"多铺一个"已由配额接管（见 `generateMap` 的 `budget`）
 */
function assignTerrainByGrowth(
  cells: Cell[],
  cols: number,
  rows: number,
  slots: readonly { terrain: TerrainKind; count: number }[],
  rng: () => number,
): void {
  const free = new Set<Cell>(cells.filter((c) => c.land));
  const ranked = [...slots].sort((a, b) => b.count - a.count);
  /** 已落地的斑块种子：新种子要尽量远离它们，片与片才不会粘成一片 */
  const seeds: Cell[] = [];

  for (const slot of ranked) {
    // 2.42.0 起 count 直接是**格数**（密度 = 格边长 × 每格层数，不再有"每格平均实例数"）
    const quota = Math.max(1, Math.round(slot.count));
    const patches = Math.max(1, Math.min(MAX_PATCHES, Math.round(quota / CELLS_PER_PATCH)));
    let left = quota;

    for (let p = 0; p < patches && left > 0 && free.size > 0; p++) {
      const seed = pickPatchSeed(free, seeds, rng);
      if (!seed) break;
      seeds.push(seed);
      const want = Math.min(left, Math.ceil(left / (patches - p)));
      left -= growPatch(cells, cols, rows, free, seed, want, slot.terrain, rng);
    }

    // 斑块被海/别的地形卡住、配额没长满：把剩余格就近追加到已有斑块边界上
    let guard = quota * 4;
    while (left > 0 && free.size > 0 && guard-- > 0) {
      const pool = [...free].filter((c) =>
        neighborsOf(cells, cols, rows, c).some((nb) => nb.terrain === slot.terrain),
      );
      if (pool.length === 0) break;
      const cell = pool[Math.floor(rng() * pool.length)];
      free.delete(cell);
      cell.terrain = slot.terrain;
      left -= 1;
    }
  }
}

/**
 * 挑一个斑块种子：随机候选中取「离已有种子最远」的那个。
 *
 * 纯随机种子会让两片地形挨在一起，看上去仍是一整块；采几个候选再挑最远的，
 * 成本 O(候选数 × 种子数)，却能把山脉摊开在整张图上。
 */
function pickPatchSeed(free: Set<Cell>, seeds: readonly Cell[], rng: () => number): Cell | null {
  if (free.size === 0) return null;
  const all = [...free];
  if (seeds.length === 0) return all[Math.floor(rng() * all.length)];

  let best: Cell | null = null;
  let bestDist = -1;
  for (let i = 0; i < 16; i++) {
    const cand = all[Math.floor(rng() * all.length)];
    let near = Infinity;
    for (const s of seeds) near = Math.min(near, Math.hypot(s.x - cand.x, s.y - cand.y));
    if (near > bestDist) {
      bestDist = near;
      best = cand;
    }
  }
  return best;
}

/** 从种子格按 4 邻域吞格，最多 `want` 格；返回实际吞下的格数 */
function growPatch(
  cells: readonly Cell[],
  cols: number,
  rows: number,
  free: Set<Cell>,
  seed: Cell,
  want: number,
  terrain: TerrainKind,
  rng: () => number,
): number {
  if (!free.has(seed)) return 0;
  free.delete(seed);
  seed.terrain = terrain;
  if (want <= 1) return 1;

  let grown = 1;
  const frontier: Cell[] = neighborsOf(cells, cols, rows, seed).filter((c) => free.has(c));
  while (grown < want && frontier.length > 0) {
    const [cell] = frontier.splice(Math.floor(rng() * frontier.length), 1);
    if (!free.has(cell)) continue;
    free.delete(cell);
    cell.terrain = terrain;
    grown += 1;
    for (const nb of neighborsOf(cells, cols, rows, cell)) {
      if (free.has(nb)) frontier.push(nb);
    }
  }
  return grown;
}

/**
 * 素材贴图的轴对齐包围盒是否整体落在 `land` 内（问题 3「素材超出陆地」修复）。
 *
 * 【为什么不能只判锚点】`insetLand` 只保证脚底中心离岸 14 单位，而贴图自己有宽度：
 * 宽素材（如森林稀疏贴图半宽 95）的左右脚仍会越过海岸线。这里连锚点带四角一起判，
 * 贴图的轴对齐盒整体离岸 ≥14 单位，宽素材不再压岸。旋转 ≤9°、且碰撞层（`colliderHitsFree`）
 * 本就按轴对齐盒算，此处与之一致，不额外算旋转后的外扩角。
 */
function footprintInLand(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  scale: number,
  land: MapLand,
): boolean {
  const hw = (size.width * scale) / 2;
  const hh = size.height * scale;
  return (
    pointInLand(anchor, land) &&
    pointInLand({ x: anchor.x - hw, y: anchor.y }, land) &&
    pointInLand({ x: anchor.x + hw, y: anchor.y }, land) &&
    pointInLand({ x: anchor.x - hw, y: anchor.y - hh }, land) &&
    pointInLand({ x: anchor.x + hw, y: anchor.y - hh }, land)
  );
}

/* ─────────────────── 地貌纹理带（2.43.0） ─────────────────── */

/**
 * 布点格网 → 纹理带栅格。
 *
 * 【对齐什么】参考实现的地貌纹理是**面要素**：`createPattern(img,"repeat")`
 * 以 64 世界单位一格平铺（草地 / 沙漠 / 两极冰原三张面纹理，`grid_size:64`），
 * 与布点符号互相独立。本项目布点已经有同一份格网（`GRID_SIZES`），把「哪格
 * 属于哪条气候带」随 `GeneratedMap.bands` 交给文档（`doc.terrainBands`），
 * 渲染层就能用同一份事实源平铺 —— 纹理带与符号带天然对齐，不需要第二套判定。
 *
 * 【为什么抖动用确定性哈希而不是 rng】布点带的接缝抖动（`ZONE_BLEND`）每格
 * 消耗一个骰子；纹理带如果也走 rng，就要么插在布点流前面（同 seed 全图几何
 * 重排）、要么再开子流（跨档重掷时序对不齐）。哈希抖动给出**同款过渡观感**
 * 且零骰子消耗 —— 同 seed 的布点序列逐字节不变（2.42.0 引擎复跑验证口径）。
 */
function terrainBandsOf(
  cells: readonly Cell[],
  cols: number,
  rows: number,
  box: Rect,
  cellSize: number,
  climate: SpriteZone | null | undefined,
): TerrainBandGrid {
  return {
    cellSize,
    cols,
    rows,
    x: box.x,
    y: box.y,
    zones: cells.map((c) => {
      if (!c.land) return null;
      if (climate) return climate;
      const jitter = (cellHash(c.col, c.row) - 0.5) * ZONE_BLEND * box.height;
      return zoneAtY(c.y + jitter, box.y, box.height);
    }),
  };
}

/** 格坐标 → [0,1) 确定性伪随机（纹理带接缝抖动专用，无状态、无骰子） */
function cellHash(col: number, row: number): number {
  let h = (Math.imul(col + 0x9e37, 0x85eb) ^ Math.imul(row + 0x27d4, 0xc2b2)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x7feb) >>> 0;
  h ^= h >>> 16;
  return h / 0x100000000;
}

/**
 * 给一块**已有**陆地算纹理带（「只换陆地」档用）。
 *
 * 全量生成（`generateMap`）内部直接用布点格网拼 `bands`；这条导出是给
 * 不跑布点的路径复用同一套判定的 —— 参数语义一致（气候带 / 格边长）。
 */
export function computeTerrainZones(
  land: MapLand,
  climate: SpriteZone | null | undefined,
  cellSize: number,
): TerrainBandGrid {
  const box = landBBox(land);
  const { cells, cols, rows } = buildGrid(land, box, cellSize);
  return terrainBandsOf(cells, cols, rows, box, cellSize, climate);
}

/* ─────────────────── 主入口 ─────────────────── */

/**
 * 生成一张图（陆地 + 素材布点）。
 *
 * 算法（2.42.0 起**布点骨架对齐逆向源码**，证据 `decoded.js@551871` / `@562661`）：
 *   1. 陆地：`buildLand`（既有形状算法，landSeed 子流）；
 *   2. 格网：格边长 = 丰度档（36/54/72，逆向源值）—— 密度 = 格边长 × 每格层数；
 *   3. 分地形：区域生长，让每个配方连成片；配额以**格数**计，未认领格 = 平原；
 *   4. 分带：按纬度取地貌带（北雪/主/草/南沙，或预设锁定的气候带），
 *      带决定素材池与布点参数（抖动/旋转/弃格，见 `BAND_PARAMS`）；
 *   5. 铺实例：地貌格**每格 3 层**（魔幻风，层间错位 +10）；草带 D>6% 主动弃格；
 *      森林族走**丛簇**管线（连通性先验 + 3~7 个一丛）；
 *   6. 收尾：先按地形层、同层按脚底 y 升序（Pixi 按加入顺序绘制，排序即 z 序）。
 *
 * 骨架档（`mode: "skeleton"`）只返回陆地，`placements` 为空。
 */
export function generateMap(options: GenerateMapOptions): GeneratedMap {
  const land = buildLand({
    seed: landSeedOf(options.seed),
    bounds: options.bounds,
    shape: options.shape,
  });
  // 底色随文档走（MapLand.baseColor → bakeCoast）；缺省 = 羊皮纸
  if (options.landColorId) land.baseColor = landColorOf(options.landColorId).color;
  if (options.mode === "skeleton" || land.polygons.length === 0) {
    return { land, placements: [], polylines: [] };
  }

  // 素材锚点按**内缩后的岸线**判落海：素材不压海岸 14 单位（见 land.ts 的 COAST_INSET）。
  // 格网 cellHasLand / buildGrid 仍用原 land —— 沿海格还要被认领，只把"锚点"往内陆收。
  const inset = insetLand(land);

  const rng = mulberry32(options.elementSeed ?? elementSeedOf(options.seed));

  /** spriteId → 渲染尺寸（抖动幅度与碰撞都要用） */
  const sizeOf = options.sizeOf ?? (() => ({ width: 90, height: 70 }));

  // ── 格网：格边长 = 丰度档（逆向源值 36/54/72，不再由总数反解） ──
  const box = landBBox(land);
  const grid = GRID_SIZES[options.richness];
  const cellSize = Math.max(8, grid);
  const { cells, cols, rows } = buildGrid(land, box, cellSize);
  /** 格越过 50 → 素材基准 +10%（逆向：`50<g&&50<h → w+=.1`） */
  const sizeComp = 1 + (grid > GRID_SIZE_COMP_THRESHOLD ? GRID_SIZE_COMP : 0);

  /**
   * 配方 = 预设 × 面板控制（内容开关 / 山体档 / 河流档）。
   *
   * 【为什么在 generateMap 里解析而不是让调用方算好】「只换素材」档会拿**上一次**
   * 的参数重跑一次；勾选态与密度档属于"配方"，与陆地 / 地名各走各的子流 ——
   * 放在这里，三档重掷只传一次 `tuning`，不必让每个调用点各抄一遍归一化逻辑。
   *
   * 【total 的语义变了】2.42.0 起是**目标格数**（陆地格 × (1 - 平原占比)），
   * 配方份额切分的是"哪几格归哪个地形"；每格铺几层由带参数与地形族决定。
   */
  const tuning = options.tuning ?? resolveGeneratorTuning({});
  const landCells = cells.filter((c) => c.land).length;
  const total = Math.max(1, Math.round(landCells * (1 - PLAIN_CELL_RATIO)));
  const slots = resolveTerrainMix(options.recipe, tuning, total);

  /**
   * 地貌取料池 = 注入池 − 聚落素材（2.46.0）。
   *
   * 【为什么必须在这里剔】素材的 `terrains` 是给**手动落位**用的筛选标签：
   * `city-major` 标着 `["settlement", "plain"]`，`village-*` 标着 `plain/grassland`。
   * 配方不再把 `settlement` 当地形之后，这些城照样会从 **plain / grassland /
   * mountain 通道**被挑走 —— 实测四个 seed 有 19~42 个聚落素材漏进地貌层，铺在
   * 平原与山坡上，既破坏"聚落成网"，又因为不带层级而在点名时被当成大城
   * （`settlementTierOf` 反查命中 city 链），把 16px 的城名名额全吃掉。
   *
   * 聚落素材只能由选址阶段（`settlementSpriteOf`）铺，所以这里按
   * `settlementTierOf` 剔除，而不是去改 `sprites.ts` 的筛选标签（那是另一套语义）。
   */
  const groundPool = options.pool.filter((s) => settlementTierOf(s.id) === null);

  // ── 地貌纹理带（2.43.0）：布点格网 → 每格气候带，随文档持久化 ──
  // 不依赖 slots / 不消耗骰子；骨架档与空配方也要带（纹理跟着陆地走）。
  const bands = terrainBandsOf(cells, cols, rows, box, cellSize, options.recipe.climate);
  if (slots.length === 0) return { land, placements: [], bands, polylines: [] };

  /**
   * 水系与**点要素**（聚落）都不再参与区域生长（2.44.0 水系 / 2.45.0 聚落）。
   *
   * `river` / `lake` 的份额换算成"几条河 / 几个湖"，交给 `buildWaterNet` 画成
   * 折线（参考实现里水系本来就是 `Line` 要素）；`settlement` 的份额换算成
   * "几座城 / 几个村"，交给 `planSettlements` 选址再由 `buildRoadNet` 连成网
   * （参考实现里聚落是点符号 + 道路点线，不是一个地表配方）。
   * 剩下的份额仍按原样成片分配 —— 关掉「城镇」腾出来的格会被山地/森林认领，
   * 而不是留下一片没有视觉内容的空地。
   */
  const isWater = (t: TerrainKind) => t === "river" || t === "lake";
  const waterSlots = slots.filter((s) => isWater(s.terrain));
  const settlementCells = slots
    .filter((s) => s.terrain === "settlement")
    .reduce((acc, s) => acc + s.count, 0);
  const groundSlots = slots.filter((s) => !isWater(s.terrain) && s.terrain !== "settlement");

  /** 份额（格）→ 河流条数：一条河平均吃掉 3 格，夹在 2~16 条之间 */
  const { rivers: riverTarget, lakes: lakeTarget } = waterTargetsOf(waterSlots);

  // ── 地形分布（区域生长，多片；水系与聚落除外）──
  assignTerrainByGrowth(cells, cols, rows, groundSlots, rng);

  // ── 水系（独立子流：加这一层不惊动任何素材坐标）──
  const water =
    riverTarget > 0
      ? buildWaterNet(cells, {
          cols,
          rows,
          cellSize,
          rivers: riverTarget,
          lakes: lakeTarget,
          rng: mulberry32(waterSeedOf(options.seed)),
          land,
        })
      : { polylines: [], cells: new Set<number>() };

  // 只有水系/聚落（配方被"河流：多"挤掉其它族时）：不铺地貌素材，但河湖照画
  if (groundSlots.length === 0 && settlementCells === 0) {
    return { land, placements: [], bands, polylines: water.polylines };
  }

  /** 纬度取带；预设锁定气候时不看纬度（「万里雪原」南缘不该冒沙丘） */
  const climate = options.recipe.climate;
  const zoneOfY = (y: number): SpriteZone => {
    if (climate) return climate;
    // 接缝抖动：把纬度硬切成的那条水平线摊成 ~8% 高度的过渡带（见 ZONE_BLEND）
    const jitter = (rng() - 0.5) * ZONE_BLEND * box.height;
    return zoneAtY(y + jitter, box.y, box.height);
  };

  const collider = createCollider();
  const placements: SpritePlacement[] = [];
  let cluster = 0;

  /**
   * 全局体量倍率 = 体量总闸 × 「要素大小」档。
   *
   * 【只乘一个数、不消耗子流】`normal` 时它就等于常量本身 ⇒ 同 seed 同参数的
   * 坐标 / 缩放 / 旋转序列逐实例不变。档位只改渲染尺寸。
   */
  const overallScale = TERRAIN_SCALE_OVERALL * (ELEMENT_SIZE_FACTOR[tuning.elementSize] ?? 1);

  /**
   * 已用外观组合登记表（spriteId → { flip|量化scale|量化rotation }）。
   *
   * 口径与守卫测试一致（`scale.toFixed(2) + rotation.toFixed(1) + flip`）：
   * 四元组（spriteId + flip + 量化 scale + 量化 rotation）全等的两张贴图
   * 在任何视口下逐像素重合 —— 生成器在此登记，撞车实例翻面或重掷角度。
   */
  const seenPixels = new Map<string, Set<string>>();

  /**
   * 各配方的剩余**格数**配额（地形 → 还能认领几格）。
   *
   * 2.42.0 起配额以格计：一格 = 一个丛簇容器（铺 1~3 层或一丛森林），
   * 与参考实现"地形带格子直接决定密度"同构。配额用尽的地形不再认领新格，
   * 剩下的空间自然变成平原。
   */
  const budget = new Map<TerrainKind, number>(slots.map((s) => [s.terrain, s.count]));

  /**
   * 落一个实例（footprint 内缩判定 + 确定性去重 + 跨格碰撞），成功返回 true。
   *
   * 掷骰纪律：坐标/缩放/旋转每次尝试固定消耗 rng，与旧引擎一致 ——
   * 同 seed 的序列逐实例可复现。
   */
  const placeOne = (
    src: SpriteSource,
    x: number,
    y: number,
    scale: number,
    rotAmp: number,
    zone: SpriteZone,
    terrain: TerrainKind,
    tier?: SettlementTier,
  ): SpritePlacement | null => {
    const size = sizeOf(src.id);
    for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
      // 首选位被拒（贴图压岸 / 跨格深叠）才扩散重试：先微扰、再整格
      const spread = attempt < 3 ? 2 : cellSize * 0.5;
      const px = x + (rng() - 0.5) * 2 * spread;
      const py = y + (rng() - 0.5) * 2 * spread;
      // 贴图轴对齐盒（脚底中心 + 四角）必须整体落在内缩轮廓内
      if (!footprintInLand({ x: px, y: py }, size, scale, inset)) continue;

      // 镜像翻转（P1-4）：按素材 `flippable` 以 50% 概率翻面（确定性去重见下）
      const flipX = flippableOf(src) ? rng() < 0.5 : false;
      let rotation = Math.round((rng() - 0.5) * 2 * rotAmp * 10) / 10;
      let flip = flipX;
      const pixelKeyOf = (f: boolean, r: number) =>
        `${f ? "F" : "N"}|${scale.toFixed(2)}|${r.toFixed(1)}`;
      const seen = seenPixels.get(src.id) ?? new Set<string>();
      let pixelKey = pixelKeyOf(flip, rotation);
      if (seen.has(pixelKey) && flippableOf(src)) {
        flip = !flip;
        pixelKey = pixelKeyOf(flip, rotation);
      }
      let rerolls = 0;
      while (seen.has(pixelKey) && rerolls < 500) {
        rotation = Math.round((rng() - 0.5) * 2 * rotAmp * 10) / 10;
        pixelKey = pixelKeyOf(flip, rotation);
        rerolls += 1;
      }
      seen.add(pixelKey);
      seenPixels.set(src.id, seen);

      const p: SpritePlacement = {
        spriteId: src.id,
        x: px,
        y: py,
        scale,
        rotation,
        flipX: flip,
        terrain,
        zone,
        // 只有聚落带层级：其余素材留 `undefined`，点名表按"其它点要素"处理
        ...(tier ? { tier } : {}),
      };
      if (colliderHitsFree(collider, p, cluster, sizeOf)) {
        placements.push(p);
        return p;
      }
    }
    return null;
  };

  /**
   * 铺格顺序**打乱**再迭代：斑块种子与丛簇都从打乱序里选，
   * 超额部分均匀摊到全图（不会"北密南秃"）。
   */
  const order = [...cells];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  /** 森林丛簇已选种子格（候选去重：曼哈顿距离 < 4 格的后来者跳过） */
  const forestSeeds: Cell[] = [];

  for (const cell of order) {
    const terrain = cell.terrain;
    if (!cell.land || terrain === null) continue;
    // 河湖占住的格不再落素材（否则河里会长出一座山）
    if (water.cells.has(cell.row * cols + cell.col)) continue;
    // 配额用尽（该配方已经认领满自己的格数）→ 这一格就是平原
    if ((budget.get(terrain) ?? 0) <= 0) continue;

    const zone = zoneOfY(cell.y);
    const band = BAND_PARAMS[zone];

    const palette = pickTerrainSprites(groundPool, terrain, {
      count: PALETTE_SIZE,
      seed: Math.floor(rng() * 0x7fffffff),
      zone,
    });
    if (palette.length === 0) continue;

    const isForest = FOREST_TERRAINS.includes(terrain);
    const isPoint =
      terrain === "settlement" || terrain === "landmark" ||
      terrain === "river" || terrain === "lake" || terrain === "sea" || terrain === "coast";

    // ── 森林族：连通性先验 + 丛簇（逆向 @562661）──
    if (isForest) {
      // 连通性先验：8 邻域同类（森林族任一地形）0 个不出、1 个约 55%、≥2 个约 73%
      let f = 0;
      for (const nb of neighborsOf(cells, cols, rows, cell)) {
        if (nb.terrain !== null && FOREST_TERRAINS.includes(nb.terrain)) f += 1;
      }
      const prior = f === 1 ? 1 : f >= 2 ? 3 : -10;
      if (!(Math.floor(rng() * 11) + prior > 5)) continue;
      // 候选去重：已有丛的种子格在 4 格（曼哈顿）内 ⇒ 让给下一丛
      if (forestSeeds.some((s) => Math.abs(s.col - cell.col) + Math.abs(s.row - cell.row) < FOREST_DEDUP_CELLS)) {
        continue;
      }
      forestSeeds.push(cell);
      cluster += 1;

      // 丛直径 = 素材宽 × 体量 + 呼吸边（逆向 `(width*v+50)/Ma`）
      const first = palette[0];
      const baseScale = sizeComp * TERRAIN_SCALE[terrain] * overallScale;
      const ja = sizeOf(first.id).width * baseScale + FOREST_BREATHING;
      const edge = ja * FOREST_EDGE_RATIO;
      let placed = 0;
      // 基础 3 个：丛心 ±直径/5
      for (let i = 0; i < 3; i++) {
        const src = palette[Math.floor(rng() * palette.length)];
        const scale = Math.round(baseScale * (1 + (rng() - 0.5) * 2 * FOREST_SCALE_JITTER) * 100) / 100;
        if (placeOne(src, cell.x + (rng() - 0.5) * 2 * edge, cell.y + (rng() - 0.5) * 2 * edge, scale, band.rot, zone, terrain)) {
          placed += 1;
        }
      }
      // 四邻方向追加：该方向有同类地形才追（1~2 个，错位直径的 1/3~1/2）
      const dirs: Array<{ dc: number; dr: number }> = [
        { dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }, { dc: 1, dr: 0 },
      ];
      for (const dir of dirs) {
        const nb = cells[(cell.row + dir.dr) * cols + (cell.col + dir.dc)];
        const hasSibling =
          nb !== undefined && nb.terrain !== null && FOREST_TERRAINS.includes(nb.terrain);
        if (!hasSibling) continue;
        const spread = ja * (FOREST_SPREAD_MIN + rng() * (FOREST_SPREAD_MAX - FOREST_SPREAD_MIN));
        const src = palette[Math.floor(rng() * palette.length)];
        const scale = Math.round(baseScale * (1 + (rng() - 0.5) * 2 * FOREST_SCALE_JITTER) * 100) / 100;
        if (placeOne(src, cell.x + dir.dc * spread + (rng() - 0.5) * 2 * edge, cell.y + dir.dr * spread + (rng() - 0.5) * 2 * edge, scale, band.rot, zone, terrain)) {
          placed += 1;
        }
      }
      if (placed > 0) budget.set(terrain, (budget.get(terrain) ?? 1) - 1);
      continue;
    }

    cluster += 1;

    // 体量抖动 D（每格一掷、全层共享 —— 逆向：D 在格级算一次传入三次 place）
    const d = rng() * band.dAmp;
    // 主动留白：草带 D 越过阈值整格跳过（≈50% 格子留白，逆向 `6<D continue`）
    if (band.skipOver !== undefined && d > band.skipOver) continue;

    /** 本格共享基准体量：归一链 × (1 + D)。层间同体量（逆向三层同 scale） */
    const cellScale =
      Math.round(sizeComp * TERRAIN_SCALE[terrain] * overallScale * (1 + d) * 100) / 100;
    // 抖动幅度：草带（丘陵）±15 / 其余 ±5（逆向 u/z 的源值）
    const jx = zone === "grass" ? 15 : 5;
    const jyBase = zone === "grass" ? 20 : 10;
    const jyLayer = zone === "grass" ? 15 : 5;

    // 每格层数：地貌格 3 层（魔幻 `_0/_1/_2`）；水系与点符号 1~2 个（不叠罗汉）
    const layerCount = isPoint ? 1 + Math.floor(rng() * 2) : LAYERS_PER_CELL;

    let placed = 0;
    for (let i = 0; i < layerCount; i++) {
      const src = palette[Math.floor(rng() * palette.length)];
      // 层间错位：基准层在格心，其后各层向右下错开 10（逆向 `-40 → -30` 的差值）
      const ox = i === 0 ? 0 : LAYER_OFFSET;
      const oy = i === 0 ? 0 : LAYER_OFFSET;
      const x = cell.x + ox + (rng() - 0.5) * 2 * jx;
      const y = cell.y + oy + (rng() - 0.5) * 2 * (i === 0 ? jyBase : jyLayer);
      if (placeOne(src, x, y, cellScale, band.rot, zone, terrain)) placed += 1;
    }
    if (placed > 0) budget.set(terrain, (budget.get(terrain) ?? 1) - 1);
  }

  /**
   * ── 聚落成网 + 道路点线（2.45.0，ALGN-7）──
   *
   * 放在地貌铺完之后：选址要用**已经分好**的地形（宜居度：平原/河谷 > 山林 >
   * 雪线），连边要用落定后的聚落坐标。走 `elementSeedOf` 那条骰子流 ——
   * 「只换素材」时城与村跟着一起重掷，位置、层级、道路网是一体的。
   */
  const settlementPolylines: MapPolyline[] = [];
  if (settlementCells > 0) {
    const counts = settlementCountsOf(settlementCells);
    const sites = planSettlements(cells, {
      cols,
      rows,
      cities: counts.cities,
      towns: counts.towns,
      villages: counts.villages,
      rng,
      waterCells: water.cells,
      // 落点抖出格心（否则所有聚落精确坐在格网上，路网读起来像几何多边形边框）；
      // 抖完必须还在岸内 —— 判定用与道路代价同一套 `pointInLand`。
      inside: (p) => pointInLand(p, land),
    });

    /** 层级 → 体量微调：大城压得住周边一圈村落，茅屋只占半格 */
    const TIER_SCALE: Record<SettlementTier, number> = { city: 1.35, town: 1.05, village: 0.85 };
    const placedSites: SettlementSite[] = [];
    for (const site of sites) {
      const src = settlementSpriteOf(site.tier, options.pool, rng);
      if (!src) continue;
      const zone = zoneOfY(site.y);
      const scale =
        Math.round(
          sizeComp * TERRAIN_SCALE.settlement * overallScale * TIER_SCALE[site.tier] * 100,
        ) / 100;
      const placed = placeOne(
        src,
        site.x,
        site.y,
        scale,
        BAND_PARAMS[zone].rot,
        zone,
        "settlement",
        site.tier,
      );
      // ⚠️ 用**落位后的真实坐标**（`placeOne` 会在被拒时向外扩散重试，最多偏半格）：
      // 拿选址的理论坐标当端点，路会停在房子旁边半格处，接不上。
      if (placed) placedSites.push({ ...site, x: placed.x, y: placed.y });
    }

    // 道路只在**落位成功**的聚落之间连（没落上的点连着一条空路 = 断头路）
    settlementPolylines.push(
      ...buildRoadNet(
        placedSites.map((s) => ({ col: s.col, row: s.row, x: s.x, y: s.y, tier: s.tier })),
        {
          // 寻路格网与布点格网同一口径：地形代价让路自己绕到隘口与河谷。
          // ⚠️ 这里比布点严格一档：布点的 `cell.land` 带海岸探针（中心在海上也算陆地格），
          // 拿它当通行判据会让窄海峡"连成一片陆地"，路直接横渡过去（实测图右下角）。
          grid: {
            cols,
            rows,
            cellSize,
            x: box.x,
            y: box.y,
            cost: roadCostOfCells(cells.map((c) => c.terrain)).map((c, i) =>
              pointInLand(cells[i], land) ? c : Number.POSITIVE_INFINITY,
            ),
          },
          seed: options.elementSeed ?? elementSeedOf(options.seed),
        },
      ),
    );
  }

  // 先按地形层、同层再按脚底 y 升序：Pixi 按加入顺序绘制，排序即 z 序 ——
  // 层小的（森林/沼泽）先画被压底，层大的（山地/聚落）后画压住别人
  placements.sort((a, b) => {
    const la = TERRAIN_LAYER[a.terrain];
    const lb = TERRAIN_LAYER[b.terrain];
    if (la !== lb) return la - lb;
    return a.y - b.y;
  });

  return {
    land,
    placements,
    bands,
    polylines: [...water.polylines, ...settlementPolylines],
  };
}

/**
 * 层级 → 素材（在真实池子里的**优先级链**里挑存在的那几档，再随机取一张）。
 *
 * 【为什么不是"按 terrain 抽"】聚落层级是语义：大城不能因为池子里茅屋排在
 * 前面就画成茅屋。优先级链由 `SETTLEMENT_SPRITES` 给出，这里只负责落地。
 */
function settlementSpriteOf(
  tier: SettlementTier,
  pool: readonly SpriteSource[],
  rng: () => number,
): SpriteSource | null {
  const candidates = SETTLEMENT_SPRITES[tier]
    .map((id) => pool.find((s) => s.id === id))
    .filter((s): s is SpriteSource => Boolean(s));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

/**
 * 水系份额 → 河条数 / 湖个数。
 *
 * 【为什么是"条数"而不是"格数"】参考实现的河是格网路径，`size` 随帧数变；
 * 它的面板里根本没有"河流面积"这一项。把配方的面积份额换算成条数，才让
 * 「河流：多 / 少 / 无」这档滑杆的语义与逆向目标一致。
 *
 * @param waterSlots 配方里 `river` / `lake` 的份额（格）
 */
function waterTargetsOf(
  waterSlots: readonly { terrain: TerrainKind; count: number }[],
): { rivers: number; lakes: number } {
  const riverCells = waterSlots
    .filter((s) => s.terrain === "river")
    .reduce((acc, s) => acc + s.count, 0);
  const lakeCells = waterSlots
    .filter((s) => s.terrain === "lake")
    .reduce((acc, s) => acc + s.count, 0);
  const rivers = riverCells > 0 ? Math.min(16, Math.max(2, Math.round(riverCells / 3))) : 0;
  const lakes =
    rivers > 0
      ? Math.min(4, Math.max(1, Math.round((lakeCells > 0 ? lakeCells : rivers) / 3)))
      : 0;
  return { rivers, lakes };
}

/**
 * 只算水系（「只换陆地」档用）：陆地换了，旧河湖必须跟着重算。
 *
 * 【为什么不复用 `generateMap`】那会把整张图重铺一遍素材，用户"只换陆地"时
 * 摆好的山和城会全部重摇。这里只建格网 + 走地势场，地形一律按平原处理
 * （没有区域生长，就没有山体抬升），河仍然从内陆往海岸流 —— 对"一块新陆地"
 * 来说，这个地势模型恰好是对的。
 */
export function generateWater(options: {
  land: MapLand;
  seed: number;
  recipe: MapRecipe;
  richness: GeneratorRichness;
  tuning?: ResolvedGeneratorTuning;
}): MapPolyline[] {
  const land = options.land;
  if (land.polygons.length === 0) return [];
  const box = landBBox(land);
  const cellSize = Math.max(8, GRID_SIZES[options.richness]);
  const { cells, cols, rows } = buildGrid(land, box, cellSize);
  const landCells = cells.filter((c) => c.land).length;
  if (landCells === 0) return [];

  const total = Math.max(1, Math.round(landCells * (1 - PLAIN_CELL_RATIO)));
  const tuning = options.tuning ?? resolveGeneratorTuning({});
  const slots = resolveTerrainMix(options.recipe, tuning, total);
  const { rivers, lakes } = waterTargetsOf(slots.filter((s) => s.terrain === "river" || s.terrain === "lake"));
  if (rivers === 0) return [];

  return buildWaterNet(cells, {
    cols,
    rows,
    cellSize,
    rivers,
    lakes,
    rng: mulberry32(waterSeedOf(options.seed)),
    land,
  }).polylines;
}

/** 登记 + 判定合一：命中别的簇就返回 false，否则占位并返回 true */
function colliderHitsFree(
  collider: Collider,
  p: SpritePlacement,
  cluster: number,
  sizeOf: (spriteId: string) => { width: number; height: number },
): boolean {
  const { width, height } = sizeOf(p.spriteId);
  const w = width * p.scale * CORE;
  const h = height * p.scale * CORE;
  const x0 = p.x - w / 2 - COLLIDE_PAD;
  const x1 = p.x + w / 2 + COLLIDE_PAD;
  const y0 = p.y - h - COLLIDE_PAD;
  const y1 = p.y + COLLIDE_PAD;
  if (collider.hits(cluster, x0, y0, x1, y1)) return false;
  collider.add(cluster, x0, y0, x1, y1);
  return true;
}

/* ─────────────────── 地名分配（独立档） ─────────────────── */

/** 一条布点的名字（`index` 对应 placements 下标；无名的布点不出现在结果里） */
export interface PlacementName {
  index: number;
  text: string;
  /**
   * 字号档（2.46.0）：层级越高字越大。
   *
   * 参考成图上城名明显压得住周边村名，全靠一个字号会让"临江城"和"杏花村"
   * 一样大 —— 读者得逐字读才知道哪个是主城。这里按层级给档，渲染层只认档。
   */
  size: MapLabelSize;
}

export interface AssignNamesOptions {
  /** 已被占用的名字（手动地名 / 非本批素材的联动地名都要避开） */
  taken?: ReadonlySet<string>;
  /** 地名子流种子覆盖（「只换地名」档用）；缺省 = `nameSeedOf(seed)` */
  nameSeed?: number;
}

/**
 * 一键成图的**点名配额**（2.43.0，对齐参考实现的"低频地名"）。
 *
 * 参考成图只显国名 + 少量关隘/山名（命名表按要素类型限量取用）；点名逢素材必给
 * 会把下半屏糊成文字团（用户对比截图的直接差评点）。12 ≈ 参考一张图上点名的
 * 密度量级；超出配额的素材照常布点，只是不落名字（与"没进名池"同一路径）。
 *
 * 2.46.0 起这个数只当**总量**用，名额按层级分（见 `NAME_TIER_BUDGET`）。
 */
export const NAMED_LABEL_QUOTA = 12;

/**
 * 点名档（2.46.0）：聚落按层级分档，港/关隘/遗迹/塔这类点要素统一归 `other`。
 *
 * 【为什么不直接用 `settlementTierOf(spriteId)`】层级→素材是多对一，`city-mid`
 * 既是城镇的首选、又挂在大城链尾部，反查必然把镇读成城。布点阶段本来就知道
 * 层级（`SpritePlacement.tier`），反查只作老文档与合成数据的兜底。
 */
type NameTier = "city" | "town" | "other" | "village";

/**
 * 档位顺序与预算（2.46.0）。
 *
 * 【为什么不能"按布点顺序取前 12 个"】布点顺序 = 选址顺序（城→镇→村），而村落
 * 数量是城/镇的 5~10 倍，先到先得的结果是**名额被村名吃光**：实测 seed 26 的
 * 12 个点名叫了 7 个村，4 座大城里只有 1 座有名字 —— 成图上是一片村名、没有城名。
 * 参考成图正相反：城名是主体，村名只在空隙里点缀。
 *
 * 分配顺序 = 城 → 镇 → 其它点要素 → 村；每档另有上限，总配额仍是
 * `NAMED_LABEL_QUOTA`。城/镇多到超过配额时，村名一个都不点 —— 这是刻意的。
 */
const NAME_TIERS: readonly NameTier[] = ["city", "town", "other", "village"];

/**
 * 每档上限。村的预算 = 总配额，因为它是**最后一档**：前面的档装不满时由村把
 * `NAMED_LABEL_QUOTA` 填满（不给村设硬上限，否则「4 城 + 4 镇」只出 11 个名 ——
 * 分档预算的额度不会结转，少一个档就白少一个名额）。
 */
const NAME_TIER_BUDGET: Record<NameTier, number> = {
  city: 6,
  town: 4,
  other: 6,
  village: NAMED_LABEL_QUOTA,
};

/**
 * 档位 → 字号。城 16 / 镇·地标 12 / 村 10（全是 `LABEL_SIZES` 已有的档，
 * 不新增取值域）。差值只有两三号，但在一屏几十个名字的密度下足够区分主次。
 */
const NAME_TIER_SIZE: Record<NameTier, MapLabelSize> = {
  city: 16,
  town: 12,
  other: 12,
  village: 10,
};

/** 布点 → 点名档：优先用布点自带的层级，缺失（老文档 / 合成数据）才反查素材 */
function nameTierOf(placement: SpritePlacement): NameTier {
  if (placement.tier) return placement.tier;
  return settlementTierOf(placement.spriteId) ?? "other";
}

/**
 * 给布点批量起名。
 *
 * 谁有名字：素材自带 `names` 的点要素（城郭/港渡/遗迹——与手动落位
 * 同一套规则）。名池优先级（terrain.ts 约定）：
 *   预设 namePools > 素材自带 names > TERRAIN_META 默认池 > 不命名。
 * 同 seed 同名；占用查重全局唯一，全占用时 `名字·序号` 兜底。
 * **总量配额 `NAMED_LABEL_QUOTA`**：按布点顺序取前 12 个（确定性）。
 */
export function assignPlacementNames(
  placements: readonly SpritePlacement[],
  recipe: MapRecipe,
  seed: number,
  opts?: AssignNamesOptions,
): PlacementName[] {
  const rng = mulberry32(opts?.nameSeed ?? nameSeedOf(seed));
  const used = new Set(opts?.taken ?? []);
  const out: PlacementName[] = [];

  /**
   * 给一个布点摇名字；素材没有名池时返回 `null` 且**不消耗骰子**
   * （纯地貌不参与点名，rng 序列也就不会被它们扰动 —— 同 seed 的名额分配稳定）。
   */
  const pickName = (p: SpritePlacement): string | null => {
    // 【谁有名字】只有素材自带 names 的点要素（城郭/港渡/遗迹——与手动落位
    // 同一套规则）。纯地貌不吃预设池点名，否则一张图会冒出几十个山名。
    const spriteNames = SPRITE_NAMES_OF(p.spriteId);
    if (!spriteNames || spriteNames.length === 0) return null;

    // 名池候选按优先级拼接（terrain.ts 约定：预设 > 素材自带 > 默认池）；
    // 起点随机 → 换地名档能摇出不同组合
    const pool: string[] = [];
    const presetPool = recipe.namePools?.[p.terrain];
    if (presetPool) pool.push(...presetPool);
    pool.push(...spriteNames);
    pool.push(...TERRAIN_META[p.terrain].namePool);
    if (pool.length === 0) return null;

    const start = Math.floor(rng() * pool.length);
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[(start + i) % pool.length];
      if (!used.has(cand)) return cand;
    }
    // 全占用：首个候选 + 序号兜底
    const base = pool[start % pool.length];
    let n = 2;
    while (used.has(`${base}·${n}`)) n++;
    return `${base}·${n}`;
  };

  for (const tier of NAME_TIERS) {
    let namedInTier = 0;
    for (let index = 0; index < placements.length; index += 1) {
      if (out.length >= NAMED_LABEL_QUOTA || namedInTier >= NAME_TIER_BUDGET[tier]) break;
      const p = placements[index];
      if (nameTierOf(p) !== tier) continue;
      const text = pickName(p);
      if (!text) continue;
      used.add(text);
      out.push({ index, text, size: NAME_TIER_SIZE[tier] });
      namedInTier += 1;
    }
  }
  return out;
}

/**
 * spriteId → 自带名池。
 *
 * 【为什么是可注入的模块级 setter 而不是直接 import SPRITE_MAP】
 * domain 层禁止 import sprites.ts（架构 §六）。hook 装配时注入一次
 * （`installSpriteNamesResolver`），纯函数保持零依赖；测试直接传表。
 */
let spriteNamesResolver: ((spriteId: string) => readonly string[] | undefined) | null = null;

function SPRITE_NAMES_OF(spriteId: string): readonly string[] | undefined {
  return spriteNamesResolver?.(spriteId);
}

export function installSpriteNamesResolver(
  resolver: (spriteId: string) => readonly string[] | undefined,
): void {
  spriteNamesResolver = resolver;
}

/* ─────────────────── 结果摘要 ─────────────────── */

/** 摘要用的分类计数（key = SpriteCategory；UI 负责映射中文标签） */
export interface GenerationSummary {
  landCount: number;
  /** 分类 key → 数量（未分类素材归入 "other"） */
  byCategory: Record<string, number>;
  /** 地貌带 key → 数量（zone 直接挂在布点上，不需要注入） */
  byZone: Record<string, number>;
  namedCount: number;
}

/**
 * 生成结果统计（review §5.3「结果摘要」的数据侧）。
 * `categoryOf` 注入（同取料纪律：不 import sprites.ts）。
 */
export function summarizeGeneration(
  land: MapLand,
  placements: readonly SpritePlacement[],
  namedCount: number,
  categoryOf: (spriteId: string) => string | undefined,
): GenerationSummary {
  const byCategory: Record<string, number> = {};
  const byZone: Record<string, number> = {};
  for (const p of placements) {
    const key = categoryOf(p.spriteId) ?? "other";
    byCategory[key] = (byCategory[key] ?? 0) + 1;
    byZone[p.zone] = (byZone[p.zone] ?? 0) + 1;
  }
  return { landCount: land.polygons.length, byCategory, byZone, namedCount };
}
