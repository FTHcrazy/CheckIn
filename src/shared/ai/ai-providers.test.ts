import { describe, expect, it } from "vitest";
import { AI_PROVIDER_PRESETS, keyPageOf } from "./ai-providers";

/**
 * 服务商预设与 Key 申请页（R-AI-01 FR-03 / FR-05）。
 *
 * 这一组钉的是「预设与 Key 页同源」：两份数据分开维护时，最容易出现的不是崩溃，
 * 而是「点了获取 Key 没反应」—— 因为 UI 显示了这个入口，主进程却查不到对应页面。
 */
describe("AI 服务商预设", () => {
  it("每条预设的三要素齐全（地址 / 模型 / Key 页都是 https）", () => {
    expect(AI_PROVIDER_PRESETS.length).toBeGreaterThan(0);
    for (const preset of AI_PROVIDER_PRESETS) {
      expect(preset.label.trim(), "预设缺名称").not.toBe("");
      expect(preset.model.trim(), `${preset.label} 缺默认模型`).not.toBe("");
      expect(preset.endpoint).toMatch(/^https:\/\//);
      expect(preset.keyUrl).toMatch(/^https:\/\//);
    }
  });

  it("label 与 host 都不重复（否则反查会落到错误的那一条）", () => {
    const labels = AI_PROVIDER_PRESETS.map((preset) => preset.label);
    expect(new Set(labels).size).toBe(labels.length);
    const hosts = AI_PROVIDER_PRESETS.map((preset) => new URL(preset.endpoint).hostname);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});

describe("keyPageOf：按 host 反查 Key 申请页", () => {
  it("命中预置服务商", () => {
    expect(keyPageOf("https://api.deepseek.com/v1")).toBe(
      "https://platform.deepseek.com/api_keys",
    );
    expect(keyPageOf("https://api.deepseek.com")).toBe(
      "https://platform.deepseek.com/api_keys",
    );
  });

  it("只比 host：改路径、加端口、大小写、尾随斜杠都仍能命中", () => {
    // 用户常把 /v1 删掉或补上，按完整字符串匹配会漏（这是真实发生的输入）
    expect(keyPageOf("https://API.DeepSeek.com/v1/")).toBe(
      "https://platform.deepseek.com/api_keys",
    );
    expect(keyPageOf("https://api.deepseek.com/v1/chat/completions")).toBe(
      "https://platform.deepseek.com/api_keys",
    );
  });

  it("未收录的服务商返回 null（界面据此不显示入口，不给猜的链接）", () => {
    expect(keyPageOf("https://api.example.com/v1")).toBeNull();
    expect(keyPageOf("http://localhost:11434")).toBeNull();
  });

  it("草稿态的残缺输入不抛错", () => {
    expect(keyPageOf("")).toBeNull();
    expect(keyPageOf("   ")).toBeNull();
    expect(keyPageOf("api.deepseek.com")).toBeNull(); // 缺协议头，不算合法 endpoint
  });
});
