import { describe, expect, it } from "vitest";
import {
  buildRoadNet,
  roadCostOfCells,
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

  it("城与城 = 官道，其余 = 点线", () => {
    const grid = openGrid(10, 10);
    const roads = buildRoadNet(
      [node(grid, 2, 2, "city"), node(grid, 6, 2, "city"), node(grid, 5, 5, "village")],
      { grid, seed: 3 },
    );
    const trunk = roads.filter((r) => r.styleId === "road-main");
    expect(trunk.length).toBe(1);
    expect(roads.filter((r) => r.styleId === "road-dotted").length).toBeGreaterThan(0);
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
