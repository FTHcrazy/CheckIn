import { describe, expect, it } from "vitest";
import { REGION_LEVELS, generateHierarchy, polygonArea, type Point } from "./regions";
import { generateLand, pointInLand } from "./land";
import type { MapLand, Rect } from "./types";

/**
 * 区块树"陆地内切分"回归测试（PRD §6.1.3 / 架构 §1.5）。
 *
 * 【为什么单独建一个文件而不是往 regions.test.ts 里加】`regions.test.ts` 的 38 个
 * 用例是**老行为的护栏**——矩形容器那条路径的判据一个字都不能动。新路径（传
 * `container`）必须另起炉灶，否则一旦新路径要调整容差，就会连累那份护栏。
 *
 * 三条断言各有分工：
 *   ① 缺省 = 老行为：不传 container 与"显式传矩形四角"逐点一致，且铺满整纸；
 *   ② 新路径正确：传陆地多边形时，区块顶点全部落在陆地内（容差 3 世界单位）；
 *   ③ id 不重号：多岛多次调用必须传**不同的** idPrefix，否则 id 会撞车。
 */

/** 与 BASE_IMAGE（1024×1024、原点居中）一致的世界范围 */
const BOUNDS: Rect = { x: -512, y: -512, width: 1024, height: 1024 };

/** 由 bounds 算出的四角（与 regions.ts 内部虚拟根一致） */
function rectOf(b: Rect): Point[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ];
}

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

/** 点到环边界的最短距离（不分内外） */
function distToRing(p: Point, ring: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const d = distToSegment(p, ring[i], ring[(i + 1) % ring.length]);
    if (d < best) best = d;
  }
  return best;
}

/** 点到陆地边界的最短距离（取所有环的最小值） */
function distToLandBoundary(p: Point, land: MapLand): number {
  let best = Infinity;
  for (const ring of land.polygons) {
    const d = distToRing(p, ring);
    if (d < best) best = d;
  }
  return best;
}

describe("generateHierarchy.container：缺省即老行为", () => {
  it("不传 container 与显式传矩形四角，结果逐点一致", () => {
    const a = generateHierarchy({ seed: 20261009, bounds: BOUNDS });
    const b = generateHierarchy({ seed: 20261009, bounds: BOUNDS, container: rectOf(BOUNDS) });
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i].id).toBe(b[i].id);
      expect(a[i].polygon).toEqual(b[i].polygon);
    }
  });

  it("缺省时最粗一级铺满整纸（面积和 = 纸面积，误差 < 1%）", () => {
    const all = generateHierarchy({ seed: 4242, bounds: BOUNDS, levelCounts: [3] });
    const sum = all.reduce((s, r) => s + polygonArea(r.polygon), 0);
    const paper = BOUNDS.width * BOUNDS.height;
    expect(Math.abs(sum - paper) / paper).toBeLessThan(0.01);
  });

  it("缺省时区块顶点不越出纸面（矩形路径未动）", () => {
    const all = generateHierarchy({ seed: 99, bounds: BOUNDS, levelCounts: [3, 12] });
    for (const r of all) {
      for (const p of r.polygon) {
        // 已知残余：0.6% 的区块有顶点微越出父块，最大 3.2 世界单位
        const out =
          Math.max(BOUNDS.x - p.x, p.x - (BOUNDS.x + BOUNDS.width), BOUNDS.y - p.y, p.y - (BOUNDS.y + BOUNDS.height));
        expect(out).toBeLessThan(4);
      }
    }
  });
});

describe("generateHierarchy.container：陆地内切分", () => {
  /**
   * 顶点是否算"在陆地内"。
   *
   * 判据是「在环内 **或** 离岸线 ≤ 容差」而不是死板的 `pointInLand`：
   * 区块的内部分界是**崎岖化**出来的，本来就允许极少数顶点落到父块轮廓之外
   * （regions.ts 模块头记录的 0.6% / 最大 3.2 世界单位）。把它们按"离岸线多远"
   * 判定，正好把这条已知残余与新路径引入的"区块跑到海里"区分开。
   */
  function insideLand(p: Point, land: MapLand, tolerance: number): boolean {
    return pointInLand(p, land) || distToLandBoundary(p, land) <= tolerance;
  }

  it("传陆地多边形时，全部区块顶点都在陆地内（容差 3 世界单位）", () => {
    const land = generateLand({ seed: 20261009, bounds: BOUNDS, islands: 1 });
    const container = land.polygons[0];
    const all = generateHierarchy({
      seed: 20261009,
      bounds: BOUNDS,
      container,
      levelCounts: [3, 12, 48],
      idPrefix: "i0_",
    });
    expect(all.length).toBeGreaterThan(0);

    let worst = 0;
    for (const r of all) {
      for (const p of r.polygon) {
        if (insideLand(p, land, 3)) continue;
        worst = Math.max(worst, distToLandBoundary(p, land));
      }
    }
    // 越界距离超过 3 就说明陆地边界没能约束住区块（此时应启用 landHull 逃生开关）
    expect(worst, `最远越岸 ${worst.toFixed(2)} 世界单位`).toBe(0);
  });

  it("多岛逐岛切分：每岛的区块都在自己那个岛内", () => {
    const land = generateLand({ seed: 31337, bounds: BOUNDS, islands: 3 });
    for (let i = 0; i < land.polygons.length; i += 1) {
      const all = generateHierarchy({
        seed: 31337,
        bounds: BOUNDS,
        container: land.polygons[i],
        levelCounts: [2, 6],
        idPrefix: `i${i}_`,
      });
      expect(all.length).toBeGreaterThan(0);
      let worst = 0;
      for (const r of all) {
        for (const p of r.polygon) {
          if (insideLand(p, land, 3)) continue;
          worst = Math.max(worst, distToLandBoundary(p, land));
        }
      }
      expect(worst, `第 ${i} 岛最远越岸 ${worst.toFixed(2)}`).toBe(0);
    }
  });

  it("最粗一级铺满陆地（面积和 ≈ 陆地面积，误差 < 5%）", () => {
    // 阈值 3%→5%（2.34.0）：海岸改 SDF 侵蚀后湾更深，径向钳制把凹湾处的
    // 越岸顶点拉到最近岸点，区块只会在凹段收缩（越岸恒为 0，见上一条用例），
    // 面积和 ≤ 陆地面积、缺口 ≤ 5% 属于"钳制的固有损耗"，不是塌陷 ——
    // 填充 alpha 0.10 下这段缺口肉眼不可见。
    const land = generateLand({ seed: 9176, bounds: BOUNDS, islands: 1 });
    const container = land.polygons[0];
    const all = generateHierarchy({
      seed: 9176,
      bounds: BOUNDS,
      container,
      levelCounts: [4],
      idPrefix: "i0_",
    });
    const sum = all.reduce((s, r) => s + polygonArea(r.polygon), 0);
    const landArea = polygonArea(container);
    expect(Math.abs(sum - landArea) / landArea).toBeLessThan(0.05);
  });

  it("层级数与请求一致（容器换了不影响层级结构）", () => {
    const land = generateLand({ seed: 606, bounds: BOUNDS, islands: 1 });
    const all = generateHierarchy({
      seed: 606,
      bounds: BOUNDS,
      container: land.polygons[0],
      levelCounts: REGION_LEVELS.slice(0, 2).map((l) => l.count),
      idPrefix: "i0_",
    });
    expect(new Set(all.map((r) => r.level))).toEqual(new Set([0, 1]));
    expect(all.filter((r) => r.parentId === null).length).toBeGreaterThan(0);
  });
});

describe("generateHierarchy.idPrefix：多岛 id 不得重号", () => {
  const seed = 20261009;
  const land = generateLand({ seed, bounds: BOUNDS, islands: 2 });

  it("不传 idPrefix 时两次调用必然重号（把坑钉死）", () => {
    const a = generateHierarchy({ seed, bounds: BOUNDS, container: land.polygons[0], levelCounts: [3] });
    const b = generateHierarchy({ seed, bounds: BOUNDS, container: land.polygons[1], levelCounts: [3] });
    const idsA = new Set(a.map((r) => r.id));
    const dup = b.filter((r) => idsA.has(r.id));
    expect(dup.length).toBeGreaterThan(0);
  });

  it("逐岛传不同的 idPrefix 时 id 全局唯一", () => {
    const ids: string[] = [];
    for (let i = 0; i < land.polygons.length; i += 1) {
      const all = generateHierarchy({
        seed,
        bounds: BOUNDS,
        container: land.polygons[i],
        levelCounts: [3, 6],
        idPrefix: `i${i}_`,
      });
      ids.push(...all.map((r) => r.id));
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("idPrefix 缺省时 id 与改动前一字不差（rg_<seed36>_<n>）", () => {
    const all = generateHierarchy({ seed, bounds: BOUNDS, levelCounts: [2] });
    const seed36 = (seed >>> 0).toString(36);
    expect(all.map((r) => r.id)).toEqual([`rg_${seed36}_1`, `rg_${seed36}_2`]);
  });
});
