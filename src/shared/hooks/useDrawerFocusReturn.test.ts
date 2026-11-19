import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDrawerFocusReturn } from "./useDrawerFocusReturn";

/** 触发按钮 + 兜底根 + 抽屉内控件，全部是真 DOM 节点（focus 才有意义） */
function setupDom(): {
  trigger: HTMLButtonElement;
  fallback: HTMLDivElement;
  container: HTMLDivElement;
  initial: HTMLInputElement;
} {
  const host = document.createElement("div");
  const trigger = document.createElement("button");
  const fallback = document.createElement("div");
  const container = document.createElement("div");
  const initial = document.createElement("input");
  fallback.tabIndex = 0;
  container.appendChild(initial);
  host.append(trigger, fallback, container);
  document.body.appendChild(host);
  trigger.focus();
  return { trigger, fallback, container, initial };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useDrawerFocusReturn：触发捕获与关闭回焦（O-17）", () => {
  it("captureTrigger 记下当前 activeElement，restoreFocus 回到它", () => {
    const dom = setupDom();
    const containerRef = { current: dom.container };
    const { result } = renderHook(() =>
      useDrawerFocusReturn({ active: true, containerRef }),
    );

    act(() => result.current.captureTrigger());
    const inside = document.createElement("button");
    dom.container.appendChild(inside);
    inside.focus();
    expect(document.activeElement).toBe(inside);

    act(() => result.current.restoreFocus());
    expect(document.activeElement).toBe(dom.trigger);
  });

  it("触发元素卸载后回退到 fallbackRef", () => {
    const dom = setupDom();
    const containerRef = { current: dom.container };
    const fallbackRef = { current: dom.fallback };
    const { result } = renderHook(() =>
      useDrawerFocusReturn({ active: true, containerRef, fallbackRef }),
    );

    act(() => result.current.captureTrigger());
    dom.trigger.remove();
    act(() => result.current.restoreFocus());
    expect(document.activeElement).toBe(dom.fallback);
  });

  it("显式 initialFocusRef 在打开后拿到焦点（不 querySelector）", async () => {
    const dom = setupDom();
    const containerRef = { current: dom.container };
    const initialFocusRef = { current: dom.initial };
    renderHook(() =>
      useDrawerFocusReturn({
        active: true,
        containerRef,
        initialFocusRef,
      }),
    );
    // rAF 由 jsdom 异步执行，等一拍再断言
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(dom.initial);
  });

  it("抽屉内的元素不会被误记为触发点（避免重复打开回焦到自己）", () => {
    const dom = setupDom();
    const inside = document.createElement("button");
    dom.container.appendChild(inside);
    inside.focus();
    const containerRef = { current: dom.container };
    const fallbackRef = { current: dom.fallback };
    const { result } = renderHook(() =>
      useDrawerFocusReturn({ active: true, containerRef, fallbackRef }),
    );

    act(() => result.current.captureTrigger());
    act(() => result.current.restoreFocus());
    // 触发点没被记录 → 回退到 fallback，而不是抽屉内那颗按钮
    expect(document.activeElement).toBe(dom.fallback);
  });

  it("active=false 时不接管焦点，也不改动当前 activeElement", () => {
    const dom = setupDom();
    dom.fallback.focus();
    const containerRef = { current: dom.container };
    const initialFocusRef = { current: dom.initial };
    renderHook(() =>
      useDrawerFocusReturn({
        active: false,
        containerRef,
        initialFocusRef,
      }),
    );
    expect(document.activeElement).toBe(dom.fallback);
  });
});
