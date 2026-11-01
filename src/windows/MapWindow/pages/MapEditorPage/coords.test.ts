import { describe, expect, it } from "vitest";
import {
  FIT_PADDING,
  WHEEL_MAX_STEPS,
  WHEEL_NOTCH_PX,
  ZOOM_LIMITS,
  ZOOM_STEP,
  fitScaleFor,
  fitToRect,
  hitTestElement,
  wheelZoomFactor,
  worldToScreen,
  zoomAt,
} from "./coords";

/**
 * 坐标与缩放的**手感**层单测。
 *
 * 这里的断言全部是"用户能感觉到"的量：一格滚轮走多远、要滚多少格才到上限、
 * 命中区是否等于视觉尺寸。任何一个变了，用户都会当场察觉（滚不动 / 滚过头 /
 * 点不中），但它们不会抛异常 —— 没有测试就只能靠人肉试。
 */

const CANVAS = { width: 1024, height: 900 };
const BOUNDS = { x: -512, y: -512, width: 1024, height: 1024 };

describe("wheelZoomFactor：一格滚轮走多远", () => {
  it("小 delta（触控板慢推 / 工具栏按钮的 ±1）恒走满一档 1.1", () => {
    for (const delta of [-1, 1, -3, 5, -10]) {
      const f = wheelZoomFactor(delta);
      expect(delta < 0 ? f : 1 / f).toBeCloseTo(ZOOM_STEP, 12);
    }
  });

  it("方向与操作系统一致：deltaY < 0 放大，> 0 缩小", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1, 12);
  });

  it("一格标准鼠标滚轮（deltaY = 100）= 2 档 = 1.21 倍", () => {
    expect(100 / WHEEL_NOTCH_PX).toBe(2);
    expect(wheelZoomFactor(-100)).toBeCloseTo(ZOOM_STEP ** 2, 12);
  });

  it("大 delta（触控板一次滑动）按比例加速，但封顶 WHEEL_MAX_STEPS 档", () => {
    expect(wheelZoomFactor(-WHEEL_NOTCH_PX * 3)).toBeCloseTo(ZOOM_STEP ** 3, 12);
    expect(wheelZoomFactor(-4000)).toBeCloseTo(ZOOM_STEP ** WHEEL_MAX_STEPS, 12);
  });

  it("delta 为 0 / 非有限值时不动（不会因为一次异常事件把画面缩放掉）", () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
    expect(wheelZoomFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("连续滚轮从适配缩放滚到上限：不超过 25 格（否则用户会以为「滚不动了」）", () => {
    // 实测值（1024×900 画布、5 个种子）：新上限 19.72~21.83，按 1.21/格 需要 18~19 格
    const from = fitScaleFor(BOUNDS, CANVAS, FIT_PADDING); // 0.703
    const max = 21.83;
    let scale = from;
    let notches = 0;
    while (scale < max - 1e-9 && notches < 200) {
      scale = Math.min(max, scale * wheelZoomFactor(-100));
      notches += 1;
    }
    expect(notches).toBeLessThanOrEqual(25);
    expect(notches).toBeGreaterThanOrEqual(10); // 也不该"一格到顶"，那就没法微调了
  });
});

describe("zoomAt：上限处的行为", () => {
  it("到达上限后再放大，视口原样返回（不越界、也不抖动）", () => {
    const limits = { min: 0.18, max: 20 };
    const vp = { x: 0, y: 0, scale: 20 };
    const next = zoomAt(vp, { x: 512, y: 450 }, wheelZoomFactor(-4000), CANVAS, limits);
    expect(next).toBe(vp);
  });

  it("没生成区块时用兜底区间 ZOOM_LIMITS（0.1 ~ 8）", () => {
    const vp = { x: 0, y: 0, scale: 7.9 };
    const next = zoomAt(vp, { x: 512, y: 450 }, 1.5, CANVAS);
    expect(next.scale).toBe(ZOOM_LIMITS.max);
  });

  it("以光标为锚点：缩放前后光标下的世界坐标不变", () => {
    const anchor = { x: 700, y: 200 };
    const vp = fitToRect(BOUNDS, CANVAS, FIT_PADDING, { min: 0.1, max: 20 });
    const next = zoomAt(vp, anchor, 2, CANVAS, { min: 0.1, max: 20 });
    // 用 worldToScreen 反查：同一个世界点在两套视口下都落在 anchor 上
    const world = {
      x: (anchor.x - CANVAS.width / 2) / next.scale + next.x,
      y: (anchor.y - CANVAS.height / 2) / next.scale + next.y,
    };
    expect(worldToScreen(world, next, CANVAS).x).toBeCloseTo(anchor.x, 6);
    const after = worldToScreen(world, next, CANVAS);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
  });
});

describe("hitTestElement：命中区 = 绘制尺寸", () => {
  /**
   * 素材的绘制宽度 = baseWidth × 元素 scale × 层级尺寸因子（见 lod.elementSizeFactor）。
   * 命中测试只认识一个 `scale`，所以调用方必须把因子乘进去 —— 这条断言把
   * "点得中的范围"与"看得见的范围"绑在一起。
   */
  const el = { x: 0, y: 0, width: 160, height: 93 };
  /** 郡级素材：160 → 20 世界单位宽、11.6 高（每级减半，level 3 / 4 级） */
  const scaleAtCounty = 0.125;

  it("郡级素材：中心点得中，外接矩形外 1px 点不中", () => {
    const county = { ...el, scale: scaleAtCounty };
    expect(hitTestElement({ x: 0, y: -5 }, county)).toBe(true);
    // 半宽 10；在 228% 缩放下 1px ≈ 0.44 世界单位
    expect(hitTestElement({ x: 10.4, y: -5 }, county)).toBe(false);
    expect(hitTestElement({ x: 9.6, y: -5 }, county)).toBe(true);
    // 竖直：锚点在脚底，上方 11.6 之内
    expect(hitTestElement({ x: 0, y: -11.2 }, county)).toBe(true);
    expect(hitTestElement({ x: 0, y: -12 }, county)).toBe(false);
    expect(hitTestElement({ x: 0, y: 0.5 }, county)).toBe(false); // 锚点下方不属于它
  });

  it("若忘了乘层级因子，同一片命中区会大 8 倍（回归的形态）", () => {
    const unscaled = { ...el, scale: 1 };
    expect(hitTestElement({ x: 60, y: -5 }, unscaled)).toBe(true);
    expect(hitTestElement({ x: 60, y: -5 }, { ...el, scale: scaleAtCounty })).toBe(false);
  });
});
