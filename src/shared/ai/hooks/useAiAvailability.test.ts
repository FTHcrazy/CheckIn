import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "../ai-types";
import { deriveAvailability, isAiHidden, useAiAvailability } from "./useAiAvailability";

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

/**
 * REQ-063：`hidden` 的口径（「整块不渲染」vs「禁用并说明」）。
 *
 * 这条是用户诉求的直接落地：「开关关闭后，所有 AI 功能都不展示（按钮、提示等
 * 都不展示）」。而「开着但没配全」绝不能一起 hide —— 那种情况下用户需要的
 * 恰恰是看见入口 + 一句「去补哪个字段」，两边混起来就会出现「AI 页明明开着，
 * 入口却全没了，用户不知道还能不能配」的僵局。
 */
describe("isAiHidden（REQ-063 收束口径）", () => {
  it("总开关关闭 → 整块不渲染", () => {
    expect(isAiHidden("disabled")).toBe(true);
  });

  it("主进程通道不在（lite / 未登录 / 配置还没读回）→ 整块不渲染", () => {
    expect(isAiHidden("unavailable")).toBe(true);
  });

  it("开关开着只是没配全 → 不隐藏（保留「禁用 + 说明」的引导语义）", () => {
    for (const reason of ["no_model", "missing_key", "no_endpoint"] as const) {
      expect(isAiHidden(reason), `${reason} 不该整块隐藏`).toBe(false);
    }
  });

  it("可用时当然不隐藏", () => {
    expect(isAiHidden(null)).toBe(false);
  });

  it("与 deriveAvailability 串联后覆盖四种实际场景", () => {
    // 关掉开关 → hide
    expect(isAiHidden(deriveAvailability(config({ enabled: false })).reason)).toBe(true);
    // 没配全 → 不 hide，但仍 available=false
    const incomplete = deriveAvailability(config({ model: "" }));
    expect(incomplete.available).toBe(false);
    expect(isAiHidden(incomplete.reason)).toBe(false);
    // 配置未读回 → hide（宁可晚一拍出现，也不要「先显示再消失」）
    expect(isAiHidden(deriveAvailability(null).reason)).toBe(true);
    // 可用 → 不 hide
    expect(isAiHidden(deriveAvailability(config()).reason)).toBe(false);
  });
});

// ── hook 层：hidden 字段 + 跨窗口即时生效 ─────────────────────────────

const getAiConfigMock = vi.fn<() => Promise<AiConfig>>();

vi.mock("../ai-client", () => ({
  getAiConfig: () => getAiConfigMock(),
}));

describe("useAiAvailability（hidden 字段 + ai-config-changed 订阅）", () => {
  const onMock = vi.fn();
  const offMock = vi.fn();

  beforeEach(() => {
    getAiConfigMock.mockReset();
    onMock.mockReset();
    offMock.mockReset();
    // 只补本 hook 用到的两个方法：windowAPI.on / off
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      windowAPI: { on: onMock, off: offMock },
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("开关关闭 → available=false 且 hidden=true", async () => {
    getAiConfigMock.mockResolvedValue(config({ enabled: false }));
    const { result } = renderHook(() => useAiAvailability());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.available).toBe(false);
    expect(result.current.hidden).toBe(true);
    expect(result.current.reason).toBe("disabled");
  });

  it("开着但缺模型 / 缺 Key / 缺地址 → hidden=false（仍不可用，保留引导）", async () => {
    for (const overrides of [{ model: "" }, { hasApiKey: false }, { endpoint: "" }] as const) {
      getAiConfigMock.mockResolvedValue(config(overrides));
      const { result } = renderHook(() => useAiAvailability());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.available, JSON.stringify(overrides)).toBe(false);
      expect(result.current.hidden, JSON.stringify(overrides)).toBe(false);
      cleanup();
    }
  });

  it("配置读不到（通道缺失）→ hidden=true", async () => {
    getAiConfigMock.mockRejectedValue(new Error("no channel"));
    const { result } = renderHook(() => useAiAvailability());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hidden).toBe(true);
  });

  it("配置齐全 → hidden=false", async () => {
    getAiConfigMock.mockResolvedValue(config());
    const { result } = renderHook(() => useAiAvailability());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.available).toBe(true);
    expect(result.current.hidden).toBe(false);
  });

  it("订阅 ai-config-changed：别的窗口关掉开关后立刻重读（不重启就生效）", async () => {
    getAiConfigMock.mockResolvedValue(config());
    const { result } = renderHook(() => useAiAvailability());
    await waitFor(() => expect(result.current.hidden).toBe(false));

    // 订阅必须真的挂在 windowAPI 上，且事件名是主进程广播的那一个
    expect(onMock).toHaveBeenCalledTimes(1);
    const [eventName, handler] = onMock.mock.calls[0] as [string, () => void];
    expect(eventName).toBe("ai-config-changed");

    // 广播到达 → 重读配置 → hidden 跟着翻
    getAiConfigMock.mockResolvedValue(config({ enabled: false }));
    handler();
    await waitFor(() => expect(result.current.hidden).toBe(true));

    // 卸载要退订，否则隐藏的窗口关掉后仍会被广播打到
    cleanup();
    expect(offMock).toHaveBeenCalledWith("ai-config-changed", handler);
  });
});
