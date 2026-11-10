import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLYLINE_STYLE_ID,
  POLYLINE_MIN_SCREEN_PX,
  POLYLINE_STYLES,
  POLYLINE_WIDTH_SCALE_MAX,
  POLYLINE_WIDTH_SCALE_MIN,
  dashLengthsOf,
  defaultStyleIdOf,
  effectiveWidthWorld,
  polylineStyleOf,
} from "./polylineStyle";

/**
 * 折线样式表（B4-2 §4.4 五档 + 2.44.0 湖面两档 + 2.45.0 道路点线）。
 *
 * 【为什么值得单测】样式是**常量数据**，改错一个字的表现是"线变细了 / 变透明了 /
 * 虚线密得像毛边"，而没有任何报错。这里钉住的是三条容易被顺手改坏的性质：
 *   ① id 唯一且稳定（老文档的 `styleId` 认它，改名 = 老图全变默认样式）；
 *   ② 每档都有 `kind`，且五档覆盖五类语义（回退链才有着落）；
 *   ③ 线宽的屏幕下限必须真的兜住（缩到整图时线不能消失）。
 */

describe("样式表", () => {
  it("八档、id 唯一、覆盖五类语义（含 2.44.0 湖面两档与 2.45.0 道路点线）", () => {
    expect(POLYLINE_STYLES).toHaveLength(8);
    expect(new Set(POLYLINE_STYLES.map((s) => s.id)).size).toBe(8);
    expect(new Set(POLYLINE_STYLES.map((s) => s.kind))).toEqual(
      new Set(["road", "river", "ridge", "border", "lake"]),
    );
    // 三种 road（官道 / 小径 / 点线）、两种 lake（湖面 / 等深线）
    expect(POLYLINE_STYLES.filter((s) => s.kind === "road")).toHaveLength(3);
    expect(POLYLINE_STYLES.filter((s) => s.kind === "lake")).toHaveLength(2);
  });

  it("只有湖面档带填充，且填充必须比岸线淡（否则湖会糊成一坨实心色）", () => {
    const filled = POLYLINE_STYLES.filter((s) => s.fill);
    expect(filled.map((s) => s.id)).toEqual(["lake"]);
    const lake = POLYLINE_STYLES.find((s) => s.id === "lake");
    expect(lake?.fill?.alpha).toBeGreaterThan(0);
    expect(lake?.fill?.alpha).toBeLessThanOrEqual(1);
    // 等深线不填充：它的作用是"读深浅"，填了就成了第二个湖
    expect(POLYLINE_STYLES.find((s) => s.id === "lake-ring")?.fill).toBeUndefined();
  });

  it("每档的线宽与颜色都在有效范围（0 宽画不出来、负数会让 stroke 直接吞掉）", () => {
    for (const s of POLYLINE_STYLES) {
      expect(s.width, `${s.id} 线宽`).toBeGreaterThan(0);
      expect(s.color, `${s.id} 颜色`).toBeGreaterThanOrEqual(0);
      expect(s.color, `${s.id} 颜色`).toBeLessThanOrEqual(0xffffff);
      // 内描必须比主线窄，否则主线被整块盖掉（"双线"看起来跟单线一样）
      if (s.casing) expect(s.casing.width).toBeLessThan(s.width);
    }
  });

  it("官方默认档存在（新建线的初值不能指向一个不存在的 id）", () => {
    expect(POLYLINE_STYLES.some((s) => s.id === DEFAULT_POLYLINE_STYLE_ID)).toBe(true);
  });
});

describe("polylineStyleOf · 回退链", () => {
  it("按 id 命中", () => {
    expect(polylineStyleOf("river", "road").id).toBe("river");
  });

  it("id 非法时按 kind 回退（老文档 / 手改 JSON 不该让渲染崩）", () => {
    expect(polylineStyleOf("deleted-style", "river").id).toBe("river");
    expect(polylineStyleOf(undefined, "border").id).toBe("border");
  });

  it("连 kind 都没有时不抛错，给第一档", () => {
    expect(polylineStyleOf(undefined, "road").id).toBe(POLYLINE_STYLES[0].id);
  });

  it("defaultStyleIdOf 与 kind 对应（新建线不用自己查表）", () => {
    expect(defaultStyleIdOf("river")).toBe("river");
    expect(defaultStyleIdOf("ridge")).toBe("ridge");
  });
});

describe("effectiveWidthWorld · 世界单位线宽 + 屏幕下限", () => {
  const road = polylineStyleOf("road-main", "road");

  it("正常缩放：线宽 = 样式宽 × 用户倍数", () => {
    expect(effectiveWidthWorld(road, 1, 1)).toBeCloseTo(road.width);
    expect(effectiveWidthWorld(road, 2, 1)).toBeCloseTo(road.width * 2);
  });

  it("缩到很远：被屏幕下限兜住（0.75px ÷ 缩放）", () => {
    const scale = 0.05;
    const w = effectiveWidthWorld(road, 1, scale);
    expect(w).toBeCloseTo(POLYLINE_MIN_SCREEN_PX / scale);
    // 换算回屏幕像素就是下限本身
    expect(w * scale).toBeCloseTo(POLYLINE_MIN_SCREEN_PX);
  });

  it("放大时下限不生效（下限不该把粗线变细）", () => {
    expect(effectiveWidthWorld(road, 1, 4)).toBeCloseTo(road.width);
  });

  it("非法的用户倍数回落到 1（滑杆传 NaN / 0 不该画出零宽线）", () => {
    expect(effectiveWidthWorld(road, 0, 1)).toBeCloseTo(road.width);
    expect(effectiveWidthWorld(road, Number.NaN, 1)).toBeCloseTo(road.width);
    expect(effectiveWidthWorld(road, undefined, 1)).toBeCloseTo(road.width);
  });

  it("可调区间常量自洽（面板滑杆的 min/max 不能反过来）", () => {
    expect(POLYLINE_WIDTH_SCALE_MIN).toBeLessThan(1);
    expect(POLYLINE_WIDTH_SCALE_MAX).toBeGreaterThan(1);
  });
});

describe("dashLengthsOf", () => {
  it("虚线节奏按**实际线宽**放大（线越粗、虚段越长）", () => {
    const trail = polylineStyleOf("road-trail", "road");
    const a = dashLengthsOf(trail, 2);
    const b = dashLengthsOf(trail, 4);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b![0]).toBeCloseTo(a![0] * 2);
  });

  it("实线档（官道 / 河流）返回 null", () => {
    expect(dashLengthsOf(polylineStyleOf("road-main", "road"), 5)).toBeNull();
    expect(dashLengthsOf(polylineStyleOf("river", "river"), 4)).toBeNull();
  });

  /**
   * 【"缩小看全是线条"的根因守卫（2.48.0）】
   *
   * 虚线段是**圆头**描边画的（`strokeStyled` 固定 `cap: "round"`）：每个实段向两端
   * 各鼓出 `width/2`，可见实段 = `实段 + width`，可见间隔 = `间隔 - width`。
   * 旧值 `[1, 1.6]`：可见间隔只剩 `0.6 × 线宽` —— 整条路读作一根被咬了几口的粗实线。
   * 这里按"可见"口径直接钉住比例（参考 `line_type:2` 是 4 : 6）。
   */
  it("点线的可见虚实比：间隔至少 1.5 倍线宽，实段/间隔落在 0.4~1.0", () => {
    const dotted = polylineStyleOf("road-dotted", "road");
    for (const scale of [0.8, 1, 1.2]) {
      const width = effectiveWidthWorld(dotted, scale, 1);
      const dash = dashLengthsOf(dotted, width);
      expect(dash, `widthScale=${scale} 应为虚线`).not.toBeNull();
      const visibleDash = dash![0] + width;
      const visibleGap = dash![1] - width;
      expect(visibleGap, `widthScale=${scale} 的可见间隔`).toBeGreaterThan(width * 1.5);
      const ratio = visibleDash / visibleGap;
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(1);
    }
  });

  it("点线的世界线宽与参考同量级（size:2）：在 1.6~2.5 之间", () => {
    const dotted = polylineStyleOf("road-dotted", "road");
    for (const [scale, want] of [
      [0.8, 1.6],
      [1, 2],
      [1.2, 2.4],
    ] as const) {
      expect(effectiveWidthWorld(dotted, scale, 1)).toBeCloseTo(want, 6);
    }
  });
});
