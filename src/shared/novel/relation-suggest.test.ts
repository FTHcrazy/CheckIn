import { describe, expect, it } from "vitest";
import {
  MAX_RELATION_CANDIDATES,
  RELATION_NAME_MAX,
  buildRelationCandidates,
  countPicked,
  normalizeConfidence,
  normalizeRelationName,
  relationCandidateKey,
  relationPairKey,
} from "./relation-suggest";
import type { RelationEntityInput, RelationLinkInput } from "./relation-suggest";

/**
 * 关系候选构造的契约（R-AI-15）
 *
 * 钉的是「什么该被采纳、什么必须丢」——这一层错了不会崩，只会把假关系写进
 * 用户的画布（不可逆的资产污染），所以每条口径都要有断言。
 */

function entity(
  id: string,
  name: string,
  aliases: string[] = [],
): RelationEntityInput {
  return { id, name, type: "character", aliases };
}

const ENTITIES: RelationEntityInput[] = [
  entity("e1", "李玄", ["玄哥"]),
  entity("e2", "苏棠", ["棠儿"]),
  entity("e3", "青冥宗", []),
];

const LINKS: RelationLinkInput[] = [
  { fromId: "e1", toId: "e2", relation: "师徒" },
];

describe("名字与关系名归一", () => {
  it("关系名去包裹符号与多余空白，带句读的整句判为不合法", () => {
    expect(normalizeRelationName("「师徒」")).toBe("师徒");
    expect(normalizeRelationName("  同  门 ")).toBe("同 门");
    expect(normalizeRelationName("他们是师徒关系。")).toBe("");
    expect(normalizeRelationName("   ")).toBe("");
  });

  it("关系名超长按上限截断（库里的关系名要能画在边上）", () => {
    const long = "同".repeat(RELATION_NAME_MAX + 10);
    expect(normalizeRelationName(long)).toHaveLength(RELATION_NAME_MAX);
  });

  it("置信度接受 high / 中 / 0.8 / 80% 各种写法，认不出时按中档", () => {
    expect(normalizeConfidence("high")).toBe("high");
    expect(normalizeConfidence("中")).toBe("medium");
    expect(normalizeConfidence("likely")).toBe("medium");
    expect(normalizeConfidence(0.9)).toBe("high");
    expect(normalizeConfidence("0.5")).toBe("medium");
    expect(normalizeConfidence("80%")).toBe("high");
    expect(normalizeConfidence("10%")).toBe("low");
    expect(normalizeConfidence(undefined)).toBe("medium");
  });
});

describe("端点对与候选键", () => {
  it("端点对与顺序无关（边是无向的），候选键再带上关系名", () => {
    expect(relationPairKey("a", "b")).toBe(relationPairKey("b", "a"));
    expect(relationCandidateKey("a", "b", "师徒")).toBe(relationCandidateKey("b", "a", "师徒"));
    // 同一对可以既是师徒又是父子 —— 关系名不同的键不能相等
    expect(relationCandidateKey("a", "b", "师徒")).not.toBe(
      relationCandidateKey("a", "b", "父子"),
    );
  });
});

describe("buildRelationCandidates", () => {
  it("正常条目变成候选，名字解析到要素 id 与正名", () => {
    const result = buildRelationCandidates(
      [{ from: "玄哥", to: "苏棠", relation: "师徒", confidence: "高", evidence: "苏棠拜李玄为师" }],
      { entities: ENTITIES, links: [] },
    );
    expect(result.candidates).toHaveLength(1);
    const [item] = result.candidates;
    // 别名解析回正名：画布上写「玄哥」会与节点标签对不上
    expect(item.fromId).toBe("e1");
    expect(item.fromName).toBe("李玄");
    expect(item.toId).toBe("e2");
    expect(item.confidence).toBe("high");
    expect(item.selected).toBe(true);
  });

  it("端点解析不到就丢弃并计数（模型会编名字，不能凭空建边）", () => {
    const result = buildRelationCandidates(
      [{ from: "李玄", to: "王掌柜", relation: "熟人" }],
      { entities: ENTITIES, links: [] },
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.dropped.unknown).toBe(1);
  });

  it("自己连自己丢弃（图上画不出来）", () => {
    const result = buildRelationCandidates(
      [{ from: "李玄", to: "李玄", relation: "自我" }],
      { entities: ENTITIES, links: [] },
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.dropped.selfLoop).toBe(1);
  });

  it("已存在的关系不列（同一对 + 同一关系名，正反向都算）", () => {
    const forward = buildRelationCandidates(
      [{ from: "李玄", to: "苏棠", relation: "师徒" }],
      { entities: ENTITIES, links: LINKS },
    );
    expect(forward.candidates).toHaveLength(0);
    expect(forward.dropped.duplicate).toBe(1);

    const backward = buildRelationCandidates(
      [{ from: "苏棠", to: "李玄", relation: "师徒" }],
      { entities: ENTITIES, links: LINKS },
    );
    expect(backward.candidates).toHaveLength(0);
  });

  it("同一对要素的另一种关系仍然可以建（平行关系是合法的）", () => {
    const result = buildRelationCandidates(
      [{ from: "苏棠", to: "李玄", relation: "救命恩人", confidence: "中" }],
      { entities: ENTITIES, links: LINKS },
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].relation).toBe("救命恩人");
  });

  it("本次列表内重复只留一条", () => {
    const result = buildRelationCandidates(
      [
        { from: "李玄", to: "青冥宗", relation: "出身" },
        { from: "青冥宗", to: "李玄", relation: "出身" },
      ],
      { entities: ENTITIES, links: [] },
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.dropped.duplicate).toBe(1);
  });

  it("低置信默认不勾选，中高置信默认勾选（低置信误判最尴尬）", () => {
    const result = buildRelationCandidates(
      [
        { from: "李玄", to: "青冥宗", relation: "出身", confidence: "low" },
        { from: "李玄", to: "苏棠", relation: "同门", confidence: "medium" },
      ],
      { entities: ENTITIES, links: [] },
    );
    const byRelation = new Map(result.candidates.map((item) => [item.relation, item]));
    expect(byRelation.get("出身")?.selected).toBe(false);
    expect(byRelation.get("同门")?.selected).toBe(true);
    expect(countPicked(result.candidates)).toBe(1);
  });

  it("高置信排在最前（作者从上往下勾）", () => {
    const result = buildRelationCandidates(
      [
        { from: "李玄", to: "青冥宗", relation: "出身", confidence: "low" },
        { from: "李玄", to: "苏棠", relation: "同门", confidence: "high" },
        { from: "苏棠", to: "青冥宗", relation: "师门", confidence: "medium" },
      ],
      { entities: ENTITIES, links: [] },
    );
    expect(result.candidates.map((item) => item.confidence)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  it("关系名不像关系名（整句 / 空）计入 invalid，不当成候选", () => {
    const result = buildRelationCandidates(
      [
        { from: "李玄", to: "苏棠", relation: "李玄收苏棠为徒，从此两人命运相连。" },
        { from: "李玄", to: "苏棠", relation: "" },
        { from: "李玄", to: "苏棠" },
      ],
      { entities: ENTITIES, links: [] },
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.dropped.invalid).toBe(3);
  });

  it("条数按 limit 截断，且不超过硬上限", () => {
    const entries = Array.from({ length: 60 }, (_, index) => ({
      from: "李玄",
      to: "苏棠",
      relation: `关系${index}`,
    }));
    const result = buildRelationCandidates(entries, { entities: ENTITIES, links: [], limit: 5 });
    expect(result.candidates).toHaveLength(5);

    const huge = buildRelationCandidates(entries, { entities: ENTITIES, links: [], limit: 999 });
    expect(huge.candidates).toHaveLength(MAX_RELATION_CANDIDATES);
  });

  it("容忍字段别名（fromName / target / label / quote）", () => {
    const result = buildRelationCandidates(
      [{ fromName: "李玄", target: "苏棠", label: "师徒", quote: "「从今日起，你便是我弟子」" }],
      { entities: ENTITIES, links: [] },
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].evidence).toContain("从今日起");
  });

  it("垃圾条目（null / 字符串）不让整批崩掉", () => {
    const result = buildRelationCandidates(
      [null, "李玄是苏棠的师父", 42, { from: "李玄", to: "苏棠", relation: "师徒" }],
      { entities: ENTITIES, links: [] },
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.dropped.invalid).toBe(3);
  });

  it("名字归一：模型给的书名号 / 引号 / 括号不影响解析", () => {
    const result = buildRelationCandidates(
      [{ from: "《李玄》", to: "「苏棠」", relation: "师徒" }],
      { entities: ENTITIES, links: [] },
    );
    expect(result.candidates).toHaveLength(1);
  });
});
