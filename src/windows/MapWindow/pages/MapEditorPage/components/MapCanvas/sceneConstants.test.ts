import type { Graphics } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  DRAFT_DASH_MAX,
  DRAFT_DASH_OFF_PX,
  DRAFT_DASH_ON_PX,
  LOOSE_LEVEL_KEY,
  NO_LABELS,
  NO_LEVELS,
  NO_POLYLINES,
  appendDashedLine,
  elementKeyOf,
  quantizeScale,
  toFlatPoints,
} from "./sceneConstants";

function mockGraphics() {
  const moveTo = vi.fn();
  const lineTo = vi.fn();
  return { g: { moveTo, lineTo } as unknown as Graphics, moveTo, lineTo };
}

describe("sceneConstants —— 画布渲染常量与纯辅助", () => {
  it("缩放量化：1 是恒等档，极小值仍返回有限正数", () => {
    expect(quantizeScale(1)).toBe(1);
    const tiny = quantizeScale(0);
    expect(Number.isFinite(tiny)).toBe(true);
    expect(tiny).toBeGreaterThan(0);
    expect(quantizeScale(1.06)).toBeCloseTo(1.06, 6);
  });

  it("toFlatPoints 把顶点摊成 [x0,y0,x1,y1,...]", () => {
    expect(toFlatPoints([{ x: 1, y: 2 }, { x: -3, y: 4 }])).toEqual([1, 2, -3, 4]);
    expect(toFlatPoints([])).toEqual([]);
  });

  it("elementKeyOf：无层级归哨兵键，越界并入最细一级", () => {
    expect(elementKeyOf(null, 3)).toBe(LOOSE_LEVEL_KEY);
    expect(elementKeyOf(undefined, 3)).toBe(LOOSE_LEVEL_KEY);
    expect(elementKeyOf(1, 3)).toBe(1);
    expect(elementKeyOf(9, 3)).toBe(2);
  });

  it("虚线：零长度不画，正常线段切成多段且每段只一次 moveTo/lineTo", () => {
    const zero = mockGraphics();
    appendDashedLine(zero.g, { x: 1, y: 1 }, { x: 1, y: 1 }, 1);
    expect(zero.moveTo).not.toHaveBeenCalled();

    const line = mockGraphics();
    appendDashedLine(line.g, { x: 0, y: 0 }, { x: 100, y: 0 }, 1);
    const segments = Math.ceil(100 / (DRAFT_DASH_ON_PX + DRAFT_DASH_OFF_PX));
    expect(line.moveTo).toHaveBeenCalledTimes(segments);
    expect(line.lineTo).toHaveBeenCalledTimes(segments);
    expect(segments).toBeLessThan(DRAFT_DASH_MAX);
  });

  it("缺省数组是模块级稳定引用", () => {
    expect(NO_LEVELS).toEqual([]);
    expect(NO_LABELS).toEqual([]);
    expect(NO_POLYLINES).toEqual([]);
  });
});
