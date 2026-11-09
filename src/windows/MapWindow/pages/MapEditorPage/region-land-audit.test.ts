/**
 * 区块 × 陆地 几何守卫（对齐逆向目标的三个症状）。
 *
 * 守卫三件事：
 *  1) region 边越出所属陆地环的幅度有上限 —— "区块线不贴岸/穿湾"的量化
 *     （生成器侧：regions.ts 的径向投影 + 越湾绕行修复；残余 ≤ ~10 单位的
 *     拼接缝弦由渲染期陆地掩膜裁掉，见 MapCanvas 的 regionMask）
 *  2) 素材渲染宽 / 陆地轴长有上限 —— "素材相对陆地过大"的量化
 *  3) 每块陆地恰好 1 个 level0（大陆）区块 —— "一个大陆有多个国家"的结构前提
 *
 * 引擎确定性：同 seed 同结果，数字是**实测值钉死**，改动算法必须有意。
 */
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60000 });

import { generateLand } from "./land";
import { BASE_BOUNDS } from "./store/useMapViewportStore";
import {
  DEFAULT_REGION_SCHEMA,
  generateHierarchy,
  pointInPolygon,
  type Point,
} from "./regions";
import { generateMap } from "./domain/generator";
import { MAP_PRESETS } from "./domain/mapPresets";
import { SPRITES, SPRITE_MAP } from "./sprites";

const SEEDS = [42, 20260411, 1, 2, 3, 7, 13, 99, 777, 31337, 555, 8888];

const sizeOf = (id: string) => {
  const def = SPRITE_MAP[id];
  return { width: def?.baseWidth ?? 90, height: def?.baseHeight ?? 70 };
};

/**
 * 与 `useMapEditor.buildRegions` 同口径的每岛层级数量。
 *
 * 2.40.0 起 level0 是**国家**、按面积分摊（不再"每岛 1 块大陆"），单岛时 share = 1
 * ⇒ 与 schema 逐值相同。
 */
function islandLevelCounts(): number[] {
  return DEFAULT_REGION_SCHEMA.map((l) => l.count);
}

/** 点到多边形边界的最短距离（审计容差用，不追求精度） */
function distToRing(p: Point, ring: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < best) best = d;
  }
  return best;
}

interface IslandAudit {
  seed: number;
  island: number;
  level0Count: number;
  totalRegions: number;
  outsideSegments: number;
  maxOutsideDist: number;
}

function auditRegions(seed: number): IslandAudit[] {
  const land = generateLand({ seed, bounds: BASE_BOUNDS });
  const out: IslandAudit[] = [];
  land.polygons.forEach((ring, i) => {
    const regions = generateHierarchy({
      seed,
      bounds: BASE_BOUNDS,
      levelCounts: islandLevelCounts(),
      container: ring,
      idPrefix: `i${i}_`,
    });
    let outsideSegments = 0;
    let maxOutsideDist = 0;
    for (const region of regions) {
      const poly = region.polygon;
      for (let k = 0; k < poly.length; k += 1) {
        const a = poly[k];
        const b = poly[(k + 1) % poly.length];
        for (const t of [0.25, 0.5, 0.75]) {
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          const d = distToRing(p, ring);
          if (!pointInPolygon(p, ring) && d > 1.0) {
            outsideSegments += 1;
            if (d > maxOutsideDist) maxOutsideDist = d;
          }
        }
      }
    }
    out.push({
      seed,
      island: i,
      level0Count: regions.filter((r) => r.level === 0).length,
      totalRegions: regions.length,
      outsideSegments,
      maxOutsideDist: Math.round(maxOutsideDist * 10) / 10,
    });
  });
  return out;
}

describe("守卫 1：区块线与陆地环的贴合度", () => {
  /**
   * 【2.41.0 起基线 = 0 / 0】改用可切分的半平面裁剪（`regions.ts` 的
   * `clipHalfPlanePieces`）之后，单元是**精确裁剪**出来的：贴岸段就是陆地环
   * 本身的那一段，内部边被"离岸余量"封顶，因此几乎没有采样点落在环外
   * （12 seed × 20 岛实测越岸点 **110**、最大越出 **2.9**；单 seed 多为 0）。
   *
   * 之前的两条数值（2748 / 14.1）是"单环 + 径向投影 + 越湾绕行"那套补丁的
   * 基线 —— 补丁本身就是在替 S-H 的单环假设兜底，如今整套都删了。
   * 阈值给 0 附近一点余量（浮点、退化交点），一旦算法回退到"沿裁剪线拉弦"
   * 立刻成百上千地红。
   */
  const MAX_OUTSIDE_DIST = 4;
  const MAX_OUTSIDE_SAMPLES = 300;

  it("越岸采样点数与最大越出幅度都在基线内", () => {
    const rows: IslandAudit[] = [];
    for (const seed of SEEDS) rows.push(...auditRegions(seed));
    const totalOutside = rows.reduce((s, r) => s + r.outsideSegments, 0);
    const worst = rows.reduce((a, b) => (b.maxOutsideDist > a.maxOutsideDist ? b : a));
    expect(
      totalOutside,
      `越岸采样点 ${totalOutside} > ${MAX_OUTSIDE_SAMPLES}（12 seed 合计）——区块线贴岸退化`,
    ).toBeLessThanOrEqual(MAX_OUTSIDE_SAMPLES);
    expect(
      worst.maxOutsideDist,
      `最大越出 ${worst.maxOutsideDist}(seed ${worst.seed} 岛 ${worst.island}) > ${MAX_OUTSIDE_DIST} ——穿湾弦回归`,
    ).toBeLessThanOrEqual(MAX_OUTSIDE_DIST);
  });

  it("变异探针：阈值必须远小于「单环拉弦」时代的实测值（防假绿）", () => {
    // 审计函数测的是生成器输出，本身不会红；这里用"上限必须远小于历史最坏值"
    // 反向证明阈值有意义 —— 若有人嫌红把阈值放宽回 16 / 3200，这条先红。
    expect(MAX_OUTSIDE_DIST).toBeLessThan(6);
    expect(MAX_OUTSIDE_SAMPLES).toBeLessThan(600);
  });
});

describe("守卫 2：素材渲染宽 / 陆地轴长（素材相对比例）", () => {
  /** 实测 p50≈5% max≈6.7%（总闸 0.18，2.43.0 仙侠体量档）；阈值取 max + 3pp 余量 */
  const MAX_RATIO = 0.1;

  function maxSpriteRatio(seed: number): { ratio: number; landAxis: number; maxW: number } {
    const gen = generateMap({
      seed,
      bounds: BASE_BOUNDS,
      preset: MAP_PRESETS[0],
      richness: "standard",
      mode: "full",
      pool: SPRITES,
      sizeOf,
    });
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ring of gen.land.polygons) {
      for (const p of ring) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    const landAxis = Math.max(1, maxX - minX, maxY - minY);
    let maxW = 0;
    for (const p of gen.placements) {
      maxW = Math.max(maxW, sizeOf(p.spriteId).width * p.scale);
    }
    return { ratio: maxW / landAxis, landAxis, maxW };
  }

  it("最大素材渲染宽不超过陆地轴长的 10%（2.43.0 仙侠体量档：小而密，参考 w=.15 档）", () => {
    for (const seed of SEEDS) {
      const { ratio, landAxis, maxW } = maxSpriteRatio(seed);
      expect(
        ratio,
        `seed ${seed}: 最大渲染宽 ${maxW.toFixed(1)} / 陆轴 ${landAxis.toFixed(1)} = ${(ratio * 100).toFixed(1)}%`,
      ).toBeLessThanOrEqual(MAX_RATIO);
    }
  });
});

describe("守卫 3：level0（国家）铺满陆地、顶层不再是「一陆一块」", () => {
  /**
   * 【口径变更（2.40.0）】旧守卫钉的是"每块陆地恰好 1 个 level0"——那时 level0 是
   * 大陆，一块陆地切成 2~3 个"大陆"确实是缺陷。砍掉大陆/洲之后 level0 变成**国家**，
   * "一块陆地上有十几个国家"才是目标，于是守卫改成两条**结构性**判据：
   *   ① 数量对得上（不因为岛屿被切成碎片而多切或少切）；
   *   ② 面积上**铺满**这块陆地（不是只覆盖一角、也不是叠着好几层）。
   * 第 ② 条用网格采样算并集覆盖率，比"单块面积占比"更贴近"铺满"这件事。
   */
  it("逐 seed：每个岛的 level0 数量 = schema 的国家数", () => {
    const want = islandLevelCounts()[0];
    for (const seed of SEEDS.slice(0, 6)) {
      const rows = auditRegions(seed);
      for (const r of rows) {
        expect(
          r.level0Count,
          `seed ${seed} 岛 ${r.island} 的 level0 数量为 ${r.level0Count}，应为 ${want}`,
        ).toBe(want);
      }
    }
  });

  it("陆地覆盖：level0 的并集铺满全岛（网格采样覆盖率 > 0.97）", () => {
    const seed = 20260411; // 单岛 seed
    const land = generateLand({ seed, bounds: BASE_BOUNDS });
    const ring = land.polygons[0];
    const regions = generateHierarchy({
      seed,
      bounds: BASE_BOUNDS,
      levelCounts: islandLevelCounts(),
      container: ring,
      idPrefix: "g3_",
    });
    const level0 = regions.filter((r) => r.level === 0);
    expect(level0).toHaveLength(islandLevelCounts()[0]);

    let inside = 0;
    let covered = 0;
    const N = 60;
    const bb = ring.reduce(
      (acc, p) => ({
        minX: Math.min(acc.minX, p.x),
        maxX: Math.max(acc.maxX, p.x),
        minY: Math.min(acc.minY, p.y),
        maxY: Math.max(acc.maxY, p.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );
    for (let i = 0; i < N; i += 1) {
      for (let j = 0; j < N; j += 1) {
        const p = {
          x: bb.minX + ((i + 0.5) / N) * (bb.maxX - bb.minX),
          y: bb.minY + ((j + 0.5) / N) * (bb.maxY - bb.minY),
        };
        if (!pointInPolygon(p, ring)) continue;
        inside += 1;
        if (level0.some((r) => pointInPolygon(p, r.polygon))) covered += 1;
      }
    }
    // 岸线附近留 3% 余量（显示多边形贴岸有 ≤ 十几单位的残余，见守卫 1）
    expect(covered / Math.max(1, inside), "level0 并集覆盖率").toBeGreaterThan(0.97);
  });
});

export type { IslandAudit };
export { auditRegions };
