import { describe, expect, it } from "vitest";
import type { GlossaryTerm } from "../data/interview-glossary";
import { findContainingTerm, hasAlias } from "./glossary-alias";

/**
 * 「记为别名」的目标判定。
 *
 * 这条判据只有一件事要保守：**只在划中的词明显是某个词条键的一部分时**才出建议。
 * 反过来（词条键 ⊂ 划中的词）不做 —— 那是用户多划了半句，替他挑一个词条属于猜。
 */
function makeTerm(overrides: Partial<GlossaryTerm> & { term: string; id: string }): GlossaryTerm {
  return {
    domain: "engineering",
    short: "示例定义。",
    detail: ["示例细节"],
    ...overrides,
  } as GlossaryTerm;
}

const loader = makeTerm({ id: "u-g-loader-x1", term: "Webpack Loader" });
const fiber = makeTerm({ id: "g-fiber", term: "React Fiber", en: "Fiber" });

describe("findContainingTerm", () => {
  it("划中的词是词条键的子串：命中（模型换叫法的场景）", () => {
    expect(findContainingTerm([loader], "loader")?.id).toBe("u-g-loader-x1");
    expect(findContainingTerm([loader], "  Loader  ")?.id).toBe("u-g-loader-x1");
  });

  it("完全相等不算（那种情况浮层已经显示「已是词条」）", () => {
    expect(findContainingTerm([loader], "webpack loader")).toBeNull();
  });

  it("命中多个时取最短的键所属词条（最贴近用户想说的东西）", () => {
    const long = makeTerm({ id: "u-g-long-x1", term: "React 并发渲染模式" });
    const short = makeTerm({ id: "u-g-short-x1", term: "React 渲染" });
    // 两个键都包含「渲染」，取更短的那个（"react 渲染" vs "react 并发渲染模式"）
    expect(findContainingTerm([long, short], "渲染")?.id).toBe("u-g-short-x1");
    expect(findContainingTerm([short, long], "渲染")?.id).toBe("u-g-short-x1");
  });

  it("单字与空串不猜；完全不相关的词不命中", () => {
    expect(findContainingTerm([loader], "l")).toBeNull();
    expect(findContainingTerm([loader], "   ")).toBeNull();
    expect(findContainingTerm([loader], "闭包")).toBeNull();
    expect(findContainingTerm([], "loader")).toBeNull();
  });

  it("别名与英文名同样参与判定", () => {
    const term = makeTerm({ id: "u-g-x", term: "事件循环", aliases: ["Event Loop"] });
    expect(findContainingTerm([term], "event")?.id).toBe("u-g-x");
    expect(findContainingTerm([fiber], "fiber")?.id).toBe("g-fiber");
  });
});

describe("hasAlias", () => {
  it("归一后比较 term / en / aliases", () => {
    const term = makeTerm({ id: "u-g-x", term: "事件循环", en: "Event Loop", aliases: ["消息循环"] });
    expect(hasAlias(term, " event loop ")).toBe(true);
    expect(hasAlias(term, "消息循环")).toBe(true);
    expect(hasAlias(term, "任务队列")).toBe(false);
    expect(hasAlias(term, "")).toBe(false);
  });
});
