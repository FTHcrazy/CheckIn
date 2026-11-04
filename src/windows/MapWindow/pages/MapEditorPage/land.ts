/**
 * 陆地形状生成（纯函数，不依赖 React / Pixi / DOM）
 *
 * 【为什么单独生成陆地，而不复用最粗一级区块】
 * level-0 的区块是**铺满整张纸**的 —— 它没有外轮廓，描出来的白边会贴着纸边跑一圈，
 * 做不出海岸。区块是"地表的划分"，陆地是"地表本身"，两者必须解耦：
 * 陆地由本模块生成，区块再由 `regions.ts` 在陆地多边形**内部**切分（见 PRD §6.1.3）。
 *
 * 【形状算法：域扭曲 fbm + 极坐标半径】
 *   r(θ) = floor + amp · fbm(w(θ)) + detail · fbm(3.9·单位圆)
 *   其中 w(θ) = 单位圆·freq + warp · 两层低频噪声       ← 域扭曲
 * 选它而不是"撒点 + 形态学腐蚀膨胀"，理由有三：
 *   · 一次成型，顶点数可控（= 采样数），不需要额外做去自交；
 *   · θ 单调递增且 r 恒正 ⇒ 多边形**恒为简单闭合环**，不会出现打结的填充空洞；
 *   · 噪声场是位置的连续函数，同一个 θ 永远得到同一个 r ⇒ 天然可复现。
 *
 * ⚠️ **历次"太圆润"的根因都在参数，不在算法**：早期把 `floor` 定在 0.72，
 * 半径只能内缩 28%，画出来就是"带轻微起伏的椭圆"；后来加域扭曲才真正摆脱圆形。
 * 要更"碎"就调 `warp` / `freq`，要更深的海湾就调低 `floor` —— 但 `floor` 低于
 * 0.3 会出现细颈自咬的观感（数学上仍无自交，但视觉上像断成两截）。
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
 * PRD 写的是 64，中途取过 96。现在取 160 —— 原因变了：**不是**为了消折线
 * （贝塞尔已经把折线磨平了），而是为了容下 `LAND_RADIUS.detail` 那一层碎齿。
 * 碎齿绕一圈跨 54 个噪声格，按采样定理至少要 108 个点才不混叠；96 点会让
 * 高频细节退化成随机抖动，岸线看着"毛"而不"碎"。160 点成本可忽略（生成一次）。
 */
export const LAND_SAMPLES = 160;

/**
 * **单岛**陆地占纸面积的**排布目标**（不是"最终画面必须落在 55%~70%"）。
 *
 * ⚠️ 两个容易被误读的口径，先说清：
 *
 * 1. 这是给 `planIslands` 反解半轴用的**初值**。`fitExtents` 之后会按实测包围盒
 *    重算统一系数，所以最终占纸比例由**形状本身的紧凑度**决定，不由这个常量决定。
 * 2. 有机海岸的紧凑度天然低（轮廓在自己的包围盒里只占 40%~55%，圆是 78%），
 *    因此实际占纸比例约 **36%~51%**（seed 实测）。想让它更满只能把轮廓做圆 ——
 *    那正是本轮要修掉的毛病，所以**不要**为了凑百分比把 `lobe` / `rough` 调小。
 *
 * PRD §6.1.6 的验收区间是 15%~85%（针对最终画面里的陆地占比），多岛时更低
 * （主陆 + 卫星岛约 16%~33%），仍在该区间内。
 *
 * 格子放不下时会按几何上限退化（见 `planIslands`）。
 */
export const LAND_AREA_RATIO = { min: 0.55, max: 0.7 } as const;

/**
 * 陆地轮廓的四层参数。
 *
 * 【三次调参的教训，写下来免得再走一遍】
 *   ① v1 `floor 0.72 / amp 0.28`：半径只能内缩 28% ⇒ 画出来是**带轻微起伏的椭圆**
 *      —— 用户反馈的"太过于圆润"就是它。
 *   ② v2 把振幅放到 0.58 并加域扭曲：椭圆没了，但每一段岸线的起伏幅度都差不多，
 *      画出来是**边缘毛糙的土豆** —— 缺大尺度结构，没有"一条伸出去的半岛"。
 *   ③ v3（当前）把"大尺度"交给**低频谐波**（几个 k=2/3/5/7 的正弦，随机相位与幅度），
 *      域扭曲只负责把岸线拧出海湾，高频碎齿再加一层**受低频调制的**毛边 ——
 *      于是有的岸段平滑、有的破碎，主次分明。
 *
 * 各参数的分工：
 *   · `base`  —— 基线半径，直接决定陆地占纸比例（面积 ∝ E[r²]）。
 *   · `lobe`  —— 低频谐波总振幅，决定"有几个大湾/几条大半岛"。
 *   · `rough` —— 域扭曲 fbm 的振幅，半岛与海湾的细节。
 *   · `warp`  —— 域扭曲强度（单位：噪声格）。这是把"圆"推成"岸"的关键。
 *   · `freq`  —— 绕一圈跨过的噪声格数。
 *   · `detail`—— 高频碎齿振幅，近看岸线才不"光"。
 *
 * ⚠️ 不要只调 `rough`：它的能量均匀分布在整圈，调大只会越来越像云；
 * 想要"有主次的岸线"应该加 `lobe`、想加深海湾应该加 `warp`。
 */
export const LAND_RADIUS = {
  base: 0.82,
  lobe: 0.12,
  rough: 0.13,
  freq: 2.2,
  warp: 1.4,
  detail: 0.026,
  /** 海岸特征（海岬 / 深湾）数量：2~4 个，是"地图感"的主要来源 */
  features: 3,
} as const;

/** 相邻两岛之间的最小海峡宽度（= 两圈海岸可见外扩的量级） */
export const LAND_ISLAND_GAP = 24;

/** Douglas–Peucker 抽稀容差（世界单位） */
export const LAND_SIMPLIFY_TOL = 1.5;

/**
 * 抽稀的触发阈值：顶点数超过它才抽稀。
 *
 * 【为什么必须有阈值】按 1.5 的容差对一条半径 450 的环抽稀，弦长 30 对应的矢高
 * 只有 0.16 —— 远小于容差，结果会把采样点全部并掉，环退化成一个多边形块。
 * 抽稀是给"将来支持手绘超多点环"准备的逃生阀，默认 `LAND_SAMPLES` 的路径用不到。
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
 * 【为什么从 0.94 改成 1.0】旧参数下 r 的上界几乎取不到（fbm 尖峰极窄），
 * 所以用 0.94 做排布能多榨出几个百分点。新参数里海岬特征会把局部半径推到
 * `base + lobe + 特征幅度 ≈ 1.1`，按 0.94 排布会让岛直接顶出格子、吃掉海峡。
 * 宁可排布时保守（1.0），让 `fitExtents` 按实测去放大。
 */
export const LAND_EXTENT_NOMINAL = 1;

/**
 * 面积系数：A ≈ LAND_AREA_FACTOR · π · ax · ay。
 *
 * 由 A = ½∫r²dθ 推出：E[r²] = base² + Var(谐波) + Var(域扭曲) + Var(特征)。
 * 当前参数（base 0.82 / lobe 0.12 / rough 0.13 / 特征 ±0.12~0.32）实测 ≈ 0.70。
 * 它只是**初值** —— 生成后 `fitExtents` 会按实测包围盒校正，误差不致命；
 * 但估得太离谱会让 k 撞上限、陆地明显偏小，所以要跟着参数一起改。
 */
export const LAND_AREA_FACTOR = 0.7;

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
  /** 主轴倾角（弧度）。0 = 正南北，真实大陆极少摆得这么正 */
  angle: number;
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
 *   3) 每个岛的长半轴沿格子更长的那个方向，短半轴按**格子长宽比与 1 之间的随机值**
 *      压缩 —— 格子只给出"上限"，不再决定形状（见下方注释）；
 *   4) 半轴再按"名义外扩 ≤ 可用半幅"封顶，最后在**格子内的余量**里抖动岛心，
 *      并给主轴一个 ±22° 的倾角。
 *
 * 【为什么短半轴不再严格等于格子的比例】旧实现里 `ax : ay` 就是格子长宽比，
 * 两岛时格子是 456×912 的竖条，于是岛上画出来就是两条**竖长的圆角矩形** ——
 * 形状跟着排版走，而不是跟着地貌走。现在格子只负责"不许越过海峡"，真实长宽比
 * 在 `格子比例 ~ 1` 之间随机，岛才有胖瘦之分。
 *
 * 抖动只允许在余量内：格子就是"岛与邻岛的分界"，越界抖动等于把海峡吃掉。
 * 倾角同理受半轴封顶约束（封顶用的是保守的 `LAND_EXTENT_NOMINAL = 1`，旋转不会让
 * 实测外扩超出格子太多），最终仍由 `fitExtents` 按实测收口。
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

  // ── 列宽按"列内各岛面积和"分配，而不是等分 ──
  //
  // 【为什么必须这样】等分时两岛各拿半张纸宽，主陆被压成竖条 —— 而首块岛的
  // 权重是其余的 2~4 倍（见 generateLand），面积却和它一样宽，画出来就是
  // "一块大陆挤在小格子里"。按面积分配后，主陆能拿到接近整张纸宽的空格，
  // 小岛则退到窄列里当点缀，这才是地图上该有的主次。
  const colArea = new Array<number>(cols).fill(0);
  for (let i = 0; i < n; i += 1) colArea[i % cols] += Math.max(areas[i], 1);
  const colAreaSum = colArea.reduce((s, v) => s + v, 0) || 1;
  const colW = colArea.map((a) => (usableW * a) / colAreaSum);
  const colX: number[] = [];
  let accX = usableX;
  for (let c = 0; c < cols; c += 1) {
    colX.push(accX);
    accX += colW[c];
  }

  const cellH = usableH / rows;

  const out: IslandPlan[] = [];
  for (let i = 0; i < n; i += 1) {
    const gx = i % cols;
    const gy = Math.floor(i / cols) % rows;
    const cellX = colX[gx];
    const cellY = usableY + gy * cellH;
    const cellCx = cellX + colW[gx] / 2;
    const cellCy = cellY + cellH / 2;
    const spanX = colW[gx] / 2 - (cols > 1 ? LAND_ISLAND_GAP / 2 : 0);
    const spanY = cellH / 2 - (rows > 1 ? LAND_ISLAND_GAP / 2 : 0);
    // 格子退化（岛数太多）时不再生成，免得排出一堆零面积的碎屑
    if (spanX <= 1 || spanY <= 1) continue;

    const longIsY = spanY >= spanX;
    const cellRatio = Math.min(spanX, spanY) / Math.max(spanX, spanY);

    // 长宽比：格子比例是下限，1 是上限，中间随机 —— 岛不再被排版"刻"成长条
    const ratio = cellRatio + (1 - cellRatio) * (0.3 + rng() * 0.55);
    const target = Math.max(areas[i], 1);
    const long = Math.sqrt(target / (Math.PI * LAND_AREA_FACTOR * Math.max(ratio, 1e-3)));
    let ax = longIsY ? long * ratio : long;
    let ay = longIsY ? long : long * ratio;

    // 封顶：名义外扩不得超出格子可用半幅
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
      // ±22°：足够破掉"正南正北"的排版感，又不至于让长轴顶出格子
      angle: (rng() - 0.5) * ((22 * Math.PI) / 180) * 2,
      spanX,
      spanY,
    });
  }
  return out;
}

/**
 * 单岛形状函数：`t`（方向角）→ 半径倍数。
 *
 * 五层叠加（见 `LAND_RADIUS` 的注释）：
 *   ① 海岸特征 —— 每个岛随机 2~4 个**高斯型凸起/凹陷**，即"海岬"与"深湾"。
 *      这是"地图感"的主力：人看海岸线时认的是"那里伸出来一个半岛""这里凹进去
 *      一个湾"，而不是"边缘有随机毛刺"。纯噪声永远给不出可指认的半岛。
 *   ② 低频谐波 —— 几个 k=2/3/5/7 的正弦，随机相位与幅度，决定整体的胖瘦走向。
 *   ③ 域扭曲 fbm —— 用另一层低频噪声偏移**采样坐标本身**，把岸线拧成舌状。
 *   ④ 高频碎齿 —— 振幅被另一层低频调制，于是有的岸段平滑、有的破碎。
 *
 * 【为什么返回闭包而不是每次现算随机数】谐波相位、特征位置必须整岛一致：若在
 * 每个采样点重新取随机数，形状就变成白噪声，且与 seed 无关。
 *
 * 【无自交为什么是必然】结果恒为正 ⇒ r(θ) 是单值函数 ⇒ θ 单调采样出的环不自交。
 * 测试里那条"无自交"断言不是碰运气，是被这个结构保证的。
 */
function makeRadius(seed: number): (t: number) => number {
  const { base, lobe, rough, freq, warp, detail, features } = LAND_RADIUS;

  // ① 海岸特征：位置随机分布在整圈，宽度 0.12~0.38 弧度（太窄会成"尖刺"），
  //    约四成是湾（负值）、六成是岬（正值）—— 有湾的岸线才不像"一块色块"。
  const featRng = createRng(seed ^ 0x27d4eb2d);
  const caps: { theta: number; width: number; amp: number }[] = [];
  for (let i = 0; i < features; i += 1) {
    caps.push({
      theta: featRng() * Math.PI * 2,
      width: 0.12 + featRng() * 0.26,
      amp: (0.12 + featRng() * 0.2) * (featRng() < 0.42 ? -1 : 1),
    });
  }

  // ② 低频谐波：k 越大振幅越小（1/k 加权），总振幅归一到 lobe
  const rng = createRng(seed ^ 0x85ebca6b);
  const ks = [2, 3, 5, 7];
  const raw = ks.map((k) => (0.45 + rng() * 0.85) / k);
  const rawSum = raw.reduce((s, v) => s + v, 0);
  const amps = raw.map((v) => (v / rawSum) * lobe);
  const phases = ks.map(() => rng() * Math.PI * 2);

  return (t: number) => {
    const cos = Math.cos(t);
    const sin = Math.sin(t);

    let big = 0;
    for (let i = 0; i < ks.length; i += 1) big += amps[i] * Math.sin(ks[i] * t + phases[i]);

    // ① 特征：角度距离取最短弧（否则 θ 在 0/2π 处会断开一个口子）
    let cape = 0;
    for (const f of caps) {
      let d = t - f.theta;
      if (d > Math.PI) d -= Math.PI * 2;
      else if (d < -Math.PI) d += Math.PI * 2;
      const x = d / f.width;
      cape += f.amp * Math.exp(-x * x);
    }

    // ③ 域扭曲：低频、x / y 各一层，把岸线整体"拧"出海湾
    const lx = cos * freq;
    const ly = sin * freq;
    const wx = lx + warp * (fbm(lx * 0.45 + 13.1, ly * 0.45 + 4.7, seed + 911, 2) - 0.5) * 2;
    const wy = ly + warp * (fbm(lx * 0.45 - 7.3, ly * 0.45 + 9.2, seed + 577, 2) - 0.5) * 2;
    const mid = (fbm(wx, wy, seed, 4, 2.05, 0.5) - 0.5) * 2;

    // ④ 碎齿：用低频 mask 调制振幅 —— 全圈一样毛糙会像云，有的段光滑才像岸
    const mask = 0.2 + 0.8 * fbm(lx * 0.8 + 3.3, ly * 0.8 - 2.1, seed + 733, 2);
    const grit = (fbm(lx * 9.1, ly * 9.1, seed + 313, 2) - 0.5) * 2 * mask;

    return base + cape + big + mid * rough + grit * detail;
  };
}

/** 生成一个岛的闭合环（各向异性拉伸 + 主轴旋转） */
function makeRing(plan: IslandPlan, seed: number, samples: number): Point[] {
  const n = Math.max(8, Math.round(samples));
  const cosA = Math.cos(plan.angle);
  const sinA = Math.sin(plan.angle);
  const radius = makeRadius(seed);
  const ring: Point[] = [];
  for (let k = 0; k < n; k += 1) {
    const t = (k / n) * Math.PI * 2;
    const r = radius(t);
    // 先在"未旋转的椭圆系"里算，再整体旋转 —— 否则拉伸与旋转的顺序会让
    // 长轴被拉长成 1/sin 倍，形状失控
    const lx = r * plan.ax * Math.cos(t);
    const ly = r * plan.ay * Math.sin(t);
    ring.push({
      x: plan.center.x + lx * cosA - ly * sinA,
      y: plan.center.y + lx * sinA + ly * cosA,
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
  // 上限从 1.25 放开到 1.6：新形状的初始半轴估得比旧参数保守（`floor` 从 0.72 降到
  // 0.42，面积系数也随之从 0.746 降到 0.52），实测常常需要放大才能贴住格子。
  // 下限 0.5 保留 —— 异常输入时宁可小一圈，也不要吹成气球盖住海峡。
  k = clamp(k, 0.5, 1.6);

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

  // 单陆 55% / 双陆 30% / 三陆 15%。
  // 【为什么不均匀取 1~3】一块完整大陆是奇幻地图的主力构图；均匀撒 1~3 会让
  // "两块挤在一起的小岛"成为三分之一的默认结果 —— 用户点一次生成就得到一张
  // 零碎的图。想多岛就多点几次，或显式传 `islands`。
  const islandRoll = rng();
  const autoIslands = islandRoll < 0.55 ? 1 : islandRoll < 0.85 ? 2 : 3;
  const count = clamp(Math.round(options.islands ?? autoIslands), 1, 8);

  // 目标总面积与逐岛面积权重。
  //
  // 【为什么第一块要占主导】旧权重是 0.7~1.3 —— 多岛时画出来是"两条一样大的
  // 长圆"，读起来像复制粘贴，而不是地图。真实地形几乎总是"一块主陆 + 若干小岛"，
  // 所以首块固定为 1，其余 0.22~0.5：主陆撑住画面，小岛做点缀与航线节点。
  const targetRatio = LAND_AREA_RATIO.min + rng() * (LAND_AREA_RATIO.max - LAND_AREA_RATIO.min);
  const targetArea = paperArea * targetRatio;
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < count; i += 1) {
    const w = i === 0 ? 1 : 0.22 + rng() * 0.28;
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
