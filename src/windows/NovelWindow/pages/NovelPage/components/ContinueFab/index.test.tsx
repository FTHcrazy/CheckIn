import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContinueFab from "./index";

/**
 * AI 续写悬浮按钮（REQ-061）
 *
 * 钉两条：① 它就是唯一入口（点击只负责回调，确认在编排层做）；
 * ② AI 不可用时禁用并说明原因 —— 不出现「点了没反应」。
 */
describe("ContinueFab", () => {
  afterEach(() => {
    // antd Button 与 Tooltip 都可能往 body 挂节点，RTL 收不干净会影响下一个用例
    cleanup();
    document.body.innerHTML = "";
  });

  it("渲染「续写」并暴露可访问名", () => {
    render(<ContinueFab onContinue={() => {}} />);
    expect(screen.getByRole("button", { name: "AI 续写" })).toBeTruthy();
    expect(document.querySelector(".nv-contfab__text")?.textContent).toBe("续写");
  });

  it("点击即回调（二次确认由 useNovelPage.requestContinuation 负责）", () => {
    const onContinue = vi.fn();
    render(<ContinueFab onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "AI 续写" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("AI 不可用 → 禁用，且不触发回调", () => {
    const onContinue = vi.fn();
    render(
      <ContinueFab
        onContinue={onContinue}
        aiAvailable={false}
        aiUnavailableText="还没配置 AI 服务"
      />,
    );
    const button = screen.getByRole("button", { name: "AI 续写" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("生成中（busy）显示进度态，文案与图标都不再是待点状态", () => {
    render(<ContinueFab onContinue={() => {}} busy />);
    const button = screen.getByRole("button", { name: "AI 续写" });
    expect(button.className).toContain("ant-btn-loading");
  });
});
