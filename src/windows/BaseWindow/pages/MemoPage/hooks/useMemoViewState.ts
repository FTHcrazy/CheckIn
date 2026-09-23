import { useCallback, useEffect, useRef } from "react";
import { App } from "antd";
import type { InputRef } from "antd";
import { useMemoSearchStore } from "../store/useMemoSearchStore";

/**
 * 备忘搜索视图状态（只在持有搜索框的 MemoHeader 内调用）
 *
 * 状态本体在 `store/useMemoSearchStore`：输入框每敲一个字都在变，
 * 因此**不能**由页面根订阅——否则搜索时要把侧栏和预览一起推一遍。
 * 谁持有搜索框谁调用本 Hook。
 *
 * 另外挂着两个局部副作用：Ctrl/Cmd+F 唤起搜索、命中项滚动到视野中央。
 */
export function useMemoViewState() {
  const { message } = App.useApp();
  const searchOpen = useMemoSearchStore((state) => state.searchOpen);
  const searchQuery = useMemoSearchStore((state) => state.searchQuery);
  const activeSearchQuery = useMemoSearchStore(
    (state) => state.activeSearchQuery,
  );
  const activeSearchIndex = useMemoSearchStore(
    (state) => state.activeSearchIndex,
  );
  const searchInputRef = useRef<InputRef>(null);

  const setSearchQuery = useMemoSearchStore((state) => state.setSearchQuery);
  const setSearchOpen = useMemoSearchStore((state) => state.setSearchOpen);
  const closeSearch = useMemoSearchStore((state) => state.closeSearch);

  const handleFind = useCallback((): void => {
    if (!useMemoSearchStore.getState().find()) {
      message.info("未找到匹配内容");
    }
  }, [message]);

  // 命中项滚动到视野中央：编辑态滚 textarea，预览态滚页面
  useEffect(() => {
    if (!activeSearchQuery) return undefined;
    const frame = requestAnimationFrame(() => {
      const activeMark = document.querySelector<HTMLElement>(
        ".memo-search-highlight--active",
      );
      if (!activeMark) return;
      const textArea = document.querySelector<HTMLTextAreaElement>(
        ".memo-editor-input-wrap textarea",
      );
      if (textArea) {
        textArea.scrollTo({
          top: Math.max(0, activeMark.offsetTop - textArea.clientHeight / 2),
          behavior: "instant",
        });
        return;
      }
      activeMark.scrollIntoView({ behavior: "instant", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSearchIndex, activeSearchQuery]);

  // Ctrl/Cmd + F 唤起搜索：有选区时直接把选中文本填进搜索框
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      const activeElement = document.activeElement;
      const selectedText =
        activeElement instanceof HTMLTextAreaElement
          ? activeElement.value
              .slice(activeElement.selectionStart, activeElement.selectionEnd)
              .trim()
          : (window.getSelection()?.toString().trim() ?? "");
      if (selectedText) setSearchQuery(selectedText);
      setSearchOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchOpen, setSearchQuery]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return {
    searchOpen,
    searchQuery,
    searchInputRef,
    activeSearchQuery,
    activeSearchIndex,
    setSearchQuery,
    setSearchOpen,
    closeSearch,
    handleFind,
  };
}
