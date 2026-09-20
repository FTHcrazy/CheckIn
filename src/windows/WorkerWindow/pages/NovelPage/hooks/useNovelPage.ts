import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildBreadcrumb,
  buildChapterNumbers,
  buildEntityTerms,
  formatClock,
  formatNumberedLabel,
  formatThousands,
  previewChapterReorder,
  previewChapterToVolume,
  previewVolumeReorder,
} from "../novel-utils";
import type { EntitySavePatch, EntityType } from "../types";
import type { ReorderChange } from "../components/ReorderConfirmModal";
import { useEntityHover } from "./useEntityHover";
import { useNovelData } from "./useNovelData";
import { useNovelEditorState } from "./useNovelEditorState";
import { useNovelShortcuts } from "./useNovelShortcuts";
import { useNovelViewState } from "./useNovelViewState";

/** 待确认的重排请求（防误触排序开启时，拖拽先到这里等用户确认） */
type PendingReorder =
  | { kind: "chapter"; fromId: string; toId: string }
  | { kind: "chapterToVolume"; chapterId: string; volumeId: string }
  | { kind: "volume"; fromId: string; toId: string };

/** 确认弹框展示模型：标题 + 变更行（旧序号 → 新序号） */
interface ReorderPreview {
  title: string;
  changes: ReorderChange[];
}

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

  // ── 选区右键菜单（O3 ③右键版）：锚点 + 新建 / 绑定 ────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  /** EditorPane 上报的右键坐标（stage 相对，已 clamp） */
  const handleEditorContextMenu = useCallback((x: number, y: number): void => {
    setCtxMenu({ x, y });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const handleCtxMark = useCallback(
    (type: EntityType): void => {
      setCtxMenu(null);
      handleMark(type);
    },
    [handleMark],
  );

  /** 把选中文本绑定到指定资料卡（关联为别名，手动绑定路线的核心动作） */
  const handleCtxBind = useCallback(
    (entityId: string): void => {
      const text = editor.selection?.text;
      setCtxMenu(null);
      editor.setSelection(null);
      if (!text) return;
      const result = data.bindTextToEntity(text, entityId);
      if (!result) {
        view.showToast("绑定失败，请重试", "warning");
        return;
      }
      if (result.mode === "linked") {
        view.showToast(`已关联为「${result.entity.name}」的别名`);
      } else {
        view.showToast(`「${result.entity.name}」已包含该称呼`, "info");
      }
    },
    [data, editor, view],
  );

  const handleNewVolume = useCallback((): void => {
    const id = data.createVolume();
    if (id) view.showToast("已新建一卷，可把章节拖到卷头归入");
  }, [data, view]);

  /** 卷命名：与章节重命名一致静默生效 */
  const handleRenameVolume = useCallback(
    (volumeId: string, name: string): void => {
      data.renameVolume(volumeId, name);
    },
    [data],
  );

  /** 添加要素关联（人物关系等）：重复关联给出提示 */
  const handleAddRelation = useCallback(
    (
      entityId: string,
      entityType: EntityType,
      targetId: string,
      relation: string,
    ): void => {
      const target = data.getEntityById(targetId);
      if (!target) return;
      const ok = data.addLink(
        entityId,
        entityType,
        target.id,
        target.type,
        relation,
      );
      view.showToast(
        ok ? `已关联「${target.name}」` : `与「${target.name}」的该关联已存在`,
        ok ? "info" : "warning",
      );
    },
    [data, view],
  );

  const handleRemoveRelation = useCallback(
    (linkId: string, targetName: string): void => {
      data.removeLink(linkId);
      view.showToast(`已解除与「${targetName}」的关联`, "info");
    },
    [data, view],
  );

  /** 资料卡编辑保存（R23）：详情页编辑名称 / 类型 / 别名 / 一句话 / 性格 */
  const handleSaveEntity = useCallback(
    (entityId: string, patch: EntitySavePatch): void => {
      data.updateEntity(entityId, patch);
      view.showToast("资料卡已保存");
    },
    [data, view],
  );

  const handleRestoreRecovery = useCallback((): void => {
    editor.dismissRecovery();
  }, [editor]);

  // ── 防误触排序（R9 增强）：拖拽 → 确认弹框 → 应用 ──────────────────
  // 关闭开关时直接应用；开启时先记下请求，用预览纯函数算出序号变更清单
  const [pendingReorder, setPendingReorder] = useState<PendingReorder | null>(null);

  const applyReorder = useCallback(
    (request: PendingReorder): void => {
      if (request.kind === "chapter") {
        data.reorderChapters(request.fromId, request.toId);
      } else if (request.kind === "chapterToVolume") {
        data.moveChapterToVolume(request.chapterId, request.volumeId);
      } else {
        data.reorderVolumes(request.fromId, request.toId);
      }
      setPendingReorder(null);
      view.showToast("章节顺序已更新");
    },
    [data, view],
  );

  const requestReorder = useCallback(
    (request: PendingReorder): void => {
      if (!editor.settings.confirmReorder) {
        applyReorder(request);
        return;
      }
      setPendingReorder(request);
    },
    [applyReorder, editor.settings.confirmReorder],
  );

  const reorderPreview = useMemo<ReorderPreview | null>(() => {
    if (!pendingReorder) return null;
    const { numberStyle, chapterSuffix, volumeSuffix } = editor.settings;

    /** 章节 diff：同一组卷下，比较重排前后的全书序号 */
    const chapterChanges = (
      afterChapters: ReturnType<typeof previewChapterReorder>,
    ): ReorderChange[] => {
      const before = buildChapterNumbers(data.volumes, data.chapters);
      const after = buildChapterNumbers(data.volumes, afterChapters);
      const changes: ReorderChange[] = [];
      for (const [id, number] of after) {
        const previous = before.get(id) ?? 0;
        if (previous === number) continue;
        const chapter = afterChapters.find((item) => item.id === id);
        changes.push({
          id,
          name: chapter?.title ?? "未知章节",
          from: formatNumberedLabel(
            numberStyle,
            chapterSuffix,
            previous || number,
          ),
          to: formatNumberedLabel(numberStyle, chapterSuffix, number),
        });
      }
      return changes;
    };

    if (pendingReorder.kind === "chapter") {
      const afterChapters = previewChapterReorder(
        data.chapters,
        pendingReorder.fromId,
        pendingReorder.toId,
      );
      return { title: "确认调整章节顺序", changes: chapterChanges(afterChapters) };
    }

    if (pendingReorder.kind === "chapterToVolume") {
      const afterChapters = previewChapterToVolume(
        data.chapters,
        pendingReorder.chapterId,
        pendingReorder.volumeId,
      );
      const volume = data.volumes.find((item) => item.id === pendingReorder.volumeId);
      return {
        title: `确认移入「${volume?.name ?? "目标卷"}」`,
        changes: chapterChanges(afterChapters),
      };
    }

    const afterVolumes = previewVolumeReorder(
      data.volumes,
      pendingReorder.fromId,
      pendingReorder.toId,
    );
    const changes: ReorderChange[] = afterVolumes
      .map((volume) => {
        const previous =
          data.volumes.find((item) => item.id === volume.id)?.sort ?? volume.sort;
        return { volume, previous };
      })
      .filter(({ volume, previous }) => previous !== volume.sort)
      .map(({ volume, previous }) => ({
        id: volume.id,
        name: volume.name,
        from: formatNumberedLabel(numberStyle, volumeSuffix, previous),
        to: formatNumberedLabel(numberStyle, volumeSuffix, volume.sort),
      }));
    return { title: "确认调整卷序", changes };
  }, [pendingReorder, data.volumes, data.chapters, editor.settings]);

  const cancelReorder = useCallback(() => setPendingReorder(null), []);

  /** 弹框确认：应用当前待定的重排请求 */
  const confirmReorder = useCallback(() => {
    if (pendingReorder) applyReorder(pendingReorder);
  }, [applyReorder, pendingReorder]);

  /** 树组件拖拽入口：章节 → 章节 / 章节 → 卷头 / 卷 → 卷头 */
  const handleReorderChapter = useCallback(
    (fromId: string, toId: string) => requestReorder({ kind: "chapter", fromId, toId }),
    [requestReorder],
  );
  const handleMoveChapterToVolume = useCallback(
    (chapterId: string, volumeId: string) =>
      requestReorder({ kind: "chapterToVolume", chapterId, volumeId }),
    [requestReorder],
  );
  const handleReorderVolume = useCallback(
    (fromId: string, toId: string) => requestReorder({ kind: "volume", fromId, toId }),
    [requestReorder],
  );

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
    reorderPreview,
    handleReorderChapter,
    handleMoveChapterToVolume,
    handleReorderVolume,
    confirmReorder,
    cancelReorder,
    handleSaveNow,
    handleNewChapter,
    handleSelectChapter,
    handleRollback,
    handleMark,
    handleOpenEntity,
    handleRestoreRecovery,
    ctxMenu,
    handleEditorContextMenu,
    closeCtxMenu,
    handleCtxMark,
    handleCtxBind,
    handleNewVolume,
    handleSaveEntity,
    handleRenameVolume,
    handleAddRelation,
    handleRemoveRelation,
  };
}
