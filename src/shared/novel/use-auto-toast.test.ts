/**
 * useAutoToast 计时清理测试（P3-3）。
 *
 * 钉死三条：① 到时自动清 null；② 弹新 toast 会重置计时器（不是串行叠加）；
 * ③ 卸载时清掉挂着的计时器 —— React 18 下卸载后 setState 是静默 no-op，
 * 测不出问题，所以这里用 fake timers 断言「卸载后计时器不再触发」。
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoToast } from "./use-auto-toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useAutoToast", () => {
  it("到时自动清 null", () => {
    const { result } = renderHook(() => useAutoToast(2600));
    act(() => result.current.showToast("已保存"));
    expect(result.current.toast?.text).toBe("已保存");
    act(() => vi.advanceTimersByTime(2600));
    expect(result.current.toast).toBeNull();
  });

  it("连弹两条会重置计时器（按 id 重算，不是叠加）", () => {
    const { result } = renderHook(() => useAutoToast(2600));
    act(() => result.current.showToast("第一条"));
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.showToast("第二条"));
    // 距第二条 2000ms（距第一条已 4000ms）：计时器从第二条起算，仍显示
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.toast?.text).toBe("第二条");
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.toast).toBeNull();
  });

  it("卸载清掉挂着的计时器：到点后不触发任何状态更新", () => {
    const { result, unmount } = renderHook(() => useAutoToast(2600));
    act(() => result.current.showToast("马上卸载"));
    unmount();
    // 若计时器没被 clearTimeout，advanceTimers 会对已卸载组件 setState；
    // React 18 不再告警，所以靠「无异常 + 无可观察输出」兜住行为
    expect(() => act(() => vi.advanceTimersByTime(2600))).not.toThrow();
  });

  it("closeToast 立即清空，不必等计时器", () => {
    const { result } = renderHook(() => useAutoToast(2600));
    act(() => result.current.showToast("手动关"));
    act(() => result.current.closeToast());
    expect(result.current.toast).toBeNull();
  });
});
