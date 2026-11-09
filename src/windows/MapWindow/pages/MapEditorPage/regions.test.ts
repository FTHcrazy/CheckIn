import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REGION_SCHEMA,
  REGION_BORDER_ALPHA,
  REGION_BORDER_COLOR,
  REGION_BORDER_PX,
  REGION_FILL_ALPHA,
  REGION_INNER_SHADOW_ALPHA,
  REGION_INNER_SHADOW_COLOR,
  REGION_INNER_SHADOW_PASSES,
  REGION_INNER_SHADOW_PX,
  REGION_LEVEL_FILL_SCALE,
  REGION_LEVELS,
  REGION_LEVEL_COUNT_LIMITS,
  REGION_MAX_LEVELS,
  REGION_PALETTE_RGB,
  REGION_RIM_COLOR,
  REGION_RIM_PX,
  REGION_TOTAL_LIMIT,
  assignRegionColors,
  createRng,
  fbm,
  generateHierarchy,
  levelLabelOf,
  normalizeRegionSchema,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  regionBorderAlphaOf,
  regionFillAlphaOf,
  regionLevelScaleOf,
  regionSchemaOf,
  valueNoise,
  type MapRegion,
  type Point,
  type RegionBounds,
} from "./regions";
import { activeLevel, levelAlphas, naturalScales } from "./lod";

/**
 * 层级区块生成（国家 → 郡 → 城，2.40.0 起默认三级）单元测试。
 *
 * 这是纯函数模块，因此断言到**具体行为**而非"跑起来没报错"：
 *  - 确定性：同种子必须逐点一致（否则"重新生成"不可复现、测试也无法断言）
 *  - 树形结构：每级的 parentId 必须指向上一级，层级数/每级数量与请求一致
 *  - 完备性：兄弟块必须**无空洞地铺满父块**，且**互不重叠**
 *    （Voronoi + 半平面裁剪写错时最典型的失败就是留空洞或被裁歪的重叠区）
 *  - 归属正确：每个种子点必须落在它自己的区块内
 *  - **父子共享边界逐点重合**：这是整个层级引擎的核心不变式。子块的外轮廓
 *    必须是父块折线的**子折线**；一旦父子各按自己的振幅算一遍，交叉淡化时就会
 *    看到两条平行边界线在"重影"。这里用"端点都在父块边界上的子边，整条边也必须
 *    落在父块边界上"来直接兜住它。
 *  - 兄弟共享边恰好被使用两次：崎岖化若两侧各算各的，共享边就会退化成两条
 *    略有差异的折线（缝隙或重叠）。
 */

/** 与 BASE_IMAGE（1024×1024、原点居中）一致的世界范围 */
const BOUNDS: RegionBounds = { x: -512, y: -512, width: 1024, height: 1024 };

/** 默认三级：国家 12 / 郡 60 / 城 160，共 232 */
const DEFAULT_TOTAL = REGION_LEVELS.reduce((sum, l) => sum + l.count, 0);

/* ────────────────────────── 几何小工具 ────────────────────────── */

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / d2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** 点到多边形边界的最短距离（不分内外） */
function distToBoundary(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const d = distToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

/** 顶点是否贴在某条画框边上（容浮点误差） */
function onBoundsLine(p: Point): { left: boolean; right: boolean; top: boolean; bottom: boolean } {
  const eps = 1e-6;
  return {
    left: Math.abs(p.x - BOUNDS.x) < eps,
    right: Math.abs(p.x - (BOUNDS.x + BOUNDS.width)) < eps,
    top: Math.abs(p.y - BOUNDS.y) < eps,
    bottom: Math.abs(p.y - (BOUNDS.y + BOUNDS.height)) < eps,
  };
}

/** 无向边键：坐标四舍五入到 1e-6，抹掉两侧区块浮点末位的差异 */
function edgeKey(a: Point, b: Point): string {
  const r = (v: number) => (Math.round(v * 1e6) / 1e6).toString();
  const p = `${r(a.x)},${r(a.y)}`;
  const q = `${r(b.x)},${r(b.y)}`;
  return p < q ? `${p}|${q}` : `${q}|${p}`;
}

/** 线段 p1p2 与 p3p4 是否真正相交（不含仅共享端点） */
function segIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return (
    cross(p3, p4, p1) * cross(p3, p4, p2) < 0 && cross(p1, p2, p3) * cross(p1, p2, p4) < 0
  );
}

/** 多边形自交的边对数 */
function selfIntersectionCount(poly: Point[]): number {
  const n = poly.length;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // 相邻边共享端点，不算自交
      if ((j + 1) % n === i || (i + 1) % n === j) continue;
      if (segIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) count += 1;
    }
  }
  return count;
}

/** 凸包（Andrew monotone chain），用于度量"边界有多不直" */
function convexHull(pts: Point[]): Point[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (seq: Point[]) => {
    const out: Point[] = [];
    for (const q of seq) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return build(p).concat(build([...p].reverse()));
}

/** 按 parentId 把区块分组 */
function childrenOf(all: MapRegion[], parentId: string): MapRegion[] {
  return all.filter((r) => r.parentId === parentId);
}

/* ────────────────────────────── 噪声 ────────────────────────────── */

describe("createRng", () => {
  it("同种子产出同序列，不同种子产出不同序列", () => {
    const a = createRng(123);
    const b = createRng(123);
    const c = createRng(124);

    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    const seqC = [c(), c(), c(), c(), c()];

    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it("输出落在 [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("valueNoise / fbm", () => {
  it("同输入同输出，输出落在 [0, 1)", () => {
    for (let i = 0; i < 200; i += 1) {
      const x = i * 0.37 - 40;
      const y = i * -0.91 + 15;
      expect(valueNoise(x, y, 99)).toBe(valueNoise(x, y, 99));
      expect(valueNoise(x, y, 99)).toBeGreaterThanOrEqual(0);
      expect(valueNoise(x, y, 99)).toBeLessThan(1);
      expect(fbm(x, y, 99)).toBe(fbm(x, y, 99));
      expect(fbm(x, y, 99)).toBeGreaterThanOrEqual(0);
      expect(fbm(x, y, 99)).toBeLessThan(1);
    }
  });

  it("是位置的连续函数 —— 相邻采样点不会突变", () => {
    // 边界"两侧严丝合缝"依赖这条性质：同一点必须得到同一个位移
    let maxJump = 0;
    for (let i = 0; i < 500; i += 1) {
      const x = i * 0.013;
      maxJump = Math.max(maxJump, Math.abs(fbm(x, 3.1, 5) - fbm(x + 1e-6, 3.1, 5)));
    }
    expect(maxJump).toBeLessThan(1e-4);
  });

  it("在区块尺度上确实起伏（不是常数场）", () => {
    const vals: number[] = [];
    for (let i = 0; i < 60; i += 1) vals.push(fbm(i * 0.31, i * 0.17, 2026));
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.15);
  });
});

/* ─────────────────────────── 树形结构 ─────────────────────────── */

describe("generateHierarchy：树形结构", () => {
  it("默认四级，每级数量与 REGION_LEVELS 一致", () => {
    const all = generateHierarchy({ seed: 20261009, bounds: BOUNDS });
    expect(all).toHaveLength(DEFAULT_TOTAL);
    REGION_LEVELS.forEach((lvl, level) => {
      expect(all.filter((r) => r.level === level)).toHaveLength(lvl.count);
    });
  });

  it("父级引用构成一棵完整的树：每级的父都指向上一级", () => {
    const all = generateHierarchy({ seed: 4242, bounds: BOUNDS });
    const byId = new Map(all.map((r) => [r.id, r]));
    for (const r of all) {
      if (r.level === 0) {
        expect(r.parentId).toBeNull();
        continue;
      }
      expect(r.parentId).not.toBeNull();
      const parent = byId.get(r.parentId as string);
      expect(parent).toBeDefined();
      expect(parent?.level).toBe(r.level - 1);
    }
  });

  it("每一级都恰好切分上一级的全部区块（没有父块被漏掉）", () => {
    const all = generateHierarchy({ seed: 31337, bounds: BOUNDS });
    for (let level = 1; level < REGION_LEVELS.length; level += 1) {
      const parents = all.filter((r) => r.level === level - 1);
      for (const parent of parents) {
        expect(childrenOf(all, parent.id).length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("层级数可配（1 ~ 4 级）", () => {
    for (let depth = 1; depth <= REGION_LEVEL_COUNT_LIMITS.max; depth += 1) {
      const counts = REGION_LEVELS.slice(0, depth).map((l) => l.count);
      const all = generateHierarchy({ seed: 5, bounds: BOUNDS, levelCounts: counts });
      expect(all.filter((r) => r.level === depth - 1).length).toBeGreaterThan(0);
      expect(Math.max(...all.map((r) => r.level))).toBe(depth - 1);
    }
  });

  it("只用 3 级时不产生第 4 级，且数量仍然对得上", () => {
    const counts = [3, 12, 48];
    const all = generateHierarchy({ seed: 99, bounds: BOUNDS, levelCounts: counts });
    expect(all).toHaveLength(3 + 12 + 48);
    expect(all.some((r) => r.level === 3)).toBe(false);
  });

  it("id 全局唯一，name 不重复", () => {
    const all = generateHierarchy({ seed: 8, bounds: BOUNDS });
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(new Set(all.map((r) => r.name)).size).toBe(all.length);
  });

  it("name 带层级前缀，肉眼可读", () => {
    const all = generateHierarchy({ seed: 8, bounds: BOUNDS });
    for (const r of all) {
      expect(r.name.startsWith(REGION_LEVELS[r.level].label)).toBe(true);
    }
  });

  it("每个区块都有可用的填充色与正整数层级", () => {
    const all = generateHierarchy({ seed: 8, bounds: BOUNDS });
    for (const r of all) {
      expect(Number.isInteger(r.color)).toBe(true);
      expect(r.color).toBeGreaterThanOrEqual(0);
      expect(r.color).toBeLessThanOrEqual(0xffffff);
      expect(Number.isInteger(r.level)).toBe(true);
      expect(r.level).toBeGreaterThanOrEqual(0);
    }
  });

  it("总数不超过 REGION_TOTAL_LIMIT（护栏生效）", () => {
    const all = generateHierarchy({
      seed: 3,
      bounds: BOUNDS,
      levelCounts: [200, 400, 800, 1600],
    });
    expect(all.length).toBeLessThanOrEqual(REGION_TOTAL_LIMIT);
  });

  it("退化输入返回空数组而非抛错", () => {
    expect(generateHierarchy({ seed: 1, bounds: BOUNDS, levelCounts: [] })).toEqual([]);
    expect(generateHierarchy({ seed: 1, bounds: BOUNDS, levelCounts: [0] })).toEqual([]);
    expect(generateHierarchy({ seed: 1, bounds: BOUNDS, levelCounts: [3, -1] })).toEqual([]);
    expect(
      generateHierarchy({ seed: 1, bounds: { x: 0, y: 0, width: 0, height: 100 } }),
    ).toEqual([]);
  });
});

/* ─────────────────────────── 确定性 ─────────────────────────── */

describe("generateHierarchy：确定性", () => {
  it("同种子两次生成逐点完全一致", () => {
    const a = generateHierarchy({ seed: 20261009, bounds: BOUNDS });
    const b = generateHierarchy({ seed: 20261009, bounds: BOUNDS });
    expect(b).toEqual(a);
  });

  it("不同种子产出不同划分", () => {
    const a = generateHierarchy({ seed: 1, bounds: BOUNDS });
    const b = generateHierarchy({ seed: 2, bounds: BOUNDS });
    expect(a.map((r) => r.polygon)).not.toEqual(b.map((r) => r.polygon));
  });

  it("地图尺寸只影响坐标、不影响拓扑（同种子下父子关系一致）", () => {
    const a = generateHierarchy({ seed: 77, bounds: BOUNDS });
    const b = generateHierarchy({
      seed: 77,
      bounds: { x: 0, y: 0, width: 2048, height: 2048 },
    });
    const shape = (all: MapRegion[]) =>
      all.map((r) => `${r.level}:${r.level === 0 ? "-" : "child"}`).join(",");
    expect(shape(a)).toBe(shape(b));
    expect(a.map((r) => r.level)).toEqual(b.map((r) => r.level));
  });
});

/* ───────────────────── 完备性 / 不重叠 / 归属 ───────────────────── */

describe("generateHierarchy：铺满父块且互不重叠", () => {
  const SEED = 20261009;

  it("每个子块的所有顶点都落在父块的闭区域内（允许贴边）", () => {
    // 贴边的顶点被射线法判为"外"，因此判定口径是"到父块边界的距离"：
    // 只要距离为 0 就是贴着边界，属于正常。真正的越界另有专门用例把关。
    const all = generateHierarchy({ seed: SEED, bounds: BOUNDS });
    for (const r of all) {
      if (r.parentId === null) continue;
      const parent = all.find((x) => x.id === r.parentId) as MapRegion;
      for (const p of r.polygon) {
        if (pointInPolygon(p, parent.polygon)) continue;
        expect(distToBoundary(p, parent.polygon)).toBeLessThan(1e-6);
      }
    }
  });

  it("兄弟块无空洞地铺满父块：网格采样落点必须恰好属于一个子块", () => {
    const all = generateHierarchy({ seed: SEED, bounds: BOUNDS, levelCounts: [2, 6, 12] });
    const STEPS = 40;
    for (const parent of all.filter((r) => r.level < 2)) {
      const kids = childrenOf(all, parent.id);
      if (kids.length === 0) continue;
      const xs = parent.polygon.map((p) => p.x);
      const ys = parent.polygon.map((p) => p.y);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      let checked = 0;
      let holes = 0;
      let overlaps = 0;
      for (let iy = 0; iy < STEPS; iy += 1) {
        for (let ix = 0; ix < STEPS; ix += 1) {
          const probe = {
            x: x0 + ((ix + 0.5) / STEPS) * (x1 - x0),
            y: y0 + ((iy + 0.5) / STEPS) * (y1 - y0),
          };
          if (!pointInPolygon(probe, parent.polygon)) continue;
          checked += 1;
          const hits = kids.filter((k) => pointInPolygon(probe, k.polygon)).length;
          if (hits === 0) holes += 1;
          if (hits > 1) overlaps += 1;
        }
      }
      expect(checked).toBeGreaterThan(50);
      // 采样点可能恰好落在共享边界上（两侧都判"内"），放过极小比例
      expect(holes / checked).toBeLessThan(0.005);
      expect(overlaps / checked).toBeLessThan(0.01);
    }
  });

  it("子块面积之和等于父块面积", () => {
    const all = generateHierarchy({ seed: SEED, bounds: BOUNDS });
    for (const parent of all.filter((r) => r.level < REGION_LEVELS.length - 1)) {
      const kids = childrenOf(all, parent.id);
      if (kids.length === 0) continue;
      const sum = kids.reduce((acc, k) => acc + polygonArea(k.polygon), 0);
      const own = polygonArea(parent.polygon);
      expect(sum / own).toBeCloseTo(1, 2);
    }
  });

  it("每个种子点落在它自己的区块内", () => {
    // 崎岖化会把边界往里"啃"；振幅按"边到本区块种子点的距离"封顶后这条必须仍然成立
    for (const seed of [20261009, 777, 31415926]) {
      const all = generateHierarchy({ seed, bounds: BOUNDS });
      for (const r of all) {
        expect(pointInPolygon(r.seed, r.polygon)).toBe(true);
      }
    }
  });

  it("同一父块下没有两个种子重合（重合会生成完全相同的子块）", () => {
    for (const seed of [1, 777, 123456, 20261009]) {
      const all = generateHierarchy({ seed, bounds: BOUNDS });
      for (const parent of all) {
        const kids = childrenOf(all, parent.id);
        for (let i = 0; i < kids.length; i += 1) {
          for (let j = i + 1; j < kids.length; j += 1) {
            const d = Math.hypot(kids[i].seed.x - kids[j].seed.x, kids[i].seed.y - kids[j].seed.y);
            expect(d).toBeGreaterThan(0.5);
          }
        }
      }
    }
  });

  it("所有顶点都在地图范围内", () => {
    const all = generateHierarchy({ seed: 606, bounds: BOUNDS });
    for (const r of all) {
      expect(r.polygon.length).toBeGreaterThanOrEqual(3);
      for (const p of r.polygon) {
        expect(p.x).toBeGreaterThanOrEqual(BOUNDS.x - 1e-6);
        expect(p.x).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.width + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(BOUNDS.y - 1e-6);
        expect(p.y).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.height + 1e-6);
      }
    }
  });
});

/* ─────────────────── 父子共享边界（核心不变式） ─────────────────── */

describe("generateHierarchy：父子共享边界逐点重合", () => {
  const SEEDS = [20261009, 777, 4242, 65535];

  it("端点都在父块边界上的子边，整条边也必须落在父块边界上", () => {
    // 这是"子块外轮廓 = 父块折线的子折线"的可测形式。若父子各按自己的振幅算一遍，
    // 这条会立刻失败（子边会以弦的形式切进父块内部，或鼓到父块外面）。
    // 【2.42.0】产品层面区域只有国家一级，但生成引擎的层级能力仍在（嵌套子图
    // 与几何不变式都用它）—— 这里显式传多级 levelCounts 来钉住这条不变式。
    const MULTI_LEVEL_COUNTS = [12, 60, 160];
    for (const seed of SEEDS) {
      const all = generateHierarchy({ seed, bounds: BOUNDS, levelCounts: MULTI_LEVEL_COUNTS });
      let inheritedEdges = 0;
      for (const r of all) {
        if (r.parentId === null) continue;
        const parent = all.find((x) => x.id === r.parentId) as MapRegion;
        const n = r.polygon.length;
        for (let i = 0; i < n; i += 1) {
          const a = r.polygon[i];
          const b = r.polygon[(i + 1) % n];
          if (pointInPolygon(a, parent.polygon) || pointInPolygon(b, parent.polygon)) continue;
          if (distToBoundary(a, parent.polygon) > 1e-6) continue;
          if (distToBoundary(b, parent.polygon) > 1e-6) continue;
          inheritedEdges += 1;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          expect(distToBoundary(mid, parent.polygon)).toBeLessThan(1e-6);
        }
      }
      // 每一级都应当继承大量父级边界折线，否则这条断言就是空转
      expect(inheritedEdges).toBeGreaterThan(2000);
    }
  });

  it("子块边界上的每一段都是父块折线的子段（不存在只有子块才有的边界）", () => {
    const all = generateHierarchy({ seed: 20261009, bounds: BOUNDS });
    // 父块折线上的每个顶点，都必须被它的某个子块原样复用（容浮点末位）
    // —— 这正是"继承而非重算"的直接证据。
    const EPS = 1e-6;
    for (const parent of all.filter((r) => r.level < REGION_LEVELS.length - 1)) {
      const kids = childrenOf(all, parent.id);
      if (kids.length === 0) continue;
      let reused = 0;
      for (const p of parent.polygon) {
        const hit = kids.some((k) =>
          k.polygon.some((q) => Math.abs(q.x - p.x) < EPS && Math.abs(q.y - p.y) < EPS),
        );
        if (hit) reused += 1;
      }
      expect(reused).toBe(parent.polygon.length);
    }
  });

  it("兄弟之间共享的边恰好被使用两次", () => {
    // 在**一个父块内部**统计：子块两两之间的边界必须被两侧各记一次。
    // 父块自己的外边界（与隔壁父块的子块共享，或落在画框上）在本组里只会被
    // 记到一次 —— 那是正常的，所以要先把它排除掉。
    for (const seed of SEEDS) {
      const all = generateHierarchy({ seed, bounds: BOUNDS });
      for (const parent of all.filter((r) => r.level < REGION_LEVELS.length - 1)) {
        const kids = childrenOf(all, parent.id);
        if (kids.length === 0) continue;
        const usage = new Map<string, number>();
        for (const k of kids) {
          for (let i = 0; i < k.polygon.length; i += 1) {
            const a = k.polygon[i];
            const b = k.polygon[(i + 1) % k.polygon.length];
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            // 落在父块边界上的边属于"外轮廓"，不参与兄弟共享统计
            if (distToBoundary(mid, parent.polygon) < 1e-6) continue;
            const key = edgeKey(a, b);
            usage.set(key, (usage.get(key) ?? 0) + 1);
          }
        }
        const bad = [...usage.entries()].filter(([, v]) => v !== 2);
        expect(bad).toEqual([]);
      }
    }
  });
});

/* ─────────────────────────── 崎岖边界 ─────────────────────────── */

describe("generateHierarchy：崎岖边界", () => {
  it("边界不再是直线：顶点被大量细分", () => {
    // 直边 Voronoi 单元只有 4~8 个顶点；崎岖化后每条边被切成多段
    const all = generateHierarchy({ seed: 20261009, bounds: BOUNDS, levelCounts: [4, 16] });
    for (const r of all) {
      expect(r.polygon.length).toBeGreaterThanOrEqual(12);
    }
  });

  it("边界不再笔直：绝大多数区块不是凸多边形", () => {
    const all = generateHierarchy({ seed: 2468, bounds: BOUNDS, levelCounts: [6, 24] });
    const nonConvex = all.filter(
      (r) => 1 - polygonArea(r.polygon) / polygonArea(convexHull(r.polygon)) > 0.01,
    );
    expect(nonConvex.length).toBeGreaterThanOrEqual(Math.floor(all.length * 0.8));
  });

  it("画框边保持笔直：同一区块在一条边框上至多只有两个端点", () => {
    // 画框是地图的边，不是区块之间的边界 —— 它不该被崎岖化
    for (const seed of [20261009, 777]) {
      const all = generateHierarchy({ seed, bounds: BOUNDS });
      for (const r of all) {
        const tally = { left: 0, right: 0, top: 0, bottom: 0 };
        for (const p of r.polygon) {
          const o = onBoundsLine(p);
          if (o.left) tally.left += 1;
          if (o.right) tally.right += 1;
          if (o.top) tally.top += 1;
          if (o.bottom) tally.bottom += 1;
        }
        expect(Math.max(tally.left, tally.right, tally.top, tally.bottom)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("默认种子下四级多边形互不自交", () => {
    const all = generateHierarchy({ seed: 20261009, bounds: BOUNDS });
    const bad = all.filter((r) => selfIntersectionCount(r.polygon) > 0);
    expect(bad.map((r) => r.name)).toEqual([]);
  });

  it("多种子下自交与越界都只占极小比例（已知残余，见 regions.ts 模块头）", () => {
    // 子块的 Voronoi 单元在父块的**基线**（凸）上切，而父块的**显示**多边形会因
    // 继承更粗一级的曲线而向内凹出"湾"；单元中连接两个湾外顶点的直边仍可能横穿湾。
    // 实测 24 种子 × 四级共 5352 块：自交 0.09%、有顶点越界的区块 0.6%，
    // 最大越出约 3 世界单位（地图宽 0.3%）。这里把"不退化"钉住：
    const SEEDS_LOCAL = [11, 777, 4242, 65535, 20261009, 31415926];
    let total = 0;
    let selfCross = 0;
    let outRegions = 0;
    let maxOut = 0;
    for (const seed of SEEDS_LOCAL) {
      const all = generateHierarchy({ seed, bounds: BOUNDS });
      total += all.length;
      for (const r of all) {
        if (selfIntersectionCount(r.polygon) > 0) selfCross += 1;
        if (r.parentId === null) continue;
        const parent = all.find((x) => x.id === r.parentId) as MapRegion;
        let out = false;
        for (const p of r.polygon) {
          if (pointInPolygon(p, parent.polygon)) continue;
          const d = distToBoundary(p, parent.polygon);
          if (d > 1e-6) {
            out = true;
            maxOut = Math.max(maxOut, d);
          }
        }
        if (out) outRegions += 1;
      }
    }
    expect(selfCross / total).toBeLessThan(0.01);
    expect(outRegions / total).toBeLessThan(0.02);
    expect(maxOut).toBeLessThan(6);
  });

  it("区块大小不再均匀（域扭曲使疏密相间）", () => {
    const all = generateHierarchy({ seed: 606, bounds: BOUNDS, levelCounts: [4, 20] });
    const areas = all.map((r) => polygonArea(r.polygon));
    expect(Math.max(...areas) / Math.min(...areas)).toBeGreaterThan(1.5);
  });

  it("最细一级不会出现塌缩：单个子块面积不超过父块的九成", () => {
    // 种子若被内缩要求挤到质心重叠，子块的 Voronoi 单元会退化成整个父块
    const all = generateHierarchy({ seed: 123456, bounds: BOUNDS });
    for (const parent of all.filter((r) => r.level === 2)) {
      const kids = childrenOf(all, parent.id);
      const own = polygonArea(parent.polygon);
      for (const k of kids) {
        expect(polygonArea(k.polygon) / own).toBeLessThan(0.9);
      }
    }
  });
});

/* ─────────────────────────── 基础几何 ─────────────────────────── */

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("区分内外", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: 5, y: -1 }, square)).toBe(false);
  });
});

describe("polygonCentroid / polygonArea", () => {
  it("正方形的质心即其中心，面积正确", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const c = polygonCentroid(square);
    expect(c.x).toBeCloseTo(5, 6);
    expect(c.y).toBeCloseTo(5, 6);
    expect(polygonArea(square)).toBeCloseTo(100, 6);
  });

  it("逆序顶点面积不变（取绝对值）", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ];
    expect(polygonArea(square)).toBeCloseTo(100, 6);
  });

  it("退化多边形不抛错", () => {
    expect(polygonCentroid([])).toEqual({ x: 0, y: 0 });
    expect(polygonCentroid([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
    expect(polygonArea([])).toBe(0);
  });
});

/* ─────────────────── 层级定义（RegionLevelDef / schema） ─────────────────── */

/**
 * 【这一组是"改前逐字节一致"的可执行证明】
 *
 * R-REG-01 把硬编码的 `REGION_LEVELS` 换成文档级 `regionSchema`，而老文档不写这个
 * 字段、读时回落默认值。于是"渲染与生成结果与改前逐字节一致"必须能被断言，
 * 否则无法区分"回落正确"与"回落时悄悄改了默认值"。
 */
describe("DEFAULT_REGION_SCHEMA：与 REGION_LEVELS 逐项等价", () => {
  it("长度 1（只有国家）、[0].name === 国家、[0].count === 12（2.42.0 关闭层级）", () => {
    expect(DEFAULT_REGION_SCHEMA).toHaveLength(1);
    expect(DEFAULT_REGION_SCHEMA).toHaveLength(REGION_MAX_LEVELS);
    expect(DEFAULT_REGION_SCHEMA[0].name).toBe("国家");
    expect(DEFAULT_REGION_SCHEMA[0].count).toBe(REGION_LEVELS[0].count);
  });

  it("generateHierarchy：不传 schema 与显式传 DEFAULT_REGION_SCHEMA 产出完全相等", () => {
    // `toEqual` 递归比较全部顶点浮点值 —— 这是"逐字节一致"在本项目里的可执行版本
    const implicit = generateHierarchy({ seed: 42, bounds: BOUNDS });
    const explicit = generateHierarchy({
      seed: 42,
      bounds: BOUNDS,
      schema: DEFAULT_REGION_SCHEMA,
    });
    expect(explicit).toEqual(implicit);
  });

  it("自定义 schema 只改名字，不改几何、id 与数量", () => {
    const schema = [
      { name: "界", count: 20 },
      { name: "域", count: 60 },
      { name: "坊", count: 160 },
    ];
    const base = generateHierarchy({ seed: 42, bounds: BOUNDS });
    const named = generateHierarchy({ seed: 42, bounds: BOUNDS, schema });

    expect(named.map((r) => r.id)).toEqual(base.map((r) => r.id));
    expect(named.map((r) => r.polygon)).toEqual(base.map((r) => r.polygon));
    expect(named.map((r) => r.color)).toEqual(base.map((r) => r.color));
    for (const r of named) {
      expect(r.name.startsWith(schema[r.level].name)).toBe(true);
    }
  });
});

describe("normalizeRegionSchema：脏 schema 必须被挡住", () => {
  it("null / [] / 5 项 / count:0 / count:NaN / name:123 一律返回 null", () => {
    expect(normalizeRegionSchema(null)).toBeNull();
    expect(normalizeRegionSchema(undefined)).toBeNull();
    expect(normalizeRegionSchema("nope")).toBeNull();
    expect(normalizeRegionSchema([])).toBeNull();
    expect(
      normalizeRegionSchema([
        { name: "a", count: 1 },
        { name: "b", count: 1 },
        { name: "c", count: 1 },
        { name: "d", count: 1 },
        { name: "e", count: 1 },
      ]),
    ).toBeNull();
    expect(normalizeRegionSchema([{ name: "a", count: 0 }])).toBeNull();
    expect(normalizeRegionSchema([{ name: "a", count: Number.NaN }])).toBeNull();
    expect(normalizeRegionSchema([{ name: "a", count: 1.5 }])).toBeNull();
    expect(normalizeRegionSchema([{ name: 123, count: 3 }])).toBeNull();
    expect(normalizeRegionSchema([{ count: 3 }])).toBeNull();
  });

  it("合法 1 项返回等值新数组（空 name 合法，读时回落 L{n}）", () => {
    const raw = [{ name: "国", count: 9 }];
    const out = normalizeRegionSchema(raw);
    expect(out).toEqual(raw);
    // ⚠️ 必须是新数组 / 新对象：调用方持有它之后，外部再改入参不得影响文档
    expect(out).not.toBe(raw);
    expect(out?.[0]).not.toBe(raw[0]);
  });

  it("多项 schema（2.42.0 关闭层级前的老数据）判非法返回 null", () => {
    expect(
      normalizeRegionSchema([
        { name: "国家", count: 12 },
        { name: "郡", count: 60 },
      ]),
    ).toBeNull();
    expect(
      normalizeRegionSchema([
        { name: "国家", count: 12 },
        { name: "郡", count: 60 },
        { name: "城", count: 160 },
      ]),
    ).toBeNull();
  });
});

describe("regionSchemaOf / levelLabelOf：读时回落的唯一出口", () => {
  it("缺失 / 非法 ⇒ DEFAULT_REGION_SCHEMA（同一份引用，不每次新数组）", () => {
    expect(regionSchemaOf(null)).toBe(DEFAULT_REGION_SCHEMA);
    expect(regionSchemaOf(undefined)).toBe(DEFAULT_REGION_SCHEMA);
    expect(regionSchemaOf({})).toBe(DEFAULT_REGION_SCHEMA);
    expect(regionSchemaOf({ regionSchema: [] })).toBe(DEFAULT_REGION_SCHEMA);
    expect(regionSchemaOf({ regionSchema: [{ name: "a", count: 0 }] })).toBe(
      DEFAULT_REGION_SCHEMA,
    );
    // 合法则用文档里那一份（子图继承同理）；2.42.0 起只有 1 项合法
    const own = [{ name: "国", count: 9 }];
    expect(regionSchemaOf({ regionSchema: own })).toEqual(own);
  });

  it("levelLabelOf：越界 / 空名回落 L{n+1}，不抛错也不留空段", () => {
    expect(levelLabelOf(DEFAULT_REGION_SCHEMA, 0)).toBe("国家");
    // 层级已关闭（只有国家一级）：越界一律回落 L{n+1}
    expect(levelLabelOf(DEFAULT_REGION_SCHEMA, 2)).toBe("L3");
    expect(levelLabelOf(DEFAULT_REGION_SCHEMA, 3)).toBe("L4");
    expect(levelLabelOf(DEFAULT_REGION_SCHEMA, 9)).toBe("L10");
    expect(levelLabelOf(DEFAULT_REGION_SCHEMA, -1)).toBe("L1");
    expect(levelLabelOf([{ name: "   ", count: 1 }], 0)).toBe("L1");
    expect(levelLabelOf(undefined, 2)).toBe("L3");
  });
});

/* ─────────────── 静态层次衰减（观感批次 D · P2-2） ─────────────── */

/**
 * `REGION_LEVEL_FILL_SCALE` 是**与视口无关的静态层次系数**，与 `lod.ts` 的
 * `levelAlphas`（缩放驱动的 LOD 权重，帽函数 Σα≡1、已写进容器 alpha）正交：
 * 再乘 levelAlphas 就是双重衰减（当前活跃层级被压淡，「线比面还淡」换个方向
 * 复发）。勘误口径的验收 =「同一视口下各级填充 alpha 按 level 单调递减 +
 * 边界面同步衰减」—— 钉静态系数表本身，不钉某组 levelAlphas 下的绝对值。
 */
describe("REGION_LEVEL_FILL_SCALE · 静态层次衰减（P2-2）", () => {
  it("2.42.0 起只有国家一级：表退化为 [1]，无层次衰减", () => {
    expect(REGION_LEVEL_FILL_SCALE).toEqual([1]);
    expect(REGION_LEVEL_FILL_SCALE.length).toBe(REGION_MAX_LEVELS);
    expect(REGION_LEVEL_FILL_SCALE[0]).toBe(1);
  });

  it("regionLevelScaleOf：表内取值，越界 / 非有限回落 1（朝『不衰减』兜底）", () => {
    expect(regionLevelScaleOf(0)).toBe(REGION_LEVEL_FILL_SCALE[0]);
    // 越界（老文档的 level>0 区块）一律回落 1 —— 与国家同浓
    expect(regionLevelScaleOf(1)).toBe(1);
    expect(regionLevelScaleOf(3)).toBe(1);
    expect(regionLevelScaleOf(-1)).toBe(1);
    expect(regionLevelScaleOf(REGION_LEVEL_FILL_SCALE.length)).toBe(1);
    expect(regionLevelScaleOf(Number.NaN)).toBe(1);
  });

  it("regionLevelScaleOf：小数 level 取 Math.trunc（0.99 → 落 0 档）", () => {
    expect(regionLevelScaleOf(0.99)).toBe(REGION_LEVEL_FILL_SCALE[0]);
    expect(regionLevelScaleOf(1.9)).toBe(1);
  });

  it("填充与边界共用同一张表：任一层级的『边界 : 填充』浓度比恒等", () => {
    // 「边界面一起调」的执行点：比值漂移 = 线与面的视觉关系漂移
    for (let level = 0; level < REGION_MAX_LEVELS; level++) {
      expect(regionBorderAlphaOf(level) / regionFillAlphaOf(level)).toBeCloseTo(
        REGION_BORDER_ALPHA / REGION_FILL_ALPHA,
        12,
      );
    }
  });

  /**
   * 渲染落点守卫（源码型，正则容忍排版换行）：主图与子图两处区块填充/边界
   * 都必须走这对助手 —— 有人回退成裸常量（只乘一边或都不乘）时这里变红。
   */
  it("渲染落点守卫：主图与子图的填充/边界 alpha 都走 regionXxxAlphaOf", () => {
    // cwd 相对路径（同 render-stack-guard 的做法；fs shim 不认 URL 对象）
    const sources = ["components/MapCanvas/index.tsx", "components/MapCanvas/submapRender.ts"].map(
      (rel) =>
        readFileSync(
          path.resolve(process.cwd(), "src/windows/MapWindow/pages/MapEditorPage", rel),
          "utf8",
        ).replace(/\r\n/g, "\n"),
    );
    for (const src of sources) {
      expect(src).toMatch(/regionFillAlphaOf\(/);
      expect(src).toMatch(/regionBorderAlphaOf\(/);
      // 裸常量直填 alpha = "只乘一边或都不乘"的回退形态，一律不许回来
      expect(src).not.toMatch(/alpha:\s*REGION_FILL_ALPHA/);
      expect(src).not.toMatch(/alpha:\s*REGION_BORDER_ALPHA/);
    }
  });
});

/* ─────── 区块样式与密度：对齐逆向源码 §3.7（α 0.30 / 3px / #73562d） ─────── */

/**
 * 逆向源码的区块样式是 `{ alpha: 0.3, border_size: 3, border_color: "#73562d",
 * border_alpha: 1 }`（`decoded.js@131642`）。本项目 2.27.0 走的是**反方向**
 * （把 alpha 压到 0.10），代价正是"读不出分块、陆地一片单色"。
 *
 * 下面这组守卫刻意分成两层：
 *   · 数字层 —— 三个值就是源值，改回去要显式承认；
 *   · 效果层 —— "陆地不再是单色""同一时刻只有一级可辨识""全图视角 ≤20 块"。
 *     只钉数字的话，有人为了调观感去动 `LOD_BLOCK_PX` 或色表时，测试全绿而
 *     画面已经退回原样；效果断言先红，才能拦住那条路。
 */
describe("区块样式与密度（对齐逆向 §3.7 口径）", () => {
  const MAP: RegionBounds = { x: 0, y: 0, width: 1024, height: 1024 };
  const COUNTS = REGION_LEVELS.map((l) => l.count);

  /** `color` 以 `alpha` 合成到纸色 `base` 上（与 Pixi 的普通 alpha 混合同式） */
  const composite = (color: number, alpha: number, base = 0xc8bd9d): [number, number, number] => {
    const br = (base >> 16) & 255;
    const bg = (base >> 8) & 255;
    const bb = base & 255;
    return [
      ((color >> 16) & 255) * alpha + br * (1 - alpha),
      ((color >> 8) & 255) * alpha + bg * (1 - alpha),
      (color & 255) * alpha + bb * (1 - alpha),
    ];
  };
  const rgbDist = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  /**
   * 同级区块的相邻对（共享一条边即相邻）—— **独立实现**。
   *
   * 【为什么不 import 生成器里的邻接表】那会变成"用被测实现验证被测实现"：邻接
   * 判据写错时两边一起错，测试照绿。这里用最短的方式重算一遍（端点归一到 1/100，
   * 与渲染层的共享边去重同口径）。
   */
  const adjacentPairs = (pool: readonly MapRegion[]): Array<[number, number]> => {
    const key = (a: Point, b: Point): string => {
      const ax = Math.round(a.x * 100);
      const ay = Math.round(a.y * 100);
      const bx = Math.round(b.x * 100);
      const by = Math.round(b.y * 100);
      return ax < bx || (ax === bx && ay <= by)
        ? `${ax},${ay}|${bx},${by}`
        : `${bx},${by}|${ax},${ay}`;
    };
    const byEdge = new Map<string, number[]>();
    pool.forEach((region, i) => {
      const poly = region.polygon;
      for (let k = 0; k < poly.length; k += 1) {
        const edge = key(poly[k], poly[(k + 1) % poly.length]);
        const list = byEdge.get(edge);
        if (list) list.push(i);
        else byEdge.set(edge, [i]);
      }
    });
    const out: Array<[number, number]> = [];
    const seen = new Set<string>();
    for (const list of byEdge.values()) {
      for (let a = 0; a < list.length; a += 1) {
        for (let b = a + 1; b < list.length; b += 1) {
          const id = `${list[a]}|${list[b]}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push([list[a], list[b]]);
        }
      }
    }
    return out;
  };

  it("样式五件 = 逆向源值（α 0.80 / 1px / #4d3200 / 白外影 / 内阴影 9px #4d4134）", () => {
    // 2.43.0 对齐分风格 paint_shadow 表（review 序 11 / E2）：
    // stroke:1 #4d3200 + shadow:2~5 #ffffff + inner_shadow。
    // 填充 0.80 配西幻土色板（0.55 配粉彩"发白发平"，0.30 配强对比色板均已作废）。
    expect(REGION_FILL_ALPHA).toBeCloseTo(0.8, 12);
    expect(REGION_BORDER_PX).toBe(1);
    expect(REGION_BORDER_COLOR).toBe(0x4d3200);
    expect(REGION_BORDER_ALPHA).toBe(1);
    // 白外影 + 内阴影（paint_shadow 的另外两件）
    expect(REGION_RIM_PX).toBe(4);
    expect(REGION_RIM_COLOR).toBe(0xffffff);
    // 15 → 9：单层均匀带实测读作"贴边公路"（硬外沿 + 接缝两侧 2×宽度叠加），
    // 收窄深度并改多层渐隐；第二轮再收一档 —— 退晕是辅光，只到"边界比块心
    // 深一点"为止
    expect(REGION_INNER_SHADOW_PX).toBe(9);
    // #414040 → #4d4134：中性灰压在粉彩上读作"脏灰雾"，暖化为描边同族的
    // 深褐 —— 源表色值属于它自己的合成语境，我们随自己的底色取色
    expect(REGION_INNER_SHADOW_COLOR).toBe(0x4d4134);
    // 渐隐层数：≥3 才看不出同心阶梯，≤5 再多与真模糊肉眼无差
    expect(REGION_INNER_SHADOW_PASSES).toBeGreaterThanOrEqual(3);
    expect(REGION_INNER_SHADOW_PASSES).toBeLessThanOrEqual(5);
    // 内阴影浓度 = 贴边处多层累计的目标值：高于它变成描边、低于它看不见
    expect(REGION_INNER_SHADOW_ALPHA).toBeGreaterThan(0.05);
    expect(REGION_INNER_SHADOW_ALPHA).toBeLessThan(0.3);
  });

  it("同一时刻至多一个层级「可辨识」（权重 > 0.5 的层级 ≤ 1 个）", () => {
    // 结构性质：α_i = t_{i-1} - t_i 且 t 单调，相邻两级同时 > 0.5 需要
    // t_{i-1} - t_{i+1} > 1，而 t ∈ [0,1] —— 数学上排除了"两级都清晰"
    const scales = naturalScales(COUNTS, MAP);
    for (let z = 0.05; z <= 20; z *= 1.08) {
      const alphas = levelAlphas(z, scales);
      expect(alphas, `scale=${z.toFixed(3)}`).toHaveLength(COUNTS.length);
      expect(alphas.filter((a) => a > 0.5).length, `scale=${z.toFixed(3)}`).toBeLessThanOrEqual(1);
    }
  });

  it("全图视角（fit 缩放 0.62~0.80）主导层级 = 国家，同屏可辨识 12 块 ≤ 20", () => {
    // 「同屏可辨识区块数 ≤ 20」是参考实现的 `countries` 上限（§3.7）。2.40.0 砍掉
    // 大陆/洲之后，全图视角的主导层级正好是**国家**（默认 12 块，2.41.0 从 20
    // 降下来对齐参考成图的密度观感）—— 参考的 `20<J&&(J=20)` 只是上限。
    // 郡（60 块）要等缩到画布只覆盖地图一部分时才是主导，那时视口内的块数自然回落。
    const scales = naturalScales(COUNTS, MAP);
    for (const z of [0.62, 0.7, 0.8]) {
      const level = activeLevel(z, scales);
      expect(level, `scale=${z}`).toBe(0);
      expect(COUNTS[level], "参考的 countries 上限 20").toBeLessThanOrEqual(20);
      // 主导层级必须"真的清晰"：否则同屏块数只是靠权重薄摊出来的假象
      expect(levelAlphas(z, scales)[level], `scale=${z} 主导权重`).toBeGreaterThan(0.85);
    }
  });

  it("色板 9 格、互不相同、两两合成色差 ≥ 8（粉彩族的紧凑下限）", () => {
    expect(REGION_PALETTE_RGB).toHaveLength(9);
    expect(new Set(REGION_PALETTE_RGB).size).toBe(9);
    const composed = REGION_PALETTE_RGB.map((c) => composite(c, REGION_FILL_ALPHA));
    let min = Infinity;
    for (let i = 0; i < composed.length; i += 1) {
      for (let j = i + 1; j < composed.length; j += 1) {
        min = Math.min(min, rgbDist(composed[i], composed[j]));
      }
    }
    // 2.43.0 粉彩色板（E3）：合成后最小两两距离 ≈ 9.0（灰紫/灰青族内最紧的一对）。
    // 粉彩族天然紧凑 —— 参考实现也不靠色差分块，靠内阴影/白外影/细描边三层光影；
    // 这条只防"两格完全分不出来"的回归。邻接校正的可行性下限见 REGION_NEIGHBOR_MIN_DIST。
    expect(min).toBeGreaterThanOrEqual(8);
  });

  /**
   * 相邻区块的色差（合成到纸色后）—— 这组断言是"国家的色块颜色差距很小"
   * 的直接探针。
   *
   * 【相邻而不是两两】政治地图本来就会复用颜色（四色定理）：不相邻的两块同色
   * 是正常的、也是参考目标的样子；只有**相邻**同色/近色才是缺陷。
   *
   * 【基线】2.38.0（连续 HSL + 8° hueSpread）实测相邻均值只有 3.6、最差 0.1 ——
   * 肉眼就是一片单色。改成色板 + 邻接校正后：均值 26~32、最差 ≥ 14。
   * 【2.43.0 粉彩重校】色差整体收窄（合成后均值 ≈ 22+、最差 ≈ 9）—— 这是
   * **有意的**：参考成图就是低对比粉彩 + 光影分块（内阴影/白外影/细描边），
   * 色差下限只防"相邻同色"，不再承担"强对比"的职责。
   */
  it("相邻区块色差：均值 ≥ 18、最差 ≥ 8（粉彩口径；分块可读性由光影三层兜底）", () => {
    const regions = generateHierarchy({ seed: 42, bounds: MAP, levelCounts: [...COUNTS] });
    for (let level = 0; level < COUNTS.length; level += 1) {
      const pool = regions.filter((r) => r.level === level);
      const pairs = adjacentPairs(pool);
      expect(pairs.length, `level=${level} 相邻对`).toBeGreaterThan(0);
      const composed = pool.map((r) => composite(r.color, regionFillAlphaOf(level)));
      let min = Infinity;
      let sum = 0;
      for (const [a, b] of pairs) {
        const d = rgbDist(composed[a], composed[b]);
        min = Math.min(min, d);
        sum += d;
      }
      expect(sum / pairs.length, `level=${level} 相邻均值`).toBeGreaterThanOrEqual(18);
      expect(min, `level=${level} 相邻最差`).toBeGreaterThanOrEqual(8);
    }
  });

  it("同层尽量不重色：国家一级 12 块用到 ≥ 7 种颜色（参考目标里每国一色）", () => {
    const regions = generateHierarchy({ seed: 42, bounds: MAP, levelCounts: [...COUNTS] });
    const colors = new Set(regions.filter((r) => r.level === 0).map((r) => r.color));
    // 色板有 9 格，12 块可能复用；7 是"看起来每块都不一样"的下限
    expect(colors.size).toBeGreaterThanOrEqual(7);
  });

  it("assignRegionColors：确定性、只动该动的块", () => {
    const build = () => generateHierarchy({ seed: 7, bounds: MAP, levelCounts: [...COUNTS] });
    const a = build();
    const b = build();
    expect(a.map((r) => r.color)).toEqual(b.map((r) => r.color));

    // 全部换成同一格再校正：相邻块必须被拆开（不能保留"整层同色"）
    const poisoned = build().map((r) => ({ ...r, color: REGION_PALETTE_RGB[0] }));
    assignRegionColors(poisoned);
    for (let level = 0; level < COUNTS.length; level += 1) {
      const pool = poisoned.filter((r) => r.level === level);
      const composed = pool.map((r) => composite(r.color, regionFillAlphaOf(level)));
      for (const [i, j] of adjacentPairs(pool)) {
        expect(rgbDist(composed[i], composed[j]), `level=${level}`).toBeGreaterThan(0);
      }
    }
  });
});
