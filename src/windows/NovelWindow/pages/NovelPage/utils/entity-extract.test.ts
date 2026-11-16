import { describe, expect, it } from "vitest";
import {
  buildExtractCandidates,
  normalizeExtractName,
  normalizeExtractType,
} from "./entity-extract";
import type { NovelEntity } from "../types";

/**
 * 实体抽取的纯逻辑契约（R-AI-08）
 *
 * 这段逻辑决定「哪些条目能入库、哪些算重复」，每条都是一个能钉住的判断。
 * 钉三件事：
 * 1. 重名（含别名）一律标 `existingId` 且默认不勾选 —— 覆盖手写简介不可逆；
 * 2. 类型三级回退「内置标签 → 自建类型名 → custom」，**不猜**；
 * 3. 名字归一后会丢掉「不是设定项」的垃圾（1 字泛称、模型写进名字的解释）。
 */

function entity(over: Partial<NovelEntity> = {}): NovelEntity {
  return {
    id: "e1",
    workId: "w1",
    type: "character",
    name: "李玄",
    aliases: [],
    summary: "",
    content: "",
    fields: {},
    sort: 1,
    ...over,
  };
}

describe("normalizeExtractType", () => {
  it("内置六个中文标签映射到对应类型 id", () => {
    expect(normalizeExtractType("人物")).toBe("character");
    expect(normalizeExtractType("地点")).toBe("location");
    expect(normalizeExtractType("势力")).toBe("faction");
    expect(normalizeExtractType("物品")).toBe("item");
    expect(normalizeExtractType("境界体系")).toBe("level_system");
    expect(normalizeExtractType("其他")).toBe("custom");
  });

  it("自建类型按名字命中（作者自己起的「功法」「丹药」）", () => {
    const custom = [{ id: "ct-1", name: "功法", color: "#fff" }];
    expect(normalizeExtractType("功法", custom)).toBe("ct-1");
  });

  it("认不出来一律落 custom，不猜", () => {
    expect(normalizeExtractType("神兽")).toBe("custom");
    expect(normalizeExtractType("")).toBe("custom");
    expect(normalizeExtractType("   ")).toBe("custom");
  });

  it("模型偶尔直接回传类型 id 也能认", () => {
    expect(normalizeExtractType("character")).toBe("character");
    expect(normalizeExtractType(" level_system ")).toBe("level_system");
  });
});

describe("normalizeExtractName", () => {
  it("剥掉书名号 / 引号 / 括号等包裹符号", () => {
    expect(normalizeExtractName("「青冥宗」")).toBe("青冥宗");
    expect(normalizeExtractName("《青云志》")).toBe("青云志");
    expect(normalizeExtractName('  “李玄” ')).toBe("李玄");
    expect(normalizeExtractName("（山门）")).toBe("山门");
  });

  it("只剥两端，正文里的括号不动", () => {
    expect(normalizeExtractName("李玄（青冥宗）")).toBe("李玄（青冥宗）");
  });

  it("空值 / undefined 不抛错", () => {
    expect(normalizeExtractName("")).toBe("");
    expect(normalizeExtractName(undefined as unknown as string)).toBe("");
  });
});

describe("buildExtractCandidates", () => {
  const entries = [
    { name: "李玄", type: "人物", summary: "外门弟子", evidence: "李玄握刀" },
    { name: "青冥宗", type: "势力", summary: "东域三宗", evidence: "青冥宗山门" },
  ];

  it("正常条目全部入选、默认勾选、无 existingId", () => {
    const list = buildExtractCandidates(entries, { existing: [] });
    expect(list).toHaveLength(2);
    expect(list.every((item) => item.selected)).toBe(true);
    expect(list.every((item) => item.existingId === null)).toBe(true);
    expect(list[0]).toMatchObject({ name: "李玄", type: "character", summary: "外门弟子" });
  });

  it("同名只留一条（模型常把同一个人抽两次）", () => {
    const list = buildExtractCandidates(
      [...entries, { name: "李玄", type: "人物", summary: "重复" }],
      { existing: [] },
    );
    expect(list.filter((item) => item.name === "李玄")).toHaveLength(1);
  });

  it("与已有卡同名 → 标 existingId 且默认不勾选（重名不覆盖）", () => {
    const list = buildExtractCandidates(entries, { existing: [entity()] });
    const li = list.find((item) => item.name === "李玄");
    expect(li).toMatchObject({ existingId: "e1", selected: false });
    // 没重名的那条照常勾上
    expect(list.find((item) => item.name === "青冥宗")?.selected).toBe(true);
  });

  it("命中已有卡的**别名**也算重复", () => {
    const list = buildExtractCandidates([{ name: "晚照师姐", type: "人物" }], {
      existing: [entity({ id: "e2", name: "林晚照", aliases: ["晚照师姐"] })],
    });
    expect(list[0]).toMatchObject({ existingId: "e2", selected: false });
  });

  it("名字过短（1 字泛称）或过长（模型把解释写进名字）直接丢", () => {
    const list = buildExtractCandidates(
      [
        { name: "他", type: "人物" },
        { name: "一个在雾里看不清面孔的守山人", type: "人物" },
        { name: "李玄", type: "人物" },
      ],
      { existing: [] },
    );
    expect(list.map((item) => item.name)).toEqual(["李玄"]);
  });

  it("limit 生效并夹在上限内（防兜底解析产出几十条）", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      name: `名字${index}`,
      type: "人物",
    }));
    expect(buildExtractCandidates(many, { existing: [], limit: 3 })).toHaveLength(3);
    expect(buildExtractCandidates(many, { existing: [] })).toHaveLength(30);
  });

  it("空输入返回空数组（不抛错）", () => {
    expect(buildExtractCandidates([], { existing: [] })).toEqual([]);
  });
});
