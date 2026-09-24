/**
 * 比例尺换算单测（本轮修复：缩放时尺寸标注必须跟着变）
 *
 * 钉死的不变量：
 * ① 缩放变大 ⇒ 同一屏幕长度代表的里程**必须变小**（旧实现是死值，正是被反馈的 bug）；
 * ② 刻度条屏幕长度恒 ≤ maxPx，且里程取「1/2/5 × 10ⁿ」的整齐值；
 * ③ 非法输入（scale = 0 / NaN）不得抛错，降级成空刻度。
 */
import { describe, expect, it } from "vitest";
import { formatLi, niceFloor, pxPerLi, scaleBarFor, viewExtentLi } from "./map-scale";
import { CELL, LI_PER_CELL } from "./map-terrain";

describe("map-scale pxPerLi", () => {
  it("按「1 格 = LI_PER_CELL 里」换算屏幕像素", () => {
    expect(pxPerLi(1, CELL)).toBeCloseTo(CELL / LI_PER_CELL, 6);
    expect(pxPerLi(2, CELL)).toBeCloseTo((2 * CELL) / LI_PER_CELL, 6);
  });

  it("非法输入返回 0（不抛错）", () => {
    expect(pxPerLi(0, CELL)).toBe(0);
    expect(pxPerLi(Number.NaN, CELL)).toBe(0);
    expect(pxPerLi(1, 0)).toBe(0);
  });
});

describe("map-scale scaleBarFor：刻度必须随缩放变化", () => {
  it("缩放越大，同一屏幕长度代表的里程越小（严格单调，非恒定）", () => {
    const li = [0.05, 0.2, 0.75, 2, 8].map((s) => scaleBarFor(s, CELL).li);
    for (let i = 1; i < li.length; i++) {
      expect(li[i], `scale 档位 ${i} 的里程应小于上一档：${li.join(" → ")}`).toBeLessThan(li[i - 1]);
    }
    expect(new Set(li).size).toBe(li.length);
  });

  it("刻度条屏幕长度不超过上限，且里程是 1/2/5 × 10ⁿ", () => {
    for (const s of [0.02, 0.1, 0.5, 0.75, 1, 3, 16]) {
      const bar = scaleBarFor(s, CELL, 150);
      expect(bar.px).toBeGreaterThan(0);
      expect(bar.px).toBeLessThanOrEqual(150 + 1e-9);
      const mant = bar.li / Math.pow(10, Math.floor(Math.log10(bar.li)));
      expect([1, 2, 5]).toContain(Math.round(mant));
    }
  });

  it("文案随里程切换量级（里 / 万里）", () => {
    expect(scaleBarFor(0.02, CELL).label).toContain("万里");
    expect(scaleBarFor(16, CELL).label).toContain("里");
    expect(formatLi(200)).toBe("200 里");
    expect(formatLi(10000)).toBe("1 万里");
    expect(formatLi(0)).toBe("—");
  });

  it("极端/非法视口降级为空刻度，不抛错", () => {
    for (const s of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bar = scaleBarFor(s, CELL);
      expect(bar.px).toBe(0);
      expect(bar.label).toBe("—");
    }
  });
});

describe("map-scale viewExtentLi：视野里程随缩放变化", () => {
  it("放大后同一视口覆盖的里程变小", () => {
    const far = viewExtentLi(0.2, CELL, 800, 600);
    const near = viewExtentLi(2, CELL, 800, 600);
    expect(near.w).toBeLessThan(far.w);
    expect(near.h).toBeLessThan(far.h);
    // 视野宽度应等于「视口像素 / 每里像素」
    expect(far.w).toBeCloseTo(800 / pxPerLi(0.2, CELL), 6);
  });

  it("非法输入返回 0 尺寸", () => {
    expect(viewExtentLi(0, CELL, 800, 600)).toEqual({ w: 0, h: 0 });
  });
});

describe("map-scale niceFloor", () => {
  it("向下取 1/2/5 × 10ⁿ", () => {
    expect(niceFloor(312)).toBe(200);
    expect(niceFloor(58.6)).toBe(50);
    expect(niceFloor(999)).toBe(500);
    expect(niceFloor(1.2)).toBe(1);
    expect(niceFloor(23)).toBe(20);
  });

  it("非法输入返回 0", () => {
    expect(niceFloor(0)).toBe(0);
    expect(niceFloor(Number.NaN)).toBe(0);
  });
});
