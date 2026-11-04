import { beforeEach, describe, expect, it } from "vitest";
import { useMapDocStore } from "./useMapDocStore";
import { resetMapStores } from "./reset";
import { createEmptyDocument, type MapElement } from "../types";

/**
 * B1（R-MAP-23 / R-MAP-25）素材动作的 store 层用例。
 *
 * ── 为什么落 store 层 ──
 * 这批动作的规则全是"撤销栈账目"：滑杆一次拖动只占一步、连按方向键只占一步、
 * 空操作不压快照。这些只有在**连续多次操作**后看 undoStack 长度才辨得出对错，
 * 页面用例被 UI 事件与异步渲染盖住，钉不住。
 */

/** 造一个最小素材（store 不碰纹理，字段自洽即可） */
function mkElement(extra: Partial<MapElement> = {}): MapElement {
  return {
    id: "el_a",
    spriteId: "mountain",
    x: 100,
    y: 200,
    scale: 1,
    rotation: 0,
    level: null,
    ...extra,
  };
}

/** 直接塞进文档（既有状态不占撤销栈） */
function seedElements(elements: MapElement[]): void {
  useMapDocStore.setState({ doc: { ...createEmptyDocument(), elements } });
}

const state = () => useMapDocStore.getState();

beforeEach(() => {
  resetMapStores();
});

describe("updateElement：clamp 与撤销账目", () => {
  it("clamp：opacity 压进 0.1~1、scale 压进 0.1~8、tint 压进 0~360、rotation 归一化", () => {
    seedElements([mkElement()]);
    state().updateElement("el_a", { opacity: 0.02, scale: 99, tint: 720, rotation: -90 });
    const el = state().doc.elements[0];
    expect(el.opacity).toBe(0.1);
    expect(el.scale).toBe(8);
    expect(el.tint).toBe(360);
    expect(el.rotation).toBe(270);
  });

  it("值没变不压快照：滑杆拖到端点后继续 onChange 不产生空撤销步", () => {
    seedElements([mkElement({ opacity: 0.5 })]);
    state().updateElement("el_a", { opacity: 0.5 });
    expect(state().undoStack).toHaveLength(0);
  });

  it("同键连续三次只压一步：撤销一次回到初始值（滑杆一次拖动 = 一步）", () => {
    seedElements([mkElement()]);
    state().updateElement("el_a", { opacity: 0.8 }, "el:el_a:opacity");
    state().updateElement("el_a", { opacity: 0.6 }, "el:el_a:opacity");
    state().updateElement("el_a", { opacity: 0.4 }, "el:el_a:opacity");
    expect(state().undoStack).toHaveLength(1);
    state().undo();
    expect(state().doc.elements[0].opacity).toBeUndefined();
  });

  it("换键断步：先拖透明度再拖缩放是两步撤销", () => {
    seedElements([mkElement()]);
    state().updateElement("el_a", { opacity: 0.5 }, "el:el_a:opacity");
    state().updateElement("el_a", { scale: 2 }, "el:el_a:scale");
    expect(state().undoStack).toHaveLength(2);
  });
});

describe("reorderElement：置顶 / 置底", () => {
  it("置顶移到数组尾（渲染最上层），置底移到数组头", () => {
    seedElements([mkElement({ id: "el_a" }), mkElement({ id: "el_b" }), mkElement({ id: "el_c" })]);
    state().reorderElement("el_a", "front");
    expect(state().doc.elements.map((e) => e.id)).toEqual(["el_b", "el_c", "el_a"]);
    state().reorderElement("el_a", "back");
    expect(state().doc.elements.map((e) => e.id)).toEqual(["el_a", "el_b", "el_c"]);
  });

  it("已在端点上不压快照（置顶已是最顶时按钮点了不能白吃一步撤销）", () => {
    seedElements([mkElement({ id: "el_a" }), mkElement({ id: "el_b" })]);
    state().reorderElement("el_b", "front");
    expect(state().undoStack).toHaveLength(0);
  });
});

describe("复制 / 粘贴 / 剪切", () => {
  it("duplicate：新 id + 斜移落位，撤销一步整个副本消失", () => {
    seedElements([mkElement({ scale: 1.5, rotation: 30, opacity: 0.8, tint: 120 })]);
    const newId = state().duplicateElement("el_a");
    expect(newId).not.toBeNull();
    const copy = state().doc.elements.find((e) => e.id === newId) as MapElement;
    expect(copy.x).toBe(100 + 16);
    expect(copy.y).toBe(200 + 16);
    expect(copy.scale).toBe(1.5);
    expect(copy.rotation).toBe(30);
    expect(copy.opacity).toBe(0.8);
    expect(copy.tint).toBe(120);
    state().undo();
    expect(state().doc.elements).toHaveLength(1);
  });

  it("cut：剪贴板持有副本、原素材删除；paste 落位斜移且可连贴", () => {
    seedElements([mkElement()]);
    state().cutElement("el_a");
    expect(state().doc.elements).toHaveLength(0);
    expect(state().clipboard).not.toBeNull();
    const first = state().pasteElement();
    const second = state().pasteElement();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(state().doc.elements).toHaveLength(2);
    // 账目：剪切 1 步 + 两次粘贴各 1 步 = 3 步。全部退完素材才回来
    state().undo();
    state().undo();
    state().undo();
    expect(state().doc.elements).toHaveLength(1);
  });

  it("空剪贴板粘贴返回 null 且不动文档", () => {
    seedElements([mkElement()]);
    expect(state().pasteElement()).toBeNull();
    expect(state().undoStack).toHaveLength(0);
  });

  it("resetMapStores 清剪贴板：换一张图后粘贴必须失效", () => {
    seedElements([mkElement()]);
    state().copyElement("el_a");
    expect(state().clipboard).not.toBeNull();
    resetMapStores();
    expect(state().clipboard).toBeNull();
  });
});

describe("nudgeElement：方向键微移", () => {
  it("联动地名一起动；连按十次只占一步撤销", () => {
    seedElements([mkElement()]);
    useMapDocStore.setState({
      doc: {
        ...state().doc,
        labels: [
          { id: "lb_1", text: "白石镇", x: 100, y: 192, size: 12, level: null, elementId: "el_a" },
        ],
      },
    });
    for (let i = 0; i < 10; i += 1) state().nudgeElement("el_a", 4, 0);
    expect(state().doc.elements[0].x).toBe(140);
    expect(state().doc.labels[0].x).toBe(140);
    expect(state().undoStack).toHaveLength(1);
    state().undo();
    expect(state().doc.elements[0].x).toBe(100);
    expect(state().doc.labels[0].x).toBe(100);
  });

  it("移动别的素材断开合并键：A 移三步 + B 移一步 = 两次撤销", () => {
    seedElements([mkElement({ id: "el_a" }), mkElement({ id: "el_b", x: 0, y: 0 })]);
    state().nudgeElement("el_a", 4, 0);
    state().nudgeElement("el_a", 4, 0);
    state().nudgeElement("el_b", -4, 0);
    expect(state().undoStack).toHaveLength(2);
    state().undo();
    expect(state().doc.elements.find((e) => e.id === "el_b")?.x).toBe(0);
    expect(state().doc.elements.find((e) => e.id === "el_a")?.x).toBe(108);
  });
});
