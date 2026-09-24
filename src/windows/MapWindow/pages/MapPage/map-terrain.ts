/**
 * 地形生成器纯函数（docs/novel-map-prd.md RM8 程序化生成）
 *
 * 设计要点：
 * - value noise + 约束掩码融合产出栅格地形（12 类铺满型）
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
/**
 * 熔岩（第 10 类）：默认只由「赤炎火山」模板产出，也可地形画笔手绘（PRD RM9）。
 * 追加在末尾保证旧存档回读安全 —— 旧图 cells 里不存在该值。
 */
export const T_LAVA = 9;
/** 沼泽（第 11 类）：南疆沼泽 / 千里水乡模板主产出，也可画笔手绘 */
export const T_MARSH = 10;
/** 废墟（第 12 类）：古战场废墟 / 东荒戈壁模板主产出，也可画笔手绘 */
export const T_RUINS = 11;

/**
 * 地形索引 → key（存档以此为准）。
 * 追加顺序只增不改：旧图 cells 里的数值语义必须永远不变（legendVersion 锁定图案规格）。
 */
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
  "lava",
  "marsh",
  "ruins",
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
  {
    key: "lava",
    name: "熔岩",
    desc: "暗红岩壳上龟裂的橙黄岩浆沟，会缓慢流动发光",
  },
  { key: "marsh", name: "沼泽", desc: "暗青苔甸上的水洼与芦苇丛，踩下去会陷" },
  { key: "ruins", name: "废墟", desc: "灰白碎石地夹杂断墙残垣线，上古战场遗迹" },
];

// ── 约束模板（RM8① 可多选组合）──
/**
 * 地形约束模板：可多选组合，「每个模板 = 参数化边缘掩码 + 地形偏置」。
 *
 * 全部字段可选；`false` 与缺省等价。模板之间**不互斥**，但语义冲突的组合
 * （如 island + centralContinent）以后者覆盖形函数的方式共存，不报错。
 */
export interface TerrainTemplates {
  // ── 基础格局 ──
  threeSea?: boolean; // 三面环海（西/东/南）
  island?: boolean; // 四面环海（孤岛）
  centralContinent?: boolean; // 中央大陆（九州格局：大陆居中 + 四周环海）
  westDesert?: boolean; // 西面沙漠
  northSnow?: boolean; // 北境雪原
  centerLake?: boolean; // 中央大湖
  bigRiver?: boolean; // 大河贯境
  barren?: boolean; // 荒芜大陆
  // ── 热门小说格局 ──
  tenThousandMountains?: boolean; // 十万大山（连绵山脉贯穿，山多平原少）
  southSwamp?: boolean; // 南疆沼泽（南部低洼水乡，多沼泽）
  volcanic?: boolean; // 赤炎火山（火脉纵横，熔岩成片）
  riftCanyon?: boolean; // 裂谷天堑（贯通全图的深谷断崖）
  archipelago?: boolean; // 群岛海域（碎岛散布，航海世界）
  eastWaste?: boolean; // 东荒戈壁（东侧干旱荒原）
  ruinFields?: boolean; // 古战场废墟（大废墟 + 碎石荒原）
  plains?: boolean; // 千里平原（低起伏，山地稀少）
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
  /**
   * `river` 用 `pts` 承载**有序折线**（扁平 [x0,y0,x1,y1,…]，世界坐标）；
   * `island` / `waterfall` 用 `points` 承载点位。
   * 叠加型符号一律由 `buildOverlayFeatures` 从 cells 派生，不从存档回读。
   */
  type: "island" | "waterfall" | "river";
  /** 岛屿所覆盖的格索引（世界坐标见 points[0]） */
  cells?: number[];
  points?: Array<{ x: number; y: number }>;
  /** 有序折线（扁平 [x0,y0,x1,y1,…]，世界坐标）：river 用 */
  pts?: number[];
  /** 瀑布水帘跌落方向（弧度，画布坐标系；派生时按低侧法线算好） */
  angle?: number;
  seed?: string;
  trib?: boolean;
}

/** 叠加型符号（岛屿/瀑布）一律由栅格派生，不落存档 */
export const OVERLAY_TYPES: readonly string[] = ["island", "waterfall"];

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
  /**
   * **抹掉河流后的地表底质**（`fillRiverBase` 派生，与 cells 同尺寸）。
   *
   * 为什么要有它：河流此前被画了两遍 —— GL 拿 cells 里的河格刷出一片宽水面，
   * 2D 层再按 `pts` 描一条窄水带，两者中心线与宽度都对不上（GL 还有域扰动 +
   * 覆盖度模糊把 1 格河吹宽到 ≈3 格），实测就是「水道不连贯、两条水并排、
   * 水里还长着山」。现在的约定是——**河由 2D 层按 pts 单独绘制，cells 里的
   * 河格不再产生水面**，故地表渲染（GL splat / Canvas2D 底色）一律读 `baseCells`。
   * 涂刷/手改地形后由 `worldFromContent` 重新派生，保证一致。
   */
  baseCells?: Uint8Array;
}

/**
 * 地表渲染该读的栅格：有 `baseCells` 用 `baseCells`，否则退回 `cells`。
 * 单一事实源，GL 与 Canvas2D 两条路径都必须走它（否则两条路径画面不一致）。
 */
export function paintedCells(world: BuiltWorld): ArrayLike<number> {
  return world.baseCells ?? world.cells;
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

/** 单格分类所需的全部场值（对象传参避免十参位置漂移） */
export interface LandCtx {
  /** 归一化高程 0..1 */
  h: number;
  seaLevel: number;
  /** 湿度（干旱 → 沙漠） */
  mo: number;
  /** 寒冷度（高 → 雪原/雪山） */
  cold: number;
  /** 山脊强度（高 → 山地） */
  rg: number;
  /** 湿润洼地度（高且低海拔 → 沼泽） */
  wet: number;
  /** 废墟度（高 → 废墟） */
  ruin: number;
  /** 熔岩度（仅赤炎火山模板 > 0） */
  lava: number;
  /** plains = 千里平原：几乎不生成高山，最高处只是缓丘 */
  plains?: boolean;
  /**
   * 山地阈值下移量（0 为默认）。
   * 「十万大山」类模板把 0.56 的起山线降到 0.40 —— 这是山占比的**唯一有效杠杆**：
   * 光抬 rg 没用（rg 会被 min(1,…) 顶满，而 q 那一半条件仍卡着占比）。
   */
  mtn?: number;
  /** flat = 城镇尺度子图：压平高程，不再生成山地雪峰 */
  flat?: boolean;
}

/**
 * 单格陆地分类。
 *
 * 判定顺序即「优先级」：寒带 > 极高山 > 高山 > 雪线 > 熔岩 > 废墟 > 沙漠 > 沼泽 > 森林 > 草原。
 * 把干湿/废墟/沼泽放在海拔判定之后，是为了让它们只出现在**低海拔**地带，
 * 避免出现「山顶沼泽」「雪线沙漠」这类一眼假的组合。
 *
 * ⚠️ 注意 `plains` 不能靠「压缩高程」实现：海平面取的是高程分位数，
 * 任何单调变换都会被分位数抵消（实测压缩后山占比纹丝不动）。真正的杠杆是 **rg**。
 */
function pickLand(c: LandCtx): number {
  const q = clamp01((c.h - c.seaLevel) / (1 - c.seaLevel)) * (c.flat ? 0.55 : 1);
  if (c.cold > 0.52) return c.rg > 0.5 || q > 0.86 ? T_SNOW : T_SNOWFIELD;
  if (c.cold > 0.42) return T_SNOWFIELD;
  if (!c.flat && c.lava > 0.70 && q < 0.74) return T_LAVA;
  if (c.plains) {
    // 千里平原：只保留极少数孤立缓丘，其余按干湿/遗迹正常分类
    if (c.ruin > 0.74) return T_RUINS;
    if (c.mo < 0.33) return T_DESERT;
    if (c.wet > 0.68 && q < 0.44) return T_MARSH;
    if (q > 0.93 && c.rg > 0.82) return T_MOUNTAIN;
    if (c.mo > 0.57) return T_FOREST;
    return T_GRASS;
  }
  if (q > 0.86) return c.cold > 0.26 ? T_SNOW : T_MOUNTAIN;
  if (q > 0.56 - (c.mtn ?? 0) && c.rg > 0.44 - (c.mtn ?? 0) * 1.4) return T_MOUNTAIN;
  if (c.ruin > 0.74) return T_RUINS;
  if (c.mo < 0.33) return T_DESERT;
  if (c.wet > 0.62 && q < 0.42) return T_MARSH;
  if (c.mo > 0.57) return T_FOREST;
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
      // ⚠️ 支流必须**刻进 cells**：旧实现只 push feature（pts），于是支流成了一条
      //    「悬在陆地上的水带」——与 cells 派生的水体完全脱节（实测截图里那条
      //    斜插进山地的浅蓝水带就是它）。刻进栅格后支流与主干在同一格交汇，
      //    水体、瀑布判定、缩略图、导出全部自动包含支流。
      world.cells[rr * cols + cc] = T_RIVER;
      pts.push((cc + 0.5) * CELL, (rr + 0.5) * CELL);
    }
    if (pts.length >= 8) {
      world.features.push({ type: "river", pts, trib: true });
    }
  }
}

/**
 * 河格底质回填：把 `T_RIVER` 格替换为**最近的非水体地形**，产出 `BuiltWorld.baseCells`。
 *
 * 河流的水面不再由 cells 承担（见 `BuiltWorld.baseCells` 注释），所以 GL / Canvas2D
 * 的地表渲染必须知道「河床底下原本是什么」——山地里的河，两岸就该继续是山地，
 * 而不是沿河糊出一条谁也不认识的水面宽带。
 *
 * 算法：以全部陆地为多源做 8 邻域 BFS，只允许扩散进河格，先到先得 ⇒
 * 每格取到的是「最近陆地地形」（棋盘距离），纯函数 + 确定性，同 cells 必出同结果。
 * 海 / 湖自身仍是水面（不参与回填，也不作为扩散源）。
 *
 * 兜底：整图全是河（无陆地源）时该格退化为草原，避免留下 0（= 大海）把图变蓝。
 */
export function fillRiverBase(cells: ArrayLike<number>, cols: number, rows: number): Uint8Array {
  const n = cols * rows;
  const out = new Uint8Array(n);
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;

  for (let i = 0; i < n; i++) {
    const t = cells[i] ?? 0;
    out[i] = t;
    if (t === T_RIVER) continue;
    if (t === T_SEA || t === T_LAKE) continue;
    dist[i] = 0;
    queue[qt++] = i;
  }

  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  while (qh < qt) {
    const cur = queue[qh++];
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (let k = 0; k < 8; k++) {
      const ax = cx + DX[k];
      const ay = cy + DY[k];
      if (ax < 0 || ay < 0 || ax >= cols || ay >= rows) continue;
      const ni = ay * cols + ax;
      if (dist[ni] >= 0) continue;
      if ((cells[ni] ?? 0) !== T_RIVER) continue;
      dist[ni] = dist[cur] + 1;
      out[ni] = out[cur];
      queue[qt++] = ni;
    }
  }

  for (let i = 0; i < n; i++) {
    if (out[i] === T_RIVER) out[i] = T_GRASS;
  }
  return out;
}

// ── 叠加型符号（岛屿/瀑布，§5.1 叠加型）──
// ⚠️ 设计变更：叠加型符号一律由栅格**确定性派生**（不在存档里维护），具体为
//   ① 瀑布 = 只在「高差格边 ∩ 河道」处生成，落点吸附到崖唇中点（绝不再漂在水上），
//      跌落方向在派生时按低侧法线算好（`angle` 字段），渲染层不用再猜；
//      互相间隔 ≥ 8 格、全图至多 2 处；
//   ② 岛屿 = 海中孤立小陆块（洪泛找簇 + 求质心）。
//
// 为什么没有「悬崖」符号：高差格边上覆一层折线 + 崖齿，实测在成片山地/雪原边缘
// 会沿等高线糊出一圈圈「梳齿状」黑线（见截图红框），既不像地貌也压住了地形本身；
// 山地起伏改由 GL 侧的地形晕渲（hillshade）表达，观感更干净。故整类符号已删除。
//
// 派生式的收益：手改地形后符号自动跟随；旧存档无需迁移，打开即自愈
// （存档里的 cliff/waterfall/island 会被忽略后重算）。

/** 视为「高侧」的地形（瀑布只在它们与低地的交界上生成） */
function isHighTerrain(t: number): boolean {
  return t === T_MOUNTAIN || t === T_SNOW;
}

interface OverlayInput {
  cols: number;
  rows: number;
  cells: ArrayLike<number>;
  /** 已有河流 feature（用其 pts 判定瀑布落点；无渠道存档自然不出瀑布） */
  rivers?: TerrainFeature[];
  seed: number;
}

/**
 * 从栅格派生叠加型符号（纯函数，可独立单测）。
 * 同 cells 必出同结果 —— 与 RM8 复现性同一套语义。
 */
export function buildOverlayFeatures(input: OverlayInput): TerrainFeature[] {
  const { cols, rows, cells, seed } = input;
  const feats: TerrainFeature[] = [];
  let fid = 0;
  const nextId = (t: string): string => `${t}_${((seed + fid++ * 2654435761) >>> 0).toString(16)}`;

  // ── ① 崖边集合：高侧格与低侧格之间的格边 ──
  const high = new Uint8Array(cols * rows);
  for (let i = 0; i < high.length; i++) high[i] = isHighTerrain(cells[i] ?? 0) ? 1 : 0;

  /**
   * 每格 → 相邻「高差格边」的中点（世界坐标）+ 低侧方向（指向较低一格）。
   * 瀑布的水帘朝低侧跌落，方向在这里一次算准（渲染层不必再反推）。
   */
  const lipX = new Float32Array(cols * rows).fill(-1);
  const lipY = new Float32Array(cols * rows);
  const lipNx = new Int8Array(cols * rows);
  const lipNy = new Int8Array(cols * rows);
  const forWater = new Uint8Array(cols * rows);

  const noteCell = (c: number, r: number, mx: number, my: number, nx: number, ny: number): void => {
    const i = r * cols + c;
    if (i < 0 || i >= lipX.length || lipX[i] >= 0) return;
    lipX[i] = mx;
    lipY[i] = my;
    lipNx[i] = nx;
    lipNy[i] = ny;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const hi = high[i] === 1;
      const midX = (c + 0.5) * CELL;
      const midY = (r + 0.5) * CELL;
      if (c + 1 < cols && high[i + 1] !== high[i]) {
        // 竖边：x = (c+1)*CELL；低侧在该边右（高侧在左）或左
        const mx = (c + 1) * CELL;
        const nx = hi ? 1 : -1;
        noteCell(c, r, mx, midY, nx, 0);
        noteCell(c + 1, r, mx, midY, nx, 0);
        forWater[i] = 1;
        forWater[i + 1] = 1;
      }
      if (r + 1 < rows && high[i + cols] !== high[i]) {
        const my = (r + 1) * CELL;
        const ny = hi ? 1 : -1;
        noteCell(c, r, midX, my, 0, ny);
        noteCell(c, r + 1, midX, my, 0, ny);
        forWater[i] = 1;
        forWater[i + cols] = 1;
      }
    }
  }

  // ── ① 瀑布：高差格边 ∩ 河道 ──
  const picked: Array<{ x: number; y: number }> = [];
  for (const rv of input.rivers ?? []) {
    if (rv.type !== "river" || !rv.pts) continue;
    for (let k = 0; k + 1 < rv.pts.length; k += 2) {
      const c = Math.floor(rv.pts[k] / CELL);
      const r = Math.floor(rv.pts[k + 1] / CELL);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      if (forWater[i] !== 1 || lipX[i] < 0) continue;
      const x = lipX[i];
      const y = lipY[i];
      // 间隔约束：两处瀑布至少隔 8 格，避免崖壁上挂满瀑布
      if (picked.some((p) => Math.hypot(p.x - x, p.y - y) < CELL * 8)) continue;
      picked.push({ x, y });
      feats.push({
        id: nextId("waterfall"),
        type: "waterfall",
        points: [{ x, y }],
        // 跌落方向 = 低侧法线（画布 y 轴向下，故 atan2(ny, nx)）
        angle: Math.atan2(lipNy[i], lipNx[i]),
        seed: String(seed),
      });
      if (picked.length >= 2) break;
    }
    if (picked.length >= 2) break;
  }

  // ── ② 岛屿：海中被海包围的孤立小陆块 ──
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
      if (enclosed && cluster.length >= 2 && cluster.length <= 18) {
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

  return feats;
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
  const wet = new Float32Array(n);
  const ruin = new Float32Array(n);
  const lava = new Float32Array(n);
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
      // 海岸以外还有一圈「邻海开口」用：到最近的贴边距离（0 = 贴边）
      const edgeDist = Math.min(nx, 1 - nx, ny, 1 - ny);

      let shape = clamp01((0.62 - Math.sqrt((nx - 0.5) ** 2 * 1.3225 + (ny - 0.5) ** 2)) / 0.44);
      if (tpl.threeSea) {
        const sideFade = Math.min(clamp01(nx / 0.26), clamp01((1 - nx) / 0.26));
        const southFade = clamp01((1 - ny) / 0.34);
        shape = Math.min(sideFade * 0.82 + 0.18, southFade * 0.88 + 0.12);
      }
      if (tpl.island) {
        shape = clamp01((0.48 - Math.sqrt((nx - 0.5) ** 2 * 1.6384 + (ny - 0.5) ** 2)) / 0.3);
      }
      if (tpl.centralContinent) {
        // 中央大陆（九州）：矩形化超椭圆大陆 + 四周环海，海岸线比默认更「方正」
        const sq = Math.max(Math.abs(nx - 0.5) * 1.24, Math.abs(ny - 0.5) * 1.06);
        shape = clamp01((0.44 - sq) / 0.2);
      }
      if (tpl.archipelago) {
        // 群岛海域：小半径岛核 + 高频噪声切碎 → 碎岛散布
        const core = clamp01((0.26 - Math.sqrt((nx - 0.5) ** 2 * 1.2 + (ny - 0.5) ** 2)) / 0.18);
        shape = core * (0.35 + 1.05 * fbm(u * 2.4 + 5.1, v * 2.4 + 9.4, s + 733, 3));
      }

      let h = fbm(u, v, s, 5) * 0.72 + shape * 0.62;
      if (tpl.centerLake) {
        const dl = Math.sqrt((nx - 0.48) ** 2 * 1.44 + (ny - 0.52) ** 2);
        if (dl < 0.2) h -= 0.52 * (1 - dl / 0.2);
      }
      if (tpl.tenThousandMountains) {
        // 十万大山：自北向南抬升的高原山国，山脊连绵（山多平原少的经典格局）
        const band = clamp01((ny - 0.22) / 0.5);
        h += 0.30 * band * (0.55 + 0.9 * fbm(u * 1.15 + 17.7, v * 1.15 + 3.3, s + 1901, 3));
      }
      if (tpl.riftCanyon) {
        // 裂谷天堑：一条蜿蜒南北向的深谷贯通全图
        const cxr = 0.5 + 0.17 * Math.sin(ny * 5.2 + 0.7) + 0.06 * Math.sin(ny * 11.3);
        const dl = Math.abs(nx - cxr);
        if (dl < 0.085) h -= 0.30 * (1 - dl / 0.085);
      }
      if (tpl.southSwamp) {
        // 南疆沼泽：南部整体下沉成低洼水乡
        h -= 0.16 * clamp01((ny - 0.52) / 0.4);
      }
      elev[i] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;

      // 湿度（低 → 沙漠）：西面沙漠 / 东荒 / 荒芜 / 火山都会压低
      let m = fbm(u * 0.85 + 7.3, v * 0.85 + 2.1, s + 311, 4);
      if (tpl.westDesert) m *= 0.18 + 0.82 * clamp01((nx - 0.1) / 0.44);
      else if (tpl.eastWaste) m *= 0.18 + 0.82 * clamp01((0.9 - nx) / 0.44);
      else if (tpl.barren || tpl.ruinFields || tpl.volcanic) m *= 0.62;
      mo[i] = m;

      let cd = 0;
      if (tpl.northSnow) {
        cd = clamp01((0.4 - ny) / 0.36) * (0.78 + 0.44 * fbm(u * 1.5 + 3.1, v * 1.5 + 8.8, s + 977, 3));
      }
      let rg = fbm(u * 1.7 + 11.3, v * 1.7 + 4.9, s + 5231, 3);
      // 山脊强度才是「山多山少」的真正杠杆（海平面取分位数，压缩高程无效）：
      // 十万大山整体抬脊 → 山地成片；千里平原压脊 → 几乎无山
      if (tpl.tenThousandMountains) {
        rg = Math.min(1, rg + 0.46 * clamp01((ny - 0.16) / 0.5) + 0.3);
      } else if (tpl.plains) {
        rg *= 0.7;
      }
      cold[i] = cd;
      ridge[i] = rg;

      // 湿润洼地度（高 → 沼泽）：南疆偏置 + 贴边（近海）加成
      let w = fbm(u * 1.25 + 21.9, v * 1.25 + 6.4, s + 4409, 3) * 0.72;
      if (tpl.southSwamp) w += 0.46 * clamp01((ny - 0.42) / 0.42);
      if (tpl.centerLake || tpl.bigRiver) w += 0.1;
      wet[i] = Math.min(1, w + 0.1 * clamp01((0.18 - edgeDist) / 0.18));

      // 废墟度（高 → 废墟）：古战场 / 东荒 / 火山遗址
      let ru = fbm(u * 1.9 + 31.3, v * 1.9 + 2.7, s + 6607, 3) * 0.78;
      if (tpl.ruinFields) ru += 0.32;
      if (tpl.eastWaste || tpl.volcanic) ru += 0.2;
      ruin[i] = ru;

      // 熔岩度（仅赤炎火山模板 > 0）：沿低频裂隙产出岩浆带
      lava[i] = tpl.volcanic
        ? fbm(u * 1.35 + 43.1, v * 1.35 + 12.5, s + 8123, 3) * 1.02
        : 0;
    }
  }

  // ② 归一化 + 分位数定海平面
  const span = hi - lo || 1;
  for (let i = 0; i < n; i++) elev[i] = (elev[i] - lo) / span;
  const sorted = Array.from(elev).sort((a, b) => a - b);
  const seaTarget = tpl.archipelago
    ? 0.66
    : tpl.island
      ? 0.7
      : tpl.centralContinent
        ? 0.4
        : tpl.threeSea
          ? 0.52
          : tpl.tenThousandMountains || tpl.plains
            ? 0.34
            : 0.45;
  const seaLevel = sorted[Math.floor(n * seaTarget)] ?? 0.45;

  // ③ 分类
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const nx = cols > 1 ? c / (cols - 1) : 0.5;
      const ny = rows > 1 ? r / (rows - 1) : 0.5;
      const h2 = elev[i];

      if (tpl.centerLake) {
        const dl2 = Math.sqrt((nx - 0.48) ** 2 * 1.44 + (ny - 0.52) ** 2);
        if (dl2 < 0.15 && h2 < seaLevel + 0.07) {
          cells[i] = T_LAKE;
          continue;
        }
      }
      const t =
        h2 < seaLevel
          ? T_SEA
          : pickLand({
              h: h2,
              seaLevel,
              mo: mo[i],
              cold: cold[i],
              rg: ridge[i],
              wet: wet[i],
              ruin: ruin[i],
              lava: lava[i],
              plains: tpl.plains,
              mtn: tpl.tenThousandMountains ? 0.16 : 0,
              flat: opt.flat,
            });
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

  // ⑤ 河流（先刻河道，再派生叠加型符号 —— 瀑布判定依赖河道位置）
  const want = tpl.bigRiver || tpl.southSwamp ? 2 : 1;
  for (let k = 0; k < want; k++) {
    carveRiver(world, s + k * 7717, k === 0 ? 0.22 : 0.72);
  }
  const rivers = world.features.slice();
  world.features.push(
    ...buildOverlayFeatures({ cols, rows, cells: world.cells, rivers, seed: s }),
  );
  // ⑥ 地表底质（河格回填为最近陆地地形）：地表渲染读它，河由 2D 层按 pts 单独绘制
  world.baseCells = fillRiverBase(world.cells, cols, rows);
  return world;
}

/** 生成随机 seed（16 进制 6 位，对齐设计稿格式） */
// ── 手绘后的一致性校验（RM9）──

/**
 * 丢弃「河道已被地形画笔抹掉」的河流 feature。
 *
 * 背景：features 存档独立于一维 cells，用户把河道涂成沙漠后旧实现依然原样绘制，
 * 出现「河流悬在沙漠上」。这里按「沿线采样点是否仍紧邻水体」做确定性裁剪。
 *
 * 判定：路径采样点 3×3 邻域内仍有 T_RIVER 记为命中；命中率低于 THRESHOLD 即丢弃。
 * （留容差是因为 ribbon 中心线与实际河道格可能错开半格）
 *
 * 非河流要素原样返回；无采样点（异常数据）按保留处理，避免误删用户内容。
 */
export function pruneStaleRivers(
  features: TerrainFeature[],
  cells: ArrayLike<number>,
  cols: number,
  rows: number,
  cell: number = CELL,
): TerrainFeature[] {
  const THRESHOLD = 0.6;
  const out: TerrainFeature[] = [];
  for (const f of features) {
    if (f.type !== "river" || !f.pts || f.pts.length < 4) {
      out.push(f);
      continue;
    }
    let total = 0;
    let hit = 0;
    for (let i = 0; i + 1 < f.pts.length; i += 2) {
      const cx = Math.floor(f.pts[i] / cell);
      const cy = Math.floor(f.pts[i + 1] / cell);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      total++;
      if (hasRiverAround(cells, cols, rows, cx, cy)) hit++;
    }
    if (total === 0 || hit / total >= THRESHOLD) out.push(f);
  }
  return out;
}

/** 格点 3×3 邻域内是否存在河流格 */
function hasRiverAround(
  cells: ArrayLike<number>,
  cols: number,
  rows: number,
  cx: number,
  cy: number,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= rows) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= cols) continue;
      if (cells[y * cols + x] === T_RIVER) return true;
    }
  }
  return false;
}

export function randomSeed(): string {
  return Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0")
    .toUpperCase();
}

/**
 * 从已存储的 content.terrain 重建可渲染 BuiltWorld（编辑已有地图时用）。
 * 不重新程序化生成，直接复用存档 cells；elev 用轻量径向梯度近似，
 * 仅用于等值线观感，不影响地形分类。
 *
 * ⚠️ 叠加型符号（岛屿/瀑布）**不从存档回读，一律由 cells 重新派生**：
 * - 派生保证符号与地形永远一致（手改地形后瀑布自动跟随，不会「悬在平原上」）
 * - 旧存档里的 cliff / 漂在水面的瀑布会被直接忽略 → 打开旧图即自愈
 * - 存档只需保留河流 feature（河道走向无法从 1 格宽 cells 唯一还原）
 */
export function worldFromContent(opts: {
  cols: number;
  rows: number;
  cells: number[];
  features?: Array<{
    id?: string;
    type: "island" | "waterfall" | "river";
    points?: Array<{ x: number; y: number }>;
    cells?: number[];
    pts?: number[];
    angle?: number;
    seed?: string;
    trib?: boolean;
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
  const rivers: TerrainFeature[] = (opts.features ?? [])
    .filter((f) => f.type === "river")
    .map((f) => ({
      id: f.id,
      type: "river" as const,
      pts: f.pts,
      seed: f.seed,
      trib: f.trib,
    }));
  // 手改地形后按 cells 复核河流：河道已被涂掉的 feature 直接丢弃，
  // 否则会出现「河悬在沙漠上」（旧实现把 features 原样塞回，不做任何校验）
  const feats = pruneStaleRivers(rivers, arr, cols, rows);
  const snum = hashSeed(opts.seed ?? "map");
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
    features: feats.concat(buildOverlayFeatures({ cols, rows, cells: arr, rivers: feats, seed: snum })),
    snum,
    // 地表底质每次重建（涂刷后 entries 会重跑本函数）：保证 GL/Canvas2D 读到的
    // 「河床底下是什么」与当前 cells 严格同步
    baseCells: fillRiverBase(arr, cols, rows),
  };
}
