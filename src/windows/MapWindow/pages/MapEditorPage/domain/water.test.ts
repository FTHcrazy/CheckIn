import { describe, expect, it } from "vitest";
import { buildWaterNet, type WaterCell } from "./water";
import { mulberry32 } from "./terrain-assets";
import type { TerrainKind } from "./terrain";
import type { MapLand } from "../types";

/**
 * 水系网络（2.44.0）。
 *
 * 【这些断言在保护什么】河湖是"画上去的几何"，出错的形态都很安静：
 * 河从海边往山里流、河在半路断掉、湖环套反（内环比外环大）、湖顶点出岸。
 * 观感上它们表现为"水系怪怪的"，很难一眼定位 —— 所以在纯函数层直接钉住
 * 拓扑性质，而不是等截图。
 */

const CELL = 50;

/**
 * 造一块合成格网：四边一圈是海，内部是陆地。
 *
 * @param terrain 内部格的地形（决定地势高的地方 → 河源）
 */
function synth(
  cols: number,
  rows: number,
  terrain: (col: number, row: number) => TerrainKind = () => "plain",
): WaterCell[] {
  const cells: WaterCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const isSea = col === 0 || row === 0 || col === cols - 1 || row === rows - 1;
      cells.push({
        col,
        row,
        x: (col + 0.5) * CELL,
        y: (row + 0.5) * CELL,
        land: !isSea,
        terrain: isSea ? null : terrain(col, row),
      });
    }
  }
  return cells;
}

/** 整块格网的陆地矩形（湖顶点必须落在它里面） */
function landRect(cols: number, rows: number): MapLand {
  return {
    seed: 1,
    polygons: [
      [
        { x: 0, y: 0 },
        { x: cols * CELL, y: 0 },
        { x: cols * CELL, y: rows * CELL },
        { x: 0, y: rows * CELL },
      ],
    ],
    bounds: { x: 0, y: 0, width: cols * CELL, height: rows * CELL },
  } as MapLand;
}

describe("buildWaterNet 河流", () => {
  it("每一条河都是开链、至少 3 点、且下游端点贴到海", () => {
    const cells = synth(14, 12, (col, row) => (col === 7 && row === 6 ? "mountain" : "plain"));
    const { polylines } = buildWaterNet(cells, {
      cols: 14,
      rows: 12,
      cellSize: CELL,
      rivers: 4,
      lakes: 0,
      rng: mulberry32(7),
      land: landRect(14, 12),
    });
    const rivers = polylines.filter((p) => p.kind === "river");
    expect(rivers.length).toBeGreaterThan(0);
    const seaCells = cells.filter((c) => !c.land);
    let reachSea = 0;
    for (const river of rivers) {
      expect(river.closed).toBe(false);
      expect(river.points.length).toBeGreaterThanOrEqual(3);
      expect(river.styleId).toBe("river");
      expect(river.origin).toBe("generated");
      const end = river.points[river.points.length - 1];
      // 端点落在海岸线上（最后一格陆地与第一格海的中点）⇒ 到某个海格中心
      // 的距离必须小于一格（允许抖动带来的少量偏移）
      const nearestSea = Math.min(
        ...seaCells.map((c) => Math.hypot(c.x - end.x, c.y - end.y)),
      );
      if (nearestSea < CELL * 1.1) reachSea += 1;
    }
    // 允许至多一条以"汇流"收尾（它的终点在另一条河上，不在海岸）
    expect(reachSea).toBeGreaterThanOrEqual(rivers.length - 1);
  });

  it("源头挑在高处：山地格比同尺寸的纯平原格更容易出河", () => {
    const mountain = synth(14, 12, (col, row) => (col === 7 && row === 6 ? "mountain" : "plain"));
    const flat = synth(14, 12, () => "plain");
    const a = buildWaterNet(mountain, {
      cols: 14,
      rows: 12,
      cellSize: CELL,
      rivers: 3,
      lakes: 0,
      rng: mulberry32(11),
    }).polylines.filter((p) => p.kind === "river");
    const b = buildWaterNet(flat, {
      cols: 14,
      rows: 12,
      cellSize: CELL,
      rivers: 3,
      lakes: 0,
      rng: mulberry32(11),
    }).polylines.filter((p) => p.kind === "river");
    // 山地那条必须从山格出发（首点带着 ±0.24 格抖动，按一格容差判）
    const first = a[0];
    expect(first).toBeTruthy();
    expect(Math.abs(first.points[0].x - 7.5 * CELL)).toBeLessThan(CELL);
    // 平原图仍能画出河（不至于"没有山就没水"）
    expect(b.length).toBeGreaterThan(0);
  });

  it("同 seed 同参数 ⇒ 逐点相同（独立子流可复现）", () => {
    const build = () => {
      const cells = synth(16, 14, (_col, row) => (row < 5 ? "mountain" : "plain"));
      return buildWaterNet(cells, {
        cols: 16,
        rows: 14,
        cellSize: CELL,
        rivers: 5,
        lakes: 2,
        rng: mulberry32(2026),
        land: landRect(16, 14),
      }).polylines;
    };
    expect(build()).toEqual(build());
  });

  it("rivers=0 且 lakes=0 ⇒ 一条线都不出", () => {
    const cells = synth(10, 10);
    const net = buildWaterNet(cells, {
      cols: 10,
      rows: 10,
      cellSize: CELL,
      rivers: 0,
      lakes: 0,
      rng: mulberry32(1),
    });
    expect(net.polylines).toEqual([]);
    expect(net.cells.size).toBe(0);
  });
});

describe("buildWaterNet 湖泊", () => {
  const build = (lakes: number) => {
    const cells = synth(16, 14);
    return buildWaterNet(cells, {
      cols: 16,
      rows: 14,
      cellSize: CELL,
      rivers: 0,
      lakes,
      rng: mulberry32(99),
      land: landRect(16, 14),
    });
  };

  it("一个湖 = 3 条闭合折线（外环填充 + 2 条等深线）", () => {
    const { polylines } = build(1);
    expect(polylines).toHaveLength(3);
    expect(polylines.map((p) => p.styleId)).toEqual(["lake", "lake-ring", "lake-ring"]);
    for (const p of polylines) {
      expect(p.kind).toBe("lake");
      expect(p.closed).toBe(true);
      expect(p.points.length).toBeGreaterThan(8);
    }
  });

  it("内环严格套在外环里（不会画成三个套错方向的圈）", () => {
    const { polylines } = build(1);
    const [outer, mid, inner] = polylines;
    const cx = outer.points.reduce((s, p) => s + p.x, 0) / outer.points.length;
    const cy = outer.points.reduce((s, p) => s + p.y, 0) / outer.points.length;
    const spread = (pts: { x: number; y: number }[]) =>
      Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
    expect(spread(mid.points)).toBeLessThan(spread(outer.points));
    expect(spread(inner.points)).toBeLessThan(spread(mid.points));
  });

  it("湖顶点全部落在岸内（不越出陆地）", () => {
    const { polylines } = build(2);
    const land = landRect(16, 14);
    const ring = land.polygons[0];
    for (const p of polylines) {
      for (const pt of p.points) {
        expect(pt.x).toBeGreaterThan(ring[0].x);
        expect(pt.x).toBeLessThan(ring[2].x);
        expect(pt.y).toBeGreaterThan(ring[0].y);
        expect(pt.y).toBeLessThan(ring[2].y);
      }
    }
  });

  it("湖比要求的个数少时不报错（源不够就少放）", () => {
    const { polylines } = build(8);
    expect(polylines.length % 3).toBe(0);
    expect(polylines.length / 3).toBeLessThanOrEqual(8);
  });
});
