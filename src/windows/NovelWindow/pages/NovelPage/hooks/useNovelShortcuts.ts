import { useEffect, useRef } from "react";

export interface NovelShortcutHandlers {
  /** Ctrl+S 手动保存 */
  onSave: () => void;
  /** Ctrl+P 章节快速跳转 */
  onJump: () => void;
  /** Ctrl+Enter 新建章节 */
  onNewChapter: () => void;
  /** F11 专注模式开关 */
  onToggleFocus: () => void;
  /** Ctrl+Shift+B 行囊面板开关（入口独立于侧边栏） */
  onTogglePack: () => void;
  /** Ctrl+Shift+S 设定中心（境界 / 功法 / 稀有度等序列的管理入口） */
  onOpenSettings: () => void;
  /** Esc：按优先级关闭最上层的浮层（设定中心 → 排版设置 → 快照 → 专注模式） */
  onEscape: () => void;
}

/**
 * 全局快捷键（PRD §2 核心快捷键）
 *
 * 约定：IME 组合期间一律放行（event.isComposing），绝不打断中文输入；
 * Esc 只用于退出专注模式，关闭窗口的行为已按 PRD 移除。
 * 编辑器已消费的按键（查找面板的 Esc / Ctrl+F / Ctrl+H 等）会 preventDefault，
 * 这里跳过，避免「Esc 既关查找面板又退专注模式」的双跳。
 */
export function useNovelShortcuts(handlers: NovelShortcutHandlers): void {
  /*
   * 用 ref 持有最新回调，effect 依赖置空 —— 整个会话只绑一次。
   *
   * 上层传来的多是内联箭头（onSave / onJump）或依赖了每次渲染都换引用的
   * useCallback（handleNewChapter / handleEscape），直接进依赖数组会让这条
   * 全局输入通道**每次重渲染都 remove + add 一次**：写作期间约每秒一次
   * （自动保存、toast、面板开合都会触发），既无谓也有概率丢并发事件。
   */
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const h = handlersRef.current;

      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        h.onTogglePack();
        return;
      }

      // 必须排在裸 Ctrl+S 之前：两者都满足 ctrl+「s」，
      // 顺序反了 Ctrl+Shift+S 会被保存吃掉，设定中心永远打不开
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        h.onOpenSettings();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        h.onSave();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        h.onJump();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        h.onNewChapter();
        return;
      }

      if (event.key === "F11") {
        event.preventDefault();
        h.onToggleFocus();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        h.onEscape();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
