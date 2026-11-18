import { describe, expect, it } from "vitest";
import {
  buildEditedGlossary,
  glossaryConflicts,
  glossaryKeyList,
  toGlossaryShape,
  validateGlossaryEdit,
} from "./glossary-edit";
import type { GlossaryTerm } from "../data/interview-glossary";

function makeTerm(id: string, term: string, extra: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return {
    id,
    term,
    domain: "browser",
    short: "一句话定义。",
    detail: ["展开细节。"],
    ...extra,
  };
}

/**
 * 词条编辑的纯函数层守卫。
 *
 * 三条退化方式都很安静：
 * ① 「清空」被 `{...term}` 抵消 → 用户删掉英文名，保存后又回来；
 * ② 同键判定不看领域 → 同名不同义的第二条永远建不出来（或反过来，重复词条也能进）；
 * ③ 改 id → 别的词条的 `related` 与匹配负例一起断掉。
 */
describe("glossaryKeyList", () => {
  it("term / en / aliases 全算匹配键，小写归一且去重", () => {
    expect(
      glossaryKeyList({ term: "闭包", en: "Closure", aliases: ["closure", "词法闭包"] }),
    ).toEqual(["闭包", "closure", "词法闭包"]);
  });

  it("空串与首尾空白不算键", () => {
    expect(glossaryKeyList({ term: "  节流 ", en: "  " })).toEqual(["节流"]);
  });
});

describe("toGlossaryShape（落库 payload 的清空语义）", () => {
  it("删掉的英文名 / 别名 / 分类不会因为展开旧对象又回来", () => {
    const term = makeTerm("u-g-throttle", "节流", {
      en: "",
      aliases: [],
      categoryId: undefined,
    });
    const shape = toGlossaryShape(term);
    expect(shape).not.toHaveProperty("en");
    expect(shape).not.toHaveProperty("aliases");
    expect(shape).not.toHaveProperty("categoryId");
  });

  it("空别名 / 空细节行被过滤掉（主进程会按非空字符串校验）", () => {
    const shape = toGlossaryShape(
      makeTerm("u-g-throttle", "节流", { aliases: [" ", "限流"], detail: ["要点", "  "] }),
    );
    expect(shape.aliases).toEqual(["限流"]);
    expect(shape.detail).toEqual(["要点"]);
  });
});

describe("glossaryConflicts（同键只在同领域才算重复）", () => {
  it("同键同领域 → 冲突，并点名对方词条", () => {
    const conflicts = glossaryConflicts(toGlossaryShape(makeTerm("u-g-a", "节流")), [
      makeTerm("u-g-b", "节流"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("节流");
    expect(conflicts[0]).toContain("重复");
  });

  it("同键不同领域 → 允许共存（同名不同义）", () => {
    const browser = makeTerm("u-g-a", "节流", { domain: "browser" });
    const rxjs = makeTerm("u-g-b", "节流", { domain: "javascript" });
    expect(glossaryConflicts(toGlossaryShape(browser), [rxjs])).toEqual([]);
  });

  it("对方领域取不到（草稿词条）→ 一律算冲突，并标明是草稿", () => {
    const draft = { id: "u-g-draft", term: "节流", aliases: [], draft: true };
    const conflicts = glossaryConflicts(toGlossaryShape(makeTerm("u-g-a", "节流")), [draft]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("草稿");
  });

  it("自己不与自己冲突（把词名改回原样不该被挡）", () => {
    const term = makeTerm("u-g-a", "节流");
    expect(glossaryConflicts(toGlossaryShape(term), [term])).toEqual([]);
  });

  it("别名撞上别人的词名也算冲突", () => {
    const mine = makeTerm("u-g-a", "节流", { aliases: ["闭包"] });
    const other = makeTerm("u-g-b", "闭包");
    expect(glossaryConflicts(toGlossaryShape(mine), [other])).toHaveLength(1);
  });
});

describe("buildEditedGlossary", () => {
  it("id 与 related 保持原样（id 被 related 与匹配负例引用）", () => {
    const base = makeTerm("closure", "闭包", { related: ["scope"] });
    const next = buildEditedGlossary(base, {
      term: "闭包（Closure）",
      domain: "javascript",
      short: "新定义。",
      detail: ["新细节"],
    });
    expect(next.id).toBe("closure");
    expect(next.related).toEqual(["scope"]);
    expect(next.term).toBe("闭包（Closure）");
  });

  it("清空可选字段时结果里没有那个键", () => {
    const base = makeTerm("u-g-a", "节流", { en: "Throttle", aliases: ["限流"] });
    const next = buildEditedGlossary(base, {
      term: "节流",
      en: "",
      domain: "browser",
      short: "定义。",
      detail: ["细节"],
      aliases: [],
    });
    expect(next).not.toHaveProperty("en");
    expect(next).not.toHaveProperty("aliases");
  });
});

describe("validateGlossaryEdit", () => {
  it("结构不合法时只报结构错（不再叠冲突提示）", () => {
    const broken = makeTerm("u-g-a", "节流", { detail: [] });
    const errors = validateGlossaryEdit(broken, [makeTerm("u-g-b", "节流")]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((item) => !item.includes("重复"))).toBe(true);
  });

  it("结构合法、键不冲突时返回空数组（可以写）", () => {
    expect(validateGlossaryEdit(makeTerm("u-g-a", "节流"), [])).toEqual([]);
  });
});
