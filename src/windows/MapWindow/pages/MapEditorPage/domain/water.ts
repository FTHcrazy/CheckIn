/**
 * 水系网络（2.44.0，ALGN-6）—— 河流折线 + 湖泊水面 / 等深线环
 *
 * **为什么河流必须是折线而不是素材**：逆向目标（`decoded.js@531827`）的河是
 * `FeatrueTypeEnum.Line` 要素——按格网逐格走出的路径，`size` 随帧数 2→6 递变，
 * 末端 `RiverEndBlock` 收在海岸/已有河道上（`isBranchRiver` 就是"汇流"）。
 * 本项目 2.43.0 之前把 `river` 当成一种**素材配方**撒点，撒出来的是码头、石桥、
 * 芦苇这类"河岸物件"，地图上因此从来没有一条真正的河。本模块把这一层补上：
 * 输出的是可直接进折线层的 `MapPolyline`，与用户手画的河共用同一套渲染与编辑。
 *
 * **湖泊为什么是"外环 + 内环"**：参考成图里的湖是**水面**，不是贴纸 ——
 * 轮廓一圈岸线，内部 2 条同心细环读作浅滩/深水（等深线）。这里用嵌套的
 * 闭合折线表达：外环带填充（`styleId: "lake"`），内环只描边（`"lake-ring"`）。
 * 不引入新的要素类型，因此持久化、命中、图层面板、子图全部自动复用。
 *
 * ── 确定性 ──
 * 全部随机来自注入的 `rng`（生成器给的是**水系独立子流** `waterSeedOf`），
 * 不读时间、不读全局状态；同 seed 同参数 ⇒ 逐点相同。
 *
 * 纯函数：无 IO、无 React、无 PIXI。import 白名单：`../land`（点在内判定）、
 * `../types`（MapPolyline / MapLand / Point）、`./terrain`（TerrainKind）。
 */

import { pointInLand } from "../land";
import { pointInPolygon } from "../regions";
import type { MapLand, MapPolyline, Point } from "../types";
import type { TerrainKind } from "./terrain";

/** 本模块需要的最小格信息（`generator.ts` 的 `Cell` 结构相容，无需导入私有类型） */
export interface WaterCell {
  x: number;
  y: number;
  col: number;
  row: number;
  /** 是否含陆地（含"压着海岸"的格） */
  land: boolean;
  terrain: TerrainKind | null;
}

export interface WaterNetOptions {
  cols: number;
  rows: number;
  cellSize: number;
  /** 想画几条河（受"源头是否够、能否下海"限制，实际可能更少） */
  rivers: number;
  /** 想放几个湖（0 = 不出湖） */
  lakes: number;
  rng: () => number;
  /** 给了就用来裁剪湖泊轮廓（顶点必须全在岸内，否则缩小重试） */
  land?: MapLand;
}

export interface WaterNet {
  polylines: MapPolyline[];
  /** 被水占用的格索引（`row * cols + col`）：布点要避开，否则河里长出一座山 */
  cells: Set<number>;
}

/* ─────────────────── 地势场 ─────────────────── */

/**
 * 地形 → 相对高度（无量纲）。
 *
 * 不是高程图，只是"谁该是河的源头"的排序：山最高、沼泽最低。
 * 数值区间刻意压在 0.2~5.0，让后文的 `seaDist × 0.42` 能与之同量级——
 * 否则内陆平原会因为有 10 格海拔差而永远比沿海山地"更高"，河就往山里流。
 */
const TERRAIN_HEIGHT: Record<TerrainKind, number> = {
  mountain: 5.0,
  volcano: 4.6,
  highland: 4.2,
  hill: 2.6,
  valley: 2.2,
  snowfield: 1.3,
  forest: 1.15,
  jungle: 1.05,
  landmark: 1.0,
  desert: 0.95,
  settlement: 0.85,
  grassland: 0.8,
  plain: 0.75,
  tundra: 0.6,
  oasis: 0.5,
  swamp: 0.35,
  coast: 0.2,
  river: 0.15,
  lake: 0.15,
  sea: 0,
};

/** 海格的地势（比任何陆地都低，保证河一定往下走进海） */
const SEA_HEIGHT = -2;

/** 离岸距离的封顶（格）。超过它的内陆不再更"高"，避免内流盆地全成源头 */
const SEA_DIST_CAP = 16;

/** 地势 → 每格落差基准（格网步长的世界单位倍数由调用方定，这里只管相对） */
function cellHeight(
  terrain: TerrainKind | null,
  seaDist: number,
  noise: number,
): number {
  const base = terrain === null ? TERRAIN_HEIGHT.plain : TERRAIN_HEIGHT[terrain];
  return base * 1.35 + Math.min(seaDist, SEA_DIST_CAP) * 0.42 + noise;
}

/**
 * 离岸距离（8 邻域 BFS，单位 = 格）。
 *
 * 【为什么用 BFS 而不是真实距离】河要的是"哪边靠海"这个单调梯度；欧氏距离在
 * 海湾/半岛处会把河引回湾里，BFS 的等距线更贴海岸走向。
 */
export function seaDistance(cells: readonly WaterCell[], cols: number, rows: number): number[] {
  const dist = new Array<number>(cells.length).fill(Number.POSITIVE_INFINITY);
  const queue: number[] = [];
  for (let i = 0; i < cells.length; i += 1) {
    if (!cells[i].land) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head];
    const col = i % cols;
    const row = Math.floor(i / cols);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dc === 0 && dr === 0) continue;
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const j = r * cols + c;
        if (dist[j] <= dist[i] + 1) continue;
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

/** 格坐标 → [0,1) 确定性伪随机（抖动专用：**不消耗骰子**，同 seed 同图） */
function cellHash(col: number, row: number, salt: number): number {
  let h = (Math.imul(col + 0x9e37 + salt, 0x85eb) ^ Math.imul(row + 0x27d4, 0xc2b2)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x7feb) >>> 0;
  h ^= h >>> 16;
  return h / 0x100000000;
}

/* ─────────────────── 河流 ─────────────────── */

/** 一条河至少几格（少于它只是"地里渗出来的一小段"，不如不画） */
const MIN_RIVER_CELLS = 3;

/** 走河的最大步数（相对格网边长，防死循环） */
function maxRiverSteps(cols: number, rows: number): number {
  return (cols + rows) * 2;
}

/** 河道折线的抖动幅度（格边长倍数）：把格心连线的锯齿摊成自然的弯 */
const RIVER_JITTER = 0.12;

/** 加密点（相邻格心之间插的中点）的横向扰动幅度（格边长倍数） */
const RIVER_MID_OFFSET = 0.18;

/**
 * 走到小盆地（四周都比自己高）时允许的"平走"步数。
 *
 * 【为什么允许上坡】真实地形里河要翻过鞍部才继续往下；只认严格下坡会让河在
 * 第一个洼地就断头 —— 参考成图上没有一条河是悬在内陆半途而废的。
 * 两步足够越过一格鞍部，再多就会画出一条"爬山的河"。
 */
const MAX_WANDER = 2;

/** 平走时允许的高差上限（相对一格的海拔尺度） */
const WANDER_GAP = 0.35;

/** 一条河的结果：路径 + 是否真的到了水（入海 / 汇入已有河道） */
interface TracedRiver {
  path: number[];
  /** `false` = 在内陆断头（后续要么找到湖接住，要么整条丢弃） */
  reaches: boolean;
}

/**
 * 从一格往下游走，直到入海 / 汇进已有河道 / 走不动。
 *
 * @param start      源头格索引
 * @param elev       地势场
 * @param claimed    已被上游河道占用的格（汇流点）
 * @returns 路径与"是否到达水体"；不足 `MIN_RIVER_CELLS` ⇒ null
 */
function traceRiver(
  start: number,
  cells: readonly WaterCell[],
  cols: number,
  rows: number,
  elev: readonly number[],
  claimed: ReadonlySet<number>,
  rng: () => number,
): TracedRiver | null {
  const path: number[] = [start];
  const seen = new Set<number>([start]);
  let dirX = 0;
  let dirY = 0;
  let wander = 0;
  const steps = maxRiverSteps(cols, rows);

  for (let step = 0; step < steps; step += 1) {
    const cur = path[path.length - 1];
    // 已入海：停在海上这一格（下游端点在海里，河道才贴到岸线外沿）
    if (!cells[cur].land) break;

    const col = cur % cols;
    const row = Math.floor(cur / cols);
    let best = -1;
    let bestScore = -Infinity;
    let bestDx = 0;
    let bestDy = 0;

    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dc === 0 && dr === 0) continue;
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const j = r * cols + c;
        if (seen.has(j)) continue;

        // 只往下游走：落差必须为正（海格是 -2，永远满足）
        const drop = elev[cur] - elev[j];
        if (drop <= 0.02) continue;

        // 方向惯性：继续直行最省力，掉头最贵 —— 少了它，河会画出"回形针"
        const dot = dc * dirX + dr * dirY;
        const inertia = dirX === 0 && dirY === 0 ? 1 : dot >= 2 ? 1.9 : dot >= 0 ? 1 : 0.3;
        const score = drop * inertia * (0.85 + rng() * 0.3);
        if (score > bestScore) {
          bestScore = score;
          best = j;
          bestDx = dc;
          bestDy = dr;
        }
      }
    }

    if (best < 0) {
      // 洼地：允许有限步"平走"翻鞍部（见 MAX_WANDER）。仍不行才算断头。
      if (wander >= MAX_WANDER) break;
      let flat = -1;
      let flatGap = Infinity;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dc === 0 && dr === 0) continue;
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const j = r * cols + c;
          if (seen.has(j)) continue;
          const gap = elev[j] - elev[cur];
          if (gap > WANDER_GAP) continue;
          if (Math.abs(gap) < flatGap) {
            flatGap = Math.abs(gap);
            flat = j;
            bestDx = dc;
            bestDy = dr;
          }
        }
      }
      if (flat < 0) break;
      wander += 1;
      best = flat;
    } else {
      wander = 0;
    }

    path.push(best);
    seen.add(best);
    dirX = bestDx;
    dirY = bestDy;

    // 入海
    if (!cells[best].land) break;
    // 汇流：撞上已有河道就收尾（参考实现的 `isBranchRiver`）
    if (claimed.has(best)) break;
  }

  if (path.length < MIN_RIVER_CELLS) return null;
  const last = path[path.length - 1];
  return { path, reaches: !cells[last].land || claimed.has(last) };
}

/**
 * 把一个岸外的点沿「朝内邻点」的方向二分推到岸内。
 *
 * 【为什么必须做这一步】格网判断 `land` 用的是"中心或四角压到陆地"（`CELL_PROBE`），
 * 沿海格的中心可能**已经在海上**。河源或河口落在这种格上时，折线端点就浮在海面，
 * 看图像是"河里伸出来一截"。这里沿线段二分找岸界，端点正好收在岸上。
 */
function pullInside(from: Point, toward: Point, inside: (p: Point) => boolean): Point {
  if (inside(from)) return from;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 8; i += 1) {
    const t = (lo + hi) / 2;
    const p = { x: from.x + (toward.x - from.x) * t, y: from.y + (toward.y - from.y) * t };
    if (inside(p)) hi = t;
    else lo = t;
  }
  return { x: from.x + (toward.x - from.x) * hi, y: from.y + (toward.y - from.y) * hi };
}

/** 河道折线两端的点收到岸内（中段不动：跨湾是地形本身的样子） */
function clipEndsToLand(points: Point[], land: MapLand | undefined): Point[] {
  if (!land || points.length < 3) return points;
  const inLand = (p: Point) => pointInLand(p, land);
  let pts = points;

  /**
   * 先把"连续两个点都在岸外"的端点整段剃掉。
   *
   * 【为什么不能只靠二分】沿海格（`CELL_PROBE` 认领的格）可以连着两三个，
   * 它们的中心都在海上；此时 `pullInside` 往邻点方向找不到岸，只能原样返回，
   * 于是折线仍有一截浮在海面（实测东北角就出现过一条）。剃掉再二分才收得干净。
   */
  while (pts.length > 2 && !inLand(pts[0]) && !inLand(pts[1])) pts = pts.slice(1);
  while (pts.length > 2 && !inLand(pts[pts.length - 1]) && !inLand(pts[pts.length - 2])) {
    pts = pts.slice(0, -1);
  }

  const out = [...pts];
  out[0] = pullInside(out[0], out[1], inLand);
  const last = out.length - 1;
  out[last] = pullInside(out[last], out[last - 1], inLand);
  return out;
}

/**
 * 河道格序列 → 世界坐标折线。
 *
 * 两件事让它不像"方格连线"：① 每个格心带 ±0.12 格抖动；② 相邻点之间插一个
 * 带横向偏移的中点（`RIVER_MID_OFFSET`）。中点必须由**确定性格哈希**给出偏移，
 * 不能用骰子 —— 同一条河在重绘（拖节点、切选中）之间必须长一个模样。
 */
function riverPoints(
  path: readonly number[],
  cells: readonly WaterCell[],
  cellSize: number,
  land: MapLand | undefined,
): Point[] {
  const pts: Point[] = path.map((idx) => {
    const c = cells[idx];
    const j = RIVER_JITTER * cellSize;
    return {
      x: c.x + (cellHash(c.col, c.row, 17) - 0.5) * 2 * j,
      y: c.y + (cellHash(c.row, c.col, 29) - 0.5) * 2 * j,
    };
  });
  // 端点在海上：落在「最后一格陆地」与「第一格海」的**中点**（≈ 海岸线），
  // 而不是海格中心 —— 否则每条河都会往海里多探半格，看上去像画进了海面。
  if (path.length >= 2 && !cells[path[path.length - 1]].land) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    b.x = (a.x + b.x) / 2;
    b.y = (a.y + b.y) / 2;
  }

  // 加密：中点沿法线偏移，Catmull-Rom 平滑后是自然的弯而不是"折尺"
  const dense: Point[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    dense.push(pts[i]);
    if (i === pts.length - 1) break;
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = (cellHash(i, i * 7 + 3, 61) - 0.5) * 2 * RIVER_MID_OFFSET * cellSize;
    dense.push({
      x: (a.x + b.x) / 2 - (dy / len) * off,
      y: (a.y + b.y) / 2 + (dx / len) * off,
    });
  }
  return clipEndsToLand(dense, land);
}

/**
 * 源头候选：高处的内陆格，山族额外加权（河从山里出来才像河）。
 *
 * 排序用 `score` 而不是纯地势，是为了让"内陆平原里的最高点"敌不过
 * "山地里的次高点"——参考实现的河源全在山系边缘。
 */
function riverSources(
  cells: readonly WaterCell[],
  elev: readonly number[],
  seaDist: readonly number[],
  rng: () => number,
): number[] {
  const scored: { index: number; score: number }[] = [];
  for (let i = 0; i < cells.length; i += 1) {
    if (!cells[i].land || seaDist[i] < 2) continue;
    const t = cells[i].terrain;
    const mountainBonus =
      t === "mountain" || t === "highland" || t === "volcano"
        ? 0.9
        : t === "hill" || t === "valley"
          ? 0.35
          : 0;
    scored.push({ index: i, score: elev[i] + mountainBonus + rng() * 0.5 });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.index);
}

/** 河流宽度倍数：河越长越宽（参考 `size` 2→6 随帧数递变） */
function riverWidthScale(cellCount: number): number {
  return Math.round((0.55 + Math.min(1.35, cellCount / 16)) * 100) / 100;
}

/* ─────────────────── 湖泊 ─────────────────── */

/** 湖面外环的顶点数（越多越顺；18 在 54 格网下已读不出多边形） */
const LAKE_VERTICES = 18;

/** 内环相对外环的半径比例（由外向内 = 浅滩 → 深水） */
const LAKE_RING_SCALES = [1, 0.66, 0.38] as const;

/**
 * 生成一圈湖岸顶点（同一组抖动半径 × 比例 ⇒ 各环天然嵌套）。
 *
 * @param shrink 整体收缩系数（顶点出岸时逐次缩小重试）
 */
function lakeRing(
  cx: number,
  cy: number,
  baseR: number,
  rot: number,
  ex: number,
  ey: number,
  scale: number,
  shrink: number,
): Point[] {
  const out: Point[] = [];
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  /**
   * 轮廓起伏用**两条低频正弦**，不是逐顶点哈希。
   *
   * 【为什么】逐顶点独立抖动（±18%）的 18 边形平滑之后仍是"花瓣/齿轮"——
   * 相邻顶点的半径没有相关性，曲线只能在每个顶点处鼓一下。低频正弦让半径
   * 沿圆周连续变化，出来的是一汪**不规则但圆润**的水面。
   */
  const ph1 = cellHash(Math.round(baseR), 7, 41) * Math.PI * 2;
  const ph2 = cellHash(Math.round(baseR), 13, 43) * Math.PI * 2;
  for (let i = 0; i < LAKE_VERTICES; i += 1) {
    const a = (i / LAKE_VERTICES) * Math.PI * 2;
    const jitter = 1 + 0.1 * Math.sin(a * 2 + ph1) + 0.06 * Math.sin(a * 3 + ph2);
    const rx = baseR * jitter * ex * scale * shrink;
    const ry = baseR * jitter * ey * scale * shrink;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push({ x: cx + x * cosR - y * sinR, y: cy + x * sinR + y * cosR });
  }
  return out;
}

/** 一串湖岸折线是否整体在岸内（没给 land 时一律算通过） */
function ringInLand(points: readonly Point[], land: MapLand | undefined): boolean {
  if (!land) return true;
  return points.every((p) => pointInLand(p, land));
}

/* ─────────────────── 主入口 ─────────────────── */

/** 湖泊候选的最小间距（格）：两个湖贴在一起会读成一个"8 字形" */
const LAKE_SEPARATION_RATIO = 0.28;

/**
 * 从格网生成整张图的水系。
 *
 * 步骤：地势场（离岸距离 + 地形高度）→ 按条数挑源头、逐条往下游走（遇海/遇河即止）
 * → 在低洼处放湖（外环 + 2 内环）。河与湖都写进同一条折线数组，顺序 = 绘制顺序
 * （湖先、河后：河从湖里流出时压在水面上）。
 */
export function buildWaterNet(
  cells: readonly WaterCell[],
  options: WaterNetOptions,
): WaterNet {
  const { cols, rows, cellSize, rng, land } = options;
  const out: WaterNet = { polylines: [], cells: new Set<number>() };
  if (cells.length === 0 || cols <= 0 || rows <= 0) return out;

  const seaDist = seaDistance(cells, cols, rows);
  const elev = cells.map((c, i) => {
    if (!c.land) return SEA_HEIGHT;
    return cellHeight(c.terrain, seaDist[i], (cellHash(c.col, c.row, 53) - 0.5) * 0.5);
  });

  const minSep = Math.max(2, Math.round(Math.min(cols, rows) / 5));
  /**
   * 河源之间的最小间距（格）。
   *
   * 【为什么要比 `minSep` 大】源头是按地势排序挑的，高处往往连成一条山脉 ——
   * 只筛 3 格的间距，8 条河会全挤在同一片山区。间距拉到格网短边的 30%，
   * 河才会分到岛的四周（参考成图上没有"所有河都从北边下来"的图）。
   */
  const sourceSpread = Math.max(4, Math.round(Math.min(cols, rows) * 0.3));

  // ── 河：先把路径都走出来（留不留由湖决定，见下）──
  const claimed = new Set<number>();
  const sources = riverSources(cells, elev, seaDist, rng);
  const traced: { source: number; path: number[]; reaches: boolean }[] = [];
  const picked: number[] = [];
  for (const idx of sources) {
    if (picked.length >= options.rivers) break;
    const c = cells[idx];
    if (picked.some((p) => Math.abs(cells[p].col - c.col) + Math.abs(cells[p].row - c.row) < sourceSpread)) {
      continue;
    }
    const tracedRiver = traceRiver(idx, cells, cols, rows, elev, claimed, rng);
    if (!tracedRiver) continue;
    picked.push(idx);
    for (const p of tracedRiver.path) {
      claimed.add(p);
      if (cells[p].land) out.cells.add(p);
    }
    traced.push({ source: idx, ...tracedRiver });
  }

  /**
   * 湖心候选，按优先级三段：
   *   ① 配方里真的分到 `lake` 的岛状格（连通成片，一片只出一个水面）；
   *   ② **断头河的终点** —— 河走到洼地停住，那个洼地本来就该是一汪水；
   *   ③ 兜底：离海 ≥3 格、地势最低的内陆格。
   * ②是让"河不悬在半空"的关键：没有它，要么画出一堆半途而废的河，
   * 要么把 80% 的河都丢掉。
   */
  const lakeCenters: number[] = [];
  const lakeGap = Math.max(2, Math.round(minSep * LAKE_SEPARATION_RATIO * 2));
  const tooCloseToLake = (idx: number) =>
    lakeCenters.some(
      (p) =>
        Math.abs(cells[p].col - cells[idx].col) + Math.abs(cells[p].row - cells[idx].row) < lakeGap,
    );

  if (options.lakes > 0) {
    const lakeCellSet = new Set<number>();
    for (let i = 0; i < cells.length; i += 1) {
      if (cells[i].land && cells[i].terrain === "lake") lakeCellSet.add(i);
    }
    // ① 配方湖格：连通成片，取片内离海最远的一格
    if (lakeCellSet.size > 0) {
      const seen = new Set<number>();
      for (const start of lakeCellSet) {
        if (seen.has(start)) continue;
        const stack = [start];
        const group: number[] = [];
        seen.add(start);
        while (stack.length > 0) {
          const cur = stack.pop() as number;
          group.push(cur);
          const col = cur % cols;
          const row = Math.floor(cur / cols);
          for (let dr = -1; dr <= 1; dr += 1) {
            for (let dc = -1; dc <= 1; dc += 1) {
              const c = col + dc;
              const r = row + dr;
              if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
              const j = r * cols + c;
              if (seen.has(j) || !lakeCellSet.has(j)) continue;
              seen.add(j);
              stack.push(j);
            }
          }
        }
        let best = group[0];
        for (const g of group) if (seaDist[g] > seaDist[best]) best = g;
        if (lakeCenters.length < options.lakes && !tooCloseToLake(best)) lakeCenters.push(best);
      }
    }
    // ② 断头河终点
    for (const t of traced) {
      if (lakeCenters.length >= options.lakes) break;
      if (t.reaches) continue;
      const end = t.path[t.path.length - 1];
      if (!tooCloseToLake(end)) lakeCenters.push(end);
    }
    // ③ 低洼兜底
    if (lakeCenters.length < options.lakes) {
      const candidates = cells
        .map((c, i) => ({ c, i }))
        .filter(({ c, i }) => c.land && seaDist[i] >= 3 && c.terrain !== null)
        .sort((a, b) => elev[a.i] - elev[b.i] || a.i - b.i);
      for (const { i } of candidates) {
        if (lakeCenters.length >= options.lakes) break;
        if (!tooCloseToLake(i)) lakeCenters.push(i);
      }
    }
  }

  // ── 落河：入海/汇流的照画；断头河只有被湖接住才画（否则整条丢弃）──
  for (const t of traced) {
    const end = t.path[t.path.length - 1];
    const caughtByLake = lakeCenters.some(
      (p) =>
        Math.max(
          Math.abs(cells[p].col - cells[end].col),
          Math.abs(cells[p].row - cells[end].row),
        ) <= 1,
    );
    if (!t.reaches && !caughtByLake) continue;
    // 断头河的末点正好是湖心：去掉它，河道收在湖岸边，不会横穿整个水面
    const path = t.reaches ? t.path : t.path.slice(0, -1);
    if (path.length < MIN_RIVER_CELLS) continue;
    out.polylines.push({
      id: `pl_gen_river_${t.source}`,
      kind: "river",
      styleId: "river",
      points: riverPoints(path, cells, cellSize, land),
      closed: false,
      level: null,
      widthScale: riverWidthScale(path.length),
      origin: "generated",
    });
  }

  // ── 落湖（画在河之后：湖面盖住河的末段，读作"流进湖里"）──
  for (const idx of lakeCenters) {
    const c = cells[idx];
    const baseR = cellSize * (0.6 + rng() * 0.35);
    const rot = rng() * Math.PI * 2;
    const ex = 1 + (rng() - 0.5) * 0.5;
    const ey = 1 / ex;

    let shrink = 1;
    let rings: Point[][] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      rings = LAKE_RING_SCALES.map((s) => lakeRing(c.x, c.y, baseR, rot, ex, ey, s, shrink));
      if (ringInLand(rings[0], land)) break;
      shrink *= 0.72;
      rings = [];
    }
    if (rings.length === 0) continue;

    /**
     * 占格：**顶点所在格 + 格心落在湖面内的格**（2.45.0 补）。
     *
     * 【为什么不能只标顶点格】小湖的半径不到一格，顶点格可能只有湖心那一格；
     * 于是紧邻湖岸的格仍然是"陆地"，道路与素材都会压在画出来的水面上
     * （成图上表现为"一条路横穿湖面"）。按格心做一次点在多边形内判定，
     * 才能真正把"画出来的水面"从可通行区域里挖掉。
     */
    for (const p of rings[0]) out.cells.add(rowColIndex(p, cols, rows, cellSize, c));
    markCellsInside(rings[0], cells, out.cells);
    rings.forEach((points, k) => {
      out.polylines.push({
        id: `pl_gen_lake_${idx}_${k}`,
        kind: "lake",
        styleId: k === 0 ? "lake" : "lake-ring",
        points,
        closed: true,
        level: null,
        origin: "generated",
      });
    });
  }

  return out;
}

/**
 * 湖面顶点 → 格索引（只用于"布点避开水面"）。
 *
 * 顶点可能落在格线上，`Math.round` 会把边缘格也算进来；越界一律夹回网格内，
 * 宁可多占一格也不返回 -1（-1 会被当成"第 0 行第 -1 列"污染邻格）。
 */
function rowColIndex(
  p: Point,
  cols: number,
  rows: number,
  cellSize: number,
  center: WaterCell,
): number {
  // 湖心所在格是确定的，用它反推格网原点，免得多传一个 box
  const originX = center.x - (center.col + 0.5) * cellSize;
  const originY = center.y - (center.row + 0.5) * cellSize;
  const col = Math.min(cols - 1, Math.max(0, Math.round((p.x - originX) / cellSize)));
  const row = Math.min(rows - 1, Math.max(0, Math.round((p.y - originY) / cellSize)));
  return row * cols + col;
}

/**
 * 把**格心落在湖面内**的格全部登记为水面（2.45.0）。
 *
 * 只用顶点格会漏掉"岸边一圈"：湖半径可能只有 0.6 格，顶点格之外的邻格仍然
 * 被当成陆地 —— 道路顺着它穿过去，成图上就是"一条点线横穿湖面"。
 * 这里按湖的包围盒遍历格心，用同一个射线法判定，代价是几十次多边形测试。
 */
function markCellsInside(
  ring: Point[],
  cells: readonly WaterCell[],
  out: Set<number>,
): void {
  if (ring.length < 3) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i];
    if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;
    if (pointInPolygon({ x: c.x, y: c.y }, ring)) out.add(i);
  }
}
