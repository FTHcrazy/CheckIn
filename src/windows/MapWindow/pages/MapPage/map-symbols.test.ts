/**
 * 地形配色/描边色板单测（AGENTS.md 6.6）
 *
 * 色板是「Canvas2D 回退 / GL shader uniform / PNG 导出图例 / 地形图例」四处共用的
 * 单一事实源，长度或格式一旦不一致就会出现「某处掉色」这种极难定位的问题，
 * 因此这里把不变量钉死。
 */
import { describe, expect, it } from "vitest";
import {
  COAST_LINE,
  COAST_SAND,
  FLUID_TERRAIN,
  TERRAIN_BORDER_COLORS,
  TERRAIN_COLORS,
  WATER_TERRAIN,
} from "./map-symbols";

const HEX = /^#[0-9a-f]{6}$/i;

describe("TERRAIN_COLORS / TERRAIN_BORDER_COLORS", () => {
  it("两者长度一致且都是合法 6 位十六进制", () => {
    expect(TERRAIN_BORDER_COLORS.length).toBe(TERRAIN_COLORS.length);
    for (const c of TERRAIN_COLORS) expect(c).toMatch(HEX);
    for (const c of TERRAIN_BORDER_COLORS) expect(c).toMatch(HEX);
  });

  it("描边色必须比底色更深（设计稿的「墨线」语义）", () => {
    const lum = (hex: string) => {
      const v = parseInt(hex.slice(1), 16);
      return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
    };
    // 雪原/雪山是浅色地貌，其描边（#aec6da / #6f8298）确实更深；
    // 全部 10 类都应满足「描边不比底色亮」
    TERRAIN_BORDER_COLORS.forEach((border, i) => {
      expect(lum(border)).toBeLessThanOrEqual(lum(TERRAIN_COLORS[i]) + 1);
    });
  });
});

describe("海岸配色", () => {
  it("沙带与岸线都是合法色值且彼此可区分", () => {
    expect(COAST_SAND).toMatch(HEX);
    expect(COAST_LINE).toMatch(HEX);
    expect(COAST_SAND).not.toBe(COAST_LINE);
  });
});

describe("水域判定", () => {
  it("WATER_TERRAIN 只含海 / 湖 / 河（不含熔岩，岩浆不算海岸）", () => {
    expect([...WATER_TERRAIN]).toEqual([0, 1, 2]);
    expect(WATER_TERRAIN).not.toContain(9);
  });

  it("FLUID_TERRAIN 含全部水体与熔岩（都会流动）", () => {
    for (const t of WATER_TERRAIN) expect(FLUID_TERRAIN).toContain(t);
    expect(FLUID_TERRAIN).toContain(9);
  });
});
