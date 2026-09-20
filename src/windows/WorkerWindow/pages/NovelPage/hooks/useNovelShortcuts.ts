import { useEffect } from "react";

export interface NovelShortcutHandlers {
  /** Ctrl+S 手动保存 */
  onSave: () => void;
  /** Ctrl+P 章节快速跳转 */
  onJump: () => void;
  /** Ctrl+Enter 新建章节 */
  onNewChapter: () => void;
  /** F11 专注模式开关 */
  onToggleFocus: () => void;
  /** Esc：按优先级关闭最上层的浮层（设置 → 快照 → 专注模式） */
  onEscape: () => void;
}

/**
 * 全局快捷键（PRD §2 核心快捷键）
 *
 * 约定：IME 组合期间一律放行（event.isComposing），绝不打断中文输入；
 * Esc 只用于退出专注模式，关闭窗口的行为已按 PRD 移除。
 */
export function useNovelShortcuts({
  onSave,
  onJump,
  onNewChapter,
  onToggleFocus,
  onEscape,
}: NovelShortcutHandlers): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        onJump();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        onNewChapter();
        return;
      }

      if (event.key === "F11") {
        event.preventDefault();
        onToggleFocus();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSave, onJump, onNewChapter, onToggleFocus, onEscape]);
}
