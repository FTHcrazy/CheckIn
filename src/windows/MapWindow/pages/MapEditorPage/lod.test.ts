import { describe, expect, it } from "vitest";
import {
  LOD_ALPHA_EPSILON,
  LOD_BAND_OCTAVES,
  LOD_BLOCK_PX,
  activeLevel,
  bandEdges,
  bandProgress,
  levelAlphas,
  levelBlockRadius,
  levelCountsOf,
  naturalScales,
  visibleLevels,
  zoomLimitsFor,
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
