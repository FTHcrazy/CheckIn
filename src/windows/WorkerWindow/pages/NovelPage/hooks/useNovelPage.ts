import { useCallback, useEffect, useMemo, useRef } from "react";
import { buildBreadcrumb, buildEntityTerms, formatClock, formatThousands } from "../novel-utils";
import type { EntityType } from "../types";
import { useEntityHover } from "./useEntityHover";
import { useNovelData } from "./useNovelData";
import { useNovelEditorState } from "./useNovelEditorState";
import { useNovelShortcuts } from "./useNovelShortcuts";
import { useNovelViewState } from "./useNovelViewState";

/**
 * 小说编辑器页面组合层
 *
 * 只做三件事：组合三个 Hook、准备跨组件的派生数据、编排页面级交互。
 * 业务数据访问在 useNovelData，输入与保存在 useNovelEditorState，
 * 折叠与浮层在 useNovelViewState，本层不重复实现它们的逻辑。
 */
export function useNovelPage() {
  const data = useNovelData();
  const editor = useNovelEditorState(data);
  const view = useNovelViewState();
  const hover = useEntityHover();

  const { settings, stats, saveState } = editor;

  /** 标注层词库：随要素保存即时刷新（PRD §7） */
  const terms = useMemo(
    () => buildEntityTerms(data.entities, settings.annotationTypes),
    [data.entities, settings.annotationTypes],
  );

  const breadcrumb = useMemo(
    () => buildBreadcrumb(data.volumes, data.chapters, data.activeChapterId),
    [data.volumes, data.chapters, data.activeChapterId],
  );

  const handleSaveNow = useCallback(async (): Promise<void> => {
    await editor.flushSave();
    view.showToast(`已保存 · ${formatClock(Date.now())}`);
  }, [editor, view]);

  const handleNewChapter = useCallback((): void => {
    const id = data.createChapter(data.activeChapter?.volumeId);
    if (id) view.showToast("已新建章节", "info");
  }, [data, view]);

  const handleSelectChapter = useCallback(
    (chapterId: string): void => {
      data.selectChapter(chapterId);
      hover.dismiss();
    },
    [data, hover],
  );

  const handleRollback = useCallback(
    async (snapshotId: string, snapshotTime: number): Promise<void> => {
      const content = await data.rollbackSnapshot(snapshotId);
      if (content === null) {
        view.showToast("回滚失败，请重试", "warning");
        return;
      }
      editor.applyExternalContent(content);
      view.showToast(`已回滚至 ${formatClock(snapshotTime)} 的快照`);
    },
    [data, editor, view],
  );

  const handleMark = useCallback(
    (type: EntityType): void => {
      const result = editor.markSelection(type);
      if (!result) return;
      if (result.mode === "created") {
        view.showToast(`已创建${result.entity.name}并加入词库`);
      } else if (result.mode === "linked") {
        view.showToast(`已关联为${result.entity.name}的别名`);
      } else {
        view.showToast(`${result.entity.name}已在设定库中`, "info");
      }
    },
    [editor, view],
  );

  const handleOpenEntity = useCallback(
    (entityId: string): void => {
      hover.dismiss();
      view.openEntityDetail(entityId);
    },
    [hover, view],
  );

  const handleRestoreRecovery = useCallback((): void => {
    editor.dismissRecovery();
  }, [editor]);

  // Esc 关闭链：设置 → 快照 → 专注模式（逐层退出，章节跳转面板自己处理 Esc）
  const handleEscape = useCallback((): void => {
    if (view.settingsOpen) {
      view.closeSettings();
      return;
    }
    if (view.snapshotOpen) {
      view.closeSnapshot();
      return;
    }
    if (view.focusMode) {
      view.exitFocus();
    }
  }, [view]);

  useNovelShortcuts({
    onSave: () => void handleSaveNow(),
    onJump: () => (view.jumpOpen ? view.closeJump() : view.openJump()),
    onNewChapter: handleNewChapter,
    onToggleFocus: view.toggleFocus,
    onEscape: handleEscape,
  });

  // 目标达成只提示一次：跨过目标线的那一刻给轻提示 + 进度条填满（设计方案 §07）
  const goalNotifiedRef = useRef(false);
  useEffect(() => {
    if (stats.dailyGoal <= 0) return;
    if (stats.todayTotal < stats.dailyGoal) {
      goalNotifiedRef.current = false;
      return;
    }
    if (goalNotifiedRef.current) return;
    goalNotifiedRef.current = true;
    view.showToast(`今日目标达成 · ${formatThousands(stats.dailyGoal)} 字`);
  }, [stats.todayTotal, stats.dailyGoal, view]);

  // 关窗前的最后一次 flush（PRD §2：关窗永不询问，数据由持久化兜底）
  useEffect(() => {
    const flush = () => {
      if (saveState === "pending") void editor.flushSave();
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [editor, saveState]);

  return {
    data,
    editor,
    view,
    hover,
    terms,
    breadcrumb,
    handleSaveNow,
    handleNewChapter,
    handleSelectChapter,
    handleRollback,
    handleMark,
    handleOpenEntity,
    handleRestoreRecovery,
  };
}
