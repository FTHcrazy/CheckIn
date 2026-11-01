/**
 * 陆地形状生成（纯函数，不依赖 React / Pixi / DOM）
 *
 * 【为什么单独生成陆地，而不复用最粗一级区块】
 * level-0 的区块是**铺满整张纸**的 —— 它没有外轮廓，描出来的白边会贴着纸边跑一圈，
 * 做不出海岸。区块是"地表的划分"，陆地是"地表本身"，两者必须解耦：
 * 陆地由本模块生成，区块再由 `regions.ts` 在陆地多边形**内部**切分（见 PRD §6.1.3）。
 *
 * 【形状算法：极坐标半径扰动 + fbm】
 *   r(θ) = 1 · (0.72 + 0.28 · fbm(cosθ·f, sinθ·f, seed))   再按半轴 (ax, ay) 拉伸
 * 选它而不是"撒点 + 形态学腐蚀膨胀"，理由有三：
 *   · 一次成型，顶点数可控（= 采样数），不需要额外做去自交；
 *   · θ 单调递增 ⇒ 多边形**恒为简单闭合环**，不会出现打结的填充空洞；
 *   · 噪声场是位置的连续函数，同一个 θ 永远得到同一个 r ⇒ 天然可复现。
 *
 * 【两个比例常量的分工】`0.72` 是"最窄处不能细成长条"的下限，`0.28` 是"海岸要有湾"
 * 的振幅。两者必须一起调：只调大振幅会让陆地碎成群岛，只调小则退化成圆形。
 *
 * 【多岛靠"格子"而不是靠随机撒点】随机撒点 + 收缩重试在两岛以上时几乎必然失败：
 * 第一个岛会把纸心占满，第二个岛无论怎么缩都塞不进剩下的环形边角（实测 12 轮
 * ×64 次撒点无一命中，岛被静默丢弃）。改成"先按岛数分格、再让每个岛填满自己的
 * 格子"，排布就变成**必然成功**的确定性过程，且格子长宽比天然给出岛的走向。
 *
 * 【噪声不重写】`createRng` / `fbm` 一律从 `regions.ts` 引入 —— 那边的值噪声是
 * "位置连续函数"，正是"边界严丝合缝"的前提；各写一套会让陆地与区块的噪声场错位。
 *
 * 【本文件不 import pixi】`drawLandPath` 只依赖三个方法（见 `LandPathTarget`），
 * Pixi 的 `Graphics` 结构上天然满足它。保持零依赖后，这个模块可以在没有任何
 * 渲染替身的环境里单测。`Graphics` 的兼容性由 `land.test.ts` 在**类型层面**校验。
 */

import { createRng, fbm, pointInPolygon, polygonArea, type Point } from "./regions";
import type { MapLand, Rect } from "./types";

/**
 * 每岛的方向角采样数。
 *
 * PRD 写的是 64，这里取 96：64 点在适应窗口（scale ≈ 0.8）下约 31 屏幕像素一条弦，
 * 直边肉眼可辨 —— 正是 PRD §2.1 明确不要的"多边形的折线感"。96 点让
 * `drawLandPath` 的贝塞尔控制点更贴形状，成本可忽略（生成是一次性的）。
 */
export const LAND_SAMPLES = 96;

/**
 * **单岛**陆地占纸面积的目标区间（不是"所有岛加起来"的目标）。
 *
 * ⚠️ 名字里的 `LAND_AREA_RATIO` 容易让人读成"总面积必须落在 55%~70%"，实际口径是：
 * `fitExtents` 只**收缩**不放大，所以多岛时每个岛各自被压进自己的格子，总面积
 * 一定低于单岛均值。实测（seed 20261009）：单岛 56.2%，2 岛 51.8%，3 岛 36.2%。
 *
 * PRD §6.1.6 的验收区间是 25%~85%（针对最终画面里的陆地占比），所以多岛也
 * **验收通过**；但如果你想让"任何岛数都到 55%"，需要改的是 `planIslands` 的
 * 格子划分与 `fitExtents` 的放大策略，不是这个常量。见架构文档 §9 的 L-2。
 *
 * 格子放不下时会按几何上限退化（见 `planIslands`）。
 */
export const LAND_AREA_RATIO = { min: 0.55, max: 0.7 } as const;

/**
 * 极坐标半径的两个系数 + 噪声频率。
 * `floor` / `amp` 见文件头；`freq` 决定绕一圈跨过几个噪声格（2π·1.6 ≈ 10，
 * 叠三层倍频后最细一层约 42 个格），于是既有大走向也有小锯齿。
 */
export const LAND_RADIUS = { floor: 0.72, amp: 0.28, freq: 1.6 } as const;

/** 相邻两岛之间的最小海峡宽度（= 两圈海岸可见外扩的量级） */
export const LAND_ISLAND_GAP = 24;

/** Douglas–Peucker 抽稀容差（世界单位） */
export const LAND_SIMPLIFY_TOL = 1.5;

/**
 * 抽稀的触发阈值：顶点数超过它才抽稀。
 *
 * 【为什么必须有阈值】按 1.5 的容差对一条半径 450 的环抽稀，弦长 30 对应的矢高
 * 只有 0.16 —— 远小于容差，结果会把 96 个点全部并掉，环退化成一个多边形块。
 * 抽稀是给"将来支持手绘超多点环"准备的逃生阀，默认 96 点的路径根本用不到。
 */
export const LAND_SIMPLIFY_MIN_POINTS = 512;

/**
 * 陆地与纸边之间必须留出的海面宽度（世界单位）。
 *
 * 海岸可见外扩 ≈ 浅海带半宽 14 + 模糊拖尾 36 = 50；留 56 后海岸画不到纸外
 * （纸外是窗口背景，糊一圈绿雾会直接暴露"烘焙没有裁边"）。
 */
export const LAND_PAPER_MARGIN = 56;

/**
 * 环的实际最大半径相对半轴的**名义**比例。
 *
 * r(θ) 的上界是 1，但 fbm 极少取到 1 —— 96 点里最大值实测约 0.94。用这个名义值
 * 做排布，而不是保守地按 1 排，是为了让单岛陆地能占到纸面的一半以上（PRD §2.1
 * "占纸面的一半多一点"）。生成之后 `fitExtents` 会按实测包围盒再校正一次，
 * 因此这个近似不会让陆地越出纸面 —— 只会让它小两三个百分点。
 */
export const LAND_EXTENT_NOMINAL = 0.94;

/**
 * 面积系数：A ≈ LAND_AREA_FACTOR · π · ax · ay。
 *
 * 由 A = ½∫r²dθ 与 fbm 的均值/方差推出（E[f]≈0.5、E[f²]≈0.33），
 * 用来把"目标面积"反解成半轴。它只是**初值** —— 生成后会按实测面积与可用
 * 空间再校正，所以这里的误差不致命。
 */
export const LAND_AREA_FACTOR = 0.746;

/** 万一仍然相交时的收缩系数（PRD §6.1.2 写"缩小 8%"） */
export const LAND_SHRINK = 0.92;

/** 万一仍然相交时的重试次数（PRD §6.1.2 写"最多 5 次"） */
export const LAND_OVERLAP_RETRIES = 5;

export interface LandOptions {
  /** 随机种子 */
  seed: number;
  /** 世界范围（整张纸） */
  bounds: Rect;
  /** 岛数；缺省由 rng 取 1~3 */
  islands?: number;
  /** 每岛方向角采样数；缺省 `LAND_SAMPLES` */
  samples?: number;
}

/**
 * `drawLandPath` 的最小绘图目标。
 *
 * Pixi 的 `Graphics` 结构上天然满足它（`moveTo` / `bezierCurveTo` / `closePath`
 * 三个方法都在），因此调用方可以直接把 Graphics 传进来 —— 兼容性由
 * `land.test.ts` 在类型层面钉住。
 */
export interface LandPathTarget {
  moveTo(x: number, y: number): unknown;
  bezierCurveTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ): unknown;
  closePath(): unknown;
}

/* ────────────────────────── 小工具 ────────────────────────── */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 环相对 center 的实测半幅（x / y 方向的最大偏移） */
function ringHalfSpan(ring: Point[], center: Point): { hx: number; hy: number } {
  let hx = 0;
  let hy = 0;
  for (const p of ring) {
    const dx = Math.abs(p.x - center.x);
    const dy = Math.abs(p.y - center.y);
    if (dx > hx) hx = dx;
    if (dy > hy) hy = dy;
  }
  return { hx: Math.max(hx, 1e-6), hy: Math.max(hy, 1e-6) };
}

/** 按 center 缩放一个环（返回新数组，不改动入参） */
function scaleRing(ring: Point[], center: Point, k: number): Point[] {
  if (k === 1) return ring;
  return ring.map((p) => ({
    x: center.x + (p.x - center.x) * k,
    y: center.y + (p.y - center.y) * k,
  }));
}

/** 一个岛的排布结果 */
interface IslandPlan {
  center: Point;
  /** x 方向半轴（r = 1 时的水平最大偏移） */
  ax: number;
  /** y 方向半轴 */
  ay: number;
  /** 本格在 x 上可用的半幅（已扣掉纸边留海与邻岛海峡） */
  spanX: number;
  /** 本格在 y 上可用的半幅 */
  spanY: number;
}

/**
 * 把岛摆进纸面 —— **格子排布**（见文件头"多岛靠格子"）。
 *
 * 步骤：
 *   1) 纸内缩 `LAND_PAPER_MARGIN` 得到可用区，按岛数切成 cols × rows 个格子；
 *   2) 每格的可用半幅 = 半格宽 −（该方向上有邻居才扣）海峡的一半；
 *   3) 每个岛的**长半轴沿格子更长的那个方向**，短半轴按格子长宽比压缩
 *      —— 于是岛的形状跟着格子走，两岛时是两条南北向的大岛，而不是两个圆点；
 *   4) 半轴再按"实测外扩 ≤ 可用半幅"封顶，最后在**格子内的余量**里抖动岛心。
 *
 * 抖动只允许在余量内：格子就是"岛与邻岛的分界"，越界抖动等于把海峡吃掉。
 */
function planIslands(areas: number[], bounds: Rect, rng: () => number): IslandPlan[] {
  const n = areas.length;
  if (n === 0) return [];

  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));

  const usableX = bounds.x + LAND_PAPER_MARGIN;
  const usableY = bounds.y + LAND_PAPER_MARGIN;
  const usableW = bounds.width - LAND_PAPER_MARGIN * 2;
  const usableH = bounds.height - LAND_PAPER_MARGIN * 2;
  if (usableW <= 0 || usableH <= 0) return [];

  const cellW = usableW / cols;
  const cellH = usableH / rows;
  const spanX = cellW / 2 - (cols > 1 ? LAND_ISLAND_GAP / 2 : 0);
  const spanY = cellH / 2 - (rows > 1 ? LAND_ISLAND_GAP / 2 : 0);
  // 格子退化（岛数太多）时不再生成，免得排出一堆零面积的碎屑
  if (spanX <= 1 || spanY <= 1) return [];

  const longIsY = spanY >= spanX;
  const squash = Math.min(spanX, spanY) / Math.max(spanX, spanY);

  const out: IslandPlan[] = [];
  for (let i = 0; i < n; i += 1) {
    const gx = i % cols;
    const gy = Math.floor(i / cols) % rows;
    const cellCx = usableX + (gx + 0.5) * cellW;
    const cellCy = usableY + (gy + 0.5) * cellH;

    // 目标面积 → 半轴：A = FACTOR · π · ax · ay，且 ax : ay = 格子长宽比
    const target = Math.max(areas[i], 1);
    const long = Math.sqrt(target / (Math.PI * LAND_AREA_FACTOR * Math.max(squash, 1e-3)));
    let ax = longIsY ? long * squash : long;
    let ay = longIsY ? long : long * squash;

    // 封顶：实测外扩（≈ 名义比例 × 半轴）不得超出格子可用半幅
    const k = Math.min(
      1,
      spanX / (LAND_EXTENT_NOMINAL * ax),
      spanY / (LAND_EXTENT_NOMINAL * ay),
    );
    ax *= k;
    ay *= k;

    const slackX = Math.max(0, spanX - LAND_EXTENT_NOMINAL * ax);
    const slackY = Math.max(0, spanY - LAND_EXTENT_NOMINAL * ay);
    out.push({
      center: {
        x: cellCx + (rng() - 0.5) * 2 * slackX,
        y: cellCy + (rng() - 0.5) * 2 * slackY,
      },
      ax,
      ay,
      spanX,
      spanY,
    });
  }
  return out;
}

/** 生成一个岛的闭合环（按半轴做各向异性拉伸） */
function makeRing(plan: IslandPlan, seed: number, samples: number): Point[] {
  const n = Math.max(8, Math.round(samples));
  const ring: Point[] = [];
  for (let k = 0; k < n; k += 1) {
    const t = (k / n) * Math.PI * 2;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    // 噪声坐标取单位圆上的点 × 频率：绕一圈走过的噪声格数 = 2π·freq
    const noise = fbm(
      cos * LAND_RADIUS.freq,
      sin * LAND_RADIUS.freq,
      seed,
      3,
      2.05,
      0.5,
    );
    const rn = LAND_RADIUS.floor + LAND_RADIUS.amp * noise;
    ring.push({
      x: plan.center.x + rn * plan.ax * cos,
      y: plan.center.y + rn * plan.ay * sin,
    });
  }
  return ring;
}

/**
 * 按实测几何统一缩放全部岛。
 *
 * 排布用的是**名义**外扩系数，实测会有几个百分点的出入；这里按实测半幅与岛心
 * 间距反解一个统一系数 k，让陆地"刚好"贴住可用区 —— 既不会越出纸面，也不会
 * 因为估计保守而白白小一圈。k 夹在 [0.5, 1.25]，避免异常输入把陆地吹成气球。
 *
 * 【间距约束为什么按轴判定】岛是各向异性的：两岛南北向并排时，它们的**半径**
 * 明明互相重叠，水平半幅却留出了一条完整的海峡。按直径判会把这种情况误判成
 * "必须缩一半"，因此只在**岛心偏移更大的那个轴**上要求"半幅之和 + 海峡 ≤ 间距"。
 */
function fitExtents(islands: { plan: IslandPlan; ring: Point[] }[]): Point[][] {
  const measured = islands.map((it) => ({
    ...it,
    span: ringHalfSpan(it.ring, it.plan.center),
  }));

  let k = Number.POSITIVE_INFINITY;
  for (const it of measured) {
    k = Math.min(k, it.plan.spanX / it.span.hx, it.plan.spanY / it.span.hy);
  }
  for (let i = 0; i < measured.length; i += 1) {
    for (let j = i + 1; j < measured.length; j += 1) {
      const a = measured[i];
      const b = measured[j];
      const dx = Math.abs(a.plan.center.x - b.plan.center.x);
      const dy = Math.abs(a.plan.center.y - b.plan.center.y);
      if (dx >= dy) {
        const room = dx - LAND_ISLAND_GAP;
        if (room > 0) k = Math.min(k, room / (a.span.hx + b.span.hx));
      } else {
        const room = dy - LAND_ISLAND_GAP;
        if (room > 0) k = Math.min(k, room / (a.span.hy + b.span.hy));
      }
    }
  }
  if (!Number.isFinite(k)) k = 1;
  k = clamp(k, 0.5, 1.25);

  return measured.map((it) => scaleRing(it.ring, it.plan.center, k));
}

/**
 * 生成陆地。
 *
 * @returns `MapLand`；`bounds` 原样返回入参（整张纸）—— 烘焙要用它算纹理原点，
 *          而"占纸比"也以它为分母。纸面退化（宽高 ≤ 0）时返回空多边形，不抛异常。
 */
export function generateLand(options: LandOptions): MapLand {
  const { seed, bounds } = options;
  const rng = createRng(seed);
  const samples = options.samples ?? LAND_SAMPLES;
  const paperArea = Math.max(0, bounds.width) * Math.max(0, bounds.height);
  if (paperArea <= 0) return { seed, polygons: [], bounds };

  const count = clamp(
    Math.round(options.islands ?? 1 + Math.floor(rng() * 3)),
    1,
    8,
  );

  // 目标总面积与逐岛面积权重（0.7~1.3，让多岛时大小不一）
  const targetRatio = LAND_AREA_RATIO.min + rng() * (LAND_AREA_RATIO.max - LAND_AREA_RATIO.min);
  const targetArea = paperArea * targetRatio;
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < count; i += 1) {
    const w = 0.7 + rng() * 0.6;
    weights.push(w);
    weightSum += w;
  }
  const areas = weights.map((w) => (targetArea * w) / Math.max(1e-9, weightSum));

  const plans = planIslands(areas, bounds, rng);
  const islands: { plan: IslandPlan; ring: Point[] }[] = [];

  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i];
    let ring = makeRing(plan, seed + i * 7919, samples);

    // 相交则缩 8% 重来（PRD §6.1.2）。格子排布已经按可用半幅保证了海峡，
    // 正常走不到这里；留着它是为了兜住"fbm 恰好取到接近 1"的极端形状。
    for (let retry = 0; retry < LAND_OVERLAP_RETRIES; retry += 1) {
      let hit = false;
      for (const other of islands) {
        if (ringsIntersect(ring, other.ring)) {
          hit = true;
          break;
        }
      }
      if (!hit) break;
      const factor = LAND_SHRINK ** (retry + 1);
      ring = makeRing(
        { ...plan, ax: plan.ax * factor, ay: plan.ay * factor },
        seed + i * 7919,
        samples,
      );
    }
    // 仍然相交：丢弃这个岛（宁可少一块，也不要两块糊在一起）
    let dropped = false;
    for (const other of islands) {
      if (ringsIntersect(ring, other.ring)) dropped = true;
    }
    if (dropped) continue;

    // 抽稀：默认 96 点用不到，留给将来手绘的超多点环
    if (ring.length > LAND_SIMPLIFY_MIN_POINTS) {
      const simplified = simplifyRing(ring, LAND_SIMPLIFY_TOL);
      if (simplified.length >= 8) ring = simplified;
    }

    islands.push({ plan, ring });
  }

  return { seed, polygons: fitExtents(islands), bounds };
}

/**
 * 点是否落在陆地内（任一环内即真）。
 *
 * `land` 为 null / 无环时恒为 false —— 调用方（放置素材、采样区块）不需要
 * 到处写空值判断。
 */
export function pointInLand(p: Point, land: MapLand | null): boolean {
  if (!land) return false;
  for (const ring of land.polygons) {
    if (ring.length >= 3 && pointInPolygon(p, ring)) return true;
  }
  return false;
}

/** 陆地占纸面积的比例（0 = 无陆地 / 纸面退化） */
export function landAreaRatio(land: MapLand): number {
  const paper = Math.max(0, land.bounds.width) * Math.max(0, land.bounds.height);
  if (paper <= 0) return 0;
  let sum = 0;
  for (const ring of land.polygons) sum += polygonArea(ring);
  return sum / paper;
}

/** 环的轴对齐包围盒 */
function ringBounds(ring: Point[]): Rect {
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
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 点是否落在环内（内部用，环顶点数不足时直接判否） */
function inRing(p: Point, ring: Point[]): boolean {
  return ring.length >= 3 && pointInPolygon(p, ring);
}

/** 线段是否真的相交（叉积异号法，端点/共线按不相交处理） */
function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const s = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / den;
  const t = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / den;
  const eps = 1e-9;
  return s > eps && s < 1 - eps && t > eps && t < 1 - eps;
}

/**
 * 两个闭合环是否相交（重叠或边界交叉）。
 *
 * 三级判定，由便宜到贵：
 *   1) 包围盒分离 ⇒ 必不相交（格子排布下绝大多数情形在此返回）；
 *   2) 任一方有顶点落在对方内 ⇒ 相交（覆盖"一个套一个"）；
 *   3) 任一对边**交叉** ⇒ 相交（覆盖顶点互不在对方内的"咬合"情形）。
 * 第 3 步是 O(n·m)，n = m = 96 时约 9 千次叉积，只在生成期跑几次，可接受。
 */
export function ringsIntersect(a: Point[], b: Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const ba = ringBounds(a);
  const bb = ringBounds(b);
  if (ba.x + ba.width < bb.x || bb.x + bb.width < ba.x) return false;
  if (ba.y + ba.height < bb.y || bb.y + bb.height < ba.y) return false;

  for (const p of a) if (inRing(p, b)) return true;
  for (const p of b) if (inRing(p, a)) return true;

  const na = a.length;
  const nb = b.length;
  for (let i = 0; i < na; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % na];
    for (let j = 0; j < nb; j += 1) {
      const b1 = b[j];
      const b2 = b[(j + 1) % nb];
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Douglas–Peucker 抽稀（闭合环：把首点也当作末点，两端点必保留）。
 *
 * 用显式栈而非递归，避免长环把调用栈打爆。
 * 调用方应在顶点数很多时才用它 —— 对平滑环用小容差会把环并成多边形。
 */
export function simplifyRing(pts: Point[], tolerance: number): Point[] {
  const n = pts.length;
  if (n <= 3 || tolerance <= 0) return pts.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [lo, hi] = range;
    if (hi - lo < 2) continue;
    const a = pts[lo];
    const b = pts[hi];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;

    let far = -1;
    let best = -1;
    for (let i = lo + 1; i < hi; i += 1) {
      const p = pts[i];
      let d: number;
      if (len2 < 1e-18) {
        d = Math.hypot(p.x - a.x, p.y - a.y);
      } else {
        // 闭弦上的最大偏离点必然落在投影区间内，因此 t 不必钳制
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
      }
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far > 0 && best > tolerance) {
      keep[far] = 1;
      stack.push([lo, far], [far, hi]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push(pts[i]);
  return out;
}

/**
 * 把陆地路径写进绘图目标 —— **Catmull-Rom → 三次贝塞尔**。
 *
 * 【为什么不用 `Graphics.poly()`】按 96 点直弦算，适应窗口下一条弦约 20 世界单位
 * ≈ 16 屏幕像素；而 PRD §6.1.2 原本写的 64 点更粗（约 31 像素）。那正是
 * §2.1 明令禁止的"折线感"。Catmull-Rom 的控制点只由相邻四点决定，
 * 曲线**穿过**每个采样点，且首尾自动闭合，一次遍历即可写完。
 *
 * 控制点（标准 Catmull-Rom 的贝塞尔形式）：
 *   a = P[i-1], b = P[i], c = P[i+1], d = P[i+2]
 *   cp1 = b + (c - a) / 6
 *   cp2 = c - (d - b) / 6
 *
 * 之后由**调用方**执行一次 `fill()` 或一次 `stroke()`：
 * 填充与描边必须分两份 Graphics（先全填、再全描），否则后画区块的填充会
 * 压掉前一段描边的一半，海岸白边就会断断续续（PRD §8.2 第 2 条）。
 */
export function drawLandPath(g: LandPathTarget, polygons: readonly Point[][]): void {
  for (const ring of polygons) {
    const n = ring.length;
    if (n < 3) continue;
    g.moveTo(ring[0].x, ring[0].y);
    for (let i = 0; i < n; i += 1) {
      const a = ring[(i - 1 + n) % n];
      const b = ring[i];
      const c = ring[(i + 1) % n];
      const d = ring[(i + 2) % n];
      g.bezierCurveTo(
        b.x + (c.x - a.x) / 6,
        b.y + (c.y - a.y) / 6,
        c.x - (d.x - b.x) / 6,
        c.y - (d.y - b.y) / 6,
        c.x,
        c.y,
      );
    }
    g.closePath();
  }
}

/**
 * 陆地各环的凸包（Andrew monotone chain）—— **凸性逃生开关**。
 *
 * 【什么时候用它】`regions.ts` 的 `voronoiCellIn` 用半平面裁剪，严格来说只对
 * **凸**裁剪框成立。而 r(θ) 生成的是星形多边形（0.72 的下限保证湾很浅），
 * 实测风险极低。若某天真的出现"区块跑到海里"，把传给 `generateHierarchy` 的
 * `container` 换成这里的凸包即可（改一行），代价是陆地边界被拉直成凸壳。
 */
export function landHull(land: MapLand): Point[][] {
  return land.polygons.filter((ring) => ring.length >= 3).map((ring) => convexHull(ring));
}

/** Andrew monotone chain 凸包（逆时针序，不含重复的首尾点） */
function convexHull(pts: Point[]): Point[] {
  const sorted = pts.slice().sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));
  if (sorted.length < 3) return sorted;

  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  // 两条链各自的末端点与另一条链的首点重复
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
