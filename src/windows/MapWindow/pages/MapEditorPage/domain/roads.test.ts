import { describe, expect, it } from "vitest";
import {
  POLYLINE_WIDTH_SCALE_MAX,
  POLYLINE_WIDTH_SCALE_MIN,
  effectiveWidthWorld,
  polylineStyleOf,
} from "../polylineStyle";
import type { MapPolyline } from "../types";
import {
  buildRoadNet,
  roadCostOfCells,
  roadGradeOf,
  roadGridOfLand,
  type RoadGrid,
  type RoadNode,
} from "./roads";

/**
 * 道路网（2.45.0）。
 *
 * 【为什么值得单测】路网错得很安静：绕远、穿山、横渡湖面、端点差一格 ——
 * 都能画出来，只是看起来"不像一张地图"。这里钉四条：
 *   ① 连通：N 个聚落至少 N-1 条边（生成树）；
 *   ② 不穿不可通行格（海 / 湖）；
 *   ③ 会绕路：挡一堵墙，路径必须变长而不是穿墙；
 *   ④ 端点精确落在聚落上（差一格是明显的穿帮）。
 */

const CELL = 50;

/** 全通行的方块格网 */
function openGrid(cols: number, rows: number, cost = 1): RoadGrid {
  return {
    cols,
    rows,
    cellSize: CELL,
    x: 0,
    y: 0,
    cost: new Array<number>(cols * rows).fill(cost),
  };
}

/** 格心坐标的节点 */
function node(grid: RoadGrid, col: number, row: number, tier: RoadNode["tier"]): RoadNode {
  return {
    col,
    row,
    tier,
    x: grid.x + (col + 0.5) * grid.cellSize,
    y: grid.y + (row + 0.5) * grid.cellSize,
  };
}

/** 点落在哪一格（与 `RoadGrid` 同口径） */
function cellOf(grid: RoadGrid, p: { x: number; y: number }): number {
  const col = Math.floor((p.x - grid.x) / grid.cellSize);
  const row = Math.floor((p.y - grid.y) / grid.cellSize);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return -1;
  return row * grid.cols + col;
}

describe("roadCostOfCells · 地形代价", () => {
  it("海与湖不可通行；山地远贵于平原；空地按平原", () => {
    const cost = roadCostOfCells(["sea", "lake", "mountain", "plain", null]);
    expect(cost[0]).toBe(Number.POSITIVE_INFINITY);
    expect(cost[1]).toBe(Number.POSITIVE_INFINITY);
    expect(cost[2]).toBeGreaterThan(cost[3] * 3);
    expect(cost[4]).toBe(cost[3]);
  });

  it("河可以过（桥），但比平原贵", () => {
    const [river, plain] = roadCostOfCells(["river", "plain"]);
    expect(Number.isFinite(river)).toBe(true);
    expect(river).toBeGreaterThan(plain);
  });
});

describe("buildRoadNet · 拓扑", () => {
  it("邻近的聚落两两相连，且每条边都不超过距离上限", () => {
    const grid = openGrid(12, 12);
    const nodes = [
      node(grid, 2, 2, "city"),
      node(grid, 5, 3, "town"),
      node(grid, 4, 6, "village"),
      node(grid, 7, 6, "village"),
    ];
    const roads = buildRoadNet(nodes, { grid, seed: 1 });
    expect(roads.length).toBeGreaterThanOrEqual(2);
    expect(roads.every((r) => r.origin === "generated")).toBe(true);
    expect(roads.every((r) => r.closed === false)).toBe(true);
    for (const r of roads) {
      const head = r.points[0];
      const tail = r.points[r.points.length - 1];
      expect(Math.hypot(tail.x - head.x, tail.y - head.y)).toBeLessThanOrEqual(4.5 * CELL);
    }
  });

  it("隔得太远的聚落不连（否则整张图会变成一张蜘蛛网）", () => {
    const grid = openGrid(24, 24);
    const roads = buildRoadNet(
      [node(grid, 1, 1, "village"), node(grid, 20, 20, "village")],
      { grid, seed: 1 },
    );
    expect(roads).toEqual([]);
  });

  it("城与城 = 官道（最粗一档），其余 = 更细的点线", () => {
    const grid = openGrid(10, 10);
    const roads = buildRoadNet(
      [node(grid, 2, 2, "city"), node(grid, 6, 2, "city"), node(grid, 5, 5, "village")],
      { grid, seed: 3 },
    );
    // 2.48.0 起等级只剩 `widthScale`：官道 1.2、含村落 0.8
    const trunk = roads.filter((r) => (r.widthScale ?? 1) >= 1.1);
    expect(trunk.length).toBe(1);
    expect(trunk[0].styleId).toBe("road-dotted");
    expect(roads.filter((r) => (r.widthScale ?? 1) < 1).length).toBeGreaterThan(0);
  });

  it("少于两个聚落 = 没有路（一条没有去处的线不该存在）", () => {
    const grid = openGrid(6, 6);
    expect(buildRoadNet([node(grid, 2, 2, "city")], { grid })).toEqual([]);
    expect(buildRoadNet([], { grid })).toEqual([]);
  });

  it("孤立聚落补一条最近边（稀疏处不能有房子却没路）", () => {
    // 两个村落隔 8 格：超过局部连边的 4 格上限，但仍在最近补边上限（14 格）内
    const grid = openGrid(20, 6);
    const roads = buildRoadNet(
      [node(grid, 2, 2, "village"), node(grid, 10, 2, "village")],
      { grid, seed: 5 },
    );
    expect(roads).toHaveLength(1);
    expect(roads[0].styleId).toBe("road-dotted");
  });

  it("补边也有上限：隔 17 格的两个点仍然不连", () => {
    const grid = openGrid(24, 8);
    const roads = buildRoadNet(
      [node(grid, 1, 2, "village"), node(grid, 18, 2, "village")],
      { grid, seed: 5 },
    );
    expect(roads).toEqual([]);
  });

  it("同参数同结果（重绘不跳线）", () => {
    const grid = openGrid(12, 10);
    const nodes = [node(grid, 1, 1, "city"), node(grid, 9, 8, "town"), node(grid, 3, 8, "village")];
    const a = buildRoadNet(nodes, { grid, seed: 9 });
    const b = buildRoadNet(nodes, { grid, seed: 9 });
    expect(a).toEqual(b);
  });
});

describe("buildRoadNet · 几何", () => {
  it("端点精确落在聚落坐标上", () => {
    const grid = openGrid(10, 10);
    const city = node(grid, 3, 3, "city");
    const town = node(grid, 5, 5, "town");
    const roads = buildRoadNet([city, town], { grid, seed: 2 });
    expect(roads).toHaveLength(1);
    const pts = roads[0].points;
    const head = pts[0];
    const tail = pts[pts.length - 1];
    expect(Math.hypot(head.x - city.x, head.y - city.y)).toBeLessThan(0.001);
    expect(Math.hypot(tail.x - town.x, tail.y - town.y)).toBeLessThan(0.001);
  });

  it("不穿不可通行格：中间挡一堵墙，路径绕开且变长", () => {
    const cols = 11;
    const rows = 9;
    const grid = openGrid(cols, rows);
    const blocked = new Set<number>();
    // 竖墙：第 4 列全封（第 0 行留一个口子）。起终点都在墙的**同一侧之外**，
    // 所以必须绕到第 0 行过口子 —— 终点若落在墙上，测的就不是"绕路"而是"不可达"。
    for (let row = 1; row < rows; row += 1) blocked.add(row * cols + 4);
    const walled: RoadGrid = {
      ...grid,
      cost: grid.cost.map((c, i) => (blocked.has(i) ? Number.POSITIVE_INFINITY : c)),
    };
    const from = node(walled, 2, 4, "city");
    const to = node(walled, 6, 4, "town");
    const roads = buildRoadNet([from, to], { grid: walled, seed: 4 });
    expect(roads).toHaveLength(1);
    const pts = roads[0].points;
    for (const p of pts) {
      const idx = cellOf(walled, p);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(walled.cost[idx]), `路径经过封死格 ${idx}`).toBe(true);
    }
    // 直连长度 ≈ 4 格（等于距离上限）；绕到第 0 行 ≈ 12 格，必须明显更长
    const roadLength = pts.slice(1).reduce((acc, p, i) => acc + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    expect(roadLength).toBeGreaterThan(4.5 * CELL);
  });

  it("两块陆地之间没有路（不可达就整条不画，不留半截）", () => {
    const cols = 10;
    const rows = 5;
    const grid = openGrid(cols, rows);
    const cost = grid.cost.map((c, i) => (i % cols === 4 || i % cols === 5 ? Number.POSITIVE_INFINITY : c));
    const split: RoadGrid = { ...grid, cost };
    const roads = buildRoadNet(
      [node(split, 1, 2, "city"), node(split, 5, 2, "town")],
      { grid: split, seed: 1 },
    );
    expect(roads).toEqual([]);
  });
});

describe("道路主次分级（2.47.0；2.48.0 改为三档同一点线）", () => {
  /** 一条路在 100% 缩放下的**实际世界线宽**（含样式档宽度 × 倍数） */
  const worldWidthOf = (line: MapPolyline): number =>
    effectiveWidthWorld(polylineStyleOf(line.styleId, line.kind), line.widthScale, 1);

  /** 造一条只连两个点的路（距离 3 格，必连） */
  const roadOf = (a: RoadNode["tier"], b: RoadNode["tier"]): MapPolyline => {
    const grid = openGrid(10, 10);
    const roads = buildRoadNet([node(grid, 2, 2, a), node(grid, 5, 2, b)], { grid, seed: 7 });
    expect(roads, `${a} → ${b} 应该连出一条路`).toHaveLength(1);
    return roads[0];
  };

  it("两端层级 → 等级：城-城官道 / 城-镇·镇-镇支线 / 含村为村道", () => {
    expect(roadGradeOf("city", "city")).toBe("trunk");
    expect(roadGradeOf("city", "town")).toBe("branch");
    expect(roadGradeOf("town", "city")).toBe("branch"); // 顺序无关
    expect(roadGradeOf("town", "town")).toBe("branch");
    expect(roadGradeOf("city", "village")).toBe("local");
    expect(roadGradeOf("town", "village")).toBe("local");
    expect(roadGradeOf("village", "village")).toBe("local");
  });

  it("三档全部是点线（参考 line_type:2），只靠宽度倍数分主次", () => {
    // 【2.48.0 改口径】逆向目标的路网只有一种样式 `{size:2, line_type:2}`；
    // 官道双线是手绘笔刷的事（`road-main` 仍留在样式表里给手画用）。
    // 三档若有一档走别的样式档，缩到整图就会出现"比山脉还粗的缎带"（用户截图）。
    for (const [a, b] of [
      ["city", "city"],
      ["city", "town"],
      ["town", "town"],
      ["village", "village"],
    ] as const) {
      expect(roadOf(a, b).styleId, `${a} → ${b}`).toBe("road-dotted");
    }
    // 倍数本身即等级：1.2 / 1.0 / 0.8
    expect(roadOf("city", "city").widthScale).toBe(1.2);
    expect(roadOf("city", "town").widthScale).toBe(1);
    expect(roadOf("village", "village").widthScale).toBe(0.8);
  });

  it("实际世界线宽：官道 > 支线 > 村道，且都不超过参考量级的 1.25 倍", () => {
    // 【为什么量实际宽度而不是倍数字面量】观感目标是"读得出主次"，
    // 而实际宽度 = 样式档 width × 倍数 —— 改了样式档 width 却没改倍数时，
    // 倍数关系可能还"看着对"但主次已经颠倒。
    const trunk = worldWidthOf(roadOf("city", "city"));
    const branch = worldWidthOf(roadOf("city", "town"));
    const local = worldWidthOf(roadOf("village", "village"));
    expect(trunk).toBeGreaterThan(branch);
    expect(branch).toBeGreaterThan(local);
    // 支线至少比村道粗 20%，否则整图上读不出差别
    expect(branch / local).toBeGreaterThan(1.2);
    // 【上限】参考的点线是 `size: 2`（页面单位 ≈ 本项目世界单位）。
    // 2.45~2.47 的官道是 6 世界单位 —— 三倍，成图上就是一条缎带。
    expect(trunk).toBeLessThanOrEqual(2.5);
    expect(local).toBeGreaterThanOrEqual(1.5);
  });

  it("倍数都落在属性面板滑杆区间内（用户拖得回去）", () => {
    for (const road of [
      roadOf("city", "city"),
      roadOf("city", "town"),
      roadOf("village", "village"),
    ]) {
      expect(road.widthScale).toBeGreaterThanOrEqual(POLYLINE_WIDTH_SCALE_MIN);
      expect(road.widthScale).toBeLessThanOrEqual(POLYLINE_WIDTH_SCALE_MAX);
    }
  });

  it("城与城不连成完全图：5 座城的平均度数显著低于 4", () => {
    // 【为什么钉这条】2.45.0 用完全图（K5 = 10 条边），四张图看下来城与城之间
    // 是一个凸多边形边框 —— 观感是"画了几何图形"而不是"这里有官道网"。
    // 2.47.0 改成"每城连最近 2 城"、2.48.0 再把主动发边收到 1 条。
    const grid = openGrid(20, 12);
    const roads = buildRoadNet(
      [
        node(grid, 2, 2, "city"),
        node(grid, 8, 2, "city"),
        node(grid, 14, 2, "city"),
        node(grid, 5, 8, "city"),
        node(grid, 11, 8, "city"),
      ],
      { grid, seed: 3 },
    );
    // 【怎么认出官道】三档共用点线样式，等级只剩 `widthScale` 这一个可观测差异
    const trunk = roads.filter((r) => (r.widthScale ?? 1) >= 1.1);
    expect(trunk.length).toBeLessThan(10); // 完全图会是 C(5,2) = 10 条
    expect(trunk.length).toBeGreaterThanOrEqual(2); // 仍要成网，不能退化成孤立点
    // 【为什么量平均度数而不是边数】每座城主动连最近 1~2 城，去重后边数的上界是
    // 2n 而不是 n（距离打平时两座城会各连一条出去），拿具体条数当断言很脆。
    // 而"完全图"的定义性质就是**平均度数 = n-1 = 4**：稀疏网必须显著低于它。
    const avgDegree = (2 * trunk.length) / 5;
    expect(avgDegree).toBeLessThan(4);
  });

  it("等级只看层级、不看长度：绕远的城-镇仍是支线", () => {
    const grid = openGrid(12, 12);
    // 城到镇 6 格（接近局部上限），比上面那条 3 格的官道还长
    const roads = buildRoadNet(
      [node(grid, 1, 1, "city"), node(grid, 7, 1, "town")],
      { grid, seed: 7 },
    );
    expect(roads).toHaveLength(1);
    expect(roads[0].styleId).toBe("road-dotted");
    expect(roads[0].widthScale).toBe(roadOf("city", "town").widthScale);
  });
});

describe("roadGridOfLand · 「只换陆地」档的代价表", () => {
  /**
   * L 形陆地：包围盒右下角是缺口。
   *
   * 【为什么要用凹形】格网贴着**陆地包围盒**铺，凸形陆地的每个格心都在岸内 ——
   * 那种形状测不出"海格不可通行"，必须有一个真缺口。
   */
  const land = {
    seed: 1,
    bounds: { x: 0, y: 0, width: 400, height: 400 },
    polygons: [
      [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 200 },
        { x: 200, y: 200 },
        { x: 200, y: 300 },
        { x: 100, y: 300 },
      ],
    ],
  };

  it("陆地可通行、缺口（海外）不可通行", () => {
    const grid = roadGridOfLand(land, 50);
    expect(grid.cols * grid.rows).toBe(grid.cost.length);
    expect(grid.cost.some((c) => Number.isFinite(c))).toBe(true);
    expect(grid.cost.some((c) => !Number.isFinite(c))).toBe(true);
    // 左上区（陆地）必须可通行
    const col = Math.floor((120 - grid.x) / grid.cellSize);
    const row = Math.floor((120 - grid.y) / grid.cellSize);
    expect(Number.isFinite(grid.cost[row * grid.cols + col])).toBe(true);
    // 右下缺口（海上）必须不可通行
    const c2 = Math.floor((280 - grid.x) / grid.cellSize);
    const r2 = Math.floor((280 - grid.y) / grid.cellSize);
    expect(Number.isFinite(grid.cost[r2 * grid.cols + c2])).toBe(false);
  });
});
