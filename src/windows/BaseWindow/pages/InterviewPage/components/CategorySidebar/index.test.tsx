import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CategorySidebar from "./index";

/**
 * 左侧分类栏的名称提示。
 *
 * 「HTTP / HTTPS 与安全」这类长名在 200px 的定宽侧栏里必然被省略号截掉，
 * 截掉之后用户没法确认自己点的是哪一类。提示只在**真被截断**时给：
 * 每一行都弹一个和眼前文字一样的提示，等于让鼠标每路过一次就被打断一次。
 */
function renderSidebar(): void {
  render(
    <CategorySidebar
      track="foundation"
      categoryId="all"
      counts={{ all: 209 }}
      onSelect={() => undefined}
    />,
  );
}

/** jsdom 不做布局：手动摆出「内容比盒子宽」的读数 */
function fakeOverflow(el: HTMLElement): void {
  Object.defineProperty(el, "scrollWidth", { value: 180, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 96, configurable: true });
}

describe("CategorySidebar 名称提示", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("名称被截断时 hover 弹出完整名称", async () => {
    renderSidebar();
    const label = screen.getByText("HTTP / HTTPS 与安全");
    fakeOverflow(label);

    // React 的 onMouseEnter 由 mouseover 合成（mouseenter 不冒泡，触发不到）
    fireEvent.mouseOver(label);

    const tip = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[role="tooltip"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(tip.textContent).toContain("HTTP / HTTPS 与安全");
  });

  it("没被截断的分类不弹提示", () => {
    renderSidebar();
    fireEvent.mouseOver(screen.getByText("计算机网络"));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
