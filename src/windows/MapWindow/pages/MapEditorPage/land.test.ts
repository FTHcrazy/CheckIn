import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import {
  LAND_AREA_RATIO,
  LAND_PAPER_MARGIN,
  LAND_SAMPLES,
  drawLandPath,
  generateLand,
  landAreaRatio,
  landHull,
  pointInLand,
  ringsIntersect,
  simplifyRing,
  type LandPathTarget,
} from "./land";
import { polygonArea, type Point } from "./regions";
import type { MapLand, Rect } from "./types";

/**
 * 陆地形状生成（纯函数）单元测试 —— 对应 PRD §6.1.6 的六条测试点，
 * 另加本次新增的两条：曲率平滑路径、凸包逃生开关。
 *
 * 【为什么断言到具体数值而不是"跑起来没报错"】陆地是**画面观感的地基**：
 * 一旦形状塌陷（面积过小）、碎裂（自交）或糊成一团（多岛相交），画面上
 * 的表现是"看不出这是一块陆地"，而这种缺陷在单测里只有靠数值才抓得到。
 */

/** 与 BASE_IMAGE（1024×1024、原点居中）一致的世界范围 */
const BOUNDS: Rect = { x: -512, y: -512, width: 1024, height: 1024 };

/** 一批种子：覆盖"常见值 / 大质数 / 负数 / 2^31 边界" */
const SEEDS = [1, 7, 20261009, 9176, 31337, 0, -1, -20261009, 2 ** 31, 2 ** 31 - 1];

function makeLand(seed: number, islands?: number): MapLand {
  return generateLand({ seed, bounds: BOUNDS, islands });
}

/** 线段是否**真**相交（与 land.ts 内部同一判据，端点共享不算） */
function cross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
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

/** 环是否自交：朴素 O(n²)，跳过共享端点的相邻边（n ≤ 512，可接受） */
function selfIntersects(ring: Point[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // 相邻边共享端点，端点处的"相交"不算自交
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (cross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

describe("generateLand：确定性", () => {
  it("同种子两次生成，多边形逐点相等", () => {
    const a = makeLand(20261009, 2);
    const b = makeLand(20261009, 2);
    expect(a.polygons.length).toBe(b.polygons.length);
    for (let i = 0; i < a.polygons.length; i += 1) {
      expect(a.polygons[i]).toEqual(b.polygons[i]);
    }
  });

  it("不同种子给出不同形状（否则'重新生成'没有意义）", () => {
    const a = makeLand(1, 1);
    const b = makeLand(2, 1);
    expect(a.polygons[0]).not.toEqual(b.polygons[0]);
  });

  it("seed 原样带回，便于复现与截图比对", () => {
    expect(makeLand(4242).seed).toBe(4242);
  });
});

describe("generateLand：环的合法性", () => {
  it("每个环点数 = 采样数（≥8）、首尾不重复、闭合", () => {
    for (const seed of SEEDS) {
      const land = makeLand(seed, 3);
      expect(land.polygons.length).toBeGreaterThan(0);
      for (const ring of land.polygons) {
        expect(ring.length).toBe(LAND_SAMPLES);
        expect(ring.length).toBeGreaterThanOrEqual(8);
        // 首尾不重复存：末点 ≠ 首点（闭合由绕向隐含）
        expect(ring[ring.length - 1]).not.toEqual(ring[0]);
        // 闭合性的可验证形式：末点与首点的间距 ≈ 一条弦长，而不是跨越整个岛
        const chord = Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].y - ring[ring.length - 1].y);
        expect(chord).toBeLessThan(80);
      }
    }
  });

  it("无自交（相邻边除外）", () => {
    for (const seed of SEEDS) {
      for (const islands of [1, 2, 3]) {
        const land = makeLand(seed, islands);
        for (const ring of land.polygons) {
          expect(selfIntersects(ring), `seed=${seed} islands=${islands} 出现自交`).toBe(false);
        }
      }
    }
  });

  it("陆地完整落在纸内，四周留出海面（>= 纸边留海的一半）", () => {
    for (const seed of SEEDS) {
      const land = makeLand(seed, 3);
      for (const ring of land.polygons) {
        for (const p of ring) {
          expect(p.x).toBeGreaterThanOrEqual(BOUNDS.x + LAND_PAPER_MARGIN / 2);
          expect(p.y).toBeGreaterThanOrEqual(BOUNDS.y + LAND_PAPER_MARGIN / 2);
          expect(p.x).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.width - LAND_PAPER_MARGIN / 2);
          expect(p.y).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.height - LAND_PAPER_MARGIN / 2);
        }
      }
    }
  });
});

describe("generateLand：面积与多岛", () => {
  it("面积占比落在 25%~85%（PRD §6.1.6）", () => {
    for (const seed of SEEDS) {
      for (const islands of [1, 2, 3]) {
        const ratio = landAreaRatio(makeLand(seed, islands));
        expect(ratio, `seed=${seed} islands=${islands} 占比 ${ratio}`).toBeGreaterThan(0.25);
        expect(ratio, `seed=${seed} islands=${islands} 占比 ${ratio}`).toBeLessThan(0.85);
      }
    }
  });

  it("单岛时逼近目标占比（LAND_AREA_RATIO 的下限）", () => {
    // 单岛是"占纸面一半多一点"的主力形态；格子放不下时才会退化
    for (const seed of [1, 9176, 31337, 20261009]) {
      const ratio = landAreaRatio(makeLand(seed, 1));
      expect(ratio).toBeGreaterThan(LAND_AREA_RATIO.min - 0.08);
    }
  });

  it("多岛时岛数与请求一致，且两两不相交（采样点互判 + 边交叉）", () => {
    for (const seed of [1, 9176, 31337, 20261009, 606]) {
      for (const islands of [2, 3]) {
        const land = makeLand(seed, islands);
        // 岛被"静默丢弃"曾是真实缺陷（随机撒点排布塞不下第二个岛）
        expect(land.polygons.length, `seed=${seed} islands=${islands} 岛数不符`).toBe(islands);
        for (let i = 0; i < land.polygons.length; i += 1) {
          for (let j = i + 1; j < land.polygons.length; j += 1) {
            expect(
              ringsIntersect(land.polygons[i], land.polygons[j]),
              `seed=${seed} islands=${islands} 第 ${i}/${j} 个岛相交`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it("极端 seed（0 / 负数 / 2^31）不抛异常", () => {
    for (const seed of [0, -1, -20261009, 2 ** 31, -(2 ** 31)]) {
      expect(() => makeLand(seed, 2)).not.toThrow();
      const land = makeLand(seed, 2);
      expect(land.polygons.length).toBeGreaterThan(0);
      for (const ring of land.polygons) expect(ring.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("退化纸面（宽或高为 0）返回空多边形而不是 NaN", () => {
    const empty = generateLand({ seed: 1, bounds: { x: 0, y: 0, width: 0, height: 1024 } });
    expect(empty.polygons).toEqual([]);
    expect(landAreaRatio(empty)).toBe(0);
  });
});

describe("pointInLand", () => {
  it("岛心必在陆地内；纸的四角必在陆地外", () => {
    const land = makeLand(9176, 2);
    for (const ring of land.polygons) {
      let cx = 0;
      let cy = 0;
      for (const p of ring) {
        cx += p.x;
        cy += p.y;
      }
      expect(pointInLand({ x: cx / ring.length, y: cy / ring.length }, land)).toBe(true);
    }
    expect(pointInLand({ x: BOUNDS.x + 2, y: BOUNDS.y + 2 }, land)).toBe(false);
    expect(pointInLand({ x: 0, y: 0 }, null)).toBe(false);
    expect(pointInLand({ x: 0, y: 0 }, { seed: 0, polygons: [], bounds: BOUNDS })).toBe(false);
  });
});

describe("drawLandPath：Catmull-Rom → 三次贝塞尔", () => {
  /** 记录全部调用的替身目标（不依赖 pixi，见 land.ts 的 LandPathTarget） */
  function recorder() {
    const calls: string[] = [];
    const target: LandPathTarget = {
      moveTo: (x, y) => {
        calls.push(`M${x},${y}`);
        return target;
      },
      bezierCurveTo: (c1x, c1y, c2x, c2y, x, y) => {
        calls.push(`C${c1x},${c1y},${c2x},${c2y},${x},${y}`);
        return target;
      },
      closePath: () => {
        calls.push("Z");
        return target;
      },
    };
    return { calls, target };
  }

  it("每个环：moveTo 1 次 + bezierCurveTo n 次 + closePath 1 次，且末段回到首点", () => {
    const land = makeLand(9176, 2);
    const { calls, target } = recorder();
    drawLandPath(target, land.polygons);

    const moves = calls.filter((c) => c.startsWith("M"));
    const curves = calls.filter((c) => c.startsWith("C"));
    const closes = calls.filter((c) => c === "Z");
    expect(moves.length).toBe(land.polygons.length);
    expect(closes.length).toBe(land.polygons.length);
    expect(curves.length).toBe(land.polygons.reduce((s, r) => s + r.length, 0));

    // 每个环的第一段是 moveTo，最后一个 C 的终点必须回到该环首点（闭合）
    const first = land.polygons[0];
    expect(moves[0]).toBe(`M${first[0].x},${first[0].y}`);
    const lastCurve = calls.filter((c) => c.startsWith("C"))[first.length - 1];
    expect(lastCurve.endsWith(`,${first[0].x},${first[0].y}`)).toBe(true);
  });

  it("顶点数不足 3 的环被跳过（不抛异常、不产生调用）", () => {
    const { calls, target } = recorder();
    drawLandPath(target, [[{ x: 0, y: 0 }], [{ x: 1, y: 1 }, { x: 2, y: 2 }], []]);
    expect(calls).toEqual([]);
  });

  /**
   * 编译期校验：Pixi 的 Graphics 必须能直接当 LandPathTarget 用。
   * 用 `import type` 因此运行时被完全擦除 —— 这里不会引入任何 pixi 依赖。
   */
  it("Graphics 结构上满足 LandPathTarget（类型层面，无运行时开销）", () => {
    const fake = null as unknown as Graphics;
    const asTarget: LandPathTarget = fake;
    expect(asTarget).toBeNull();
  });
});

describe("simplifyRing：Douglas–Peucker", () => {
  it("近共线的中间点被抽掉，明显偏离的点被保留", () => {
    // 一条直线：中间点全部共线 → 只留两端
    const line: Point[] = [];
    for (let i = 0; i <= 20; i += 1) line.push({ x: i * 10, y: 0 });
    expect(simplifyRing(line, 1.5)).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);

    // 明显偏离直线 50 的点必须留下
    const withSpike = [...line.slice(0, 10), { x: 100, y: 50 }, ...line.slice(11)];
    const kept = simplifyRing(withSpike, 1.5);
    expect(kept).toContainEqual({ x: 100, y: 50 });
    expect(kept.length).toBeLessThan(withSpike.length);
  });

  it("容差为 0 或点数 ≤ 3 时原样返回", () => {
    const ring: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    expect(simplifyRing(ring, 0)).toEqual(ring);
    expect(simplifyRing(ring, 1.5)).toEqual(ring);
  });
});

describe("landHull：凸性逃生开关", () => {
  it("凸包顶点都来自原点集，且面积不小于原环", () => {
    const land = makeLand(31337, 2);
    const hulls = landHull(land);
    expect(hulls.length).toBe(land.polygons.length);
    for (let i = 0; i < hulls.length; i += 1) {
      const ring = land.polygons[i];
      const hull = hulls[i];
      expect(hull.length).toBeGreaterThanOrEqual(3);
      for (const p of hull) {
        expect(ring.some((q) => q.x === p.x && q.y === p.y)).toBe(true);
      }
      expect(polygonArea(hull)).toBeGreaterThanOrEqual(polygonArea(ring) - 1e-6);
    }
  });

  it("凸包不自交（可直接当 voronoiCellIn 的裁剪框用）", () => {
    const land = makeLand(606, 3);
    for (const hull of landHull(land)) expect(selfIntersects(hull)).toBe(false);
  });
});
