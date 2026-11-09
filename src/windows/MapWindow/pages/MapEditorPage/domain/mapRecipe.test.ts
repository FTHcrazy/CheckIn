import { describe, expect, it } from "vitest";
import {
  RANDOM_CHOICE,
  randomRecipe,
  resolveLandColorId,
  resolveShapeId,
} from "./mapRecipe";
import { LAND_BASE_COLORS, LAND_SHAPES } from "../land";

/**
 * 随机配方与「随机」档（2.45.0）。
 *
 * 【为什么这里单独测】配比本身的守卫在 `terrain-assets.test.ts`（它需要真实素材池
 * 冒烟）；这一份只管两件"UI 语义"的事：
 *   ① 「随机」档必须**由 seed 决定**，不能每次重绘都换一张（那样撤销后同图不同形）；
 *   ② 手选固定档时必须原样返回（用户点了「盘古」，就不能给他别的形状）。
 */

describe("resolveShapeId · 形状档", () => {
  it("显式选择的形状原样返回", () => {
    for (const shape of LAND_SHAPES) {
      expect(resolveShapeId(shape.id, 123)).toBe(shape.id);
    }
  });

  it("「随机」由 seed 决定：同 seed 同形状，换 seed 会变", () => {
    const ids = LAND_SHAPES.map((s) => s.id);
    for (const seed of [1, 2026, 20261109]) {
      const a = resolveShapeId(RANDOM_CHOICE, seed);
      expect(a).toBe(resolveShapeId(RANDOM_CHOICE, seed));
      expect(ids).toContain(a);
    }
    const picked = new Set(Array.from({ length: 24 }, (_, i) => resolveShapeId(RANDOM_CHOICE, i + 1)));
    expect(picked.size).toBeGreaterThan(5);
  });

  it("缺省（undefined）= 第一种形状，不是随机（老调用方语义不变）", () => {
    expect(resolveShapeId(undefined, 999)).toBe(LAND_SHAPES[0].id);
  });
});

describe("resolveLandColorId · 底色档", () => {
  it("显式选择的底色原样返回", () => {
    for (const color of LAND_BASE_COLORS) {
      expect(resolveLandColorId(color.id, 7)).toBe(color.id);
    }
  });

  it("「随机」由 seed 决定且落在色表内", () => {
    const ids = LAND_BASE_COLORS.map((c) => c.id);
    for (const seed of [3, 77, 20261109]) {
      const id = resolveLandColorId(RANDOM_CHOICE, seed);
      expect(id).toBe(resolveLandColorId(RANDOM_CHOICE, seed));
      expect(ids).toContain(id);
    }
  });

  it("缺省 = 羊皮纸（`LAND_BASE_COLORS[0]`）", () => {
    expect(resolveLandColorId(undefined, 5)).toBe(LAND_BASE_COLORS[0].id);
  });
});

describe("randomRecipe · 与形状/底色各自独立", () => {
  it("配方只由 seed 决定，且 id 带 seed（摘要里能对上号）", () => {
    const a = randomRecipe(4242);
    expect(a.id).toBe("rnd-4242");
    expect(a.label).toBe("随机");
    expect(randomRecipe(4242)).toEqual(a);
    expect(randomRecipe(4243).terrainMix).not.toEqual(a.terrainMix);
  });
});
