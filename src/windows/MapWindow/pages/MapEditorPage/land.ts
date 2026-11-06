/**
 * 陆地形状生成（纯函数，不依赖 React / Pixi / DOM）
 *
 * 【为什么单独生成陆地，而不复用最粗一级区块】
 * level-0 的区块是**铺满整张纸**的 —— 它没有外轮廓，描出来的白边会贴着纸边跑一圈，
 * 做不出海岸。区块是"地表的划分"，陆地是"地表本身"，两者必须解耦：
 * 陆地由本模块生成，区块再由 `regions.ts` 在陆地多边形**内部**切分（见 PRD §6.1.3）。
 *
 * 【形状算法：SDF 侵蚀管线 —— 逆向目标 erodeGeoJSON 的参数化重建】
 * 2.34.0 起，海岸形状不再用极坐标 r(θ)（历次"太圆润"都根因于它：全域等强噪声
 * 给不出"边缘毛糙、内陆干净"的层次），改为直接采用逆向分析
 * （`docs/review/map-vs-reference-render-analysis.md` §3.6，`decoded.js@747732`）
 * 的算法与参数：
 *
 *   1. 母形栅格化 → 有符号距离场 SDF（Felzenszwalb 双向距离变换）；
 *   2. 域扭曲：fx = x + fbm(x·0.012, y·0.012, 5 octaves)·115（warpAmp），
 *      把整条岸线"甩"出半岛与深湾 —— 这是大尺度结构的主力；
 *   3. 距离衰减细节：d += fbm(x·0.085, y·0.085, 3 octaves)·26·exp(−d²/(2·28²))
 *      —— **离岸越近细节越强、深入内陆迅速归零**，海岸有手绘碎边而内陆平整，
 *      素材落上去不会与岸线纹理互相干扰（逆向目标"和谐"的关键一条）；
 *   4. marching squares at iso=0 → 轮廓 → 角切平滑 ×2（Chaikin）→ Douglas–Peucker 抽稀。
 *
 * 母形（第 1 步的输入）由轻微起伏的极坐标环给出（`makeRadius`，能量压得很低）——
 * 它只负责"这块陆地的胖瘦与走向"，海岸的全部性格交给侵蚀管线。这与逆向目标
 * 用 GeoJSON 大陆轮廓当输入是同一分工。
 *
 * 【无自交】marching squares 在标量场 iso=0 上追踪出的环天然互不相交；
 * Chaikin / Douglas–Peucker 都是保序收缩变换，不引入交叉。
 *
 * 【多岛靠"格子"而不是靠随机撒点】随机撒点 + 收缩重试在两岛以上时几乎必然失败：
 * 第一个岛会把纸心占满，第二个岛无论怎么缩都塞不进剩下的环形边角。改成"先按岛数
 * 分格、再让每个岛填满自己的格子"，排布就是**必然成功**的确定性过程。
 * 侵蚀在**每岛局部栅格**上独立进行：扭曲场再猛也不会把两座岛"焊"到一起，
 * 最终按格子半幅贴合（`fitRingToSpan`）结构性保证海峡宽度。
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
 * 母形环的方向角采样数。
 *
 * 母形只是侵蚀管线的输入（栅格化成掩码就丢），160 点远密于栅格分辨率
 * （母形周长 ≈ 2400 世界单位 ÷ 160 ≈ 15 单位/弦，栅格 1 像素 ≈ 2 单位），
 * 足够扫描线填充不出锯齿漏洞；再密只是浪费。
 */
export const LAND_SAMPLES = 160;

/**
 * **单岛**陆地占纸面积的**排布目标**（不是"最终画面必须落在 55%~70%"）。
 *
 * ⚠️ 两个容易被误读的口径，先说清：
 *
 * 1. 这是给 `planIslands` 反解半轴用的**初值**。`fitRingToSpan` 之后会按侵蚀后的
 *    实测轮廓重算统一系数，最终占纸比例由**形状本身的紧凑度**决定。
 * 2. 有机海岸的紧凑度天然低（轮廓在自己的包围盒里只占四成上下，圆是 78%），
 *    侵蚀扭曲越猛紧凑度越低 —— 占纸比例随之下调是**观感优先**的取舍，不是退化。
 *
 * PRD §6.1.6 的验收区间是 15%~85%（针对最终画面里的陆地占比），多岛时更低
 * （主陆 + 卫星岛约 16%~30%），仍在该区间内。
 */
export const LAND_AREA_RATIO = { min: 0.55, max: 0.7 } as const;

/**
 * 母形环的四层参数 —— **能量刻意压低**。
 *
 * 【分工变迁】v1~v4 时代这四层承担全部海岸性格（湾/岬/毛边都在这里调）；
 * 2.34.0 起大尺度结构归域扭曲（`LAND_ERODE.warpAmp`）、碎边归距离衰减细节
 * （`detAmp`/`detRadius`），母形只负责"胖瘦与走向"，所以各层振幅都是轻描淡写。
 * ⚠️ 不要再在这里加能量 —— 母形锯齿会被侵蚀管线原样放大成"双重毛边"。
 *
 * `base − (特征 + lobe + rough 的同号叠加)` ≈ 0.6 > 0，r(θ) 恒正，无自交。
 */
export const LAND_RADIUS = {
  base: 0.86,
  lobe: 0.1,
  rough: 0.08,
  freq: 1.6,
  warp: 0.6,
  detail: 0,
  /** 海岸特征（海岬 / 深湾）数量：给母形一点大尺度走向的随机性 */
  features: 4,
} as const;

/**
 * 侵蚀管线参数 —— **逆向目标 `erodeGeoJSON` 的原始口径**（世界单位 1:1）。
 *
 * 证据：`decoded.js@747732`（见 `docs/review/map-vs-reference-render-analysis.md`
 * §3.6）。原实现工作在 1200×800 画布上（1 px ≈ 1 世界单位），因此这里的
 * 幅度/半径/频率可以**逐字照抄**；`pad` / `gridLong` 是我们逐岛局部栅格的
 * 工程参数，不是逆向值。
 */
export const LAND_ERODE = {
  /**
   * 局部栅格长边上限（像素）。逆向目标整图 1200×800；我们逐岛计算，
   * 主陆局部栅格 ≈ 1250 世界单位宽，640 px 时 1 px ≈ 2 世界单位，
   * 细节噪声波长（≈ 12 单位）仍有 6 px/波长，marching squares 精度足够。
   */
  gridLong: 640,
  /**
   * 岛包围盒之外的栅格外扩（世界单位）。≥ warpAmp + detAmp（= 141）才有余量：
   * 岸线在扭曲下最多游移 ±141，栅格必须盖住游移后的零线，否则轮廓切边。
   */
  pad: 176,
  /** 域扭曲幅度（世界单位）。岸线游移的主引擎 —— 半岛与深湾的来源。 */
  warpAmp: 115,
  /** 域扭曲噪声频率（每世界单位）。波长 ≈ 83 单位，低频、空间连贯。 */
  noiseScale: 0.012,
  /** 域扭曲 fbm 层数 */
  warpOctaves: 5,
  /** 细节噪声频率（每世界单位）。波长 ≈ 11.8 单位，近看岸线的碎边。 */
  detScale: 0.085,
  /** 细节 fbm 层数 */
  detOctaves: 3,
  /** 细节噪声幅度（世界单位） */
  detAmp: 26,
  /**
   * 细节衰减半径（世界单位）：幅度权重 exp(−d²/(2·detRadius²))，
   * 离岸 ≈28 单位处减半、≈60 单位处归零 —— "边缘毛糙、内陆干净"。
   */
  detRadius: 28,
  /** 追踪出的环面积下限（世界单位²，参考实现 700 px² 同量级）：碎屑环直接丢弃 */
  minArea: 1500,
  /** 角切平滑（Chaikin）次数，参考实现 smooth: 2 */
  smooth: 2,
  /** Douglas–Peucker 抽稀起步容差（世界单位） */
  simplifyTol: 1.5,
  /** 单环顶点数上限：超过则加倍容差重抽（下游烘焙/描边/命中的成本护栏） */
  maxPoints: 720,
  /**
   * 小岛的扭曲幅度封顶比例：warpEff = min(warpAmp, 母形半径 × 该值)。
   * 主陆半径 ≈ 390 时拿到全额 115；卫星岛（半径 ≈ 150）按比例收到 ~45 ——
   * 否则固定 115 会把小岛拧成一团没有"岛"样的碎渣。
   */
  warpCapRatio: 0.3,
} as const;

/** 相邻两岛之间的最小海峡宽度（= 两圈海岸可见外扩的量级） */
export const LAND_ISLAND_GAP = 24;

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
 * 母形 r 的上界（base + 特征 + lobe + rough ≈ 1.12）乘上它就是排布时的保守
 * 外扩估计；侵蚀后的实测贴合交给 `fitRingToSpan`。
 */
export const LAND_EXTENT_NOMINAL = 1;

/**
 * 面积系数：A ≈ LAND_AREA_FACTOR · π · ax · ay。
 *
 * 由 A = ½∫r²dθ 推出：E[r²] = base² + Var(谐波) + Var(域扭曲) + Var(特征)。
 * 母形参数（base 0.86 / lobe 0.1 / rough 0.08 / 特征 ±0.08~0.2）实测 ≈ 0.74。
 * 它只是**初值** —— 侵蚀后 `fitRingToSpan` 会按实测轮廓校正，误差不致命。
 */
export const LAND_AREA_FACTOR = 0.74;

/** 相交兜底时的单次收缩系数 */
export const LAND_SHRINK = 0.92;

/** 相交兜底时的重试次数 */
export const LAND_OVERLAP_RETRIES = 5;

export interface LandOptions {
  /** 随机种子 */
  seed: number;
  /** 世界范围（整张纸） */
  bounds: Rect;
  /** 岛数；缺省由 rng 取 1~3 */
  islands?: number;
  /** 母形方向角采样数；缺省 `LAND_SAMPLES` */
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
 * 把岛摆进纸面 —— **格子排布**。
 *
 * 步骤：
 *   1) 纸内缩 `LAND_PAPER_MARGIN` 得到可用区，按岛数切成 cols × rows 个格子；
 *   2) 每格的可用半幅 = 半格宽 −（该方向上有邻居才扣）海峡的一半；
 *   3) 每个岛的长半轴沿格子更长的那个方向，短半轴按**格子长宽比与 1 之间的随机值**
 *      压缩 —— 格子只给出"上限"，不再决定形状；
 *   4) 半轴再按"名义外扩 ≤ 可用半幅"封顶，最后在**格子内的余量**里抖动岛心，
 *      并给主轴一个 ±22° 的倾角。
 *
 * 【列宽按面积分配】等分时两岛各拿半张纸宽，主陆被压成竖条。按面积分配后，
 * 主陆能拿到接近整张纸宽的空格，小岛退到窄列里当点缀 —— 这才是地图上的主次。
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
 * 母形形状函数：`t`（方向角）→ 半径倍数。
 *
 * 四层叠加（见 `LAND_RADIUS` 注释）：特征（岬/湾的低能量雏形）、低频谐波、
 * 域扭曲 fbm、高频碎齿（当前 detail=0 关闭）。母形只管"胖瘦与走向"，
 * 海岸性格由 `LAND_ERODE` 的侵蚀管线负责 —— **别在这里加能量**。
 *
 * 【为什么返回闭包而不是每次现算随机数】谐波相位、特征位置必须整岛一致。
 * 【无自交】结果恒为正 ⇒ r(θ) 单值 ⇒ θ 单调采样出的环不自交。
 */
function makeRadius(seed: number): (t: number) => number {
  const { base, lobe, rough, freq, warp, detail, features } = LAND_RADIUS;

  // ① 海岸特征：位置随机分布在整圈，宽度 0.12~0.38 弧度，约一半是湾一半是岬。
  //    母形上只留"大尺度走向"的雏形（幅度 0.08~0.2），深湾长岬交给扭曲。
  const featRng = createRng(seed ^ 0x27d4eb2d);
  const caps: { theta: number; width: number; amp: number }[] = [];
  for (let i = 0; i < features; i += 1) {
    caps.push({
      theta: featRng() * Math.PI * 2,
      width: 0.12 + featRng() * 0.26,
      amp: (0.08 + featRng() * 0.12) * (featRng() < 0.5 ? -1 : 1),
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

    // ③ 域扭曲（低能量）：把母形从"椭圆"拧成"有机的胖瘦"
    const lx = cos * freq;
    const ly = sin * freq;
    const wx = lx + warp * (fbm(lx * 0.45 + 13.1, ly * 0.45 + 4.7, seed + 911, 2) - 0.5) * 2;
    const wy = ly + warp * (fbm(lx * 0.45 - 7.3, ly * 0.45 + 9.2, seed + 577, 2) - 0.5) * 2;
    const mid = (fbm(wx, wy, seed, 4, 2.05, 0.5) - 0.5) * 2;

    // ④ 碎齿：当前 detail = 0（侵蚀管线的 detAmp/detRadius 负责碎边）
    const mask = 0.2 + 0.8 * fbm(lx * 0.8 + 3.3, ly * 0.8 - 2.1, seed + 733, 2);
    const grit = (fbm(lx * 9.1, ly * 9.1, seed + 313, 2) - 0.5) * 2 * mask;

    return base + cape + big + mid * rough + grit * detail;
  };
}

/** 生成母形闭合环（各向异性拉伸 + 主轴旋转） */
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
 * 按格子半幅贴合侵蚀后的海岸轮廓。
 *
 * 侵蚀会把岸线甩出母形包围盒（最多 ±(warpAmp + detAmp) ≈ ±141），排布格子
 * 不知道这件事；这里按实测半幅与 `plan.center` 反解统一系数 k，让每个岛
 * **"刚好"贴住自己格子的可用半幅** —— 海峡宽度由格子结构保证，不靠运气。
 * k 夹在 [0.5, 1.25]：异常退化时宁可小一圈，也不吹成气球。
 */
function fitRingToSpan(ring: Point[], plan: IslandPlan): Point[] {
  const { hx, hy } = ringHalfSpan(ring, plan.center);
  const k = clamp(Math.min(plan.spanX / hx, plan.spanY / hy), 0.5, 1.25);
  return k === 1 ? ring : scaleRing(ring, plan.center, k);
}

/* ────────────────────── SDF 侵蚀管线（逆向目标 §3.6） ────────────────────── */

/**
 * 多边形掩码的扫描线栅格化（偶奇规则）。
 *
 * 逐行求多边形各边与"像素行中心"水平线的交点 x，排序后成对填充 ——
 * 偶奇规则对凸/凹多边形都成立，且与 `pointInPolygon` 同一判据。
 * `ox` / `oy` 是像素 (0,0) **中心**的世界坐标，`cell` 是像素边长（世界单位）。
 */
function rasterizeRing(
  ring: readonly Point[],
  ox: number,
  oy: number,
  cell: number,
  gw: number,
  gh: number,
): Uint8Array {
  const mask = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j += 1) {
    const y = oy + j * cell;
    const xs: number[] = [];
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        xs.push(a.x + (b.x - a.x) * t);
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let i0 = Math.ceil((xs[k] - ox) / cell);
      let i1 = Math.floor((xs[k + 1] - ox) / cell);
      if (i0 < 0) i0 = 0;
      if (i1 > gw - 1) i1 = gw - 1;
      for (let i = i0; i <= i1; i += 1) mask[j * gw + i] = 1;
    }
  }
  return mask;
}

/**
 * 一维欧氏距离变换的平方域下包络（Felzenszwalb & Huttenlocher）。
 *
 * `f[q]` 是该位置的"源代价"（源 = 0，其余 = 大有限值），输出 `out[q]` =
 * min_p (f[p] + (q−p)²)。O(n) 两趟（列 / 行）即得二维距离变换的平方值。
 * 用 1e12 当"无穷"（不是 Infinity）：下包络的交点运算是减法除法，
 * Infinity 会产生 NaN，大有限值行为等价且数值安全。
 */
function edt1d(f: Float64Array, n: number, out: Float64Array): void {
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s =
      ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s =
        ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    const d = q - v[k];
    out[q] = f[v[k]] + d * d;
  }
}

/** 到"掩码 = want 的最近像素"的欧氏距离场（像素中心采样） */
function distanceToSet(
  mask: Uint8Array,
  gw: number,
  gh: number,
  want: boolean,
): Float32Array {
  const INF = 1e12;
  const m = Math.max(gw, gh);
  const f = new Float64Array(m);
  const d = new Float64Array(m);
  const sq = new Float64Array(gw * gh);

  for (let i = 0; i < gw; i += 1) {
    for (let j = 0; j < gh; j += 1) {
      f[j] = (mask[j * gw + i] === 1) === want ? 0 : INF;
    }
    edt1d(f, gh, d);
    for (let j = 0; j < gh; j += 1) sq[j * gw + i] = d[j];
  }
  for (let j = 0; j < gh; j += 1) {
    for (let i = 0; i < gw; i += 1) f[i] = sq[j * gw + i];
    edt1d(f, gw, d);
    for (let i = 0; i < gw; i += 1) sq[j * gw + i] = d[i];
  }
  const out = new Float32Array(gw * gh);
  for (let p = 0; p < sq.length; p += 1) out[p] = Math.sqrt(sq[p]);
  return out;
}

/**
 * 环 → 有符号距离场（外正内负）。像素中心采样（与 `rasterizeRing` 同一坐标系），
 * 但**返回值是世界单位**：EDT 输出是像素距离，必须乘 `cell` 归一 ——
 * 否则 iso=±distance 的等值线偏移量被放大 ~cell 倍、detAmp/detRadius 与 φ 的
 * 单位也互相错位（2.34.0 曾因此 offset(16) 实测 ≈24）。
 */
function sdfOfRing(
  ring: readonly Point[],
  ox: number,
  oy: number,
  cell: number,
  gw: number,
  gh: number,
): Float32Array {
  const mask = rasterizeRing(ring, ox, oy, cell, gw, gh);
  const phi = new Float32Array(gw * gh);
  const dIn = distanceToSet(mask, gw, gh, true);
  const dOut = distanceToSet(mask, gw, gh, false);
  for (let p = 0; p < phi.length; p += 1) phi[p] = (dIn[p] - dOut[p]) * cell;
  return phi;
}

/** 已建好的偏移距离场（栅格 + SDF）。一次建场、多次取等值线（见 `createRingOffset`）。 */
interface OffsetField {
  ox: number;
  oy: number;
  cell: number;
  gw: number;
  gh: number;
  phi: Float32Array;
}

/** 环 → 偏移距离场。栅格 = 环包围盒向四周扩 `margin` 世界单位。 */
function buildOffsetField(ring: readonly Point[], margin: number): OffsetField | null {
  if (ring.length < 3) return null;
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
  const ox = minX - margin;
  const oy = minY - margin;
  const worldW = maxX - minX + margin * 2;
  const worldH = maxY - minY + margin * 2;
  const cell = Math.max(0.75, Math.max(worldW, worldH) / LAND_ERODE.gridLong);
  const gw = Math.max(8, Math.ceil(worldW / cell));
  const gh = Math.max(8, Math.ceil(worldH / cell));
  return { ox, oy, cell, gw, gh, phi: sdfOfRing(ring, ox, oy, cell, gw, gh) };
}

/** 在偏移场上取等值线：distance > 0 外扩（φ > d 一侧为内部）、< 0 内缩（φ < d） */
function traceOffsetField(field: OffsetField, distance: number): Point[] | null {
  const loops = marchingSquaresLoops(field.phi, field.gw, field.gh, distance, distance > 0);
  let best: Point[] | null = null;
  let bestArea = 1;
  for (const loop of loops) {
    const world = loop.map((q) => ({
      x: field.ox + q.x * field.cell,
      y: field.oy + q.y * field.cell,
    }));
    const area = Math.abs(polygonArea(world));
    if (area > bestArea) {
      bestArea = area;
      best = world;
    }
  }
  if (!best) return null;
  return simplifyClosed(chaikinClosed(best, LAND_ERODE.smooth), LAND_ERODE.simplifyTol, LAND_ERODE.maxPoints);
}

/** 单次偏移的便捷入口（`insetLand` 用；调用方要取多条等值线时用 `createRingOffset`） */
function offsetRing(ring: readonly Point[], offset: number): Point[] | null {
  const field = buildOffsetField(ring, Math.abs(offset) + 4);
  if (!field) return null;
  return traceOffsetField(field, offset);
}

/** 偏移场的公开句柄 */
export interface RingOffsetField {
  /**
   * 精确偏移（世界单位）：> 0 向外扩（朝海）、< 0 向内缩（朝陆）。
   * 偏移后无剩余面积（内缩量 ≥ 环半幅）或距离非法（0 / NaN）时返回 null。
   */
  offset(distance: number): Point[] | null;
}

/**
 * 为一个环建偏移距离场 —— **一次建场、多次取等值线**。
 *
 * 【为什么开放这个 API】烘焙期同一张海岸要从同一场里取很多条等值线：
 * 3 圈等深线（外扩 16/40/70）+ 纸纹羽化的 N 层内缩遮罩。栅格化 + 双向
 * 距离变换每次约几十毫秒，重复建场会把烘焙时间乘上层数；建一次场之后，
 * 每取一条线只是一次 marching squares（毫秒级）。
 *
 * `maxOffset` 是本次会话要取的最大**外扩**距离：它决定栅格向外扩多少余量
 * （等值线最多游移到离岸 maxOffset 处，栅格必须盖住）；内缩方向天然被
 * 环包围盒覆盖，不受此参数约束。环退化（顶点 < 3）或参数非法时返回 null。
 */
export function createRingOffset(
  ring: readonly Point[],
  maxOffset: number,
): RingOffsetField | null {
  if (ring.length < 3 || !(maxOffset > 0) || !Number.isFinite(maxOffset)) return null;
  const field = buildOffsetField(ring, maxOffset + 4);
  if (!field) return null;
  return {
    offset(distance: number): Point[] | null {
      if (!Number.isFinite(distance) || distance === 0) return null;
      return traceOffsetField(field, distance);
    },
  };
}

/**
 * 把偏移环的个别越界顶点拉回原环内。
 *
 * Chaikin / Douglas–Peucker 都是原等值线上的 ±1~2 世界单位近似；在岸线的
 * 尖凹角处这半点偏差会让顶点落回原环外。沿「顶点 → 环顶点均值中心」二分
 * 收拉（均值中心经全 seed 实测恒在环内），每个问题顶点 ≤ 12 次
 * `pointInPolygon`，正常环一个都不触发。
 */
function pullIntoRing(ring: Point[], offset: Point[]): Point[] {
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  return offset.map((p) => {
    if (pointInPolygon(p, ring)) return p;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 12; i += 1) {
      const mid = (lo + hi) / 2;
      const q = { x: cx + (p.x - cx) * mid, y: cy + (p.y - cy) * mid };
      if (pointInPolygon(q, ring)) hi = mid;
      else lo = mid;
    }
    // hi 只在二分中验证过才可信；极端退化时直接落到均值中心（恒在环内）
    const q = { x: cx + (p.x - cx) * hi, y: cy + (p.y - cy) * hi };
    return pointInPolygon(q, ring) ? q : { x: cx, y: cy };
  });
}

/** 双线性采样标量场（坐标 = 像素中心连续坐标，越界钳到边缘） */
function sampleField(
  field: Float32Array,
  gw: number,
  gh: number,
  u: number,
  v: number,
): number {
  const x = clamp(u, 0, gw - 1);
  const y = clamp(v, 0, gh - 1);
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const i1 = Math.min(i0 + 1, gw - 1);
  const j1 = Math.min(j0 + 1, gh - 1);
  const fx = x - i0;
  const fy = y - j0;
  const a = field[j0 * gw + i0];
  const b = field[j0 * gw + i1];
  const c = field[j1 * gw + i0];
  const e = field[j1 * gw + i1];
  const top = a + (b - a) * fx;
  const bottom = c + (e - c) * fx;
  return top + (bottom - top) * fy;
}

/**
 * marching squares 追踪等值线（多环）。
 *
 * 每个非鞍点格子输出 1 段、鞍点格子（5 / 10）按**格子中心均值**消歧，
 * 段的两端用"边 id"标记（水平边 = 像素索引 ×2，垂直边 = ×2+1），同一条边
 * 被相邻两格共享 ⇒ 沿边 id 串接必然成环。贴栅格边界的开链（理论上被
 * pad 排除）无法闭合，直接丢弃。
 *
 * `iso` 是等值线水平：`insideAbove = true` 时「> iso」一侧算内部（海岸外扩、
 * 主生成用），`false` 时「< iso」一侧算内部（海岸内缩用）。
 */
function marchingSquaresLoops(
  field: Float32Array,
  gw: number,
  gh: number,
  iso = 0,
  insideAbove = true,
): Point[][] {
  const isIn = (v: number) => (insideAbove ? v > iso : v < iso);
  const segs: Array<[number, number]> = [];
  for (let j = 0; j + 1 < gh; j += 1) {
    for (let i = 0; i + 1 < gw; i += 1) {
      const a = field[j * gw + i]; // 左上
      const b = field[j * gw + i + 1]; // 右上
      const c = field[(j + 1) * gw + i + 1]; // 右下
      const d = field[(j + 1) * gw + i]; // 左下
      let code = 0;
      if (isIn(a)) code |= 1;
      if (isIn(b)) code |= 2;
      if (isIn(c)) code |= 4;
      if (isIn(d)) code |= 8;
      if (code === 0 || code === 15) continue;

      // 边 id：水平边（(i,j)-(i+1,j) 之间）= (j·gw+i)·2；垂直边 = +1
      const topE = (j * gw + i) * 2;
      const bottomE = ((j + 1) * gw + i) * 2;
      const leftE = (j * gw + i) * 2 + 1;
      const rightE = (j * gw + i + 1) * 2 + 1;

      const push = (e1: number, e2: number) => segs.push([e1, e2]);
      switch (code) {
        case 1:
        case 14:
          push(leftE, topE);
          break;
        case 2:
        case 13:
          push(topE, rightE);
          break;
        case 3:
        case 12:
          push(leftE, rightE);
          break;
        case 4:
        case 11:
          push(rightE, bottomE);
          break;
        case 6:
        case 9:
          push(topE, bottomE);
          break;
        case 7:
        case 8:
          push(leftE, bottomE);
          break;
        case 5: {
          // 鞍点：a/c 同侧。中心在内部侧 ⇒ a-c 连通 ⇒ 段绕开 b、d；
          // 中心在外部侧 ⇒ a、c 各自孤立 ⇒ 段绕开它们
          const centerIn = isIn((a + b + c + d) / 4);
          if (centerIn) {
            push(topE, rightE);
            push(bottomE, leftE);
          } else {
            push(leftE, topE);
            push(rightE, bottomE);
          }
          break;
        }
        case 10: {
          const centerIn = isIn((a + b + c + d) / 4);
          if (centerIn) {
            push(leftE, topE);
            push(rightE, bottomE);
          } else {
            push(topE, rightE);
            push(bottomE, leftE);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // 串接成环：每条边恰被 2 段共享（开链在边界处只有 1 段，走不通即弃）
  const at = new Map<number, number[]>();
  const add = (e: number, s: number) => {
    const list = at.get(e);
    if (list) list.push(s);
    else at.set(e, [s]);
  };
  segs.forEach(([e1, e2], idx) => {
    add(e1, idx);
    add(e2, idx);
  });

  const edgePoint = (id: number): Point => {
    const idx = id >> 1;
    const i = idx % gw;
    const j = (idx - i) / gw;
    if ((id & 1) === 0) {
      const va = field[j * gw + i];
      const vb = field[j * gw + i + 1];
      const t = (iso - va) / (vb - va);
      return { x: i + t, y: j };
    }
    const va = field[j * gw + i];
    const vb = field[(j + 1) * gw + i];
    const t = (iso - va) / (vb - va);
    return { x: i, y: j + t };
  };

  const used = new Uint8Array(segs.length);
  const loops: Point[][] = [];
  for (let s0 = 0; s0 < segs.length; s0 += 1) {
    if (used[s0]) continue;
    used[s0] = 1;
    const first = segs[s0][0];
    const loop: Point[] = [edgePoint(first)];
    let cur = segs[s0][1];
    let seg = s0;
    let closed = false;
    for (let guard = segs.length + 1; guard > 0; guard -= 1) {
      if (cur === first) {
        closed = true;
        break;
      }
      loop.push(edgePoint(cur));
      const cands = at.get(cur) ?? [];
      const nxt = cands[0] === seg ? cands[1] : cands[0];
      if (nxt === undefined || used[nxt]) break;
      used[nxt] = 1;
      const [e1, e2] = segs[nxt];
      seg = nxt;
      cur = e1 === cur ? e2 : e1;
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** 闭合环的 Chaikin 角切平滑：每个角切成 25% / 75% 两点，顶点数翻倍 */
function chaikinClosed(ring: Point[], passes: number): Point[] {
  let pts = ring;
  for (let p = 0; p < passes; p += 1) {
    const out: Point[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = out;
  }
  return pts;
}

/**
 * 环是否自交（朴素 O(n²)，只给抽稀校验用 —— 输入 ≤ maxPoints，最坏 26 万次叉积）。
 * 相邻边共享端点不算相交； Chaikin 角切是收缩变换、输出必然简单，本函数
 * 只需要审"抽稀有没有把细颈切成交叉"这一种情况。
 */
function ringSelfIntersects(ring: Point[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  const cross = (
    a1: Point,
    a2: Point,
    b1: Point,
    b2: Point,
  ): boolean => {
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
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (cross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** 对闭合环跑一次 Douglas–Peucker（从最左点断开，首尾复制后走 `simplifyRing`） */
function dpClosedOnce(ring: Point[], t: number): Point[] {
  let start = 0;
  for (let i = 1; i < ring.length; i += 1) {
    if (ring[i].x < ring[start].x) start = i;
  }
  const rotated = ring.slice(start).concat(ring.slice(0, start));
  const simplified = simplifyRing(rotated.concat([rotated[0]]), t);
  simplified.pop(); // 首尾复制补出来的重复点
  return simplified;
}

/**
 * 闭合环抽稀：Douglas–Peucker，顶点数超过 `maxPoints` 时容差 ×1.6 加压。
 *
 * 【自交校验】抽稀会把细颈（窄半岛的根部）两侧各取几个点，若切得过狠，
 * 两岸直接接通成环上交叉 —— 渲染填充会出现一个洞，点在多边形内判定也会错。
 * 所以每次抽稀结果都过一遍 `ringSelfIntersects`。
 *
 * 【容差只朝一个方向走】自交 ⇒ 收紧（÷1.6）；简单但超护栏 ⇒ 加压（×1.6）。
 * 两个方向来回切会**震荡死循环**（收紧后简单但超护栏、加压后超护栏但自交 ——
 * 同一个环两种修正方向互相抵消，实测 seed=7 单岛在 1.5/0.94 之间无限往复，
 * 每轮还是对 1.8 万点的 Chaikin 输出跑 DP + O(n²) 校验）。因此：一旦经历过
 * 自交，护栏让位于正确性 —— 收紧方向上第一个"简单"的结果直接采用（顶点数
 * 允许超出软护栏）；从未自交才允许加压省顶点。收敛保证：t 单调。
 * 容差收到 0.05 以下仍自交（理论上不可能）就放弃抽稀，返回 Chaikin 输出 ——
 * 角切是保简变换，它一定干净。
 */
function simplifyClosed(ring: Point[], tol: number, maxPoints: number): Point[] {
  let t = tol;
  let sawIntersect = false;
  for (;;) {
    const simplified = dpClosedOnce(ring, t);
    if (ringSelfIntersects(simplified)) {
      sawIntersect = true;
      if (t < 0.05) return ring;
      t /= 1.6;
      continue;
    }
    if (simplified.length <= maxPoints || t > 64 || sawIntersect) {
      return simplified.length >= 8 ? simplified : ring;
    }
    t *= 1.6;
  }
}

/**
 * 单岛侵蚀：母形环 → SDF + 域扭曲 + 距离衰减细节 → marching squares → 平滑抽稀。
 *
 * 返回**世界坐标**海岸环；栅格化失败 / 追踪不到环（理论上 pad 保证不发生）时
 * 返回 null，调用方回退母形 —— 生成是点击一次的交互，任何输入都不许抛异常。
 *
 * 性能口径：栅格 ≤ 640² ≈ 41 万像素。域扭曲是低频场（波长 ≈ 83 单位），
 * 按 stride 4 预采样 + 双线性还原（计算量 ÷16）；细节 fbm 只对「|φ₀| < 扭曲
 * 幅度 + 细节幅度 + 余量」的零线带像素计算 —— 岛心与远海直接沿用 φ₀，
 * 两者合计单岛 ≈ 0.2s，多岛同 seed 线性叠加。
 */
function erodeIslandCoast(base: Point[], seed: number): Point[] | null {
  const E = LAND_ERODE;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of base) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // 像素 (0,0) 中心的世界坐标：包围盒向外扩 pad
  const ox = minX - E.pad;
  const oy = minY - E.pad;
  const worldW = maxX - minX + E.pad * 2;
  const worldH = maxY - minY + E.pad * 2;
  const long = Math.max(worldW, worldH);
  const cell = long / E.gridLong;
  const gw = Math.max(8, Math.ceil(worldW / cell));
  const gh = Math.max(8, Math.ceil(worldH / cell));

  // 母形半径（绕顶点均值中心）→ 本岛扭曲幅度（小岛按比例封顶）
  let sx = 0;
  let sy = 0;
  for (const p of base) {
    sx += p.x;
    sy += p.y;
  }
  const center = { x: sx / base.length, y: sy / base.length };
  const { hx, hy } = ringHalfSpan(base, center);
  const warpEff = Math.min(E.warpAmp, Math.max(hx, hy) * E.warpCapRatio);

  // ① 掩码 → 有符号距离场（外正内负）
  const phi = sdfOfRing(base, ox, oy, cell, gw, gh);

  // ② 域扭曲场预采样（stride 4）：波长 ≈ 1/noiseScale ≈ 83 世界单位，
  //    栅格上 ≈ 40 px，stride 4 双线性的还原误差远小于 detAmp，视觉无差
  const stride = 4;
  const lw = Math.ceil(gw / stride) + 2;
  const lh = Math.ceil(gh / stride) + 2;
  const latW = new Float32Array(lw * lh);
  const latH = new Float32Array(lw * lh);
  const seedWx = seed ^ 0x9e3779b9;
  const seedWy = seed ^ 0x85ebca6b;
  for (let b = 0; b < lh; b += 1) {
    for (let a = 0; a < lw; a += 1) {
      const i = a * stride;
      const j = b * stride;
      const wx = ox + i * cell;
      const wy = oy + j * cell;
      const nx = wx * E.noiseScale;
      const ny = wy * E.noiseScale;
      latW[b * lw + a] =
        (fbm(nx, ny, seedWx, E.warpOctaves, 2.05, 0.5) - 0.5) * 2 * warpEff;
      latH[b * lw + a] =
        (fbm(nx + 31.7, ny - 17.3, seedWy, E.warpOctaves, 2.05, 0.5) - 0.5) * 2 * warpEff;
    }
  }
  const sampleLat = (lat: Float32Array, i: number, j: number): number => {
    const u = i / stride;
    const v = j / stride;
    const a0 = Math.floor(u);
    const b0 = Math.floor(v);
    const fx = u - a0;
    const fy = v - b0;
    const i1 = Math.min(a0 + 1, lw - 1);
    const b1 = Math.min(b0 + 1, lh - 1);
    const top = lat[b0 * lw + a0] + (lat[b0 * lw + i1] - lat[b0 * lw + a0]) * fx;
    const bottom = lat[b1 * lw + a0] + (lat[b1 * lw + i1] - lat[b1 * lw + a0]) * fx;
    return top + (bottom - top) * fy;
  };

  // ③ 逐像素：φ(x + w(x)) + 细节·exp(−φ²/2σ²)。零线带之外的像素符号已定，
  //    直接沿用 φ₀（|φ(x+w)| ≥ |φ(x)| − warpEff，SDF 梯度恒为 1）
  const final = new Float32Array(gw * gh);
  const thr = warpEff + E.detAmp + 8;
  const seedDet = seed ^ 0x27d4eb2d;
  const twoSigma2 = 2 * E.detRadius * E.detRadius;
  for (let j = 0; j < gh; j += 1) {
    const wy = oy + j * cell;
    for (let i = 0; i < gw; i += 1) {
      const p = j * gw + i;
      const phi0 = phi[p];
      if (phi0 > thr || phi0 < -thr) {
        final[p] = phi0;
        continue;
      }
      const wx = ox + i * cell;
      const dx = sampleLat(latW, i, j);
      const dy = sampleLat(latH, i, j);
      // 扭曲后的采样位置（像素中心连续坐标）
      const phiW = sampleField(phi, gw, gh, i + dx / cell, j + dy / cell);
      const det = (fbm(wx * E.detScale, wy * E.detScale, seedDet, E.detOctaves, 2.05, 0.5) - 0.5) * 2;
      final[p] = phiW + det * E.detAmp * Math.exp(-(phiW * phiW) / twoSigma2);
    }
  }

  // ④ 追踪 → 取最大环 → 世界坐标 → 角切平滑 → 抽稀
  const loops = marchingSquaresLoops(final, gw, gh);
  let best: Point[] | null = null;
  let bestArea: number = E.minArea;
  for (const loop of loops) {
    const world = loop.map((q) => ({ x: ox + q.x * cell, y: oy + q.y * cell }));
    const area = Math.abs(polygonArea(world));
    if (area > bestArea) {
      bestArea = area;
      best = world;
    }
  }
  if (!best) return null;
  return simplifyClosed(chaikinClosed(best, E.smooth), E.simplifyTol, E.maxPoints);
}

/* ────────────────────────────── 主流程 ────────────────────────────── */

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

  // 目标总面积与逐岛面积权重：首块固定 1，其余 0.22~0.5 ——
  // 主陆撑住画面，小岛做点缀与航线节点。
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
  const polygons: Point[][] = [];

  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i];
    const base = makeRing(plan, seed + i * 7919, samples);

    // 侵蚀：海岸性格（半岛 / 深湾 / 碎边）全部来自这里。失败回退母形。
    const coast = erodeIslandCoast(base, seed + i * 7919 + 31);
    let ring = fitRingToSpan(coast ?? base, plan);

    // 相交兜底（格子排布 + 半幅贴合在结构上已保证海峡；这里只兜 fbm 极端值）。
    for (let retry = 0; retry < LAND_OVERLAP_RETRIES; retry += 1) {
      let hit = false;
      for (const other of polygons) {
        if (ringsIntersect(ring, other)) {
          hit = true;
          break;
        }
      }
      if (!hit) break;
      ring = scaleRing(ring, plan.center, LAND_SHRINK);
    }
    // 仍然相交：丢弃这个岛（宁可少一块，也不要两块糊在一起）
    let dropped = false;
    for (const other of polygons) {
      if (ringsIntersect(ring, other)) dropped = true;
    }
    if (dropped) continue;

    polygons.push(ring);
  }

  return { seed, polygons, bounds };
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

/**
 * 素材落位的最小离岸距离（世界单位）：锚点不得压进陆岸 14 单位。
 *
 * 【为什么是 14 而不是更小/更大】海岸四层里的「陆岸内阴影」宽 22
 * （`COAST_INNER_SHADE`），但它朝内陆一侧是模糊渐隐的，锚点压到 ~14 单位以内
 * 才会明显"吃掉"岸线层次；再小（如 8）会让沿湖/沿岸的素材贴住白边，再大
 * （如 24）会把窄岛内缩成一条缝，可落位面积白白少一圈。14 是「岸线层次」与
 * 「可铺面积」之间的折中。
 */
export const COAST_INSET = 14;

/**
 * 把陆地各环向内**精确偏移** `inset` 世界单位，返回新 `MapLand`
 * （SDF 等值线法，见 `offsetRing`）。
 *
 * 【为什么必须是真偏移而不是等比缩放】内缩结果要当**落位边界**用，必须保证
 * 新环 ⊆ 原环。旧实现绕各环顶点均值中心等比收缩，对星形环恒成立；海岸改
 * SDF 侵蚀后凹段更深，等比缩放的顶点会跨过湾口落到对岸之外（实测 seed=1
 * 内缩顶点越出原岸线）。现改为真偏移曲线，个别平滑偏差顶点再由
 * `pullIntoRing` 拉回 —— 对任意简单闭环 ⊆ 原环成立；卫星岛也不再被
 * 朝主陆方向拖移。
 *
 * 环比 2×inset 还窄时偏移无解：兜底按「均值中心等比收缩」塌到中心（旧路径，
 * 绝不自交）。`inset ≤ 0` 原样返回；`seed` / `bounds` 原样带回。
 */
export function insetLand(land: MapLand, inset: number = COAST_INSET): MapLand {
  if (inset <= 0) return { seed: land.seed, polygons: land.polygons, bounds: land.bounds };
  const polygons = land.polygons.map((ring) => {
    if (ring.length < 3) return ring;
    const offset = offsetRing(ring, -inset);
    if (offset) return pullIntoRing(ring, offset);

    // 偏移无解（环太窄）：旧路径兜底 —— 朝均值中心等比收缩
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
    }
    const center: Point = { x: sx / ring.length, y: sy / ring.length };
    const { hx, hy } = ringHalfSpan(ring, center);
    const half = Math.max(1, Math.max(hx, hy));
    return scaleRing(ring, center, Math.max(0, 1 - inset / half));
  });

  return { seed: land.seed, polygons, bounds: land.bounds };
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
 * 三级判定，由便宜到贵：包围盒分离 ⇒ 必不相交；顶点互入 ⇒ 相交；
 * 边交叉 ⇒ 相交。第 3 步 O(n·m)，n = m ≈ 500 时 25 万次叉积，
 * 只在生成期兜底跑，可接受。
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
 * Douglas–Peucker 抽稀（闭合链：把首点也当作末点，两端点必保留）。
 *
 * 用显式栈而非递归，避免长环把调用栈打爆。
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
 * 曲线**穿过**每个采样点，且首尾自动闭合，一次遍历即可写完。
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
 * 星形环导致的"区块跑到海里"已由 `regions.ts` 的 `makeRadialClamp` 解决
 * （显示多边形逐点径向投影回岸线，贴着海岸走），本函数退居纯工具
 * （`land.test.ts` 仍在验证它的正确性）。
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
