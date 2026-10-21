/**
 * 关系图派生层单测（R27）
 *
 * 这里钉的是**产品稿 §4.2 / §4.4 的收口规则**，不是实现细节：
 * 顶点归属反推、level 降级、自环 / 悬空 / 跨作品 / 重复的处置、平行边标签形态、
 * 孤立要素不被派生层吞掉、同一输入确定性产出。
 */
import { describe, expect, it } from "vitest";
import type { NovelEntity, NovelLink } from "./entity-model";
import { buildRelationGraph, formatEdgeLabel } from "./relation-graph";
import type { SettingCategory } from "./setting-types";

const WORK = "w1";

function entity(id: string, type: string, name: string, sort: number, workId = WORK): NovelEntity {
  return {
    id,
    workId,
    type,
    name,
    aliases: [],
    summary: "",
    content: "",
    fields: {},
    sort,
  };
}

function link(id: string, fromId: string, toId: string, relation: string, extra?: Partial<NovelLink>): NovelLink {
  return {
    id,
    fromType: "character",
    fromId,
    toType: "character",
    toId,
    relation,
    ...extra,
  };
}

/** 模板夹具（对齐产品稿 §4.4：11 要素 / 8 条实体关联 / 1 条境界绑定 / 2 个孤立） */
function templateFixture() {
  const entities: NovelEntity[] = [
    entity("e-lin", "character", "林晚", 1),
    entity("e-su", "character", "苏铭", 2),
    entity("e-gu", "character", "顾长生", 3),
    entity("e-town", "location", "青云镇", 4),
    entity("e-mount", "location", "断碑山", 5),
    entity("e-sect", "faction", "青玄宗", 6),
    entity("e-demon", "faction", "血魔教", 7),
    entity("e-sword", "item", "断水剑", 8),
    entity("e-pill", "item", "回气丹", 9),
    entity("e-sys-lingtu", "level_system", "灵徒", 10),
    entity("e-custom-calendar", "ct-calendar", "历法", 11),
  ];
  const links: NovelLink[] = [
    link("l1", "e-lin", "e-sect", "拜入"),
    link("l2", "e-lin", "e-su", "同门"),
    link("l3", "e-su", "e-demon", "仇敌"),
    link("l4", "e-gu", "e-sect", "长老"),
    link("l5", "e-gu", "e-mount", "隐居"),
    link("l6", "e-town", "e-sect", "辖下"),
    link("l7", "e-sword", "e-lin", "佩剑"),
    link("l8", "e-pill", "e-gu", "炼制"),
    // 境界绑定：to_type='level'，to_id 指向 novel_setting_levels
    {
      id: "l9",
      fromType: "character",
      fromId: "e-lin",
      toType: "level",
      toId: "lv-lingtu-3",
      relation: "当前境界",
      note: '{"sub":2}',
    },
  ];
  const settings: SettingCategory[] = [
    {
      id: "sc-realm",
      workId: WORK,
      name: "境界",
      color: "#888888",
      kind: "realm",
      sortOrder: 0,
      note: "",
      subLevels: 3,
      carryDir: "asc",
      subPattern: "第{n}层",
      levels: [
        {
          id: "lv-lingtu",
          categoryId: "sc-realm",
          name: "灵徒",
          rank: 1,
          aliases: [],
          note: "",
          subLevels: 3,
          subPattern: "",
          power: null,
          parentId: null,
          segFrom: null,
          segTo: null,
        },
        {
          id: "lv-lingtu-3",
          categoryId: "sc-realm",
          name: "灵徒·三层",
          rank: 2,
          aliases: [],
          note: "",
          subLevels: 3,
          subPattern: "",
          power: null,
          parentId: "lv-lingtu",
          segFrom: 3,
          segTo: 3,
        },
      ],
    },
  ];
  return { entities, links, settings };
}

describe("buildRelationGraph：模板夹具基线", () => {
  it("11 要素 / 8 关联 / 1 条境界绑定 → 画布 9 节点 · 8 边，池中 2 个孤立", () => {
    const { entities, links, settings } = templateFixture();
    const doc = buildRelationGraph({ workId: WORK, entities, links, settings });

    expect(doc.diagnostics.entityCount).toBe(11);
    expect(doc.diagnostics.nodeCount).toBe(9);
    expect(doc.diagnostics.edgeCount).toBe(8);
    expect(doc.diagnostics.poolCount).toBe(2);
    expect(doc.pool.map((node) => node.id).sort()).toEqual([
      "e-custom-calendar",
      "e-sys-lingtu",
    ]);
    // 等级体系要素没有任何实体关联 → 进池子（不是被派生层删除）
    expect(doc.pool.some((node) => node.id === "e-sys-lingtu")).toBe(true);
    expect(doc.diagnostics.dropped.level).toBe(1);
  });

  it("境界绑定降级为副标题，不产生边、不产生 level 假节点", () => {
    const { entities, links, settings } = templateFixture();
    const doc = buildRelationGraph({ workId: WORK, entities, links, settings });
    const lin = doc.nodes.find((node) => node.id === "e-lin");
    expect(lin?.realm).not.toBe("");
    expect(lin?.realm).toContain("灵徒");
    expect(doc.nodes.some((node) => node.id.startsWith("lv-"))).toBe(false);
    expect(doc.edges.some((edge) => edge.target === "lv-lingtu-3")).toBe(false);
  });

  it("同一输入两次派生结果完全一致（确定性）", () => {
    const { entities, links, settings } = templateFixture();
    const a = buildRelationGraph({ workId: WORK, entities, links, settings });
    const b = buildRelationGraph({ workId: WORK, entities, links, settings });
    expect(a).toEqual(b);
  });
});

describe("buildRelationGraph：脏数据处置", () => {
  const base = [
    entity("a", "character", "甲", 1),
    entity("b", "character", "乙", 2),
    entity("c", "character", "丙", 3),
  ];

  it("自环被丢弃并计数，不画自指边", () => {
    const doc = buildRelationGraph({
      workId: WORK,
      entities: base,
      links: [link("l1", "a", "a", "自己")],
    });
    expect(doc.edges).toHaveLength(0);
    expect(doc.diagnostics.dropped.selfLoop).toBe(1);
  });

  it("悬空端点被丢弃（指向已删要素 / 非要素类型）", () => {
    const doc = buildRelationGraph({
      workId: WORK,
      entities: base,
      links: [link("l1", "a", "ghost", "旧关系")],
    });
    expect(doc.edges).toHaveLength(0);
    expect(doc.diagnostics.dropped.dangling).toBe(1);
  });

  it("另一端属于别的作品 → 计入跨作品，不混进本书的图", () => {
    const entities = [...base, entity("x", "character", "别书角色", 1, "w2")];
    const doc = buildRelationGraph({
      workId: WORK,
      entities,
      links: [link("l1", "a", "x", "跨书")],
    });
    expect(doc.edges).toHaveLength(0);
    expect(doc.diagnostics.dropped.crossWork).toBe(1);
    expect(doc.nodes.some((node) => node.id === "x")).toBe(false);
  });

  it("完全重复的关联只留一条，多余计入 duplicate", () => {
    const doc = buildRelationGraph({
      workId: WORK,
      entities: base,
      links: [link("l1", "a", "b", "同门"), link("l2", "a", "b", "同门")],
    });
    expect(doc.edges).toHaveLength(1);
    expect(doc.diagnostics.dropped.duplicate).toBe(1);
  });

  it("同一对要素的多条关系合并为一条边，标签「首条 + N」", () => {
    const doc = buildRelationGraph({
      workId: WORK,
      entities: base,
      links: [link("l1", "a", "b", "同门"), link("l2", "a", "b", "道侣"), link("l3", "b", "a", "宿敌")],
    });
    expect(doc.edges).toHaveLength(1);
    expect(doc.edges[0].relations).toEqual(["同门", "道侣", "宿敌"]);
    expect(doc.edges[0].extraCount).toBe(2);
    expect(doc.edges[0].label).toBe("同门 +2");
  });

  it("合并边保留每条关系的行 id 与备注（S3 写操作要落到具体那一行）", () => {
    const doc = buildRelationGraph({
      workId: WORK,
      entities: base,
      links: [
        link("l1", "a", "b", "同门"),
        { ...link("l2", "a", "b", "道侣"), note: "青梅竹马" },
      ],
    });
    const edge = doc.edges[0];
    // 顺序与 relations 严格对齐：UI 里「第 i 条关系」= 第 i 个 id
    expect(edge.linkIds).toEqual(["l1", "l2"]);
    expect(edge.notes).toEqual([undefined, "青梅竹马"]);
    expect(edge.linkIds).toHaveLength(edge.relations.length);
    // 首条备注仍走 note 字段（节点详情卡按它渲染）
    expect(edge.note).toBeUndefined();
  });

  it("formatEdgeLabel：无平行关系时不带后缀，且绝不是 ` · ` 拼接", () => {
    expect(formatEdgeLabel("同门", 0)).toBe("同门");
    expect(formatEdgeLabel("同门", 1)).toBe("同门 +1");
    expect(formatEdgeLabel("同门", 1)).not.toContain("·");
  });
});

describe("buildRelationGraph：成员集合（S2 画布模型）", () => {
  const entities = [
    entity("a", "character", "甲", 1),
    entity("b", "character", "乙", 2),
    entity("c", "character", "丙", 3),
  ];
  const links = [link("l1", "a", "b", "同门")];

  it("缺省 = 自动铺开：有边者上图，孤立者进池子", () => {
    const doc = buildRelationGraph({ workId: WORK, entities, links });
    expect(doc.nodes.map((node) => node.id).sort()).toEqual(["a", "b"]);
    expect(doc.pool.map((node) => node.id)).toEqual(["c"]);
  });

  it("显式成员集合优先：可把孤立要素拖上图，也可把有边要素移出", () => {
    const doc = buildRelationGraph({ workId: WORK, entities, links, members: ["a", "c"] });
    expect(doc.nodes.map((node) => node.id).sort()).toEqual(["a", "c"]);
    expect(doc.pool.map((node) => node.id)).toEqual(["b"]);
    // 边只保留两端都在图上的：a—b 的 b 不在图上 → 不画
    expect(doc.edges).toHaveLength(0);
  });

  it("空数组成员集合 = 用户把图清空了，不能再退化成自动铺开", () => {
    const doc = buildRelationGraph({ workId: WORK, entities, links, members: [] });
    expect(doc.nodes).toHaveLength(0);
    expect(doc.pool.map((node) => node.id).sort()).toEqual(["a", "b", "c"]);
    expect(doc.diagnostics.nodeCount).toBe(0);
    expect(doc.diagnostics.poolCount).toBe(3);
  });
});

describe("状态栏三数字（S4 ④）：画布 X · 池中 M · 全书 Y", () => {
  const entities = [
    entity("a", "character", "甲", 1),
    entity("b", "character", "乙", 2),
    entity("c", "character", "丙", 3),
    entity("d", "character", "丁", 4),
  ];
  const links = [link("l1", "a", "b", "同门")];

  /**
   * 不变式 `X + M = Y` 是「要素一个都没少」的可数证据：
   * 少了它，用户看到画布 1 个、池中 1 个、全书 4 个时无法判断是自己移出了
   * 两个，还是程序丢了两个。
   */
  it("三种成员集合（自动铺开 / 显式子集 / 清空）下，X + M 恒等于 Y", () => {
    const cases: Array<readonly string[] | undefined> = [undefined, ["a", "c"], []];
    for (const members of cases) {
      const doc = buildRelationGraph({ workId: WORK, entities, links, members });
      expect(doc.diagnostics.entityCount).toBe(4);
      expect(doc.diagnostics.nodeCount + doc.diagnostics.poolCount).toBe(4);
    }
  });

  it("池子 / 画布不重不漏：两者的并集恰好是全书要素", () => {
    const doc = buildRelationGraph({ workId: WORK, entities, links, members: ["b", "d"] });
    const ids = [...doc.nodes.map((node) => node.id), ...doc.pool.map((node) => node.id)].sort();
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("members 里混进外书 / 已删除的 id 时，Y 不虚增（按本书要素收口）", () => {
    const doc = buildRelationGraph({
      workId: WORK,
      entities: [...entities, entity("x", "character", "外书", 9, "other")],
      links,
      members: ["a", "ghost", "x"],
    });
    expect(doc.diagnostics.entityCount).toBe(4);
    expect(doc.diagnostics.nodeCount).toBe(1);
    expect(doc.diagnostics.poolCount).toBe(3);
    expect(doc.diagnostics.nodeCount + doc.diagnostics.poolCount).toBe(4);
  });
});
