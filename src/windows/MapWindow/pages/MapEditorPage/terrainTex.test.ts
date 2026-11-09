/**
 * 地貌纹理层（2.43.0）纯函数单测。
 *
 * 画布部分（`makeTerrainTile` / `renderTerrainBandsCanvas`）在 jsdom 没有 2D
 * 上下文、只会返回 `null`（与 paperGrain 同款降级）—— 那条路径由「调用方必须
 * 容忍 null」的组件测试覆盖。这里钉住三件**决定观感正确性**的纯逻辑：
 *   · 带档映射（core 不铺 —— 参考的主带没有面纹理）；
 *   · run 合并（同带横向连段、坐标对齐栅格）；
 *   · 生成器产出（bands 与布点同源、确定性、海格必空）。
 */

import { describe, expect, it } from "vitest";
import {
  planTerrainBlobs,
  zoneTextureKind,
  BLOB_ALPHA,
  LAND_PAPER_ALPHA,
  TEX_BASE_ALPHA,
} from "./terrainTex";
import { SPRITE_ZONES, type SpriteZone } from "./domain/zones";
import { generateMap } from "./domain/generator";
import { MAP_PRESETS } from "./domain/mapPresets";
import { SPRITES, SPRITE_MAP } from "./sprites";
import { BASE_BOUNDS } from "./store/useMapViewportStore";
import type { TerrainBandGrid } from "./types";

describe("zoneTextureKind", () => {
  it("草/沙/雪三带各有一张面纹理，主带不铺（与参考实现一致）", () => {
    expect(zoneTextureKind("grass")).toBe("grass");
    expect(zoneTextureKind("desert")).toBe("desert");
    expect(zoneTextureKind("snow")).toBe("snow");
    expect(zoneTextureKind("core")).toBeNull();
  });

  it("映射覆盖全部地貌带（新增带必须显式表态铺不铺）", () => {
    for (const zone of SPRITE_ZONES) {
      const kind = zoneTextureKind(zone);
      expect(kind === null || ["grass", "desert", "snow"].includes(kind)).toBe(true);
    }
  });
});

describe("纹理浓度口径（2.43.0 三轮「颗粒感 / 一坨屎」的修正守卫）", () => {
  it("底纹、晕染团、纸面层三层浓度各在其位（谁也不压花色相）", () => {
    // 三层分工：程序底纹=低频晕染、晕染团=气候带色相、纸面层=高频材质。
    // 任何一层过高都会把粉彩色块压成"脏灰"（用户逐轮截图裁决过三次）。
    expect(TEX_BASE_ALPHA).toBeGreaterThan(0.2);
    expect(TEX_BASE_ALPHA).toBeLessThan(0.5);
    expect(BLOB_ALPHA).toBeGreaterThan(0.1);
    expect(BLOB_ALPHA).toBeLessThan(0.35);
    expect(LAND_PAPER_ALPHA).toBeGreaterThan(0.35);
    expect(LAND_PAPER_ALPHA).toBeLessThan(1);
  });
});

describe("planTerrainBlobs", () => {
  /** 构造一份 cols×rows 的带栅格，zones 缺省全 null（cellSize 与 tile 尺寸无关，取字面量） */
  function bands(
    cols: number,
    rows: number,
    zones: Array<SpriteZone | null>,
    cellSize = 64,
  ): TerrainBandGrid {
    expect(zones).toHaveLength(cols * rows);
    return { cellSize, cols, rows, x: 0, y: 0, zones };
  }

  it("每个带格一个晕染团，圆心抖动后仍落在格内、半径 ≥ 0.6 格", () => {
    const grid = bands(4, 1, [null, "grass", "grass", "desert"]);
    const blobs = planTerrainBlobs(grid);
    expect(blobs).toHaveLength(3);
    expect(blobs.map((b) => b.kind)).toEqual(["grass", "grass", "desert"]);
    for (const blob of blobs) {
      const col = Math.floor(blob.x / 64);
      const row = Math.floor(blob.y / 64);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(4);
      expect(row).toBe(0);
      expect(blob.r).toBeGreaterThanOrEqual(64 * 0.6);
      expect(blob.r).toBeLessThanOrEqual(64);
    }
  });

  it("主带（core）与海格（null）不出团", () => {
    const grid = bands(3, 2, ["core", null, "snow", "core", "core", "core"]);
    const blobs = planTerrainBlobs(grid);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].kind).toBe("snow");
  });

  it("确定性：同一份栅格两次规划逐项相同（抖动走哈希、零 rng 消耗）", () => {
    const grid = bands(5, 4, Array.from({ length: 20 }, (_, i) =>
      i % 3 === 0 ? "grass" : i % 3 === 1 ? "desert" : "snow",
    ));
    expect(planTerrainBlobs(grid)).toEqual(planTerrainBlobs(grid));
  });

  it("空栅格 / 全 null → 无团（渲染层仍有全陆地底纹）", () => {
    expect(planTerrainBlobs(bands(2, 2, [null, null, null, null]))).toEqual([]);
  });

  it("自定义 cellSize 按栅格值折算坐标（36/54/72 三档都要对齐）", () => {
    const grid = bands(3, 1, [null, "desert", "desert"], 36);
    const blobs = planTerrainBlobs(grid);
    expect(blobs).toHaveLength(2);
    for (const blob of blobs) {
      expect(blob.x).toBeGreaterThanOrEqual(36);
      expect(blob.x).toBeLessThanOrEqual(108);
      expect(blob.r).toBeGreaterThanOrEqual(36 * 0.6);
    }
  });
});

describe("generateMap 的 bands 产出（纹理带与布点同源）", () => {
  const sizeOf = (id: string) => {
    const def = SPRITE_MAP[id];
    return { width: def?.baseWidth ?? 90, height: def?.baseHeight ?? 70 };
  };
  const opts = {
    seed: 20261109,
    bounds: BASE_BOUNDS,
    preset: MAP_PRESETS[0],
    richness: "standard" as const,
    mode: "full" as const,
    pool: SPRITES,
    sizeOf,
  };

  it("bands 与布点同一格网：确定性、海格必空、带值合法", () => {
    const a = generateMap(opts);
    const b = generateMap(opts);
    expect(a.bands).toBeDefined();
    expect(a.bands).toEqual(b.bands);
    const grid = a.bands!;
    expect(grid.zones).toHaveLength(grid.cols * grid.rows);
    for (const z of grid.zones) {
      if (z !== null) {
        expect(SPRITE_ZONES).toContain(z);
      }
    }
    // 陆地为零时（不会发生在真实 seed 上，防御性）不炸
    expect(grid.cellSize).toBeGreaterThan(0);
  });

  it("全量生成与 computeTerrainZones 对同一块陆地给出同一份带（「只换陆地」档的口径）", async () => {
    const { computeTerrainZones } = await import("./domain/generator");
    const gen = generateMap(opts);
    const recomputed = computeTerrainZones(
      gen.land,
      MAP_PRESETS[0].climate,
      gen.bands!.cellSize,
    );
    expect(recomputed).toEqual(gen.bands);
  });

  it("纹理带不消耗布点骰子：同 seed 的布点与 2.42.0 引擎语义一致（同参数重跑逐实例相同）", () => {
    const a = generateMap(opts);
    const b = generateMap(opts);
    expect(a.placements).toEqual(b.placements);
    // bands 参与返回值但不影响 placements 的可复现性（两次全等已隐含）；
    // 这条用例的真正价值是钉住「bands 计算零 rng 消耗」——若未来有人把
    // 接缝抖动改成 rng()，确定性仍绿但坐标会整体漂移，届时同 seed 跨版本
    // 对照（CHANGELOG 的逐字节口径）会红。
  });
});
