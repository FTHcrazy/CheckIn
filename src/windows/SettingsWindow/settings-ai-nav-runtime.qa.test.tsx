/**
 * QA 独立复核（REQ-063）：设置窗口导航的**运行期行为**（不是清单的函数返回值）。
 *
 * `settings-ai-nav-guard.test.ts` 证明的是「`buildPages(true)` 里没有 ai-log /
 * ai-usage」，也就是**函数**对了。还剩几个只可能在渲染时暴露的问题，这里逐个钉：
 *
 * 1. 用户正停在「用量与效果」时把开关关掉 → 必须回退到「AI 配置」，不能留空白内容区；
 * 2. 「AI 配置」页**不许被卸载**（它有草稿态：改了一半的地址 / 模型 / Key），
 *    收掉 ai-log / ai-usage 时只能动那两页；
 * 3. 收掉的两页是「不在渲染树」而不是「渲染了再藏起来」（导航项一起消失）。
 *
 * 做法：把各分区换成带计数器的空组件（真分区要拖 antd Form + IPC），
 * 只留真实的 App / settings-pages / SettingsNav —— 要验的正是这三者的联动。
 */
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsWindowApp from "./App";

/** 每个分区被挂载 / 卸载的次数（用来证明「AI 配置页不卸载」） */
const mountLog = new Map<string, { mount: number; unmount: number }>();

/** `useAiAvailability` 的受控替身：只暴露 App 用到的 `hidden` */
let aiHidden = false;

vi.mock("@/shared/ai/hooks/useAiAvailability", () => ({
  useAiAvailability: () => ({
    hidden: aiHidden,
    available: !aiHidden,
    loading: false,
    reason: aiHidden ? "disabled" : null,
    reasonText: "",
    config: null,
    refresh: () => {},
  }),
}));

/** 假分区工厂：渲染一个可断言的标记节点，并记挂载 / 卸载次数 */
function sectionOf(name: string) {
  const Section = () => {
    useEffect(() => {
      const entry = mountLog.get(name) ?? { mount: 0, unmount: 0 };
      entry.mount += 1;
      mountLog.set(name, entry);
      return () => {
        const current = mountLog.get(name) ?? { mount: 0, unmount: 0 };
        current.unmount += 1;
        mountLog.set(name, current);
      };
    }, []);
    return <div data-qa-section={name} />;
  };
  Section.displayName = `Section(${name})`;
  return Section;
}

// 分区模块整体替换（8 个），避免拖入 antd Form / IPC
vi.mock("./components/AppearanceSection", () => ({ default: sectionOf("AppearanceSection") }));
vi.mock("./components/ProfileSection", () => ({ default: sectionOf("ProfileSection") }));
vi.mock("./components/AccountSection", () => ({ default: sectionOf("AccountSection") }));
vi.mock("./components/ShortcutSection", () => ({ default: sectionOf("ShortcutSection") }));
vi.mock("./components/DiagnosticSection", () => ({ default: sectionOf("DiagnosticSection") }));
vi.mock("./components/AISection", () => ({ default: sectionOf("AISection") }));
vi.mock("./components/AILogSection", () => ({ default: sectionOf("AILogSection") }));
vi.mock("./components/UsagePanel", () => ({ default: sectionOf("UsagePanel") }));

/** 导航里当前出现的文案（用真实 SettingsNav 渲染出来的那份） */
function navLabels(): string[] {
  return Array.from(document.querySelectorAll(".settings-nav__label")).map(
    (node) => node.textContent ?? "",
  );
}

beforeEach(() => {
  mountLog.clear();
  aiHidden = false;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("设置窗口：AI 开关关闭时的导航与渲染（REQ-063 运行期）", () => {
  it("开启 AI：三页导航齐全", () => {
    render(<SettingsWindowApp />);
    expect(navLabels()).toEqual(expect.arrayContaining(["AI 配置", "AI 记录", "用量与效果"]));
  });

  it("停在「用量与效果」时关掉开关 → 回退到「AI 配置」，不是空白", () => {
    const { rerender } = render(<SettingsWindowApp />);

    fireEvent.click(screen.getByRole("button", { name: /用量与效果/ }));
    expect(document.querySelector(".settings-page__title")?.textContent).toBe("用量与效果");

    // 另一个窗口把总开关关掉 → hidden 翻转 → 重渲染
    aiHidden = true;
    rerender(<SettingsWindowApp />);

    expect(document.querySelector(".settings-page__title")?.textContent).toBe("AI 配置");
    expect(document.querySelector('[data-qa-section="AISection"]')).not.toBeNull();
    expect(navLabels()).not.toContain("AI 记录");
    expect(navLabels()).not.toContain("用量与效果");
    expect(navLabels()).toContain("AI 配置");
  });

  it("关闭态下「AI 配置」页仍渲染（否则用户关掉后再也开不回来）", () => {
    aiHidden = true;
    render(<SettingsWindowApp />);
    expect(navLabels()).toContain("AI 配置");
    expect(document.querySelector('[data-qa-section="AISection"]')).not.toBeNull();
    expect(document.querySelector(".settings-page__title")?.textContent).not.toBe("");
  });

  it("收掉 ai-log / ai-usage 时，AISection 不被卸载（有草稿态，卸载会静默丢填写内容）", () => {
    const { rerender } = render(<SettingsWindowApp />);
    expect(mountLog.get("AISection")?.mount).toBe(1);

    aiHidden = true;
    rerender(<SettingsWindowApp />);

    // 挂载次数仍是 1：同一个实例被保留，而不是「卸载再挂一次」
    expect(mountLog.get("AISection")?.mount, "AISection 被重新挂载了").toBe(1);
    expect(mountLog.get("AISection")?.unmount ?? 0, "AISection 被卸载了").toBe(0);
    expect(document.querySelector('[data-qa-section="AISection"]')).not.toBeNull();

    // 对照：只读视图随开关消失（它们没有可丢的草稿）
    expect(document.querySelector('[data-qa-section="AILogSection"]')).toBeNull();
    expect(document.querySelector('[data-qa-section="UsagePanel"]')).toBeNull();
  });

  it("两页是「不在渲染树」而不是被隐藏：DOM 里连容器都没有", () => {
    const { rerender } = render(<SettingsWindowApp />);
    expect(
      document.querySelector('[data-qa-section="AILogSection"]'),
      "开启态下 AI 记录页应该渲染",
    ).not.toBeNull();

    aiHidden = true;
    rerender(<SettingsWindowApp />);

    // 反向：不许用 is-hidden 蒙过去（那说明节点还在，只是被藏了）
    const hiddenAiPages = Array.from(
      document.querySelectorAll<HTMLElement>(".settings-page.is-hidden"),
    ).filter(
      (page) =>
        page.querySelector('[data-qa-section="AILogSection"]') ??
        page.querySelector('[data-qa-section="UsagePanel"]'),
    );
    expect(hiddenAiPages, "AI 记录 / 用量被渲染后藏起来了（应从清单里消失）").toHaveLength(0);
  });
});
