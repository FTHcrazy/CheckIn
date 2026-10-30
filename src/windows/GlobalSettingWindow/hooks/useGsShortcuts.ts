/**
 * 全局设定中心 · 键盘快捷键编排（R9）
 *
 * 挂在窗口根的文档级 `keydown`：
 * - `Ctrl/⌘+F` 聚焦并全选搜索框；
 * - `↑/↓` 在**当前过滤结果**内移动选中（不是全量）；
 * - `F2` / `Enter` 进入选中分类的就地改名；
 * - `Delete` 触发删除（走 `data.onDeleteCategory` 同一确认口径）；
 * - `Esc` 级联：行内改名 → 等级行编辑 → 行间插入 → 清空搜索（由 `GsBody` 编排）。
 *
 * 两条守卫（R9⑥ / Q8）：
 * 1. 焦点在 `input` / `textarea` / `select` / `[contenteditable]` ⇒ 除 `Ctrl+F` 与
 *    `Esc` 之外一律不响应（不劫持输入）；
 * 2. 焦点在任何 antd 弹层内（`.ant-modal` / `.ant-drawer` / `.ant-dropdown` /
 *    `.ant-select-dropdown`）⇒ **全部**不响应。
 *
 * ⚠️ handler 用 `useRef` 存最新引用，`useEffect` 依赖只放 `enabled` —— 否则
 * 每次渲染都要解绑 / 重绑一次监听，且 handler 身份变化会让按键在两次渲染之间丢失。
 */

import { useEffect, useRef } from "react";
import { isTypingTarget } from "./gs-view-utils";

export interface GsShortcutHandlers {
  onFocusSearch: () => void;
  onMove: (delta: number) => void;
  onRename: () => void;
  onDelete: () => void;
  onEscape: () => void;
}

/** 弹层作用域：命中即全部快捷键失效（弹层里有自己的键盘语义） */
const OVERLAY_SELECTOR =
  ".ant-modal,.ant-drawer,.ant-dropdown,.ant-select-dropdown,.ant-popover,.ant-tooltip";

export function useGsShortcuts(handlers: GsShortcutHandlers, enabled: boolean): void {
  const handlersRef = useRef<GsShortcutHandlers>(handlers);

  /**
   * 同步最新 handler：放在 effect 里写（渲染期改 ref 会被 `react-hooks/purity` 拦），
   * 且**不进**监听 effect 的依赖 —— 否则每次渲染都要解绑 / 重绑一次监听。
   * 声明顺序在监听之前，保证监听拿到的永远是本次渲染的 handler。
   */
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      const h = handlersRef.current;

      // Ctrl/⌘+F 恒响应：它本来就是「把焦点送到搜索框」，不受输入态守卫约束
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        h.onFocusSearch();
        return;
      }

      const target = event.target;
      const element = target instanceof HTMLElement ? target : null;
      if (element && element.closest(OVERLAY_SELECTOR)) return;

      // 正在输入：只放行 Esc（级联退出），其余全不劫持
      if (isTypingTarget(target)) {
        if (event.key === "Escape") h.onEscape();
        return;
      }

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          h.onMove(-1);
          return;
        case "ArrowDown":
          event.preventDefault();
          h.onMove(1);
          return;
        case "F2":
        case "Enter":
          event.preventDefault();
          h.onRename();
          return;
        case "Delete":
          event.preventDefault();
          h.onDelete();
          return;
        case "Escape":
          h.onEscape();
          return;
        default:
          return;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
