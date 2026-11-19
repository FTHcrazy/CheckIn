/**
 * 抽屉焦点回焦（O-17，共享基建）
 *
 * 焦点陷阱本身交给 antd `Drawer` 的 `focusLock` / `autoFocus` —— 本 hook 只负责
 * 两件事：记住打开前的触发元素、关闭时把焦点还回去（触发元素卸载时退到兜底根）。
 * **不手写 keydown 焦点陷阱，不 querySelector 找 DOM**（O-17 §3.3）。
 *
 * 接入方须保证「关闭」只有一个出口并调用 `restoreFocus()`：点关闭按钮、
 * Esc、点遮罩三条路径都走它，否则焦点会留在已消失的抽屉里。
 */
import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";

export interface UseDrawerFocusReturnOptions {
  /** 受控开关；false 时不再接管焦点 */
  active: boolean;
  /** 抽屉内容区根 ref（兜底聚焦 / 判定触发点是否在抽屉内） */
  containerRef: RefObject<HTMLElement | null>;
  /** 期望打开后聚焦的控件；不传时依赖 antd Drawer 自带的 autoFocus */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** 关闭后的回退元素（触发元素已卸载时用）；不传则无处可退，静默跳过 */
  fallbackRef?: RefObject<HTMLElement | null>;
}

export interface DrawerFocusReturn {
  /** 在触发处调用：记录 document.activeElement 为触发元素 */
  captureTrigger: () => void;
  /** 在抽屉 onClose 单一出口调用：回焦触发元素或兜底根 */
  restoreFocus: () => void;
}

export function useDrawerFocusReturn({
  active,
  containerRef,
  initialFocusRef,
  fallbackRef,
}: UseDrawerFocusReturnOptions): DrawerFocusReturn {
  const triggerRef = useRef<HTMLElement | null>(null);
  /** 防止「显式 restoreFocus」与「卸载兜底」对同一次关闭抢两次焦点 */
  const wasActiveRef = useRef(false);

  const captureTrigger = useCallback((): void => {
    const current = document.activeElement;
    if (current instanceof HTMLElement) {
      // 抽屉内容里的元素不算触发点（重复打开时会把自己记成触发元素）
      const container = containerRef.current;
      if (container && container.contains(current)) return;
      triggerRef.current = current;
    }
  }, [containerRef]);

  const restoreFocus = useCallback((): void => {
    const trigger = triggerRef.current;
    const target =
      trigger && trigger.isConnected
        ? trigger
        : (fallbackRef?.current ?? null);
    if (target && target.isConnected) {
      target.focus();
    }
    triggerRef.current = null;
    wasActiveRef.current = false;
  }, [fallbackRef]);

  useEffect(() => {
    if (active) {
      wasActiveRef.current = true;
      // 触发处没显式 capture 时，打开瞬间的 activeElement 通常就是触发按钮
      if (!triggerRef.current && document.activeElement instanceof HTMLElement) {
        captureTrigger();
      }
      // 只在调用方显式指定初控件时介入；其余交给 antd Drawer 的 autoFocus
      if (initialFocusRef?.current) {
        // 用 macrotask 而非 requestAnimationFrame：抽屉内容是 portal，挂载时机
        // 晚于本 effect；且 jsdom 的 rAF 时序不稳定，setTimeout 两边都确定。
        const timer = window.setTimeout(() => {
          initialFocusRef.current?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
      }
      return undefined;
    }
    return undefined;
  }, [active, captureTrigger, initialFocusRef]);

  // 组件在抽屉打开期间被卸载（如切章导致抽屉宿主消失）：回退到兜底根，不丢焦点
  useEffect(
    () => () => {
      if (!wasActiveRef.current) return;
      wasActiveRef.current = false;
      const target =
        triggerRef.current && triggerRef.current.isConnected
          ? triggerRef.current
          : (fallbackRef?.current ?? null);
      if (target && target.isConnected) target.focus();
      triggerRef.current = null;
    },
    [fallbackRef],
  );

  return { captureTrigger, restoreFocus };
}
