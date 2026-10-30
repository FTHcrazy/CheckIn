import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PackModuleShell from "./index";
import { PackModuleSummaryContext } from "../module-summary-context";

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

/**
 * 钉选按钮（UI-04）。
 *
 * 钉选走外壳 context 投下来的 `onTogglePin`：不传（核心三块 / 无 Provider）
 * 时按钮整个不渲染 —— 核心模块永远展开，给它一颗「钉选」只会让作者困惑
 * 「钉了有什么用」。
 */
describe("PackModuleShell —— 钉选按钮（UI-04）", () => {
  afterEach(cleanup);

  function renderWithChrome(chrome: {
    pinned: boolean;
    onTogglePin?: () => void;
  }) {
    render(
      <PackModuleSummaryContext.Provider
        value={{ summary: "", pinned: chrome.pinned, onTogglePin: chrome.onTogglePin }}
      >
        <PackModuleShell title="物品栏" collapsed onToggle={vi.fn()}>
          <p>内容</p>
        </PackModuleShell>
      </PackModuleSummaryContext.Provider>,
    );
  }

  it("无 Provider / 无 onTogglePin 时不渲染钉选按钮", () => {
    renderShell();
    expect(screen.queryByLabelText("钉选常驻")).toBeNull();
  });

  it("传了 onTogglePin 才出按钮，点击触发回调", () => {
    const onTogglePin = vi.fn();
    renderWithChrome({ pinned: false, onTogglePin });
    const pin = screen.getByLabelText("钉选常驻");
    fireEvent.click(pin);
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it("钉选态：aria-pressed=true、模块壳带 is-pinned、按钮文案变「取消钉选」", () => {
    renderWithChrome({ pinned: true, onTogglePin: vi.fn() });
    const pin = screen.getByLabelText("取消钉选");
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".cpk-mod.is-pinned")).not.toBeNull();
  });
});
