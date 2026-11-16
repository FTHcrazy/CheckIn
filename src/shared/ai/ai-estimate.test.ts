import { describe, expect, it } from "vitest";
import { estimateText, estimateTokens } from "./ai-estimate";

describe("estimateTokens", () => {
  it("空串 / undefined 返回 0，不加结构开销", () => {
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
  });

  it("中文字符按 1.5 折算，英文词按 1.3 折算", () => {
    // 11 个中文字符 × 1.5 = 16.5 → 17（四舍五入），无英文，加结构开销 0
    const chinese = estimateTokens("林晚照冷冷地说了十个字", { structureOverhead: 0 });
    expect(chinese).toBe(Math.round(11 * 1.5));

    // 4 个英文词 × 1.3 = 5.2 → 5（四舍五入），无中文，加开销 0
    const english = estimateTokens("hello world from test", { structureOverhead: 0 });
    expect(english).toBe(Math.round(4 * 1.3));
  });

  it("结构开销只对有内容的文本加一次", () => {
    const withOverhead = estimateTokens("你好");
    const withoutOverhead = estimateTokens("你好", { structureOverhead: 0 });
    expect(withOverhead - withoutOverhead).toBe(32);
  });

  it("系数可覆盖（用于不同服务商 / 语言的估算口径）", () => {
    const tokens = estimateTokens("中文 english", {
      chineseFactor: 2,
      englishFactor: 2,
      structureOverhead: 0,
    });
    // 2 个中文 × 2 = 4，1 个英文词 × 2 = 2 → 6
    expect(tokens).toBe(6);
  });
});

describe("estimateText", () => {
  it("返回字数与 token 双口径", () => {
    const result = estimateText("你好 world");
    expect(result.chars).toBe(8); // 你好(2) + 空格(1) + world(5)
    expect(result.tokens).toBeGreaterThan(0);
  });
});
