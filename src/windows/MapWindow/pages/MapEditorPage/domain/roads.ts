/**
 * 道路网（2.45.0，ALGN-7「道路点线」）
 *
 * 【为什么要"连边"，而不是"撒线"】参考成图的路是**沿聚落走的**：两座城之间一条
 * 官道、城到最近的镇一条土路、镇到周边村落是点线。随手撒的线没有端点，读者
 * 一眼看出"这些线没有去处"。所以道路的输入必须是聚落坐标（`./settlements`），
 * 输出是折线要素（`MapPolyline`，`origin: "generated"`）。
 *
 * ── 两段式：先选边，再寻路 ──
 * ① **选边**：`MAX_ROAD_CELLS` 以内的邻点连成局部网（上游优先 + 夹角去重 +
 *    度数上限），城与城之间走完全图官道；**度数为 0** 的孤立聚落再补一条通往
 *    最近聚落的路（`NEAREST_LINK_CELLS`）—— 这是成熟的路线网生成做法
 *    （Azgaar 的 burgs + routes、Wonderdraft 的 path 工具同理：先定拓扑，
 *    再定几何）。不用最小生成树：它为了"全图连通"会在稀疏处画出横贯大陆的
 *    长线，四张图看下来是一张蜘蛛网。
 * ② **寻路**：在两两之间跑**带地形代价的 A\\***（8 邻域、对角 √2、山口/沼泽
 *    加价、湖海不可通行）。直连的"斜拉线"会横穿山脊与湖泊，而 A* 会自然
 *    绕到隘口与河谷 —— 这一步正是"逆向目标"的格网路径思路（它的河也是格网
 *    BFS），也是同类工具一致的做法。
 *
 * 几何收尾：A* 出来的格路径是锯齿状的，先按**通视**抽稀（能一眼看穿的两点之间
 * 不保留中间点），再 Chaikin 切角，最后给每一段叠一个**低频鼓包**（段内半波
 * 正弦、两端为 0）。端点是精确的聚落坐标：路必须接在点上，不能停在旁边一格。
 *
 * 纯函数：无 IO、无 React、无 PIXI。import 白名单：`../land`（岸内判定 +
 * 陆地包围盒）、`../types`、`./terrain`（地形代价）、`./settlements`（层级）。
 */

import { landBBoxOf, pointInLand } from "../land";
import type { MapLand, MapPolyline, Point, Rect } from "../types";
import { type TerrainKind } from "./terrain";
import type { SettlementTier } from "./settlements";

/** 道路的一个端点（聚落） */
export interface RoadNode {
  /** 格坐标（A* 的起点/终点） */
  col: number;
  row: number;
  /** 世界坐标（端点精确落在聚落上） */
  x: number;
  y: number;
  tier: SettlementTier;
}

/** 道路寻路用的格网（与 `generator` 的布点格网同一口径） */
export interface RoadGrid {
  cols: number;
  rows: number;
  cellSize: number;
  /** 格网原点（= 布点格网的 box.x / box.y） */
  x: number;
  y: number;
  /** 每格通行代价；`Infinity` = 不可通行（海 / 湖）。长度 = cols × rows */
  cost: readonly number[];
}

export interface RoadNetOptions {
  grid: RoadGrid;
  /** 每点最多连几条边（缺省 3：一条主路 + 两条支线） */
  maxDegree?: number;
  /** 横向偏移的相位种子（缺省按端点坐标算 → 同一条路每次画得一样） */
  seed?: number;
}

/**
 * 地形 → 通行代价（相对平原的倍数）。
 *
 * 数值口径对齐同类工具（Azgaar 的 `biomeCost`、Wonderdraft 的 path 代价）：
 * 平原 1 为基准，丘陵/林地不到 2 倍（能走，只是慢），沼泽 3.4（绕），
 * 山地 6.5（只有隘口值得过），火山 9（没人修路）。**湖与海 = 不可通行**：
 * 河上可以有桥（4.5，一次跨过去比绕远便宜），湖上修路是画错。
 */
const TERRAIN_ROAD_COST: Record<TerrainKind, number> = {
  plain: 1,
  grassland: 1,
  valley: 1.1,
  desert: 1.15,
  oasis: 1,
  settlement: 1,
  landmark: 1,
  coast: 1.2,
  hill: 1.7,
  forest: 1.9,
  jungle: 2.6,
  tundra: 2.2,
  snowfield: 2.8,
  swamp: 3.4,
  highland: 5.5,
  mountain: 6.5,
  volcano: 9,
  river: 4.5,
  lake: Number.POSITIVE_INFINITY,
  sea: Number.POSITIVE_INFINITY,
};

/** 未被任何配方认领的格（= 平原）的代价 */
const BARE_CELL_COST = 1;

/** 对角步的代价倍率 */
const DIAGONAL_COST = Math.SQRT2;

/**
 * 由布点格的地形算通行代价表。
 *
 * @param terrains 每格地形（`null` = 空地/平原），长度 = cols × rows
 */
export function roadCostOfCells(
  terrains: readonly (TerrainKind | null)[],
): number[] {
  return terrains.map((t) => (t === null ? BARE_CELL_COST : TERRAIN_ROAD_COST[t]));
}

/**
 * 只按陆地算通行代价（「只换陆地」档用：那时没有地形分层）。
 *
 * 陆地 = 1，海 = 不可通行。路仍然会绕开海湾，只是不再区分山与平原 ——
 * 对"一块刚换掉的陆地"来说，这个代价模型已经够用（旧路本来也全废了）。
 */
export function roadGridOfLand(land: MapLand, cellSize: number): RoadGrid {
  const box: Rect = landBBoxOf(land);
  const cols = Math.max(1, Math.ceil(box.width / cellSize));
  const rows = Math.max(1, Math.ceil(box.height / cellSize));
  const cost: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = box.x + (col + 0.5) * cellSize;
      const y = box.y + (row + 0.5) * cellSize;
      cost.push(pointInLand({ x, y }, land) ? BARE_CELL_COST : Number.POSITIVE_INFINITY);
    }
  }
  return { cols, rows, cellSize, x: box.x, y: box.y, cost };
}

/** 确定性哈希（0~1）：同一条路的摆幅在重绘之间必须一致 */
function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** 层级优先级（数字小的先连：主干先占走廊） */
const TIER_RANK: Record<SettlementTier, number> = { city: 0, town: 1, village: 2 };

/** 一条边（无向，`a < b` 归一） */
interface Edge {
  a: number;
  b: number;
  length: number;
}

/* ─────────────────── 选边 ─────────────────── */

/**
 * 单条路的**最大长度**（格）：超过这个距离就不连。
 *
 * 【为什么需要上限】只用最小生成树保证"全图连通"，会在聚落稀疏处画出横贯
 * 半个大陆的长线 —— 四张图看下来是一张"蜘蛛网"。真实路网是**局部的**：
 * 相邻的村镇之间才有路，远处的聚落各自成网（甚至没有路）。所以这里只连
 * `MAX_ROAD_CELLS` 格以内的邻点，**连不上就不连**。
 */
const MAX_ROAD_CELLS = 4;

/**
 * 孤立聚落补边时的**长度上限**（格）。
 *
 * 局部连边够不着时，每个孤立点仍然要有一条通往最近聚落的路 —— 否则"半张纸上
 * 有房子却没有路"。上限比局部值宽得多（14 格）只是为了掐掉「隔着半个大陆的
 * 两个点连一条线」这种荒唐情况；海上的长线由 A\* 自己判死（代价 `Infinity`）。
 */
const NEAREST_LINK_CELLS = 14;

/** 一个点最多主动连几条（度数是"汇聚"的观感：一进两出） */
const EDGES_PER_NODE = 2;

/** 两段方向的夹角小于它就算"同一条走廊"，只留短的（度） */
const MIN_ANGLE_DEG = 28;

/** 两条边在公共端点处的夹角（度） */
function angleBetweenDeg(ax: number, ay: number, bx: number, by: number): number {
  const la = Math.hypot(ax, ay) || 1;
  const lb = Math.hypot(bx, by) || 1;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * 局部连边：每个聚落连它最近的 1~2 个邻居（**上游优先**），并做夹角去重。
 *
 * 三条规则各治一种病：
 *   ① **距离上限** `MAX_ROAD_CELLS`：不画横贯大陆的长线（蜘蛛网）；
 *   ② **上游优先**：村落连集镇、集镇连城市 —— 物资是往上汇聚的，
 *      村与村两两相连会长出一片"街区"；
 *   ③ **夹角去重**：同一个点上两条方向相近的路只留短的那条，否则城镇密集处
 *      会糊成一束几乎重合的线。
 */
function localEdges(
  nodes: readonly RoadNode[],
  cellSize: number,
  maxDegree: number,
): Edge[] {
  const maxLen = cellSize * MAX_ROAD_CELLS;
  const out: Edge[] = [];
  const keys = new Set<string>();
  const degree = new Array<number>(nodes.length).fill(0);
  /** 每个点已接受的方向（单位向量）—— 夹角去重要用 */
  const dirs: { x: number; y: number }[][] = nodes.map(() => []);

  const order = nodes
    .map((n, i) => ({ n, i }))
    .sort((p, q) => TIER_RANK[p.n.tier] - TIER_RANK[q.n.tier] || p.i - q.i);

  for (const { n, i } of order) {
    if (degree[i] >= maxDegree) continue;
    const around = nodes
      .map((m, j) => ({ j, length: Math.hypot(m.x - n.x, m.y - n.y) }))
      .filter(({ j, length }) => j !== i && length > 0 && length <= maxLen)
      .sort((p, q) => p.length - q.length);
    if (around.length === 0) continue;
    const upstream = around.filter(({ j }) => TIER_RANK[nodes[j].tier] < TIER_RANK[n.tier]);
    const sameTier = around.filter(({ j }) => TIER_RANK[nodes[j].tier] === TIER_RANK[n.tier]);
    const pool = upstream.length > 0 ? [...upstream, ...sameTier] : around;

    let added = 0;
    for (const { j, length } of pool) {
      if (degree[i] >= maxDegree || added >= EDGES_PER_NODE) break;
      if (degree[j] >= maxDegree) continue;
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
      if (keys.has(key)) continue;
      const dx = nodes[j].x - n.x;
      const dy = nodes[j].y - n.y;
      if (dirs[i].some((d) => angleBetweenDeg(d.x, d.y, dx, dy) < MIN_ANGLE_DEG)) continue;

      keys.add(key);
      degree[i] += 1;
      degree[j] += 1;
      added += 1;
      const len = length || 1;
      dirs[i].push({ x: dx / len, y: dy / len });
      dirs[j].push({ x: -dx / len, y: -dy / len });
      out.push({ a: Math.min(i, j), b: Math.max(i, j), length });
    }
  }

  /**
   * ── 补空：一个邻居都没够着的聚落，连它**最近的那个点** ──
   *
   * 【为什么不能只靠上面那轮】局部连边有 `MAX_ROAD_CELLS` 上限，稀疏处的村落
   * 一格邻居都够不着，成图上就是"半张纸上有房子却没路"。成熟工具（Azgaar 的
   * routes）也是"每个 burg 连最近邻"，上限只用来掐掉跨海的荒唐长线。
   * 实测这一步是**兜底**而不是主力：端点坐标对齐之后，六个 seed 里只剩 0~2 个
   * 聚落落在 4 格上限之外。
   *
   * 这里只补**度数为 0** 的点：已经在簇里的拓扑一条都不动，所以不会长回蜘蛛网。
   */
  for (const { n, i } of order) {
    if (degree[i] > 0) continue;
    const nearest = nodes
      .map((m, j) => ({ j, length: Math.hypot(m.x - n.x, m.y - n.y) }))
      .filter(({ j, length }) => j !== i && length > 0 && length <= cellSize * NEAREST_LINK_CELLS)
      .sort((p, q) => p.length - q.length)[0];
    if (!nearest) continue;
    const key = `${Math.min(i, nearest.j)}-${Math.max(i, nearest.j)}`;
    if (keys.has(key)) continue;
    keys.add(key);
    degree[i] += 1;
    degree[nearest.j] += 1;
    out.push({ a: Math.min(i, nearest.j), b: Math.max(i, nearest.j), length: nearest.length });
  }
  return out;
}

/**
 * 城与城之间的主干（它们之间必然有官道，哪怕距离超过局部的上限）。
 *
 * 只在城市数量很少（1~5 座）时用**完全图** —— 城与城两两相连，读作"官道网"；
 * 超过 5 座就退化成局部连边（否则边的数量是平方级）。
 */
function cityTrunk(nodes: readonly RoadNode[], cellSize: number): Edge[] {
  const cities = nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.tier === "city");
  if (cities.length < 2 || cities.length > 5) return [];
  const out: Edge[] = [];
  for (let p = 0; p < cities.length; p += 1) {
    for (let q = p + 1; q < cities.length; q += 1) {
      const a = nodes[cities[p].i];
      const b = nodes[cities[q].i];
      const length = Math.hypot(a.x - b.x, a.y - b.y);
      // 官道也有上限：两座隔着半张图的城不画路（中间没有补给的直线不是官道）
      if (length > cellSize * MAX_ROAD_CELLS * 2) continue;
      out.push({ a: cities[p].i, b: cities[q].i, length });
    }
  }
  return out;
}

/* ─────────────────── A* 寻路 ─────────────────── */

/** 极简二叉堆（A* 的 open 集；格网只有几百格，数组堆足够） */
class OpenHeap {
  private readonly items: number[] = [];
  private readonly prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.prio.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop() as number;
    const lastPrio = this.prio.pop() as number;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.prio[l] < this.prio[smallest]) smallest = l;
        if (r < this.items.length && this.prio[r] < this.prio[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(smallest, i);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}

/**
 * 带地形代价的 A*（8 邻域）。
 *
 * @returns 格索引序列（含首尾）；不可达 ⇒ `null`
 *
 * 【代价口径】进入某格的代价 = 该格代价 × 步长倍率（对角 √2）——
 * 与移动代价的经典定义一致，保证"绕远但平坦"能赢过"直穿山脊"。
 */
function findPath(grid: RoadGrid, from: number, to: number): number[] | null {
  const { cols, rows, cost } = grid;
  if (from === to) return [from];
  if (!Number.isFinite(cost[from]) || !Number.isFinite(cost[to])) return null;

  const total = cols * rows;
  const gScore = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const heap = new OpenHeap();

  const toCol = to % cols;
  const toRow = Math.floor(to / cols);
  /** 欧氏距离是"每格至少 1 代价"下的可采纳启发 */
  const heuristic = (index: number): number => {
    const dc = (index % cols) - toCol;
    const dr = Math.floor(index / cols) - toRow;
    return Math.hypot(dc, dr);
  };

  gScore[from] = 0;
  heap.push(from, heuristic(from));
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === to) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const col = cur % cols;
    const row = Math.floor(cur / cols);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dc === 0 && dr === 0) continue;
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const next = r * cols + c;
        if (!Number.isFinite(cost[next])) continue;
        const step = (cost[cur] + cost[next]) / 2 * (dc !== 0 && dr !== 0 ? DIAGONAL_COST : 1);
        const tentative = gScore[cur] + step;
        if (tentative >= gScore[next]) continue;
        gScore[next] = tentative;
        cameFrom[next] = cur;
        heap.push(next, tentative + heuristic(next));
      }
    }
  }

  if (cameFrom[to] < 0) return null;
  const path: number[] = [to];
  let cur = to;
  while (cur !== from) {
    cur = cameFrom[cur];
    if (cur < 0) return null;
    path.push(cur);
  }
  return path.reverse();
}

/** 两点之间是否有通视（沿途采样都必须可通行） */
function hasLineOfSight(
  grid: RoadGrid,
  aCol: number,
  aRow: number,
  bCol: number,
  bRow: number,
): boolean {
  const { cols, rows, cost } = grid;
  const steps = Math.max(Math.abs(bCol - aCol), Math.abs(bRow - aRow)) * 2;
  if (steps === 0) return true;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const col = Math.round(aCol + (bCol - aCol) * t);
    const row = Math.round(aRow + (bRow - aRow) * t);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
    if (!Number.isFinite(cost[row * cols + col])) return false;
  }
  return true;
}

/** 格路径 → 抽稀后的格坐标（通视抽稀 + 端点保留） */
function simplifyPath(
  path: readonly number[],
  grid: RoadGrid,
): { col: number; row: number }[] {
  const cells = path.map((index) => ({ col: index % grid.cols, row: Math.floor(index / grid.cols) }));
  if (cells.length <= 2) return cells;
  const out = [cells[0]];
  let anchor = 0;
  for (let i = 2; i < cells.length; i += 1) {
    const a = cells[anchor];
    const b = cells[i];
    if (!hasLineOfSight(grid, a.col, a.row, b.col, b.row)) {
      out.push(cells[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(cells[cells.length - 1]);
  return out;
}

/**
 * 格路径 → 世界坐标折线。
 *
 * 【为什么还要再细分】通视抽稀留下的是一段段长直线：A* 只保证"能走过去"，
 * 不保证"像人手画的"。这里把每段按 ~1.2 格切成小段，再叠一层沿线的低频横向
 * 偏移（两端为 0，保证接得上聚落）—— 渲染层的 Catmull-Rom 会把这一串点
 * 平滑成缓弯，而不是几条折线。
 *
 * 偏移落到不可通行格上时**退回直线**（宁可这一段是直的，也不要路插进湖里）。
 */
function toPoints(
  cells: readonly { col: number; row: number }[],
  grid: RoadGrid,
  start: RoadNode,
  end: RoadNode,
  phase: number,
): Point[] {
  const cellCenter = (col: number, row: number): Point => ({
    x: grid.x + (col + 0.5) * grid.cellSize,
    y: grid.y + (row + 0.5) * grid.cellSize,
  });
  const passable = (p: Point): boolean => {
    const c = Math.floor((p.x - grid.x) / grid.cellSize);
    const r = Math.floor((p.y - grid.y) / grid.cellSize);
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
    return Number.isFinite(grid.cost[r * grid.cols + c]);
  };

  /** 抽稀后的锚点：端点用真实聚落坐标，中间用格心 */
  const raw: Point[] = cells.map((c, i) => {
    if (i === 0) return { x: start.x, y: start.y };
    if (i === cells.length - 1) return { x: end.x, y: end.y };
    return cellCenter(c.col, c.row);
  });
  if (raw.length < 2) return raw;
  // 切角：A* 的拐点是 90°/45° 的硬角，Chaikin 一次把它摊成缓弯（端点不动）
  const anchors = chaikin(raw, passable);

  const out: Point[] = [anchors[0]];
  /** 单段最大鼓幅（格）：0.3 格在整图上刚好读得出"弯路"，又不至于扭曲走向 */
  const maxAmp = grid.cellSize * 0.3;
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const steps = Math.max(1, Math.round(len / (grid.cellSize * 0.9)));
    const nx = -dy / len;
    const ny = dx / len;
    /**
     * 每段一个"手绘鼓包"：`sin(π t)` 在两端为 0、中点最大。
     *
     * 【为什么按段而不是按点】旧实现按**子点序号**取相位（`sin(i*2.1)`），
     * 相邻子点的偏移量差了好几倍 —— 平滑完是一串高频锯齿。按段取一个鼓幅、
     * 段内用半波正弦插值，得到的是一条**低频缓弯**，而且端点天然为 0
     * （路必须精确落在聚落上）。鼓幅还与段长挂钩：长段的弯要看得见，
     * 短段（相邻两格之间）只轻轻一偏。
     */
    const bow = (hash01(i * 7919 + 13, Math.round(phase * 1e6)) - 0.5) * 2 * Math.min(maxAmp, len * 0.12);
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      const onLine: Point = { x: a.x + dx * t, y: a.y + dy * t };
      const off = bow * Math.sin(Math.PI * t);
      const bent: Point = { x: onLine.x + nx * off, y: onLine.y + ny * off };
      out.push(passable(bent) ? bent : onLine);
    }
  }
  return out;
}

/**
 * Chaikin 切角（一次迭代，端点保留）。
 *
 * 【为什么不用两次】两次会把锚点数量翻两番，而渲染层本来就有 Catmull-Rom；
 * 这里只需要把"直角"变成"钝角"，多出来的平滑交给渲染。
 * 切出来的点若落到不可通行格上，就退回原锚点（不能为了圆角把路切进湖里）。
 */
function chaikin(points: readonly Point[], passable: (p: Point) => boolean): Point[] {
  if (points.length < 3) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const q: Point = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 };
    const r: Point = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 };
    if (passable(q)) out.push(q);
    if (i === points.length - 2) break;
    if (passable(r)) out.push(r);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * 找到离给定格最近的可通行格（含自身）。
 *
 * 【为什么需要】聚落的格是按"陆地探针"选的（`CELL_PROBE` 允许格心在海上），
 * 而寻路代价用的是严格的岸内判定 —— 少数沿海聚落正好落在这道缝里，
 * A\* 会因为起点不可通行直接返回 `null`，那座城就一条路都没有。
 * 起点挪到相邻的通行格，几何端点仍然是聚落的真实坐标。
 *
 * @returns 格索引；两格以内都不可通行 ⇒ `-1`
 */
function passableCellNear(grid: RoadGrid, index: number): number {
  const { cols, rows, cost } = grid;
  if (index < 0 || index >= cost.length) return -1;
  if (Number.isFinite(cost[index])) return index;
  const col = index % cols;
  const row = Math.floor(index / cols);
  for (let ring = 1; ring <= 2; ring += 1) {
    for (let dr = -ring; dr <= ring; dr += 1) {
      for (let dc = -ring; dc <= ring; dc += 1) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const j = r * cols + c;
        if (Number.isFinite(cost[j])) return j;
      }
    }
  }
  return -1;
}

/**
 * 由聚落坐标生成整张图的道路网。
 *
 * @returns 折线要素（`origin: "generated"`）：城与城之间是官道，其余是点线。
 */
export function buildRoadNet(
  nodes: readonly RoadNode[],
  options: RoadNetOptions,
): MapPolyline[] {
  if (nodes.length < 2) return [];
  const { grid } = options;
  const maxDegree = options.maxDegree ?? 3;
  const seed = options.seed ?? 1;

  const edges = [...cityTrunk(nodes, grid.cellSize), ...localEdges(nodes, grid.cellSize, maxDegree)];

  const out: MapPolyline[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.a}-${edge.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    const fromCell = passableCellNear(grid, a.row * grid.cols + a.col);
    const toCell = passableCellNear(grid, b.row * grid.cols + b.col);
    if (fromCell < 0 || toCell < 0) continue;
    const path = findPath(grid, fromCell, toCell);
    if (!path) continue;

    const phase = hash01(
      Math.round(a.x * 7 + seed) ^ Math.round(a.y * 13),
      Math.round(b.x * 11) ^ Math.round(b.y * 5),
    );
    const points = toPoints(simplifyPath(path, grid), grid, a, b, phase);
    if (points.length < 2) continue;

    const isTrunk = a.tier === "city" && b.tier === "city";
    out.push({
      id: `pl_gen_road_${edge.a}_${edge.b}`,
      kind: "road",
      styleId: isTrunk ? "road-main" : "road-dotted",
      points,
      closed: false,
      level: null,
      origin: "generated",
    });
  }
  return out;
}
