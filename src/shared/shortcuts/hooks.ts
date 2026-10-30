import { useCallback, useSyncExternalStore } from "react";
import type { ShortcutConfig } from "./registry";
import {
  getShortcutConfig,
  subscribeShortcutConfig,
} from "./store";

/** 订阅整份快捷键配置（任何窗口改键后本组件会自动重渲染） */
export function useShortcutConfig(): ShortcutConfig {
  return useSyncExternalStore(
    useCallback((listener: () => void) => subscribeShortcutConfig(listener), []),
    getShortcutConfig,
    getShortcutConfig,
  );
}

/** 只取绑定表：绝大多数调用方只需要「id → 键位」 */
export function useShortcutBindings(): Record<string, string> {
  return useShortcutConfig().bindings;
}
