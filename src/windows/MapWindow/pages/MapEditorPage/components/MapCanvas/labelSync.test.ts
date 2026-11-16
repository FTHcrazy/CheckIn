import { describe, expect, it, vi } from "vitest";

/**
 * 标注层的纯函数（AGENTS §6.6 第 4 条）。
 *
 * `label.test.tsx` 用假场景图钉的是「增量同步 / 视口只改 scale」这类渲染契约；
 * 这里只测不依赖场景图的三个纯行为：命中测试、同层避让、缩放倒数。
 * 顶层 import 的 Pixi 类在本文件里一个都不会被实例化，给最小替身即可。
 */
vi.mock("pixi.js", () => ({
  Container: class {},
  Text: class {},
  TextStyle: class {},
}));

import {
  LABEL_AVOID_MAX,
  LABEL_AVOID_STEP,
  LABEL_MAX,
  LOOSE_LABEL_KEY,
  applyAvoidance,
  labelAt,
  setLabelScale,
  type LabelHandle,
} from "./labelSync";
import type { MapLabel } from "../../types";

function label(overrides: Partial<MapLabel> = {}): MapLabel {
  return {
    id: "lb_1",
    text: "临安",
    x: 100,
    y: 100,
    size: 16,
    level: null,
    ...overrides,
  };
}

function handle(overrides: Partial<LabelHandle> = {}): LabelHandle {
  const node = {
    position: { set: vi.fn() },
    scale: { set: vi.fn() },
  };
  return {
    id: "lb_1",
    node: node as unknown as LabelHandle["node"],
    key: 0,
    baseX: 100,
    baseY: 100,
    avoidY: 0,
    size: 16,
    text: "临安",
    ...overrides,
  };
}

describe("labelAt —— 标注命中测试", () => {
  it("点在世界包围盒内命中，盒外返回 null", () => {
    expect(labelAt([label()], [1], { x: 100, y: 100 })).toMatchObject({ id: "lb_1" });
    expect(labelAt([label()], [1], { x: 300, y: 100 })).toBeNull();
  });

  it("offsetY 参与包围盒估算（看起来在哪就点得中哪）", () => {
    const moved = label({ offsetY: -20 });
    expect(labelAt([moved], [1], { x: 100, y: 80 })).toMatchObject({ id: "lb_1" });
    expect(labelAt([moved], [1], { x: 100, y: 100 })).toBeNull();
  });

  it("层级权重低于可见门槛的标注不可点，层级无关的恒可点", () => {
    const layered = label({ level: 0 });
    expect(labelAt([layered], [0.1], { x: 100, y: 100 })).toBeNull();
    expect(labelAt([layered], [1], { x: 100, y: 100 })).toMatchObject({ id: "lb_1" });
    expect(labelAt([label()], [0.1], { x: 100, y: 100 })).toMatchObject({ id: "lb_1" });
  });

  it("重叠时返回最上层（文档里靠后）的那条", () => {
    const labels = [label({ id: "lb_a" }), label({ id: "lb_b" })];
    expect(labelAt(labels, [1], { x: 100, y: 100 })).toMatchObject({ id: "lb_b" });
  });

  it("空文本与空列表不产生误命中", () => {
    expect(labelAt([], [1], { x: 100, y: 100 })).toBeNull();
    expect(labelAt([label({ text: "" })], [1], { x: 100, y: 100 })).toBeNull();
  });
});

describe("applyAvoidance —— 同层级避让", () => {
  it("同层重叠时后放置的往上让，并同步节点坐标", () => {
    const first = handle({ id: "lb_a" });
    const second = handle({ id: "lb_b" });
    applyAvoidance([first, second]);
    expect(first.avoidY).toBe(0);
    expect(second.avoidY).toBeLessThan(0);
    expect(Math.abs(second.avoidY % LABEL_AVOID_STEP)).toBe(0);
    expect(second.node.position.set).toHaveBeenCalledWith(100, 100 + second.avoidY);
  });

  it("最多让 LABEL_AVOID_MAX 次，不让到离锚点太远", () => {
    const handles = ["a", "b", "c", "d", "e"].map((id) => handle({ id }));
    applyAvoidance(handles);
    for (const h of handles.slice(1)) {
      expect(h.avoidY).toBeGreaterThanOrEqual(-LABEL_AVOID_STEP * LABEL_AVOID_MAX);
      expect(Math.abs(h.avoidY % LABEL_AVOID_STEP)).toBe(0);
    }
  });

  it("不同层级互不避让（跨层让位会让缩放时文字跳位）", () => {
    const low = handle({ id: "lb_a", key: 0 });
    const high = handle({ id: "lb_b", key: 1 });
    applyAvoidance([low, high]);
    expect(low.avoidY).toBe(0);
    expect(high.avoidY).toBe(0);
  });

  it("层级无关标注使用哨兵键，仍按同一组避让", () => {
    const loose = handle({ id: "lb_a", key: LOOSE_LABEL_KEY });
    const other = handle({ id: "lb_b", key: LOOSE_LABEL_KEY });
    applyAvoidance([loose, other]);
    expect(loose.avoidY).toBe(0);
    expect(other.avoidY).toBeLessThan(0);
  });
});

describe("setLabelScale —— 视口缩放", () => {
  it("文字 scale 取视口的倒数，屏幕上字号恒定", () => {
    const scaleSet = vi.fn();
    const h = handle({
      node: {
        position: { set: vi.fn() },
        scale: { set: scaleSet },
      } as unknown as LabelHandle["node"],
    });
    setLabelScale([h], 2);
    expect(scaleSet).toHaveBeenCalledWith(0.5);
  });

  it("视口缩放到 0 时不产生 Infinity（有下限钳制）", () => {
    const scaleSet = vi.fn();
    const h = handle({
      node: {
        position: { set: vi.fn() },
        scale: { set: scaleSet },
      } as unknown as LabelHandle["node"],
    });
    setLabelScale([h], 0);
    expect(Number.isFinite(scaleSet.mock.calls[0][0])).toBe(true);
  });
});

describe("标注配额口径", () => {
  it("渲染上限保持 300 条，与性能口径一致", () => {
    expect(LABEL_MAX).toBe(300);
  });
});
