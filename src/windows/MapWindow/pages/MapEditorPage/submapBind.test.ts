/**
 * `submapFromDoc`（路径 A′ 拷贝构造）的纯函数用例。
 *
 * 钉三件事：拷贝隔离（改子图不动源文档）、id 全树重映射（含嵌套子图与引用字段）、
 * 零写入口径（源文档没有 `polylines` 就不写键）。
 */
import { describe, expect, it } from "vitest";
import type { MapRegion } from "./regions";
import { createEmptyDocument } from "./types";
import { submapFromDoc, SUBMAP_PAPER_BOUNDS } from "./submapBind";

/** 造一张带嵌套子图的源文档（区块树两层 + 素材/地名/折线齐全） */
function sourceDoc() {
  const doc = createEmptyDocument();
  const parent: MapRegion = {
    ...doc.regions[0],
    id: "rg_root",
    parentId: null,
    level: 0,
    name: "县城",
  };
  const child: MapRegion = {
    ...parent,
    id: "rg_child",
    parentId: "rg_root",
    level: 1,
    name: "东城区",
  };
  doc.regions = [parent, child];
  doc.elements = [{ ...doc.elements[0], id: "el_town", x: 10, y: 20 }];
  doc.labels = [{ ...doc.labels[0], id: "lb_name", text: "小溪村" }];
  doc.polylines = [
    {
      id: "pl_river",
      kind: "river",
      styleId: "river",
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      closed: false,
      level: 0,
    },
  ];
  // 根区块再嵌一张子图（嵌套拷贝要能递归重映射进去）
  parent.submap = {
    id: "sm_inner",
    bounds: { ...SUBMAP_PAPER_BOUNDS },
    land: null,
    regions: [{ ...child, id: "rg_inner", parentId: null }],
    elements: [],
    labels: [],
    style: "none",
    baseImageId: "paper-default",
  };
  return doc;
}

describe("SUBMAP_PAPER_BOUNDS", () => {
  it("就是父图那张 1024² 的标准纸（中心在原点）", () => {
    expect(SUBMAP_PAPER_BOUNDS).toEqual({ x: -512, y: -512, width: 1024, height: 1024 });
  });
});

describe("submapFromDoc", () => {
  it("拷贝隔离：改子图内容不影响源文档（同一引用都不共享）", () => {
    const source = sourceDoc();
    const sub = submapFromDoc(source);

    sub.regions[0].name = "被改过的名字";
    sub.elements[0].x = 999;
    expect(source.regions[0].name).toBe("县城");
    expect(source.elements[0].x).toBe(10);
    expect(sub.id).not.toBe(source.regions[0].submap!.id); // 新子图有自己的 id
  });

  it("id 全树重映射：区块/素材/地名/折线 + parentId 引用 + 嵌套子图", () => {
    const sub = submapFromDoc(sourceDoc());
    const prefix = `${sub.id}_`;

    expect(sub.regions.map((r) => r.id)).toEqual([`${prefix}rg_root`, `${prefix}rg_child`]);
    expect(sub.regions[1].parentId).toBe(`${prefix}rg_root`);
    expect(sub.elements[0].id).toBe(`${prefix}el_town`);
    expect(sub.labels[0].id).toBe(`${prefix}lb_name`);
    expect(sub.polylines![0].id).toBe(`${prefix}pl_river`);

    // 嵌套子图同样被重映射；源值 null 的 parentId 保持 null（不硬加前缀）
    const inner = sub.regions[0].submap!;
    expect(inner.regions[0].id).toBe(`${prefix}rg_inner`);
    expect(inner.regions[0].parentId).toBeNull();
  });

  it("零写入：源文档没有 polylines 字段时子图也不写键", () => {
    const source = createEmptyDocument();
    const sub = submapFromDoc(source);
    expect(sub.polylines).toBeUndefined();
    expect("polylines" in sub).toBe(false);
  });

  it("无陆地的源图（路径 B 风格的空图）绑出来 land = null", () => {
    const sub = submapFromDoc(createEmptyDocument());
    expect(sub.land).toBeNull();
    expect(sub.bounds).toEqual(SUBMAP_PAPER_BOUNDS);
  });

  it("两份拷贝之间、拷贝与宿主文档之间 id 不撞（前缀含子图 id）", () => {
    const a = submapFromDoc(sourceDoc());
    const b = submapFromDoc(sourceDoc());
    const aIds = a.regions.map((r) => r.id);
    const bIds = b.regions.map((r) => r.id);
    expect(aIds.some((id) => bIds.includes(id))).toBe(false);
  });
});
