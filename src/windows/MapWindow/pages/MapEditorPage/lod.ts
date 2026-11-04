/**
 * 层级区块的 LOD（Level of Detail）—— "缩放到多远看到多细"的连续衔接。
 *
 * 【要解决的问题】层级区块是一棵四级树（大陆 → 洲 → 国家 → 郡）。如果按"缩放
 * 超过某个阈值就换一级"来做，缩放过程中会看到边界突然整片换掉（跳变）。真实地图
 * 应用（以及"无级缩放"的本意）要求的是**连续过渡**：上一级淡出的同时下一级淡入，
 * 两条边界在同一时刻都只画一半浓度，肉眼看到的是"线条自然长出/融掉"。
 *
 * 【核心：四个权重之和恒为 1】
 * 把每个层级的可见性表达成缩放 z 的函数 α_i(z)（0 = 完全不画，1 = 完全画）。
 * 最怕的是"过渡带里所有层级的权重都不够，画面发空"或"加起来超过 1，边界发黑"。
 * 这里用**帽函数**（hat basis）从构造上排除这两种可能：
 *
 *   取一串递增的**交界缩放** b_0 < b_1 < ... < b_{n-2}，
 *   定义 t_i(z) = smoothstep((log2 z - log2 b_i) / W + 0.5)，它是 z 的单调增函数，
 *   于是对固定的 z 有 t_0 ≥ t_1 ≥ ... ≥ t_{n-2}，令
 *
 *     α_0 = 1 - t_0
 *     α_i = t_{i-1} - t_i      (1 ≤ i ≤ n-2)
 *     α_{n-1} = t_{n-2}
 *
 *   相邻两项首尾相消，和恒等于 1（与 z 无关）；每一项又非负（因为 t 单调）。
 *   这就是一维单纯形上的"单位分解"（partition of unity）。
 *
 * 【交界缩放取相邻两级自然缩放的几何平均】
 * "第 i 级在第 i+1 级面前不再够用"的位置，主观上落在两级自然缩放之间；取几何平均
 * （即对数尺度上的中点）与"缩放是按倍率感知"的事实一致 —— 0.2→0.4 和 2→4 看起来
 * 是同样的"放大一倍"，所以插值必须在对数域做。
 *
 * 【为什么在 log2 域插值】在缩放的自然坐标里，1 倍和 2 倍之间的一半是 √2 而不是 1.5。
 * 在 log2 域做 smoothstep，交叉带在任意缩放下都占相同的"倍率宽度"。
 *
 * 【交叉带宽度 W】取 1/3 个倍频程（octave）。再窄会看到明显的"接缝"（两极权重
 * 同时掉到 0.5 以下的一瞬间画面偏空）；再宽则两级同时以 0.5 左右的浓度叠加，
 * 显得边界发糊、双线可见。
 *
 * 【边界】纯函数模块（不依赖 React / Pixi / DOM），必须覆盖单元测试。
 */

/** 地图的世界范围（与 `regions.ts` 的同名类型结构一致） */
export interface LodBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 只读的点（多边形的顶点）。刻意不 import `regions.ts` 的 `Point`：
 *  本模块要能被任何地方引用而不带上区块生成器（那里有噪声与裁剪算法）。 */
export interface LodPoint {
  x: number;
  y: number;
}

/**
 * 一个层级区块在屏幕上占多大像素时算"这一级的自然缩放"。
 *
 * 采用**屏幕空间误差**的思路：不关心世界坐标里一块有多大，只关心它在屏幕上多大。
 *
 * 360px 是按**可读性**定的：一块占 360px，1200px 宽的画布上一屏约容得下 3×3 块。
 * 再大就只剩两三块、失去"地图"的密度；再小则边界密到发糊。
 *
 * 【它同时决定了第一眼看到哪一级】`scale · 2R = LOD_BLOCK_PX` 时该级最清晰，
 * 因此 blockPx 越大、各自然缩放整体越大、第一眼看到的层级越**粗**。
 * 实测：1024² 的地图配 1024² 画布、适配留白 0.8 ⇒ 适配缩放 0.8；四级默认数量
 * [3, 12, 48, 160] 代入 `naturalScales` 得 [0.304, 0.609, 1.218, 2.223]，
 * 交界（相邻两级几何平均）[0.431, 0.861, 1.646]。0.8 落在 0.431~0.861 之内，
 * ⇒ **主导层级是"洲"（≈91%）**，并带一点刚冒头的"国家"（≈9%）。
 * 那 9% 不是偏差：更细一级在缩进去之前淡淡透出，正是"无极衔接"要的观感。
 * 缩出去依次得到大陆，缩进去依次得到国家、郡。
 */
export const LOD_BLOCK_PX = 360;

/** 交叉带宽度（单位：倍频程）。见模块头注释。 */
export const LOD_BAND_OCTAVES = 1 / 3;

/** 权重低于这个值就不再渲染该级（省掉一次全量绘制） */
export const LOD_ALPHA_EPSILON = 0.004;

/** 缩放上下限相对最粗/最细一级自然缩放的倍率 */
export const LOD_ZOOM_RANGE = { coarseOut: 0.6, fineIn: 4 } as const;

/** 某级的"尺度基准"R —— 该级一块大约有多大（世界单位） */
export function levelBlockRadius(counts: readonly number[], bounds: LodBounds): number[] {
  const area = Math.max(0, bounds.width * bounds.height);
  return counts.map((c) => Math.sqrt(area / Math.max(1, c)));
}

/**
 * 每一级的自然缩放：在该缩放下，这一级的一块在屏幕上正好 `blockPx` 像素高。
 *
 * 用 R 而不是"两倍 R"作为尺度基准，是为了让"一块的屏幕尺寸"口径统一（横向略扁的
 * 地图上，取面积等效半径不会因为长宽比而偏）。分母上的 2 是把半径折成"整块的
 * 视觉大小"，避免同一份 `blockPx` 在不同层级下看起来差一倍。
 */
export function naturalScales(
  counts: readonly number[],
  bounds: LodBounds,
  blockPx = LOD_BLOCK_PX,
): number[] {
  return levelBlockRadius(counts, bounds).map((r) => blockPx / (2 * Math.max(1e-6, r)));
}

/** 相邻两级自然缩放的几何平均，即"这一对层级互相交接"的缩放 */
export function bandEdges(scales: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < scales.length; i += 1) out.push(Math.sqrt(scales[i] * scales[i + 1]));
  return out;
}

/** smoothstep，输入已被归一化到 [0,1] */
function smoothstep(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * 第 i 条交界线在给定缩放下的"已越过程度"，∈ [0,1]。
 *
 * z 远小于 b 时为 0，远大于 b 时为 1，中间在 log2 域用 smoothstep 平滑过渡，
 * 过渡带宽度为 `bandOctaves`。对固定的 z，b 越大 t 越小 —— 这条单调性正是
 * 帽函数非负的来源。
 */
export function bandProgress(scale: number, edge: number, bandOctaves = LOD_BAND_OCTAVES): number {
  const z = Math.max(1e-9, scale);
  const b = Math.max(1e-9, edge);
  const w = Math.max(1e-6, bandOctaves);
  return smoothstep((Math.log2(z) - Math.log2(b)) / w + 0.5);
}

/**
 * 各层级的可见权重（长度与 `scales` 一致，和为 1）。
 *
 * 见模块头：α_0 = 1 - t_0，α_i = t_{i-1} - t_i，α_{n-1} = t_{n-2}。
 */
export function levelAlphas(scale: number, scales: readonly number[]): number[] {
  const n = scales.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const edges = bandEdges(scales);
  const t = edges.map((e) => bandProgress(scale, e));
  const out = new Array<number>(n);
  out[0] = 1 - t[0];
  for (let i = 1; i < n - 1; i += 1) out[i] = t[i - 1] - t[i];
  out[n - 1] = t[n - 2];
  return out;
}

/** 当前缩放下的"主层级"（权重最大的那一级），用于工具栏上的层级指示 */
export function activeLevel(scale: number, scales: readonly number[]): number {
  const alphas = levelAlphas(scale, scales);
  let best = 0;
  for (let i = 1; i < alphas.length; i += 1) if (alphas[i] > alphas[best]) best = i;
  return best;
}

/** 需要真正画出来的层级及其权重（权重过小的直接跳过），按层级从小到大排列 */
export function visibleLevels(
  scale: number,
  scales: readonly number[],
  epsilon = LOD_ALPHA_EPSILON,
): Array<{ level: number; alpha: number }> {
  const alphas = levelAlphas(scale, scales);
  const out: Array<{ level: number; alpha: number }> = [];
  for (let i = 0; i < alphas.length; i += 1) {
    if (alphas[i] > epsilon) out.push({ level: i, alpha: alphas[i] });
  }
  // 极端缩放下帽函数已保证至少一级权重接近 1，这里只是防御性兜底
  return out.length > 0 ? out : [{ level: activeLevel(scale, scales), alpha: 1 }];
}

/**
 * 把素材元素记录的层级，规整为"当前层级配置下真正生效的那一级"。
 *
 * 素材是在某个缩放下放置的，放置那一刻的主层级就是它的归属（见 `activeLevel`）。
 * 但层级配置是可变的（生成时可以选 2~4 级），于是会出现两种"对不上的层级"：
 *
 *   · `level` 为 `null`（或在生成区块之前放置，字段缺失）→ 层级无关，任何缩放下都可见；
 *   · `level` 超出当前的层级数（先用 4 级放了一堆素材，之后改成 2 级）→
 *     **并入现存最细的一级**，而不是权重记 0。
 *
 * 后一条是刻意为之：若越界直接判 0，那些素材会永久不可见、也永远点不中，
 * 用户只能靠"撤销回生成之前"来救 —— 那是数据丢失级别的坑。并入最细一级后，
 * 缩进去仍能看到它们，行为可预期。
 *
 * 【有限性校验（AGENTS §6.0）】`levelCount` 来自渲染层的 `levelAlphas.length`、
 * 也可能来自外部数据，因此 `NaN` / `±Infinity` 一律当作"没有层级"处理。
 * 若放过去：`Math.min(…, NaN - 1)` 会得到 `NaN`，一路传进 `elementSizeFactor`
 * 就是 `0.5 ** NaN = NaN` —— 精灵宽高变成 `NaN` 后**既不显示也点不中**，
 * 且报错出现在 Pixi 内部，排查成本极高。
 */
export function resolveElementLevel(
  level: number | null | undefined,
  levelCount: number,
): number | null {
  if (typeof level !== "number" || !Number.isFinite(level)) return null;
  if (!Number.isFinite(levelCount) || levelCount <= 0) return null;
  return Math.min(Math.max(0, Math.trunc(level)), Math.trunc(levelCount) - 1);
}

/**
 * 素材元素在当前缩放下的可见权重。
 *
 * 直接取它所属层级的权重（`levelAlphas`），因此素材与区块边界**同呼吸**：
 * 该层级淡出，它跟着淡出；切到别的层级，它就消失。层级无关的素材恒为 1。
 */
export function elementWeight(
  level: number | null | undefined,
  alphas: readonly number[],
): number {
  const resolved = resolveElementLevel(level, alphas.length);
  if (resolved === null) return 1;
  return alphas[resolved] ?? 0;
}

/**
 * 素材世界尺寸的"每级减半"倍率。
 *
 * 见 `elementSizeFactor` 的推导。抽成常量是为了让单测和注释引用同一个数。
 */
export const ELEMENT_SIZE_PER_LEVEL = 0.5;

/**
 * 素材的世界尺寸乘数 —— **它归属的层级越细，素材越小**。
 *
 * 【要解决的问题】素材的基准宽 `SPRITES[].baseWidth` 是 80~160 世界单位，而
 * 一个 **郡**（4 级时的 level 3）多边形的长边只有 70~90 —— 素材比它所属的区块
 * 还大。素材与区块同在 `world` 容器下、同倍缩放，所以**放大多少倍都不改变这个
 * 比例**：只放开缩放上限，用户照样塞不进几个要素（这正是用户报障的根因之二）。
 *
 * 【为什么是"每级减半"】目标层级每多一级，块的长边就约减半。实测（`generateLand`
 * + 逐岛加权切分、1024² 地图、seed 42 单种子）每一级块长边的中位数是
 * **507 / 301 / 150 / 88** 世界单位 —— 每级恰好 0.59/0.50/0.59 倍。尺寸也必须
 * 按同一比例减半，`素材宽 : 该级块长边` 才能恒定：
 *
 *   | level | 档位 | 块长边 p50（seed 42 单种子） | 山（大）的宽（baseWidth 160 × 因子） | 占比 |
 *   |---|---|---|---|---|
 *   | 0 | 大陆 | 507 | 160 | 32%（与改动前**完全一致**） |
 *   | 1 | 洲   | 301 | 80  | 27% |
 *   | 2 | 国家 | 150 | 40  | 27% |
 *   | 3 | 郡   | 88  | 20  | 23% |
 *
 * 表中是**单个种子**（seed 42）的 p50，便于复现；跨 6 个种子的郡级 p50 实测为
 * **81.1~88.2**，占比 23%~25%，结论不变（仍是"每级减半 ⇒ 占比恒定"）。
 * 郡级 23%（山（中）17%、森林 13~18%）意味着"一个郡里横向能摆 4 个左右山、
 * 纵向 3 层"（郡的包围盒高只有 35~37，山（大）高 11.6；留 20% 边距后约 3×2 = 6 个），
 * 疏密与最粗一级一致 —— 既不会一个郡只能放一个山，也不会把郡铺满贴纸。
 * 素材之间 13%~32% 的差异来自 `baseWidth` 本身的视觉归一（山 160 / 小山 80），
 * 改动前就是这样，本次不改素材表。
 *
 * 【两种"对不上"的层级沿用 `resolveElementLevel` 的口径】
 *   · `level` 为 `null`（生成区块之前放的）→ 返回 `1`，**行为与改动前完全一致**；
 *   · `level` 超出当前层级数（先用 4 级放、之后改成 2 级）→ 并入最细一级，
 *     而不是"缩到 1/16"这种无意义的数。
 *
 * 【为什么不动 `el.scale`】`scale` 是**文档数据**（用户将来可能用滑杆调），
 * 把层级因子乘进去会污染存储、并让"改了层级数"变成一次数据迁移。因子只在
 * 渲染与命中的出口乘一次（`MapCanvas` 三处 + `useMapEditor.pickElement`）。
 */
export function elementSizeFactor(
  level: number | null | undefined,
  levelCount: number,
): number {
  const resolved = resolveElementLevel(level, levelCount);
  if (resolved === null) return 1;
  return ELEMENT_SIZE_PER_LEVEL ** resolved;
}

/**
 * 低于此权重的素材视为"不可见"，不参与命中测试。
 *
 * 取 0.2 而不是渲染阈值 0.004：权重只有一两成的素材在画面上只是一层几乎看不见的
 * 影子，若还允许点中它，用户会在"明明什么都没有"的地方选中东西，随后又发现
 * 选中框（同样几乎透明）不出现 —— 比"点不中"更让人困惑。
 */
export const ELEMENT_PICK_MIN_WEIGHT = 0.2;

/**
 * 由层级反推视口的缩放上下限（**不含真实块大小**，只用每级数量推出来的自然缩放）。
 *
 * 下限：比最粗一级的自然缩放再退一点，保证整张地图铺得下（实际下限还会与
 *       `fitToRect` 算出的适配缩放取小者，在渲染层处理）。
 * 上限：最细一级的自然缩放再放大若干倍，留出"贴近看单个郡"的余量。
 *
 * 【上限为什么不够用】`fineIn = 4` 只是"自然缩放的 4 倍"，而自然缩放是按
 * `LOD_BLOCK_PX`（一块在屏幕上 360px）反推的 —— 它保证"读得清"，不保证
 * "一块能铺满屏幕"。实测（1024×900 画布、6 个种子）：上限 8.89，而让**中位郡**
 * 铺满画布短边需要 10~11 倍、让 p05 的郡铺满需要 19 倍左右。
 * 因此真实上限改由 `zoomLimitsForBlocks` 按**实际块长边**反推；本函数保留为
 * 它的下限基线（`Math.max` 里的那一项），也保留给"只想知道自然缩放区间"的调用方。
 */
export function zoomLimitsFor(scales: readonly number[]): { min: number; max: number } {
  /**
   * 【先过滤再取首尾（AGENTS §6.0）】本函数只读 `scales[0]` 与 `scales[last]`，
   * 因此脏值出现在**任何位置**都会直接进乘法：`NaN` 传染成 `NaN` 上限，
   * `Infinity` 会把上限变成 `Infinity`（滚轮直接飞到底）。
   * 过滤掉非有限/非正的值之后，"首尾"才真的等于"最粗一级 / 最细一级"——
   * 这是本函数的**契约**，由单测直接钉住（而不是靠调用方恰好只传干净数组）。
   */
  const valid = scales.filter((s) => Number.isFinite(s) && s > 0);
  if (valid.length === 0) return { min: 0.05, max: 4 };
  return {
    min: valid[0] * LOD_ZOOM_RANGE.coarseOut,
    max: valid[valid.length - 1] * LOD_ZOOM_RANGE.fineIn,
  };
}

/**
 * "铺满屏幕"的过采样系数：上限处让块的长边比画布短边再长 15%。
 *
 * 取 1 会得到一个"刚好贴边"的上限 —— 那时块的边角仍在屏幕内，用户会觉得
 * "再往里一点点就好了"。15% 的余量让最大缩放时块**明确地铺满并溢出**短边，
 * 同时又不至于把溢出做得太大（那样中位块在 max 下会被放得过分）。
 */
export const ZOOM_FILL_OVERSCAN = 1.15;

/**
 * "最细一级块长边"的地板值（世界单位）。
 *
 * 防御退化数据：若某个种子的最细一级全是碎块（或者层级数量被调到极大），
 * `finestBlockLongEdge` 可能返回 1~2，反推出的上限会变成几百倍。
 * 8 世界单位 = 整张纸（1024）的 0.8%，比任何"还想往里放素材"的块都小得多。
 */
export const ZOOM_MIN_BLOCK_LONG = 8;

/**
 * 缩放上限的硬顶。
 *
 * 实测：让"p05 的郡"铺满 900px 短边需要 18.6~20.8 倍（6 个种子）；让**最小**
 * 的碎块铺满需要 26~40 倍。40 因此足够覆盖全部实测情形，同时把海面底图的
 * 拉伸限制在 40/3 ≈ 13 倍（缓存倍率封顶 `STATIC_CACHE_MAX_RES = 3`，
 * 见 `docs/prd/prd-map-render/architecture.md` §9 的 L-7）——
 * 再高也不会有更多细节，只会更糊、且滚轮要走更多格。
 */
export const ZOOM_ABS_MAX = 40;

/**
 * 取最细一级块长边的分位点（见 `finestBlockLongEdge` 的说明）。
 *
 * 0.05 = 忽略最细一级里最碎的那 5%（160 个郡里的 8 块），换来"上限不被单个
 * 退化窄条牵着走"。实测跨 6 个种子 p05 ∈ [49.7, 55.6]，而 `min` ∈ [26.3, 40.6]。
 */
export const ZOOM_FINEST_PERCENTILE = 0.05;

/**
 * 多边形（不要求凸）的**长边**：轴对齐包围盒的长边。
 *
 * 为什么用包围盒而不是"最长的一条边"或"任意两顶点的最长距离"：
 *   · 最长的一条**边**没有意义 —— 区块的边被崎岖化成几十段折线，单段只有
 *     采样步长那么长（约 R/24 ≈ 4 世界单位），与"这块有多大"完全无关；
 *   · 最长**对角线**（直径）要用 O(n²) 两两比较，而崎岖化的多边形顶点可达
 *     数百个；它只比包围盒大 10% 左右（实测 p10：57.7 vs 64.1），
 *     对"反推缩放上限"这种量级判断毫无价值。
 * 包围盒长边是 O(n)、口径直观（"这块东西占多宽"），且与用户"铺满屏幕"的
 * 直觉一致。
 */
export function polygonLongEdge(polygon: readonly LodPoint[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  /** 有效顶点数：外部数据里可能有 `NaN` 顶点（序列化损坏 / 旧版本写入） */
  let valid = 0;
  for (const p of polygon) {
    // 有限性校验（AGENTS §6.0）：一个 NaN 顶点就足以让整块的长边变成 NaN，
    // 而 NaN 会顺着 `zoomLimitsForBlocks` 把缩放上限变成 NaN（滚轮直接失灵）。
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    valid += 1;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (valid === 0) return 0;
  return Math.max(maxX - minX, maxY - minY);
}

/** 升序数组里的分位值（`p` ∈ [0,1]，最近邻取点；空数组返回 0） */
function percentileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const clamped = Math.min(1, Math.max(0, p));
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * clamped)));
  return sorted[idx];
}

/**
 * 某一级所有区块"长边"的**低分位**值（世界单位）。空集合返回 0。
 *
 * 【为什么要分位而不是直接取 min】最细一级里总有几块退化成窄条（实测 6 个种子、
 * 160 个郡：最小长边 26.3~40.6 世界单位，只有中位 81~88 的 1/3 ~ 1/2）。若按 `min`
 * 反推上限，整张图的缩放上限就被**单个碎块**牵着走；更极端的种子能给出更小的碎块，
 * 上限会直接爆到几百倍（此时海面已被拉伸十几倍，画面只剩糊）。
 *
 * 【为什么是 p05】实测 6 个种子的 p05 落在 49.7~55.6（跨种子波动 <12%，很稳），
 * 它保证 **95% 的郡都能在缩放上限处把长边铺满画布短边**；剩下 5%（约 8 块/
 * 160 个郡）是退化窄条，本就不适合放要素。对照：p10 只能覆盖 90%，而 `min`
 * 会让上限跟着碎块乱跳 —— 见 `lod.test.ts` 里对这三者的对照断言。
 */
export function finestBlockLongEdge(
  regions: ReadonlyArray<{ level: number; polygon: readonly LodPoint[] }>,
  level: number,
  percentile = ZOOM_FINEST_PERCENTILE,
): number {
  const longs: number[] = [];
  for (const r of regions) {
    if (r.level !== level) continue;
    const long = polygonLongEdge(r.polygon);
    if (long > 0) longs.push(long);
  }
  longs.sort((a, b) => a - b);
  return percentileOf(longs, percentile);
}

/**
 * 由"层级 + **实际块大小** + 画布尺寸"反推缩放上下限。
 *
 * 【上限的语义】"最细一级的一块能把画布**短边**铺满"。用短边而不是长边，是因为
 * "铺满全屏"不该以块溢出屏幕为代价 —— 短边铺满时，块在长边方向上还剩一点
 * 视野，用户看得到这块的边界在哪（与 `FIT_PADDING` 同一取舍：要看得见"这是一块
 * 地"，而不是"一块无边的色块"）。乘 `ZOOM_FILL_OVERSCAN` 留 15% 余量。
 *
 * 【三条护栏，缺一条就出回归】
 *   1. **不得小于旧公式**：`Math.max(zoomLimitsFor(scales).max, 反推值)`。
 *      层级数调成 1~2 级时，最细一级就是大陆/洲（长边 700/350），反推值只有
 *      1.5/3 倍，会比旧公式小 —— 那会让"上限随配置变少而变小"，用户改配置后
 *      连原来能到达的深度都到不了。
 *   2. **块长边有地板**（`ZOOM_MIN_BLOCK_LONG`）且**上限有硬顶**
 *      （`ZOOM_ABS_MAX`）：一起防"退化碎块把上限炸到几百倍"。
 *   3. **画布还没量出来时退回旧公式**：`width` / `height` 只要有一个不是有限正数
 *      （首帧 0×0、`NaN`、只量出一边）就不反推 —— 不能因此把上限压成 0，
 *      也不该把半量出来的尺寸当成真画布。
 *
 * 【下限】语义不变（可缩回整图），并且**必须与适配缩放取小者** —— 否则层级
 * 配置一变（自然缩放下限被抬高），用户就再也缩不回整张地图了。这里是它唯一的
 * 计算出处，`fitScale` 因此是入参。
 *
 * @param fitScale  "整图适配"的缩放（`fitScaleFor`），用于封住下限
 * @param absMax    硬上限，缺省 `ZOOM_ABS_MAX`
 */
export function zoomLimitsForBlocks(input: {
  scales: readonly number[];
  fitScale: number;
  finestBlockLong: number;
  canvas: { width: number; height: number };
  absMax?: number;
}): { min: number; max: number } {
  /**
   * 【边界一律先做有限性校验（AGENTS §6.0）】这里是**外部数据的最后一站**：
   * `scales` 由区块数量算出、`canvas` 来自 DOM 测量、`fitScale` 来自几何换算。
   * 任何一个混进 `NaN` / `Infinity`，`Math.max/min` 都会把它污染成 `NaN` ——
   * 而 `zoomAt` 拿到 `NaN` 上限后每一次缩放都会得到 `NaN` 视口，
   * 表现是"画面直接消失、滚轮彻底失灵"，且没有任何异常可抓。
   */
  // `zoomLimitsFor` 自己会过滤脏 `scales`（见其注释），这里不再重复一遍，
  // 保证"过滤"只有一处实现、一处断言。
  const fromLevels = zoomLimitsFor(input.scales);

  // 下限：层级推出来的下限与"整图适配"取小者（缺了这条就缩不回整图）
  const fitScale =
    Number.isFinite(input.fitScale) && input.fitScale > 0 ? input.fitScale : fromLevels.min;
  const min = Math.min(fromLevels.min, fitScale);

  // 硬顶：非有限/非正一律退回默认值，再与旧公式取大（护栏 1 优先于硬顶）
  const absMaxInput = input.absMax;
  const absMaxSafe =
    typeof absMaxInput === "number" && Number.isFinite(absMaxInput) && absMaxInput > 0
      ? absMaxInput
      : ZOOM_ABS_MAX;
  const absMax = Math.max(fromLevels.max, absMaxSafe);

  /**
   * 画布必须**两个维度都量全**才反推，只看 `Math.min(width, height)` 不够。
   *
   * `Math.min(Infinity, 900)` 会静悄悄给出 900，于是"宽没量出来"这种坏输入被当成
   * 正常画布算出 20.7：数学上没错，但它掩盖了一次测量失败，而且现实中不存在
   * "半量出来的画布"。因此 `width` 与 `height` **各自**都要求有限且 > 0，
   * 只要有一边不满足就按"还没量出来"处理，退回旧公式（护栏 3）。
   */
  const { width, height } = input.canvas;
  const measured =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  // 画布未量出（首帧 0×0）/ 块长边非有限或非正 ⇒ 退回旧公式（护栏 3）
  if (!measured || !Number.isFinite(input.finestBlockLong) || !(input.finestBlockLong > 0)) {
    return { min, max: Math.min(fromLevels.max, absMax) };
  }

  const shortSide = Math.min(width, height);

  const blockLong = Math.max(ZOOM_MIN_BLOCK_LONG, input.finestBlockLong);
  const fill = (shortSide * ZOOM_FILL_OVERSCAN) / blockLong;
  if (!(fill > 0) || !Number.isFinite(fill)) return { min, max: fromLevels.max };

  return { min, max: Math.min(absMax, Math.max(fromLevels.max, fill)) };
}

/**
 * 从已生成的区块列表统计每级数量（自然缩放要用实际数量而不是常量表）。
 *
 * 【只认非负整数层级】`level` 若混进 `NaN` / `Infinity` / 负数（外部数据损坏），
 * 前者会写出一个 `counts["NaN"]` 的幽灵键、后者会让下面的 `while` **死循环**
 * （`counts.length <= Infinity` 恒真）。丢掉这些行比让编辑器卡死好。
 */
export function levelCountsOf(regions: ReadonlyArray<{ level: number }>): number[] {
  const counts: number[] = [];
  for (const r of regions) {
    if (!Number.isInteger(r.level) || r.level < 0) continue;
    while (counts.length <= r.level) counts.push(0);
    counts[r.level] += 1;
  }
  return counts;
}

/* ───────────────── 嵌套子地图（Phase 2）的 LOD 扩展 ─────────────────
 *
 * 子图是「父图区块里嵌的一张独立地图」，它的无级缩放复用上面整套 `levelAlphas`
 * 机制，但多了一层「父图缩放 → 子图局部缩放」的换算，以及一个「父图尺度下只露
 * 轮廓、缩进去才淡入内容」的门控。见 `nested-submap-main.md` §5。
 */

/**
 * 子图局部的「等效缩放」= 父图缩放 × 子图贴合变换的常数缩放。
 *
 * 【为什么需要它】子图的 LOD（`naturalScales` / `levelAlphas`）是用**子图自己的
 * bounds + 区块数量**算出来的，单位是「子图局部坐标里的缩放」。但驱动整个场景的
 * 只有根 `world.scale`（= 父图缩放）。子图子树挂在 `submapTransform.scale` 这个
 * 常数之下，所以「子图内容在屏幕上的真实放大倍率」= `父图缩放 × transformScale`。
 * 只有拿这个等效值去查子图自己的 `levelAlphas`，子图才会在「缩进去看它」时无级
 * 显露它的洲/国家/郡 —— 否则子图层级权重会停在父图缩放口径，错位一整档。
 *
 * 【有限性】两个入参都可能来自文档/变换数据，任一非有限即退回 0（子图不可见），
 * 不能让 NaN 传染进 `levelAlphas`（那里会给出全 NaN 的权重，子图内容集体消失且
 * 无从排查）。
 */
export function submapEffectiveScale(parentScale: number, transformScale: number): number {
  if (!Number.isFinite(parentScale) || !Number.isFinite(transformScale)) return 0;
  const s = parentScale * transformScale;
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/**
 * 子图「渐入」权重 —— 父图尺度下只在 `enterScale` 附近平滑淡入，∈ [0,1]。
 *
 * 【解决的问题】「县城尺度只看小溪村大致轮廓」不能靠「子图 LOD 缩到最粗」实现
 * （最粗一级已是小溪村自己的陆地，不是轮廓）。正确做法：父图缩放低于
 * `enterScale` 时子图**整体不显示**（只露出父图区块的「绑定态轮廓」），越过阈值
 * 才在 `enterScale ~ detailScale` 之间淡入，之后才由等效缩放驱动子图内部无级 LOD。
 *
 * 这里复用 `bandProgress`（log2 域 smoothstep）：以 `enterScale` 为交界、带宽
 * `bandOctaves` 做平滑过渡，与父图层级交叉淡化共用同一条曲线，观感一致。
 *
 * 【带宽取 1/2 倍频程】子图淡入是「从无到有」的单一过渡，比层级间交叉淡化
 * 稍宽一点（1/2 > 1/3），让「轮廓 → 内容」的转折更柔和。
 */
export function submapEnterWeight(
  parentScale: number,
  enterScale: number,
  bandOctaves = 1 / 2,
): number {
  if (!Number.isFinite(enterScale) || enterScale <= 0) return 1;
  return bandProgress(parentScale, enterScale, bandOctaves);
}

/**
 * 子图「渐入」的自动阈值 —— 按「区块在屏幕上约 `blockPx` 长」反推父图缩放。
 *
 * 【为什么区块长边 ≈ 360px 时才开始淡入子图】与父图层级用同一个 `LOD_BLOCK_PX`
 * 口径：当这个区块在屏幕上大到「读得清它是独立的一块地」（≈360px）时，用户才会
 * 有「钻进去看里面」的意图，此时让子图内容淡入才不突兀。太早淡入会在俯瞰时把
 * 一堆子图细节糊在画面上。
 *
 * 【长边而非短边】区块形状各异，取包围盒长边（`polygonLongEdge`）反推，保证
 * 「这块东西在屏幕上占多大」口径与缩放上限的推导一致。
 */
export function enterScaleForRegion(blockLongEdgeWorld: number, blockPx = LOD_BLOCK_PX): number {
  if (!Number.isFinite(blockLongEdgeWorld) || blockLongEdgeWorld <= 0) return Infinity;
  const s = blockPx / blockLongEdgeWorld;
  return Number.isFinite(s) && s > 0 ? s : Infinity;
}
