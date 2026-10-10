/**
 * 随机区块生成（层级版：大陆 → 洲 → 国家 → 郡）
 *
 * 【用途】把地图切成若干层级的行政区划：最粗一级把整张地图切开，下一级在
 * **父区块内部**再切，如此递归。渲染时按缩放做交叉淡入淡出（见 `lod.ts`），
 * 于是"缩得越远越概括、缩得越近越详细"是连续的，而不是一级一级地跳。
 *
 * 【算法分四步】
 *   1) 撒点：抖动网格 + 低频域扭曲，让区块有大有小（疏密相间，不是蜂巢）。
 *   2) 分区：Voronoi 图，用半平面裁剪求每个种子点的单元。
 *   3) 崎岖化：把每条直边细分成折线，用 fbm 噪声场做横向位移。
 *   4) 继承：子块的**外轮廓原样沿用父级已经算好的曲线**（见下）。
 *
 * 【第 4 步为什么必须"沿用"而不是"重算"】
 * 子块的外轮廓和父块的边界是同一条线。如果父子各按自己的振幅算一遍，
 * 两条曲线会错开（父级的振幅按父级的尺度算，子级的按子级算），
 * 交叉淡化时就会看到两条平行的边界线在"重影"。
 * 因此本文件把每条边抽象为一条 **基线边（HostEdge）**：
 *   · 振幅、噪声频率、采样密度全部由**这条基线边自身**决定，与"谁来用它"无关；
 *   · 基线边算出的折线只算一次，子块按**参数区间**从父级的折线上切一段下来。
 * 于是子块的外轮廓是父级折线的**子折线**（外加两个落在线段上的切点），
 * 逐点严丝合缝，连浮点误差都没有。
 *
 * 【兄弟之间为什么天然一致】
 * 相邻两块共享的边落在两者种子点的垂直平分线上，线上任意点到两侧种子距离相等，
 * 因此"边中点到种子点的距离"这个振幅上限对两侧是同一个值。为了让这条性质
 * 不被崎岖化后的端点位移破坏，振幅取的是**未位移的基线中点**（见 `makeHost`
 * 的 capMid 参数）。
 *
 * 【确定性】mulberry32 伪随机数发生器：同一 seed 必产出同一棵层级树。
 *
 * 【已知的残余缺陷（实测 24 种子 × 四级共 5352 块）】
 *   · 自交 0.09%、有顶点越出父块的区块 0.6%，最大越出 3.2 世界单位（地图宽 0.3%）。
 *   成因：子块的 Voronoi 单元是在父块的**基线**（凸）上切的，而父块的**显示**多边形
 *   会因为继承更粗一级的曲线而向内凹出"湾"；单元中"两条中垂线交点"式的内部顶点，
 *   以及连接它们的直边，可能正好落在湾里。`settleInside` 把这类**顶点**拉了回来，
 *   但**边**本身（两个都在湾外的点之间的弦）仍可能横穿湾。
 *   要彻底消除，需要把子块的显示多边形与父块的显示多边形做真正的多边形求交
 *   （Greiner–Hormann 一类），成本与风险都不成比例 —— 0.2% 的区块、亚像素级的
 *   越出，在郡一级的可视范围内几乎不可能被看到，故按"已知可接受"处理。
 *   注意：**不能**用"把子块顶点拉到父块内"的思路修补共享边 —— 任何对共享边几何的
 *   单侧修改都会破坏父子/兄弟的逐点重合（见上文第 4 步）。
 *
 * 【边界】纯函数模块（不依赖 React / Pixi / DOM），必须覆盖单元测试。
 */

/** 世界坐标点 */
export interface Point {
  x: number;
  y: number;
}

/** 一个区块（层级树上的一个节点） */
export interface MapRegion {
  /** 全局唯一 id */
  id: string;
  /** 父区块 id；最顶层为 null */
  parentId: string | null;
  /** 层级序号：0 = 大陆，1 = 洲，2 = 国家，3 = 郡 */
  level: number;
  /** 展示名（阶段三会开放重命名） */
  name: string;
  /** 生成该区块的种子点（世界坐标） */
  seed: Point;
  /** 区块多边形顶点（世界坐标，已含崎岖化） */
  polygon: Point[];
  /** 填充色（0xRRGGBB，供 Pixi 直接使用） */
  color: number;
}

/** 世界矩形范围 */
export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 层级定义与默认数量：每级把上一级再切约 4 份 */
export const REGION_LEVELS = [
  { label: "大陆", count: 3 },
  { label: "洲", count: 12 },
  { label: "国家", count: 48 },
  { label: "郡", count: 160 },
] as const;

/** 最多支持的层级数 */
export const REGION_MAX_LEVELS = REGION_LEVELS.length;

/** 单张地图的区块总数上限（渲染与内存的护栏） */
export const REGION_TOTAL_LIMIT = 600;

/** 层级数的可调范围（工具栏用） */
export const REGION_LEVEL_COUNT_LIMITS = {
  min: 1,
  max: REGION_MAX_LEVELS,
  default: REGION_MAX_LEVELS,
} as const;

/** 区块填充不透明度（保持较低，让底图地形仍可透出） */
export const REGION_FILL_ALPHA = 0.32;

/**
 * 区块边界线宽 —— 单位是**屏幕像素**。
 *
 * 渲染时换算成世界单位（`px / viewport.scale`）：区块的可见缩放跨了 40 倍
 * （最远一级到最近一级），用世界单位做线宽会导致缩远了线细到看不见、
 * 放到最大线比山脉还宽。
 */
export const REGION_BORDER_PX = 1.6;

/**
 * 区块边界的不透明度。
 *
 * 取值偏轻（0.6）：边界是用来"读出分区"的，不该盖过底图的地形。
 * 交叉淡化时渲染层会再乘上该层级的权重，因此过渡带里两条边界各自只有一半浓度，
 * 合起来仍是一根连续的线，不会出现"两倍黑"的接缝。
 */
export const REGION_BORDER_ALPHA = 0.6;

/** 区块边界颜色（深墨绿，压在底图上清晰但不刺眼） */
export const REGION_BORDER_COLOR = 0x27352e;

/**
 * 边界"崎岖度"参数（凡是以 R 表示的比例，R = `sqrt(该区块面积 / 子区块数)`，
 * 即"这一级一块有多大"的尺度基准 —— 用相对量而非绝对像素，换地图尺寸不用重调）。
 */
export const REGION_WOBBLE = {
  /**
   * 基础振幅 0.108R。
   *
   * 振幅与波长必须一起定：位移沿边长的梯度若 ≥ 1，折线就会自交（多边形
   * "打结"，填充出现空洞）。层叠噪声的梯度实测约为 (振幅/波长) 的 1.2 倍（均方），
   * 峰值不超过 3.2 倍 —— 0.108 / 0.34 ≈ 0.32，峰值约 1.0，再叠加交汇点收敛带
   * 与振幅封顶后才留有余量。
   */
  amplitude: 0.108,
  /**
   * 噪声波长 0.34R。
   *
   * 这个值前后调过两次：1.15R 比典型边长还长，一条边连一个完整起伏都走不完，
   * 位移几乎为零（看起来还是直线）；0.5R 时仍有边整条落在噪声"平坦格"里。
   * 0.34R 保证每条边至少跨过一个完整噪声格，崎岖程度才稳定。
   */
  wavelength: 0.34,
  /**
   * 采样步长 = R/24（取**最细一级**的 R，见 `generateHierarchy`）。
   *
   * 用最细一级的尺度来采样全局的基线边：父级的曲线会被子级原样切走一段，
   * 若按父级自己的尺度采样，缩到最深处时那段折线会显得是一根根直线段。
   */
  segmentsPerRadius: 24,
  /** 单条基线边最多细分多少段（防极端长边产生上千顶点） */
  maxSegments: 128,
  /** 分形叠加层数：2 层足够给出"大起伏 + 小锯齿"，再多会欠采样 */
  octaves: 2,
  /** 每层频率倍增 / 振幅衰减 */
  lacunarity: 2.1,
  gain: 0.45,
  /** 振幅封顶一：不超过"边中点到本区块种子点的距离"的 35%（见 organicEdge 注释） */
  maxAmplitudeRatio: 0.35,
  /** 振幅封顶二：不超过边长的 20%（短边跟着大振幅走必然自交） */
  maxEdgeRatio: 0.2,
  /**
   * 振幅封顶三：不超过 `fineAmpCap × 最细一级的 R`。
   *
   * 【为什么必须有】最粗一级的边界会被**一路继承到最细一级**：某个郡的外轮廓
   * 可能就是大陆的边界。而振幅按各自的 R 算，大陆的振幅（0.108×591 ≈ 64）几乎
   * 等于一个郡的尺度（81）。一旦某段边界的起伏超过子块的厚度，就会把子块的
   * 种子甩到自己的多边形外面、乃至让多边形自交 —— 实测 4 级时会大面积发生。
   * 因此振幅还要受"最深处的子块能承受多少起伏"约束。
   * 3 级（最细 R≈148）时这一条不生效，观感与之前一致；4 级时才收窄。
   */
  fineAmpCap: 0.45,
  /**
   * 种子内缩的上限：不超过父块内切半径的这一比例。
   *
   * 内缩是为了让种子离"会起伏的父级边界"足够远，但内缩一旦超过父块的内切半径，
   * 所有种子都会被拉到质心重叠 → 每个子块的 Voronoi 单元都退化成整个父块
   * （实测最细一级面积之和会变成父块的 4 倍）。所以必须封顶。
   */
  insetCapRatio: 0.5,
  /**
   * 振幅的缓变调制范围 [1 - variation, 1 + variation]。
   *
   * 真实疆界并不均匀崎岖：有的段沿山脊/河谷走、扭得厉害，有的段是勘界直线。
   * 用一张比区块尺度更缓的噪声按"边的位置"调制振幅，就能得到这种疏密相间的观感。
   */
  ampVariation: 0.45,
  /**
   * 交汇点收敛带：基线边的两端各 22% 范围内，位移从 0 平滑升到满值。
   *
   * 单条边自己的位移沿固定法线做，是弦上的单值函数，永远不会自交。真正的自交
   * 只发生在**两条共享交汇顶点的边之间**：夹角可能很小，各自朝对方鼓出就会在
   * 顶点附近交叉。让位移在两端归零，顶点附近两条边都是直线、只交于顶点本身。
   *
   * 还顺带保证了另一件事：基线边的折线**端点恰好等于基线端点**，
   * 于是子级从父级折线上切下来的切口两端也落在父级折线的线段上，不会错位。
   */
  vertexTaper: 0.22,
  /** 种子点域扭曲强度（相对网格单元尺寸） */
  seedWarp: 0.32,
  /**
   * 种子点距父级边界的最小内缩，取 `max(采样步长×2, 父级边界最大振幅×1.25)`。
   *
   * 子块会继承父级边界的起伏，起伏最大可达父级振幅。若子块种子离边界太近，
   * 这段起伏就会把边界推到种子另一侧 —— 表现为"种子点跑到自己区块外面"
   * 乃至多边形自交。1.25 倍是留出的安全余量。
   */
  seedInsetAmpRatio: 1.25,
  /** 子级相对父级的色相偏移（度）：让"父块裂开成子块"读起来像同一个色系的深浅 */
  hueSpread: 15,
  /**
   * 同父块内两个种子点的最小间距 = 这一比例 × 子块尺度 R。
   *
   * `pullInside` 在内缩要求苛刻时会把多个种子送到质心附近（裕度最大的点），
   * 导致它们的 Voronoi 单元几乎重合（实测最深一级出现面积完全相同的重复子块，
   * 父块的子块面积之和多出 26%）。采样之后加一道"成对推开"把间距撑到这个值。
   *
   * 0.5 是实测最优（24 个种子 × 四级共 5352 块）：
   *   0.35 → 自交 7、最大外溢 8.45；0.50 → 自交 5、最大外溢 3.25；
   *   0.65 → 自交 8、最大外溢 6.30。再大反而会把本来合理的种子硬推到贴边处。
   */
  minSeedSeparation: 0.5,
} as const;

/* ────────────────────────────── 噪声 ────────────────────────────── */

/**
 * mulberry32 —— 32 位确定性伪随机数发生器。
 *
 * 选用它而不是 Math.random：同种子必得同序列，测试才能断言具体结果。
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 整数格点哈希 → [0,1)。值噪声的格点随机值来源。 */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (seed ^ Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/** 五次平滑插值曲线（C2 连续）—— 比三次 smoothstep 更平顺，边界上看不到折角 */
function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * 二维值噪声（value noise），输出 [0,1)。
 *
 * 只在整数格点上取随机值、格点之间平滑插值。因为是**位置的连续函数**，
 * 相邻区块对同一条边界上的同一点必然算出同一个值 —— 这是"边界严丝合缝"的前提。
 */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smootherstep(x - x0);
  const fy = smootherstep(y - y0);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  const top = n00 + (n10 - n00) * fx;
  const bottom = n01 + (n11 - n01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * 分形布朗运动（fbm）：多个倍频值噪声叠加，输出 [0,1)。
 *
 * 单层噪声只有一种"波长"，起伏会显得单调；叠加 2 层后同时拥有大尺度的走向
 * 与小尺度的锯齿 —— 这正是真实海岸线/疆界线的自相似观感。
 */
export function fbm(
  x: number,
  y: number,
  seed: number,
  octaves = 3,
  lacunarity = 2.05,
  gain = 0.5,
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/* ─────────────────────────── 几何与裁剪 ─────────────────────────── */

/** 点到线段的最短距离 */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / d2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** 点到多边形边界的最短距离 */
function distToPolygonBoundary(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const d = distToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

/** 多边形轴对齐包围盒 */
function polygonBounds(poly: Point[]): RegionBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 线段上的参数 t（p 在 ab 直线上的投影，未钳制到 [0,1]） */
function paramOnSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-18) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / d2;
}

/** HSL → 0xRRGGBB（h 单位为度，s/l 为 0~1） */
function hslToRgb(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  // 色相落在哪个 60° 扇区，决定 RGB 三个分量的取值形态
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  const m = l - c / 2;
  const to = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  return (to(rgb[0]) << 16) | (to(rgb[1]) << 8) | to(rgb[2]);
}

/**
 * 用一个半平面裁剪多边形（Sutherland–Hodgman）。
 *
 * `keep` 返回该点在保留侧的距离（<= 0 表示保留）。
 * 遍历每条边，两端点一内一外时补上交点，得到裁剪后的新多边形。
 */
function clipPolygon(polygon: Point[], keep: (p: Point) => number): Point[] {
  if (polygon.length === 0) return polygon;
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const fa = keep(a);
    const fb = keep(b);
    if (fa <= 0) out.push(a);
    if (fa <= 0 !== fb <= 0) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/**
 * 求第 index 个种子点在 `region` 内的 Voronoi 单元。
 *
 * 【`region` 必须是凸的】本函数靠 Sutherland–Hodgman 做半平面裁剪，
 * 而该算法只对**凸**裁剪框成立。层级生成时传入的是父块的**基线多边形**
 * （由半平面相交而来，恒为凸），而不是它崎岖化之后的显示多边形 ——
 * 后者可能变成凹的，直接用会做出跑到父块外面的子块。
 */
function voronoiCellIn(index: number, seeds: Point[], region: Point[]): Point[] {
  let polygon = region;
  const me = seeds[index];
  for (let j = 0; j < seeds.length; j += 1) {
    if (j === index) continue;
    // 垂直平分线：保留"离 me 更近"的一侧。
    // 设中点 M，方向 d = other - me，则 p 在 me 侧等价于 (p - M)·d <= 0。
    const other = seeds[j];
    const dx = other.x - me.x;
    const dy = other.y - me.y;
    const mx = (me.x + other.x) / 2;
    const my = (me.y + other.y) / 2;
    polygon = clipPolygon(polygon, (p) => (p.x - mx) * dx + (p.y - my) * dy);
    if (polygon.length === 0) return [];
  }
  return polygon;
}

/** 点是否落在多边形内（射线法）。用于命中测试与单元测试。 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** 区块多边形的质心（用于后续在区块上叠加标签，也用于把种子点拉回区块内） */
export function polygonCentroid(polygon: Point[]): Point {
  if (polygon.length === 0) return { x: 0, y: 0 };
  let signedArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = a.x * b.y - b.x * a.y;
    signedArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  signedArea *= 0.5;
  if (signedArea === 0) return polygon[0];
  return { x: cx / (6 * signedArea), y: cy / (6 * signedArea) };
}

/** 多边形面积（绝对值） */
export function polygonArea(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/* ────────────────────── 基线边（HostEdge）────────────────────── */

/** 生成过程共享的上下文 */
interface WobbleCtx {
  /** 整张地图的世界范围（画框收敛用） */
  bounds: RegionBounds;
  /** 噪声种子 */
  noiseSeed: number;
  /** 全局采样步长（世界单位） */
  step: number;
  /** 最细一级的尺度基准 R（振幅封顶用） */
  finestR: number;
}

/**
 * 一条"基线边" —— 崎岖化的最小共享单位。
 *
 * 关键性质：**它的振幅、频率、采样只由自己决定**，因此
 *   · 相邻两块对同一条边算出完全相同的折线；
 *   · 父块与子块对"同一段边"算出完全相同的折线（子块直接从父块折线上切片）。
 */
interface HostEdge {
  /** 基线端点（方向已按 (x,y) 字典序规范化，与"谁来用"无关） */
  a: Point;
  b: Point;
  /** 崎岖化振幅（世界单位）；0 表示保持笔直 */
  amp: number;
  /** 噪声采样频率 */
  freq: number;
  /** 振幅向地图画框收敛的距离 */
  frameTaper: number;
  /** 采样段数（折线共 n+1 个点） */
  n: number;
  /** 崎岖化后的折线，惰性计算一次 */
  line: Point[] | null;
}

/** 一条边的引用：用哪条基线边、从哪点走到哪点 */
interface EdgeRef {
  host: HostEdge;
  from: Point;
  to: Point;
}

/** 生成过程中的一个节点（含父块基线，供子块裁剪与继承用；不进文档） */
interface LocalNode {
  id: string;
  level: number;
  seed: Point;
  hue: number;
  /** 基线多边形（**凸**，用于给子块做裁剪范围） */
  base: Point[];
  /** 基线每条边对应的基线边引用 */
  edges: EdgeRef[];
  /** 显示多边形（崎岖化之后） */
  display: Point[];
}

/**
 * 点到各边的最小距离 → 0~1 的收敛系数：越贴地图边框越接近 0。
 *
 * 目的在于让边界在画框附近自然收直，同时**数学上保证**位移不会越出地图：
 * 只需 smoothstep(0, taper, d) * amp ≤ d 对一切 d 成立，取 taper = 2.4·amp
 * 即恒成立（d ≥ taper 时 amp < 2.4amp = taper ≤ d）。
 */
function borderFade(p: Point, bounds: RegionBounds, taper: number): number {
  const d = Math.min(
    p.x - bounds.x,
    bounds.x + bounds.width - p.x,
    p.y - bounds.y,
    bounds.y + bounds.height - p.y,
  );
  if (d >= taper) return 1;
  if (d <= 0) return 0;
  const t = d / taper;
  return t * t * (3 - 2 * t);
}

/** 兜底钳制：正常情况下 borderFade 已保证不越界，这里只是最后一道保险 */
function clampToBounds(p: Point, bounds: RegionBounds): Point {
  return {
    x: Math.min(Math.max(p.x, bounds.x), bounds.x + bounds.width),
    y: Math.min(Math.max(p.y, bounds.y), bounds.y + bounds.height),
  };
}

/** 画框边：地图矩形的四条边，不崎岖化（它是画框，不是区块之间的界） */
function makeFrameHost(a: Point, b: Point): HostEdge {
  return { a, b, amp: 0, freq: 1, frameTaper: 1, n: 1, line: [a, b] };
}

/**
 * 建一条基线边。
 *
 * @param from/to  这条边**实际**的两个端点（可能已被父级边界推移过）
 * @param capMid   用**未位移**的基线中点算振幅上限 —— 它落在两侧种子点的垂直
 *                 平分线上，因此两侧算出的上限完全相同。若改用位移后的中点，
 *                 两侧会得到略不同的振幅 → 共享边界出现发丝级裂缝。
 * @param capSeed  本区块种子点（只用于振幅上限，不参与几何）
 * @param R        本级尺度基准
 */
function makeHost(
  from: Point,
  to: Point,
  capMid: Point,
  capSeed: Point,
  R: number,
  ctx: WobbleCtx,
): HostEdge {
  // 规范方向：按 (x, y) 字典序，保证两侧区块得到同一个 a→b
  const flip = from.x > to.x || (from.x === to.x && from.y > to.y);
  const a = flip ? to : from;
  const b = flip ? from : to;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { a, b, amp: 0, freq: 1, frameTaper: 1, n: 1, line: [a, b] };

  const freq = 1 / (R * REGION_WOBBLE.wavelength);
  // 缓变调制：同样一条边，落在噪声高值区就扭得厉害，落在低值区就接近直线
  const ampScale =
    1 +
    (fbm(capMid.x * freq * 0.55, capMid.y * freq * 0.55, ctx.noiseSeed + 771, 1) * 2 - 1) *
      REGION_WOBBLE.ampVariation;
  const halfSpan = Math.hypot(capMid.x - capSeed.x, capMid.y - capSeed.y);
  const amp = Math.max(
    0,
    Math.min(
      R * REGION_WOBBLE.amplitude * ampScale,
      halfSpan * REGION_WOBBLE.maxAmplitudeRatio,
      len * REGION_WOBBLE.maxEdgeRatio,
      // 封顶三：这条曲线会被最深处的子块原样继承，起伏不能超过它们的承受能力
      ctx.finestR * REGION_WOBBLE.fineAmpCap,
    ),
  );

  const n = Math.max(1, Math.min(REGION_WOBBLE.maxSegments, Math.ceil(len / ctx.step)));
  return { a, b, amp, freq, frameTaper: Math.max(amp * 2.4, 1e-6), n, line: null };
}

/** 基线边在参数 u ∈ [0,1] 处的显示点（位移沿边的法线） */
function hostPointAt(h: HostEdge, u: number, ctx: WobbleCtx): Point {
  const bx = h.a.x + (h.b.x - h.a.x) * u;
  const by = h.a.y + (h.b.y - h.a.y) * u;
  if (h.amp <= 0) return { x: bx, y: by };

  const dx = h.b.x - h.a.x;
  const dy = h.b.y - h.a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: bx, y: by };

  // fbm 输出 [0,1) → 映射到 [-1,1)：位移有正有负，边界两侧都会被"啃"到
  const noise =
    fbm(
      bx * h.freq,
      by * h.freq,
      ctx.noiseSeed,
      REGION_WOBBLE.octaves,
      REGION_WOBBLE.lacunarity,
      REGION_WOBBLE.gain,
    ) *
      2 -
    1;
  // 交汇点收敛 + 画框收敛
  const ramp =
    smootherstep(Math.min(1, u / REGION_WOBBLE.vertexTaper)) *
    smootherstep(Math.min(1, (1 - u) / REGION_WOBBLE.vertexTaper));
  const fade = borderFade({ x: bx, y: by }, ctx.bounds, h.frameTaper);
  const off = noise * h.amp * ramp * fade;
  return clampToBounds({ x: bx + (-dy / len) * off, y: by + (dx / len) * off }, ctx.bounds);
}

/** 基线边的折线（惰性计算并缓存） */
function hostLine(h: HostEdge, ctx: WobbleCtx): Point[] {
  if (h.line) return h.line;
  const pts: Point[] = [];
  for (let k = 0; k <= h.n; k += 1) pts.push(hostPointAt(h, k / h.n, ctx));
  // 两端位移恒为 0（ramp = 0），显式对齐可消掉浮点末位误差 ——
  // 这一点是"父子边界严丝合缝"的前提：基线端点必须逐位相等。
  pts[0] = { x: h.a.x, y: h.a.y };
  pts[h.n] = { x: h.b.x, y: h.b.y };
  h.line = pts;
  return pts;
}

/** 折线上按参数 u 取点（落在折线的线段上，因此与父级逐点一致） */
function pointAtU(h: HostEdge, u: number, ctx: WobbleCtx): Point {
  const line = hostLine(h, ctx);
  if (u <= 0) return { x: line[0].x, y: line[0].y };
  if (u >= 1) return { x: line[h.n].x, y: line[h.n].y };
  const pos = u * h.n;
  const i = Math.min(h.n - 1, Math.floor(pos));
  const f = pos - i;
  return {
    x: line[i].x + (line[i + 1].x - line[i].x) * f,
    y: line[i].y + (line[i + 1].y - line[i].y) * f,
  };
}

/**
 * 取基线边折线上 from→to 之间的**中间点**（不含两端）。
 *
 * 方向由 from/to 决定：子块从父级折线上切一段下来时，父级折线的点序可能与
 * 子块的多边形绕向相反，这里按参数比较决定是否反转。
 */
function arcBetween(h: HostEdge, from: Point, to: Point, ctx: WobbleCtx): Point[] {
  const line = hostLine(h, ctx);
  const uf = paramOnSegment(h.a, h.b, from);
  const ut = paramOnSegment(h.a, h.b, to);
  const lo = Math.min(uf, ut);
  const hi = Math.max(uf, ut);
  const mid: Point[] = [];
  for (let k = 1; k < h.n; k += 1) {
    const u = k / h.n;
    if (u > lo + 1e-9 && u < hi - 1e-9) mid.push(line[k]);
  }
  return uf <= ut ? mid : mid.reverse();
}

/**
 * 把落在 `poly` 外的点沿直线拉回 `target` 方向，直到进入 `poly`（含贴边）。
 *
 * 【为什么需要】子块的 Voronoi 单元是在父块的**基线**多边形（恒为凸）上算的，
 * 而父块的**显示**多边形会因为继承了更粗一级的曲线而向内凹出一个个"湾"。
 * 单元里那些"两条中垂线交点"式的**内部**顶点，就可能正好落进这些湾里 ——
 * 于是子块有一角捅到父块外面（实测最深一级能捅出 10 单位，并引发自交）。
 *
 * 【为什么不破坏父子/兄弟的严丝合缝】
 *   · 落在父块边界上的顶点（`pointAtU` 算出来的）本来就在显示多边形上，
 *     `outside` 判定为 false，原样返回，一个比特都不会动；
 *   · 目标点取父块**显示多边形**的质心，对所有兄弟完全相同，被修的又是同一个
 *     原始顶点，因此兄弟算出的新位置一致，不会裂开。
 */
function settleInside(p: Point, poly: Point[], target: Point): Point {
  const outside = (q: Point) => !pointInPolygon(q, poly) && distToPolygonBoundary(q, poly) > 1e-6;
  if (!outside(p)) return p;
  const STEPS = 8;
  for (let k = 1; k <= STEPS; k += 1) {
    const t = k / STEPS;
    const q = { x: p.x + (target.x - p.x) * t, y: p.y + (target.y - p.y) * t };
    if (!outside(q)) return q;
  }
  return { x: target.x, y: target.y };
}

/* ────────────────────────── 种子点采样 ────────────────────────── */

/** 点是否在多边形内、且距边界至少 inset */
function insideWithInset(p: Point, poly: Point[], inset: number): boolean {
  if (!pointInPolygon(p, poly)) return false;
  return inset <= 0 || distToPolygonBoundary(p, poly) >= inset;
}

/**
 * 把点拉进多边形内（沿指向质心的方向逐步靠近）。
 *
 * 抖动 + 域扭曲会把种子推到父块外面；贴边的种子还会长成"刀片状"区块。
 *
 * 【为什么是"一路放宽到 0"而不是"找不到就回质心"】内缩要求（躲开父级起伏）在
 * 层级深处可能根本无解 —— 父块被上一级的曲线啃掉一大块后，能同时满足内缩的点
 * 只剩质心附近一小片。此时若把种子退到质心，**多个种子会落到同一个坐标**，
 * 它们的 Voronoi 单元便完全重合：实测最细一级出现两个面积/顶点数一模一样的
 * 重复子块，整块父级的子块面积之和多出 26%。所以必须一路放宽到"只要在多边形内"
 * （对凸多边形而言质心必在内部，这条一定能满足），保留种子的彼此差异。
 */
function pullInside(p: Point, poly: Point[], centroid: Point, inset: number): Point {
  const STEPS = 16;
  let need = inset;
  for (let pass = 0; pass < 8; pass += 1) {
    for (let k = 1; k <= STEPS; k += 1) {
      const t = k / STEPS;
      const q = { x: p.x + (centroid.x - p.x) * t, y: p.y + (centroid.y - p.y) * t };
      if (insideWithInset(q, poly, need)) return q;
    }
    if (need <= 0) break;
    need = need <= 1 ? 0 : need * 0.5;
  }
  return { x: centroid.x, y: centroid.y };
}

/**
 * 在父块内撒 n 个种子点。
 *
 * 抖动网格保证疏密均匀（纯随机会出现极小/极大的畸形区块），网格之上再叠一层
 * **低频域扭曲**（同一张 fbm 噪声场把种子整体推一下）：均匀网格会让每块面积
 * 几乎一样、读起来像蜂巢；扭曲之后种子成团成疏，区块大大小小才像真实疆域。
 */
function sampleSeeds(
  poly: Point[],
  n: number,
  inset: number,
  rng: () => number,
  seed: number,
): Point[] {
  const bbox = polygonBounds(poly);
  const centroid = polygonCentroid(poly);
  const cols = Math.max(1, Math.round(Math.sqrt((n * bbox.width) / Math.max(bbox.height, 1e-6))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = bbox.width / cols;
  const cellH = bbox.height / rows;

  const grid: Array<{ c: number; r: number }> = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) grid.push({ c, r });
  }
  // 行列取整会让格子数略多于 n，随机抽掉多余的，而不是简单截断
  // —— 截断会在区块里留下一个规则的空白角。
  while (grid.length > n) grid.splice(Math.floor(rng() * grid.length), 1);

  // 域扭曲的噪声频率取"约 1.8 个格子一个波"：波长比格子大，位移才会在相邻
  // 种子之间连续变化（否则会把整片种子揉成随机噪声，而不是形成疏密带）。
  const warpFreq = 1 / (Math.max(1e-6, Math.min(cellW, cellH)) * 1.8);

  const pts = grid.map(({ c, r }) => {
    const gx = bbox.x + (c + 0.18 + rng() * 0.64) * cellW;
    const gy = bbox.y + (r + 0.18 + rng() * 0.64) * cellH;
    const wx =
      (fbm(gx * warpFreq, gy * warpFreq, seed + 9173) * 2 - 1) * cellW * REGION_WOBBLE.seedWarp;
    const wy =
      (fbm(gx * warpFreq + 13.7, gy * warpFreq + 41.3, seed + 4327) * 2 - 1) *
      cellH *
      REGION_WOBBLE.seedWarp;
    return pullInside({ x: gx + wx, y: gy + wy }, poly, centroid, inset);
  });
  separateSeeds(pts, poly, centroid, rng);
  return pts;
}

/**
 * 把互相贴得太近的种子推开。
 *
 * 【为什么必须有这一道】内缩要求（躲开父级起伏）在层级深处可能只剩质心附近
 * 一小片能满足：父块被上一级的曲线啃掉一大块之后，"离边界足够远"的地方本就不多。
 * `pullInside` 于是把多个种子一起送到质心（裕度最大的点）—— 它们的 Voronoi 单元
 * 完全重合，父块的子块面积之和直接翻倍（实测最深一级 3 个郡种子落在同一点，
 * 每个的面积都等于整个父块）。
 *
 * 这里做若干轮"成对推开 + 拉回块内"，把间距撑到与子块尺度相称
 * （`REGION_WOBBLE.minSeedSeparation × R`）。
 * 因为只改种子位置、不改任何几何规则，父子边界的严丝合缝不受影响。
 */
function separateSeeds(seeds: Point[], poly: Point[], centroid: Point, rng: () => number): void {
  const minSep =
    REGION_WOBBLE.minSeedSeparation *
    Math.sqrt(polygonArea(poly) / Math.max(1, seeds.length));
  if (!(minSep > 0)) return;
  for (let iter = 0; iter < 6; iter += 1) {
    let moved = false;
    for (let i = 0; i < seeds.length; i += 1) {
      for (let j = i + 1; j < seeds.length; j += 1) {
        let dx = seeds[j].x - seeds[i].x;
        let dy = seeds[j].y - seeds[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= minSep) continue;
        if (d < 1e-9) {
          // 完全重合：必须给一个确定性的方向，否则"推开"永远推不开
          const ang = rng() * Math.PI * 2;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (minSep - d) / 2;
        const ux = (dx / d) * push;
        const uy = (dy / d) * push;
        seeds[i] = { x: seeds[i].x - ux, y: seeds[i].y - uy };
        seeds[j] = { x: seeds[j].x + ux, y: seeds[j].y + uy };
        moved = true;
      }
    }
    if (!moved) break;
    // 被推到块外的拉回来（内缩要求已放宽到 0，只保证"在块内"）
    for (let i = 0; i < seeds.length; i += 1) {
      seeds[i] = pullInside(seeds[i], poly, centroid, 0);
    }
  }
}

/* ────────────────────────── 层级生成 ────────────────────────── */

export interface GenerateHierarchyOptions {
  /** 随机种子 */
  seed: number;
  /** 地图世界范围 */
  bounds: RegionBounds;
  /** 每级区块数（长度即层级数）；缺省用 REGION_LEVELS 的默认值 */
  levelCounts?: readonly number[];
}

/** 把 total 尽量平均分给 parts 份 */
function shareCounts(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const rem = total % parts;
  const out: number[] = [];
  for (let i = 0; i < parts; i += 1) out.push(base + (i < rem ? 1 : 0));
  return out;
}

/** 父级的边界上可能出现的最大振幅（决定子级种子要内缩多少） */
function maxBoundaryAmp(node: LocalNode): number {
  let best = 0;
  for (const e of node.edges) if (e.host.amp > best) best = e.host.amp;
  return best;
}

/**
 * 由父级的基线多边形长出子块，并算出子块的**显示多边形**。
 *
 * 显示多边形的构成（顺序即多边形绕向）：
 *   · 落在父级边界上的边 → **原样切下父级折线的一段**（这就保证了严丝合缝）
 *   · 内部边（与兄弟共享）→ 按本级规则崎岖化；振幅上限取未位移的基线中点，
 *     因此两侧算出的折线完全相同，只是点序相反
 */
function buildChildren(
  parent: LocalNode,
  level: number,
  count: number,
  regions: MapRegion[],
  seed: number,
  rng: () => number,
  ctx: WobbleCtx,
  nextId: () => string,
): LocalNode[] {
  const parentAmp = maxBoundaryAmp(parent);
  const area = polygonArea(parent.base);
  const R = Math.sqrt(Math.max(area, 1) / Math.max(1, count));
  // 内缩受**双重**约束：下界是"躲开父级边界的起伏"，上界是"别把种子全挤到质心"。
  // 少了上界，内缩会随父级振幅逐级放大（实测 8.9 → 25.8 → 111.7），远超父块
  // 内切半径，于是 pullInside 把每个种子都拉到质心重叠 —— 每个子块的 Voronoi
  // 单元退化成整个父块，最细一级面积之和会变成父块的 4 倍。
  const inset = Math.min(
    Math.max(ctx.step * 2, parentAmp * REGION_WOBBLE.seedInsetAmpRatio),
    R * REGION_WOBBLE.insetCapRatio,
  );

  const seeds = sampleSeeds(parent.base, count, inset, rng, seed + level * 7919);
  if (seeds.length === 0) return [];

  const label = REGION_LEVELS[level]?.label ?? `L${level}`;
  // 父块显示多边形的质心：把"落进父块内凹湾里"的内部顶点拉回来的目标点
  const parentInner = polygonCentroid(parent.display);
  const out: LocalNode[] = [];

  for (let i = 0; i < seeds.length; i += 1) {
    const cell = voronoiCellIn(i, seeds, parent.base);
    if (cell.length < 3) continue;

    // ── 1) 每个顶点：判定它落在父级基线的**哪几条**边上 ──
    //
    // 【为什么是"哪几条"而不是"哪一条"】父级的一个顶点同时是它相邻两条边的端点。
    // 若每个顶点只记一条边，那么"从父级顶点出发、沿下一条边继续走"的那条子边
    // 就会因为两端记到了不同的边号而被误判成内部边 —— 于是它不再继承父级曲线，
    // 而是按自己的振幅重算一遍，父级边界上就出现一大段对不上的缺口（实测能到
    // 父级边界的四成）。记下全部候选边、再在**每条子边**上求交集，才是正确的判据。
    const verts = cell.map((v) => {
      const ons: number[] = [];
      for (let j = 0; j < parent.base.length; j += 1) {
        if (distToSegment(v, parent.base[j], parent.base[(j + 1) % parent.base.length]) < 1e-6) {
          ons.push(j);
        }
      }
      if (ons.length === 0) {
        // 内部顶点（两条中垂线的交点）：可能落在父块显示多边形的内凹湾里，拉回来
        return { raw: v, point: settleInside(v, parent.display, parentInner), ons };
      }

      // 锚点 = 父级折线上对应位置的点。父级顶点处两条边的折线端点都精确等于该
      // 顶点本身（见 hostLine 的端点对齐），因此取哪条边得到的是同一个点。
      const j = ons[0];
      const ref = parent.edges[j];
      const t = paramOnSegment(parent.base[j], parent.base[(j + 1) % parent.base.length], v);
      const uFrom = paramOnSegment(ref.host.a, ref.host.b, ref.from);
      const uTo = paramOnSegment(ref.host.a, ref.host.b, ref.to);
      return { raw: v, point: pointAtU(ref.host, uFrom + (uTo - uFrom) * t, ctx), ons };
    });

    // ── 2) 每条边：继承父级曲线，或新建一条内部基线边 ──
    const edges: EdgeRef[] = [];
    for (let k = 0; k < cell.length; k += 1) {
      const va = verts[k];
      const vb = verts[(k + 1) % cell.length];
      // 两端共处父级同一条边 → 该子边整段都在父级边界上，原样继承
      const shared = va.ons.find((j) => vb.ons.includes(j));
      if (shared !== undefined) {
        const host = parent.edges[shared].host;
        // 两端在父级**基线**上的位置 → 换算成基线边自身的参数区间
        const ref = parent.edges[shared];
        const uFrom = paramOnSegment(ref.host.a, ref.host.b, ref.from);
        const uTo = paramOnSegment(ref.host.a, ref.host.b, ref.to);
        const segA = parent.base[shared];
        const segB = parent.base[(shared + 1) % parent.base.length];
        const map = (p: Point) =>
          pointAtU(ref.host, uFrom + (uTo - uFrom) * paramOnSegment(segA, segB, p), ctx);
        edges.push({ host, from: map(va.raw), to: map(vb.raw) });
      } else {
        const capMid = { x: (va.raw.x + vb.raw.x) / 2, y: (va.raw.y + vb.raw.y) / 2 };
        edges.push({
          host: makeHost(va.point, vb.point, capMid, seeds[i], R, ctx),
          from: va.point,
          to: vb.point,
        });
      }
    }

    // ── 3) 拼显示多边形 ──
    const display: Point[] = [];
    for (const e of edges) {
      display.push(e.from);
      display.push(...arcBetween(e.host, e.from, e.to, ctx));
    }
    if (display.length < 3) continue;

    // 种子自己的显示多边形也可能内凹（它同样继承了父级的曲线）：种子若正好落在
    // 这个内凹湾里，标签就会飘到自块外。朝自块质心拉一点即可。父块用的是自己的
    // 质心、子块用的是子块质心，两者互不影响，兄弟之间也不会裂开。
    const seedPoint = settleInside(seeds[i], display, polygonCentroid(display));

    // ── 4) 取色：子级在父级色相附近偏移，让"父块裂开成子块"读起来是同色系深浅 ──
    const jitter = (rng() - 0.5) * 12;
    const hue =
      level === 0
        ? i * 137.508 + (rng() - 0.5) * 26
        : parent.hue + (i - (count - 1) / 2) * REGION_WOBBLE.hueSpread + jitter;
    const id = nextId();
    const node: LocalNode = {
      id,
      level,
      seed: seedPoint,
      hue,
      base: cell,
      edges,
      display,
    };
    regions.push({
      id,
      parentId: parent.id === "root" ? null : parent.id,
      level,
      // 序号取全局计数而非"父级内序号"，否则不同父级下会出现同名区块
      name: `${label} ${id.slice(id.lastIndexOf("_") + 1)}`,
      seed: seedPoint,
      polygon: display,
      color: hslToRgb(hue, 0.3 + rng() * 0.2, 0.56 + rng() * 0.14),
    });
    out.push(node);
  }

  return out;
}

/**
 * 生成一棵完整的层级区块树，返回**扁平数组**（靠 parentId 串起来）。
 *
 * 为什么用扁平数组而不是嵌套容器：坐标只存在于一个空间里，命中测试、撤销快照、
 * 落库序列化都不用关心层级；渲染时按 level 分组即可。
 *
 * @returns 顶层优先、同级按生成顺序排列的区块列表
 */
export function generateHierarchy(options: GenerateHierarchyOptions): MapRegion[] {
  const { seed, bounds } = options;
  const counts = [...(options.levelCounts ?? REGION_LEVELS.map((l) => l.count))];

  if (counts.length === 0) return [];
  if (counts.some((c) => !Number.isFinite(c) || c <= 0)) return [];
  if (bounds.width <= 0 || bounds.height <= 0) return [];

  // 全局采样步长取**最细一级**的尺度：父级的曲线会被子级原样切片，
  // 若按父级自己的尺度采样，缩到最深处那段折线会是一根根显眼的直线段。
  const finest = Math.max(1, counts[counts.length - 1]);
  const finestR = Math.sqrt((bounds.width * bounds.height) / finest);
  const ctx: WobbleCtx = {
    bounds,
    noiseSeed: seed,
    step: finestR / REGION_WOBBLE.segmentsPerRadius,
    finestR,
  };

  const rng = createRng(seed);
  let counter = 0;
  const nextId = () => {
    counter += 1;
    return `rg_${(seed >>> 0).toString(36)}_${counter}`;
  };

  // 虚拟根：整张地图，四条边都是画框（笔直）
  const rect: Point[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
  let frontier: LocalNode[] = [
    {
      id: "root",
      level: -1,
      seed: { x: 0, y: 0 },
      hue: 0,
      base: rect,
      edges: rect.map((p, i) => {
        const q = rect[(i + 1) % rect.length];
        const host = makeFrameHost(p, q);
        return { host, from: p, to: q };
      }),
      display: rect,
    },
  ];

  const regions: MapRegion[] = [];

  for (let level = 0; level < counts.length; level += 1) {
    if (frontier.length === 0) break;
    const budget = REGION_TOTAL_LIMIT - regions.length;
    if (budget <= 0) break;
    const target = Math.min(counts[level], budget);
    const per = shareCounts(target, frontier.length);

    const next: LocalNode[] = [];
    for (let i = 0; i < frontier.length; i += 1) {
      const parent = frontier[i];
      const n = per[i];
      if (n <= 0) continue;
      next.push(...buildChildren(parent, level, n, regions, seed, rng, ctx, nextId));
    }
    frontier = next;
  }

  return regions;
}
