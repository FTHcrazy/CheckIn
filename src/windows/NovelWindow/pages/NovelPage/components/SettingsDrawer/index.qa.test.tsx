import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../novel-config";
import SettingsDrawer from "./index";

/**
 * QA 独立回归面（REQ-050 修法 ③）——不复用实现者测试，专门打「破坏面最广」的
 * 那部分：改的是「点外部关闭」的**事件分流机制**，一旦退化成「吞事件 / 堆监听」，
 * 受害的是整页所有点击，而不是某一个按钮。
 *
 * 与实现者 `index.test.tsx` 的分工：
 * - 实现者钉「该关的关、该不关的不关」；
 * - 本文件钉「**绝不吞事件**（preventDefault + stopPropagation 双查）」与
 *   「**反复开合不泄漏监听**」（20 次后 document 上的 mousedown 净增为 0）。
 */
const buildProps = (over: Partial<Parameters<typeof SettingsDrawer>[0]> = {}) => ({
  open: true,
  settings: DEFAULT_SETTINGS,
  onUpdate: vi.fn(),
  onToggleAnnotationType: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

/** 记录 type==="mousedown" 的监听器引用计数（只看我们自己关心的那类） */
function trackMouseDownListeners() {
  const active = new Map<EventListenerOrEventListenerObject, number>();
  const addOrig = document.addEventListener.bind(document);
  const removeOrig = document.removeEventListener.bind(document);
  const addSpy = vi
    .spyOn(document, "addEventListener")
    .mockImplementation(((type: string, listener: any, opts: any) => {
      if (type === "mousedown") {
        active.set(listener, (active.get(listener) ?? 0) + 1);
      }
      return addOrig(type as any, listener, opts);
    }) as typeof document.addEventListener);
  const removeSpy = vi
    .spyOn(document, "removeEventListener")
    .mockImplementation(((type: string, listener: any, opts: any) => {
      if (type === "mousedown") {
        const next = (active.get(listener) ?? 0) - 1;
        if (next <= 0) active.delete(listener);
        else active.set(listener, next);
      }
      return removeOrig(type as any, listener, opts);
    }) as typeof document.removeEventListener);
  return {
    activeCount: () => active.size,
    restore: () => {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    },
  };
}

describe("SettingsDrawer 回归面：mousedown 分流不吞事件（REQ-050 修法 ③）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("外部 mousedown：既 preventDefault 不调，也不 stopPropagation（同一次点击能继续冒泡）", () => {
    const onClose = vi.fn();
    render(<SettingsDrawer {...buildProps({ onClose })} />);

    const outside = document.createElement("div");
    document.body.appendChild(outside);

    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(down, "preventDefault");
    const stopSpy = vi.spyOn(down, "stopPropagation");
    // 冒泡到 document 的兜底监听：若中途被 stopPropagation，这里不会收到
    const bubbleSpy = vi.fn();
    document.addEventListener("mousedown", bubbleSpy);

    outside.dispatchEvent(down);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(preventSpy).not.toHaveBeenCalled();
    // 关键：绝不拦截冒泡——否则同一次点击里「关闭」与「触发被点元素」会互相吞
    expect(stopSpy).not.toHaveBeenCalled();
    // 事件确实走完了整条冒泡链（document 收到了）
    expect(bubbleSpy).toHaveBeenCalledTimes(1);
  });

  it("外部 click 不被本次 mousedown 影响：同一交互里 click 照常派发给被点元素", () => {
    const onClose = vi.fn();
    render(<SettingsDrawer {...buildProps({ onClose })} />);

    const button = document.createElement("button");
    document.body.appendChild(button);
    const clickSpy = vi.fn();
    button.addEventListener("click", clickSpy);

    // 真实点击序列：mousedown → mouseup → click
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);

    expect(onClose).toHaveBeenCalledTimes(1);
    // 若第一击被「关闭路径」吃掉，这里会是 0 —— 这正是 REQ-050 的现象
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("反复开合 20 次后 document 上不留残余 mousedown 监听（无泄漏）", () => {
    const tracker = trackMouseDownListeners();
    const onClose = vi.fn();

    // 稳定 onClose（与真实用法一致：App 侧 useCallback 稳定引用）；
    // 若 onClose 每次换引用，effect 会 remove+add，但我们关心的是**净量**不涨
    const { rerender, unmount } = render(
      <SettingsDrawer {...buildProps({ onClose })} />,
    );
    const baselineAfterOpen = tracker.activeCount();
    expect(baselineAfterOpen).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < 20; i += 1) {
      rerender(<SettingsDrawer {...buildProps({ open: false, onClose })} />);
      rerender(<SettingsDrawer {...buildProps({ open: true, onClose })} />);
    }

    // 开着的时候仍然是「那份」（不因反复开合而堆积）
    expect(tracker.activeCount()).toBe(baselineAfterOpen);

    // 关闭 + 卸载：effect cleanup 摘掉监听，净量归零
    rerender(<SettingsDrawer {...buildProps({ open: false, onClose })} />);
    expect(tracker.activeCount()).toBe(0);

    unmount();
    expect(tracker.activeCount()).toBe(0);
    tracker.restore();
  });

  it("onClose 引用每次变化（内联箭头）也不泄漏：重渲染 20 次后净量恒定", () => {
    const tracker = trackMouseDownListeners();

    const { rerender, unmount } = render(
      <SettingsDrawer {...buildProps({ onClose: () => {} })} />,
    );
    for (let i = 0; i < 20; i += 1) {
      // 每次传一个新的 onClose：deps=[open, onClose] 会 remove+add，但净量应为 1
      rerender(<SettingsDrawer {...buildProps({ onClose: () => {} })} />);
    }
    expect(tracker.activeCount()).toBe(1);

    unmount();
    expect(tracker.activeCount()).toBe(0);
    tracker.restore();
  });
});
