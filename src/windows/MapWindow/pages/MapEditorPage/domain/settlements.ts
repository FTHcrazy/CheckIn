/**
 * 聚落选址（2.45.0，ALGN-7「聚落成网」）
 *
 * 【为什么要单独一层，而不是继续让 `settlement` 参与区域生长】
 * 2.44.0 之前 `settlement` 是一个**地形配方**：区域生长认领若干格，每格再抽 1~2 张
 * 城郭素材撒下去。结果是"城"均匀地撒在整张图上 —— 没有中心、没有层级、彼此
 * 不相连，读者看到的是一堆孤立的小房子。参考成图里的聚落是**一张网**：
 * 沿海/沿河几座大城 → 周边城镇 → 更外圈村落，点和点之间由道路串起来。
 * 网络不是"密度"能长出来的，必须有选址（谁在哪）+ 连边（谁连谁）两步。
 *
 * 本模块只做**选址**（连边见 `./roads`）：
 *   · 大城：海岸线附近 + 沿河 + 地势平坦 —— 与真实聚落逐水而居同构；
 *   · 城镇：离大城 2~6 格，太近抢腹地、太远没有补给；
 *   · 村落：贴着已有聚落（3 格内）外扩，这才读得出"这张网有中心"。
 *
 * 纯函数：无 IO、无 React、无 PIXI。同 seed + 同参数 = 同选址。
 */

import type { TerrainKind } from "./terrain";
import { seaDistance, type WaterCell } from "./water";

/** 格信息（`generator.ts` 的 `Cell` 结构相容，无需导入私有类型） */
export type SettlementCell = WaterCell;

/** 聚落层级（决定选材、体量与连边优先级） */
export type SettlementTier = "city" | "town" | "village";

/** 一个聚落选址 */
export interface SettlementSite {
  tier: SettlementTier;
  /** 世界坐标（格心） */
  x: number;
  y: number;
  col: number;
  row: number;
}

export interface SettlementPlanOptions {
  cols: number;
  rows: number;
  /** 想放几座大城 / 几座城镇 / 几个村落（实际可能更少：陆地太小或水太多） */
  cities: number;
  towns: number;
  villages: number;
  rng: () => number;
  /** 被河湖占住的格索引（`row * cols + col`）：聚落不落水面上 */
  waterCells?: ReadonlySet<number>;
  /**
   * 「这个点还在陆地上吗」——**格心抖动**的守门员。
   *
   * 缺省不抖（格心坐标），给测试与「只换陆地」档留一条确定的老路径；
   * 生成器会传 `pointInLand`，把一个点挪到格心附近仍然安全的位置。
   */
  inside?: (point: { x: number; y: number }) => boolean;
}

/**
 * 层级 → 候选素材 id（**按优先级**；缺哪个就往下用）。
 *
 * 【为什么写死 id 而不是"按地形抽"】聚落的层级是**语义**：大城就是大城，不能
 * 因为池子里 `village-hut` 排在前面就把首都画成茅屋。这里给出优先级链，
 * 由生成器在真实素材池里挑存在的那一档。
 */
export const SETTLEMENT_SPRITES: Record<SettlementTier, readonly string[]> = {
  city: ["city-major", "citadel", "city-mid"],
  town: ["city-mid", "village-a", "military-camp"],
  village: ["village-a", "village-b", "village-hut"],
};

/**
 * spriteId → 层级（`null` = 不是聚落）。
 *
 * 「只换陆地」档要用它从现有素材实例里还原聚落坐标去重画道路 ——
 * 那时没有布点过程的中间态，只有文档里的 spriteId。
 */
export function settlementTierOf(spriteId: string): SettlementTier | null {
  for (const tier of ["city", "town", "village"] as const) {
    if (SETTLEMENT_SPRITES[tier].includes(spriteId)) return tier;
  }
  return null;
}

/**
 * 地形适居度：平坦开阔地最宜居，山脊与雪线没人建城。
 * `null`（没被任何配方认领的空地）= 平原。
 */
const TERRAIN_COMFORT: Record<TerrainKind, number> = {
  plain: 1.2,
  grassland: 1.2,
  valley: 1.1,
  oasis: 1.0,
  desert: 0.5,
  hill: 0.7,
  forest: 0.5,
  jungle: 0.2,
  swamp: 0.15,
  tundra: 0.25,
  snowfield: 0.2,
  coast: 1.0,
  sea: 0,
  river: 0,
  lake: 0,
  landmark: 0.9,
  settlement: 0.9,
  mountain: -0.5,
  highland: -0.4,
  volcano: -0.8,
};

/** 8 邻域 BFS 距离场（格，起点为 0） */
function distanceField(
  seeds: readonly number[],
  cols: number,
  rows: number,
): number[] {
  const dist = new Array<number>(cols * rows).fill(Number.POSITIVE_INFINITY);
  const queue: number[] = [];
  for (const s of seeds) {
    dist[s] = 0;
    queue.push(s);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    const col = cur % cols;
    const row = Math.floor(cur / cols);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dc === 0 && dr === 0) continue;
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const j = r * cols + c;
        if (dist[j] <= dist[cur] + 1) continue;
        dist[j] = dist[cur] + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

/** 可建聚落的格：陆地、非水面 */
function candidateMask(cells: readonly SettlementCell[], water: ReadonlySet<number>): boolean[] {
  return cells.map((cell, i) => cell.land && !water.has(i));
}

/** 确定性哈希（0~1）：抖动量不掷骰子，重绘之间同一座城不能跳位置 */
function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/**
 * 落点偏离格心的幅度（格）。
 *
 * 【为什么要抖】格网是**布点脚手架**，不是地图上的坐标：所有聚落精确坐在
 * cellSize 的整数倍上，连出来的路由一堆 45°/90° 的短线组成，读起来像"几何多边形
 * 边框"而不是路网。抖开 1/3 格之后，聚落间距不再处处相等，路也跟着变得随手。
 * 幅度取 0.34 格：再大就可能跨到相邻格引起两个聚落贴脸（间距判定按格算）。
 */
const SITE_JITTER_CELL = 0.34;

/** 邻格里有几条水系（河流/湖泊格或水面格）——"逐水而居" */
function waterNeighborsOf(
  cells: readonly SettlementCell[],
  cols: number,
  rows: number,
  water: ReadonlySet<number>,
  index: number,
): number {
  const col = index % cols;
  const row = Math.floor(index / cols);
  let n = 0;
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dc === 0 && dr === 0) continue;
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const j = r * cols + c;
      if (water.has(j) || cells[j].terrain === "river" || cells[j].terrain === "lake") n += 1;
    }
  }
  return n;
}

/**
 * 按分数降序贪心落点，并保证与**已落所有聚落**的最小曼哈顿间距。
 *
 * 【为什么是"全局间距"而不是"同层间距"】村落贴着城镇是想要的（成网），
 * 但不能压在同一格上：间距 1 表示"可以紧邻、不能同一格"。
 */
function pickSites(
  scores: readonly number[],
  candidates: readonly boolean[],
  count: number,
  gap: number,
  cols: number,
  placed: { col: number; row: number }[],
): number[] {
  if (count <= 0) return [];
  const ranked = scores
    .map((score, index) => ({ index, score }))
    .filter(({ index, score }) => candidates[index] && Number.isFinite(score))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const out: number[] = [];
  for (const { index } of ranked) {
    if (out.length >= count) break;
    const col = index % cols;
    const row = Math.floor(index / cols);
    let ok = true;
    for (const p of placed) {
      if (Math.abs(p.col - col) + Math.abs(p.row - row) < gap) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    out.push(index);
    placed.push({ col, row });
  }
  return out;
}

/**
 * 规划一整张图的聚落网。
 *
 * 返回顺序 = 层级从高到低（大城 → 城镇 → 村落）；调用方按它落素材即可
 * 得到"城压村"的 z 序（同层再按 y）。
 */
export function planSettlements(
  cells: readonly SettlementCell[],
  options: SettlementPlanOptions,
): SettlementSite[] {
  const { cols, rows, rng } = options;
  const water = options.waterCells ?? new Set<number>();
  if (cells.length !== cols * rows) return [];

  const seaDist = seaDistance(cells, cols, rows);
  const candidates = candidateMask(cells, water);
  const comfort = cells.map((cell) =>
    cell.terrain === null ? TERRAIN_COMFORT.plain : TERRAIN_COMFORT[cell.terrain],
  );
  const waterNb = cells.map((_, i) => waterNeighborsOf(cells, cols, rows, water, i));

  // 一张图一个骰子序列：先给每格摇一次噪声，后续选点不再掷 —— 分数只与 seed 有关
  const noise = cells.map(() => rng());

  // ── 大城：沿海 + 沿河 + 平坦 ──
  const cityScore = cells.map((_, i) => {
    const sd = seaDist[i];
    const coast = sd === 1 ? 1.7 : sd === 2 ? 1.0 : sd === 3 ? 0.4 : 0;
    return comfort[i] + coast + Math.min(waterNb[i], 3) * 0.5 + noise[i] * 0.9;
  });
  const cityGap = Math.max(3, Math.round(Math.min(cols, rows) * 0.16));
  const placed: { col: number; row: number }[] = [];
  const cityIdx = pickSites(cityScore, candidates, options.cities, cityGap, cols, placed);

  // ── 城镇：离大城 2~6 格（太近抢腹地，太远没补给）──
  const cityDist = distanceField(cityIdx, cols, rows);
  const townScore = cells.map((_, i) => {
    const d = cityDist[i];
    const near = d >= 2 && d <= 6 ? 1.5 : d > 12 ? -1.2 : d < 2 ? -1.6 : 0;
    return comfort[i] + near + Math.min(waterNb[i], 3) * 0.35 + noise[i] * 0.7;
  });
  const townGap = Math.max(2, Math.round(cityGap * 0.45));
  const townIdx = pickSites(townScore, candidates, options.towns, townGap, cols, placed);

  // ── 村落：一半贴着已有聚落往外扩，一半按**最远点**铺满空地 ──
  //
  // 【为什么要分两批】只按"离聚落近"加分，村落会全挤在第一座城周围，
  // 另一块陆地（尤其离得远的大岛）一个点都没有 —— 成图上就是"半张空白纸"。
  // 后一半走**最远点采样**（farthest-point sampling，蓝噪声的廉价近似）：
  // 每次挑"离已有点最远"的候选，自然把剩余的村落摊到没人占的区域。
  const siteDist = distanceField([...cityIdx, ...townIdx], cols, rows);
  const villageScore = cells.map((_, i) => {
    const d = siteDist[i];
    const near = d <= 3 ? 1.1 : d <= 6 ? 0.3 : -0.5;
    return comfort[i] * 0.8 + near + noise[i] * 0.8;
  });
  const nearVillages = Math.ceil(options.villages * VILLAGE_NEAR_RATIO);
  const villageIdx = [
    ...pickSites(villageScore, candidates, nearVillages, 1, cols, placed),
    ...pickSpreadSites(candidates, options.villages - nearVillages, placed, cols),
  ];

  const toSite = (index: number, tier: SettlementTier): SettlementSite => {
    const cell = cells[index];
    const p = jitteredPoint(cell, cells, cols, options.inside);
    return { tier, x: p.x, y: p.y, col: cell.col, row: cell.row };
  };

  return [
    ...cityIdx.map((i) => toSite(i, "city")),
    ...townIdx.map((i) => toSite(i, "town")),
    ...villageIdx.map((i) => toSite(i, "village")),
  ];
}

/**
 * 格心 → 落点（确定性抖动），并且**必须仍在陆地上**。
 *
 * 格距从 `cells` 的前两个相邻格推出来（调用方不必再传一份 cellSize ——
 * 生成器的格网与这里的格网必须是同一份，多传一个数就多一处不同步的机会）。
 * 抖动后被判到岸外就减半重试，再不行退回格心：宁可精确但"格子味"，也不落海。
 */
function jitteredPoint(
  cell: SettlementCell,
  cells: readonly SettlementCell[],
  cols: number,
  inside?: (point: { x: number; y: number }) => boolean,
): { x: number; y: number } {
  const center = { x: cell.x, y: cell.y };
  if (!inside || cells.length < 2) return center;
  const cellW = Math.abs(cells[cols > 1 ? 1 : 0].x - cells[0].x) || 0;
  const cellH = Math.abs(cells[cols < cells.length ? cols : 0].y - cells[0].y) || cellW;
  const dx = (hash01(cell.col, cell.row) - 0.5) * 2 * SITE_JITTER_CELL * cellW;
  const dy = (hash01(cell.row + 977, cell.col + 313) - 0.5) * 2 * SITE_JITTER_CELL * cellH;
  for (const k of [1, 0.5]) {
    const p = { x: center.x + dx * k, y: center.y + dy * k };
    if (inside(p)) return p;
  }
  return center;
}

/** 村落里"贴着城镇"的比例，其余按最远点铺满空地 */
const VILLAGE_NEAR_RATIO = 0.55;

/**
 * 最远点采样：每次挑"离已落聚落最远"的候选格。
 *
 * 用途是**补空白**：只靠"离聚落近"的加分，村落会全挤在第一座城周围，
 * 离得远的岛屿一个点都没有。最远点采样（farthest-point sampling）是蓝噪声
 * 的廉价近似 —— 复杂度 O(补点 × 候选)，几百格的点云完全够用。
 */
function pickSpreadSites(
  candidates: readonly boolean[],
  count: number,
  placed: { col: number; row: number }[],
  cols: number,
): number[] {
  if (count <= 0) return [];
  const dist = new Float64Array(candidates.length).fill(Number.POSITIVE_INFINITY);
  const seeded = [...placed];
  const updateDist = (col: number, row: number) => {
    for (let i = 0; i < candidates.length; i += 1) {
      if (!candidates[i]) continue;
      const d = Math.abs((i % cols) - col) + Math.abs(Math.floor(i / cols) - row);
      if (d < dist[i]) dist[i] = d;
    }
  };
  for (const p of seeded) updateDist(p.col, p.row);

  const out: number[] = [];
  for (let k = 0; k < count; k += 1) {
    let best = -1;
    let bestDist = -1;
    for (let i = 0; i < candidates.length; i += 1) {
      if (!candidates[i] || dist[i] < 1) continue;
      if (dist[i] > bestDist) {
        bestDist = dist[i];
        best = i;
      }
    }
    if (best < 0) break;
    const col = best % cols;
    const row = Math.floor(best / cols);
    out.push(best);
    placed.push({ col, row });
    updateDist(col, row);
  }
  return out;
}

/**
 * 聚落份额（格）→ 各层个数。
 *
 * 【换算口径】参考实现的城镇是"按格网邻接打分挑城 + 每格一村"的密度量级；
 * 本项目的 `settlement` 份额只有 3%~7%（标准档约 4~8 格 —— 格网 54，纸 1024，
 * 陆地 ~150 格，乘 `1 - PLAIN_CELL_RATIO` 后 `share` 落到 4~8）。
 *
 * 【2.46.0 调系数】旧系数（城 0.28 / 镇 1.4 / 村 8）在 `share = 4` 时算出
 * **1 座大城** —— 成图上只有一座主城，其余全是镇和村，读不出参考那种
 * "几座主城 + 一圈卫星镇"的结构，大字号的城名也没地方落。改为城 ≈ 0.9/格
 * （share 4 → 4 座、share 8 → 5 座封顶），镇 ≈ 1.8/格，村 ≈ 7/格：
 * 一张标准图约 4 座大城 / 7~14 座城镇 / 28~56 个村落。
 *
 * 【为什么村落给到 7 倍份额】村落是**体量最小的点符号**（渲染宽 ≈ 6 世界单位），
 * 稀疏了根本看不出"网"：城与城之间一条长线，中间什么都没有。
 */
export function settlementCountsOf(share: number): {
  cities: number;
  towns: number;
  villages: number;
} {
  if (share <= 0) return { cities: 0, towns: 0, villages: 0 };
  const cities = Math.min(5, Math.max(2, Math.round(share * 0.9)));
  const towns = Math.min(14, Math.max(4, Math.round(share * 1.8)));
  const villages = Math.min(100, Math.max(12, Math.round(share * 7)));
  return { cities, towns, villages };
}
