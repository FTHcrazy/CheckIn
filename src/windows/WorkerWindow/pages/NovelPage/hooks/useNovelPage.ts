import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POSITION } from "../novel-config";
import {
  buildBreadcrumb,
  buildBookPlainText,
  buildChapterNumbers,
  buildChapterPlainText,
  buildEntityCardText,
  buildEntityTerms,
  buildForeshadowDraft,
  buildOutlineTree,
  buildVolumePlainText,
  buildWorkMeta,
  formatClock,
  formatNumberedLabel,
  formatThousands,
  parseJsonOrNull,
  previewChapterReorder,
  previewChapterToVolume,
  previewVolumeReorder,
  sanitizeCustomTypes,
  volumeDisplayName,
} from "../novel-utils";
import {
  createNovelId,
  exportTxtFile,
  fetchCustomEntityTypes,
  logUsageEvent,
  saveCustomEntityTypes,
  saveLastPosition,
} from "../services/novel-service";
import { buildEntityTypesValue, type EntityTypesContextValue } from "./entity-types-context";
import type {
  CustomEntityTypeDef,
  EntitySavePatch,
  EntityType,
  ForeshadowPatch,
} from "../types";
import type { ReorderChange } from "../components/ReorderConfirmModal";
import type { InspirationActions } from "../components/InspirationPanel";
import type { OutlineActions } from "../components/OutlinePanel";
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

  // ── 自定义要素类型（R23）：config 整读整写，meta 由 EntityTypeContext 派生 ──
  const [customTypes, setCustomTypes] = useState<CustomEntityTypeDef[]>([]);
  const customTypesLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void fetchCustomEntityTypes()
      .then((raw) => {
        if (cancelled) return;
        setCustomTypes(sanitizeCustomTypes(parseJsonOrNull(raw)));
      })
      .catch(() => {
        // 读取失败按空处理：内置六类照常可用
      })
      .finally(() => {
        if (!cancelled) customTypesLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!customTypesLoadedRef.current) return;
    void saveCustomEntityTypes(customTypes);
  }, [customTypes]);

  /** 新建自建类型：名称去重、非法输入返回 null 由弹框提示 */
  const handleAddCustomType = useCallback(
    (name: string, color: string): CustomEntityTypeDef | null => {
      const trimmed = name.trim();
      if (!trimmed || !color) return null;
      if (customTypes.some((def) => def.name === trimmed)) return null;
      const def: CustomEntityTypeDef = {
        id: createNovelId("ct"),
        name: trimmed,
        color,
      };
      setCustomTypes((current) => [...current, def]);
      return def;
    },
    [customTypes],
  );

  /** 自建类型重命名：空名 / 与其他类型重名时失败 */
  const handleRenameCustomType = useCallback(
    (typeId: string, name: string): boolean => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      if (customTypes.some((def) => def.id !== typeId && def.name === trimmed)) {
        return false;
      }
      setCustomTypes((current) =>
        current.map((def) => (def.id === typeId ? { ...def, name: trimmed } : def)),
      );
      return true;
    },
    [customTypes],
  );

  /**
   * 删除自建类型：该类型要素卡先全部迁回 custom 兜底（数据不丢），返回
   * 迁移数量供 toast 汇报；未删除任何实体时返回 0。
   */
  const handleRemoveCustomType = useCallback(
    (typeId: string): number => {
      const migrated = data.migrateEntityType(typeId, "custom");
      setCustomTypes((current) => current.filter((def) => def.id !== typeId));
      return migrated;
    },
    [data],
  );

  const entityTypesValue = useMemo<EntityTypesContextValue>(
    () => buildEntityTypesValue(customTypes),
    [customTypes],
  );

  /** 标注层词库：随要素保存即时刷新（PRD §7）；自建类型词条带注入色（R23） */
  const terms = useMemo(() => {
    const colorOf = new Map(customTypes.map((def) => [def.id, def.color]));
    return buildEntityTerms(data.entities, settings.annotationTypes).map(
      (term) => {
        const color = colorOf.get(term.type);
        return color ? { ...term, color } : term;
      },
    );
  }, [data.entities, settings.annotationTypes, customTypes]);

  const breadcrumb = useMemo(
    () =>
      buildBreadcrumb(data.volumes, data.chapters, data.activeChapterId, {
        numberStyle: settings.numberStyle,
        volumeSuffix: settings.volumeSuffix,
      }),
    [data.volumes, data.chapters, data.activeChapterId, settings],
  );

  /**
   * 大纲树：骨架取自真实卷章（大纲里点章节 = 真跳转），伏笔来自 outlineEntries。
   * 序号标签随「数字样式 + 章节/卷后缀」配置派生，与左栏章节树严格一致。
   */
  const outline = useMemo(
    () =>
      buildOutlineTree(data.volumes, data.chapters, data.outlineEntries, {
        numberStyle: settings.numberStyle,
        chapterSuffix: settings.chapterSuffix,
        volumeSuffix: settings.volumeSuffix,
      }),
    [data.volumes, data.chapters, data.outlineEntries, settings],
  );

  const handleSaveNow = useCallback(async (): Promise<void> => {
    await editor.flushSave();
    view.showToast(`已保存 · ${formatClock(Date.now())}`);
  }, [editor, view]);

  const handleNewChapter = useCallback((): void => {
    const id = data.createChapter(data.activeChapter?.volumeId);
    if (id) view.showToast("已新建章节", "info");
  }, [data, view]);

  /** 在指定卷末尾新建章节（卷头 + 按钮）：空卷也能直接加章 */
  const handleCreateChapterInVolume = useCallback(
    (volumeId: string): void => {
      const id = data.createChapter(volumeId);
      if (id) view.showToast("已在本卷新建章节", "info");
    },
    [data, view],
  );

  const handleSelectChapter = useCallback(
    (chapterId: string): void => {
      data.selectChapter(chapterId);
      hover.dismiss();
    },
    [data, hover],
  );

  // ── 续写位置记忆（R6）：光标 / 滚动变化防抖落库，启动时由 useNovelData 恢复 ──
  const positionRef = useRef({ cursor: 0, scrollTop: 0 });
  const positionTimerRef = useRef(0);

  const savePositionNow = useCallback((): void => {
    window.clearTimeout(positionTimerRef.current);
    const { activeWorkId, activeChapterId } = data;
    if (!activeWorkId || !activeChapterId) return;
    void saveLastPosition({
      workId: activeWorkId,
      chapterId: activeChapterId,
      cursor: positionRef.current.cursor,
      scrollTop: positionRef.current.scrollTop,
      savedAt: Date.now(),
    });
  }, [data.activeWorkId, data.activeChapterId]);

  const schedulePositionSave = useCallback((): void => {
    window.clearTimeout(positionTimerRef.current);
    positionTimerRef.current = window.setTimeout(savePositionNow, POSITION.debounceMs);
  }, [savePositionNow]);

  const handleCursorChange = useCallback(
    (head: number): void => {
      positionRef.current.cursor = head;
      schedulePositionSave();
    },
    [schedulePositionSave],
  );

  const handleScrollChange = useCallback(
    (scrollTop: number): void => {
      positionRef.current.scrollTop = scrollTop;
      schedulePositionSave();
    },
    [schedulePositionSave],
  );

  // 换章 / 换作品后位置归零并立即记录；卸载时清掉未触发的防抖定时器
  useEffect(() => {
    positionRef.current = { cursor: 0, scrollTop: 0 };
    schedulePositionSave();
  }, [data.activeChapterId, data.activeWorkId, schedulePositionSave]);

  useEffect(() => () => window.clearTimeout(positionTimerRef.current), []);

  // ── 作品管理（R29）：组合层只做编排与提示，数据操作在 useNovelData ──
  const workMeta = useMemo(
    () => buildWorkMeta(data.volumes, data.chapters),
    [data.volumes, data.chapters],
  );

  const handleCreateWork = useCallback(
    (name: string): boolean => {
      const work = data.createWork(name);
      if (!work) return false;
      view.showToast(`已创建「${work.name}」，写下第一章吧`);
      return true;
    },
    [data, view],
  );

  const handleRenameWork = useCallback(
    (name: string): boolean => {
      const ok = data.renameWork(data.activeWorkId, name);
      if (ok) view.showToast("作品已重命名");
      return ok;
    },
    [data, view],
  );

  const handleDeleteWork = useCallback((): void => {
    data.deleteWork(data.activeWorkId);
    view.showToast("作品及其关联数据已删除", "info");
  }, [data, view]);

  /** 一键重置为模板书籍（调试）：重载后回到模板第一章 */
  const handleResetTemplate = useCallback(async (): Promise<void> => {
    const summary = await data.resetTemplate();
    if (!summary) {
      view.showToast("重置失败，请重试", "warning");
      return;
    }
    view.showToast(
      `已重置为模板书籍 · ${summary.chapters} 章 / 约 ${formatThousands(summary.words)} 字`,
      "info",
    );
  }, [data, view]);

  // ── TXT 导出（R13）：标题序号按 numberStyle + 后缀派生，与界面所见一致 ──

  const numberingOptions = useMemo(
    () => ({
      numberStyle: settings.numberStyle,
      chapterSuffix: settings.chapterSuffix,
      volumeSuffix: settings.volumeSuffix,
    }),
    [settings.numberStyle, settings.chapterSuffix, settings.volumeSuffix],
  );

  const finishExport = useCallback(
    (result: { path: string } | null, label: string): void => {
      if (result) {
        view.showToast(`${label}已导出：${result.path}`);
      } else {
        view.showToast("已取消导出", "info");
      }
    },
    [view],
  );

  /** 导出整本：书名 + 逐卷逐章，章节标题带「第一章 xxx」样式序号 */
  const handleExportBook = useCallback(async (): Promise<void> => {
    const work = data.works.find((item) => item.id === data.activeWorkId);
    if (data.chapters.length === 0) {
      view.showToast("当前作品还没有章节", "warning");
      return;
    }
    const content = buildBookPlainText(
      work?.name ?? "",
      data.volumes,
      data.chapters,
      numberingOptions,
    );
    const result = await exportTxtFile(
      `${work?.name ?? "未命名作品"}.txt`,
      content,
    );
    finishExport(result, "整本");
  }, [data.works, data.activeWorkId, data.volumes, data.chapters, numberingOptions, view, finishExport]);

  /** 导出当前章所在卷（卷序号 / 章序号与整本一致） */
  const handleExportVolume = useCallback(async (): Promise<void> => {
    const chapter = data.activeChapter;
    if (!chapter) {
      view.showToast("先选中一个章节再导出", "warning");
      return;
    }
    const volume = data.volumes.find((item) => item.id === chapter.volumeId);
    if (!volume) {
      view.showToast("章节未归属任何卷，请先导出整本", "warning");
      return;
    }
    const content = buildVolumePlainText(
      volume,
      data.chapters,
      data.chapterNumbers,
      numberingOptions,
    );
    const result = await exportTxtFile(
      `${volumeDisplayName(volume, settings.numberStyle, settings.volumeSuffix).replace(/[\\/:*?"<>|]/g, "_")}.txt`,
      content,
    );
    finishExport(result, "当前卷");
  }, [data.activeChapter, data.volumes, data.chapters, data.chapterNumbers, numberingOptions, settings.numberStyle, settings.volumeSuffix, view, finishExport]);

  /** 导出当前章（含「第N章 标题」标题行） */
  const handleExportChapter = useCallback(async (): Promise<void> => {
    const chapter = data.activeChapter;
    if (!chapter) {
      view.showToast("先选中一个章节再导出", "warning");
      return;
    }
    const number = data.chapterNumbers.get(chapter.id) ?? 1;
    const content = buildChapterPlainText(chapter, number, numberingOptions);
    const result = await exportTxtFile(
      `${chapter.title || formatNumberedLabel(settings.numberStyle, settings.chapterSuffix, number)}.txt`,
      content,
    );
    finishExport(result, "当前章");
  }, [data.activeChapter, data.chapterNumbers, numberingOptions, settings.numberStyle, settings.chapterSuffix, view, finishExport]);

  /** 导出设定卡（R13 顺手项）：基础字段 + 关联 + 当前境界 */
  const handleExportCard = useCallback(async (): Promise<void> => {
    const entity = view.detailEntityId
      ? data.getEntityById(view.detailEntityId)
      : null;
    if (!entity) return;
    const relations = data.getEntityRelations(entity.id, entity.type);
    const binding = relations.find(
      (relation) => relation.targetType === "level",
    );
    const content = buildEntityCardText(
      entity,
      relations,
      binding?.targetName,
    );
    const result = await exportTxtFile(`${entity.name} 设定卡.txt`, content);
    finishExport(result, `「${entity.name}」设定卡`);
  }, [view.detailEntityId, data, view, finishExport]);

  /** 设定 / 替换 / 取消当前境界（R25）：数据层先摘旧绑定再落新绑定 */
  const handleSetEntityLevel = useCallback(
    (entityId: string, entityType: EntityType, rungId: string | null): void => {
      data.setEntityLevel(entityId, entityType, rungId);
      view.showToast(
        rungId === null ? "已取消当前境界绑定" : "已更新当前境界",
        "info",
      );
    },
    [data, view],
  );

  /** 删除章节（行内已 Popconfirm 确认）：删当前章由数据层自动切邻居 */
  const handleDeleteChapter = useCallback(
    (chapterId: string): void => {
      data.deleteChapter(chapterId);
      view.showToast("章节及其历史快照已删除", "info");
    },
    [data, view],
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

  // ── 大纲板（R7）：章节一句话梗概 + 伏笔条目 ──────────────────────────
  const handleEditChapterNote = useCallback(
    (chapterId: string, note: string): void => {
      data.updateChapterOutlineNote(chapterId, note);
      view.showToast(note.trim() ? "已保存章节梗概" : "已清除章节梗概", "info");
    },
    [data, view],
  );

  const handleAddForeshadow = useCallback(
    (volumeId: string, title: string, note: string, chapterId?: string): void => {
      const entry = data.addOutlineEntry({
        workId: data.activeWorkId,
        kind: "foreshadow",
        volumeId,
        chapterId,
        title,
        note,
        status: "open",
      });
      if (!entry) {
        view.showToast("伏笔标题不能为空", "warning");
        return;
      }
      view.showToast(`已记录伏笔「${entry.title}」`);
    },
    [data, view],
  );

  const handleUpdateForeshadow = useCallback(
    (entryId: string, patch: ForeshadowPatch): void => {
      data.updateOutlineEntry(entryId, patch);
      view.showToast("伏笔已更新");
    },
    [data, view],
  );

  const handleToggleForeshadow = useCallback(
    (entryId: string, resolved: boolean): void => {
      data.toggleOutlineEntryStatus(entryId);
      view.showToast(resolved ? "伏笔已标记回收" : "伏笔已恢复待回收");
    },
    [data, view],
  );

  const handleRemoveForeshadow = useCallback(
    (entryId: string, title: string): void => {
      data.removeOutlineEntry(entryId);
      view.showToast(`已删除伏笔「${title}」`, "info");
    },
    [data, view],
  );

  // ── 灵感速记（R7）：编辑 / 置顶 / 一键转伏笔 ────────────────────────
  const handleUpdateNote = useCallback(
    (noteId: string, content: string): void => {
      data.updateNote(noteId, { content });
      view.showToast("灵感已更新");
    },
    [data, view],
  );

  const handleTogglePinNote = useCallback(
    (noteId: string, pinned: boolean): void => {
      data.updateNote(noteId, { pinned });
      view.showToast(pinned ? "已置顶该灵感" : "已取消置顶", "info");
    },
    [data, view],
  );

  const handleRemoveNote = useCallback(
    (noteId: string): void => {
      data.removeNote(noteId);
      view.showToast("已删除灵感", "info");
    },
    [data, view],
  );

  /**
   * 灵感 → 伏笔一键转化（R7 联动）
   *
   * 落到当前章节所在的卷（没有章节则落最后一卷，一卷都没有就顺手建一卷），
   * 埋设章取当前章；转完把右栏切到大纲，让用户立刻看到落点。
   */
  const handlePromoteNote = useCallback(
    (noteId: string): void => {
      const note = data.notes.find((item) => item.id === noteId);
      if (!note) return;
      if (note.foreshadowId) {
        view.showToast("这条灵感已经转成伏笔了", "info");
        return;
      }
      const activeVolumeId = data.activeChapter?.volumeId ?? null;
      const volumeId =
        activeVolumeId ?? data.groups.at(-1)?.volume.id ?? data.createVolume();
      if (!volumeId) {
        view.showToast("还没有可挂载的卷，请先新建一卷", "warning");
        return;
      }
      const entry = data.addOutlineEntry(
        buildForeshadowDraft(
          note,
          volumeId,
          activeVolumeId === volumeId ? data.activeChapter?.id : undefined,
        ),
      );
      if (!entry) {
        view.showToast("转化失败，请重试", "warning");
        return;
      }
      data.updateNote(noteId, { foreshadowId: entry.id });
      view.selectPanelTab("outline");
      view.showToast(`已转为伏笔「${entry.title}」`);
    },
    [data, view],
  );

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
        title: `确认移入「${
          volume
            ? volumeDisplayName(
                volume,
                editor.settings.numberStyle,
                editor.settings.volumeSuffix,
              )
            : "目标卷"
        }」`,
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
        name: volumeDisplayName(volume, numberStyle, volumeSuffix),
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

  /**
   * 大纲 / 灵感面板动作组
   *
   * 面板只拿自己需要的动作，不直接接触数据层 Hook；跨面板联动（灵感 → 伏笔）
   * 在这一层编排，避免两个面板互相依赖。
   */
  const outlineActions: OutlineActions = useMemo(
    () => ({
      onEditChapterNote: handleEditChapterNote,
      onAddForeshadow: handleAddForeshadow,
      onUpdateForeshadow: handleUpdateForeshadow,
      onToggleForeshadow: handleToggleForeshadow,
      onRemoveForeshadow: handleRemoveForeshadow,
    }),
    [
      handleEditChapterNote,
      handleAddForeshadow,
      handleUpdateForeshadow,
      handleToggleForeshadow,
      handleRemoveForeshadow,
    ],
  );

  const inspirationActions: InspirationActions = useMemo(
    () => ({
      onAddNote: data.addNote,
      onUpdateNote: handleUpdateNote,
      onTogglePin: handleTogglePinNote,
      onRemoveNote: handleRemoveNote,
      onPromoteNote: handlePromoteNote,
    }),
    [
      data.addNote,
      handleUpdateNote,
      handleTogglePinNote,
      handleRemoveNote,
      handlePromoteNote,
    ],
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

  // 目标达成只提示一次：跨过目标线的那一刻给轻提示 + 进度条填满（设计方案 §07），
  // 并上报 usage_log（R14：goal_reach 是北极星指标的达成事件）
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
    void logUsageEvent("goal_reach", {
      goal: stats.dailyGoal,
      words: stats.todayTotal,
    });
  }, [stats.todayTotal, stats.dailyGoal, view]);

  // 关窗前的最后一次 flush（PRD §2：关窗永不询问，数据由持久化兜底）；
  // 位置记忆同步落库，下次打开原位续写（R6）
  useEffect(() => {
    const flush = () => {
      if (saveState === "pending") void editor.flushSave();
      savePositionNow();
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [editor, saveState, savePositionNow]);

  return {
    data,
    editor,
    view,
    hover,
    terms,
    entityTypesValue,
    breadcrumb,
    outline,
    outlineActions,
    inspirationActions,
    workMeta,
    reorderPreview,
    handleReorderChapter,
    handleMoveChapterToVolume,
    handleReorderVolume,
    confirmReorder,
    cancelReorder,
    handleSaveNow,
    handleNewChapter,
    handleCreateChapterInVolume,
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
    handleCursorChange,
    handleScrollChange,
    handleCreateWork,
    handleRenameWork,
    handleDeleteWork,
    handleResetTemplate,
    handleDeleteChapter,
    handleExportBook,
    handleExportVolume,
    handleExportChapter,
    handleExportCard,
    handleSetEntityLevel,
    handleAddCustomType,
    handleRenameCustomType,
    handleRemoveCustomType,
  };
}
