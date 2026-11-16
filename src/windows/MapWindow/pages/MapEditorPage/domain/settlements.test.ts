import { describe, expect, it } from "vitest";
import {
  planSettlements,
  SETTLEMENT_SPRITES,
  settlementCountsOf,
  settlementTierOf,
  type SettlementCell,
  type SettlementSite,
  type SettlementTier,
} from "./settlements";
import { mulberry32 } from "./terrain-assets";
import type { TerrainKind } from "./terrain";

/**
 * 聚落选址（2.45.0）。
 *
 * 【为什么值得单测】选址是"看起来像不像一张地图"的分水岭：城落在海里、城与城
 * 挤在一格、村落均匀铺满全图 —— 这三种错都不会抛异常，只会在成图上显得很假。
 * 这里钉住的是四条性质：
 *   ① 只落在陆地、且避开水面；
 *   ② 层级金字塔：大城的间距最大、村落最密；
 *   ③ 城在海岸/沿河附近（逐水而居的判据真的生效）；
 *   ④ 同 seed 同结果（可复现）。
 */

const CELL = 50;

/** 造一片格子：`terrainOf` 返回 null = 空地（平原），"sea" = 海 */
function synth(
  cols: number,
  rows: number,
  terrainOf: (col: number, row: number) => TerrainKind | "sea" | null,
): SettlementCell[] {
  const cells: SettlementCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const t = terrainOf(col, row);
      cells.push({
        x: (col + 0.5) * CELL,
        y: (row + 0.5) * CELL,
        col,
        row,
        land: t !== "sea",
        terrain: t === "sea" ? null : t,
      });
    }
  }
  return cells;
}

/** 方块岛：中间陆地、四周海 */
function island(cols: number, rows: number, terrain: TerrainKind = "plain"): SettlementCell[] {
  return synth(cols, rows, (col, row) =>
    col === 0 || row === 0 || col === cols - 1 || row === rows - 1 ? "sea" : terrain,
  );
}

function plan(cells: SettlementCell[], cols: number, rows: number, seed = 7, cities = 2, towns = 4, villages = 8) {
  return planSettlements(cells, {
    cols,
    rows,
    cities,
    towns,
    villages,
    rng: mulberry32(seed),
  });
}

const tierOf = (sites: SettlementSite[], tier: SettlementTier) =>
  sites.filter((s) => s.tier === tier);

describe("planSettlements · 选址", () => {
  it("只落在陆地：海格一个不占", () => {
    const cols = 14;
    const rows = 12;
    const cells = island(cols, rows);
    const sites = plan(cells, cols, rows);
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) {
      expect(cells[s.row * cols + s.col].land, `(${s.col},${s.row}) 落在海里`).toBe(true);
    }
  });

  it("层级金字塔：城最少、村最多，且城与城之间拉得开", () => {
    const cols = 18;
    const rows = 16;
    const cells = island(cols, rows);
    const sites = plan(cells, cols, rows, 11, 2, 5, 12);
    const cities = tierOf(sites, "city");
    const towns = tierOf(sites, "town");
    const villages = tierOf(sites, "village");
    expect(cities.length).toBeGreaterThan(0);
    expect(towns.length).toBeGreaterThanOrEqual(cities.length);
    expect(villages.length).toBeGreaterThan(towns.length);

    // 城间距：至少 2 格（小图上界会收紧，这里只钉"不挨着"）
    for (let i = 0; i < cities.length; i += 1) {
      for (let j = i + 1; j < cities.length; j += 1) {
        const d = Math.abs(cities[i].col - cities[j].col) + Math.abs(cities[i].row - cities[j].row);
        expect(d, "两座大城挤在一起").toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("逐水而居：大城优先落在海岸线附近（离海 ≤ 3 格）", () => {
    const cols = 20;
    const rows = 18;
    const cells = island(cols, rows);
    const cities = tierOf(plan(cells, cols, rows, 3, 3, 0, 0), "city");
    expect(cities.length).toBeGreaterThan(0);
    for (const c of cities) {
      // 方块岛：到最近海格的曼哈顿距离
      const toSea = Math.min(c.col, c.row, cols - 1 - c.col, rows - 1 - c.row);
      expect(toSea, `大城 (${c.col},${c.row}) 离海 ${toSea} 格`).toBeLessThanOrEqual(3);
    }
  });

  it("避开水面格：河湖占住的格不落聚落", () => {
    const cols = 12;
    const rows = 12;
    const cells = island(cols, rows);
    // 中间一条竖河（4 列宽 1）：河格不进候选
    const water = new Set<number>();
    for (let row = 0; row < rows; row += 1) {
      const i = row * cols + 6;
      water.add(i);
      cells[i].terrain = "river";
    }
    const sites = planSettlements(cells, {
      cols,
      rows,
      cities: 2,
      towns: 4,
      villages: 10,
      rng: mulberry32(5),
      waterCells: water,
    });
    for (const s of sites) {
      expect(water.has(s.row * cols + s.col), `(${s.col},${s.row}) 落在河上`).toBe(false);
    }
  });

  it("同 seed 同选址；换 seed 换选址", () => {
    const cols = 16;
    const rows = 14;
    const cells = island(cols, rows);
    const a = plan(cells, cols, rows, 42);
    const b = plan(cells, cols, rows, 42);
    const c = plan(cells, cols, rows, 43);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("参数为 0 或没有陆地时不炸", () => {
    const cols = 8;
    const rows = 8;
    const sea = synth(cols, rows, () => "sea");
    expect(planSettlements(sea, { cols, rows, cities: 3, towns: 3, villages: 3, rng: mulberry32(1) })).toEqual([]);
    const land = island(cols, rows);
    expect(planSettlements(land, { cols, rows, cities: 0, towns: 0, villages: 0, rng: mulberry32(1) })).toEqual([]);
  });
});

describe("planSettlements · 落点抖动", () => {
  const cols = 16;
  const rows = 14;

  it("给了 inside ⇒ 落点偏离格心（否则路网是一张格网拼图）", () => {
    const cells = island(cols, rows);
    const sites = planSettlements(cells, {
      cols,
      rows,
      cities: 2,
      towns: 4,
      villages: 10,
      rng: mulberry32(21),
      inside: () => true,
    });
    expect(sites.length).toBeGreaterThan(0);
    const offCenter = sites.filter((s) => {
      const c = cells[s.row * cols + s.col];
      return Math.hypot(s.x - c.x, s.y - c.y) > CELL * 0.02;
    });
    // 抖动量是哈希给的：不该有哪个点恰好留在格心（全都在格心 = 抖动没生效）
    expect(offCenter.length).toBe(sites.length);
    // 抖幅不超过 0.34 格：跨格会让两个聚落贴脸（间距判定是按格算的）
    for (const s of sites) {
      const c = cells[s.row * cols + s.col];
      expect(Math.abs(s.x - c.x)).toBeLessThanOrEqual(CELL * 0.35);
      expect(Math.abs(s.y - c.y)).toBeLessThanOrEqual(CELL * 0.35);
    }
  });

  it("inside 说岸外 ⇒ 退回格心（宁可精确，也不落海）", () => {
    const cells = island(cols, rows);
    const sites = planSettlements(cells, {
      cols,
      rows,
      cities: 2,
      towns: 3,
      villages: 6,
      rng: mulberry32(21),
      inside: () => false,
    });
    for (const s of sites) {
      const c = cells[s.row * cols + s.col];
      expect(s.x).toBe(c.x);
      expect(s.y).toBe(c.y);
    }
  });

  it("不给 inside ⇒ 与 2.44.0 一致：落点就是格心", () => {
    const cells = island(cols, rows);
    for (const s of plan(cells, cols, rows)) {
      const c = cells[s.row * cols + s.col];
      expect(s.x).toBe(c.x);
      expect(s.y).toBe(c.y);
    }
  });
});

describe("settlementCountsOf · 份额换算", () => {
  it("份额为 0 = 一张聚落都不出", () => {
    expect(settlementCountsOf(0)).toEqual({ cities: 0, towns: 0, villages: 0 });
  });

  it("份额越大各层都只增不减（滑杆往右是「更多城」）", () => {
    const counts = [1, 3, 6, 12, 20].map((share) => settlementCountsOf(share));
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i].cities).toBeGreaterThanOrEqual(counts[i - 1].cities);
      expect(counts[i].towns).toBeGreaterThanOrEqual(counts[i - 1].towns);
      expect(counts[i].villages).toBeGreaterThanOrEqual(counts[i - 1].villages);
    }
  });

  it("有上限（一张图不该冒出二十座大城）", () => {
    const huge = settlementCountsOf(500);
    expect(huge.cities).toBeLessThanOrEqual(5);
    expect(huge.towns).toBeLessThanOrEqual(14);
    expect(huge.villages).toBeLessThanOrEqual(120);
  });
});

describe("settlementTierOf · spriteId → 层级", () => {
  it("三层各自的优先级链成员都能认出来", () => {
    for (const tier of ["city", "town", "village"] as const) {
      for (const id of SETTLEMENT_SPRITES[tier]) {
        // 同一个 id 可能同时出现在两条链上（village-a 既是镇也是村），按优先顺序先命中 city → town → village
        const hit = settlementTierOf(id);
        expect(hit, `${id} 认不出层级`).not.toBeNull();
      }
    }
  });

  it("非聚落素材 → null（道路重建时不能把山当成村子）", () => {
    expect(settlementTierOf("mountain-a")).toBeNull();
    expect(settlementTierOf("river")).toBeNull();
  });
});
