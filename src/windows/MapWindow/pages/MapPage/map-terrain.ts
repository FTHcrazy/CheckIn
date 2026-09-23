/**
 * 地形生成器纯函数（docs/novel-map-prd.md RM8 程序化生成）
 *
 * 设计要点：
 * - value noise + 约束掩码融合产出栅格地形（9 类铺满型）
 * - 纯函数 + seed：同 seed 同约束必出同图（对齐 R18 起名工具心智）
 * - 归一化 + 分位数定海平面：任意 seed 都能拿到稳定构图
 * - 河流自高处最陡下降入海（到海距离 BFS 保证入海 + 支流树状）
 *
 * 边界：不 import React / window.electronAPI，可独立单测。
 * 单测见 map-terrain.test.ts（复现性 / 约束边界满足率 / 空池降级）。
 */

// ── 铺满型地形索引（与 §5.1 图例表一致，存档以此为准）──
export const T_SEA = 0;
export const T_LAKE = 1;
export const T_RIVER = 2;
export const T_DESERT = 3;
export const T_GRASS = 4;
export const T_FOREST = 5;
export const T_MOUNTAIN = 6;
export const T_SNOW = 7;
export const T_SNOWFIELD = 8;

export const TER_KEY = [
  "sea",
  "lake",
  "river",
  "desert",
  "grass",
  "forest",
  "mountain",
  "snowmtn",
  "snowfield",
] as const;

export interface TerrainMeta {
  key: string;
  name: string;
  desc: string;
}

export const TER_META: readonly TerrainMeta[] = [
  { key: "sea", name: "大海", desc: "两行交错的水平短弧浪纹" },
  { key: "lake", name: "湖泊", desc: "细密点状涟漪，比海浪更短更静" },
  { key: "river", name: "河流", desc: "平滑曲线水带，两岸留浅色岸线" },
  { key: "desert", name: "沙漠", desc: "同向排列的新月形沙丘弧" },
  { key: "grass", name: "草原", desc: "稀疏草叶短线，散布密度最低" },
  { key: "forest", name: "森林", desc: "树木符号成簇散布，簇间留林间空地" },
  { key: "mountain", name: "山地", desc: "折线山形符号连绵成脊" },
  { key: "snowmtn", name: "雪山", desc: "山形符号，峰顶覆白" },
  { key: "snowfield", name: "雪原", desc: "极稀疏淡蓝冰晶点，几乎纯白" },
];

// ── 约束模板（RM8① 可多选组合）──
export interface TerrainTemplates {
  threeSea?: boolean; // 三面环海（西/东/南）
  island?: boolean; // 四面环海（孤岛）
  westDesert?: boolean; // 西面沙漠
  northSnow?: boolean; // 北境雪原
  centerLake?: boolean; // 中央大湖
  bigRiver?: boolean; // 大河贯境
  barren?: boolean; // 荒芜大陆
}

export interface BuildWorldOptions {
  cols: number;
  rows: number;
  seed: string;
  templates?: TerrainTemplates;
  freq?: number;
  /** flat = 城镇尺度子图：压平高程，不再生成山地雪峰 */
  flat?: boolean;
}

export interface RiverFeature {
  type: "river";
  pts: number[]; // 扁平 [x0,y0,x1,y1,...]
  trib?: boolean;
}

export interface TerrainFeature {
  /** 叠加型要素稳定 id（同 seed 同约束必出同 id，对齐 §5.1 图例版本化） */
  id?: string;
  type: "cliff" | "island" | "waterfall" | "river";
  /** 悬崖/瀑布点位（世界坐标），河流见 pts */
  cells?: number[];
  points?: Array<{ x: number; y: number }>;
  pts?: number[];
  seed?: string;
  trib?: boolean;
}

export interface BuiltWorld {
  cols: number;
  rows: number;
  cell: number;
  width: number;
  height: number;
  cells: Uint8Array;
  elev: Float32Array;
  seed: string;
  templates: TerrainTemplates;
  features: TerrainFeature[];
  snum: number;
}

// ── 常量 ──
export const CELL = 16;
/** 世界尺度：1 格 = 25 里（与连线标注「三百二十里 / 六百里」自洽） */
export const LI_PER_CELL = 25;

// ── 基础数学 ──

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 字符串 seed → 32 位整数（确定性，同 seed 同数） */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 整数坐标 + seed 的伪随机 [0,1) */
function rnd2(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x | 0, 374761393) +
    Math.imul(y | 0, 668265263) +
    Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = rnd2(xi, yi, seed);
  const b = rnd2(xi + 1, yi, seed);
  const c = rnd2(xi, yi + 1, seed);
  const d = rnd2(xi + 1, yi + 1, seed);
  const u = fade(xf);
  const v = fade(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number, seed: number, oct = 4): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ── 陆地分类（§5.1 图例表）──

function pickLand(
  h: number,
  seaLevel: number,
  mo: number,
  cold: number,
  rg: number,
  flat: boolean | undefined,
): number {
  const q = clamp01((h - seaLevel) / (1 - seaLevel)) * (flat ? 0.55 : 1);
  if (cold > 0.52) return rg > 0.5 || q > 0.86 ? T_SNOW : T_SNOWFIELD;
  if (q > 0.58 && rg > 0.44) return T_MOUNTAIN;
  if (q > 0.86) return cold > 0.26 ? T_SNOW : T_MOUNTAIN;
  if (cold > 0.42) return T_SNOWFIELD;
  if (mo < 0.33) return T_DESERT;
  if (mo > 0.57) return T_FOREST;
  return T_GRASS;
}

// ── 到海距离场（多源 BFS）──

function distToSea(world: BuiltWorld): Int32Array {
  const { cols, rows, cells } = world;
  const dist = new Int32Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < dist.length; i++) dist[i] = -1;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === T_SEA) {
      dist[i] = 0;
      queue[qt++] = i;
    }
  }
  const DX = [1, -1, 0, 0];
  const DY = [0, 0, 1, -1];
  while (qh < qt) {
    const cur = queue[qh++];
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (let k = 0; k < 4; k++) {
      const ax = cx + DX[k];
      const ay = cy + DY[k];
      if (ax < 0 || ay < 0 || ax >= cols || ay >= rows) continue;
      const ni = ay * cols + ax;
      if (dist[ni] >= 0) continue;
      dist[ni] = dist[cur] + 1;
      queue[qt++] = ni;
    }
  }
  return dist;
}

// ── 河流（自高处最陡下降入海 + 支流）──

function carveRiver(world: BuiltWorld, sd: number, bias: number): void {
  const { cols, rows, elev, cells } = world;
  const dist = distToSea(world);
  let best = -1;
  let bi = -1;
  for (let i = 0; i < elev.length; i++) {
    const c = i % cols;
    const r = (i - c) / cols;
    if (cells[i] !== T_MOUNTAIN && cells[i] !== T_SNOW) continue;
    if (dist[i] < 0) continue;
    const score =
      dist[i] * 3.2 + elev[i] * 6 + rnd2(c, r, sd) * 3 - Math.abs(c / cols - bias) * 4;
    if (score > best) {
      best = score;
      bi = i;
    }
  }
  if (bi < 0) {
    for (let i = 0; i < elev.length; i++) {
      if (cells[i] === T_SEA || cells[i] === T_LAKE || dist[i] < 6) continue;
      const c2 = i % cols;
      const r2 = (i - c2) / cols;
      const sc2 = dist[i] + rnd2(c2, r2, sd) * 3;
      if (sc2 > best) {
        best = sc2;
        bi = i;
      }
    }
  }
  if (bi < 0) return;

  let ci = bi % cols;
  let ri = (bi - ci) / cols;
  let guard = 0;
  const pts = [(ci + 0.5) * CELL, (ri + 0.5) * CELL];
  while (guard++ < cols * rows) {
    cells[ri * cols + ci] = T_RIVER;
    if (dist[ri * cols + ci] === 0) break;
    let bestScore = Infinity;
    let lc = ci;
    let lr = ri;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ax = ci + dx;
        const ay = ri + dy;
        if (ax < 0 || ay < 0 || ax >= cols || ay >= rows) continue;
        const ni = ay * cols + ax;
        if (dist[ni] < 0) continue;
        const wander = vnoise(ax * 0.32, ay * 0.32, sd) * 6;
        const sc = dist[ni] * 4 + elev[ni] + wander + (dx && dy ? 0.05 : 0) + rnd2(ax, ay, sd) * 0.02;
        if (sc < bestScore) {
          bestScore = sc;
          lc = ax;
          lr = ay;
        }
      }
    }
    if (lc === ci && lr === ri) break;
    ci = lc;
    ri = lr;
    pts.push((ci + 0.5) * CELL, (ri + 0.5) * CELL);
  }
  if (pts.length >= 6) {
    world.features.push({ type: "river", pts });
    addTributaries(world, pts, sd + 4099);
  }
}

function addTributaries(world: BuiltWorld, mainPts: number[], sd: number): void {
  const { cols, rows } = world;
  const n = mainPts.length / 2;
  if (n < 8) return;
  const count = 2 + Math.floor(rnd2(sd, 7, sd) * 2);
  for (let t = 0; t < count; t++) {
    const pick = Math.floor(n * (0.22 + 0.56 * ((t + 0.5) / count)));
    const c = Math.floor(mainPts[pick * 2] / CELL);
    const r = Math.floor(mainPts[pick * 2 + 1] / CELL);
    if (c < 1 || r < 1 || c >= cols - 1 || r >= rows - 1) continue;
    const pts = [(c + 0.5) * CELL, (r + 0.5) * CELL];
    const len = 6 + Math.floor(rnd2(c, r, sd + t * 31) * 9);
    let cc = c;
    let rr = r;
    let guard = 0;
    while (guard++ < len) {
      let bestE = -Infinity;
      let bc = cc;
      let br = rr;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const ax = cc + dx;
          const ay = rr + dy;
          if (ax < 1 || ay < 1 || ax >= cols - 1 || ay >= rows - 1) continue;
          const ni = ay * cols + ax;
          if (world.cells[ni] === T_SEA) continue;
          const e = world.elev[ni] + rnd2(ax, ay, sd + t * 17) * 0.03;
          if (e > bestE) {
            bestE = e;
            bc = ax;
            br = ay;
          }
        }
      }
      if (bc === cc && br === rr) break;
      cc = bc;
      rr = br;
      pts.push((cc + 0.5) * CELL, (rr + 0.5) * CELL);
    }
    if (pts.length >= 8) {
      world.features.push({ type: "river", pts, trib: true });
    }
  }
}

// ── 叠加型符号（悬崖/岛屿/瀑布，§5.1 叠加型）──

function buildFeatures(world: BuiltWorld): void {
  const { cols, rows, cells } = world;
  const feats: TerrainFeature[] = [];
  let fid = 0;
  const nextId = (t: string): string => {
    const n = (world.snum + fid++ * 2654435761) >>> 0;
    return `${t}_${n.toString(16)}`;
  };

  // 悬崖：山地/雪山与明显更低地形（海/湖/草原/沙漠）相邻处取边界中点（世界坐标）
  const isLower = (t: number): boolean =>
    t === T_SEA || t === T_LAKE || t === T_GRASS || t === T_DESERT;
  const cliffFlat: number[] = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      const t = cells[i];
      if (t !== T_MOUNTAIN && t !== T_SNOW) continue;
      const neigh = [i - cols, i + cols, i - 1, i + 1];
      for (const n of neigh) {
        if (isLower(cells[n])) {
          const nc = n % cols;
          const nr = (n - nc) / cols;
          cliffFlat.push(
            (c + 0.5 + (nc - c) * 0.5) * CELL,
            (r + 0.5 + (nr - r) * 0.5) * CELL,
          );
          break;
        }
      }
    }
  }
  // 抽稀：每 3 个取 1，避免过密（符号密度恒定，缩放等比）
  const sampled: Array<{ x: number; y: number }> = [];
  for (let k = 0; k + 1 < cliffFlat.length; k += 6) {
    sampled.push({ x: cliffFlat[k], y: cliffFlat[k + 1] });
  }
  if (sampled.length >= 2) {
    feats.push({ id: nextId("cliff"), type: "cliff", points: sampled });
  }

  // 岛屿：海中被陆地包围的孤立小地块（洪泛找陆簇，簇全被海包且面积 ≤ 14）
  const visited = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (visited[i] === 1 || cells[i] === T_SEA) continue;
      const stack = [i];
      visited[i] = 1;
      const cluster: number[] = [];
      let enclosed = true;
      while (stack.length) {
        const cur = stack.pop() as number;
        cluster.push(cur);
        const cc = cur % cols;
        const cr = (cur - cc) / cols;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ax = cc + dx;
            const ay = cr + dy;
            if (ax < 0 || ay < 0 || ax >= cols || ay >= rows) {
              enclosed = false;
              continue;
            }
            const ni = ay * cols + ax;
            if (cells[ni] === T_SEA) continue;
            if (visited[ni] === 0) {
              visited[ni] = 1;
              stack.push(ni);
            }
          }
        }
      }
      if (enclosed && cluster.length >= 1 && cluster.length <= 14) {
        let sx = 0;
        let sy = 0;
        for (const ci of cluster) {
          sx += ci % cols;
          sy += (ci - (ci % cols)) / cols;
        }
        const cx = (sx / cluster.length + 0.5) * CELL;
        const cy = (sy / cluster.length + 0.5) * CELL;
        feats.push({
          id: nextId("island"),
          type: "island",
          points: [{ x: cx, y: cy }],
          cells: cluster.slice(),
        });
      }
    }
  }

  // 瀑布：河流与山地/雪山相邻处，取一处作为瀑布符号
  for (const f of world.features) {
    if (f.type !== "river" || !f.pts || f.pts.length < 6) continue;
    let placed = false;
    for (let k = 0; k + 1 < f.pts.length && !placed; k += 2) {
      const x = f.pts[k];
      const y = f.pts[k + 1];
      const cc = Math.floor(x / CELL);
      const cr = Math.floor(y / CELL);
      for (let dy = -1; dy <= 1 && !placed; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ax = cc + dx;
          const ay = cr + dy;
          if (ax < 0 || ay < 0 || ax >= cols || ay >= rows) continue;
          const ni = ay * cols + ax;
          if (cells[ni] === T_MOUNTAIN || cells[ni] === T_SNOW) {
            feats.push({
              id: nextId("waterfall"),
              type: "waterfall",
              points: [{ x, y }],
              seed: world.seed,
            });
            placed = true;
            break;
          }
        }
      }
    }
  }

  world.features.push(...feats);
}

// ── 主入口：buildWorld ──

export function buildWorld(opt: BuildWorldOptions): BuiltWorld {
  const cols = opt.cols;
  const rows = opt.rows;
  const seed = opt.seed;
  const tpl: TerrainTemplates = opt.templates ?? {};
  const s = hashSeed(seed);
  const n = cols * rows;
  const cells = new Uint8Array(n);
  const elev = new Float32Array(n);
  const mo = new Float32Array(n);
  const cold = new Float32Array(n);
  const ridge = new Float32Array(n);
  const aspect = rows / cols;
  const FREQ = opt.freq ?? 5.0;

  // ① 高程场
  let lo = Infinity;
  let hi = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const nx = cols > 1 ? c / (cols - 1) : 0.5;
      const ny = rows > 1 ? r / (rows - 1) : 0.5;
      const u = nx * FREQ;
      const v = ny * FREQ * aspect;

      let shape = clamp01((0.62 - Math.sqrt((nx - 0.5) ** 2 * 1.3225 + (ny - 0.5) ** 2)) / 0.44);
      if (tpl.threeSea) {
        const sideFade = Math.min(clamp01(nx / 0.26), clamp01((1 - nx) / 0.26));
        const southFade = clamp01((1 - ny) / 0.34);
        shape = Math.min(sideFade * 0.82 + 0.18, southFade * 0.88 + 0.12);
      }
      if (tpl.island) {
        shape = clamp01((0.48 - Math.sqrt((nx - 0.5) ** 2 * 1.6384 + (ny - 0.5) ** 2)) / 0.3);
      }

      let h = fbm(u, v, s, 5) * 0.72 + shape * 0.62;
      if (tpl.centerLake) {
        const dl = Math.sqrt((nx - 0.48) ** 2 * 1.44 + (ny - 0.52) ** 2);
        if (dl < 0.2) h -= 0.52 * (1 - dl / 0.2);
      }
      elev[i] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;

      const m = tpl.westDesert
        ? fbm(u * 0.85 + 7.3, v * 0.85 + 2.1, s + 311, 4) *
          (0.18 + 0.82 * clamp01((nx - 0.1) / 0.44))
        : tpl.barren
          ? fbm(u * 0.85 + 7.3, v * 0.85 + 2.1, s + 311, 4) * 0.62
          : fbm(u * 0.85 + 7.3, v * 0.85 + 2.1, s + 311, 4);
      mo[i] = m;

      let cd = 0;
      if (tpl.northSnow) {
        cd = clamp01((0.4 - ny) / 0.36) * (0.78 + 0.44 * fbm(u * 1.5 + 3.1, v * 1.5 + 8.8, s + 977, 3));
      }
      const rg = fbm(u * 1.7 + 11.3, v * 1.7 + 4.9, s + 5231, 3);
      cold[i] = cd;
      ridge[i] = rg;
    }
  }

  // ② 归一化 + 分位数定海平面
  const span = hi - lo || 1;
  for (let i = 0; i < n; i++) elev[i] = (elev[i] - lo) / span;
  const sorted = Array.from(elev).sort((a, b) => a - b);
  const seaTarget = tpl.island ? 0.7 : tpl.threeSea ? 0.52 : 0.45;
  const seaLevel = sorted[Math.floor(n * seaTarget)] ?? 0.45;

  // ③ 分类
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const nx = cols > 1 ? c / (cols - 1) : 0.5;
      const ny = rows > 1 ? r / (rows - 1) : 0.5;
      const h2 = elev[i];
      const mo2 = mo[i];
      const cd2 = cold[i];
      const rg2 = ridge[i];

      if (tpl.centerLake) {
        const dl2 = Math.sqrt((nx - 0.48) ** 2 * 1.44 + (ny - 0.52) ** 2);
        if (dl2 < 0.15 && h2 < seaLevel + 0.07) {
          cells[i] = T_LAKE;
          continue;
        }
      }
      const t = h2 < seaLevel ? T_SEA : pickLand(h2, seaLevel, mo2, cd2, rg2, opt.flat);
      cells[i] = t;
    }
  }

  // ④ 中央大湖后处理
  if (tpl.centerLake) {
    const inside: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const inx = cols > 1 ? c / (cols - 1) : 0.5;
        const iny = rows > 1 ? r / (rows - 1) : 0.5;
        const din = Math.sqrt((inx - 0.48) ** 2 * 1.44 + (iny - 0.52) ** 2);
        if (din < 0.16) inside.push(r * cols + c);
      }
    }
    inside.sort((a, b) => elev[a] - elev[b]);
    const take = Math.floor(inside.length * 0.6);
    for (let q9 = 0; q9 < take; q9++) cells[inside[q9]] = T_LAKE;
  }

  const world: BuiltWorld = {
    cols,
    rows,
    cell: CELL,
    width: cols * CELL,
    height: rows * CELL,
    cells,
    elev,
    seed,
    templates: tpl,
    features: [],
    snum: s,
  };

  // 河流
  const want = tpl.bigRiver ? 2 : 1;
  for (let k = 0; k < want; k++) {
    carveRiver(world, s + k * 7717, k === 0 ? 0.22 : 0.72);
  }
  buildFeatures(world);
  return world;
}

/** 生成随机 seed（16 进制 6 位，对齐设计稿格式） */
export function randomSeed(): string {
  return Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0")
    .toUpperCase();
}

/**
 * 从已存储的 content.terrain 重建可渲染 BuiltWorld（编辑已有地图时用）。
 * 不重新程序化生成，直接复用存档 cells + features；elev 用轻量径向梯度近似，
 * 仅用于等值线观感，不影响地形分类。
 */
export function worldFromContent(opts: {
  cols: number;
  rows: number;
  cells: number[];
  features?: Array<{
    id: string;
    type: "cliff" | "island" | "waterfall";
    points?: Array<{ x: number; y: number }>;
    cells?: number[];
    seed?: string;
  }>;
  seed?: string;
}): BuiltWorld {
  const { cols, rows, cells } = opts;
  const arr = new Uint8Array(cols * rows);
  for (let i = 0; i < arr.length && i < cells.length; i++) arr[i] = cells[i];
  const elev = new Float32Array(cols * rows);
  const aspect = rows / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const nx = cols > 1 ? c / (cols - 1) : 0.5;
      const ny = rows > 1 ? r / (rows - 1) : 0.5;
      const d = Math.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2 * aspect ** 2);
      elev[r * cols + c] = 1 - Math.min(1, d * 1.6);
    }
  }
  const feats: TerrainFeature[] = (opts.features ?? []).map((f) => ({
    id: f.id,
    type: f.type,
    points: f.points,
    cells: f.cells,
    seed: f.seed,
  }));
  // 河流 feature 也可能在存档里以 type "river" 出现
  return {
    cols,
    rows,
    cell: CELL,
    width: cols * CELL,
    height: rows * CELL,
    cells: arr,
    elev,
    seed: opts.seed ?? "",
    templates: {},
    features: feats,
    snum: hashSeed(opts.seed ?? "map"),
  };
}
