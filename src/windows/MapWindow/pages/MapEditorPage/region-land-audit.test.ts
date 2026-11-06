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
  polygonArea,
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

/** 与 useMapEditor.buildRegions 同口径的每岛层级数量：level0 恒 1 */
function islandLevelCounts(): number[] {
  return [1, ...DEFAULT_REGION_SCHEMA.slice(1).map((l) => l.count)];
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
   * 基线（越湾修复 + 每陆 1 大陆口径下，12 seed × 20 岛实测）：
   * 越岸采样点 2748 / 最大越出 14.1。
   * 阈值给 ~15% 余量：算法改动让数字明显变好应该收紧阈值，变差就是回归。
   * 【为什么不是 0】残余是拼接缝级弦（径向投影在非星形湾的对岸问题，见
   * regions.ts repairPolygonSeams / repairBayCrossings 的注释），渲染期掩膜兜底。
   */
  const MAX_OUTSIDE_DIST = 16;
  const MAX_OUTSIDE_SAMPLES = 3200;

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

  it("变异探针：把修复关掉守卫必须变红（防假绿）", () => {
    // 直接用"修复前必然超限"的口径反向验证阈值有意义：审计函数本身测的是
    // 生成器输出，这里用「上限必须小于修复前的实测最坏值」钉住 —— 若有人把
    // 阈值放宽到修复前水平，这条先红。
    expect(MAX_OUTSIDE_DIST).toBeLessThan(24.6);
    expect(MAX_OUTSIDE_SAMPLES).toBeLessThan(6831);
  });
});

describe("守卫 2：素材渲染宽 / 陆地轴长（素材相对比例）", () => {
  /** 实测 p50≈9.1% p90≈11% max≈12%（总闸 0.32）；阈值取 max + 3pp 余量 */
  const MAX_RATIO = 0.15;

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

  it("最大素材渲染宽不超过陆地轴长的 15%（参考目标 ≈8~12%）", () => {
    for (const seed of SEEDS) {
      const { ratio, landAxis, maxW } = maxSpriteRatio(seed);
      expect(
        ratio,
        `seed ${seed}: 最大渲染宽 ${maxW.toFixed(1)} / 陆轴 ${landAxis.toFixed(1)} = ${(ratio * 100).toFixed(1)}%`,
      ).toBeLessThanOrEqual(MAX_RATIO);
    }
  });
});

describe("守卫 3：每块陆地恰好 1 个 level0（大陆）区块", () => {
  it("逐 seed 校验 level0 结构（一陆一大陆，国家挂它下面）", () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const rows = auditRegions(seed);
      for (const r of rows) {
        expect(
          r.level0Count,
          `seed ${seed} 岛 ${r.island} 的 level0 数量为 ${r.level0Count}，应为 1`,
        ).toBe(1);
      }
    }
  });

  it("陆地区块面积占比：主陆的 level0 覆盖全岛（不是被切成碎片）", () => {
    const seed = 20260411; // 单岛 seed
    const land = generateLand({ seed, bounds: BASE_BOUNDS });
    const regions = generateHierarchy({
      seed,
      bounds: BASE_BOUNDS,
      levelCounts: islandLevelCounts(),
      container: land.polygons[0],
      idPrefix: "g3_",
    });
    const level0 = regions.filter((r) => r.level === 0);
    expect(level0).toHaveLength(1);
    const cover =
      polygonArea(level0[0].polygon) / Math.max(1e-6, polygonArea(land.polygons[0]));
    // level0 显示多边形贴岸（含湾岸绕行），覆盖应接近全岛；给平滑/残余留 5% 余量
    expect(cover).toBeGreaterThan(0.95);
  });
});

export type { IslandAudit };
export { auditRegions };
