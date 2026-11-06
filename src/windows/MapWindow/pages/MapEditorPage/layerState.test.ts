import { describe, expect, it } from "vitest";
import {
  MAP_LAYER_IDS,
  MAP_LAYER_ROWS,
  layerLockedOf,
  layerVisibleOf,
  normalizeLayerState,
} from "./layerState";
import { migrateDoc } from "./types";

/**
 * 逻辑图层状态的读点与归一化（B4-1）。
 *
 * ── 为什么这组必须有单测 ──
 * 这一层全是"缺省值"语义：`visible` 缺省为真、`locked` 缺省为假、`region` 的可见性
 * 却挂在**另一个字段**（`showRegions`）上。三条规则里任何一条写反，症状都是
 * "某个层的开关点了没反应 / 反着来"，而画布上看起来只是"某一类东西不见了"，
 * 很难定位到是读点函数的问题。
 */

describe("layerVisibleOf", () => {
  it("缺省全部可见（老文档没有 layerState）", () => {
    for (const id of MAP_LAYER_IDS) {
      expect(layerVisibleOf({ showRegions: true }, id)).toBe(true);
    }
  });

  it("显式 visible:false 才算隐藏，其余一切（true / 缺字段 / 非法值）都可见", () => {
    expect(layerVisibleOf({ showRegions: true, layerState: { element: { visible: false } } }, "element")).toBe(
      false,
    );
    expect(layerVisibleOf({ showRegions: true, layerState: { element: { visible: true } } }, "element")).toBe(
      true,
    );
    // 只锁不隐：可见性不受 locked 影响（锁 ≠ 隐藏，PRD §8-4）
    expect(layerVisibleOf({ showRegions: true, layerState: { element: { locked: true } } }, "element")).toBe(
      true,
    );
  });

  it("区块层的事实源是 showRegions，layerState.region.visible 不参与判断（D4）", () => {
    expect(
      layerVisibleOf({ showRegions: false, layerState: { region: { visible: true } } }, "region"),
    ).toBe(false);
    expect(
      layerVisibleOf({ showRegions: true, layerState: { region: { visible: false } } }, "region"),
    ).toBe(true);
  });

  it("各层互不影响（关掉素材不该把地名一起关了）", () => {
    const host = { showRegions: true, layerState: { element: { visible: false } } };
    expect(layerVisibleOf(host, "element")).toBe(false);
    expect(layerVisibleOf(host, "label")).toBe(true);
    expect(layerVisibleOf(host, "submap")).toBe(true);
  });
});

describe("layerLockedOf", () => {
  it("缺省未锁；只有 locked === true 才算锁", () => {
    expect(layerLockedOf({ showRegions: true }, "element")).toBe(false);
    expect(
      layerLockedOf({ showRegions: true, layerState: { element: { visible: false } } }, "element"),
    ).toBe(false);
    expect(
      layerLockedOf({ showRegions: true, layerState: { element: { locked: true } } }, "element"),
    ).toBe(true);
  });
});

describe("normalizeLayerState（migrateDoc 的剔除规则）", () => {
  it("非对象 / 数组 / null 一律判非法", () => {
    expect(normalizeLayerState(undefined)).toBeNull();
    expect(normalizeLayerState(null)).toBeNull();
    expect(normalizeLayerState("locked")).toBeNull();
    expect(normalizeLayerState([])).toBeNull();
  });

  it("未知层 key 丢弃（代码里没有的层不能留在存档里）", () => {
    expect(normalizeLayerState({ terrain: { visible: false } })).toBeNull();
    expect(normalizeLayerState({ element: { visible: false }, terrain: { locked: true } })).toEqual({
      element: { visible: false },
    });
  });

  it("非布尔的 visible / locked 丢弃", () => {
    expect(normalizeLayerState({ element: { visible: "no", locked: 1 } })).toBeNull();
    expect(normalizeLayerState({ element: { visible: false, locked: "yes" } })).toEqual({
      element: { visible: false },
    });
  });

  it("region.visible 一律丢弃（双源），只保留 region.locked", () => {
    expect(normalizeLayerState({ region: { visible: false } })).toBeNull();
    expect(normalizeLayerState({ region: { visible: false, locked: true } })).toEqual({
      region: { locked: true },
    });
  });

  it("合法值原样保留，不补默认值", () => {
    expect(
      normalizeLayerState({ element: { visible: false }, label: { locked: true } }),
    ).toEqual({ element: { visible: false }, label: { locked: true } });
  });
});

describe("migrateDoc 的零写入", () => {
  it("从没写过 layerState 的文档，迁移后也不该有这个键", () => {
    const out = migrateDoc({
      version: 2,
      baseImageId: "base-1",
      land: null,
      style: "none",
      labels: [],
      showRegions: true,
      elements: [],
      regions: [],
    });
    expect(Object.prototype.hasOwnProperty.call(out, "layerState")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, "polylines")).toBe(false);
  });

  it("脏 layerState 被清理成合法形状（只删不改）", () => {
    const out = migrateDoc({
      version: 2,
      layerState: { region: { visible: false }, element: { visible: false, junk: 1 }, ghost: {} },
    });
    expect(out.layerState).toEqual({ element: { visible: false } });
  });

  it("全是脏值时整个字段删掉，而不是留一个空对象", () => {
    const out = migrateDoc({ version: 2, layerState: { ghost: { visible: false } } });
    expect(Object.prototype.hasOwnProperty.call(out, "layerState")).toBe(false);
  });

  it("polylines 存在但不是数组 → 删掉（元素结构由编辑动作保证，这里只管形态）", () => {
    expect(Object.prototype.hasOwnProperty.call(migrateDoc({ version: 2, polylines: {} }), "polylines")).toBe(
      false,
    );
    expect(migrateDoc({ version: 2, polylines: [] }).polylines).toEqual([]);
  });
});

describe("MAP_LAYER_ROWS（面板行的唯一出处）", () => {
  it("六行：底图 + 五个可写层，id 不重复", () => {
    expect(MAP_LAYER_ROWS).toHaveLength(MAP_LAYER_IDS.length + 1);
    expect(new Set(MAP_LAYER_ROWS.map((r) => r.id)).size).toBe(MAP_LAYER_ROWS.length);
    expect(MAP_LAYER_ROWS.map((r) => r.id)).toContain("base");
  });

  it("只有底图是只读行，且它没有计数（写「1」没有信息量）", () => {
    const readonlyRows = MAP_LAYER_ROWS.filter((r) => r.readonly);
    expect(readonlyRows.map((r) => r.id)).toEqual(["base"]);
    expect(readonlyRows[0].unit).toBeNull();
  });
});
