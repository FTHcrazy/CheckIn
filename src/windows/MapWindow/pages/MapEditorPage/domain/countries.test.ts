import { describe, expect, it } from "vitest";
import { generateLand as buildLand, pointInLand } from "../land";
import { polygonArea, polygonCentroid } from "../regions";
import type { MapPolyline, Point } from "../types";
import {
  BORDER_RDP_TOL,
  COUNTRY_MAX,
  COUNTRY_MIN,
  HEX_INSET_RATIO,
  HEX_RADIUS_RATIO,
  UNCLAIMED_CENTER_MAX_RATE,
  chaikin,
  convexHull,
  generateCountries,
  hexAt,
  hexCenter,
  hexCorner,
  hexGridOf,
  landCellsOf,
  rdpSimplifyOpen,
  simplifyClosedRing,
  smoothBorderRing,
  splitClusters,
  traceOutlines,
  clusterRoadsByConnectivity,
} from "./countries";
import { createRng } from "../regions";

/**
 * 国家区域生成（2.50.0，对齐 `decoded.js` 的 `D`/`fa`/`da`/`ya`）。
 *
 * 这套算法的价值全在**观感契约**上，所以守卫也照着观感写：
 *   ① 数量：要几个给几个（夹在 [2,12]）；
 *   ② 不重叠：格集合互斥 ⇒ 面积和 ≈ 陆地面积（这是"交接处不叠色"的结构保证）；
 *   ③ 全在陆地内；
 *   ④ 面积**不能均匀** —— 均匀就退回"行政区划图"，是本次要修的病根；
 *   ⑤ 国名不重复且是"国"字结尾或专名；
 *   ⑥ 同 seed 一致。
 */

const BOUNDS = { x: -723, y: -512, width: 1447, height: 1024 } as const;

/** 一条直线路（只要两端点，与参考 `link` 同口径） */
function road(a: Point, b: Point): MapPolyline {
  return {
    id: `pl_${a.x}_${a.y}_${b.x}_${b.y}`,
    kind: "road",
    styleId: "road-dotted",
    points: [a, b],
    closed: false,
    level: null,
  };
}

/** 在陆地上撒一圈网格点连成的路网（模拟"一键成图"的连通树） */
function gridRoads(land: ReturnType<typeof buildLand>, step: number): MapPolyline[] {
  const out: MapPolyline[] = [];
  const rings = land.polygons;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const ring of rings) {
    for (const p of ring) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  for (let y = minY; y <= maxY; y += step) {
    let prev: Point | null = null;
    for (let x = minX; x <= maxX; x += step) {
      const p = { x, y };
      if (!pointInLand(p, land)) {
        prev = null;
        continue;
      }
      if (prev) out.push(road(prev, p));
      prev = p;
    }
  }
  return out;
}

describe("六边形格网", () => {
  it("hexAt 与 hexCenter 互逆（世界坐标 ↔ 轴向）", () => {
    const grid = hexGridOf(BOUNDS);
    for (const [q, r] of [
      [0, 0],
      [3, -1],
      [-5, 7],
      [11, 2],
    ]) {
      const c = hexCenter(grid, q, r);
      const back = hexAt(grid, c);
      expect(back).toEqual({ q, r });
    }
  });

  it("格边长按纸宽比例取（参考 40/1587 ≈ 2.52%）", () => {
    expect(HEX_RADIUS_RATIO).toBeCloseTo(40 / 1587, 6);
    const grid = hexGridOf(BOUNDS);
    expect(grid.radius).toBeCloseTo(BOUNDS.width * HEX_RADIUS_RATIO, 6);
    expect(HEX_INSET_RATIO).toBeCloseTo(30 / 1587, 6);
  });

  it("角点构成正六边形：宽 2R、高 √3R，与参考 Q() 的六角一致", () => {
    const grid = hexGridOf(BOUNDS);
    const c = hexCenter(grid, 2, -1);
    const pts = [0, 1, 2, 3, 4, 5].map((i) => hexCorner(c, grid.radius, i));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * grid.radius, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(Math.sqrt(3) * grid.radius, 6);
    // 每个角到中心等距（正六边形）
    for (const p of pts) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(grid.radius, 6);
  });
});

describe("几何工具", () => {
  it("convexHull 把散点收成凸包，且剔除内部点", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
    ];
    const hull = convexHull(pts);
    expect(hull).toHaveLength(4);
    expect(polygonArea(hull)).toBeCloseTo(100, 6);
  });

  it("chaikin 每轮点数翻倍且不越出原包围盒", () => {
    const ring: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const once = chaikin(ring, 1);
    expect(once).toHaveLength(8);
    for (const p of once) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });

  it("traceOutlines 对单个格子返回一个 6 顶点环", () => {
    const grid = hexGridOf(BOUNDS);
    const owner = new Map<string, number>([["0,0", 0]]);
    const rings = traceOutlines(["0,0"], 0, owner, grid);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(6);
    // 单格面积 = (3√3/2)R²
    expect(polygonArea(rings[0])).toBeCloseTo((3 * Math.sqrt(3) / 2) * grid.radius ** 2, 3);
  });

  it("traceOutlines 对不相连的两块返回两个环（飞地）", () => {
    const grid = hexGridOf(BOUNDS);
    const owner = new Map<string, number>([
      ["0,0", 0],
      ["9,0", 0],
    ]);
    const rings = traceOutlines(["0,0", "9,0"], 0, owner, grid);
    expect(rings).toHaveLength(2);
  });
});

describe("簇收敛", () => {
  it("道路端点相接 ⇒ 同一簇（量化容差内）", () => {
    const a = road({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = road({ x: 10, y: 0 }, { x: 20, y: 0 });
    const c = road({ x: 90, y: 90 }, { x: 100, y: 90 });
    expect(clusterRoadsByConnectivity([a, b, c])).toHaveLength(2);
  });

  it("splitClusters 把 1 簇拆成目标数，且每个新簇都非空", () => {
    const pts: Point[] = [];
    for (let i = 0; i < 40; i += 1) pts.push({ x: (i % 8) * 50, y: Math.floor(i / 8) * 50 });
    const out = splitClusters([pts], 6, createRng(1));
    expect(out).toHaveLength(6);
    for (const g of out) expect(g.length).toBeGreaterThan(0);
    // 最远点采样 ⇒ 不会出现"某簇 39 个点、另一簇 1 个点"的极端
    expect(Math.max(...out.map((g) => g.length))).toBeLessThan(pts.length);
  });
});

describe("generateCountries", () => {
  const land = buildLand({ seed: 20261110, bounds: BOUNDS });
  const roads = gridRoads(land, 120);

  it("要 12 个给 12 个", () => {
    const regions = generateCountries({ land, roads, count: 12, seed: 20261110 });
    expect(regions).toHaveLength(12);
    for (const r of regions) {
      expect(r.level).toBe(0);
      expect(r.parentId).toBeNull();
      expect(r.polygon.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("数量夹在 [2,12]：要 30 个只给 12，要 0 个给 2", () => {
    expect(generateCountries({ land, roads, count: 30, seed: 7 })).toHaveLength(COUNTRY_MAX);
    expect(generateCountries({ land, roads, count: 0, seed: 7 })).toHaveLength(COUNTRY_MIN);
  });

  it("国家之间不重叠：面积和不超过陆地面积的 1.02 倍", () => {
    const regions = generateCountries({ land, roads, count: 12, seed: 20261110 });
    const landArea = land.polygons.reduce((s, ring) => s + polygonArea(ring), 0);
    const sum = regions.reduce(
      (s, r) => s + polygonArea(r.polygon) + (r.pieces ?? []).reduce((a, p) => a + polygonArea(p), 0),
      0,
    );
    // 平滑（Chaikin）会让边界略微内收，所以只能要求"不超过 + 明显不重复"。
    // 重叠（同一片地被上两次色）会直接让 sum 超过 landArea 的 1.05 以上。
    expect(sum / landArea).toBeLessThan(1.02);
    expect(sum / landArea).toBeGreaterThan(0.6);
  });

  it("每块的主要顶点都落在陆地附近（不越到远海）", () => {
    const regions = generateCountries({ land, roads, count: 12, seed: 20261110 });
    for (const r of regions) {
      const c = polygonCentroid(r.polygon);
      expect(pointInLand(c, land), `${r.name} 的质心不在陆地上`).toBe(true);
    }
  });

  it("面积**不均匀**：最大块至少是最小块的 1.6 倍（均匀就是行政区划图）", () => {
    const regions = generateCountries({ land, roads, count: 12, seed: 20261110 });
    const areas = regions.map((r) => polygonArea(r.polygon)).sort((a, b) => a - b);
    const ratio = areas[areas.length - 1] / Math.max(1e-6, areas[0]);
    expect(ratio, `最大/最小 = ${ratio.toFixed(2)}，太均匀了`).toBeGreaterThan(1.6);
  });

  it("国名 12 个互不相同，且读得出是国名", () => {
    const regions = generateCountries({ land, roads, count: 12, seed: 20261110 });
    const names = regions.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).not.toMatch(/^国家\s*\d+$/);
  });

  it("同 seed 完全一致（几何 + 名字）", () => {
    const a = generateCountries({ land, roads, count: 8, seed: 4242 });
    const b = generateCountries({ land, roads, count: 8, seed: 4242 });
    expect(a.map((r) => r.name)).toEqual(b.map((r) => r.name));
    expect(a.map((r) => r.polygon.length)).toEqual(b.map((r) => r.polygon.length));
  });

  it("没有路网也能出图（最远点采样兜底）", () => {
    const regions = generateCountries({ land, roads: [], count: 6, seed: 11 });
    expect(regions).toHaveLength(6);
  });

  it("陆地内每个格都有归属（未归属率守卫）", () => {
    const grid = hexGridOf(BOUNDS);
    const regions = generateCountries({ land, roads, count: 12, seed: 20261110 });
    // 【口径】按**六边形格心**统计，而不是直角网格撒点：国家就是铺在六边形格上的，
    // 直角撒点会出现"格心在海里、点在陆地上"的格子 —— 那不算漏填，是口径错。
    const cells = landCellsOf(grid, BOUNDS, (p) => pointInLand(p, land));
    let total = 0;
    let covered = 0;
    for (const k of cells) {
      const [qs, rs] = k.split(",");
      const p = hexCenter(grid, Number(qs), Number(rs));
      total += 1;
      const hit = regions.some(
        (r) =>
          pointInPoly(r.polygon, p) || (r.pieces ?? []).some((poly) => pointInPoly(poly, p)),
      );
      if (hit) covered += 1;
    }
    expect(total).toBeGreaterThan(100);
    const rate = 1 - covered / total;
    // 平滑会把边界往里收一点，贴着海岸那一圈的格心可能被切到外面 —— 允许 8%，
    // 超过就是"整片地没上色"（真实缺陷）。
    expect(rate, `未归属率 ${(rate * 100).toFixed(1)}%`).toBeLessThan(UNCLAIMED_CENTER_MAX_RATE);
  });
});

describe("边界描边平滑（2.52.0，参考 ra → Ma(oa) 渲染链）", () => {
  it("RDP 开折线：首尾恒保留，超容差拐点保留", () => {
    // 45° 斜坡上的 1 单位像素台阶：每个台阶离对角弦 ≤ √2/2 ≈ 0.71 < 1.2
    const stair: Point[] = [];
    for (let i = 0; i <= 20; i += 1) {
      stair.push({ x: i, y: i });
      if (i < 20) stair.push({ x: i + 1, y: i });
    }
    const simplified = rdpSimplifyOpen(stair, BORDER_RDP_TOL);
    expect(simplified[0]).toEqual({ x: 0, y: 0 });
    expect(simplified[simplified.length - 1]).toEqual({ x: 20, y: 20 });
    expect(simplified.length).toBeLessThanOrEqual(4);
  });

  it("RDP 开折线：拐角离弦超容差 → 必须保留", () => {
    const L: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 5 },
    ];
    const simplified = rdpSimplifyOpen(L, BORDER_RDP_TOL);
    // 中间两个拐点各离弦 3.54，远超 1.2
    expect(simplified).toHaveLength(4);
  });

  it("闭合环抽稀：共线点收掉、四角保留、偏差有界", () => {
    // 方形四角 + 每边插入 9 个共线点 → 收回 4 角
    const square: Point[] = [];
    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 0, y: 30 },
    ];
    for (let i = 0; i < corners.length; i += 1) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      for (let t = 0; t < 10; t += 1) {
        square.push({ x: a.x + ((b.x - a.x) * t) / 10, y: a.y + ((b.y - a.y) * t) / 10 });
      }
    }
    const simplified = simplifyClosedRing(square, BORDER_RDP_TOL);
    expect(simplified).toHaveLength(4);
    // 每个原始点到抽稀结果的距离 ≤ 容差（抽稀不改变形状语义；按闭环量距离）
    for (const p of square) {
      const d = minDistToPolyline(p, [...simplified, simplified[0]]);
      expect(d).toBeLessThanOrEqual(BORDER_RDP_TOL + 1e-9);
    }
  });

  it("smoothBorderRing = 有界低通：点数守恒、偏离 < 线宽半径、轴向台阶塌缩", () => {
    const ring: Point[] = [];
    for (let i = 0; i < 16; i += 1) {
      ring.push({ x: i, y: 0 });
      ring.push({ x: i + 1, y: i % 2 === 0 ? 0 : 1 });
      ring.push({ x: i + 1, y: 1 });
    }
    for (let i = 16; i >= 0; i -= 1) ring.push({ x: i, y: 12 });
    const smooth = smoothBorderRing(ring);
    // ⚠️ 低通不增不减点：RDP 会抽成稀疏长折线（多边形感），
    //    flattenCurveRing 会增密且把贝塞尔甩出填充 3.4 单位（线与色块分家）。
    expect(smooth).toHaveLength(ring.length);
    const closedOriginal = [...ring, ring[0]];
    const closedSmooth = [...smooth, smooth[0]];
    for (const p of smooth) {
      expect(minDistToPolyline(p, closedOriginal)).toBeLessThanOrEqual(1.5);
    }
    for (const p of ring) {
      expect(minDistToPolyline(p, closedSmooth)).toBeLessThanOrEqual(1.5);
    }
    // 轴向 1 单位台阶（锯齿指纹）必须被抹成斜线
    const axialCount = (pts: readonly Point[]) => {
      let n = 0;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if ((dx === 0 || dy === 0) && (dx !== 0 || dy !== 0)) n += 1;
      }
      return n;
    };
    expect(axialCount(smooth)).toBeLessThan(axialCount(ring) / 2);
  });
});

/** 点到折线的最短距离（测试内部用） */
function minDistToPolyline(p: Point, pts: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** 射线法（测试内部用，避免再 import regions 的同名工具） */
function pointInPoly(poly: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
