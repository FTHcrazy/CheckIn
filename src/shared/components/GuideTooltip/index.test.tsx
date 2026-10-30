import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GuideTooltip from "./index";

/**
 * 弱提示气泡。
 *
 * 用真实定时器：antd Tooltip 的进出场走 rc-motion，依赖 requestAnimationFrame，
 * 被假定时器接管后浮层可能永远挂不上来。
 */
vi.setConfig({ testTimeout: 20000 });

// antd 浮层挂在 document.body 上，RTL 自动清理收不走
afterEach(() => {
  document.body.innerHTML = "";
});

describe("GuideTooltip", () => {
  it("consume 拒绝时完全不出现（已看过 / 打字保护期内）", async () => {
    render(
      <GuideTooltip id="T-02" consume={() => false}>
        <button type="button">目标按钮</button>
      </GuideTooltip>,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByText("第一次用？")).toBeNull();
  });

  it("父组件反复重渲染也等得到气泡 —— consume 不能进 effect 依赖", async () => {
    // 编辑器每敲一个字都要重渲染，调用方传的是内联箭头函数。若 consume 进了
    // effect 依赖（原实现的写法），定时器每次渲染都重置，气泡永远等不到
    // ENTER_DELAY_MS，等于这个点位静默失效。这里用连续重渲染把它钉住。
    let calls = 0;
    const view = (): ReactElement => (
      <GuideTooltip
        id="T-02"
        consume={() => {
          calls += 1;
          return true;
        }}
      >
        <button type="button">目标按钮</button>
      </GuideTooltip>
    );
    const { rerender } = render(view());
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      rerender(view());
    }
    expect(await screen.findByText("第一次用？")).toBeTruthy();
    // 只消费一次：多次渲染不代表多次提示
    expect(calls).toBe(1);
  });
});
