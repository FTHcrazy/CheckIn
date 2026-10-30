import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { resetShortcutStoreForTest, setShortcutConfig } from "@/shared/shortcuts";
import { useNovelShortcuts, type NovelShortcutHandlers } from "./useNovelShortcuts";

function makeHandlers(): NovelShortcutHandlers {
  return {
    onSave: vi.fn(),
    onJump: vi.fn(),
    onNewChapter: vi.fn(),
    onToggleFocus: vi.fn(),
    onTogglePack: vi.fn(),
    onOpenSettings: vi.fn(),
    onEscape: vi.fn(),
  };
}

/**
 * 编辑器快捷键的回归测试
 *
 * 这里钉的是历史上真实踩过的坑：
 * 1. `Ctrl+Shift+S` 曾因 if 链顺序问题被 `Ctrl+S` 吃掉，设定中心永远打不开
 *    —— 现在靠「具体度降序匹配」保证，改键位后也必须成立；
 * 2. IME 组合期必须放行，按拼音时不能触发保存；
 * 3. 用户在设置窗口改键后，本 hook 要立刻按新键位工作（不需要重启窗口）。
 */
describe("useNovelShortcuts", () => {
  beforeEach(() => {
    resetShortcutStoreForTest();
  });

  // ⚠️ vitest 未开 globals，testing-library 不会自动 cleanup：
  // 不手动卸载的话上一例的 window 监听还在，它会先命中并 preventDefault，
  // 下一例的 hook 因 `defaultPrevented` 直接跳过 —— 表现为「部分用例莫名不触发」。
  afterEach(() => {
    cleanup();
  });

  it("Ctrl+S 触发保存", () => {
    const handlers = makeHandlers();
    renderHook(() => useNovelShortcuts(handlers));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+S 只打设定中心，不会顺带保存（具体度排序）", () => {
    const handlers = makeHandlers();
    renderHook(() => useNovelShortcuts(handlers));
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+B 打开行囊，不会触发其它动作", () => {
    const handlers = makeHandlers();
    renderHook(() => useNovelShortcuts(handlers));
    fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true });
    expect(handlers.onTogglePack).toHaveBeenCalledTimes(1);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("IME 组合期一律放行（拼音输入不会触发快捷键）", () => {
    const handlers = makeHandlers();
    renderHook(() => useNovelShortcuts(handlers));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, isComposing: true });
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("已被下游 preventDefault 的按键不再处理（编辑器查找面板的 Esc）", () => {
    const handlers = makeHandlers();
    renderHook(() => useNovelShortcuts(handlers));
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(handlers.onEscape).not.toHaveBeenCalled();
  });

  it("用户改键位后立即生效（旧键位失效）", () => {
    const handlers = makeHandlers();
    const { rerender } = renderHook(() => useNovelShortcuts(handlers));

    setShortcutConfig({ bindings: { save: "Mod+K" }, globals: [] });
    rerender();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(handlers.onSave).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it("Esc 交给 onEscape（关闭最上层浮层）", () => {
    const handlers = makeHandlers();
    renderHook(() => useNovelShortcuts(handlers));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });
});
