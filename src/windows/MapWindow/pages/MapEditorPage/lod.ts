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
 */
export function resolveElementLevel(
  level: number | null | undefined,
  levelCount: number,
): number | null {
  if (typeof level !== "number" || !Number.isFinite(level) || levelCount <= 0) return null;
  return Math.min(Math.max(0, Math.trunc(level)), levelCount - 1);
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
 * 低于此权重的素材视为"不可见"，不参与命中测试。
 *
 * 取 0.2 而不是渲染阈值 0.004：权重只有一两成的素材在画面上只是一层几乎看不见的
 * 影子，若还允许点中它，用户会在"明明什么都没有"的地方选中东西，随后又发现
 * 选中框（同样几乎透明）不出现 —— 比"点不中"更让人困惑。
 */
export const ELEMENT_PICK_MIN_WEIGHT = 0.2;

/**
 * 由层级反推视口的缩放上下限。
 *
 * 下限：比最粗一级的自然缩放再退一点，保证整张地图铺得下（实际下限还会与
 *       `fitToRect` 算出的适配缩放取小者，在渲染层处理）。
 * 上限：最细一级的自然缩放再放大若干倍，留出"贴近看单个郡"的余量。
 */
export function zoomLimitsFor(scales: readonly number[]): { min: number; max: number } {
  if (scales.length === 0) return { min: 0.05, max: 4 };
  return {
    min: scales[0] * LOD_ZOOM_RANGE.coarseOut,
    max: scales[scales.length - 1] * LOD_ZOOM_RANGE.fineIn,
  };
}

/** 从已生成的区块列表统计每级数量（自然缩放要用实际数量而不是常量表） */
export function levelCountsOf(regions: ReadonlyArray<{ level: number }>): number[] {
  const counts: number[] = [];
  for (const r of regions) {
    while (counts.length <= r.level) counts.push(0);
    counts[r.level] += 1;
  }
  return counts;
}
