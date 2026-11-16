import { describe, expect, it } from "vitest";
import {
  SPRITE_ZONES,
  ZONE_BAND_EDGES,
  ZONE_LABELS,
  isSpriteZone,
  zoneAtY,
} from "./zones";

/**
 * 地貌带分带（AGENTS §6.6 第 4 条：纯函数必须有同名单测）。
 *
 * 分带锚点跟着**陆地**纵向范围走，而不是纸张：按纸张分带会把雪带压在海上，
 * 南北两头永远用不到。这里用 top=100 / height=400 把四个区间的边界逐段钉住。
 */
describe("地貌带", () => {
  it("四带自北向南排列，且每带都有中文名", () => {
    expect(SPRITE_ZONES).toEqual(["snow", "core", "grass", "desert"]);
    for (const zone of SPRITE_ZONES) expect(ZONE_LABELS[zone]).toBeTruthy();
  });

  it("isSpriteZone 只认枚举值", () => {
    for (const zone of SPRITE_ZONES) expect(isSpriteZone(zone)).toBe(true);
    expect(isSpriteZone("swamp")).toBe(false);
    expect(isSpriteZone(null)).toBe(false);
    expect(isSpriteZone(0)).toBe(false);
  });

  it("zoneAtY 按陆地纵向比例切出四带，边界归入后一带", () => {
    const top = 100;
    const height = 400;
    const edge = (ratio: number) => top + height * ratio;
    expect(zoneAtY(top, top, height)).toBe("snow");
    expect(zoneAtY(edge(ZONE_BAND_EDGES.snow) - 1, top, height)).toBe("snow");
    expect(zoneAtY(edge(ZONE_BAND_EDGES.snow), top, height)).toBe("core");
    expect(zoneAtY(edge(ZONE_BAND_EDGES.core) - 1, top, height)).toBe("core");
    expect(zoneAtY(edge(ZONE_BAND_EDGES.core), top, height)).toBe("grass");
    expect(zoneAtY(edge(ZONE_BAND_EDGES.desert) - 1, top, height)).toBe("grass");
    expect(zoneAtY(edge(ZONE_BAND_EDGES.desert), top, height)).toBe("desert");
    expect(zoneAtY(top + height * 2, top, height)).toBe("desert");
  });

  it("陆地包围盒退化时返回主带，不产生 NaN 分带", () => {
    expect(zoneAtY(100, 100, 0)).toBe("core");
    expect(zoneAtY(100, 100, -10)).toBe("core");
    expect(zoneAtY(100, 100, Number.NaN)).toBe("core");
  });
});
