/**
 * AI 流式端点一次性令牌（PRD 红线 C）行为单测
 *
 * 钉的是「凭证语义」而不是实现：领一张 → 只能用一次 → 过期作废 → 伪造无效
 * → 表不无界增长。端点的 403 分支靠这些语义成立（见 ai-stream-guard）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeAiStreamToken,
  issueAiStreamToken,
  resetAiStreamTokens,
} from "./ai-stream-token";

const T0 = 1_760_000_000_000;

describe("AI 流式端点一次性令牌", () => {
  beforeEach(() => {
    resetAiStreamTokens();
  });

  it("领到的令牌可以用一次，第二次核销失败（单次有效）", () => {
    const token = issueAiStreamToken(T0);
    expect(token).toHaveLength(64); // 32 字节 → 64 位 hex
    expect(consumeAiStreamToken(token, T0 + 1)).toBe(true);
    expect(consumeAiStreamToken(token, T0 + 1)).toBe(false);
  });

  it("每次领取的令牌互不相同", () => {
    const tokens = new Set(Array.from({ length: 50 }, (_, i) => issueAiStreamToken(T0 + i)));
    expect(tokens.size).toBe(50);
  });

  it("空 / 伪造 / 已核销的令牌一律拒绝", () => {
    expect(consumeAiStreamToken(null, T0)).toBe(false);
    expect(consumeAiStreamToken(undefined, T0)).toBe(false);
    expect(consumeAiStreamToken("", T0)).toBe(false);
    expect(consumeAiStreamToken("f".repeat(64), T0)).toBe(false);
  });

  it("超过有效期的令牌不再放行（可失效）", () => {
    const token = issueAiStreamToken(T0);
    expect(consumeAiStreamToken(token, T0 + 60_001)).toBe(false);
  });

  it("未核销的令牌不会无界增长（超上限淘汰最早的）", () => {
    const first = issueAiStreamToken(T0);
    let last = "";
    for (let i = 0; i < 100; i += 1) last = issueAiStreamToken(T0 + i);
    // 最早的已被淘汰，最近的仍有效
    expect(consumeAiStreamToken(first, T0 + 200)).toBe(false);
    expect(consumeAiStreamToken(last, T0 + 200)).toBe(true);
  });
});
