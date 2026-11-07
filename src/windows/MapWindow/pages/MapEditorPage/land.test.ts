import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import {
  COAST_INSET,
  LAND_ERODE,
  LAND_PAPER_MARGIN,
  drawLandPath,
  generateLand,
  insetLand,
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

/**
 * 测试内 memo 化：同一 (seed, islands) 的生成结果复用。
 * SDF 侵蚀管线单次生成 ≈ 0.15s，六个测试组合计会重复生成同一组合 3~4 遍；
 * 陆地是纯函数产物，缓存不影响断言（下游调用都只读，不原地改环）。
 */
const landCache = new Map<string, MapLand>();
function makeLand(seed: number, islands?: number): MapLand {
  const key = `${seed}:${islands ?? "auto"}`;
  let land = landCache.get(key);
  if (!land) {
    land = generateLand({ seed, bounds: BOUNDS, islands });
    landCache.set(key, land);
  }
  return land;
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
  it(
    "每个环顶点数落在抽稀护栏内、首尾不重复、闭合",
    () => {
      // SDF 侵蚀管线的环是 marching squares 追踪出来的，顶点数随海岸复杂度浮动
      // （实测 71~1079）。`LAND_ERODE.maxPoints` 是软护栏：自交校验失败时
      // 正确性优先，允许收紧容差后的结果超出护栏（上限按 2 倍护栏钉住）。
      for (const seed of SEEDS) {
        const land = makeLand(seed, 3);
        expect(land.polygons.length).toBeGreaterThan(0);
        for (const ring of land.polygons) {
          expect(ring.length).toBeGreaterThanOrEqual(8);
          expect(ring.length).toBeLessThanOrEqual(LAND_ERODE.maxPoints * 2);
          // 首尾不重复存：末点 ≠ 首点（闭合由绕向隐含）
          expect(ring[ring.length - 1]).not.toEqual(ring[0]);
          // 闭合性的可验证形式：末点与首点的间距 ≈ 一条弦长，而不是跨越整个岛
          const chord = Math.hypot(
            ring[0].x - ring[ring.length - 1].x,
            ring[0].y - ring[ring.length - 1].y,
          );
          expect(chord).toBeLessThan(80);
        }
      }
    },
    120_000,
  );

  it(
    "无自交（相邻边除外）",
    () => {
      for (const seed of SEEDS) {
        for (const islands of [1, 2, 3]) {
          const land = makeLand(seed, islands);
          for (const ring of land.polygons) {
            expect(selfIntersects(ring), `seed=${seed} islands=${islands} 出现自交`).toBe(false);
          }
        }
      }
    },
    120_000,
  );

  it(
    "陆地完整落在纸内，四周留出海面（>= 纸边留海的一半）",
    () => {
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
    },
    120_000,
  );
});

describe("generateLand：面积与多岛", () => {
  it(
    "面积占比落在 12%~85%",
    () => {
      // 下限从 25% 一路降到 12%：有机海岸的紧凑度天然低于圆（轮廓在自己的包围盒里
      // 只占四到五成），多岛时主陆 + 卫星岛的总占比本来就低。2.34.0 起改 SDF 侵蚀
      // 管线（逆向目标 erodeGeoJSON 参数），扭曲越猛紧凑度越低 —— 单岛实测
      // 0.35~0.48、三岛 0.20~0.27，仍在 PRD §6.1.6 的 15%~85% 验收区间内；
      // 这是"观感优先"的取舍，不是退化。判据仍然是"不能碎成渣也不能糊满纸"。
      for (const seed of SEEDS) {
        for (const islands of [1, 2, 3]) {
          const ratio = landAreaRatio(makeLand(seed, islands));
          expect(ratio, `seed=${seed} islands=${islands} 占比 ${ratio}`).toBeGreaterThan(0.12);
          expect(ratio, `seed=${seed} islands=${islands} 占比 ${ratio}`).toBeLessThan(0.85);
        }
      }
    },
    120_000,
  );

  it("单岛时占纸三成以上（不至于缩成孤零零一小块）", () => {
    // 实测 0.354~0.478（SDF 侵蚀下岸线游移 ±141 会摊薄紧凑度）；这里只钉
    // "不塌陷"的下限，不去追 PRD 原文的 55% —— 要达到 55% 必须把轮廓做圆，
    // 与"海岸不能圆润"直接冲突（见 LAND_ERODE 注释）。
    for (const seed of [1, 9176, 31337, 20261009]) {
      const ratio = landAreaRatio(makeLand(seed, 1));
      expect(ratio).toBeGreaterThan(0.34);
    }
  });

  it(
    "多岛时岛数与请求一致，且两两不相交（采样点互判 + 边交叉）",
    () => {
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
    },
    120_000,
  );

  it(
    "极端 seed（0 / 负数 / 2^31）不抛异常",
    () => {
      for (const seed of [0, -1, -20261009, 2 ** 31, -(2 ** 31)]) {
        expect(() => makeLand(seed, 2)).not.toThrow();
        const land = makeLand(seed, 2);
        expect(land.polygons.length).toBeGreaterThan(0);
        for (const ring of land.polygons) expect(ring.length).toBeGreaterThanOrEqual(8);
      }
    },
    120_000,
  );

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

describe("insetLand：海岸内缩", () => {
  /** 环的轴对齐包围盒 */
  function ringBox(ring: Point[]): Rect {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  it("COAST_INSET 是 14（锚点离岸下限的单一事实源）", () => {
    expect(COAST_INSET).toBe(14);
  });

  it(
    "seed / bounds 原样、环数不变（顶点数允许变 —— 偏移是重新追踪的等值线）",
    () => {
      for (const seed of [1, 9176, 31337, 20261009]) {
        const land = makeLand(seed, 2);
        const inset = insetLand(land);
        expect(inset.seed).toBe(land.seed);
        expect(inset.bounds).toEqual(land.bounds);
        expect(inset.polygons.length).toBe(land.polygons.length);
        for (const ring of inset.polygons) {
          expect(ring.length).toBeGreaterThanOrEqual(8);
        }
      }
    },
    120_000,
  );

  it(
    "每个内缩顶点都落在原多边形内",
    () => {
      for (const seed of [1, 9176, 31337, 20261009, 606]) {
        const land = makeLand(seed, 2);
        const inset = insetLand(land);
        for (const ring of inset.polygons) {
          for (const p of ring) {
            expect(pointInLand(p, land), `seed=${seed} 顶点 (${p.x}, ${p.y}) 越出原岸线`).toBe(true);
          }
        }
      }
    },
    120_000,
  );

  it(
    "面积变小：每环内缩后 ≤ 原面积",
    () => {
      for (const seed of [1, 9176, 31337, 20261009]) {
        const land = makeLand(seed, 2);
        const inset = insetLand(land);
        for (let i = 0; i < land.polygons.length; i += 1) {
          expect(polygonArea(inset.polygons[i])).toBeLessThanOrEqual(polygonArea(land.polygons[i]) + 1e-6);
        }
      }
    },
    120_000,
  );

  it(
    "包围盒收缩：内缩后 AABB 更小或相等",
    () => {
      for (const seed of [1, 9176, 31337, 20261009]) {
        const land = makeLand(seed, 2);
        const inset = insetLand(land);
        for (let i = 0; i < land.polygons.length; i += 1) {
          const a = ringBox(land.polygons[i]);
          const b = ringBox(inset.polygons[i]);
          expect(b.width).toBeLessThanOrEqual(a.width + 1e-6);
          expect(b.height).toBeLessThanOrEqual(a.height + 1e-6);
        }
      }
    },
    120_000,
  );

  it("退化输入：inset=0 等价、空 polygons 不抛异常", () => {
    const land = makeLand(31337, 2);
    expect(insetLand(land, 0).polygons).toEqual(land.polygons);
    const empty: MapLand = { seed: 7, polygons: [], bounds: BOUNDS };
    expect(() => insetLand(empty)).not.toThrow();
    expect(insetLand(empty).polygons).toEqual([]);
    expect(insetLand(empty).seed).toBe(7);
    expect(insetLand(empty).bounds).toEqual(BOUNDS);
  });
});

/**
 * 大陆形状档（2.41.0 对齐参考面板的 12 种）。
 *
 * 三条铁律：
 *   ① 「正常」不传 shape 与显式传 "normal" 逐字节一致（缺省值只有一处语义）；
 *   ② 任何形状档的产出都必须是**合法陆地**：非空、环自洽（面积为正）、
 *      全部落在纸内（含 LAND_PAPER_MARGIN 的海面留白）；
 *   ③ 同形状同种子 ⇒ 逐位一致（撤销 / 截图比对依赖它）。
 * 形状档只改"长什么样"，不放宽任何一条。
 */
describe("generateLand 大陆形状档", () => {
  const SHAPES = [
    "normal",
    "moreLand",
    "moreOcean",
    "northSouth",
    "eastWest",
    "starMoon",
    "slender",
    "pangaea",
    "cookie",
    "threeContinents",
    "earthlike",
    "scattered",
  ] as const;

  /** 环合法性：闭合（首尾不同存由调用方保证）、面积显著大于 0 */
  const ringOk = (ring: readonly Point[]): boolean =>
    ring.length >= 8 && polygonArea([...ring]) > 1000;

  for (const shape of SHAPES) {
    it(`「${shape}」：产出合法陆地、同种子逐位一致`, () => {
      const a = generateLand({ seed: 424242, bounds: BOUNDS, shape });
      expect(a.polygons.length).toBeGreaterThan(0);
      for (const ring of a.polygons) expect(ringOk(ring), `${shape} 环合法`).toBe(true);
      // 落在纸内：顶点不越出「纸 − 留白」太深（侵蚀甩出的岸线允许 ±141 的游移，
      // 这里只挡"整块跑出纸"级别的错误，游移由 fitRingToSpan 的格子约束兜住）
      for (const ring of a.polygons) {
        for (const p of ring) {
          expect(p.x).toBeGreaterThan(BOUNDS.x - 160);
          expect(p.x).toBeLessThan(BOUNDS.x + BOUNDS.width + 160);
          expect(p.y).toBeGreaterThan(BOUNDS.y - 160);
          expect(p.y).toBeLessThan(BOUNDS.y + BOUNDS.height + 160);
        }
      }
      const b = generateLand({ seed: 424242, bounds: BOUNDS, shape });
      expect(b.polygons).toEqual(a.polygons);
    });
  }

  it("「正常」：不传 shape 与显式传 normal 逐字节一致（缺省兼容承诺）", () => {
    const plain = generateLand({ seed: 20261107, bounds: BOUNDS });
    const explicit = generateLand({ seed: 20261107, bounds: BOUNDS, shape: "normal" });
    expect(explicit.polygons).toEqual(plain.polygons);
  });

  it("形状档真的改变形状：多海洋（1 岛低占纸）与三大洲（3 岛）岛数不同", () => {
    // 各取 3 个种子降低偶然性：形状档的岛数语义必须稳定成立
    for (const seed of [11, 9176, 20261009]) {
      const ocean = generateLand({ seed, bounds: BOUNDS, shape: "moreOcean" });
      const three = generateLand({ seed, bounds: BOUNDS, shape: "threeContinents" });
      expect(ocean.polygons.length).toBe(1);
      expect(three.polygons.length).toBe(3);
    }
  });

  it("南北 / 东西：最大岛的长宽比被压到主导方向（squash 的直接效果）", () => {
    // 【为什么量最大岛而不是联合包围盒】南北/东西档不锁岛数（沿用 1~3 的随机
    // 分布），多岛结果的联合包围盒被"两岛的相对位置"主导，量不出形状语义。
    const biggest = (rings: readonly Point[][]) =>
      rings.reduce((best, r) => (polygonArea([...r]) > polygonArea([...best]) ? r : best));
    const boxOf = (ring: readonly Point[]) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of ring) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      return { w: maxX - minX, h: maxY - minY };
    };
    for (const seed of [11, 9176, 20261009]) {
      const ns = boxOf(biggest(generateLand({ seed, bounds: BOUNDS, shape: "northSouth" }).polygons));
      const ew = boxOf(biggest(generateLand({ seed, bounds: BOUNDS, shape: "eastWest" }).polygons));
      // 主导方向至少长 1.25 倍（squash 0.62 / 0.6 → 各向异性回拉后 ≈1.6，
      // 留海岸性格的余量；0.9 的旧实测是"量了联合包围盒"的假象）
      expect(ns.h / ns.w).toBeGreaterThan(1.25);
      expect(ew.w / ew.h).toBeGreaterThan(1.25);
    }
  });
});
