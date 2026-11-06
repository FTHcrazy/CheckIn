/**
 * 一键成图生成器（R-MAP-21，B3）—— 纯函数引擎
 *
 * **生成的是"对象"，不是"画面"**（review §5.3）：输入预设配方 + seed，
 * 输出陆地几何 + 素材实例布点（可编辑的 MapElement 前身）， 地名分配
 * 独立成档（`assignPlacementNames`），区块树仍由既有 `generateHierarchy`
 * 在 hook 层补齐（复用同一套几何，生成器不重复实现）。
 *
 * ── 确定性 ──
 * 同 seed + 同参数 ⇒ 逐实例坐标相同（review §5.3 铁律 1）。三条 mulberry32
 * 子流各自加盐，互不干扰：
 *   · 陆地   `landSeedOf`   —— 复用 land.ts 的形状算法
 *   · 素材   `elementSeedOf`—— 分区选材 + 布点 + 抖动
 *   · 地名   `nameSeedOf`   —— 只换地名时不惊动前两者
 * 「换一张」= 全新 base seed；五档局部重掷 = 子流盐值再混一个自增计数
 * （交互动作，不承诺跨会话复现——复现看工具栏的 seed 指示 + 同参数重生成）。
 *
 * ── 取料纪律（架构 §六 铁律）──
 * 素材池由调用方**注入**（`pool`），本文件禁止 import sprites.ts ——
 * 否则用户导入素材（S2）进不了配方。尺寸与类别同理经 `sizeOf` 注入。
 *
 * 本文件无 IO、无 React、无 PIXI；import 白名单：
 * ./terrain ./terrain-assets ./mapPresets ../types ../land ../regions（后两者纯几何）。
 */

import { generateLand as buildLand, insetLand, landAreaRatio, pointInLand } from "../land";
import type { MapLand, Rect } from "../types";
import { expandTerrainMix, type MapPresetDef } from "./mapPresets";
import { TERRAIN_META, type TerrainKind } from "./terrain";
import { flippableOf, mulberry32, pickTerrainSprites, type SpriteSource } from "./terrain-assets";
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

/* ─────────────────── 参数与产物 ─────────────────── */

/**
 * 丰度档：目标实例总数。
 *
 * 【它是「密度」的入口，但不是「密度」本身】生成器拿它反解格边长
 * （`格边长 = √(陆地面积 / 格数)`），格内实例数恒在 1~3 —— 所以换档改的是
 * "同一片地铺多密"，而不是"总数堆多少"。实际数量仍受陆地面积 / 留白 /
 * 碰撞拒绝约束，只少不多。
 */
export type GeneratorRichness = "sparse" | "standard" | "dense";

export const RICHNESS_TOTALS: Record<GeneratorRichness, number> = {
  sparse: 70,
  standard: 120,
  dense: 190,
};

export const RICHNESS_LABELS: Record<GeneratorRichness, string> = {
  sparse: "稀疏",
  standard: "标准",
  dense: "繁密",
};

/** 档位：成图 = 陆地 + 素材 + 地名；骨架 = 只出陆地（不铺素材） */
export type GeneratorMode = "full" | "skeleton";

/** 五档重掷（review §5.3 铁律 3：全部 / 只陆地 / 只素材 / 只地名 / 只分区） */
export type GeneratorGear = "all" | "land" | "sprites" | "names" | "regions";

/** 生成器参数（UI 弹层与五档重掷共用的形状） */
export interface GeneratorParams {
  presetId: string;
  richness: GeneratorRichness;
  mode: GeneratorMode;
  /** 是否同时划分区块（默认关，承接 R-REG-02） */
  withRegions: boolean;
  /** 是否生成地名（成图档生效） */
  withLabels: boolean;
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
}

export interface GenerateMapOptions {
  seed: number;
  /** 整张纸的世界矩形（hook 传 BASE_BOUNDS，本文件不 import store） */
  bounds: Rect;
  preset: MapPresetDef;
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
}

export interface GeneratedMap {
  land: MapLand;
  placements: SpritePlacement[];
}

/* ─────────────────── 布点骨架：网格 + 丛簇（review §6 P0-2） ─────────────────── */

/**
 * 每格平均实例数（格内 2~4、主地形 3~5 的均值）。
 *
 * 【密度为什么改「格子边长」而不是「目标总数」】参考实现的丰度档改的是
 * **格网边长**，相对间距恒定 —— 大图小图都铺得一样密，只是格子多少不同。
 * 本项目早期直接按目标总数撒点，于是小图挤成一坨、大图稀得能跑马。
 * 现在反过来解：`目标总数 → 需要的格数 → 格边长`，格内实例数停在 2~5。
 *
 * 【为什么是 3 而不是 2】2 的话格网密、每簇只有一两张，全图变成"均匀地毯"；
 * 3 让格子变稀、每簇变厚，才有手绘地图的"一坨一坨，中间留白"。
 */
const INSTANCES_PER_CELL = 3;

/**
 * 平原格占比：**目标**，只用来反解格边长（见 `generateMap` 第 2 步）。
 *
 * 【它不再是"随机丢弃"】旧实现按这个概率逐格 `continue`，丢掉的格虽不铺素材，
 * 但格网仍被主地形认领，读者看到的是"稀疏的满铺"而不是"成片的平原"。
 * 现在留白由「配额之外没被认领的格」产生（见 `assignTerrainByGrowth`）：
 * 同样是 30%，前者是随机麻点，后者是连成片的空地 —— 后者才是手绘地图的呼吸感。
 */
const PLAIN_CELL_RATIO = 0.18;

/**
 * 「标准档」的格边长基准（世界单位）。
 *
 * 【素材尺寸为什么要跟着格边长走】参考实现的丰度档改的是**格网边长**，并给
 * 素材尺寸补偿 `grid>50 → w+=0.1` —— 素材与格子的比例恒定，换档只是"同样的
 * 画放大/缩小"。本项目此前素材尺寸与格子脱钩：繁密档格子变小、素材不变，
 * 结果整张图糊成一片山墙；稀疏档反之，图就散了。这里把两者绑起来。
 */
const BASE_CELL = 92;

/** 孤立格（8 邻域无同类地形）的保留概率：连通性先验，决定"成片"还是"撒芝麻" */
const ISOLATED_KEEP = 0.25;

/** 格边长夹取（世界单位）：下界防糊成一团，上界防一个格大得读不出成团 */
const CELL_MIN = 56;
const CELL_MAX = 180;

/** 格内抖动半径 = 格边长 × 该比例（丛簇的"散开度"） */
const JITTER_RATIO = 0.34;

/**
 * 分带接缝的过渡带宽度（相对陆地高度，两侧各一半）。
 *
 * 【为什么需要它】纬度硬切会在整张图上留一道**水平直线**——颜色/画风沿着
 * 一条 1 像素的线突变，比不分带更扎眼。接缝两侧按比例随机落到相邻带，
 * 一条硬线就摊成了 8% 高度的渐变。
 */
const ZONE_BLEND = 0.08;

/** 单个实例的落位尝试次数；耗尽就少一个（拥挤时密度自适应回落） */
const PLACE_ATTEMPTS = 12;

/**
 * 旋转幅度：大体量素材更稳（±5°）、小体量素材略活（±9°）。
 *
 * 【为什么反过来】参考实现是丘陵 ±15° / 主池 ±5~7°，而旧值恰相反（大 ±7 / 小 ±15）：
 * 大体量的山/城转 7° 已看得出歪，小树小丘转 15° 又显得东倒西歪。改成「大更稳、
 * 小略活」后，旋转只用来破复制粘贴感，不该抢戏（问题 3「旋转不和谐」修复）。
 */
const ROT_LARGE = 5;
const ROT_SMALL = 9;

/** 「大体量」分界（基准宽度，世界单位） */
const LARGE_SPRITE_WIDTH = 120;

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
 * 一座山占陆地宽 63%~90% —— 陆地像小岛、素材像巨人。这里把整张表等比 ×0.42（在
 * 上一轮 0.6 的基础上再砍 30%），山体落到 ~140，占陆宽约 25%~35%，接近逆向目标
 * 「山体基准 w=0.18~0.50 相对格子」的观感；**相对关系（点符号 < 地表 < 山地）一字不动**。
 *
 * 【为什么不动 `sprites.ts` 的 baseWidth】那是素材固有画幅，是碰撞/命中测试/面板
 * 预览的基准，改它会让手动落位、命中与预览一起漂移。一键成图只走这套系数，改这里
 * 才是最小、最安全的切口。
 */
const TERRAIN_SCALE_OVERALL = 0.42;

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

/** 黄金角（弧度）：簇内螺旋落位的角步长，保证相邻实例不重合 */
const GOLDEN_ANGLE = 2.399963229728653;

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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 陆地实测包围盒。
 *
 * 【为什么不用 `land.bounds`】那是整张纸，陆地面通常只占中部 55%~70%；
 * 拿纸张当分带基准会把雪带整个压在海上，南北两头永远用不到 ——
 * 分带与格网都必须跟着陆地走。
 */
function landBBox(land: MapLand): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of land.polygons) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return land.bounds;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
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

/** 8 邻域里同类地形的格数（连通性先验） */
function sameNeighborCount(
  cells: readonly Cell[],
  cols: number,
  rows: number,
  cell: Cell,
): number {
  let n = 0;
  for (const nb of neighborsOf(cells, cols, rows, cell)) {
    if (nb.terrain !== null && nb.terrain === cell.terrain) n++;
  }
  return n;
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
    // 实例数 → 格数：一格平均承载 INSTANCES_PER_CELL 个实例
    const quota = Math.max(1, Math.round(slot.count / INSTANCES_PER_CELL));
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

/* ─────────────────── 主入口 ─────────────────── */

/**
 * 生成一张图（陆地 + 素材布点）。
 *
 * 算法（地形 = 素材配方交叉渲染，见架构 §三；骨架见 review §6 P0-2）：
 *   1. 陆地：`buildLand`（既有形状算法，landSeed 子流）；
 *   2. 格网：目标总数反解格边长（密度靠格子大小调，不靠实例数）；
 *   3. 分地形：区域生长，让每个配方连成一片；
 *   4. 分带：按纬度取地貌带（北雪/主/草/南沙，或预设锁定的气候带），
 *      同地形按带换画风 —— 雪原不长阔叶树、沙漠不长针叶林；
 *   5. 铺实例：每格 2~4 个（主地形 3~5），同簇共享基准大小 + 黄金角螺旋，
 *      孤立格大概率放弃（连通性先验），跨格只拦深叠；
 *   6. 收尾：按脚底 y 升序（Pixi 按加入顺序绘制，排序即 z 序）。
 *
 * 骨架档（`mode: "skeleton"`）只返回陆地，`placements` 为空。
 */
export function generateMap(options: GenerateMapOptions): GeneratedMap {
  const land = buildLand({ seed: landSeedOf(options.seed), bounds: options.bounds });
  if (options.mode === "skeleton" || land.polygons.length === 0) {
    return { land, placements: [] };
  }

  // 素材锚点按**内缩后的岸线**判落海：素材不压海岸 14 单位（见 land.ts 的 COAST_INSET）。
  // 格网 cellHasLand / buildGrid 仍用原 land —— 沿海格还要被认领，只把"锚点"往内陆收。
  const inset = insetLand(land);

  const rng = mulberry32(options.elementSeed ?? elementSeedOf(options.seed));
  const total = RICHNESS_TOTALS[options.richness];
  const slots = expandTerrainMix(options.preset, total);
  if (slots.length === 0) return { land, placements: [] };

  /** spriteId → 渲染尺寸（抖动幅度与碰撞都要用） */
  const sizeOf = options.sizeOf ?? (() => ({ width: 90, height: 70 }));

  // ── 格网：目标总数 → 格数 → 格边长 ──
  const box = landBBox(land);
  const paperArea = Math.max(1, land.bounds.width * land.bounds.height);
  const landArea = Math.max(1, landAreaRatio(land) * paperArea);
  const wantCells = Math.max(
    1,
    total / INSTANCES_PER_CELL / (1 - PLAIN_CELL_RATIO),
  );
  const cellSize = clamp(Math.sqrt(landArea / wantCells), CELL_MIN, CELL_MAX);
  const { cells, cols, rows } = buildGrid(land, box, cellSize);
  /** 素材尺寸随格边长补偿：换档只换精细度，不改"素材 : 地块"的比例 */
  const sizeScale = clamp(cellSize / BASE_CELL, 0.72, 1.32);

  // ── 地形分布（区域生长，多片）──
  assignTerrainByGrowth(cells, cols, rows, slots, rng);

  /** 纬度取带；预设锁定气候时不看纬度（「万里雪原」南缘不该冒沙丘） */
  const climate = options.preset.climate;
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
   * 已用外观组合登记表（spriteId → { flip|量化scale|量化rotation }）。
   *
   * 口径与守卫测试一致（`scale.toFixed(2) + rotation.toFixed(1) + flip`）：
   * 四元组（spriteId + flip + 量化 scale + 量化 rotation）全等的两张贴图
   * 在任何视口下逐像素重合 —— 生成器在此登记，撞车实例翻面或重掷角度
   * （见布点循环内的"确定性去重"）。
   */
  const seenPixels = new Map<string, Set<string>>();

  /**
   * 各配方的剩余配额（地形 → 还能铺几个实例）。
   *
   * 【为什么必须有它】旧实现只按"每格 2~4 个"铺，格数由主地形占满，于是预设写
   * `mountain 0.55 / forest 0.30` 却产出 83% 的山。配额是**预设配比的唯一执行点**：
   * 配额用尽的地形不再开簇，剩下的空间自然变成平原。
   */
  const budget = new Map<TerrainKind, number>(slots.map((s) => [s.terrain, s.count]));

  /**
   * 铺格顺序**打乱**再迭代。
   *
   * 【为什么不是从上到下】目标总数是硬上限，顺序迭代会在到达上限时把
   * 南半边整片截掉（"北密南秃"，且分带统计里沙带恒为 0）。打乱后超额部分
   * 均匀摊到全图，等价于整体稀释一档。
   */
  const order = [...cells];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (const cell of order) {
    if (placements.length >= total) break;
    const terrain = cell.terrain;
    if (!cell.land || terrain === null) continue;
    const left = budget.get(terrain) ?? 0;
    // 配额用尽（该配方已经铺满自己的份额）→ 这一格就是平原
    if (left <= 0) continue;
    // 连通性：孤零零一格大概率不成丛（孤立点出现率 ≈ 1/4，内部点接近 100%）
    if (sameNeighborCount(cells, cols, rows, cell) === 0 && rng() > ISOLATED_KEEP) continue;

    const zone = zoneOfY(cell.y);
    const palette = pickTerrainSprites(options.pool, terrain, {
      count: PALETTE_SIZE,
      seed: Math.floor(rng() * 0x7fffffff),
      zone,
    });
    if (palette.length === 0) continue;

    cluster += 1;
    // 每簇 2~4 个：簇的大小本身就是"密度变化"的一部分（参考实现同簇 1~3 层）
    const count = Math.min(left, 2 + Math.floor(rng() * 3));
    // 同簇共享基准大小：一簇里几座山大小相近，读起来才"是一座山群"。
    // 区间刻意收窄（0.88~1.14）：素材池小的时候，"同一张图缩放不同"
    // 是唯一能把重复品读成"另一处同类地形"的手段，但跨簇差异过大就会
    // 变成"贴纸大小没统一"。
    const clusterScale =
      (0.88 + rng() * 0.26) * sizeScale * TERRAIN_SCALE[terrain] * TERRAIN_SCALE_OVERALL;
    const jitter = cellSize * JITTER_RATIO;
    /** 本簇已落位的锚点（同簇不参与碰撞，但要防"同一张贴图叠画"） */
    const anchors: { x: number; y: number; sep: number }[] = [];

    for (let i = 0; i < count && placements.length < total; i++) {
      const src =
        i < palette.length ? palette[i] : palette[Math.floor(rng() * palette.length)];
      const size = sizeOf(src.id);
      // 镜像翻转（P1-4）：按素材 `flippable` 以 50% 概率翻面。掷骰放在尝试循环
      // 之前 —— 每个实例固定消耗一次 rng，不随"落位重试了几次"漂移，同 seed
      // 的翻转序列与坐标 / 缩放一样逐实例可复现。不可翻的素材不掷骰
      // （不消耗子流），且恒为 false。
      const flipX = flippableOf(src) ? rng() < 0.5 : false;
      // 实例微调 0.9~1.1：一簇里"同一张贴图摆两次"是最刺眼的重复，尺寸错开
      // 一成以上，人眼就不再把它读成复制粘贴（旋转只有几度，扛不住这个任务）。
      const scale = Math.round(clusterScale * (0.9 + rng() * 0.2) * 100) / 100;
      const rotAmp = size.width >= LARGE_SPRITE_WIDTH ? ROT_LARGE : ROT_SMALL;
      const sep = Math.min(
        Math.max(5, Math.min(size.width, size.height) * 0.22 * scale),
        // 上界跟着格子走：繁密档格子变小，绝对间距若不变会把实例一个个拒掉，
        // 结果是"繁密"与"标准"数量几乎一样（实测 96 vs 106）
        jitter * 0.9,
      );
      // 簇内落位用**黄金角螺旋**而不是纯随机：随机坐标会撞在一起（两个实例
      // 相距 2 单位 = 同一张贴图叠画），螺旋保证「同簇相邻、但不重合」，
      // 观感上又比等距环更自然。
      const angle = i * GOLDEN_ANGLE + rng() * 0.5;
      const radius = jitter * (0.4 + 0.5 * (i / Math.max(1, count - 1))) * (0.7 + rng() * 0.6);

      for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
        // 前几次贴着螺旋位微扰；落海时才放大到整格随机
        const spread = attempt < 3 ? jitter * 0.18 : jitter;
        const x = cell.x + Math.cos(angle) * radius + (rng() - 0.5) * 2 * spread;
        const y = cell.y + Math.sin(angle) * radius * 0.75 + (rng() - 0.5) * 2 * spread;
        // 贴图轴对齐盒（脚底中心 + 四角）必须整体落在内缩轮廓内：只判锚点会让
        // 宽素材的左右脚越过海岸线（见 footprintInLand 的注释）
        if (!footprintInLand({ x, y }, size, scale, inset)) continue;
        if (anchors.some((a) => Math.hypot(a.x - x, a.y - y) < Math.max(sep, a.sep))) continue;
        // ── 确定性去重（P1-4 验收抬升：任意 seed 恒 0）──
        //
        // 翻转只是把同屏"像素完全一致"对的期望砍半；素材池最稀的档位
        // （沼泽/雪原 7 种）里，(scale 0.01 / rotation 0.1°) 的量化抖动自身
        // 会碰撞 —— 实测 60 seeds 扫描仍有 33% 的图含 ≥1 对完全一致素材。
        // 这里把"统计性"抬成"结构性"：同一 spriteId 的 (flip, 量化scale,
        // 量化rotation) 组合全图至多出现一次。撞了先翻反 flip（零成本，
        // 翻转本来就该随机）；仍撞才重掷 rotation（**条件性消耗 rng**——
        // 只有真撞了才掷，同 seed 确定性不变，只是消耗序列不再逐实例固定）。
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
          // 500 是纯保险丝：单 (spriteId, scale) 的可用组合 ≥ 2×100 个，
          // 实际撞不到；耗尽也必须退出（结构性不可能但别挂死测试）
          rotation = Math.round((rng() - 0.5) * 2 * rotAmp * 10) / 10;
          pixelKey = pixelKeyOf(flip, rotation);
          rerolls += 1;
        }
        seen.add(pixelKey);
        seenPixels.set(src.id, seen);
        const p: SpritePlacement = {
          spriteId: src.id,
          x,
          y,
          scale,
          rotation,
          flipX: flip,
          terrain,
          zone,
        };
        if (colliderHitsFree(collider, p, cluster, sizeOf)) {
          placements.push(p);
          anchors.push({ x, y, sep });
          budget.set(terrain, (budget.get(terrain) ?? 1) - 1);
          break;
        }
      }
      // 尝试耗尽：少一个实例（拥挤时密度自适应回落，摘要如实统计）
    }
  }

  // 先按地形层、同层再按脚底 y 升序：Pixi 按加入顺序绘制，排序即 z 序 ——
  // 层小的（森林/沼泽）先画被压底，层大的（山地/聚落）后画压住别人
  placements.sort((a, b) => {
    const la = TERRAIN_LAYER[a.terrain];
    const lb = TERRAIN_LAYER[b.terrain];
    if (la !== lb) return la - lb;
    return a.y - b.y;
  });

  return { land, placements };
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
}

export interface AssignNamesOptions {
  /** 已被占用的名字（手动地名 / 非本批素材的联动地名都要避开） */
  taken?: ReadonlySet<string>;
  /** 地名子流种子覆盖（「只换地名」档用）；缺省 = `nameSeedOf(seed)` */
  nameSeed?: number;
}

/**
 * 给布点批量起名。
 *
 * 谁有名字：素材自带 `names` 的点要素（城郭/港渡/遗迹——与手动落位
 * 同一套规则）。名池优先级（terrain.ts 约定）：
 *   预设 namePools > 素材自带 names > TERRAIN_META 默认池 > 不命名。
 * 同 seed 同名；占用查重全局唯一，全占用时 `名字·序号` 兜底。
 */
export function assignPlacementNames(
  placements: readonly SpritePlacement[],
  preset: MapPresetDef,
  seed: number,
  opts?: AssignNamesOptions,
): PlacementName[] {
  const rng = mulberry32(opts?.nameSeed ?? nameSeedOf(seed));
  const used = new Set(opts?.taken ?? []);
  const out: PlacementName[] = [];

  placements.forEach((p, index) => {
    // 【谁有名字】只有素材自带 names 的点要素（城郭/港渡/遗迹——与手动落位
    // 同一套规则）。纯地貌不吃预设池点名，否则一张图会冒出几十个山名。
    const spriteNames = SPRITE_NAMES_OF(p.spriteId);
    if (!spriteNames || spriteNames.length === 0) return;

    // 名池候选按优先级拼接（terrain.ts 约定：预设 > 素材自带 > 默认池）；
    // 起点随机 → 换地名档能摇出不同组合
    const pool: string[] = [];
    const presetPool = preset.namePools?.[p.terrain];
    if (presetPool) pool.push(...presetPool);
    pool.push(...spriteNames);
    pool.push(...TERRAIN_META[p.terrain].namePool);
    if (pool.length === 0) return;

    const start = Math.floor(rng() * pool.length);
    let text: string | null = null;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[(start + i) % pool.length];
      if (!used.has(cand)) {
        text = cand;
        break;
      }
    }
    if (!text) {
      // 全占用：首个候选 + 序号兜底
      const base = pool[start % pool.length];
      let n = 2;
      while (used.has(`${base}·${n}`)) n++;
      text = `${base}·${n}`;
    }
    used.add(text);
    out.push({ index, text });
  });
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
