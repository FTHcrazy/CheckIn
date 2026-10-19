import { useEffect, useRef } from "react";
import {
  SHORTCUTS,
  matchKeyEvent,
  specificity,
  useShortcutBindings,
} from "@/shared/shortcuts";

export interface NovelShortcutHandlers {
  /** 保存当前章（默认 Ctrl+S） */
  onSave: () => void;
  /** 章节快速跳转（默认 Ctrl+P） */
  onJump: () => void;
  /** 新建章节（默认 Ctrl+Enter） */
  onNewChapter: () => void;
  /** 专注模式开关（默认 F11） */
  onToggleFocus: () => void;
  /** 行囊面板开关（默认 Ctrl+Shift+B） */
  onTogglePack: () => void;
  /** 设定中心（默认 Ctrl+Shift+S） */
  onOpenSettings: () => void;
  /** Esc：按优先级关闭最上层的浮层 */
  onEscape: () => void;
}

/** 注册表 id → 回调键。注册表里不属编辑器的（help / showNovelWindow）不在此列 */
const HANDLER_BY_ID: Record<string, keyof NovelShortcutHandlers> = {
  save: "onSave",
  jump: "onJump",
  newChapter: "onNewChapter",
  toggleFocus: "onToggleFocus",
  togglePack: "onTogglePack",
  openSettings: "onOpenSettings",
  escape: "onEscape",
};

/** 本 hook 负责的快捷键定义（顺序无关，匹配时会按具体度重排） */
const EDITOR_SHORTCUTS = SHORTCUTS.filter((item) => item.id in HANDLER_BY_ID);

/**
 * 编辑器全局快捷键
 *
 * 1.47.0 起键位来自 `@/shared/shortcuts` 的注册表 + 用户在设置窗口的改动，
 * 不再是硬编码的 if 链：
 * - **具体度降序匹配**：`Ctrl+Shift+S` 必然先于 `Ctrl+S` 命中。旧实现靠手写
 *   顺序保证这一点，任何一次插入都可能让「设定中心永远打不开」复发。
 * - IME 组合期一律放行（`event.isComposing`），绝不打断中文输入。
 * - 尊重下游已消费的按键（`event.defaultPrevented`）：编辑器查找面板已处理
 *   Esc / Ctrl+F 时会 preventDefault，这里跳过，避免「Esc 既关查找面板又退专注模式」。
 *
 * ⚠️ 用 ref 持有最新回调与最新键位，effect 依赖置空 —— 整个会话只绑一次。
 * 上层传来的多是内联箭头，直接进依赖数组会让这条全局输入通道每次重渲染都
 * remove + add 一次（写作期间约每秒一次）。
 */
export function useNovelShortcuts(handlers: NovelShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const bindings = useShortcutBindings();
  const bindingsRef = useRef(bindings);
  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;

      // 每次按键按当前键位重排（8 条，开销可忽略）。
      // 不能只在模块加载时排一次：用户可能把不带修饰键的 F11 改成带修饰键的组合。
      const current = bindingsRef.current;
      const ordered = [...EDITOR_SHORTCUTS].sort(
        (a, b) =>
          specificity(current[b.id] ?? b.defaultKeys) -
          specificity(current[a.id] ?? a.defaultKeys),
      );

      for (const def of ordered) {
        const spec = current[def.id] ?? def.defaultKeys;
        if (!matchKeyEvent(event, spec)) continue;
        const handler = handlersRef.current[HANDLER_BY_ID[def.id]];
        if (!handler) continue;
        event.preventDefault();
        handler();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
