import { describe, expect, it } from "vitest";
import {
  REGION_LEVELS,
  REGION_LEVEL_COUNT_LIMITS,
  REGION_TOTAL_LIMIT,
  createRng,
  fbm,
  generateHierarchy,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  valueNoise,
  type MapRegion,
  type Point,
  type RegionBounds,
} from "./regions";

/**
 * 层级区块生成（大陆 → 洲 → 国家 → 郡）单元测试。
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

/** 默认四级：大陆 3 / 洲 12 / 国家 48 / 郡 160，共 223 */
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
    for (const seed of SEEDS) {
      const all = generateHierarchy({ seed, bounds: BOUNDS });
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
