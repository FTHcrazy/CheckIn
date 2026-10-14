import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PackModuleShell from "./index";

/**
 * 折叠头点击涟漪（1.39.1）。
 *
 * 标题是「占满头部整行的透明 antd Button」：antd 自带 wave 环罩上去是
 * 「挂两秒的色框」（OutlinePanel 1.34.0「点击效果只有一半」的同构问题），
 * 已在 SCSS 里关掉（`.cpk-mod__toggle.ant-btn .ant-wave`，编译产物断言
 * 归 novel-ui-kit.test.ts 管）。这里钉行为：点击 → 折叠回调 + 涟漪出现在
 * 点击位置，动画结束即卸载。
 */
function renderShell(onToggle = vi.fn()) {
  render(
    <PackModuleShell title="人物属性" collapsed={false} onToggle={onToggle}>
      <p>内容</p>
    </PackModuleShell>,
  );
  return onToggle;
}

describe("PackModuleShell —— 折叠头的点击涟漪", () => {
  afterEach(cleanup);

  it("点击标题：触发折叠回调，并在点击位置生成涟漪", () => {
    const onToggle = renderShell();
    const toggle = screen.getByTitle("折叠");
    fireEvent.click(toggle, { clientX: 60, clientY: 12 });

    expect(onToggle).toHaveBeenCalledTimes(1);
    const ripple = document.querySelector(".cpk-mod__ripple") as HTMLElement | null;
    expect(ripple).not.toBeNull();
    // jsdom 的 getBoundingClientRect 恒为 0 → x 即 clientX
    expect(ripple?.style.left).toBe("60px");
  });

  it("动画结束后涟漪卸载，不随点击堆积", () => {
    renderShell();
    const toggle = screen.getByTitle("折叠");
    fireEvent.click(toggle);
    const ripple = document.querySelector(".cpk-mod__ripple");
    expect(ripple).not.toBeNull();

    fireEvent.animationEnd(ripple as HTMLElement);
    expect(document.querySelector(".cpk-mod__ripple")).toBeNull();
  });
});
