/**
 * 连线草稿校验（R27 / S3）
 *
 * 四类阻断 + 二次确认五项是**产品契约**，所以这里逐条钉文案与判定：
 * 自身 / 跨作品 / 空名 是硬阻断（不能提交），同关系名已存在是软提示（可合并提交）。
 */
import { describe, expect, it } from "vitest";
import {
  buildDraftLink,
  checkDraft,
  endpointsValid,
  existingRelationsBetween,
  normalizeRelation,
  type DraftEndpoint,
} from "./relation-draft";

const source: DraftEndpoint = {
  id: "e1",
  name: "林晚",
  type: "character",
  typeLabel: "角色",
  workId: "w1",
};

const target: DraftEndpoint = {
  id: "e2",
  name: "青云镇",
  type: "location",
  typeLabel: "地点",
  workId: "w1",
};

describe("normalizeRelation：只做空白收口", () => {
  it("去首尾空白、把连续空白（含全角）压成一个", () => {
    expect(normalizeRelation("  同门 ")).toBe("同门");
    expect(normalizeRelation("同　门")).toBe("同 门");
    expect(normalizeRelation("  ")).toBe("");
  });

  it("不归一化标点 / 括号：不同写法就是不同关系", () => {
    expect(normalizeRelation("师兄")).not.toBe(normalizeRelation("师兄（大师兄）"));
  });
});

describe("checkDraft：四类阻断", () => {
  it("自身连线是硬阻断", () => {
    const check = checkDraft({ source, target: { ...source }, relation: "同门" });
    expect(check.canSubmit).toBe(false);
    expect(check.issues.map((issue) => issue.code)).toContain("self");
    expect(check.issues.find((issue) => issue.code === "self")?.message).toBe(
      "不能与自己建立关系",
    );
  });

  it("跨作品是硬阻断（数据不出本书）", () => {
    const check = checkDraft({
      source,
      target: { ...target, workId: "w2" },
      relation: "同门",
    });
    expect(check.canSubmit).toBe(false);
    expect(check.issues.some((issue) => issue.code === "cross-work")).toBe(true);
  });

  it("空名是硬阻断（空白名同样算空）", () => {
    expect(checkDraft({ source, target, relation: "" }).canSubmit).toBe(false);
    expect(checkDraft({ source, target, relation: "   " }).canSubmit).toBe(false);
    expect(checkDraft({ source, target, relation: "   " }).issues[0].code).toBe("empty");
  });

  it("同关系名已存在是软提示：红字可见，但仍允许提交（合并语义）", () => {
    const check = checkDraft(
      { source, target, relation: "同门" },
      { existingRelations: ["同门"] },
    );
    expect(check.canSubmit).toBe(true);
    expect(check.merge).toBe(true);
    expect(check.issues.some((issue) => issue.code === "duplicate" && !issue.fatal)).toBe(true);
    expect(check.verdict).toBe("已存在同关系（合并为「同门 +1」）");
  });

  it("关系名比较忽略大小写，但不忽略中文标点", () => {
    const check = checkDraft(
      { source, target, relation: "Rival" },
      { existingRelations: ["rival"] },
    );
    expect(check.merge).toBe(true);
    expect(existingRelationsBetween(["rival"], "Rival")).toEqual(["rival"]);
    expect(existingRelationsBetween(["师兄（大师兄）"], "师兄")).toEqual([]);
  });
});

describe("checkDraft：二次确认第 4 项", () => {
  it("没有同关系名时判定为「将新建」", () => {
    const check = checkDraft({ source, target, relation: "师徒" }, { existingRelations: ["同门"] });
    expect(check.merge).toBe(false);
    expect(check.verdict).toBe("将新建");
    expect(check.canSubmit).toBe(true);
  });

  it("已有 2 条同关系名时标签按「+2」推算", () => {
    const check = checkDraft(
      { source, target, relation: "同门" },
      { existingRelations: ["同门", "同门"] },
    );
    expect(check.mergeLabel).toBe("同门 +2");
  });
});

describe("buildDraftLink：写入载荷", () => {
  it("关系名先清洗，方向按 from → to 保留", () => {
    const link = buildDraftLink(source, target, "  出身  ");
    expect(link.fromId).toBe("e1");
    expect(link.toType).toBe("location");
    expect(link.toId).toBe("e2");
    expect(link.relation).toBe("出身");
    expect(link.id).toMatch(/^l-/);
  });

  it("每次生成不同的 id（主进程按 id 幂等，重复提交才需要同 id）", () => {
    const a = buildDraftLink(source, target, "同门");
    const b = buildDraftLink(source, target, "同门");
    expect(a.id).not.toBe(b.id);
  });
});

describe("endpointsValid：端点已删的残留拖拽", () => {
  it("两端都有 id 且同书才算有效", () => {
    expect(endpointsValid(source, target)).toBe(true);
    expect(endpointsValid(source, null)).toBe(false);
    expect(endpointsValid(source, { ...target, workId: "w2" })).toBe(false);
  });
});
