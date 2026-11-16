import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import TermText from "./index";

/**
 * 名词渲染器测试。
 *
 * 这层专门盯两件容易在重构里丢掉的事：**名词必须是可聚焦的按钮**（键盘能弹层），
 * 以及**关键词高亮与名词识别必须共存** —— 搜索「Proxy」时如果被名词吃掉就不再有
 * `<mark>`，用户会以为没搜到。
 */
describe("TermText", () => {
  afterEach(() => {
    cleanup();
  });

  it("命中的名词渲染成按钮，未命中的文字原样保留", () => {
    const { container } = render(<TermText text="用 Proxy 拦截读写" />);

    expect(container.textContent).toBe("用 Proxy 拦截读写");
    const chip = container.querySelector(".interview-term");
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.getAttribute("aria-label")).toBe("名词解释：Proxy");
    expect(chip?.getAttribute("aria-expanded")).toBe("false");
  });

  it("点击名词弹出定义、领域与细节", () => {
    const { container } = render(<TermText text="能拦 13 种操作的 Proxy" />);
    const chip = container.querySelector<HTMLElement>(".interview-term");
    expect(chip).not.toBeNull();

    fireEvent.click(chip as HTMLElement);

    const panel = document.querySelector(".interview-term__panel");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("JavaScript");
    // 细节至少一条，且相关词条带「另见」
    expect(panel?.querySelectorAll(".interview-term__panel-points li").length).toBeGreaterThan(0);
    expect(panel?.textContent).toContain("另见");
    expect(chip?.getAttribute("aria-expanded")).toBe("true");
  });

  it("关键词命中落在名词内部时仍然高亮", () => {
    const { container } = render(<TermText text="聊聊 Proxy 的用法" keyword="Proxy" />);

    const marked = container.querySelector(".interview-term mark");
    expect(marked?.textContent).toBe("Proxy");
  });

  it("没有命中名词时退化为普通文本 + 关键词高亮", () => {
    const { container } = render(<TermText text="一句普通的话" keyword="普通" />);

    expect(container.querySelector(".interview-term")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("普通");
  });

  it("长名词整体命中，不会被拆成两个短词", () => {
    const { container } = render(<TermText text="Vue 3 用最长递增子序列减少移动" />);

    const chips = Array.from(container.querySelectorAll(".interview-term")).map(
      (node) => node.textContent,
    );
    expect(chips).toContain("最长递增子序列");
    expect(chips).not.toContain("最长");
  });
});
