import { describe, expect, it } from "vitest";
import { drawPolyline, strokeStyled, type StrokeTarget } from "./polylineRender";
import { POLYLINE_MIN_SCREEN_PX, polylineStyleOf } from "../../polylineStyle";
import type { MapPolyline } from "../../types";

/**
 * 折线绘制（B4-2）。
 *
 * 【为什么用"记录对象"而不是 mock 整个 pixi】这里要断言的是**画了几笔、什么颜色、
 * 多粗、先后顺序**。真 `Graphics` 把指令吞进自己的缓冲，mock 整个 pixi 只能验
 * "调用过 stroke"，验不出"深褐宽线先画、米白窄线后画"——而那正是"双线"与
 * "一根灰棍"的唯一区别。
 */

interface Op {
  op: "move" | "line" | "stroke" | "fill" | "fillEnd";
  x?: number;
  y?: number;
  width?: number;
  color?: number;
  alpha?: number;
}

function recorder(): { target: StrokeTarget; ops: Op[] } {
  const ops: Op[] = [];
  const target: StrokeTarget = {
    moveTo(x, y) {
      ops.push({ op: "move", x, y });
      return target;
    },
    lineTo(x, y) {
      ops.push({ op: "line", x, y });
      return target;
    },
    stroke(options) {
      ops.push({ op: "stroke", width: options.width, color: options.color, alpha: options.alpha });
      return target;
    },
  };
  return { target, ops };
}

/** 带 fill 能力的记录器（B4-3：变宽河流走 beginFill 一次成形） */
function fillRecorder(): { target: StrokeTarget; ops: Op[] } {
  const { target, ops } = recorder();
  const withFill = target as StrokeTarget;
  withFill.beginFill = (color, alpha) => {
    ops.push({ op: "fill", color, alpha });
    return withFill;
  };
  withFill.endFill = () => {
    ops.push({ op: "fillEnd" });
    return withFill;
  };
  return { target, ops };
}

const strokes = (ops: Op[]) => ops.filter((o) => o.op === "stroke");
const fills = (ops: Op[]) => ops.filter((o) => o.op === "fill");

function line(overrides: Partial<MapPolyline> = {}): MapPolyline {
  return {
    id: "pl_1",
    kind: "road",
    styleId: "road-main",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    closed: false,
    level: null,
    ...overrides,
  };
}

describe("strokeStyled", () => {
  it("实线只描一笔（不分段）", () => {
    const { target, ops } = recorder();
    strokeStyled(
      target,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      false,
      { color: 0x111111, width: 2, alpha: 1 },
    );
    expect(strokes(ops)).toHaveLength(1);
    expect(strokes(ops)[0]).toMatchObject({ width: 2, color: 0x111111, alpha: 1 });
  });

  it("虚线描多笔（每一段实线一笔）", () => {
    const { target, ops } = recorder();
    strokeStyled(
      target,
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
      { color: 0x222222, width: 2, alpha: 1, dash: [8, 6] },
    );
    expect(strokes(ops).length).toBeGreaterThan(3);
  });

  it("闭环补一段回到起点（否则首尾之间会缺一截）", () => {
    const { target, ops } = recorder();
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    strokeStyled(target, square, true, { color: 0x333333, width: 1, alpha: 1 });
    const lines = ops.filter((o) => o.op === "line");
    expect(lines[lines.length - 1]).toMatchObject({ x: 0, y: 0 });
  });

  it("两端渐隐：首尾段的 alpha 明显低于中段", () => {
    const { target, ops } = recorder();
    strokeStyled(
      target,
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      false,
      { color: 0x444444, width: 2, alpha: 1, dash: [8, 4], fadeEnds: true },
    );
    const alphas = strokes(ops).map((o) => o.alpha ?? 0);
    expect(Math.min(...alphas)).toBeLessThan(0.5);
    expect(Math.max(...alphas)).toBeCloseTo(1);
  });

  it("单点路径一笔都不画（0 长线会让 stroke 画出个点）", () => {
    const { target, ops } = recorder();
    strokeStyled(target, [{ x: 5, y: 5 }], false, { color: 0, width: 1, alpha: 1 });
    expect(ops).toHaveLength(0);
  });
});

describe("drawPolyline", () => {
  it("官道画两笔：先粗的深褐主线、再细的米白内描（顺序反了会看不见芯）", () => {
    const { target, ops } = recorder();
    drawPolyline(target, line(), { scale: 1, alpha: 1 });
    const s = strokes(ops);
    expect(s).toHaveLength(2);
    const style = polylineStyleOf("road-main", "road");
    expect(s[0].color).toBe(style.color);
    expect(s[1].color).toBe(style.casing?.color);
    expect(s[0].width!).toBeGreaterThan(s[1].width!);
  });

  it("河流只画一笔（没有内描，否则会糊成一团彩色）", () => {
    const { target, ops } = recorder();
    drawPolyline(target, line({ styleId: "river", kind: "river" }), { scale: 1, alpha: 1 });
    expect(strokes(ops)).toHaveLength(1);
    expect(strokes(ops)[0].color).toBe(polylineStyleOf("river", "river").color);
  });

  it("缩放很小时线宽被屏幕下限撑住（描边宽度按世界单位变大）", () => {
    const { target, ops } = recorder();
    const scale = 0.05;
    drawPolyline(target, line(), { scale, alpha: 1 });
    const main = strokes(ops)[0];
    expect(main.width! * scale).toBeGreaterThanOrEqual(POLYLINE_MIN_SCREEN_PX - 1e-9);
  });

  it("层级权重为 0 时一笔都不画（那条线此刻不存在）", () => {
    const { target, ops } = recorder();
    drawPolyline(target, line(), { scale: 1, alpha: 0 });
    expect(ops).toHaveLength(0);
  });

  it("样式 alpha 与层级权重相乘（河流本身 0.92，淡出时更低）", () => {
    const { target, ops } = recorder();
    drawPolyline(target, line({ styleId: "river", kind: "river" }), { scale: 1, alpha: 0.5 });
    const river = polylineStyleOf("river", "river");
    expect(strokes(ops)[0].alpha).toBeCloseTo((river.alpha ?? 1) * 0.5);
  });

  it("用户把线宽拉到 2 倍：内描也一起变粗（否则粗线上挂着一根发丝）", () => {
    const { target, ops } = recorder();
    drawPolyline(target, line({ widthScale: 2 }), { scale: 1, alpha: 1 });
    const [main, casing] = strokes(ops);
    expect(main.width).toBeCloseTo(polylineStyleOf("road-main", "road").width * 2);
    expect(casing.width).toBeCloseTo(main.width! * (2.4 / 5));
  });
});

describe("drawPolyline · B4-3 变宽与笔刷", () => {
  it("河流变宽：一次 beginFill 填成带状（不描边，没有接缝斑点），颜色/透明度跟样式走", () => {
    const { target, ops } = fillRecorder();
    drawPolyline(target, line({ styleId: "river", kind: "river" }), { scale: 1, alpha: 1 });
    const river = polylineStyleOf("river", "river");
    expect(fills(ops)).toHaveLength(1);
    expect(ops.filter((o) => o.op === "fillEnd")).toHaveLength(1);
    expect(fills(ops)[0].color).toBe(river.color);
    expect(fills(ops)[0].alpha).toBeCloseTo(river.alpha ?? 1);
    expect(strokes(ops)).toHaveLength(0);
  });

  it("变宽几何：起端半宽 ≈ from×宽/2，末端 ≈ 宽/2（源头细、入海粗）", () => {
    const { target, ops } = fillRecorder();
    drawPolyline(
      target,
      line({
        styleId: "river",
        kind: "river",
        points: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ],
      }),
      { scale: 1, alpha: 1 },
    );
    const verts = ops.filter((o) => o.op === "move" || o.op === "line");
    const river = polylineStyleOf("river", "river");
    const startHalf = Math.max(...verts.filter((v) => v.x! < 1).map((v) => Math.abs(v.y!)));
    const endHalf = Math.max(...verts.filter((v) => v.x! > 299).map((v) => Math.abs(v.y!)));
    expect(startHalf).toBeCloseTo((river.width * river.taper!.from) / 2, 5);
    expect(endHalf).toBeCloseTo(river.width / 2, 5);
  });

  it("闭环的河不吃 taper（首尾相接的线没有「哪头是海」），回退等宽描边", () => {
    const { target, ops } = fillRecorder();
    drawPolyline(
      target,
      line({
        styleId: "river",
        kind: "river",
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      }),
      { scale: 1, alpha: 1 },
    );
    expect(fills(ops)).toHaveLength(0);
    expect(strokes(ops)).toHaveLength(1);
  });

  it("目标不支持 fill（旧测试替身 / 异常环境）：河流回退等宽描边，不崩", () => {
    const { target, ops } = recorder(); // 无 beginFill/endFill
    drawPolyline(target, line({ styleId: "river", kind: "river" }), { scale: 1, alpha: 1 });
    expect(strokes(ops)).toHaveLength(1);
    expect(fills(ops)).toHaveLength(0);
  });

  it("closed 但只有 2 个点：按开链画（零面积的来回线没有意义）", () => {
    const { target, ops } = recorder();
    drawPolyline(
      target,
      line({
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      }),
      { scale: 1, alpha: 1 },
    );
    const lines = ops.filter((o) => o.op === "line");
    // 主线的最后一笔到 (10,0) 为止 —— 没有补回起点的段（内描同理）
    expect(lines[lines.length - 1]).toMatchObject({ x: 10, y: 0 });
  });

  it("山脊影线：主线之后叠一排同侧短线，颜色更深、透明度相乘、长短交替", () => {
    const { target, ops } = recorder();
    drawPolyline(
      target,
      line({
        styleId: "ridge",
        kind: "ridge",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      }),
      { scale: 1, alpha: 1 },
    );
    const ridge = polylineStyleOf("ridge", "ridge");
    const main = strokes(ops)[0];
    expect(main.color).toBe(ridge.color);
    const tickStrokes = strokes(ops).slice(1);
    expect(tickStrokes.length).toBeGreaterThan(5);
    for (const t of tickStrokes) {
      expect(t.color).toBe(ridge.hatch!.color);
      expect(t.alpha).toBeCloseTo((ridge.alpha ?? 1) * (ridge.hatch!.alpha ?? 1));
    }
    // 影线几何：每根影线是「move → line → stroke(hatch 色)」的独立三元组；
    // 主线虽也是 move 开头，但它的 stroke 颜色不同，按颜色过滤后不会误配。
    let lastMove: Op | null = null;
    let lastSeg: { len: number; endY: number } | null = null;
    const ticks: { len: number; endY: number }[] = [];
    for (const o of ops) {
      if (o.op === "move") {
        lastMove = o;
        lastSeg = null;
      } else if (o.op === "line" && lastMove) {
        lastSeg = {
          len: Math.hypot(o.x! - lastMove.x!, o.y! - lastMove.y!),
          endY: o.y!,
        };
      } else if (o.op === "stroke") {
        if (o.color === ridge.hatch!.color && lastSeg) ticks.push(lastSeg);
        lastSeg = null;
      }
    }
    expect(ticks.length).toBe(tickStrokes.length);
    for (const t of ticks) expect(t.endY).toBeLessThan(0);
    const lengths = [...new Set(ticks.map((t) => t.len.toFixed(3)))];
    expect(lengths).toHaveLength(2); // 长短两档
    const [a, b] = lengths.map(Number);
    expect(Math.max(a, b) / Math.min(a, b)).toBeCloseTo(
      ridge.hatch!.lengthScale[1] / ridge.hatch!.lengthScale[0],
      2,
    );
  });
});
