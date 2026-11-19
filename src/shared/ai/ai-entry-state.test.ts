import { describe, expect, it } from "vitest";
import {
  AI_ENTRY_CONSENT_HINT,
  aiEntryStateClass,
  deriveAiEntryState,
} from "./ai-entry-state";

describe("AI 入口三态（O-06）", () => {
  it("配置不齐 → 不可用（先补配置，不要先弹授权）", () => {
    expect(
      deriveAiEntryState({ available: false, l3Enabled: false, requiresConsent: true }),
    ).toBe("unavailable");
    // 即使 L3 开着，配置不齐仍是不可用
    expect(
      deriveAiEntryState({ available: false, l3Enabled: true, requiresConsent: false }),
    ).toBe("unavailable");
  });

  it("可用 + 需要整章 + L3 没开 → 待授权", () => {
    expect(
      deriveAiEntryState({ available: true, l3Enabled: false, requiresConsent: true }),
    ).toBe("needs-consent");
  });

  it("可用 + 已授权 → 可用", () => {
    expect(
      deriveAiEntryState({ available: true, l3Enabled: true, requiresConsent: true }),
    ).toBe("available");
  });

  it("不需要整章的入口（起名 / 润色选段）永远是可用，不会显示待授权", () => {
    expect(
      deriveAiEntryState({ available: true, l3Enabled: false, requiresConsent: false }),
    ).toBe("available");
  });

  it("类名映射：待授权与不可用是两个类，可用不加类", () => {
    expect(aiEntryStateClass("needs-consent")).toBe("is-ai-needs-consent");
    expect(aiEntryStateClass("unavailable")).toBe("is-ai-off");
    expect(aiEntryStateClass("available")).toBe("");
  });

  it("待授权文案说清「点了会发生什么」（不能只说需要授权）", () => {
    expect(AI_ENTRY_CONSENT_HINT).toContain("授权");
    expect(AI_ENTRY_CONSENT_HINT).toContain("范围");
  });
});
