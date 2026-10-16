import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../novel-config";
import SettingsDrawer from "./index";

/**
 * REQ-050（P0）回归守卫：抽屉「点外部关闭」不再吃掉第一击。
 *
 * 根因不是 PRD 猜的「遮罩吞点击」，而是「覆盖式透明捕获层（.nv-setting__mask）
 * + 点击即关闭」与「顶栏按钮只开不关」在同一次点击争用。修法 ③ 三件事：
 * 1. 删掉 `.nv-setting__mask`（不再用遮挡换关闭）；
 * 2. 改**文档级 `mousedown` 分流**：落点在抽屉内不处理，否则 `onClose()`；
 * 3. **绝不 `preventDefault` / `stopPropagation`** —— 让同一次点击继续派发给
 *    被点元素，「关抽屉」与「触发元素」在同一次点击里同时发生。
 *
 * 本文件钉住这三点里最容易被改坏的两条：事件不被拦截（默认行为照旧发生）、
 * 开关自身的 keep-open 例外不回退成「先关再被 toggle 打开」。
 */
const buildProps = (over: Partial<Parameters<typeof SettingsDrawer>[0]> = {}) => ({
  open: true,
  settings: DEFAULT_SETTINGS,
  onUpdate: vi.fn(),
  onToggleAnnotationType: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

describe("SettingsDrawer：点外部关闭（REQ-050 修法 ③）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("不再渲染覆盖式透明捕获层 .nv-setting__mask", () => {
    const { container } = render(<SettingsDrawer {...buildProps()} />);
    expect(container.querySelector(".nv-setting__mask")).toBeNull();
    // 抽屉本体仍在（是 <aside> 根节点，不是被 fragment 包了一层）
    expect(container.querySelector(".nv-setting")).not.toBeNull();
  });

  it("落点在抽屉外 → onClose 被调，且被点元素仍收到 click（未被 preventDefault）", () => {
    const onClose = vi.fn();
    render(<SettingsDrawer {...buildProps({ onClose })} />);

    // 造一个抽屉外的真实节点，同时挂 mousedown / click 两个监听
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const clickSpy = vi.fn();
    outside.addEventListener("click", clickSpy);

    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(down, "preventDefault");
    outside.dispatchEvent(down);

    // 关抽屉生效
    expect(onClose).toHaveBeenCalledTimes(1);
    // 关键：绝不拦截 —— 否则被点元素收不到这次点击（第一击被吞）
    expect(preventSpy).not.toHaveBeenCalled();

    // 同一次用户操作里的 click 继续正常派发
    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("落点在抽屉内 → 不关闭", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsDrawer {...buildProps({ onClose })} />);

    const drawer = container.querySelector(".nv-setting");
    expect(drawer).not.toBeNull();
    fireEvent.mouseDown(drawer!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("落点在触发本抽屉的按钮上（data-drawer-keep-open） → 不关闭", () => {
    const onClose = vi.fn();
    render(<SettingsDrawer {...buildProps({ onClose })} />);

    // 顶栏「排版与偏好」按钮：自带 toggle 语义，不算「抽屉外部」，
    // 否则会「先被文档级监听关掉、再被 toggle 打开」→ 点了没反应
    const toggle = document.createElement("button");
    toggle.setAttribute("data-drawer-keep-open", "settings");
    document.body.appendChild(toggle);

    fireEvent.mouseDown(toggle);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("抽屉关闭时不挂监听：mousedown 落在外也不会误关", () => {
    const onClose = vi.fn();
    render(<SettingsDrawer {...buildProps({ open: false, onClose })} />);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("抽屉关闭按钮点击即关闭（逐层关闭路径仍通）", () => {
    const onClose = vi.fn();
    render(<SettingsDrawer {...buildProps({ onClose })} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
