/**
 * 国家区域生成（2.50.0）—— 照抄逆向目标的分块算法。
 *
 * ## 为什么整个换掉（不再用 Voronoi）
 *
 * 旧实现是"在陆地包围盒里摆一圈抖动网格种子 → 每个种子拿 Voronoi 单元 → 边界加噪声"。
 * 它有两个**结构性**后果，用户一眼就看出来：
 *
 *   ① **面积几乎相等**。抖动网格的格子一样大，于是每个国家一样大 —— 读起来像
 *      行政区划图（"每块都差不多"），不像一片大陆上自然长出来的列国。
 *   ② **边界是直线**。Voronoi 边是垂直平分线，噪声只能小幅抖动它；两条块的边
 *      在同一条直线上对接，纵深一放大就是"切蛋糕"。
 *
 * 参考实现（`decoded.js` 的 `D` / `fa` / `da` / `ya`）走的是完全不同的路子：
 *
 * ```
 * ① 把**道路网**按端点连通性分簇（R：洪水填充）
 * ② 簇数多于目标数时，反复合并"最近的两簇"（L）
 * ③ 每簇所有节点取**凸包**（ConvexHull）—— 簇是聚落连成的，凸包天然大小悬殊
 * ④ 凸包向内缩 30 单位，在其中按格采样出**种子格**（fa）
 * ⑤ 从种子格向外做「先到先得」的邻域生长，直到把陆地占满（da + z）
 * ⑥ 每国占有的**六边形格集合**沿格边追出轮廓（= 参考的 unionShape）
 * ⑦ 轮廓过点插值平滑（参考捆的 turf 样条版 polygonSmooth；渲染器本身用
 *    `GetCurvePolygonCtrlPoint` + bezierCurveTo 过每个顶点）
 * ⑧ 栅格化收尾：平滑环画进画布 → 与陆地掩膜相交际（`ra` 的 destination-in）→
 *    后画的国家把先画的国家切齐（`CutRangePolygon`）→ 从像素重追轮廓
 *    （`GetCanvasOutlines`）—— 边界永不越海、国与国零缝隙零叠色
 * ```
 *
 * 观感的差别全在 ④⑤：国家边界不是"分界线的位置"，而是"生长停在哪里"，于是
 * 边界沿格子的锯齿走、被邻居挤成不规则形状；而面积由**路网簇的大小**决定，
 * 聚落密的地区分得细、疏的地区是一个大国 —— 正是截图里那种"疆域很和谐"的读法。
 *
 * ## 顺带解决的老问题
 *
 * 格集合**天然互斥**（每格只属于一国），所以国与国之间**不可能重叠** ——
 * 2.48.0 花了一整轮修 `clipHalfPlanePieces` 的 7% 叠色带，在新算法下不存在。
 * 新版仍保留 `region-land-audit.test.ts` 的重叠率守卫，作为回归底线。
 *
 * ## 与参考的差异（都是显式选择，不是做不到）
 *
 * · 格边长按**纸宽比例**取（参考写死 40 / 1587 宽 = 2.52%），换画布不用重调；
 * · 生长轮数参考固定 5 轮（它的凸包已覆盖大半陆地）；我们的陆地更碎，改成
 *   "5 轮起、最多 40 轮、收敛即停"，并加"未归属率 < 2%"守卫 —— 否则海岸边会
 *   留一圈没有国家的空地，看起来像漏填色；
 * · 种子簇若只用"道路连通分量"，本项目的一键成图路网是**连通树**（每点连最近邻，
 *   全陆连通）⇒ 永远只有 1 个簇。因此簇数不足目标数时退回**最远点采样**补种子
 *   （见 `splitClusters`），保证数量可控且仍不回到均匀网格。
 */
import type { MapLand, MapPolyline, Point, Rect } from "../types";
import { pointInLand } from "../land";
import {
  REGION_PALETTE_RGB,
  assignRegionColors,
  createRng,
  polygonArea,
  polygonCentroid,
  type MapRegion,
} from "../regions";
import { makeCountryNames } from "./countryNames";

/* ────────────────────────── 参数（逆向源值） ────────────────────────── */

/**
 * 国家数量上限。
 *
 * 参考 `decoded.js@967505`：`void 0!=a.countries&&(J=parseInt(a.countries.length),20<J&&(J=20))`
 * —— 源码允许 20，但**实际观感**（用户截图与官方示例）是"一块大陆十来个国家"。
 * 本项目取 12：与 9 格色板配得上"每国一色"，也覆盖参考成图的密度。
 */
export const COUNTRY_MAX = 12;

/** 至少要有 2 个国家才谈得上"疆域"；1 国等于整个陆地一块色 */
export const COUNTRY_MIN = 2;

/** 默认数量（= 上限，一键成图不填时按它走） */
export const COUNTRY_DEFAULT = COUNTRY_MAX;

/**
 * 六边形格边长，按**纸宽比例**给（参考 40 / 1587 ≈ 2.52%）。
 *
 * 【为什么用比例而不是绝对值】参考的 page_size 会随设备变（1587 或 3174），
 * 它自己也是拿 40 硬顶在 1587 上的；我们换画布（2.50.0 改成 1447×1024）时
 * 要是照抄 40，格子相对变小、边界细节翻倍，观感会跟参考对不上。
 */
export const HEX_RADIUS_RATIO = 40 / 1587;

/** 凸包内缩量（参考 `createPolygonBuffer(shape, -30)`），同样按纸宽比例 */
export const HEX_INSET_RATIO = 30 / 1587;

/**
 * 生长轮数（每轮向外推 2 格）。
 *
 * 【为什么是 6 而不是参考的 5，也不是"跑到收敛"】参考只跑 5 轮 —— 它的国家形状
 * 基本就是"凸包内缩"的样子，生长只负责把相邻两国的缝补上。我们一开始跑到收敛
 * （40 轮），12 国全被推成一样大的圆团（面积比 4.9 但形状一模一样），因为"先到
 * 先得"的扩张会把种子域的个性抹平。6 轮之后调到"形状保留 + 缝隙补满"的平衡点：
 * 面积比 4.4~6.4、未归属率 < 8%，与参考成图同一区间。
 */
export const GROW_ROUNDS = 6;

/** 参考自己的固定轮数（`c<5`），留作注释锚点与测试断言 */
export const GROW_REFERENCE_ROUNDS = 5;

/** 生长轮数硬上限（防调用方传错把整张纸推平） */
export const GROW_MAX_ROUNDS = 24;

/**
 * 未归属率验收线（守卫用）。
 *
 * 【为什么是 8% 而不是 2%】口径是"陆地格心是否落在某个国家多边形内"，而多边形
 * 经过 Chaikin 平滑、边界会向内收半个格 —— 贴着海岸那一圈格心落在外面属于正常。
 * 真正要防的是"整片内陆没有国家"：那种情况下这个数会直接跳到 40% 以上。
 */
export const UNCLAIMED_CENTER_MAX_RATE = 0.08;

/**
 * 单国种子格数的上限倍数（相对各国均值）。
 *
 * 2.0 是实测出来的：1.5 起跑线太平均，国家的"大小差别"被抹平（面积比回落到
 * 1.8，重新像行政区划图）；3.0 时大凸包又能吃掉半个大陆（面积比 20+）。
 */
export const SEED_CAP_RATIO = 2;

/**
 * 【已退役】国家边界平滑不再走 Chaikin —— 换成下面的过点插值曲线
 * （`flattenCurveRing`）。Chaikin 保留为导出工具：每轮点数翻倍且不自交，
 * `countries.test.ts` 仍用它做几何性质守卫。
 */
/** 平移到格坐标时的轴向基（flat-top 六边形）：x = 1.5R·q，y = √3R·(r + q/2) */
const SQRT3 = Math.sqrt(3);

/* ────────────────────────── 六边形格网 ────────────────────────── */

/**
 * flat-top 六边形格网（尖朝左右、上下各一条平边）。
 *
 * 与参考 `drawGridPolygon(x, y, 40, …)` 的六角一致 —— `Q()` 里那六个角点
 * `(x,y) (x+40,y) (x+60,y+34.64) (x+40,y+69.28) (x,y+69.28) (x-20,y+34.64)`
 * 正是以 `(x+20, y+34.64)` 为中心、边长 40、角在 0°/60°/…/300° 的正六边形。
 */
export interface HexGrid {
  /** 边长 */
  radius: number;
  /** 纸面中心（= 世界原点偏移；用 axial 坐标时原点是格 (0,0) 的中心） */
  origin: Point;
  /** 列数（axial q 的取值范围是一个区间，这里只用来做边界收敛） */
  cols: number;
  rows: number;
}

/** 按纸面矩形建格网 */
export function hexGridOf(bounds: Rect): HexGrid {
  const radius = Math.max(8, bounds.width * HEX_RADIUS_RATIO);
  const stepX = 1.5 * radius;
  const stepY = SQRT3 * radius;
  // 原点放在纸中心，让轴向坐标关于中心对称（抖动/生长都对称，不会往一角偏）
  return {
    radius,
    origin: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    cols: Math.ceil(bounds.width / stepX) + 2,
    rows: Math.ceil(bounds.height / stepY) + 2,
  };
}

/** axial → 世界坐标（格中心） */
export function hexCenter(grid: HexGrid, q: number, r: number): Point {
  return {
    x: grid.origin.x + 1.5 * grid.radius * q,
    y: grid.origin.y + SQRT3 * grid.radius * (r + q / 2),
  };
}

/** 世界坐标 → axial（四舍五入到最近格） */
export function hexAt(grid: HexGrid, p: Point): { q: number; r: number } {
  const x = (p.x - grid.origin.x) / grid.radius;
  const y = (p.y - grid.origin.y) / grid.radius;
  // 反解：q = 2x/3，r = -x/3 + y/√3
  const fq = (2 / 3) * x;
  const fr = -x / 3 + y / SQRT3;
  return roundAxial(fq, fr);
}

/**
 * cube 坐标四舍五入（保证落到"最近格"，直接对 q/r 取整会在格边附近错一格）。
 *
 * 参考用 `drawGridPolygon(x,y,40)` 做同一件事（内部也是最近格吸附）。
 */
function roundAxial(fq: number, fr: number): { q: number; r: number } {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/**
 * 六边形第 i 个角（i = 0..5，角度 60°·i）。
 *
 * 角 0 在 (R, 0)；因格中心到邻居的距离方向是 30°/90°/…，所以**边 i** 连接
 * 角 i 与角 i+1，其外法线指向邻居方向 i（映射见 `HEX_NEIGHBORS`）。
 */
export function hexCorner(center: Point, radius: number, i: number): Point {
  const a = (Math.PI / 3) * i;
  return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
}

/**
 * 六个邻居方向，**顺序与边一一对应**：`HEX_NEIGHBORS[i]` 方向的邻居若不存在，
 * 说明第 i 条边（角 i → 角 i+1）是边界。
 *
 * 方向角依次 0°/60°/…/300°，与 axial 的 (1,0),(0,1),(-1,1),(-1,0),(0,-1),(1,-1) 对应。
 */
export const HEX_NEIGHBORS: readonly { q: number; r: number }[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

/** 轴向坐标的稳定 key */
function cellKey(q: number, r: number): string {
  return `${q},${r}`;
}

/* ────────────────────────── 几何小工具 ────────────────────────── */

/**
 * 凸包（Andrew monotone chain）。
 *
 * 【为什么自己写】参考调 `algorithm.ConvexHull`；本项目没有几何库，而凸包是
 * 三十行的确定性算法 —— 引一个依赖只为一件事不值得，而且测试要能钉住顶点顺序。
 */
export function convexHull(points: readonly Point[]): Point[] {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const pts = points
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** 点到线段距离 */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 点到环边界的最近距离（用于"内缩 N 单位"的判据） */
export function distToRing(p: Point, ring: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const d = distToSegment(p, ring[i], ring[(i + 1) % ring.length]);
    if (d < best) best = d;
  }
  return best;
}

/** 点是否在环内（射线法；与 regions.ts 的实现同口径但只服务本模块的凸包判定） */
function inRing(p: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 闭合环平滑（Chaikin）。
 *
 * 【2.50.1 起不再是国家边界的平滑器】Chaikin 是**切角**算法，每条边的中间 50%
 * 保持直线 —— 实测整条边界全是 18.2px 等长直段（p50=p99=18.2），放大后就是
 * "多边形感"。国家边界已改走 `flattenCurveRing`（过点插值 + 栅格化收尾）。
 * 本函数保留：每轮点数翻倍、不自交、不越出原包围盒，作为几何工具与守卫样本。
 */
export function chaikin(ring: readonly Point[], passes: number): Point[] {
  let cur = ring.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < passes; pass += 1) {
    if (cur.length < 3) break;
    const next: Point[] = [];
    for (let i = 0; i < cur.length; i += 1) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    cur = next;
  }
  return cur;
}

/* ── 过点插值曲线（参考 algorithm 模块 `GetCurvePolygonCtrlPoint` + `bezierCurveLinearFun` + `R`）── */

/**
 * 控制点系数（参考 `H`/`h` 里的默认值 `c=d=0.25`）。
 *
 * 【为什么不再用 Chaikin】Chaikin 是**切角**算法：把每个角换成 1/4、3/4 两个新点，
 * 每条边的中间 50% 保持直线 —— 实测整条边界全是 18.2px 的**等长**直段
 * （`__tmp-border-metrics` 的 p50=p99=18.2），方向每段转折 30°~60°，
 * 读起来就是"多边形"。而参考成图的高倍截图是**连续变曲率**的不规则曲线。
 * 参考捆的 turf.min.js（2016-2018 年代的构建）里 `polygonSmooth` 是样条
 * **插值**实现（过顶点的 Catmull-Rom 族；npm 5.0.0 起才重写成 Chaikin），
 * 其渲染器 `polygon_type 1/3` 更是直接用 `GetCurvePolygonCtrlPoint` +
 * `bezierCurveTo` 过每个顶点画线 —— 过点插值正是"平滑但棱角位置不丢"的原因。
 */
export const CURVE_CTRL_RATIO = 0.25;

/**
 * 曲线采样步长（世界单位）。参考 `R` 里 `g = parseInt(dist / gb)`、`gb = 2` ——
 * 每 2 单位采一个点，密到后续按像素重追轮廓时曲线形状不丢细节。
 */
export const CURVE_SAMPLE_PX = 2;

/**
 * 闭合环上第 i 段（顶点 i → 顶点 i+1）的贝塞尔控制点。
 *
 * 逐字对应参考 `GetCurvePolygonCtrlPoint`（`H`）的闭包版：
 *   cP1 = P[i]   + (P[i+1] − P[i−1]) × 0.25
 *   cP2 = P[i+1] − (P[i+2] − P[i])   × 0.25
 * 下标按闭合环取模 —— `H` 里那串 `b==a.length-2 ? … : b==a.length-1 ? …` 分支
 * 就是模运算的手写展开。曲线在 t=0/1 处**穿过原始顶点**：相邻两国共享的格顶点
 * 在两边的曲线上都是同一个点，三国交界处不会再切出三角形缝隙。
 */
export function curveControlPoints(
  ring: readonly Point[],
  i: number,
): { pA: Point; pB: Point } {
  const n = ring.length;
  const p0 = ring[i % n];
  const p1 = ring[(i + 1) % n];
  const prev = ring[(i - 1 + n) % n];
  const next = ring[(i + 2) % n];
  const k = CURVE_CTRL_RATIO;
  return {
    pA: { x: p0.x + (p1.x - prev.x) * k, y: p0.y + (p1.y - prev.y) * k },
    pB: { x: p1.x - (next.x - p0.x) * k, y: p1.y - (next.y - p0.y) * k },
  };
}

/** 三次贝塞尔（参考 `bezierCurveLinearFun` 逐字移植） */
function bezierAt(t: number, p0: Point, pA: Point, pB: Point, p1: Point): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * t * u * u;
  const c = 3 * t * t * u;
  const d = t * t * t;
  return {
    x: p0.x * a + pA.x * b + pB.x * c + p1.x * d,
    y: p0.y * a + pA.y * b + pB.y * c + p1.y * d,
  };
}

/**
 * 闭合环 → 过点插值的密集折线。
 *
 * 对应参考 `R` + `ca` 的展平：每段按 `parseInt(dist / gb)`（最少 2 段）采样，
 * 输出**含每段终点**（下一段从 t>0 起，顶点不被重复）。t=0 处的点就是原始顶点，
 * 所以共享顶点在输出里原样保留。
 */
export function flattenCurveRing(ring: readonly Point[]): Point[] {
  if (ring.length < 3) return [...ring];
  const out: Point[] = [ring[0]];
  for (let i = 0; i < ring.length; i += 1) {
    const p0 = ring[i];
    const p1 = ring[(i + 1) % ring.length];
    const { pA, pB } = curveControlPoints(ring, i);
    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const steps = Math.max(2, Math.floor(dist / CURVE_SAMPLE_PX));
    for (let s = 1; s <= steps; s += 1) {
      out.push(bezierAt(s / steps, p0, pA, pB, p1));
    }
  }
  return out;
}

/* ──────────────── 边界描边几何（参考 ra → Ma(oa) 链，2.52.0） ──────────────── */

/**
 * 像素轮廓的 RDP 抽稀容差（世界单位）。
 *
 * 【为什么是 1.2】参考 `La`（GetCanvasOutlines 内核）追出的像素环**全部**要过
 * `Ma(p, 1.2)` —— 容差 1.2px 的 Ramer–Douglas–Peucker 抽稀（`oa` + `Ma`）。
 * 这一步正是"参考放大后没有矩形锯齿"的原因：1 单位一步的像素台阶离对角弦
 * 最远只有 ~0.5 单位 < 1.2，整段台阶被塌成一条对角直线，锯齿在**几何上**
 * 消失（而不是被线宽盖住）；残留的大起伏（> 1.2）才是真正的地貌特征，
 * 交给 `flattenCurveRing` 圆化成连续变曲率。
 */
export const BORDER_RDP_TOL = 1.2;

/**
 * 开折线的 Ramer–Douglas–Peucker 抽稀（参考 `oa` 逐字移植）。
 *
 * 栈式实现：首尾点恒保留，反复找"离当前弦最远且超容差"的点分段。
 * 距离用**点到直线的垂距平方**（弦长为零时退化为点到点距离平方），
 * 与参考 `v=v*v/n` 的口径一致 —— 垂距对长弦的宽容差语义是 RDP 的本意。
 */
export function rdpSimplifyOpen(points: readonly Point[], tol: number): Point[] {
  const n = points.length;
  if (n <= 2) return [...points];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tol * tol;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const end = stack.pop() as number;
    const start = stack.pop() as number;
    if (end - start < 2) continue;
    const a = points[start];
    const b = points[end];
    const bx = b.x - a.x;
    const by = b.y - a.y;
    const len2 = bx * bx + by * by;
    let worst = -1;
    let worstAt = -1;
    for (let i = start + 1; i < end; i += 1) {
      const p = points[i];
      const px = p.x - a.x;
      const py = p.y - a.y;
      let d2: number;
      if (len2 > 0) {
        const cross = px * by - py * bx;
        d2 = (cross * cross) / len2;
      } else {
        d2 = px * px + py * py;
      }
      if (d2 > worst) {
        worst = d2;
        worstAt = i;
      }
    }
    if (worst > tol2 && worstAt > 0) {
      keep[worstAt] = 1;
      stack.push(start, worstAt, worstAt, end);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * 闭合环的 RDP 抽稀（参考 `Ma` 逐字移植）。
 *
 * RDP 只保首尾点，直接跑会把环缩成一条弦。参考的做法：从首点找**最远点**
 * 把环切成两段开折线，各走一遍 RDP，再去掉重复的拼接点 —— 两段端点都是
 * 环上的真实顶点，闭环语义不丢。
 */
export function simplifyClosedRing(ring: readonly Point[], tol: number): Point[] {
  const n = ring.length;
  if (n < 4) return [...ring];
  const first = ring[0];
  let far = -1;
  let farAt = 0;
  for (let i = 1; i < n; i += 1) {
    const dx = ring[i].x - first.x;
    const dy = ring[i].y - first.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > far) {
      far = d2;
      farAt = i;
    }
  }
  const halfA = rdpSimplifyOpen(ring.slice(0, farAt + 1), tol);
  const halfB = rdpSimplifyOpen([...ring.slice(farAt), first], tol);
  const merged = halfA.slice(0, halfA.length - 1).concat(halfB.slice(0, halfB.length - 1));
  return merged.length >= 3 ? merged : [...ring];
}

/** 描边低通的环形窗口半径（3 点三角窗，权 1/2/1） */
export const BORDER_LOWPASS_WINDOW = 1;

/** 描边低通轮数：2 轮把 1 单位台阶抹成连续斜线，实测偏离仍 ≤0.87 */
export const BORDER_LOWPASS_PASSES = 2;

/**
 * 环形窗口低通（凸组合 ⇒ 输出恒在邻域凸包内，偏离天然有界）。
 *
 * 与 Chaikin / 贝塞尔插值不同，它**不减少点数**：`region.polygon` 是像素级
 * 密集环，抽稀会把台阶塌成一根几十单位的长对角线（见 `simplifyClosedRing`
 * 的容差扫描），折线感反而更重；低通只把每个点往邻域重心挪一点，台阶仍在
 * 原位附近被抹成斜线，形状与点密度都保住。
 */
export function lowpassRing(
  ring: readonly Point[],
  window = BORDER_LOWPASS_WINDOW,
  passes = BORDER_LOWPASS_PASSES,
): Point[] {
  const n = ring.length;
  if (n < 3 || passes <= 0 || window <= 0) return [...ring];
  let cur: Point[] = ring.map((p) => ({ ...p }));
  for (let pass = 0; pass < passes; pass += 1) {
    const next: Point[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      let sx = 0;
      let sy = 0;
      let sw = 0;
      for (let k = -window; k <= window; k += 1) {
        const w = window + 1 - Math.abs(k);
        const p = cur[(i + k + n) % n];
        sx += p.x * w;
        sy += p.y * w;
        sw += w;
      }
      next[i] = { x: sx / sw, y: sy / sw };
    }
    cur = next;
  }
  return cur;
}

/**
 * 边界描边几何：**有界环形低通**（上屏用的最终一步）。
 *
 * 【参考链已逐段照抄，但这一段做了适配】`decoded.js` 的国家图章链是
 * `ra(c.polygon.shapeToBezierCurve(g))` → `GetCanvasOutlines`（`La`）追像素
 * 轮廓 → `Ma(p, 1.2)` RDP → `CreatePolygon(..., polygon_type: 6)` 用 `lineTo`
 * 折线渲染（`border_size:3 / #73562d / α1`）。本项目 2.50.1 补了栅格化收尾、
 * 2.51.0 补了过点插值，本轮把 `Ma/oa` 也逐字移植成 `simplifyClosedRing`
 * （保留作可回归基线）。
 *
 * 【为什么上屏不直接用 RDP】参考 RDP 的输入是**曲线栅格化**后的像素轮廓，
 * 曲率变化处留点密集；我们的输入是**六边形格生长追出的纯轴向台阶**，
 * 容差 1.2 会把整段台阶塌成一根长对角线 —— 12 国 20,628 点抽到 1,389 点，
 * 高倍目检是生硬的多边形折角（用户 2.50.0 就点名过"多边形边界感"）。
 * 调小容差也救不了：0.6 留 7,010 点但轴向锯齿还剩 5,063 段，等于没修。
 *
 * 【低通的量化结果，seed 777 / 12 国】轴向直段 12,162 → **88**（RDP 1.2 是
 * 147 但出折线）；描边点离填充边缘最大 **0.87** < 3 单位线宽的 1.5 半径；
 * 点数不变 ⇒ 连续曲线、零缝隙性质不受影响。
 *
 * ⚠️ **别在抽稀后接 `flattenCurveRing`**：稀疏点上控制点
 * `P[i]+(P[i+1]−P[i−1])×0.25` 会把贝塞尔甩出填充边缘 3.36 世界单位
 * （实测 3.55 反向偏离），描边与色块分家。填充几何恒用 `region.polygon`，
 * 只有描边走这里。
 */
export function smoothBorderRing(ring: readonly Point[]): Point[] {
  return lowpassRing(ring);
}

/* ────────────────────────── ① 种子簇（R） ────────────────────────── */

/** 把坐标量化成"端点 key"（道路端点在世界坐标里是浮点，直接比会漏接） */
function endpointKey(p: Point): string {
  return `${Math.round(p.x * 4)},${Math.round(p.y * 4)}`;
}

/**
 * 按**道路端点连通性**分簇（参考 `R` 的洪水填充）。
 *
 * 参考的 `R(a,b)` 判断两条边共享端点用**严格相等**；那是它的坐标都是整数格点。
 * 本项目路网坐标是浮点（A* 折线 + 抖动落位），所以先量化到 1/4 单位再比 ——
 * 否则"接在一起的两条路"会各成一簇，国家数会莫名暴涨。
 *
 * @returns 每簇收集到的**节点坐标**（只用端点，与参考 `link[0]`/`link[1]` 同口径）
 */
export function clusterRoadsByConnectivity(roads: readonly MapPolyline[]): Point[][] {
  const parent: number[] = roads.map((_, i) => i);
  const find = (i: number): number => {
    let x = i;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // 端点 key → 第一次见到它的道路下标
  const owner = new Map<string, number>();
  for (let i = 0; i < roads.length; i += 1) {
    const pts = roads[i].points;
    if (pts.length === 0) continue;
    const ends = [pts[0], pts[pts.length - 1]];
    for (const p of ends) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const k = endpointKey(p);
      const prev = owner.get(k);
      if (prev === undefined) owner.set(k, i);
      else union(prev, i);
    }
  }

  const groups = new Map<number, Point[]>();
  for (let i = 0; i < roads.length; i += 1) {
    const pts = roads[i].points;
    if (pts.length === 0) continue;
    const root = find(i);
    let g = groups.get(root);
    if (!g) {
      g = [];
      groups.set(root, g);
    }
    // 参考只收两端（`link[0]` / `link[1]`）：中间点是 A* 的绕行拐点，收进来会把
    // 凸包撑向海岸，国家的核心区反而被推得离岸更近。
    g.push(pts[0], pts[pts.length - 1]);
  }
  return [...groups.values()].filter((g) => g.length > 0);
}

/* ────────────────────────── ② 簇数收敛（L） ────────────────────────── */

/** 两簇之间的最近点距（参考 `L` 里对 `link` 四个端点两两求距离） */
function clusterGap(a: readonly Point[], b: readonly Point[]): number {
  let best = Infinity;
  for (const p of a) {
    for (const q of b) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * 把簇数**合并**到 `target`（参考 `L`：反复合并最近的两簇）。
 *
 * 少于 target 时不做任何事 —— 参考就是这样（`for(;a.length>b;)`），族数不足
 * 它会老老实实只出更少的国家。本项目不能让国家数失控（用户要的是"最多 12"），
 * 所以不足时由 `splitClusters` 接手。
 */
export function mergeClusters(clusters: Point[][], target: number): Point[][] {
  const out = clusters.map((c) => c.slice());
  while (out.length > target && out.length > 1) {
    let bestI = 0;
    let bestJ = 1;
    let bestD = Infinity;
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const d = clusterGap(out[i], out[j]);
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    out[bestI] = out[bestI].concat(out[bestJ]);
    out.splice(bestJ, 1);
  }
  return out;
}

/**
 * 簇数**不足**时按**最远点采样**补种子，再按最近簇归属切分节点。
 *
 * 【为什么不是"随便从大簇里切一块"】最远点采样（k-center）保证新种子落在
 * 现有种子最够不着的地方，划出来的疆域大小天然不均（远的那些吃到大片、
 * 近的只分到一小块）—— 这正是参考成图的读法。若改成均分，观感立刻退回
 * "行政区划图"。
 */
export function splitClusters(clusters: Point[][], target: number, rng: () => number): Point[][] {
  if (clusters.length >= target || clusters.length === 0) return clusters;
  const all = clusters.flat();
  if (all.length === 0) return clusters;

  // 起点：节点最多的那一簇里，随机取一个节点（保证第一颗种子在"主陆"上）
  let biggest = clusters[0];
  for (const c of clusters) if (c.length > biggest.length) biggest = c;
  const seeds: Point[] = [biggest[Math.floor(rng() * biggest.length)]];

  while (seeds.length < target) {
    let bestP = all[0];
    let bestD = -1;
    for (const p of all) {
      let d = Infinity;
      for (const s of seeds) {
        const dd = Math.hypot(p.x - s.x, p.y - s.y);
        if (dd < d) d = dd;
      }
      if (d > bestD) {
        bestD = d;
        bestP = p;
      }
    }
    seeds.push(bestP);
  }

  const out: Point[][] = seeds.map(() => []);
  for (const p of all) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < seeds.length; i += 1) {
      const d = Math.hypot(p.x - seeds[i].x, p.y - seeds[i].y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    out[best].push(p);
  }
  return out.filter((g) => g.length > 0);
}

/* ────────────────────────── ④ 种子格（fa） ────────────────────────── */

/**
 * 一簇点 → 该国在生长前的**种子格**。
 *
 * 参考 `fa(shape, out, true)`：`createPolygonBuffer(shape, -30)` 之后按 5 单位
 * 步长扫包围盒，落在内缩多边形里的采样点映射成六边形格。
 *
 * 【为什么这里遍历格而不是 5 单位采样】5 单位是参考"没有点在多边形内判定"时的
 * 笨办法（扫一遍总能落到格上）。我们有 `inRing` + `distToRing`，直接按格心判
 * 更快也更准，结果集合同一。
 *
 * 【退化兜底（项目特有）】参考的簇来自真实路网，凸包总是二维的；本项目若在
 * 稀疏/共线的点上算凸包，会得到一条线（面积 0）—— 内缩后一个格都采不到，
 * 那个国家就凭空消失（实测 12 国只剩 9 个）。此时改用"以质心为心、半径至少
 * 3 格"的圆形域采样，保证每簇都有起跑线。
 */
export function seedCellsOf(
  points: readonly Point[],
  grid: HexGrid,
  inset: number,
): { q: number; r: number }[] {
  const hull = convexHull(points);
  const cellArea = (3 * SQRT3 / 2) * grid.radius * grid.radius;
  const degenerate = hull.length < 3 || polygonArea(hull) < cellArea;
  const center = polygonCentroid(hull.length >= 3 ? hull : [...points]);
  const radius = degenerate
    ? Math.max(3 * grid.radius, ...points.map((p) => Math.hypot(p.x - center.x, p.y - center.y)))
    : 0;

  const inside = (p: Point): number => {
    if (degenerate) return radius - Math.hypot(p.x - center.x, p.y - center.y);
    if (!inRing(p, hull)) return -1;
    return distToRing(p, hull);
  };

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = degenerate ? center.x - radius : Math.min(...xs);
  const maxX = degenerate ? center.x + radius : Math.max(...xs);
  const minY = degenerate ? center.y - radius : Math.min(...ys);
  const maxY = degenerate ? center.y + radius : Math.max(...ys);

  const collect = (requireInset: boolean): { q: number; r: number }[] => {
    const out: { q: number; r: number }[] = [];
    const seen = new Set<string>();
    const stepX = 1.5 * grid.radius;
    const stepY = SQRT3 * grid.radius;
    for (let y = minY; y <= maxY + stepY; y += stepY / 2) {
      for (let x = minX; x <= maxX + stepX; x += stepX / 2) {
        const cell = hexAt(grid, { x, y });
        const key = cellKey(cell.q, cell.r);
        if (seen.has(key)) continue;
        seen.add(key);
        const depth = inside(hexCenter(grid, cell.q, cell.r));
        if (depth < 0) continue;
        if (requireInset && depth < inset) continue;
        out.push(cell);
      }
    }
    return out;
  };

  // 内缩后可能一个格都不剩（小簇 + 厚内缩）。参考此时该国直接消失；本项目
  // 不能少国家数，所以退回"不内缩"再采一次 —— 代价是边界贴得紧一点。
  const insetCells = collect(true);
  return insetCells.length > 0 ? insetCells : collect(false);
}

/* ────────────────────────── ⑤ 生长（da + z） ────────────────────────── */

/** 各国的格集合（`Set<"q,r">`），与轴向坐标的对应表 */
export interface CellOwner {
  /** `"q,r"` → 国家下标 */
  owner: Map<string, number>;
}

/**
 * 铺满整张纸的**陆地格集合**（格心在陆地内）。
 *
 * 【为什么要预计算】生长每轮要判几千次"这格是不是陆地"，而 `pointInLand` 每次
 * 遍历陆地环的几百个顶点 —— 40 轮下来是亿级运算（实测单张图 8 秒）。预先算一张
 * 表，生长时退化成 Set 查找。这张表同时也定义了"什么算陆地格"的唯一口径。
 */
export function landCellsOf(grid: HexGrid, bounds: Rect, isLand: (p: Point) => boolean): Set<string> {
  const out = new Set<string>();
  const stepX = 1.5 * grid.radius;
  const stepY = SQRT3 * grid.radius;
  const halfCols = Math.ceil(bounds.width / stepX / 2) + 2;
  const halfRows = Math.ceil(bounds.height / stepY / 2) + 2;
  for (let q = -halfCols; q <= halfCols; q += 1) {
    for (let r = -halfRows; r <= halfRows; r += 1) {
      if (isLand(hexCenter(grid, q, r))) out.add(cellKey(q, r));
    }
  }
  return out;
}

/** 距中心 2 环的偏移（axial 距离 ≤ 2 共 19 格，去掉中心剩 18 个） */
const GROW_OFFSETS: readonly { q: number; r: number }[] = (() => {
  const out: { q: number; r: number }[] = [];
  for (let dq = -2; dq <= 2; dq += 1) {
    for (let dr = -2; dr <= 2; dr += 1) {
      if (Math.abs(dq + dr) > 2) continue;
      if (dq === 0 && dr === 0) continue;
      out.push({ q: dq, r: dr });
    }
  }
  return out;
})();

/**
 * 从种子格向外"先到先得"地占格，直到陆地占满或轮数用尽。
 *
 * 参考 `da(a,b,c,d)` + `z(...)`：每轮把每国**已占格**的邻域候选格抢过来，
 * 条件是"该格不是整格在海里"且"没被任何国家占"。参考用一个不对称的
 * ±3 行 / ±2 列窗口（那是它 offset 编码的副产物），这里用**距中心 2 环**
 * （18 个偏移）的规整邻域 —— 推进速度一致，不会出现"横向快纵向慢"的偏斜。
 *
 * @param seedsByCountry **按国分组**的种子格（同一组的所有格都归同一个国家）。
 *   ⚠️ 不能摊平成一维数组传进来：那样每个种子格都会被当成"一国"，
 *   12 个国家会变成 240 个（踩过）。
 * @param landCells `landCellsOf` 的结果
 * @param rounds 轮数（每轮推 2 格）；上限 `GROW_MAX_ROUNDS`
 */
export function growCountries(
  seedsByCountry: readonly (readonly { q: number; r: number }[])[],
  landCells: ReadonlySet<string>,
  rounds = GROW_ROUNDS,
): CellOwner {
  const owner = new Map<string, number>();
  seedsByCountry.forEach((seeds, idx) => {
    for (const c of seeds) {
      const k = cellKey(c.q, c.r);
      if (!owner.has(k)) owner.set(k, idx);
    }
  });

  const total = Math.max(1, Math.min(GROW_MAX_ROUNDS, rounds));
  for (let round = 0; round < total; round += 1) {
    // 本轮开始时快照，本轮新占的格下一轮才能再扩（否则一轮就能穿透整张纸）
    const snapshot = [...owner.entries()];
    let grown = 0;
    for (const [key, idx] of snapshot) {
      const [qs, rs] = key.split(",");
      const q0 = Number(qs);
      const r0 = Number(rs);
      for (const off of GROW_OFFSETS) {
        const k = cellKey(q0 + off.q, r0 + off.r);
        if (!landCells.has(k)) continue;
        if (owner.has(k)) continue;
        owner.set(k, idx);
        grown += 1;
      }
    }
    if (grown === 0) break;
  }
  return { owner };
}

/* ────────────────────────── ⑥ 轮廓追踪 ────────────────────────── */

/**
 * 把一个国家的格集合沿**格边**追成闭合轮廓环。
 *
 * 做法与参考的 `unionShape` 等价（那是布尔并集，我们用拓扑追踪）：一格的某条边
 * 若缺邻居，这条边就是边界；把所有边界有向边首尾相接，就得到轮廓。
 *
 * @returns 若干环（面积降序）；第一个是主块，其余是飞地
 */
export function traceOutlines(
  cells: Iterable<string>,
  ownerIndex: number,
  owner: ReadonlyMap<string, number>,
  grid: HexGrid,
): Point[][] {
  const set = new Set(cells);
  /**
   * 起点 key → 以它为起点的边界边（可能不止一条）。
   *
   * 【为什么是数组】两个格子**只在角上相接**时，那个顶点会有四条边界边出入；
   * 用单值 Map 会互相覆盖，环就断在那儿、整块被当成拓扑噪声丢掉。
   */
  const edges = new Map<string, { to: string; pts: [Point, Point] }[]>();
  const posKey = (p: Point): string => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;

  for (const key of set) {
    const [qs, rs] = key.split(",");
    const q = Number(qs);
    const r = Number(rs);
    const center = hexCenter(grid, q, r);
    for (let i = 0; i < 6; i += 1) {
      const nb = HEX_NEIGHBORS[i];
      const nk = cellKey(q + nb.q, r + nb.r);
      // 邻居属于同一个国家也视为内部边（飞地 / 洞的判定靠这条）
      if (owner.get(nk) === ownerIndex) continue;
      const a = hexCorner(center, grid.radius, i);
      const b = hexCorner(center, grid.radius, (i + 1) % 6);
      const from = posKey(a);
      const list = edges.get(from);
      const edge = { to: posKey(b), pts: [a, b] as [Point, Point] };
      if (list) list.push(edge);
      else edges.set(from, [edge]);
    }
  }

  const used = new Set<object>();
  const rings: Point[][] = [];
  for (const start of edges.keys()) {
    // 从同一顶点可能岔出多个环（角接处），逐个起头
    for (;;) {
      const firstList = edges.get(start);
      const first = firstList?.find((e) => !used.has(e));
      if (!first) break;
      const ring: Point[] = [];
      let cur = start;
      let edge: { to: string; pts: [Point, Point] } | undefined = first;
      let guard = 0;
      while (edge && guard < 20000) {
        guard += 1;
        used.add(edge);
        ring.push(edge.pts[0]);
        cur = edge.to;
        if (cur === start) break;
        const nextList = edges.get(cur);
        edge = nextList?.find((e) => !used.has(e));
      }
      // 少于 3 个顶点不成面（拓扑噪声），或没走回起点（断裂），都丢掉
      if (ring.length >= 3 && cur === start) rings.push(ring);
    }
  }

  rings.sort((a, b) => polygonArea(b) - polygonArea(a));
  return rings;
}

/* ────────────────────────── ⑧ 栅格化收尾（参考 ra / CutRangePolygon / GetCanvasOutlines） ────────────────────────── */

/**
 * 栅格分辨率：1 像素 = 1 世界单位。
 *
 * 参考的国界不是矢量算出来的——它把平滑后的环**画进画布**（`ra`：填充 → 与陆地
 * 掩膜 `destination-in` → `GetCanvasOutlines` 从像素重追轮廓），再由
 * `CutRangePolygon` 让**后画的国家把先画的国家切齐**。三步合成三个保证：
 * 边界永不越海（交陆地）、国与国零缝隙零叠色（切齐）、平滑曲线的形状不丢
 * （1px 采样）。本节在纯 TS 里做同一件事——不用 DOM canvas，jsdom 可测、确定性。
 */
export const FINISH_PX_PER_UNIT = 1;

interface RasterGrid {
  /** 列数 / 行数（像素） */
  w: number;
  h: number;
  /** 世界坐标原点（像素 (0,0) 的左上角） */
  x0: number;
  y0: number;
}

function rasterGridOf(bounds: Rect): RasterGrid {
  return {
    w: Math.max(1, Math.ceil(bounds.width)),
    h: Math.max(1, Math.ceil(bounds.height)),
    x0: bounds.x,
    y0: bounds.y,
  };
}

/**
 * 扫描线填充一个环（像素中心采样；`erase` 时把覆盖像素清零——挖洞用）。
 *
 * 奇偶规则：一行内与环求交、按 x 排序后两两成对。顶点恰好压在扫描线上时用
 * 「yMin ≤ 中心 < yMax」的半开区间判据，保证与多边形无关的确定性。
 */
function rasterFillRing(
  ring: readonly Point[],
  grid: RasterGrid,
  mask: Uint8Array,
  erase: boolean,
): void {
  if (ring.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const jStart = Math.max(0, Math.floor(minY - grid.y0));
  const jEnd = Math.min(grid.h - 1, Math.ceil(maxY - grid.y0));
  for (let j = jStart; j <= jEnd; j += 1) {
    const yc = grid.y0 + j + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a.y > yc !== b.y > yc) {
        xs.push(a.x + ((yc - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // 像素中心落在 [xa, xb) 内即覆盖
      const iStart = Math.max(0, Math.ceil(xs[k] - grid.x0 - 0.5));
      const iEnd = Math.min(grid.w - 1, Math.floor(xs[k + 1] - grid.x0 - 0.5));
      for (let i = iStart; i <= iEnd; i += 1) {
        mask[j * grid.w + i] = erase ? 0 : 1;
      }
    }
  }
}

/** 陆地掩膜：把每张岛多边形按奇偶规则填充进同一张位图 */
function rasterLandMask(land: MapLand, grid: RasterGrid): Uint8Array {
  const mask = new Uint8Array(grid.w * grid.h);
  for (const poly of land.polygons) rasterFillRing(poly, grid, mask, false);
  return mask;
}

/**
 * 把按格分类的附加环画进掩膜：**飞地**（环内有本国格心）填充，**洞**（环内
 * 全是别国领土，典型为"环状国家包住了另一个国"）挖掉。
 *
 * 【为什么必须区分】环填充会把洞也填掉——先画的大国会把被包住的国家的全部
 * 领土抢先认领，后画的那个国家只剩零星边缘、视觉上直接消失。参考不需要这一步
 * 是因为它的簇来自不相交的连通分量、几乎不出环抱；我们的格生长可以出。
 */
function rasterizeCountryRings(
  flatRings: readonly Point[][],
  cellCenters: readonly Point[],
  grid: RasterGrid,
  mask: Uint8Array,
): void {
  rasterFillRing(flatRings[0], grid, mask, false);
  for (let k = 1; k < flatRings.length; k += 1) {
    const ring = flatRings[k];
    const isEnclave = cellCenters.some((c) => inRing(c, ring));
    rasterFillRing(ring, grid, mask, !isEnclave);
  }
}

/**
 * 从像素掩膜重追轮廓（对应参考 `GetCanvasOutlines`）。
 *
 * 每个像素的四条边里，「跨过去是界外」的那条是边界边；边界有向边（内部恒在
 * 左侧）首尾相接成环。相邻两国的掩膜共享同一批像素边——**两侧各自追出的
 * 这条边逐点重合**，所以零缝隙、零叠色；共线顶点合并掉之后，顶点数从
 * "每像素一个"降到"每拐点一个"。
 *
 * @param owns 谓词：像素 (i,j) 是否属于这个国家
 * @returns 世界坐标环（面积降序；洞的朝向与外环相反，由调用方按格心分类）
 */
function traceMaskOutlines(owns: (i: number, j: number) => boolean, grid: RasterGrid): Point[][] {
  type Edge = { to: string; from: [number, number]; toPt: [number, number] };
  // 内部恒在左侧的四种边界边（y 向下）：
  //   上邻界外 → 沿上边向 -x；下邻界外 → 沿下边向 +x；
  //   左邻界外 → 沿左边向 +y；右邻界外 → 沿右边向 -y。
  const edges = new Map<string, Edge[]>();
  const key = (x: number, y: number): string => `${x},${y}`;
  for (let j = 0; j < grid.h; j += 1) {
    for (let i = 0; i < grid.w; i += 1) {
      if (!owns(i, j)) continue;
      const add = (from: [number, number], toPt: [number, number]): void => {
        const e: Edge = { to: key(toPt[0], toPt[1]), from, toPt };
        const list = edges.get(key(from[0], from[1]));
        if (list) list.push(e);
        else edges.set(key(from[0], from[1]), [e]);
      };
      if (j === 0 || !owns(i, j - 1)) add([i + 1, j], [i, j]);
      if (j === grid.h - 1 || !owns(i, j + 1)) add([i, j + 1], [i + 1, j + 1]);
      if (i === 0 || !owns(i - 1, j)) add([i, j], [i, j + 1]);
      if (i === grid.w - 1 || !owns(i + 1, j)) add([i + 1, j + 1], [i + 1, j]);
    }
  }

  const used = new Set<Edge>();
  const rings: Point[][] = [];
  for (const startKey of [...edges.keys()]) {
    for (;;) {
      const first = edges.get(startKey)?.find((e) => !used.has(e));
      if (!first) break;
      const lattice: [number, number][] = [];
      let cur = startKey;
      let edge: Edge | undefined = first;
      let guard = 0;
      while (edge && guard < grid.w * grid.h * 2) {
        guard += 1;
        used.add(edge);
        const [cx, cy] = edge.from;
        lattice.push([cx, cy]);
        cur = edge.to;
        if (cur === startKey) break;
        edge = edges.get(cur)?.find((e) => !used.has(e));
      }
      if (lattice.length < 3 || cur !== startKey) continue;
      // 共线合并：只拐弯处留点（相邻两国走的是同一条像素边链，合并结果逐点一致，
      // `regions.ts` 的边邻接判定仍能对上）
      const pts: [number, number][] = [];
      for (let k = 0; k < lattice.length; k += 1) {
        const prev = lattice[(k - 1 + lattice.length) % lattice.length];
        const next = lattice[(k + 1) % lattice.length];
        const cur2 = lattice[k];
        const d1x = cur2[0] - prev[0];
        const d1y = cur2[1] - prev[1];
        const d2x = next[0] - cur2[0];
        const d2y = next[1] - cur2[1];
        if (d1x * d2y !== d1y * d2x) pts.push(cur2);
      }
      if (pts.length < 3) continue;
      rings.push(
        pts.map(([cx, cy]) => ({ x: grid.x0 + cx, y: grid.y0 + cy })),
      );
    }
  }
  rings.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
  return rings;
}

/**
 * 孤儿陆地像素的洪泛收编：所有国家追完轮廓后，仍无主的陆地像素（两国曲线
 * 同时内凹让出的细缝，宽 ≤ 数像素）分给**四邻中已归属的国家**。
 *
 * 参考没有这一步——它的切割顺序（后切先）天然保证覆盖；我们先画后切留下的
 * 细缝靠这里兜住，否则缝隙里会露出纸底色（正是本次要修的"三角缝隙"的残余）。
 */
function floodOrphanLand(owner: Uint8Array, landMask: Uint8Array, grid: RasterGrid): void {
  const w = grid.w;
  const h = grid.h;
  for (;;) {
    let changed = 0;
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        const k = j * w + i;
        if (owner[k] !== 0 || !landMask[k]) continue;
        const nb =
          (i > 0 ? owner[k - 1] : 0) ||
          (i < w - 1 ? owner[k + 1] : 0) ||
          (j > 0 ? owner[k - w] : 0) ||
          (j < h - 1 ? owner[k + w] : 0);
        if (nb !== 0) {
          owner[k] = nb;
          changed += 1;
        }
      }
    }
    if (changed === 0) break;
  }
}


/* ────────────────────────── 主流程 ────────────────────────── */

export interface CountryOptions {
  /** 陆地（只用 `polygons` 做"格心是否在陆地内"判定） */
  land: MapLand;
  /**
   * 道路折线（`kind === "road"`）。国家种子来自它的连通分量。
   *
   * 传空数组 = 没有路网（手动"生成陆地"路径），此时退回纸面上的最远点采样 ——
   * 数量与形状仍成立，只是"聚落决定疆域"这层语义没有了。
   */
  roads?: readonly MapPolyline[];
  /** 目标国家数（会被夹到 `[COUNTRY_MIN, COUNTRY_MAX]`） */
  count?: number;
  /** 随机种子（国名顺序 + 兜底采样都用它，同 seed 必得同结果） */
  seed: number;
  /** id 前缀（多岛/子图场景避免重号） */
  idPrefix?: string;
}

/**
 * 生成国家区块（level 0，铺满陆地）。
 *
 * @returns 区块列表，`polygon` 已平滑、`pieces` 为飞地；`color` 初值走色板轮转、
 *   最后统一做邻接校正（与 `regions.ts` 同一条收尾）
 */
export function generateCountries(options: CountryOptions): MapRegion[] {
  const land = options.land;
  const bounds = land.bounds;
  const grid = hexGridOf(bounds);
  const target = Math.max(
    COUNTRY_MIN,
    Math.min(COUNTRY_MAX, Math.round(options.count ?? COUNTRY_DEFAULT)),
  );
  const rng = createRng(options.seed);
  const isLand = (p: Point): boolean => pointInLand(p, land);
  const inset = bounds.width * HEX_INSET_RATIO;

  // ── ① 种子簇：道路连通分量 → （不足时）最远点采样补齐 ──
  let clusters = clusterRoadsByConnectivity(options.roads ?? []);
  if (clusters.length === 0) {
    // 没有路网：用陆地内的格心做种子池，最远点采样出 target 个
    const landCells = landCellsOf(grid, bounds, isLand);
    const pool: Point[] = [];
    for (const k of landCells) {
      const [qs, rs] = k.split(",");
      pool.push(hexCenter(grid, Number(qs), Number(rs)));
    }
    clusters = [pool];
  }
  clusters = mergeClusters(clusters, target);
  clusters = splitClusters(clusters, target, rng);
  // 合并后仍可能多于 target（splitClusters 不动超量），再收一次
  clusters = mergeClusters(clusters, target);

  // ── ②③ 每簇取凸包，凸包内缩后采种子格 ──
  //
  // ⚠️ 各簇的凸包**允许重叠**，格子的归属交给后面"先到先得"的生长（`growCountries`
  // 里 `if (!owner.has(k))`）—— 这正是参考的语义（它的簇来自不相交的连通分量，
  // 但从不会去"解冲突"）。
  //
  // 【踩过的坑】一开始为了"保证每国都分到格"，把重叠部分的格判给"离簇中心更近"
  // 的那一簇 —— 那等于对簇中心做了一次 Voronoi，12 个国家全变成绕中心的圆/扇形块，
  // 观感立刻退回"行政区划图"（本次要修的病根）。冲突交给先到先得，形状才会跟
  // 凸包走（凸包是不规则多边形，正是参考图里那种"圆角多边形国家"）。
  const centers = clusters.map((c) => polygonCentroid([...c]));
  const seedSets: { q: number; r: number }[][] = clusters.map(() => []);
  clusters.forEach((cluster, idx) => {
    seedSets[idx] = seedCellsOf(cluster, grid, inset);
  });
  // 起跑线拉平：单国种子格数不超过均值的两倍。
  //
  // 【为什么需要】种子域大小直接决定起跑优势 —— 一个占 40 格的种子域从 40 个方向
  // 同时推进，隔壁只有 1 格的国家只会被挤成一个小点（实测最大/最小面积 28 倍，
  // 参考成图是 5~10 倍）。参考没有这一步是因为它的凸包尺寸天然相称；我们的簇
  // 由最远点采样拆出来，凸包可能一大一小差一个数量级。
  const avg = seedSets.reduce((sum, set) => sum + set.length, 0) / Math.max(1, seedSets.length);
  const cap = Math.max(1, Math.ceil(avg * SEED_CAP_RATIO));
  for (let i = 0; i < seedSets.length; i += 1) {
    const set = seedSets[i];
    if (set.length <= cap) continue;
    set.sort(
      (a, b) =>
        Math.hypot(hexCenter(grid, a.q, a.r).x - centers[i].x, hexCenter(grid, a.q, a.r).y - centers[i].y) -
        Math.hypot(hexCenter(grid, b.q, b.r).x - centers[i].x, hexCenter(grid, b.q, b.r).y - centers[i].y),
    );
    seedSets[i] = set.slice(0, cap);
  }
  // 兜底：一格都没采到的簇，从最大簇里借一格 —— 宁可两国共享一个种子格
  //（生长时先到先得），也不要少一个国家。
  for (let i = 0; i < seedSets.length; i += 1) {
    if (seedSets[i].length > 0) continue;
    let biggest = 0;
    for (let j = 1; j < seedSets.length; j += 1) {
      if (seedSets[j].length > seedSets[biggest].length) biggest = j;
    }
    const donor = seedSets[biggest];
    if (donor.length > 1) seedSets[i].push(donor.pop() as { q: number; r: number });
  }
  const liveSets = seedSets.filter((s) => s.length > 0);
  if (liveSets.length === 0) return [];

  // ── ⑤ 生长占满陆地（种子按国分组，组号即国家号）──
  const landCells = landCellsOf(grid, bounds, isLand);
  const { owner } = growCountries(liveSets, landCells, GROW_ROUNDS);

  // ── ⑥ 按国聚格 → 追轮廓 → 过点插值平滑（参考 shapeToBezierCurve 的样条层）──
  const cellsByCountry = new Map<number, string[]>();
  for (const [k, i] of owner) {
    const arr = cellsByCountry.get(i);
    if (arr) arr.push(k);
    else cellsByCountry.set(i, [k]);
  }

  const names = makeCountryNames(
    Math.max(1, cellsByCountry.size),
    createRng((options.seed ^ 0x51ed270b) >>> 0),
  );

  // 按格数降序：大国先出（与参考 `b.sort` 同向）。栅格收尾的切割也是这个顺序——
  // 后画的国家被先画的国家切齐（参考 CutRangePolygon 的语义）。
  const order = [...cellsByCountry.entries()].sort((a, b) => b[1].length - a[1].length);

  /** 平滑后的密集环（[主块, …附加环]），先全部算好再进栅格阶段 */
  const drafts = order.map(([idx, cells]) => ({
    idx,
    cells,
    flat: traceOutlines(cells, idx, owner, grid).map((ring) => flattenCurveRing(ring)),
    centers: [...cells].map((k) => {
      const [qs, rs] = k.split(",");
      return hexCenter(grid, Number(qs), Number(rs));
    }),
  }));

  // ── ⑦ 栅格化收尾（参考 ra + CutRangePolygon + GetCanvasOutlines）──
  //
  // 每国：平滑环栅格化（飞地填、洞挖）→ ∩ 陆地 → 减去先画的国家 → 认领。
  // 全部认领完后孤儿陆地像素洪泛收编，再按像素归属重追轮廓 —— 边界逐点重合，
  // 三国交界的三角形缝隙与叠色带在这个表示下**结构上不存在**。
  const rgrid = rasterGridOf(bounds);
  const landMask = rasterLandMask(land, rgrid);
  const pixelOwner = new Uint8Array(rgrid.w * rgrid.h); // 0 = 无主，n+1 = 第 n 个 draft
  for (let d = 0; d < drafts.length; d += 1) {
    const draft = drafts[d];
    if (draft.flat.length === 0 || draft.flat[0].length < 3) continue;
    const mask = new Uint8Array(rgrid.w * rgrid.h);
    rasterizeCountryRings(draft.flat, draft.centers, rgrid, mask);
    const claim = d + 1;
    for (let k = 0; k < mask.length; k += 1) {
      if (mask[k] && landMask[k] && pixelOwner[k] === 0) pixelOwner[k] = claim;
    }
  }
  floodOrphanLand(pixelOwner, landMask, rgrid);

  // ── ⑧ 从像素归属重追轮廓 → 插值圆化 → 组装区块 ──
  //
  // 【为什么要对像素轮廓再插值一次（2.51.0，用户："边界线放大后矩形感太强"）】
  // 像素轮廓的顶点全是 1 单位台阶的 90° 直角——放大后就是一格格的矩形锯齿。
  // `flattenCurveRing` 的过点插值把这些直角圆化成波长 2~3 单位的微波动，
  // 高倍下读作"手绘抖动线"而非矩形。
  //
  // 【为什么零缝隙性质不被破坏】插值曲线在 t=0/1 处**穿过原始顶点**（共享顶点
  // 被钉死），且共享边界段的曲线只由"段端点 + 链上邻居"决定——相邻两国走的
  // 是同一条像素边链（`traceMaskOutlines` 的共线合并两侧逐点一致），段与邻居
  // 完全相同 ⇒ 曲线逐点重合（贝塞尔端点交换 = 同一条曲线反向参数化）。
  // 三重交界处的顶点同样被钉住，不会再出现 2.50.0 修掉的三角缝隙。
  const regions: MapRegion[] = [];
  let seq = 0;
  const prefix = options.idPrefix ?? "";
  for (let d = 0; d < drafts.length; d += 1) {
    const draft = drafts[d];
    const claim = d + 1;
    const traced = traceMaskOutlines((i, j) => pixelOwner[j * rgrid.w + i] === claim, rgrid);
    // 兜底：栅格阶段理论上不会清空一国，但防御"零环"——退回矢量平滑环
    const rings = traced.length > 0 ? traced.map((ring) => flattenCurveRing(ring)) : draft.flat;
    const main = rings[0];
    if (!main || main.length < 3) continue;
    // 附加环只在环内有本国格心时才算飞地；洞（本国环抱别国）不进 pieces ——
    // 它那片地会被洞里的国家画出来，主块填充盖上去也只是无名份的底色
    const pieces = rings.slice(1).filter((ring) => draft.centers.some((c) => inRing(c, ring)));
    seq += 1;
    const id = `rg_${prefix}${(options.seed >>> 0).toString(36)}_${seq}`;
    regions.push({
      id,
      parentId: null,
      level: 0,
      name: names[seq - 1] ?? `国 ${seq}`,
      // 种子点取主块质心附近的内部点：国名落点要在这块地里，不能落飞地上
      seed: safeInside(polygonCentroid([...main]), main),
      polygon: main,
      pieces: pieces.length > 0 ? pieces : undefined,
      // 初值走色板轮转（参考 `Xa[idx % len]`）。⚠️ 不能写 0：`assignRegionColors`
      // 是"邻居色差够大就保留原色"，黑色与任何粉彩都差得远 ⇒ 直接留存，
      // 最大那一国整块全黑（实测）。
      color: REGION_PALETTE_RGB[seq % REGION_PALETTE_RGB.length],
    });
  }

  // 色板轮转初值（参考 `Xa[idx % len]`）—— 再统一做邻接校正
  if (regions.length > 0) assignRegionColors(regions);
  return regions;
}

/**
 * 把一个点拉回环内（国名落点用）。
 *
 * 质心可能落在凹形的外面（马蹄形国家），此时沿"质心 → 环内最远点"的连线不能保证
 * 在内部；简单可靠的做法是：不在环内就退到任取一个顶点往里缩一点。
 */
function safeInside(p: Point, ring: readonly Point[]): Point {
  if (inRing(p, ring)) return p;
  const c = polygonCentroid([...ring]);
  for (let t = 1; t <= 10; t += 1) {
    const k = t / 10;
    const q = { x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k };
    if (inRing(q, ring)) return q;
  }
  return ring[0] ?? p;
}
