/**
 * 地形配方（2.45.0 起**完全随机**，取代「热门地图预设」登记表）
 *
 * 一个配方 = 一张图的「地形配比」：只回答**铺什么地形、各占多少**；
 * 怎么摊到画布上是 B3 生成算法的事（复用 regionSchema + LOD 体系）。
 *
 * ── 为什么删掉三个固定预设 ──
 * 「十万大山 / 南疆沼泽 / 万里雪原」是三份**写死的配比**：选它就等于锁死
 * "这张图长什么样"，连点三次「换一张」得到的还是同一类地貌，只是山的位置换了。
 * 用户要的是"每次点都出来一张没见过的图"，那就没有理由让配方是个下拉框 ——
 * 配方该由 seed 抽出来。
 *
 * ── 随机必须仍然"像一张图"──
 * 纯均匀随机配比会抽出「40% 沙漠 + 30% 雪原」这种自相矛盾的图。所以随机发生在
 * **家族层**：山体 / 丘陵 / 森林 / 开阔地 / 湿泽 / 荒漠 / 寒地 / 水系 / 聚落 / 遗迹
 * 各有一档区间与出现概率，家族内部再随机挑 1~2 个具体地形切分额度。
 * 山体与开阔地**必定出现**（一张没有山也没有空地的图没有构图），
 * 荒漠 / 寒地 / 湿泽按概率缺席 —— 它们正是"这一张和上一张不一样"的来源。
 *
 * 纯登记表 + 纯函数：无 IO、无 React、无 PIXI。同 seed 同配方（可复现）。
 */

import { LAND_BASE_COLORS, LAND_SHAPES, type LandShapeId } from "../land";
import type { TerrainKind } from "./terrain";
import { mulberry32 } from "./terrain-assets";
import type { SpriteZone } from "./zones";

/** 一张图的地形配方 */
export interface MapRecipe {
  /** 稳定 id（随机配方 = `rnd-<seed>`，只用于摘要与日志，不参与渲染） */
  id: string;
  /** 展示名（随机配方 = 「随机」） */
  label: string;
  /** 地形配比（share 合计 = 1，浮点容差内） */
  terrainMix: { terrain: TerrainKind; share: number }[];
  /**
   * 气候带锁定（缺省 = 按纬度渐变）。
   *
   * 缺省时整张图分四带（北雪 / 主 / 草 / 南沙），一张图上读得出"南北有差别"；
   * 声明后全图只用这一带 —— 雪原图上不该在南缘长出沙丘。
   */
  climate?: SpriteZone;
  /** 覆盖 TERRAIN_META 默认地名池（随机配方不用：名字走素材自带 + 默认池） */
  namePools?: Partial<Record<TerrainKind, string[]>>;
}

/**
 * 家族：随机抽样的**最小单位**。
 *
 * `share` 是家族在整张图里的占比区间；`chance` 是它是否出现在这张图上的概率
 * （1 = 必出）。家族内部再随机挑 1~2 个地形切分 —— 于是同一家族在不同 seed 下
 * 既可能长成"连绵山岭"，也可能长成"高原 + 火山"。
 */
interface MixFamily {
  key: string;
  /** 家族内的候选地形（按「越靠前越常见」排列） */
  terrains: readonly TerrainKind[];
  /** 占比区间 `[min, max]` */
  share: readonly [number, number];
  /** 出现概率（缺省 1） */
  chance?: number;
}

/** 家族的抽样表（顺序 = 抽签顺序，越前越先占额度） */
const MIX_FAMILIES: readonly MixFamily[] = [
  // 山体必出：没有山的架空大陆没有构图重心
  { key: "mountain", terrains: ["mountain", "highland", "volcano"], share: [0.2, 0.42] },
  // 丘陵/谷地：山脚到平原的过渡，几乎必出
  { key: "hill", terrains: ["hill", "valley"], share: [0.05, 0.14], chance: 0.9 },
  { key: "forest", terrains: ["forest", "jungle"], share: [0.08, 0.22], chance: 0.9 },
  // 开阔地必出：整张图都是山会读成一坨纹理
  { key: "open", terrains: ["plain", "grassland"], share: [0.1, 0.24] },
  { key: "wetland", terrains: ["swamp"], share: [0.04, 0.1], chance: 0.5 },
  { key: "desert", terrains: ["desert", "oasis"], share: [0.05, 0.16], chance: 0.55 },
  { key: "cold", terrains: ["snowfield", "tundra"], share: [0.05, 0.16], chance: 0.55 },
  // 水系：份额决定"几条河 / 几个湖"（见 generator 的 waterTargetsOf）
  { key: "water", terrains: ["river", "lake"], share: [0.07, 0.15] },
  { key: "settlement", terrains: ["settlement"], share: [0.03, 0.07] },
  { key: "ruin", terrains: ["landmark"], share: [0.02, 0.05], chance: 0.75 },
];

/** 锁定全图气候的概率（其余走纬度渐变 —— 「南北有差别」是默认观感） */
const CLIMATE_LOCK_CHANCE = 0.22;

/** 可锁定的气候带（主带 = 不锁，等同于缺省） */
const LOCKABLE_CLIMATES: readonly SpriteZone[] = ["snow", "desert", "grass"];

/** 「随机」档的哨兵值（形状 / 底色下拉里的一档） */
export const RANDOM_CHOICE = "random";

/** 家族额度 → 地形条目（1 个地形独占，2 个按 0.62 / 0.38 切） */
function splitFamily(family: MixFamily, rng: () => number): { terrain: TerrainKind; share: number }[] {
  const [min, max] = family.share;
  const total = min + rng() * (max - min);
  if (family.terrains.length === 1) return [{ terrain: family.terrains[0], share: total }];

  // 家族内挑几个：越靠前的越常见（第一个必取，第二个 45%）
  const picked: TerrainKind[] = [family.terrains[0]];
  if (family.terrains.length > 1 && rng() < 0.45) {
    const rest = family.terrains.slice(1);
    picked.push(rest[Math.floor(rng() * rest.length)]);
  }
  if (picked.length === 1) return [{ terrain: picked[0], share: total }];
  const first = 0.55 + rng() * 0.15;
  return [
    { terrain: picked[0], share: total * first },
    { terrain: picked[1], share: total * (1 - first) },
  ];
}

/**
 * 用 seed 抽一张随机配方（**同 seed 同结果**）。
 *
 * 抽完把份额归一化：家族的区间是"意图"，归一才是"配比"——
 * 选了湿泽/荒漠/寒地的图，其余家族按比例收窄，总数仍是 1。
 */
export function randomRecipe(seed: number): MapRecipe {
  const rng = mulberry32((seed ^ 0x2545f491) >>> 0);
  const mix: { terrain: TerrainKind; share: number }[] = [];

  for (const family of MIX_FAMILIES) {
    const chance = family.chance ?? 1;
    if (chance < 1 && rng() > chance) continue;
    mix.push(...splitFamily(family, rng));
  }

  const sum = mix.reduce((acc, m) => acc + m.share, 0) || 1;
  const normalized = mix.map((m) => ({ terrain: m.terrain, share: m.share / sum }));

  const climate =
    rng() < CLIMATE_LOCK_CHANCE
      ? LOCKABLE_CLIMATES[Math.floor(rng() * LOCKABLE_CLIMATES.length)]
      : undefined;

  return {
    id: `rnd-${seed >>> 0}`,
    label: "随机",
    terrainMix: normalized,
    ...(climate ? { climate } : {}),
  };
}

/**
 * 形状档 → 实际形状（`RANDOM_CHOICE` 时按 seed 抽一种）。
 *
 * 【为什么抽签也要吃 seed】一键成图的每种产物都必须可复现（同 seed 同图）；
 * 用 `Math.random()` 抽形状会让"同一张图"在重绘时换形状。
 */
export function resolveShapeId(choice: string | undefined, seed: number): LandShapeId {
  if (!choice || choice !== RANDOM_CHOICE) {
    return (choice as LandShapeId | undefined) ?? LAND_SHAPES[0].id;
  }
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  return LAND_SHAPES[Math.floor(rng() * LAND_SHAPES.length)].id;
}

/** 底色档 → 实际底色 id（`RANDOM_CHOICE` 时按 seed 抽一种） */
export function resolveLandColorId(choice: string | undefined, seed: number): string {
  if (!choice || choice !== RANDOM_CHOICE) {
    return choice ?? LAND_BASE_COLORS[0].id;
  }
  const rng = mulberry32((seed ^ 0x85ebca6b) >>> 0);
  return LAND_BASE_COLORS[Math.floor(rng() * LAND_BASE_COLORS.length)].id;
}

/**
 * 按配方配比展开成「地形请求序列」（B3 生成算法的输入形状）：
 * share × total 取整分配（最大余数法保证合计恰为 total）。
 * 配方只回答铺什么，此函数也只做配比 → 数量的纯换算，不碰画布。
 */
export function expandTerrainMix(
  recipe: MapRecipe,
  total: number,
): { terrain: TerrainKind; count: number }[] {
  const raw = recipe.terrainMix.map((m) => ({
    terrain: m.terrain,
    exact: m.share * total,
    count: Math.floor(m.share * total),
  }));
  let assigned = raw.reduce((sum, m) => sum + m.count, 0);
  // 最大余数法：把余数个名额按小数部分从大到小补齐
  const order = [...raw].sort((a, b) => (b.exact - b.count) - (a.exact - a.count));
  let cursor = 0;
  while (assigned < total) {
    order[cursor % order.length].count += 1;
    assigned += 1;
    cursor += 1;
  }
  return raw.map((m) => ({ terrain: m.terrain, count: m.count })).filter((m) => m.count > 0);
}
