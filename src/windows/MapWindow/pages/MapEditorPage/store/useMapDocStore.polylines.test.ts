import { beforeEach, describe, expect, it } from "vitest";
import { useMapDocStore } from "./useMapDocStore";
import { resetMapStores } from "./reset";
import { createPolylineId, docPolylines, type MapPolyline } from "../types";

/**
 * 折线（B4-2 / R-MAP-26）在 store 层的账目。
 *
 * ── 为什么必须在 store 层测 ──
 * PRD §6-B4-2 验收⑤要求"落线一步、拖节点一步、删线一步"——这条账目
 * 只在**连续几步**之后才看得出对错，页面用例里被 React 提交与 pointer 事件
 * 盖住，直接对 store 发号施令最清楚。此外还有三条零写入形状规则：
 *   · 没画过线的文档不能凭空多出 `polylines: []`；
 *   · 清空标签 / 线宽调回 1 倍 ⇒ **删键**，不写 `label: undefined`；
 *   · 删到只剩 1 点时整条线一起删（幽灵对象的来源）。
 */

const state = () => useMapDocStore.getState();

const pl = (id: string, points: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
]): MapPolyline => ({
  id,
  kind: "road",
  styleId: "road-main",
  points,
  closed: false,
  level: null,
});

const pointsOf = (id: string) =>
  docPolylines(state().doc).find((p) => p.id === id)?.points ?? [];

beforeEach(() => {
  resetMapStores();
});

describe("addPolyline", () => {
  it("落一条线：进文档 + 压一步快照（撤销能整条退掉）", () => {
    state().addPolyline(pl("pl_a"));
    expect(docPolylines(state().doc)).toHaveLength(1);
    expect(state().undoStack).toHaveLength(1);

    state().undo();
    expect(docPolylines(state().doc)).toHaveLength(0);
    // 撤销回"从没画过线"⇒ polylines 键整个消失（零写入），而不是留一个 []
    expect(Object.prototype.hasOwnProperty.call(state().doc, "polylines")).toBe(false);
  });

  it("少于 2 点不入库，也不产生空撤销步", () => {
    state().addPolyline(pl("pl_one", [{ x: 0, y: 0 }]));
    expect(docPolylines(state().doc)).toHaveLength(0);
    expect(state().undoStack).toHaveLength(0);
  });

  it("连续画两条 = 两步撤销（不合并）", () => {
    state().addPolyline(pl("pl_a"));
    state().addPolyline(pl("pl_b"));
    expect(state().undoStack).toHaveLength(2);

    state().undo();
    expect(docPolylines(state().doc).map((p) => p.id)).toEqual(["pl_a"]);
  });
});

describe("updatePolyline", () => {
  beforeEach(() => {
    state().addPolyline(pl("pl_a"));
    // 清掉 add 那一步，让断言只看 update 的账
    useMapDocStore.setState({ undoStack: [] });
  });

  it("改样式 / 标签各压一步；同键连续调用只压一步", () => {
    state().updatePolyline("pl_a", { styleId: "road-trail" }, "pl:pl_a:style");
    state().updatePolyline("pl_a", { label: "官道" }, "pl:pl_a:style");
    expect(state().undoStack).toHaveLength(1);
    expect(docPolylines(state().doc)[0].label).toBe("官道");
  });

  it("清空标签 ⇒ 删键，而不是写空串", () => {
    state().updatePolyline("pl_a", { label: "官道" });
    state().updatePolyline("pl_a", { label: "" });
    const target = docPolylines(state().doc)[0];
    expect(Object.prototype.hasOwnProperty.call(target, "label")).toBe(false);
  });

  it("线宽调回 1 倍 ⇒ 删键（没拖过滑杆的线不带这个字段）", () => {
    state().updatePolyline("pl_a", { widthScale: 1.8 });
    expect(docPolylines(state().doc)[0].widthScale).toBe(1.8);
    state().updatePolyline("pl_a", { widthScale: 1 });
    expect(Object.prototype.hasOwnProperty.call(docPolylines(state().doc)[0], "widthScale")).toBe(
      false,
    );
  });

  it("id 不存在时静默（不压空步）", () => {
    state().updatePolyline("pl_nope", { label: "x" });
    expect(state().undoStack).toHaveLength(0);
  });

  it("改层级到 null 是合法值（层级无关 ≠ 忘写）", () => {
    state().updatePolyline("pl_a", { level: 2 });
    expect(docPolylines(state().doc)[0].level).toBe(2);
    state().updatePolyline("pl_a", { level: null });
    expect(docPolylines(state().doc)[0].level).toBeNull();
  });
});

describe("movePolylinePoint（拖拽高频路径）", () => {
  it("改坐标但**不入撤销栈**（快照由拖拽开始压一次）", () => {
    state().addPolyline(pl("pl_a"));
    useMapDocStore.setState({ undoStack: [] });

    state().movePolylinePoint("pl_a", 1, { x: 200, y: 50 });
    expect(pointsOf("pl_a")[1]).toEqual({ x: 200, y: 50 });
    expect(state().undoStack).toHaveLength(0);
  });

  it("只动目标点，其余点原样", () => {
    state().addPolyline(
      pl("pl_a", [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    );
    state().movePolylinePoint("pl_a", 1, { x: 10, y: 99 });
    expect(pointsOf("pl_a")).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 99 },
      { x: 20, y: 0 },
    ]);
  });

  it("越界 index 不新增点（不能靠拖拽把数组撑长）", () => {
    state().addPolyline(pl("pl_a"));
    state().movePolylinePoint("pl_a", 9, { x: 1, y: 1 });
    expect(pointsOf("pl_a")).toHaveLength(2);
  });
});

describe("insertPolylinePoint / deletePolylinePoint", () => {
  beforeEach(() => {
    state().addPolyline(pl("pl_a"));
    useMapDocStore.setState({ undoStack: [] });
  });

  it("插点落到指定位置并压一步", () => {
    state().insertPolylinePoint("pl_a", 1, { x: 50, y: 0 });
    expect(pointsOf("pl_a")).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(state().undoStack).toHaveLength(1);
  });

  it("插入位被钳到 [1, length]（新点不许顶掉首尾端点）", () => {
    // 下界是 1 而不是 0：双击靠近首点时，"插一段"应该落在首点**之后**，
    // 否则线的起点会被悄悄换成一个用户没拖过的点（端点语义是整个工具的基础）。
    state().insertPolylinePoint("pl_a", -3, { x: -9, y: -9 });
    expect(pointsOf("pl_a")[0]).toEqual({ x: 0, y: 0 });
    expect(pointsOf("pl_a")[1]).toEqual({ x: -9, y: -9 });

    state().insertPolylinePoint("pl_a", 99, { x: 999, y: 999 });
    const pts = pointsOf("pl_a");
    expect(pts[pts.length - 1]).toEqual({ x: 999, y: 999 });
  });

  it("删点：只掉这一个点，其余保留", () => {
    state().insertPolylinePoint("pl_a", 1, { x: 50, y: 0 });
    state().deletePolylinePoint("pl_a", 1);
    expect(pointsOf("pl_a")).toHaveLength(2);
    expect(state().undoStack).toHaveLength(2);
  });

  it("删到只剩 1 点 ⇒ 整条线一起删（不留幽灵对象）", () => {
    state().deletePolylinePoint("pl_a", 0);
    expect(docPolylines(state().doc)).toHaveLength(0);
    // 一步撤销能把线整个找回来
    state().undo();
    expect(docPolylines(state().doc)).toHaveLength(1);
  });

  it("id / index 不存在时静默，不压空步", () => {
    state().deletePolylinePoint("pl_nope", 0);
    state().insertPolylinePoint("pl_nope", 1, { x: 0, y: 0 });
    expect(state().undoStack).toHaveLength(0);
  });
});

describe("removePolyline", () => {
  it("删线压一步，撤销能复原（含样式 / 点位）", () => {
    state().addPolyline({ ...pl("pl_a"), label: "官道", widthScale: 1.5 });
    useMapDocStore.setState({ undoStack: [] });

    state().removePolyline("pl_a");
    expect(docPolylines(state().doc)).toHaveLength(0);
    expect(state().undoStack).toHaveLength(1);

    state().undo();
    const back = docPolylines(state().doc)[0];
    expect(back.label).toBe("官道");
    expect(back.widthScale).toBe(1.5);
    expect(back.points).toHaveLength(2);
  });

  it("删不存在的 id 不压空步", () => {
    state().removePolyline("pl_nope");
    expect(state().undoStack).toHaveLength(0);
  });
});

describe("撤销栈与既有字段的协同（半截撤销的防线）", () => {
  it("画线 → 放素材 → 撤销，只回退素材，线还在", () => {
    state().addPolyline(pl("pl_a"));
    state().placeSprite("tree", { x: 5, y: 5 }, null);

    state().undo();
    expect(state().doc.elements).toHaveLength(0);
    expect(docPolylines(state().doc)).toHaveLength(1);
  });

  it("老快照（没有 polylines 字段）撤销后仍能正常回退，不会抛", () => {
    state().addPolyline(pl("pl_a"));
    // 模拟 B4-2 之前就躺在栈里的快照：字段整个不存在
    useMapDocStore.setState({
      undoStack: [
        {
          elements: [],
          regions: [],
          land: null,
          labels: [],
          style: "ink",
          showRegions: true,
          baseImageId: "",
          regionSchema: state().doc.regionSchema,
        },
      ] as never,
    });
    expect(() => state().undo()).not.toThrow();
    expect(Object.prototype.hasOwnProperty.call(state().doc, "polylines")).toBe(false);
  });

  it("重做能把线找回来", () => {
    state().addPolyline(pl("pl_a"));
    state().undo();
    expect(docPolylines(state().doc)).toHaveLength(0);
    state().redo();
    expect(docPolylines(state().doc)).toHaveLength(1);
  });
});

describe("createPolylineId", () => {
  it("带 pl_ 前缀且不重复", () => {
    const a = createPolylineId();
    const b = createPolylineId();
    expect(a.startsWith("pl_")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("B4-3：剪贴板 / 复制 / 微移（折线与素材同一套）", () => {
  beforeEach(() => {
    state().addPolyline(pl("pl_a", [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]));
    useMapDocStore.setState({ undoStack: [] });
  });

  it("复制：剪贴板持有折线且与文档对象解引用（后续拖节点不变形剪贴板）", () => {
    state().copyElement("pl_a");
    const clip = state().clipboard;
    expect(clip && "points" in clip).toBe(true);
    state().movePolylinePoint("pl_a", 0, { x: 55, y: 55 });
    expect((state().clipboard as { points: { x: number }[] }).points[0].x).toBe(0);
  });

  it("粘贴：新 id + 斜移，压一步撤销，原线不动", () => {
    state().copyElement("pl_a");
    const newId = state().pasteElement();
    expect(newId).not.toBeNull();
    expect(newId).not.toBe("pl_a");
    const list = docPolylines(state().doc);
    expect(list).toHaveLength(2);
    const pasted = list.find((p) => p.id === newId)!;
    expect(pasted.points[0]).toEqual({ x: 16, y: 16 }); // ELEMENT_PASTE_OFFSET
    expect(pasted.styleId).toBe("road-main");
    expect(state().undoStack).toHaveLength(1);
  });

  it("剪贴板能同时装过两种类型：后复制的覆盖前者", () => {
    state().copyElement("pl_a");
    state().placeSprite("tree", { x: 5, y: 5 }, null);
    const elId = state().doc.elements[0].id;
    state().copyElement(elId);
    expect(state().clipboard && "points" in state().clipboard!).toBe(false);
    state().copyElement("pl_a");
    expect(state().clipboard && "points" in state().clipboard!).toBe(true);
  });

  it("复制一份（duplicate）：新 id + 斜移 + 压一步，选中回填由 hook 负责", () => {
    const nextId = state().duplicateElement("pl_a");
    expect(nextId).not.toBeNull();
    expect(docPolylines(state().doc)).toHaveLength(2);
    expect(state().undoStack).toHaveLength(1);
  });

  it("微移：所有点一起平移，连按合并为一步撤销", () => {
    state().nudgeElement("pl_a", 3, 4);
    state().nudgeElement("pl_a", 3, 4);
    expect(pointsOf("pl_a")[0]).toEqual({ x: 6, y: 8 });
    expect(state().undoStack).toHaveLength(1); // nudge 合并键
    state().undo();
    expect(pointsOf("pl_a")[0]).toEqual({ x: 0, y: 0 });
  });

  it("剪切：剪贴板持有 + 原线删除（可撤销）", () => {
    state().cutElement("pl_a");
    expect(state().clipboard && "points" in state().clipboard!).toBe(true);
    expect(docPolylines(state().doc)).toHaveLength(0);
    state().undo();
    expect(docPolylines(state().doc)).toHaveLength(1);
  });

  it("闭合线删到只剩 2 点：自动退化为开链（closed 改写 false）", () => {
    state().addPolyline(pl("pl_loop", [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]));
    useMapDocStore.setState({ undoStack: [] });
    state().updatePolyline("pl_loop", { closed: true });
    state().deletePolylinePoint("pl_loop", 2);
    const target = docPolylines(state().doc).find((p) => p.id === "pl_loop")!;
    expect(target.points).toHaveLength(2);
    expect(target.closed).toBe(false);
  });

  it("本来就开着的线删点不会被添上 closed:false 的痕迹", () => {
    state().insertPolylinePoint("pl_a", 1, { x: 50, y: 0 });
    state().deletePolylinePoint("pl_a", 1);
    const target = docPolylines(state().doc).find((p) => p.id === "pl_a")!;
    expect(Object.prototype.hasOwnProperty.call(target, "closed")).toBe(true); // 构造时就有
    expect(target.closed).toBe(false);
  });
});
