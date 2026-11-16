import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../types";
import {
  ELEMENT_PASTE_OFFSET,
  ELEMENT_SCALE_MAX,
  ELEMENT_SCALE_MIN,
  HISTORY_LIMIT,
  REGION_SCHEMA_COMMIT_KEY,
  applySnapshot,
  snapshotOf,
  withLayerState,
} from "./docSnapshot";

describe("docSnapshot —— 撤销栈纯函数", () => {
  it("快照只取会进历史的字段，且数组是引用共享而非深拷贝", () => {
    const doc = createEmptyDocument();
    const snap = snapshotOf(doc);
    expect(snap.elements).toBe(doc.elements);
    expect(snap.labels).toBe(doc.labels);
    expect(snap.regions).toBe(doc.regions);
    expect(Object.keys(snap)).toContain("layerState");
    expect(Object.keys(snap)).toContain("polylines");
    expect(Object.keys(snap)).not.toContain("version");
  });

  it("applySnapshot 把全部历史字段写回，非历史字段保持原样", () => {
    const doc = { ...createEmptyDocument(), baseImageId: "paper-b", style: "ink" as const };
    const snap = snapshotOf(doc);
    const next = applySnapshot({ ...doc, baseImageId: "paper-a" }, snap);
    expect(next.baseImageId).toBe("paper-b");
    expect(next.style).toBe(doc.style);
  });

  it("快照里 layerState / polylines 为 undefined 时，写回必须整个删键", () => {
    const doc = {
      ...createEmptyDocument(),
      layerState: { element: { visible: false } },
      polylines: [],
    };
    const snap = { ...snapshotOf(doc), layerState: undefined, polylines: undefined };
    const next = applySnapshot(doc, snap);
    expect("layerState" in next).toBe(false);
    expect("polylines" in next).toBe(false);
  });

  it("withLayerState 把恢复默认值的字段清掉，整份空时连 layerState 键一起删", () => {
    const doc = { ...createEmptyDocument(), layerState: { element: { visible: false, locked: true } } };
    const cleared = withLayerState(doc, "element", { visible: true, locked: false });
    expect("layerState" in cleared).toBe(false);
    const partial = withLayerState(doc, "element", { visible: true });
    expect(partial.layerState?.element).toEqual({ locked: true });
  });

  it("层级配置合并键与历史深度的取值固定", () => {
    expect(REGION_SCHEMA_COMMIT_KEY).toBe("regionSchema");
    expect(HISTORY_LIMIT).toBe(50);
    expect(ELEMENT_PASTE_OFFSET).toBe(16);
    expect(ELEMENT_SCALE_MIN).toBeLessThan(ELEMENT_SCALE_MAX);
  });
});
