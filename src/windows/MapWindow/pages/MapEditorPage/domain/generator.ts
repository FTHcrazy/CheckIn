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

import { generateLand as buildLand, pointInLand } from "../land";
import type { MapLand, Rect } from "../types";
import { expandTerrainMix, type MapPresetDef } from "./mapPresets";
import { TERRAIN_META, type TerrainKind } from "./terrain";
import { mulberry32, pickTerrainSprites, type SpriteSource } from "./terrain-assets";

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

/** 丰度档：决定素材目标总数（实际数量受陆地面积 / 碰撞拒绝约束，只少不多） */
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
 * `terrain` 记录它来自哪个配方——「只换地名」按它重查名池。
 */
export interface SpritePlacement {
  spriteId: string;
  /** 世界坐标：x 水平中心 / y 底部锚点（与 MapElement 同语义） */
  x: number;
  y: number;
  scale: number;
  /** 角度（度）。小幅抖动破"复制粘贴感"（review §5.4 变换） */
  rotation: number;
  terrain: TerrainKind;
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

/* ─────────────────── 布点几何 ─────────────────── */

/** 分区中心之间的最小距离（保证配方在空间上成片，读者才读得出"这是沼泽"） */
const ZONE_MIN_DIST = 130;
/** 单个布点的最大尝试次数；全失败则放弃该实例（密度自适应） */
const PLACE_ATTEMPTS = 28;
/** 分区中心找点尝试次数 */
const ZONE_ATTEMPTS = 48;
/**
 * 碰撞盒收缩系数：只拦"深叠"，允许层叠。
 *
 * 【为什么不是 1（完全不重叠）】手绘奇幻地图的山脉/森林本来就是**层叠着画**的
 * （连绵山岭的观感来自前后山峰互相压边）；实测 120 个目标素材按原尺寸零重叠
 * 在陆地面积里物理上放不下，落点会被碰撞拒绝砍到只剩十来个。收缩到 55% 后
 * "前后压边"放行、"几乎整个压住"仍拒绝 —— 与手绘观感一致。
 */
const CORE = 0.55;
/** 碰撞盒外扩（呼吸边，作用在收缩后的核心盒上） */
const COLLIDE_PAD = 2;

/** 碰撞注册表：均匀网格，cell 尺寸按最大素材近似取常量 */
const GRID_CELL = 64;

interface Collider {
  add(x0: number, y0: number, x1: number, y1: number): void;
  hits(x0: number, y0: number, x1: number, y1: number): boolean;
}

function createCollider(): Collider {
  const cells = new Map<number, { x0: number; y0: number; x1: number; y1: number }[]>();
  const key = (cx: number, cy: number) => cx * 100000 + cy;
  return {
    add(x0, y0, x1, y1) {
      const cx0 = Math.floor(x0 / GRID_CELL);
      const cx1 = Math.floor(x1 / GRID_CELL);
      const cy0 = Math.floor(y0 / GRID_CELL);
      const cy1 = Math.floor(y1 / GRID_CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const k = key(cx, cy);
          const list = cells.get(k);
          if (list) list.push({ x0, y0, x1, y1 });
          else cells.set(k, [{ x0, y0, x1, y1 }]);
        }
      }
    },
    hits(x0, y0, x1, y1) {
      const cx0 = Math.floor(x0 / GRID_CELL);
      const cx1 = Math.floor(x1 / GRID_CELL);
      const cy0 = Math.floor(y0 / GRID_CELL);
      const cy1 = Math.floor(y1 / GRID_CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const list = cells.get(key(cx, cy));
          if (!list) continue;
          for (const r of list) {
            if (x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0) return true;
          }
        }
      }
      return false;
    },
  };
}

/** 陆地内随机取点（拒绝采样；上限内找不到返回 null） */
function randomLandPoint(
  land: MapLand,
  rng: () => number,
  attempts: number,
): { x: number; y: number } | null {
  const b = land.bounds;
  for (let i = 0; i < attempts; i++) {
    const p = { x: b.x + rng() * b.width, y: b.y + rng() * b.height };
    if (pointInLand(p, land)) return p;
  }
  return null;
}

/* ─────────────────── 主入口 ─────────────────── */

/**
 * 生成一张图（陆地 + 素材布点）。
 *
 * 算法（地形 = 素材配方交叉渲染，见架构 §三）：
 *   1. 陆地：`buildLand`（既有形状算法，landSeed 子流）；
 *   2. 配比展开：`expandTerrainMix` 把预设份额换算成各配方的目标数量；
 *   3. 分区：每个配方在陆地里落一个**中心**（相互拉开距离），
 *      素材围绕中心撒布——配方成片，读者才读得出"这是沼泽"；
 *   4. 选材：`pickTerrainSprites`（主地形优先、回退链补位）得到配方的
 *      素材调色板，实例按调色板循环 + 随机补位（池小量大，靠抖动出变体）；
 *   5. 落点：极坐标均匀撒在中心邻域，陆地外 / 碰撞盒重叠即拒绝，
 *      尝试耗尽放弃该实例（实际数量 ≤ 目标，摘要如实统计）。
 *
 * 骨架档（`mode: "skeleton"`）只返回陆地，`placements` 为空。
 */
export function generateMap(options: GenerateMapOptions): GeneratedMap {
  const land = buildLand({ seed: landSeedOf(options.seed), bounds: options.bounds });
  if (options.mode === "skeleton" || land.polygons.length === 0) {
    return { land, placements: [] };
  }

  const rng = mulberry32(options.elementSeed ?? elementSeedOf(options.seed));
  const total = RICHNESS_TOTALS[options.richness];
  const slots = expandTerrainMix(options.preset, total);
  const collider = createCollider();

  /** spriteId → 渲染尺寸（碰撞与调色板循环都要用） */
  const sizeOf =
    options.sizeOf ??
    (() => ({ width: 90, height: 70 }));

  /** 布点失败（找不到合法位置）时返回 false */
  const tryPlace = (p: SpritePlacement): boolean => {
    const { width, height } = sizeOf(p.spriteId);
    const w = width * p.scale * CORE;
    const h = height * p.scale * CORE;
    const x0 = p.x - w / 2 - COLLIDE_PAD;
    const x1 = p.x + w / 2 + COLLIDE_PAD;
    const y0 = p.y - h - COLLIDE_PAD;
    const y1 = p.y + COLLIDE_PAD;
    if (collider.hits(x0, y0, x1, y1)) return false;
    collider.add(x0, y0, x1, y1);
    return true;
  };

  const placements: SpritePlacement[] = [];
  const centers: { x: number; y: number }[] = [];

  for (const slot of slots) {
    // ── 分区中心：陆地里找一个与其它中心拉开距离的点 ──
    let center: { x: number; y: number } | null = null;
    let fallback: { x: number; y: number } | null = null;
    for (let i = 0; i < ZONE_ATTEMPTS; i++) {
      const p = randomLandPoint(land, rng, 8);
      if (!p) continue;
      fallback = p;
      const ok = centers.every((c) => Math.hypot(c.x - p.x, c.y - p.y) >= ZONE_MIN_DIST);
      if (ok) {
        center = p;
        break;
      }
    }
    if (!center) center = fallback;
    // 陆地已经小到 rejection 都找不到点（极端 seed）：放弃该配方
    if (!center) continue;
    centers.push(center);

    // ── 调色板：配方内加权不放回（池不足时回退链补位）──
    const palette = pickTerrainSprites(options.pool, slot.terrain, {
      count: slot.count,
      seed: Math.floor(rng() * 0x7fffffff),
    });
    if (palette.length === 0) continue;

    // 邻域半径：按目标数量开方摊开（配方份额越大占地越大）
    const zoneR = 46 * Math.sqrt(slot.count) + 40;

    // 首轮：调色板每张至少出现一次（前 min(count, palette.length) 个实例）
    // 余量：带权重随机补位（同符号复用 + 抖动出变体，review §5.4）
    const sequence: SpriteSource[] = [];
    for (let i = 0; i < slot.count; i++) {
      sequence.push(
        i < palette.length
          ? palette[i]
          : palette[Math.floor(rng() * palette.length)],
      );
    }

    for (const src of sequence) {
      let placed = false;
      for (let a = 0; a < PLACE_ATTEMPTS && !placed; a++) {
        const angle = rng() * Math.PI * 2;
        const rad = Math.sqrt(rng()) * zoneR;
        const x = center.x + Math.cos(angle) * rad;
        const y = center.y + Math.sin(angle) * rad;
        if (!pointInLand({ x, y }, land)) continue;
        const p: SpritePlacement = {
          spriteId: src.id,
          x,
          y,
          scale: Math.round((0.85 + rng() * 0.35) * 100) / 100,
          rotation: Math.round((rng() - 0.5) * 14 * 10) / 10,
          terrain: slot.terrain,
        };
        if (tryPlace(p)) {
          placements.push(p);
          placed = true;
        }
      }
      // 尝试耗尽：放弃该实例（拥挤时密度自适应回落，摘要如实统计）
    }
  }

  return { land, placements };
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
  for (const p of placements) {
    const key = categoryOf(p.spriteId) ?? "other";
    byCategory[key] = (byCategory[key] ?? 0) + 1;
  }
  return { landCount: land.polygons.length, byCategory, namedCount };
}
