import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SelectionGuide from "./index";

/**
 * T-03 选区气泡。
 *
 * 用真实定时器而不是 fake timers：antd Tooltip 的进出场走 rc-motion，
 * 它依赖 requestAnimationFrame，被假定时器接管后浮层可能永远挂不上来。
 * 代价是「等 6 秒超时」那条用例要放宽 testTimeout。
 */
vi.setConfig({ testTimeout: 20000 });

// antd 浮层挂在 document.body 上，RTL 的自动清理收不走 —— 不手动清，
// 上一条用例的气泡会活到下一条，getByText 报 found multiple。
afterEach(() => {
  document.body.innerHTML = "";
});

describe("SelectionGuide（T-03：选中文字 → 提示右键建资料卡）", () => {
  it("没有锚点时不弹（不能凭空飘一个气泡出来）", async () => {
    render(<SelectionGuide anchor={null} onHide={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByText("选中了，右键试试")).toBeNull();
  });

  it("给了锚点就出现，讲的是「右键建资料卡」这件事", async () => {
    render(<SelectionGuide anchor={{ x: 12, y: 34 }} onHide={vi.fn()} />);
    expect(await screen.findByText("选中了，右键试试")).toBeTruthy();
    expect(screen.getByText(/右键可以把选中的名字建成资料卡/)).toBeTruthy();
  });

  it("锚点坐标落在定位元素上（气泡跟着选区走，不是钉在编辑器角落）", async () => {
    const { container } = render(
      <SelectionGuide anchor={{ x: 120, y: 260 }} onHide={vi.fn()} />,
    );
    const anchor = container.querySelector<HTMLElement>(".nv-guide-anchor");
    expect(anchor).toBeTruthy();
    expect(anchor?.style.left).toBe("120px");
    expect(anchor?.style.top).toBe("260px");
  });

  it("超时后自己收起并通知外层清锚点（下次选中才可能再弹）", async () => {
    const onHide = vi.fn();
    render(<SelectionGuide anchor={{ x: 12, y: 34 }} onHide={onHide} />);
    await screen.findByText("选中了，右键试试");
    await waitFor(() => expect(onHide).toHaveBeenCalled(), { timeout: 9000 });
  });
});
