import { describe, expect, it } from "vitest";
import {
  ELEMENT_PICK_MIN_WEIGHT,
  LOD_ALPHA_EPSILON,
  LOD_BAND_OCTAVES,
  LOD_BLOCK_PX,
  LOD_ZOOM_RANGE,
  ZOOM_ABS_MAX,
  ZOOM_FILL_OVERSCAN,
  ZOOM_MIN_BLOCK_LONG,
  activeLevel,
  bandEdges,
  bandProgress,
  elementSizeFactor,
  elementWeight,
  finestBlockLongEdge,
  levelAlphas,
  levelBlockRadius,
  levelCountsOf,
  naturalScales,
  polygonLongEdge,
  resolveElementLevel,
  submapEffectiveScale,
  submapEnterWeight,
  enterScaleForRegion,
  visibleLevels,
  zoomLimitsFor,
  zoomLimitsForBlocks,
  type LodBounds,
} from "./lod";

/**
 * LOD 权重分配单元测试。
 *
 * 这是纯函数模块，断言到具体行为而非"跑起来没报错"。最要紧的三条：
 *  - **权重和恒为 1**：任何缩放下四级加起来恰好是 1。少了会出现"过渡带里画面发空"
 *    （该画的层级权重都不够），多了会出现"边界发黑"（多级叠加）。
 *  - **权重非负**：负权重会让渲染层把 alpha 钳到 0，等于凭空丢一个层级。
 *  - **不会洗白**：任何时刻都至少有一级的权重 ≥ 0.5，也就是任何缩放都能看清一个层级
 *    的结构，不会"两级各半、谁都不清楚"。
 */

const BOUNDS: LodBounds = { x: -512, y: -512, width: 1024, height: 1024 };
/** 默认四级：大陆 3 / 洲 12 / 国家 48 / 郡 160 */
const COUNTS = [3, 12, 48, 160];

/** 覆盖到很宽的缩放范围（直径上跨 8 个数量级） */
const ZOOM_SWEEP = Array.from({ length: 400 }, (_, i) => 10 ** (-1.2 + i * (5.4 / 399)));

describe("levelBlockRadius / naturalScales", () => {
  it("尺度基准随层级递减，且比值恰好是数量比的平方根", () => {
    const radii = levelBlockRadius(COUNTS, BOUNDS);
    expect(radii).toHaveLength(4);
    const area = BOUNDS.width * BOUNDS.height;
    radii.forEach((r, i) => expect(r).toBeCloseTo(Math.sqrt(area / COUNTS[i]), 9));
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]).toBeLessThan(radii[i - 1]);
      // 每级块数 ×4 → 面积减到 1/4 → 半径减半（最后一级是 48→160，故不是 2）
      expect(radii[i - 1] / radii[i]).toBeCloseTo(Math.sqrt(COUNTS[i] / COUNTS[i - 1]), 9);
    }
  });

  it("自然缩放随层级递增，且等于数量比的平方根", () => {
    const scales = naturalScales(COUNTS, BOUNDS);
    expect(scales).toHaveLength(4);
    for (let i = 1; i < scales.length; i += 1) {
      expect(scales[i]).toBeGreaterThan(scales[i - 1]);
      expect(scales[i] / scales[i - 1]).toBeCloseTo(Math.sqrt(COUNTS[i] / COUNTS[i - 1]), 9);
    }
    // 自然缩放的定义：该级一块在屏幕上正好 LOD_BLOCK_PX 像素
    const radii = levelBlockRadius(COUNTS, BOUNDS);
    scales.forEach((s, i) => expect(s * 2 * radii[i]).toBeCloseTo(LOD_BLOCK_PX, 6));
  });

  it("地图边长翻倍时自然缩放减半（尺度口径与地图尺寸一致）", () => {
    const a = naturalScales(COUNTS, BOUNDS);
    const b = naturalScales(COUNTS, { ...BOUNDS, width: 2048, height: 2048 });
    a.forEach((s, i) => expect(b[i]).toBeCloseTo(s / 2, 6));
  });
});

describe("bandEdges / bandProgress", () => {
  it("交界缩放是相邻两级自然缩放的几何平均，且递增", () => {
    const scales = naturalScales(COUNTS, BOUNDS);
    const edges = bandEdges(scales);
    expect(edges).toHaveLength(3);
    edges.forEach((e, i) => expect(e).toBeCloseTo(Math.sqrt(scales[i] * scales[i + 1]), 9));
    for (let i = 1; i < edges.length; i += 1) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
  });

  it("交界处正好过了一半；远小于/远大于时分别贴近 0 / 1", () => {
    const edges = bandEdges(naturalScales(COUNTS, BOUNDS));
    for (const e of edges) {
      expect(bandProgress(e, e)).toBeCloseTo(0.5, 9);
      expect(bandProgress(e * 2 ** -3, e)).toBeLessThan(1e-6);
      expect(bandProgress(e * 2 ** 3, e)).toBeGreaterThan(1 - 1e-6);
    }
  });

  it("同一条交界线、缩放越大越接近 1（帽函数非负的前提）", () => {
    let prev = -1;
    for (const z of ZOOM_SWEEP) {
      const t = bandProgress(z, 0.5);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
});

describe("levelAlphas", () => {
  const scales = naturalScales(COUNTS, BOUNDS);

  it("任意缩放下四级权重之和恒为 1", () => {
    for (const z of ZOOM_SWEEP) {
      const sum = levelAlphas(z, scales).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it("任意缩放下权重都不为负", () => {
    for (const z of ZOOM_SWEEP) {
      for (const a of levelAlphas(z, scales)) expect(a).toBeGreaterThanOrEqual(0);
    }
  });

  it("不会出现「谁都不清楚」：任何缩放下都至少有一级权重 ≥ 0.5", () => {
    for (const z of ZOOM_SWEEP) {
      expect(Math.max(...levelAlphas(z, scales))).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
  });

  it("任何缩放下至多两级同时在过渡（不会多级糊在一起）", () => {
    for (const z of ZOOM_SWEEP) {
      const live = levelAlphas(z, scales).filter((a) => a > 1e-3);
      expect(live.length).toBeLessThanOrEqual(2);
    }
  });

  it("缩到最小只剩最粗一级，放到最大只剩最细一级", () => {
    expect(levelAlphas(1e-4, scales)).toEqual([1, 0, 0, 0]);
    expect(levelAlphas(1e4, scales)).toEqual([0, 0, 0, 1]);
  });

  it("每条交界线上相邻两级权重各占一半", () => {
    const edges = bandEdges(scales);
    edges.forEach((e, i) => {
      const a = levelAlphas(e, scales);
      expect(a[i]).toBeCloseTo(0.5, 9);
      expect(a[i + 1]).toBeCloseTo(0.5, 9);
      expect(a.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 10);
    });
  });

  it("权重随缩放连续变化 —— 不会跳变", () => {
    // 断言"数值导数有界"而不是"绝对值变化小"：导数意义上界是 smoothstep 的
    // 峰斜率 1.5 除以带宽（倍频程）。这样这条断言不依赖扫点的疏密。
    const octavesPerStep = Math.log2(ZOOM_SWEEP[1] / ZOOM_SWEEP[0]);
    let maxSlope = 0;
    for (let i = 1; i < ZOOM_SWEEP.length; i += 1) {
      const prev = levelAlphas(ZOOM_SWEEP[i - 1], scales);
      const cur = levelAlphas(ZOOM_SWEEP[i], scales);
      for (let k = 0; k < prev.length; k += 1) {
        maxSlope = Math.max(maxSlope, Math.abs(cur[k] - prev[k]) / octavesPerStep);
      }
    }
    expect(maxSlope).toBeLessThan(1.5 / LOD_BAND_OCTAVES + 0.5);
  });

  it("单级时权重恒为 1；空输入返回空数组", () => {
    expect(levelAlphas(123, [0.5])).toEqual([1]);
    expect(levelAlphas(123, [])).toEqual([]);
  });

  it("三级时同样满足和为 1", () => {
    const three = naturalScales([3, 12, 48], BOUNDS);
    for (const z of ZOOM_SWEEP) {
      expect(levelAlphas(z, three).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
  });
});

describe("activeLevel / visibleLevels", () => {
  const scales = naturalScales(COUNTS, BOUNDS);

  it("主层级随缩放单调不减", () => {
    let prev = 0;
    for (const z of ZOOM_SWEEP) {
      const cur = activeLevel(z, scales);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
    expect(prev).toBe(3);
  });

  it("在各层级的自然缩放下主层级就是它自己", () => {
    scales.forEach((s, i) => expect(activeLevel(s, scales)).toBe(i));
  });

  it("可见层级至少一个、且一定包含主层级，权重都超过阈值", () => {
    for (const z of ZOOM_SWEEP) {
      const vis = visibleLevels(z, scales);
      expect(vis.length).toBeGreaterThanOrEqual(1);
      expect(vis.length).toBeLessThanOrEqual(2);
      expect(vis.some((v) => v.level === activeLevel(z, scales))).toBe(true);
      for (const v of vis) expect(v.alpha).toBeGreaterThan(LOD_ALPHA_EPSILON);
      const alphas = levelAlphas(z, scales);
      for (const v of vis) expect(v.alpha).toBeCloseTo(alphas[v.level], 12);
    }
  });

  it("极端缩放下兜底返回一个权重为 1 的层级", () => {
    const vis = visibleLevels(1e-12, scales, 2); // 阈值高于所有权重 → 走兜底
    expect(vis).toHaveLength(1);
    expect(vis[0].alpha).toBe(1);
  });
});

describe("zoomLimitsFor", () => {
  it("上限高于最细一级的自然缩放，下限低于最粗一级", () => {
    const scales = naturalScales(COUNTS, BOUNDS);
    const { min, max } = zoomLimitsFor(scales);
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThan(scales[0]);
    expect(max).toBeGreaterThan(scales[scales.length - 1]);
    expect(max).toBeGreaterThan(min);
  });

  it("空层级表给出可用的兜底区间", () => {
    const { min, max } = zoomLimitsFor([]);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThan(min);
  });

  /**
   * 过滤脏 `scales` 是**本函数的契约**，不是调用方的义务。
   *
   * 本函数只读首尾两个元素，所以脏值落在数组中间时，若不过滤就会被"跳过"而不自知
   * —— 这条用例把脏值同时插在首、中、尾，确保任何位置都被忽略。
   */
  it("脏值不分位置一律忽略：取首尾之前先过滤", () => {
    const clean = [0.3, 0.6, 1.2];
    const dirty = [Number.NaN, 0.3, Number.POSITIVE_INFINITY, 0.6, -1, 1.2];
    expect(zoomLimitsFor(dirty)).toEqual(zoomLimitsFor(clean));
    expect(zoomLimitsFor([Number.NaN, 0.3])).toEqual(zoomLimitsFor([0.3]));
  });

  it("全是脏值时退回空表兜底，长度判断用的是过滤后的长度", () => {
    expect(zoomLimitsFor([Number.NaN, Number.POSITIVE_INFINITY, -1, 0])).toEqual(
      zoomLimitsFor([]),
    );
  });
});

describe("levelCountsOf", () => {
  it("按 level 累加，缺失的层级补 0", () => {
    expect(levelCountsOf([])).toEqual([]);
    expect(levelCountsOf([{ level: 0 }, { level: 0 }, { level: 2 }])).toEqual([2, 0, 1]);
  });

  it("与区块生成结果对得上", () => {
    const counts = levelCountsOf(
      [0, 0, 0, 1, 1, 1, 1, 2, 3].map((level) => ({ level })),
    );
    expect(counts).toEqual([3, 4, 1, 1]);
  });

  /**
   * 外部数据损坏时的护栏（AGENTS §6.0）。
   *
   * `Infinity` 那条尤其要紧：旧实现的 `while (counts.length <= r.level) counts.push(0)`
   * 在 `level = Infinity` 时**永不退出**（编辑器直接卡死、且没有异常可抓）。
   * 这里断言"脏行被丢掉、干净行照常计数"，同时用例本身能跑完就说明没有死循环。
   */
  it("非法层级（NaN / Infinity / 负数 / 小数）被忽略，不会死循环", () => {
    const counts = levelCountsOf([
      { level: 0 },
      { level: Number.POSITIVE_INFINITY },
      { level: Number.NaN },
      { level: -1 },
      { level: 1.5 },
      { level: Number.NEGATIVE_INFINITY },
      { level: 1 },
    ]);
    expect(counts).toEqual([1, 1]);
  });
});

describe("交叉带宽度", () => {
  it("交叉带约占 1/3 个倍频程：交界处 ±1/6 倍频程外权重基本归位", () => {
    const scales = naturalScales(COUNTS, BOUNDS);
    const edges = bandEdges(scales);
    const half = LOD_BAND_OCTAVES / 2;
    edges.forEach((e, i) => {
      // 交界线往前半个带宽 → 前一级权重接近 1
      const before = levelAlphas(e * 2 ** -half, scales);
      expect(before[i]).toBeCloseTo(1, 3);
      // 交界线往后半个带宽 → 后一级权重接近 1
      const after = levelAlphas(e * 2 ** half, scales);
      expect(after[i + 1]).toBeCloseTo(1, 3);
    });
  });
});

/**
 * 素材的层级归属 —— 「每一等级的元素随地图缩放而缩放，换到另一级时消失」。
 *
 * 规则只有两条，但两条都踩过坑，所以逐条钉死：
 *  - 层级越界的素材**并入现存最细一级**，而不是权重 0。若判 0，先用 4 级放了一堆
 *    素材、之后改成 2 级生成，那些素材会永久不可见也永远点不中 —— 等于丢数据。
 *  - 层级缺失（老数据 / 生成区块之前放置）按"层级无关"读，权重恒为 1。
 */
describe("resolveElementLevel：把元素层级规整到当前配置", () => {
  it("未生成区块（levelCount = 0）⇒ 层级无关", () => {
    expect(resolveElementLevel(0, 0)).toBeNull();
    expect(resolveElementLevel(3, 0)).toBeNull();
    expect(resolveElementLevel(null, 0)).toBeNull();
  });

  it("层级缺失或非法 ⇒ 层级无关（老数据不该因此消失）", () => {
    expect(resolveElementLevel(null, 4)).toBeNull();
    expect(resolveElementLevel(undefined, 4)).toBeNull();
    expect(resolveElementLevel(Number.NaN, 4)).toBeNull();
    expect(resolveElementLevel(Number.POSITIVE_INFINITY, 4)).toBeNull();
  });

  it("层级越界 ⇒ 并入现存最细的一级（而不是判 0 藏起来）", () => {
    // 先按 4 级放了素材，之后只生成 2 级
    expect(resolveElementLevel(3, 2)).toBe(1);
    expect(resolveElementLevel(2, 2)).toBe(1);
    expect(resolveElementLevel(99, 4)).toBe(3);
  });

  it("负数与非整数一律夹到合法区间", () => {
    expect(resolveElementLevel(-1, 4)).toBe(0);
    expect(resolveElementLevel(2.7, 4)).toBe(2);
  });

  it("合法层级原样返回", () => {
    for (let level = 0; level < 4; level += 1) {
      expect(resolveElementLevel(level, 4)).toBe(level);
    }
  });
});

describe("elementWeight：素材可见权重 = 它所属层级的权重", () => {
  const scales = naturalScales(COUNTS, BOUNDS);

  it("层级无关的素材恒为 1（任何缩放下都可见）", () => {
    for (const z of [0.05, 0.8, 2.5, 12]) {
      expect(elementWeight(null, levelAlphas(z, scales))).toBe(1);
    }
    // 还没生成区块时也只是空数组，同样恒为 1
    expect(elementWeight(null, [])).toBe(1);
  });

  it("与所属层级的权重逐个吻合", () => {
    for (const z of [0.2, 0.43, 0.8, 1.18, 2.2, 6]) {
      const alphas = levelAlphas(z, scales);
      for (let level = 0; level < 4; level += 1) {
        expect(elementWeight(level, alphas)).toBe(alphas[level]);
      }
    }
  });

  it("主导该级时接近 1，切到别级时归 0（这就是用户要的「消失」）", () => {
    // 0.8 下主导层级是洲（见 LOD_BLOCK_PX 的推导）
    const atFit = levelAlphas(0.8, scales);
    expect(activeLevel(0.8, scales)).toBe(1);
    expect(elementWeight(1, atFit)).toBeGreaterThan(0.9);
    expect(elementWeight(3, atFit)).toBe(0); // 郡级素材完全消失
    expect(elementWeight(0, atFit)).toBe(0);

    // 郡的自然缩放（2.223）下反过来：郡级最清楚，洲级已归 0
    const atFine = levelAlphas(2.223, scales);
    expect(elementWeight(3, atFine)).toBeCloseTo(1, 6);
    expect(elementWeight(1, atFine)).toBe(0);
  });

  it("层级越界的素材并入最细一级后仍可见（不丢数据）", () => {
    const alphas = levelAlphas(2.223, scales);
    expect(elementWeight(3, alphas)).toBeCloseTo(1, 6);
    // 只认两级的层级配置下，level 3 的素材并入第 1 级
    const twoLevels = levelAlphas(2.223, scales.slice(0, 2));
    expect(elementWeight(3, twoLevels)).toBe(twoLevels[1]);
  });

  it("权重永远落在 [0,1]：渲染层拿去当 alpha 不会越界", () => {
    for (const z of ZOOM_SWEEP) {
      const alphas = levelAlphas(z, scales);
      for (const level of [0, 1, 2, 3, 3.9, -1, null, undefined]) {
        const w = elementWeight(level as number | null, alphas);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("ELEMENT_PICK_MIN_WEIGHT", () => {
  it("高于渲染裁剪阈值：避免「看不见却点得中」", () => {
    expect(ELEMENT_PICK_MIN_WEIGHT).toBeGreaterThan(LOD_ALPHA_EPSILON);
  });
});

/**
 * 素材尺寸随层级递减 —— 「最小的单位太小、塞不进几个要素」的第二半根因。
 *
 * 第一半是缩放上限（见下面的 `zoomLimitsForBlocks`）；这一半是**比例**：
 * 素材与区块同在 `world` 容器下、同倍缩放，所以"素材的基准宽 80~160 反而比
 * 它所属的郡（长边 70~90）还大"这个比例，放大多少倍都不会改变。
 */
describe("elementSizeFactor：素材按层级自动缩小", () => {
  it("四级下每级减半：1 / 0.5 / 0.25 / 0.125", () => {
    expect(elementSizeFactor(0, 4)).toBe(1);
    expect(elementSizeFactor(1, 4)).toBe(0.5);
    expect(elementSizeFactor(2, 4)).toBe(0.25);
    expect(elementSizeFactor(3, 4)).toBe(0.125);
  });

  it("相邻两级的比值恒为 0.5 —— 因为块的长边也约每级减半", () => {
    // 默认数量 3/12/48/160 ⇒ 块长边约 700 / 350 / 175 / 83（实测 p50）
    for (let level = 0; level < 3; level += 1) {
      expect(elementSizeFactor(level, 4) / elementSizeFactor(level + 1, 4)).toBe(2);
    }
  });

  it("层级无关（null / undefined / 没生成区块）⇒ 恒为 1，行为与改动前完全一致", () => {
    expect(elementSizeFactor(null, 4)).toBe(1);
    expect(elementSizeFactor(undefined, 4)).toBe(1);
    expect(elementSizeFactor(3, 0)).toBe(1);
    expect(elementSizeFactor(null, 0)).toBe(1);
  });

  it("层级越界 ⇒ 并入最细一级（与 resolveElementLevel 同一口径）", () => {
    expect(elementSizeFactor(99, 4)).toBe(0.125);
    expect(elementSizeFactor(3, 2)).toBe(0.5);
    expect(elementSizeFactor(-5, 4)).toBe(1);
  });

  it("随层级单调不增，且恒为正（渲染层拿去乘宽高不会得到 0 或负）", () => {
    let prev = Infinity;
    for (let level = 0; level < 4; level += 1) {
      const f = elementSizeFactor(level, 4);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it("层级数 1 / 2 / 4 都成立：最粗一级因子恒为 1，最细一级 = 0.5^(n-1)", () => {
    expect(elementSizeFactor(0, 1)).toBe(1); // 只有一级（大陆）⇒ 不缩
    expect(elementSizeFactor(0, 2)).toBe(1);
    expect(elementSizeFactor(1, 2)).toBe(0.5); // 2 级时最细一级是"洲"
    expect(elementSizeFactor(0, 4)).toBe(1);
    expect(elementSizeFactor(3, 4)).toBe(0.125);
  });

  it("层级数非有限（NaN / Infinity）⇒ 按「层级无关」处理，不产生 NaN 尺寸", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const f = elementSizeFactor(3, bad);
      expect(f).toBe(1);
      expect(Number.isFinite(f)).toBe(true);
    }
  });
});

describe("polygonLongEdge：多边形的长边 = 包围盒长边", () => {
  it("横长取宽、竖长取高", () => {
    expect(
      polygonLongEdge([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 40 },
        { x: 0, y: 40 },
      ]),
    ).toBe(100);
    expect(
      polygonLongEdge([
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 90 },
        { x: 0, y: 90 },
      ]),
    ).toBe(90);
  });

  it("空多边形为 0", () => {
    expect(polygonLongEdge([])).toBe(0);
  });

  it("与顶点顺序、绕向无关（凸包算法换不来更多信息）", () => {
    const square = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
    ];
    expect(polygonLongEdge(square)).toBe(10);
    expect(polygonLongEdge([...square].reverse())).toBe(10);
  });

  it("混进 NaN / Infinity 顶点时只按有效顶点算（不让整块变成 NaN）", () => {
    const dirty = [
      { x: Number.NaN, y: 0 },
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: Number.POSITIVE_INFINITY },
      { x: 0, y: 10 },
    ];
    expect(polygonLongEdge(dirty)).toBe(40);
    // 全是脏顶点 ⇒ 0（调用方据此走兜底）
    expect(polygonLongEdge([{ x: Number.NaN, y: Number.NaN }])).toBe(0);
  });
});

describe("finestBlockLongEdge：按层级取低分位，不被退化碎块牵着走", () => {
  /** 造一批方块：long 依次为 100 / 90 / ... / 10（10 个） */
  const blocks = Array.from({ length: 10 }, (_, i) => ({
    level: 3,
    polygon: [
      { x: 0, y: 0 },
      { x: 100 - i * 10, y: 0 },
      { x: 100 - i * 10, y: 5 },
      { x: 0, y: 5 },
    ],
  }));

  it("只统计指定层级", () => {
    const mixed = [...blocks, { level: 2, polygon: [{ x: 0, y: 0 }, { x: 999, y: 0 }, { x: 999, y: 9 }] }];
    // 若把 level 2 也算进来，分位值会被 999 抬高 —— 这里必须看不到它
    expect(finestBlockLongEdge(mixed, 3, 0)).toBe(10);
    expect(finestBlockLongEdge(mixed, 2, 0)).toBe(999);
  });

  it("分位越低越贴近最小值；p05 明显高于 min（碎块讨论的量化依据）", () => {
    const min = finestBlockLongEdge(blocks, 3, 0);
    const p05 = finestBlockLongEdge(blocks, 3, 0.05);
    const p50 = finestBlockLongEdge(blocks, 3, 0.5);
    expect(min).toBe(10);
    // 10 个样本：p05 落在第 0~1 个之间（最近邻取点），必然 ≥ min
    expect(p05).toBeGreaterThanOrEqual(min);
    expect(p50).toBeGreaterThan(p05);
  });

  it("空集合返回 0（调用方据此退回旧公式）", () => {
    expect(finestBlockLongEdge([], 3)).toBe(0);
    expect(finestBlockLongEdge(blocks, 0)).toBe(0);
  });
});

/**
 * 缩放上限 =「最细一级的一块长边铺满画布短边」。
 *
 * 用户原话：「最小的单位尺寸太小了，根本无法添加几个要素，能不能将最小的单位的
 * 尺寸支持放大到全屏为止」。旧的 `scales[last] * fineIn` 只保证"读得清"，
 * 实测 8.89，而中位郡铺满 900px 短边需要 10~11 倍、p05 的郡需要 20 倍左右。
 */
describe("zoomLimitsForBlocks：按实际块大小反推上限", () => {
  const scales = naturalScales(COUNTS, BOUNDS); // [0.304, 0.609, 1.218, 2.223]
  const canvas = { width: 1024, height: 900 };
  const fitScale = (900 / 1024) * 0.8; // 1024 底图适配 1024×900 画布

  it("上限 = 让块长边铺满短边（含 15% 余量）所需的缩放", () => {
    const { max } = zoomLimitsForBlocks({
      scales,
      fitScale,
      finestBlockLong: 50,
      canvas,
    });
    // 900 × 1.15 / 50 = 20.7
    expect(max).toBeCloseTo((900 * ZOOM_FILL_OVERSCAN) / 50, 6);
    expect(max).toBeGreaterThan(zoomLimitsFor(scales).max); // 旧的 8.89
  });

  it("用短边而不是长边：块不该以溢出屏幕为代价「铺满」", () => {
    const wide = zoomLimitsForBlocks({
      scales,
      fitScale,
      finestBlockLong: 50,
      canvas: { width: 1600, height: 900 },
    });
    expect(wide.max).toBeCloseTo((900 * ZOOM_FILL_OVERSCAN) / 50, 6);
  });

  it("下限 = min(层级推出来的下限, 整图适配) —— 永远缩得回整图", () => {
    const { min } = zoomLimitsForBlocks({
      scales,
      fitScale,
      finestBlockLong: 50,
      canvas,
    });
    expect(min).toBe(Math.min(scales[0] * LOD_ZOOM_RANGE.coarseOut, fitScale));
    expect(min).toBeLessThanOrEqual(fitScale);
  });

  it("绝不比旧公式更小：2 级配置下上限不回归", () => {
    const twoLevels = scales.slice(0, 2); // [0.304, 0.609]
    const oldMax = zoomLimitsFor(twoLevels).max; // 0.609 × 4 = 2.44
    const { max } = zoomLimitsForBlocks({
      scales: twoLevels,
      fitScale,
      // 洲级块长边 ≈ 261（实测 p05，seed 42）
      finestBlockLong: 261,
      canvas,
    });
    // 反推值 900×1.15/261 = 3.97 > 2.44 —— 取大者
    expect(max).toBeGreaterThan(oldMax);
    // 反推值比旧公式小的情形（长边很大）也必须退回旧公式
    const huge = zoomLimitsForBlocks({
      scales: twoLevels,
      fitScale,
      finestBlockLong: 5000,
      canvas,
    });
    expect(huge.max).toBe(oldMax);
  });

  it("超碎块（远小于地板）：上限被硬顶 ZOOM_ABS_MAX 夹住 —— 这条守的是**硬顶**", () => {
    const sliver = zoomLimitsForBlocks({ scales, fitScale, finestBlockLong: 0.5, canvas });
    // 地板 8 世界单位 ⇒ 900×1.15/8 = 129 —— 再被硬顶夹住
    expect(sliver.max).toBe(ZOOM_ABS_MAX);
    expect(sliver.max).toBeLessThanOrEqual(ZOOM_ABS_MAX);
  });

  /**
   * 块长边地板（`ZOOM_MIN_BLOCK_LONG`）单独一条 —— 上一条用例**遮住了它**。
   *
   * 上一条里"有地板 129 → 夹到 40"和"没地板 2070 → 夹到 40"结果一模一样，
   * 所以删掉 `Math.max(ZOOM_MIN_BLOCK_LONG, …)` 它照样绿。这里换一组
   * 让**地板与硬顶不重叠**的数字：
   *
   *   画布 240×160（短边 160）、最细块长边 2（比地板 8 还小）
   *     有地板 ⇒ 160 × 1.15 ÷ 8  = 23   ← 在地板生效、离硬顶 40 还远
   *     没地板 ⇒ 160 × 1.15 ÷ 2  = 92   → 被硬顶夹成 40
   * 23 ≠ 40，于是"删掉地板"必然红；末尾再加一条 `max < ZOOM_ABS_MAX`，
   * 把"这条断言的是地板、不是硬顶"写进用例本身。
   */
  it("块长边地板 8 世界单位：地板先于硬顶生效，删掉地板这条必红", () => {
    const { max } = zoomLimitsForBlocks({
      scales,
      fitScale: 0.5,
      finestBlockLong: 2,
      canvas: { width: 240, height: 160 },
    });
    expect(max).toBeCloseTo((160 * ZOOM_FILL_OVERSCAN) / ZOOM_MIN_BLOCK_LONG, 6); // 23
    // 硬顶没参与 ⇒ 证明这里断言的是地板而不是硬顶
    expect(max).toBeLessThan(ZOOM_ABS_MAX);
  });

  it("画布还没量出来（0×0）时退回旧公式，不会把上限压成 0", () => {
    const { max } = zoomLimitsForBlocks({
      scales,
      fitScale,
      finestBlockLong: 50,
      canvas: { width: 0, height: 0 },
    });
    expect(max).toBe(zoomLimitsFor(scales).max);
  });

  it("没有块信息（finestBlockLong = 0）时同样退回旧公式", () => {
    const { max } = zoomLimitsForBlocks({
      scales,
      fitScale,
      finestBlockLong: 0,
      canvas,
    });
    expect(max).toBe(zoomLimitsFor(scales).max);
  });

  it("absMax 只能收紧、不能放宽到比旧公式更小", () => {
    const tight = zoomLimitsForBlocks({
      scales,
      fitScale,
      finestBlockLong: 50,
      canvas,
      absMax: 12,
    });
    expect(tight.max).toBe(12);
    // 传入一个比旧上限还小的 absMax ⇒ 仍以旧公式为地板（护栏 1 优先）
    const silly = zoomLimitsForBlocks({
      scales,
      fitScale,
      finestBlockLong: 50,
      canvas,
      absMax: 1,
    });
    expect(silly.max).toBe(zoomLimitsFor(scales).max);
  });

  it("上限随画布变大而变大（同一个郡在更大的窗口里要放得更大）", () => {
    const small = zoomLimitsForBlocks({
      scales,
      fitScale,
      finestBlockLong: 50,
      canvas: { width: 800, height: 600 },
    });
    const big = zoomLimitsForBlocks({
      scales,
      fitScale,
      finestBlockLong: 50,
      canvas: { width: 1600, height: 1200 },
    });
    expect(big.max).toBeGreaterThan(small.max);
  });

  /**
   * 外部数据的有限性校验（AGENTS §6.0）。
   *
   * 这些值任何一个是 `NaN` / `Infinity`，`Math.max/min` 都会把**上限**污染成
   * `NaN`，而 `zoomAt` 拿到 `NaN` 上限后每次缩放都会产出 `NaN` 视口 ——
   * 画面消失、滚轮失灵，且不抛异常。所以这里逐项钉「退化输入必须退回旧公式」。
   */
  describe("退化输入（NaN / Infinity / 负数）不得污染上限", () => {
    const finite = (v: number) => expect(Number.isFinite(v)).toBe(true);
    const oldMax = zoomLimitsFor(scales).max;

    it.each([
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["负数", -50],
      ["0", 0],
    ])("finestBlockLong = %s ⇒ 退回旧公式", (_label, value) => {
      const { min, max } = zoomLimitsForBlocks({
        scales,
        fitScale,
        finestBlockLong: value,
        canvas,
      });
      expect(max).toBe(oldMax);
      finite(max);
      finite(min);
      expect(min).toBeGreaterThan(0);
    });

    it.each([
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["负数", -100],
    ])("画布宽高都是 %s ⇒ 退回旧公式", (_label, value) => {
      const { max } = zoomLimitsForBlocks({
        scales,
        fitScale,
        finestBlockLong: 50,
        canvas: { width: value, height: value },
      });
      expect(max).toBe(oldMax);
      finite(max);
    });

    /**
     * 只量出一半的画布（宽 `Infinity`、高 900）**不得**被当成正常画布。
     *
     * `Math.min(Infinity, 900)` 会得出 900，反推出 20.7 —— 算术没错，但它把一次
     * 测量失败当成了正常输入。守卫的口径是"两个维度各自都必须有限且 > 0"，
     * 所以这里期望退回旧公式；现实中也不存在"半量出来的画布"。
     */
    it.each([
      ["宽", Number.POSITIVE_INFINITY, 900],
      ["高", 900, Number.POSITIVE_INFINITY],
    ])("画布宽高 = Infinity ⇒ 退回旧公式（%s 一边没量出来）", (_side, width, height) => {
      const { max } = zoomLimitsForBlocks({
        scales,
        fitScale,
        finestBlockLong: 50,
        canvas: { width, height },
      });
      expect(max).toBe(oldMax);
      finite(max);
    });

    it("absMax 非有限 / 非正 ⇒ 用默认硬顶（仍不小于旧公式）", () => {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
        const { max } = zoomLimitsForBlocks({
          scales,
          fitScale,
          finestBlockLong: 0.5,
          canvas,
          absMax: bad,
        });
        expect(max).toBe(ZOOM_ABS_MAX);
      }
    });

    it("scales 里混进 NaN / Infinity / 负数 ⇒ 忽略它们，结果与干净输入等价", () => {
      // 干净输入与脏输入必须由**同一个数组**派生：否则两边差的可能只是取整误差
      // （0.304 vs 0.30446…），断言的就不是"脏值被忽略"这件事了。
      // 脏值分别插在**首、中、尾**：`zoomLimitsFor` 只读首尾，插在中间就会漏测。
      const base = [...scales];
      const dirty = [...base];
      dirty.splice(0, 0, Number.NaN);
      dirty.splice(2, 0, Number.POSITIVE_INFINITY);
      dirty.push(-1);

      const clean = zoomLimitsForBlocks({ scales: base, fitScale, finestBlockLong: 50, canvas });
      const fromDirty = zoomLimitsForBlocks({
        scales: dirty,
        fitScale,
        finestBlockLong: 50,
        canvas,
      });
      expect(dirty.length).toBe(base.length + 3);
      expect(fromDirty.min).toBe(clean.min);
      expect(fromDirty.max).toBe(clean.max);
      finite(fromDirty.min);
      finite(fromDirty.max);
    });

    it("fitScale 非有限 ⇒ 下限退回层级公式（不会变成 NaN）", () => {
      const { min } = zoomLimitsForBlocks({
        scales,
        fitScale: Number.NaN,
        finestBlockLong: 50,
        canvas,
      });
      expect(min).toBe(scales[0] * LOD_ZOOM_RANGE.coarseOut);
      finite(min);
    });

    it("scales 全是脏值 ⇒ 落到 zoomLimitsFor([]) 的兜底区间，仍可用", () => {
      const { min, max } = zoomLimitsForBlocks({
        scales: [Number.NaN, Number.POSITIVE_INFINITY],
        fitScale,
        finestBlockLong: 50,
        canvas,
      });
      expect(Number.isFinite(min)).toBe(true);
      expect(Number.isFinite(max)).toBe(true);
      expect(max).toBeGreaterThan(min);
    });
  });
});

/* ───────────────── 嵌套子图 LOD（Phase 2） ───────────────── */

describe("submapEffectiveScale：父图缩放 × 子图贴合缩放", () => {
  it("等效缩放 = 两者相乘", () => {
    expect(submapEffectiveScale(0.8, 1.5)).toBeCloseTo(1.2, 12);
    expect(submapEffectiveScale(2, 0.5)).toBeCloseTo(1, 12);
  });

  it("任一入参非有限 ⇒ 退回 0（子图不可见，不产出 NaN）", () => {
    expect(submapEffectiveScale(Number.NaN, 1.5)).toBe(0);
    expect(submapEffectiveScale(0.8, Number.POSITIVE_INFINITY)).toBe(0);
    expect(submapEffectiveScale(0.8, -1)).toBe(0); // 负缩放无意义
  });
});

describe("submapEnterWeight：父图尺度下子图的渐入门控", () => {
  it("父图缩放远低于阈值 ⇒ 权重接近 0（只露绑定态轮廓）", () => {
    // enterScale = 1，父图 0.2：log2(0.2/1) = -2.32，带宽 0.5 → smoothstep 得 0
    expect(submapEnterWeight(0.2, 1)).toBe(0);
  });

  it("父图缩放远高于阈值 ⇒ 权重为 1（子图完全淡入）", () => {
    expect(submapEnterWeight(4, 1)).toBe(1);
  });

  it("阈值处权重 = 0.5（smoothstep 中点）", () => {
    expect(submapEnterWeight(1, 1)).toBeCloseTo(0.5, 6);
  });

  it("权重单调不减，且始终 ∈ [0,1]", () => {
    let prev = -1;
    for (let z = 0.05; z <= 20; z *= 1.2) {
      const w = submapEnterWeight(z, 1);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it("阈值非法（非有限 / 非正）⇒ 恒为 1（不退化成永不可见）", () => {
    expect(submapEnterWeight(1, 0)).toBe(1);
    expect(submapEnterWeight(1, Number.NaN)).toBe(1);
  });
});

describe("enterScaleForRegion：按区块屏幕长边反推渐入阈值", () => {
  it("阈值 = LOD_BLOCK_PX / 区块长边（长边越大阈值越小）", () => {
    expect(enterScaleForRegion(360)).toBeCloseTo(1, 12);
    expect(enterScaleForRegion(720)).toBeCloseTo(0.5, 12);
    expect(enterScaleForRegion(180)).toBeCloseTo(2, 12);
  });

  it("区块长边非法 / 非正 ⇒ Infinity（永不自动淡入）", () => {
    expect(enterScaleForRegion(0)).toBe(Infinity);
    expect(enterScaleForRegion(Number.NaN)).toBe(Infinity);
  });
});
