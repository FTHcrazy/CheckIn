import { describe, expect, it } from "vitest";
import type { AiConfig } from "../ai-types";
import { deriveAvailability } from "./useAiAvailability";

/** 构造一份「可用」的基线配置，测试时按需覆盖字段 */
function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    enabled: true,
    provider: "openai",
    endpoint: "https://api.example.com/v1",
    model: "deepseek-chat",
    hasApiKey: true,
    contextLen: 32000,
    l3Enabled: false,
    ...overrides,
  };
}

describe("deriveAvailability（AI 可用性门控，M8）", () => {
  it("配置齐全且启用 → 可用，无原因", () => {
    expect(deriveAvailability(config())).toEqual({ available: true, reason: null });
  });

  it("未启用 → 不可用，原因是 disabled", () => {
    expect(deriveAvailability(config({ enabled: false }))).toEqual({
      available: false,
      reason: "disabled",
    });
  });

  it("缺模型名 → 不可用，原因是 no_model", () => {
    expect(deriveAvailability(config({ model: "" }))).toEqual({
      available: false,
      reason: "no_model",
    });
  });

  it("缺接口地址 → 不可用，原因是 no_endpoint", () => {
    expect(deriveAvailability(config({ endpoint: "  " }))).toEqual({
      available: false,
      reason: "no_endpoint",
    });
  });

  it("OpenAI 模式缺 Key → 不可用，原因是 missing_key", () => {
    expect(deriveAvailability(config({ hasApiKey: false }))).toEqual({
      available: false,
      reason: "missing_key",
    });
  });

  it("Ollama 本地模型免 Key：缺 Key 不影响可用", () => {
    expect(deriveAvailability(config({ provider: "ollama", hasApiKey: false }))).toEqual({
      available: true,
      reason: null,
    });
  });

  it("配置为 null（通道未注册 / 未登录）→ 不可用，原因是 unavailable", () => {
    expect(deriveAvailability(null)).toEqual({ available: false, reason: "unavailable" });
  });
});
