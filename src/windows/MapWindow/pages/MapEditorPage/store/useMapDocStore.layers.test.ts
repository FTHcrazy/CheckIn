import { beforeEach, describe, expect, it } from "vitest";
import { useMapDocStore } from "./useMapDocStore";
import { resetMapStores } from "./reset";
import { createEmptyDocument } from "../types";
import { layerLockedOf, layerVisibleOf } from "../layerState";

/**
 * 图层面板的两个开关（B4-1）在 store 层的账目。
 *
 * ── 为什么在 store 层测 ──
 * 这里有三条**只有连着做几步才看得出对错**的规则：
 *   ① 眼睛切一次 = 一步撤销（切两次要能撤两次）；
 *   ② 切回默认值时不该在文档里留下 `{visible:true}` 这种垃圾字段；
 *   ③ 区块的可见性必须落在 `showRegions` 上，**不许**在 `layerState` 里写第二份。
 * 页面用例里这些都被 React 提交与异步渲染盖住，直接对 store 发号施令最清楚。
 */

const state = () => useMapDocStore.getState();

beforeEach(() => {
  resetMapStores();
});

describe("setLayerVisible / toggleLayerVisible", () => {
  it("关掉素材层：文档里出现 element.visible=false，且压一步快照", () => {
    state().setLayerVisible("element", false);
    expect(layerVisibleOf(state().doc, "element")).toBe(false);
    expect(state().undoStack).toHaveLength(1);
    // 其它层不受影响
    expect(layerVisibleOf(state().doc, "label")).toBe(true);
  });

  it("撤销可回：再切回可见后撤销一次，仍是隐藏", () => {
    state().setLayerVisible("element", false);
    state().setLayerVisible("element", true);
    expect(layerVisibleOf(state().doc, "element")).toBe(true);

    state().undo();
    expect(layerVisibleOf(state().doc, "element")).toBe(false);
  });

  it("切回默认（可见）时把这一项从文档里删掉，不留垃圾字段", () => {
    state().setLayerVisible("element", false);
    state().setLayerVisible("element", true);
    // 整个 layerState 空掉时连字段一起删 —— 零写入的延伸
    expect(Object.prototype.hasOwnProperty.call(state().doc, "layerState")).toBe(false);
  });

  it("只剩锁时，切回可见只删 visible、保留 locked", () => {
    state().setLayerLocked("element", true);
    state().setLayerVisible("element", false);
    state().setLayerVisible("element", true);
    expect(state().doc.layerState).toEqual({ element: { locked: true } });
  });

  it("值没变时不进 commit（空步不占撤销栈）", () => {
    state().setLayerVisible("element", true);
    expect(state().undoStack).toHaveLength(0);
  });

  it("区块层写的是 showRegions，不允许在 layerState 里出现 region.visible（D4）", () => {
    state().setLayerVisible("region", false);
    expect(state().doc.showRegions).toBe(false);
    expect(state().doc.layerState?.region?.visible).toBeUndefined();
    // 与工具栏的 toggleRegions 是同一个状态
    state().toggleRegions();
    expect(state().doc.showRegions).toBe(true);
  });

  it("toggleLayerVisible 读的是当前值（不是写死 true/false）", () => {
    state().toggleLayerVisible("label");
    expect(layerVisibleOf(state().doc, "label")).toBe(false);
    state().toggleLayerVisible("label");
    expect(layerVisibleOf(state().doc, "label")).toBe(true);
    expect(state().undoStack).toHaveLength(2);
  });
});

describe("setLayerLocked", () => {
  it("锁不影响渲染侧的可见性（锁 ≠ 隐藏）", () => {
    state().setLayerLocked("element", true);
    expect(layerLockedOf(state().doc, "element")).toBe(true);
    expect(layerVisibleOf(state().doc, "element")).toBe(true);
  });

  it("区块层可以只锁不可见（region.locked 合法，region.visible 不合法）", () => {
    state().setLayerLocked("region", true);
    expect(state().doc.layerState).toEqual({ region: { locked: true } });
    expect(state().doc.showRegions).toBe(true);
  });

  it("解锁后整份 layerState 被清掉", () => {
    state().setLayerLocked("submap", true);
    state().setLayerLocked("submap", false);
    expect(Object.prototype.hasOwnProperty.call(state().doc, "layerState")).toBe(false);
  });

  it("锁定进撤销栈（锁错了要能撤）", () => {
    state().setLayerLocked("label", true);
    expect(state().undoStack).toHaveLength(1);
    state().undo();
    expect(layerLockedOf(state().doc, "label")).toBe(false);
  });
});

describe("图层状态随文档落库的形状", () => {
  it("初始文档（createEmptyDocument）不带 layerState / polylines", () => {
    const doc = createEmptyDocument();
    expect(Object.prototype.hasOwnProperty.call(doc, "layerState")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(doc, "polylines")).toBe(false);
  });

  it("序列化后只剩被改过的那一项（不会被 JSON 补成空对象）", () => {
    state().setLayerVisible("element", false);
    const json = JSON.parse(JSON.stringify(state().doc)) as Record<string, unknown>;
    expect(json.layerState).toEqual({ element: { visible: false } });
  });
});
