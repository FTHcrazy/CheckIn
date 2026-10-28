import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POSITION } from "../novel-config";
import {
  applyCustomTypeColors,
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
import { quickAddPackItem } from "@/shared/components/CharacterPack/services/pack-service";
import { notifyQuickAdded } from "@/shared/components/CharacterPack/pack-config";
import { subscribeDualChannel } from "@/shared/novel/dual-channel";
import {
  NOVEL_OPEN_SETTING_CENTER_CHANNEL,
  parseOpenSettingCenterRequest,
} from "@/shared/novel/open-setting-center";
import { buildEntityTypesValue, type EntityTypesContextValue } from "./entity-types-context";
import type {
  CustomEntityTypeDef,
  EntitySavePatch,
  EntityType,
  ForeshadowPatch,
} from "../types";
import type { ReorderChange } from "../components/ReorderConfirmModal";
import type { InspirationActions } from "../components/InspirationPanel";
import type { NamingActions } from "../components/NameGeneratorPanel";
import type { EditorPaneHandle } from "../components/EditorPane";
import type { OutlineActions } from "../components/OutlinePanel";
import {
  aiGenerate,
  aiGenerateStream,
  getAiConfig,
  logAiEvent,
  type AiStreamHandle,
} from "@/shared/ai/ai-client";
import {
  createOllamaAccumulator,
  createOpenAiSseAccumulator,
} from "@/shared/ai/ai-stream-parse";
import { useAiAvailability } from "@/shared/ai/hooks/useAiAvailability";
import { makeAiProvenance, newBatchId } from "@/shared/ai/ai-provenance";
import {
  alignParagraphBreaks,
  assembleContinuationStreamSpec,
  buildChapterScopePayload,
  buildPromptSpec,
  collectBookContext,
  inputCharBudget,
  matchEntitiesInText,
  parseSummaryReply,
  snippetBudget,
  TRANSFORM_INTENT_SUB,
  TRANSFORM_KIND_LABELS,
  type BookSnapshot,
  type ChapterScopePayload,
  type TransformKind,
} from "@/shared/ai/context";
import { estimateText } from "@/shared/ai/ai-estimate";
import type { L3Scope } from "@/shared/ai/ai-consent";
import { useAiConsent } from "@/shared/hooks/useAiConsent";
import {
  editorActions,
  needsFlushSave,
  useNovelEditorStore,
} from "../store/useNovelEditorStore";
import { dismiss } from "../store/useHoverStore";
import { useEntityHover } from "./useEntityHover";
import { useNovelData } from "./useNovelData";
import { useNovelEditorState } from "./useNovelEditorState";
import { useNovelShortcuts } from "./useNovelShortcuts";
import { useNovelViewState } from "./useNovelViewState";
import { usePackProtagonist } from "./usePackProtagonist";

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
  /**
   * 行囊窗口上下文的「代号」：重置模板 / 清库重播后 +1。
   *
   * 为什么需要它：`seedTemplateBook` 是**同 workId**（模板书 id 固定为
   * `tpl-w`）的清库重播种，行囊数据被连库清掉重播。PackWindow 的宿主按
   * `workId#nonce` 做 key，同 workId 不会重挂载 —— 它持重置前内存文档，
   * 下一次保存（手动 / 自动）会把旧文档盖回重播种数据（角色行都已重建，
   * 写回去的还是旧 characterId 的孤儿数据）。代号变化强制重挂载 → 重新装载。
   *
   * 声明在顶部：`handleResetTemplate`（下方）要 set它，setState 必须先声明。
   */
  const [packNonce, setPackNonce] = useState(0);
  /**
   * 「正在打开行囊」态（REQ-054）。
   *
   * 行囊是**独立窗口**：首次创建要等整个 SPA 装载完（dev 下 1–3s），这段时间
   * 屏幕上什么都不会发生 —— 作者会以为点了没反应，于是再点一次；第二次恰好命中
   * 装载完成前后，就成了「要点两次才弹出行囊窗口」。
   *
   * 所以点击即置位（顶栏那颗按钮转 loading），主进程在窗口**真正可见**时回执
   * `pack-window-shown` 复位。另有超时兜底：回执丢了也不要把按钮永久钉住。
   */
  const [packOpening, setPackOpening] = useState(false);
  /** 回执可能永远不来（窗口装载失败且被关掉），兜底时长按 dev 最慢路径留够余量 */
  const PACK_OPENING_TIMEOUT_MS = 8000;
  const packOpeningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const data = useNovelData();
  const editor = useNovelEditorState(data);
  const view = useNovelViewState();
  // hover 只注册副作用，不返回状态（卡片自己订阅 store，页面不跟着悬停重渲染）
  useEntityHover(data.getEntityById);

  /**
   * 行囊主角绑定（右侧要素栏 ↔ 行囊面板的交叉点）。
   *
   * 放在页面层而不是行囊模块里：它要在行囊面板关闭时依然生效——作者可能
   * 只是在右侧要素栏把某个角色设为主角，行囊面板压根没打开过。
   */
  const {
    protagonistEntityId,
    designate: designateProtagonist,
    refresh: refreshProtagonist,
  } = usePackProtagonist(data.activeWorkId);

  const handleSetProtagonist = useCallback(
    (entityId: string): void => {
      void designateProtagonist(entityId);
    },
    [designateProtagonist],
  );

  // 只取低频切片：正文 / 字数 / 保存态由各自组件订阅 store，
  // 这里一旦订阅，敲一个字就会把整棵树推一遍
  const { settings } = editor;

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

  // 装载失败不能停在无声空态：bundle 为 null 时整页没有内容也没有提示，
  // 用户只会以为「这个功能是空的」。给一次明确告警，reload 入口照常可用。
  useEffect(() => {
    if (!data.loadError) return;
    view.showToast(data.loadError, "warning");
  }, [data.loadError, view]);

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
   * 自建类型改色：正文高亮、chip、圆点共用 `def.color` 这一份，
   * 改完经 terms 的 useMemo 自动重算词条色，标注层热更新即可换色。
   */
  const handleRecolorCustomType = useCallback(
    (typeId: string, color: string): void => {
      const next = color.trim();
      if (!next) return;
      setCustomTypes((current) =>
        current.map((def) => (def.id === typeId ? { ...def, color: next } : def)),
      );
    },
    [],
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
  const terms = useMemo(
    () =>
      applyCustomTypeColors(
        buildEntityTerms(data.entities, settings.annotationTypes),
        customTypes,
      ),
    [data.entities, settings.annotationTypes, customTypes],
  );

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
   *
   * 依赖 data.groups（而非 volumes/chapters 各自重算）：useNovelData 已经为
   * 左栏章节树建好了分组，大纲直接复用同一份，避免同一轮渲染里建两遍。
   */
  const outline = useMemo(
    () =>
      buildOutlineTree(
        data.groups,
        data.chapters,
        data.outlineEntries,
        {
          numberStyle: settings.numberStyle,
          chapterSuffix: settings.chapterSuffix,
          volumeSuffix: settings.volumeSuffix,
        },
      ),
    [data.groups, data.chapters, data.outlineEntries, settings],
  );

  const handleSaveNow = useCallback(async (): Promise<void> => {
    const ok = await editor.flushSave();
    if (ok) {
      view.showToast(`已保存 · ${formatClock(Date.now())}`);
    } else {
      // 草稿还在内存里（调保存也不会丢），30s 兜底会重试；如实告知，别谎报成功
      view.showToast("保存失败，草稿仍在本地，稍后自动重试", "warning");
    }
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

  /**
   * 切章 / 切作品：行囊已是独立窗口（PackWindow），由 `novel-work-changed`
   * 广播主动跟进 —— 它会先 flush 旧作品的草稿再重载 bundle，无需页面侧拦截。
   */
  const handleSelectChapter = useCallback(
    (chapterId: string): void => {
      if (chapterId === data.activeChapterId) {
        dismiss();
        return;
      }
      data.selectChapter(chapterId);
      dismiss();
    },
    [data, dismiss],
  );

  const handleSelectWork = useCallback(
    (workId: string): void => {
      if (workId === data.activeWorkId) return;
      data.setActiveWorkId(workId);
    },
    [data],
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
    (name: string, genre?: string): boolean => {
      const work = data.createWork(name, genre);
      if (!work) return false;
      // 题材是可选步骤：选了就顺手确认一句，让作者知道自己填的东西确实生效了
      view.showToast(
        work.genre
          ? `已创建「${work.name}」（题材：${work.genre}），写下第一章吧`
          : `已创建「${work.name}」，写下第一章吧`,
      );
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

  /** 设置当前作品题材（空串 = 清空）：AI 起名 / 润色的风格锚点 */
  const handleSetWorkGenre = useCallback(
    (genre: string): boolean => {
      const ok = data.setWorkGenre(data.activeWorkId, genre);
      if (ok) {
        view.showToast(genre.trim() ? `题材已设为「${genre.trim()}」` : "已清空题材");
      }
      return ok;
    },
    [data, view],
  );

  const handleDeleteWork = useCallback((): void => {
    // 整部作品的章节 id 全部失效：草稿与在途防抖一并清空，
    // 否则防抖会拿已删除的 chapterId 落库 → 保存态永久 failed
    editor.clearDrafts();
    data.deleteWork(data.activeWorkId);
    view.showToast("作品及其关联数据已删除", "info");
  }, [data, editor, view]);

  /** 一键重置为模板书籍（调试）：重载后回到模板第一章 */
  const handleResetTemplate = useCallback(async (): Promise<void> => {
    // 清库重播会把章节 id 整批换掉：旧草稿与在途防抖全部失效，先撤掉，
    // 免得防抖拿已删除的 chapterId 落库把保存态钉死在 failed
    editor.clearDrafts();
    const summary = await data.resetTemplate();
    if (!summary) {
      view.showToast("重置失败，请重试", "warning");
      return;
    }
    // 重置会连行囊一起清空重播（模板行囊的主角是沈青梧），
    // 而作品 id 不变（模板书 id 固定）、hook 的 workId 依赖不会触发重读 → 显式刷一次
    await refreshProtagonist();
    // 行囊数据被连库重播：+1 代号让行囊窗口按 key 重挂载重新装载，
    // 否则它持重置前内存文档，下一次保存会把旧文档盖回重播种数据
    setPackNonce((n) => n + 1);
    view.showToast(
      `已重置为模板书籍 · ${summary.chapters} 章 / 约 ${formatThousands(summary.words)} 字`,
      "info",
    );
  }, [data, editor, view, refreshProtagonist]);

  // ── TXT 导出（R13）：标题序号按 numberStyle + 后缀派生，与界面所见一致 ──

  const numberingOptions = useMemo(
    () => ({
      numberStyle: settings.numberStyle,
      chapterSuffix: settings.chapterSuffix,
      volumeSuffix: settings.volumeSuffix,
      // 段首缩进（1.40.0）：导出跟随「首行缩进」设置 —— 编辑器开着缩进，
      // 导出的 txt 也该每段都缩进（含每章第一段）
      paragraphIndent: settings.indent,
    }),
    [settings.numberStyle, settings.chapterSuffix, settings.volumeSuffix, settings.indent],
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
    (
      entityId: string,
      entityType: EntityType,
      rungId: string | null,
      sub?: number,
    ): void => {
      data.setEntityLevel(entityId, entityType, rungId, sub);
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
      // 先撤草稿与在途防抖，再删章节：顺序反了的话，800ms 后的防抖会拿
      // 一个已删除的 chapterId 去落库，主进程如实返回 false，保存态就
      // 永久停在 failed（30s 兜底会一直重试这个注定失败的请求）
      editor.dropChapterDraft(chapterId);
      data.deleteChapter(chapterId);
      view.showToast("章节及其历史快照已删除", "info");
    },
    [data, editor, view],
  );

  const handleRollback = useCallback(
    async (snapshotId: string, snapshotTime: number): Promise<void> => {
      const content = await data.rollbackSnapshot(snapshotId);
      const chapterId = data.activeChapterId;
      if (content === null || !chapterId) {
        view.showToast("回滚失败，请重试", "warning");
        return;
      }
      editor.applyExternalContent(chapterId, content);
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
      dismiss();
      view.openEntityDetail(entityId);
    },
    [view],
  );

  // ── 选区右键菜单（O3 ③右键版）：锚点 + 新建 / 绑定 ────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  /** EditorPane 上报的右键坐标（stage 相对，已 clamp） */
  const handleEditorContextMenu = useCallback((x: number, y: number): void => {
    setCtxMenu({ x, y });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  /** 物品名长度上限：正文里选中的常常是整句，超过这个长度当物品名没有意义 */
  const QUICK_ADD_NAME_MAX = 40;

  /**
   * 选区右键 → 记入背包（REQ-027）。
   *
   * 面板开着时由面板改它自己的内存文档（脏计数 +1，需保存），没开则落主进程
   * （它会自己判断要不要并进草稿）—— 两边的选择封装在 `quickAddPackItem` 里，
   * 这里只负责取文本、给出反馈。
   *
   * 落主进程那条路**必须广播** `notifyQuickAdded`：行囊窗口是另一个渲染进程，
   * 不通知它，下一次整文档保存就会把刚记的物品连草稿一起清掉。
   */
  const handleCtxToPack = useCallback(async (): Promise<void> => {
    const text = (editor.selection?.text ?? "").trim();
    setCtxMenu(null);
    editor.setSelection(null);
    if (!text) {
      view.showToast("先选中要记入的物品名", "warning");
      return;
    }
    const name = text.slice(0, QUICK_ADD_NAME_MAX);
    const itemId = await quickAddPackItem(data.activeWorkId, {
      name,
      chapterId: data.activeChapterId ?? "",
    });
    if (itemId) {
      notifyQuickAdded(data.activeWorkId, itemId);
      view.showToast(`已记入背包：${name}${text.length > name.length ? "…" : ""}`);
    } else {
      view.showToast("记入背包失败，请重试", "warning");
    }
  }, [data, editor, view]);

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

  // ── AI 可用性门控（M8）─────────────────────────────
  // 统一口径：AI 不可用时，各入口据此决定「禁用并说明 / 走本地兜底」，杜绝
  // 「点了没反应」。声明在上下文与编排之前：contextLen 预算与入口禁用都从它取。
  const aiAvailability = useAiAvailability();

  /** EditorPane 命令式 ref：起名插入 / 润色回填 / 续写确认共用 */
  const editorPaneRef = useRef<EditorPaneHandle>(null);

  // ── AI 上下文快照（R-AI-05）：起名与润色共用一份，由采集层按 intent 裁剪 ──
  /**
   * 本书上下文快照：页面层负责「取数」，AI 层负责「裁剪 + 拼 prompt」。
   * 一次组装、多处复用，避免两套取数口径漂移。
   *
   * ⚠️ 不含 `chapterSnippet`（2.10.1）：章节片段的**位置**只有调用方知道
   * （选区在哪、光标在哪），整章塞进快照再被前向截断，会让章末润色拿到章首上下文。
   * 需要片段的调用方用下面的 `chapterSnippetAround` 现场切片。
   */
  const bookSnapshot = useMemo<BookSnapshot>(() => {
    const work = data.works.find((item) => item.id === data.activeWorkId);
    const levels = data.realmCategory?.levels
      ? [...data.realmCategory.levels]
          .sort((a, b) => a.rank - b.rank)
          .map((level) => level.name)
          .filter((name) => name.trim().length > 0)
      : [];

    return {
      workName: work?.name ?? "",
      // 题材（2.7.1）：建书时可选，未设置时由 AI 层按书名 + 要素弱兜底
      workGenre: work?.genre,
      entities: data.entities
        .filter((entity) => entity.workId === data.activeWorkId)
        .map((entity) => ({
          type: entity.type,
          name: entity.name,
          aliases: entity.aliases,
          summary: entity.summary,
        })),
      realmLevels: levels,
    };
  }, [data.works, data.activeWorkId, data.entities, data.realmCategory]);

  /**
   * 取「以选区为中心」的章节片段（前后各半，按预算裁）。
   *
   * 为什么不是整章前向截断：润色第 5000 字处的段落时，前向截断送上去的是
   * 章首 800 字 —— 标注写着「本段所在章节」，实际与选区毫无关系，既烧 token
   * 又误导模型。预算由 `snippetBudget(contextLen, 正文长度)` 算出。
   */
  const chapterSnippetAround = useCallback(
    (from: number, to: number, budget: number): string => {
      const content = data.activeChapter?.content ?? "";
      if (!content || budget <= 0) return "";
      const half = Math.max(200, Math.floor(budget / 2));
      const start = Math.max(0, from - half);
      const end = Math.min(content.length, Math.max(to, from) + half);
      return content.slice(start, end);
    },
    [data.activeChapter],
  );

  /** 当前活动章对应的大纲节点标题（续写 / 摘要共用，锚定剧情走向） */
  const activeOutlineNode = useMemo(
    () =>
      outline.find(
        (node) => node.kind === "chapter" && node.chapterId === data.activeChapterId,
      )?.title,
    [outline, data.activeChapterId],
  );

  // ── AI 润色（R-AI-03 对比预览形态）─────────────────────────────
  /** 润色预览浮层状态：open 时持有原选区快照（text + 绝对偏移）与结果 */
  const [polish, setPolish] = useState<{
    text: string;
    from: number;
    to: number;
    /** 当前预览的身份：`"polish"` = 润色，其余 = 某种文本变换（决定 retry / 标题 / 文案） */
    mode: "polish" | TransformKind;
    polished: string | null;
    loading: boolean;
    error: string | null;
  } | null>(null);

  /**
   * 发起一次「选中文本改写」：润色与五种变换共用一条链路。
   *
   * 五个变换 + 润色本质是同一动作的不同意图：选中 → 预览 → 确认替换，
   * 差别只在模板（`polish` / `transform`）与日志 intent。
   *
   * 三条容易漏掉的守卫（2.10.1）：
   * 1. **reject 兜底**：`aiGenerate` 走 IPC，主进程侧异常（如 ai.db 未就绪）
   *    会 reject —— 不接住就是浮层永久 loading、没有一行错误提示；
   * 2. **在途结果不越权**：只有当前面板仍属于本次 mode 才写回，否则用户
   *    换了选段/换了变换时，旧请求回来会把新面板的结果覆盖掉；
   * 3. **章节片段居中**：按选区位置切，不再送章首 800 字（见 `chapterSnippetAround`）。
   */
  const runRewrite = useCallback(
    async (mode: "polish" | TransformKind): Promise<void> => {
      const selection = editor.selection;
      if (!selection) return;
      const text = selection.text.trim();
      if (!text) {
        view.showToast(
          mode === "polish" ? "先选中要润色的文字" : "先选中要变换的文字",
          "warning",
        );
        return;
      }

      // 打开（或重置）预览为加载态，快照原选区（from/to 供确认时精确替换）
      setPolish({
        text,
        from: selection.from,
        to: selection.to,
        mode,
        polished: null,
        loading: true,
        error: null,
      });

      /** 只更新「还是本次请求」的面板 */
      const patch = (next: { polished?: string; loading: boolean; error: string | null }): void =>
        setPolish((prev) => (prev && prev.mode === mode ? { ...prev, ...next } : prev));

      try {
        // 上下文：书名 / 题材 / 命中的人物卡 / 选区所在章节片段
        const characters = matchEntitiesInText(text, bookSnapshot.entities);
        const snippet = chapterSnippetAround(
          selection.from,
          selection.to,
          snippetBudget(aiAvailability.config?.contextLen, text.length),
        );
        const context = collectBookContext(
          { ...bookSnapshot, chapterSnippet: snippet },
          mode === "polish" ? "polish" : "transform",
        );

        const spec =
          mode === "polish"
            ? buildPromptSpec("polish", context, { text, characters })
            : buildPromptSpec("transform", context, { kind: mode, text, characters });

        const result = await aiGenerate({
          system: spec.system,
          prompt: spec.prompt,
          intent: mode === "polish" ? "polish" : `transform:${TRANSFORM_INTENT_SUB[mode]}`,
        });

        if (!result.ok) {
          // AI 失败：预览浮层内展示错误，不替换原文
          patch({ loading: false, error: result.message });
          return;
        }

        // 段落分隔跟原文对齐：模型爱在段间插空行，整段回填后要作者手删（2.8.1）
        const rewritten = alignParagraphBreaks(result.data.text, text);
        const label = mode === "polish" ? "润色" : TRANSFORM_KIND_LABELS[mode];
        // 模型可能原样返回或返回空串，视为未改写成功
        if (!rewritten || rewritten === text) {
          patch({ loading: false, error: `这次没有产出有效${label}，换个说法再试` });
          return;
        }
        patch({ polished: rewritten, loading: false, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        patch({ loading: false, error: message || "AI 调用失败，请重试" });
      }
    },
    [editor, view, bookSnapshot, chapterSnippetAround, aiAvailability.config?.contextLen],
  );

  /** 润色入口（PRD R-AI-03）：语义与「文本变换」并列，便于右键菜单分开调用 */
  const runPolish = useCallback((): Promise<void> => runRewrite("polish"), [runRewrite]);

  /** 文本变换入口：扩写 / 精简 / 改写 / 换语气 / 转视角 */
  const runTransform = useCallback(
    (kind: TransformKind): Promise<void> => runRewrite(kind),
    [runRewrite],
  );

  /** 右键「文本变换」：记录选区并进入预览 */
  const handleCtxTransform = useCallback(
    (kind: TransformKind): void => {
      const selection = editor.selection;
      if (!selection) return;
      // 关闭右键菜单，但**保留选区**（预览要显示原句，确认要按偏移替换）
      setCtxMenu(null);
      void runTransform(kind);
    },
    [editor, runTransform],
  );

  /** 右键「润色这段文字」：记录选区并进入预览 */
  const handleCtxPolish = useCallback((): void => {
    const selection = editor.selection;
    if (!selection) return;
    // 关闭右键菜单，但**保留选区**（预览要显示原句，确认要按偏移替换）
    setCtxMenu(null);
    void runPolish();
  }, [editor, runPolish]);

  /** 确认替换：按快照的绝对偏移回填变换结果 */
  const handlePolishConfirm = useCallback((): void => {
    if (!polish?.polished) return;
    const pane = editorPaneRef.current;
    // 编辑器不在（切到书架 / 章节被关）时不能上报采纳：没发生就是没发生
    if (!pane) {
      view.showToast("编辑器还没就绪，暂时无法替换", "warning");
      return;
    }
    pane.replaceRange(polish.from, polish.to, polish.polished);
    editor.setSelection(null);
    setPolish(null);
    const label =
      polish.mode === "polish" ? "润色" : TRANSFORM_KIND_LABELS[polish.mode];
    view.showToast(`已替换为${label}后的文字`);
    // 采纳上报（M1a）：度量闭环的最后一公里，失败静默不阻塞写作
    void logAiEvent({
      intent: polish.mode === "polish" ? "polish" : `transform:${TRANSFORM_INTENT_SUB[polish.mode]}`,
      step: "adopt",
    });
  }, [polish, editor, view]);

  /** 关闭预览：不替换，清空状态（选区一并清除） */
  const handlePolishClose = useCallback((): void => {
    // 预览浮层关闭即「放弃」（cancel）；生成失败已在主进程落 fallback，此处只补人为关闭
    if (polish?.polished) {
      void logAiEvent({
        intent: polish.mode === "polish" ? "polish" : `transform:${TRANSFORM_INTENT_SUB[polish.mode]}`,
        step: "cancel",
      });
    }
    setPolish(null);
    editor.setSelection(null);
  }, [polish, editor]);

  /** 「换一种 / 重试」：按当前预览身份回退到对应编排（润色或某种变换） */
  const handlePolishRetry = useCallback((): void => {
    if (!polish) return;
    if (polish.mode === "polish") {
      void runPolish();
    } else {
      void runTransform(polish.mode);
    }
  }, [polish, runPolish, runTransform]);

  /** 续写浮层状态（R-AI-07 / B5 流式）：null = 未打开 */
  const [continuation, setContinuation] = useState<{
    /** 光标绝对偏移（确认插入时用它定位） */
    cursor: number;
    /** 已流式生成的正文；空 = 尚未产出或生成中 */
    text: string;
    /** 是否正在流式生成（逐字输出中） */
    streaming: boolean;
    loading: boolean;
    error: string | null;
  } | null>(null);

  /** 当前流式句柄（用于中断）：切换 / 关闭 / 重试时 abort 上一个 */
  const continuationStreamRef = useRef<AiStreamHandle | null>(null);

  /** 前文截断上限（字）：续写只带光标前一段，不把整章塞进 prompt */
  const CONTINUATION_BEFORE_CHARS = 1000;

  /**
   * 流序号：每次发起 / 中断自增。
   *
   * 为什么需要它：单 `continuationStreamRef` + 单状态在多流重入时会串味 ——
   * 重试时旧流的 catch 会把**新流**的 `streaming` 置 false；旧流收尾还会把
   * ref 清空，让新流再也 abort 不掉。序号让「旧流的后续写入」整体作废。
   */
  const continuationSeqRef = useRef(0);

  /** 中断当前续写流（B5）：释放连接，保留已生成部分 */
  const abortContinuation = useCallback((): void => {
    continuationStreamRef.current?.abort();
    continuationStreamRef.current = null;
    continuationSeqRef.current += 1;
  }, []);

  /**
   * 发起一次续写请求（B5 流式版）。
   *
   * 光标停在卡住的地方（无选区），取光标前 N 字作前文，AI 顺着往下写一段，
   * **逐字流式输出**（打字机），作者可随时中断保留已生成部分。确认后才
   * `insertText`（可 Ctrl+Z 撤销）。
   */
  const runContinuation = useCallback(async (): Promise<void> => {
    const before = editorPaneRef.current?.getTextBeforeCursor(CONTINUATION_BEFORE_CHARS);
    if (!before || !before.text.trim()) {
      view.showToast("先到正文里点一下要续写的位置", "warning");
      return;
    }

    // 中断上一个在途流（重试 / 换一批时先断开旧的），并作废旧流的后续写入
    abortContinuation();
    const seq = continuationSeqRef.current;
    /** 本次流的句柄：catch 里据此区分「主动中断」与「真失败」 */
    let streamed: AiStreamHandle | null = null;

    // 打开（或重置）浮层为流式态，快照光标偏移（确认时用它精确定位）
    setContinuation({
      cursor: before.cursor,
      text: "",
      streaming: true,
      loading: false,
      error: null,
    });

    /** 只接受「本次流」的状态写入：旧的 catch / 旧块回来时一律丢弃 */
    const patch = (next: Partial<{ text: string; streaming: boolean; error: string | null }>): void => {
      if (continuationSeqRef.current !== seq) return;
      setContinuation((prev) => (prev ? { ...prev, ...next } : prev));
    };

    // 前文命中的人物卡（续写必须知道「接着写的是谁的戏」）
    const characters = matchEntitiesInText(before.text, bookSnapshot.entities);
    // 上一章的 AI 摘要（R-AI-09 的第二消费方）：章节顺序以卷分组为准，
    // 与摘要 / 目录同源。这里只负责「取」，是否真注入由模板层按前文长度决定
    // （`CONTINUATION_SUMMARY_MIN_BEFORE_CHARS`）——阈值只能有一个产地。
    const orderedChapters = data.groups.flatMap((group) => group.chapters);
    const activeIndex = orderedChapters.findIndex((item) => item.id === data.activeChapterId);
    const previousSummary =
      activeIndex > 0 ? orderedChapters[activeIndex - 1]?.aiSummary?.trim() : undefined;
    const context = collectBookContext(bookSnapshot, "continuation");
    const spec = assembleContinuationStreamSpec(context, {
      before: before.text,
      characters,
      // 大纲节点（2.10.1 接线）：模板早就支持，此前调用方没传，等于白写
      ...(activeOutlineNode ? { outlineNode: activeOutlineNode } : {}),
      ...(previousSummary ? { previousSummary } : {}),
    });

    try {
      const handle = await aiGenerateStream({
        system: spec.system,
        prompt: spec.prompt,
        intent: "continuation",
      });
      streamed = handle;
      if (continuationSeqRef.current !== seq) {
        // 等首个响应期间已被新一次续写/关闭取代：立刻释放这条连接
        handle.abort();
        return;
      }
      continuationStreamRef.current = handle;

      // 按 provider 选解析器：OpenAI SSE / Ollama 逐行 JSON
      const provider = (await getAiConfig()).provider;
      const accumulator =
        provider === "ollama"
          ? createOllamaAccumulator()
          : createOpenAiSseAccumulator();

      let accText = "";
      // 逐段读流，把增量 append 到浮层（打字机）
      for (;;) {
        if (continuationSeqRef.current !== seq) return;
        const chunk = await handle.readChunk();
        if (chunk === null) break;
        const delta = accumulator.push(chunk);
        if (delta) {
          accText += delta;
          patch({ text: accText, streaming: true });
        }
      }
      // 冲刷残留缓冲
      const tail = accumulator.flush();
      if (tail) accText += tail;
      if (continuationSeqRef.current !== seq) return;

      continuationStreamRef.current = null;

      if (!accText.trim() || accText.trim() === before.text.trim()) {
        patch({ text: accText, streaming: false, error: "这次没有产出有效续写，换个位置或重试" });
        return;
      }
      patch({ text: accText, streaming: false, error: null });
    } catch (error) {
      // 被新一次续写 / 关闭取代：本次结果整体作废，不要碰当前浮层
      if (continuationSeqRef.current !== seq) return;
      continuationStreamRef.current = null;
      // 主动中断（abort）不算错误：已生成部分保留，浮层进入「可确认」态
      if (streamed?.done) {
        patch({ streaming: false });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      patch({ streaming: false, error: message || "续写失败，请重试" });
    }
  }, [view, bookSnapshot, abortContinuation, activeOutlineNode, data.groups, data.activeChapterId]);

  /** 确认流式续写结果：插到**快照光标**处，光标落到插入末尾 */
  const handleContinuationConfirm = useCallback(
    (text: string): void => {
      if (!continuation || !text) return;
      const pane = editorPaneRef.current;
      if (!pane) {
        view.showToast("编辑器还没就绪，暂时无法插入", "warning");
        return;
      }
      // 用快照光标而不是「当前选区」：流式期间作者可能随手选中别的段落，
      // 走 insertText 会命中 replaceSelection 分支，把那一段覆盖掉（2.10.1）。
      pane.replaceRange(continuation.cursor, continuation.cursor, text);
      setContinuation(null);
      view.showToast("已插入续写，可直接修改或继续");
      // 采纳上报（M1a）：续写确认插入即采纳
      void logAiEvent({ intent: "continuation", step: "adopt" });
    },
    [continuation, view],
  );

  /** 关闭续写浮层：不写入，清空状态 */
  const handleContinuationClose = useCallback((): void => {
    // 有产出而关闭 = 放弃（cancel）
    if (continuation && continuation.text.trim()) {
      void logAiEvent({ intent: "continuation", step: "cancel" });
    }
    abortContinuation();
    setContinuation(null);
  }, [continuation, abortContinuation]);

  /** 「重新生成」：中断当前流，重新发起续写（沿用光标处） */
  const handleContinuationRetry = useCallback((): void => {
    void runContinuation();
  }, [runContinuation]);

  // ── AI 章节摘要（R-AI-09）─────────────────────────────
  // 可用性门控（M8）已在上文 `aiAvailability` 统一声明，摘要入口复用它。
  /** L3 授权状态（M5）：摘要 = 整章全文 = L3 级，必须走统一授权 */
  const aiConsent = useAiConsent();

  /** 摘要生成状态：open 时持有目标章 id（授权前 / 生成中 / 结果） */
  const [summary, setSummary] = useState<{
    chapterId: string;
    loading: boolean;
    error: string | null;
    /** 生成出的摘要正文（成功后直接落库，这里仅作瞬时展示） */
    result: string | null;
    /** 模型给的「一句话梗概」（用于回填大纲）；空 = 本次没产出，不动大纲 */
    oneLiner: string;
    /** 本章已有手写梗概：非空 = 待用户确认覆盖，此时**未写入** */
    noteConflict: string;
    /** 一句话已写进大纲梗概（自动填 / 确认覆盖 / 原本就一致） */
    noteApplied: boolean;
  } | null>(null);

  /** 待授权确认的摘要请求：授权弹窗点「同意」后真正发起生成 */
  const [summaryPending, setSummaryPending] = useState<{
    chapterId: string;
    chapterTitle: string;
  } | null>(null);

  /**
   * 按当前 L3 授权范围，算出「真正要发给模型的那段正文」。
   *
   * 唯一构造点：弹窗字数估算、实际发送、事件上报都从这里取。三条路径各算一遍
   * 必然漂移——review G4 的成因就是「估算按整章、发送按整章、范围没人读」。
   */
  const buildSummaryPayload = useCallback(
    (chapterId: string, scope: L3Scope): ChapterScopePayload | null => {
      // 章节顺序以卷分组为准（与大纲/目录一致），扁平 chapters 不带卷序
      const ordered = data.groups.flatMap((group) => group.chapters);
      const index = ordered.findIndex((item) => item.id === chapterId);
      if (index < 0) return null;
      const chapter = ordered[index];
      // 选区只对「正在编辑的那一章」有效：别的章的选区是上一次编辑留下的
      const selection =
        chapterId === data.activeChapterId ? (editor.selection?.text ?? "") : "";
      return buildChapterScopePayload({
        scope,
        chapter: { title: chapter.title, content: chapter.content },
        previousChapters: ordered
          .slice(Math.max(0, index - 2), index)
          .map((item) => ({ title: item.title, content: item.content })),
        selection,
        // 预算与其余 intent 同源：把「上下文长度」配小，这里就真的少发
        budget: inputCharBudget(aiAvailability.config?.contextLen),
      });
    },
    [data.groups, data.activeChapterId, editor.selection, aiAvailability.config?.contextLen],
  );

  /**
   * 弹窗里的「本次将发送约 N 字」——必须随范围实时重算。
   *
   * 恒按整章算等于骗人：选了「选中段落」却告诉用户「约 3000 字」，
   * 用户会以为自己授权了 3000 字。空范围内显示 0 并给出说明，弹窗据此禁用「同意」。
   */
  const summaryPendingScope = useMemo((): {
    chars: number;
    tokens: number;
    notice: string | null;
  } => {
    if (!summaryPending) return { chars: 0, tokens: 0, notice: null };
    const payload = buildSummaryPayload(summaryPending.chapterId, aiConsent.scope);
    if (!payload?.ok) {
      return {
        chars: 0,
        tokens: 0,
        notice:
          payload?.reason === "no-selection"
            ? "当前范围是「选中段落」，请先在正文里选中要发送的内容"
            : null,
      };
    }
    return {
      ...estimateText(`${payload.chapterText}\n${payload.contextText ?? ""}`),
      notice: null,
    };
  }, [summaryPending, aiConsent.scope, buildSummaryPayload]);

  /**
   * 真正发起摘要生成（授权已通过后调用）。
   *
   * `scope` 是**入参**而不是读 hook 里的最新值：授权弹窗点「同意」时用户选的是哪档，
   * 就按哪档发——用最新值会让「弹窗还开着、范围被改过」这类竞态悄悄换内容。
   */
  const doGenerateSummary = useCallback(
    async (chapterId: string, chapterTitle: string, scope: L3Scope): Promise<void> => {
      const chapter = data.chapters.find((item) => item.id === chapterId);
      if (!chapter) return;

      // 先按范围取「真实要发的正文」：范围不是埋点字段，它决定发送内容（G4）
      const payload = buildSummaryPayload(chapterId, scope);
      if (!payload) return; // 章节已被删除 / 换作品
      if (!payload.ok) {
        // 选了「选中段落」却什么都没选：必须明说并停手，不能悄悄退回整章
        const message = "当前范围是「选中段落」，请先在正文里选中要发送的内容";
        setSummary((prev) =>
          prev && prev.chapterId === chapterId
            ? { ...prev, loading: false, error: message }
            : prev,
        );
        view.showToast(message, "warning");
        return;
      }

      const context = collectBookContext(bookSnapshot, "summary");
      const outlineNode =
        activeOutlineNode && chapterId === data.activeChapterId
          ? activeOutlineNode
          : outline.find(
              (node) => node.kind === "chapter" && node.chapterId === chapterId,
            )?.title;
      // 「整章」不等于「无上限」：导入的书单章可能几十万字，直接塞进 prompt 会撞
      // 上下文上限并静默失败。裁剪已在 buildSummaryPayload 按 contextLen 做完
      // （首尾拼接、中间标注省略），这里不再二次截断。
      const spec = buildPromptSpec("summary", context, {
        chapter: payload.chapterText,
        chapterTitle,
        outlineNode,
        scope,
        ...(payload.contextText ? { contextText: payload.contextText } : {}),
      });

      const result = await aiGenerate({
        system: spec.system,
        prompt: spec.prompt,
        intent: "summary",
        // 范围随请求下发：主进程写 trigger / success 事件时落 ai_event.scope
        scope,
      }).catch((error: unknown) => {
        // IPC 侧异常（主进程 ai.db 未就绪等）不能让面板永久 loading
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false as const,
          code: "internal" as const,
          message: message || "AI 调用失败，请重试",
        };
      });

      if (result.ok) {
        const text = result.data.text.trim();
        if (!text) {
          setSummary((prev) =>
            prev && prev.chapterId === chapterId
              ? { ...prev, loading: false, error: "这次没有产出有效摘要，重试一次" }
              : prev,
          );
          return;
        }
        // 拆「一句话」与「长摘要」：一句话回填大纲梗概（大纲回流），长摘要落库。
        // 模型没按标记返回时 oneLiner 为空——此时只落摘要，绝不动作者的大纲。
        const reply = parseSummaryReply(text);
        const bodyText = reply.summary || text;
        // 落库 + 本地乐观更新，带来源标记（M6 溯源：模型名 + 时间戳 + 批次）。
        // 模型名随生成响应回带（G8-③），省去一次 getAiConfig 的二次 IPC 往返。
        const model = result.data.model;
        const provenance = makeAiProvenance(model, Date.now(), newBatchId());
        data.updateChapterSummary(
          chapterId,
          bodyText,
          provenance?.model ?? model,
          provenance?.batchId,
        );

        // 大纲回流：无手写梗概就直接填；已有手写先不写，等用户在浮层确认覆盖
        // （覆盖会抹掉作者自己写的字，不能由 AI 单方面决定）
        const existingNote = (
          data.chapters.find((item) => item.id === chapterId)?.outlineNote ?? ""
        ).trim();
        let noteConflict = "";
        let noteApplied = false;
        if (reply.oneLiner) {
          if (!existingNote || existingNote === reply.oneLiner) {
            data.updateChapterOutlineNote(chapterId, reply.oneLiner);
            noteApplied = true;
          } else {
            noteConflict = existingNote;
          }
        }

        setSummary({
          chapterId,
          loading: false,
          error: null,
          result: bodyText,
          oneLiner: reply.oneLiner,
          noteConflict,
          noteApplied,
        });
        // 采纳上报（M1a）：摘要生成成功即「采纳」（text 输出无确认步骤，生成即落库）
        void logAiEvent({
          intent: "summary",
          step: "adopt",
          itemCount: 1,
          scope,
          ...(provenance ? { model: provenance.model } : {}),
        });
        return;
      }

      // AI 失败：浮层报错，不写任何摘要
      setSummary((prev) =>
        prev && prev.chapterId === chapterId
          ? { ...prev, loading: false, error: result.message }
          : prev,
      );
    },
    [
      data,
      bookSnapshot,
      outline,
      activeOutlineNode,
      buildSummaryPayload,
      view,
    ],
  );

  /**
   * 发起一次章节摘要（首次触发会先弹 L3 授权，确认后生成）。
   *
   * 摘要是 text 输出（非 json-array），落库到 `novel_chapters.ai_summary`，
   * 带来源标记（模型名 + 时间戳，M6 溯源）。失败不动原文，浮层报错。
   *
   * `force = false`（默认）时，已有摘要**只展示不重生成**；浮层里的「重新生成」
   * 走 `force = true`，那是唯一会再次调用模型的入口。
   */
  const runChapterSummary = useCallback(
    (chapterId: string, force = false): void => {
      const chapter = data.chapters.find((item) => item.id === chapterId);

      // 「查看」不等于「重新生成」：已存摘要直接展示，不调模型。
      // 章节行图标写的是「查看 AI 摘要」（实心 = 已有），点一下就扣一次 token
      // 是最伤信任的那种不一致；这里也刻意不看 AI 可用性——本地读库不该被门控拦。
      if (!force && chapter?.aiSummary) {
        setSummary({
          chapterId,
          loading: false,
          error: null,
          result: chapter.aiSummary,
          // 老数据没有「一句话」，区块整体不渲染，别冒充 AI 填过大纲
          oneLiner: "",
          noteConflict: "",
          noteApplied: false,
        });
        return;
      }

      // AI 不可用：直接说明原因，不弹空面板（M8 门控，B1 判据③「入口可消失」）
      if (!aiAvailability.available) {
        view.showToast(aiAvailability.reasonText || "AI 功能当前不可用", "warning");
        return;
      }
      if (!chapter || !chapter.content.trim()) {
        view.showToast("这一章还没有正文，写点内容再生成摘要", "warning");
        return;
      }

      // 打开摘要面板为加载态（授权未决时也先展示，避免「点了没反应」）
      setSummary({
        chapterId,
        loading: true,
        error: null,
        result: null,
        oneLiner: "",
        noteConflict: "",
        noteApplied: false,
      });

      // 未开 L3 总开关 → 先弹授权弹窗（M5 强制），确认后再真正生成。
      // 弹窗里同时选「本次范围」：范围决定发送内容，不只是埋点字段。
      if (!aiConsent.l3Enabled) {
        setSummaryPending({ chapterId, chapterTitle: chapter.title });
        return;
      }

      void doGenerateSummary(chapterId, chapter.title, aiConsent.scope);
    },
    [data.chapters, view, aiConsent.l3Enabled, aiConsent.scope, doGenerateSummary, aiAvailability],
  );

  /** 授权弹窗「同意并继续」：开总开关 + 真正生成（按弹窗里选定的范围发） */
  const handleSummaryConsentConfirm = useCallback(async (): Promise<void> => {
    if (!summaryPending) return;
    const { chapterId, chapterTitle } = summaryPending;
    const scope = aiConsent.scope;
    setSummaryPending(null);
    const ok = await aiConsent.enableL3();
    if (!ok) {
      setSummary((prev) =>
        prev && prev.chapterId === chapterId
          ? { ...prev, loading: false, error: "授权开启失败，请稍后重试" }
          : prev,
      );
      return;
    }
    void doGenerateSummary(chapterId, chapterTitle, scope);
  }, [summaryPending, aiConsent, doGenerateSummary]);

  /** 关闭摘要面板 */
  const handleSummaryClose = useCallback((): void => {
    // 生成中关闭 = 主动放弃（cancel）；空态关闭无意义不上报。
    // 带 scope：授权拒绝率 / 中断率要能按「用户敢发多大范围」切片
    if (summary?.loading) {
      void logAiEvent({ intent: "summary", step: "cancel", scope: aiConsent.scope });
    }
    setSummary(null);
    setSummaryPending(null);
  }, [summary, aiConsent.scope]);

  /**
   * 浮层「覆盖为这句」：把 AI 一句话写进本章的大纲梗概。
   *
   * 只有「本章已有手写梗概」时才走到这里（无手写时生成完就已自动填入）。
   * 按钮本身就是这一次确认，不再弹第二次窗——覆盖的对象是作者自己写的字，
   * 让他亲手点一下就够了，多一层「确定要覆盖吗」只会变成无脑回车。
   */
  const handleApplySummaryNote = useCallback((): void => {
    if (!summary || !summary.oneLiner) return;
    data.updateChapterOutlineNote(summary.chapterId, summary.oneLiner);
    setSummary((prev) =>
      prev ? { ...prev, noteConflict: "", noteApplied: true } : prev,
    );
    view.showToast("已用 AI 一句话替换大纲梗概", "info");
  }, [summary, data, view]);

  /** 授权弹窗取消（= 拒绝本次 L3 授权）：拒绝本身是最需要被计数的信号 */
  const handleSummaryConsentCancel = useCallback((): void => {
    void logAiEvent({ intent: "summary", step: "cancel", scope: aiConsent.scope });
    setSummaryPending(null);
    setSummary((prev) => (prev ? { ...prev, loading: false, error: null } : prev));
  }, [aiConsent.scope]);

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

  /**
   * 删除卷（卷头悬浮删除，弹层里已二次确认）。
   *
   * 先逐章撤草稿与在途防抖再删（理由同删单章：防抖拿已删 id 落库会把保存态
   * 永久卡在 failed）。逐章 drop 而不是 clearDrafts——后者清空全作品草稿，
   * 删一卷不该连累其他卷里还没存的内容。
   */
  const handleDeleteVolume = useCallback(
    (volumeId: string): void => {
      const group = data.groups.find((item) => item.volume.id === volumeId);
      if (!group) return;
      for (const chapter of group.chapters) {
        editor.dropChapterDraft(chapter.id);
      }
      const count = group.chapters.length;
      data.deleteVolume(volumeId);
      view.showToast(
        count > 0 ? `本卷及其下 ${count} 章已删除` : "空卷已删除",
        "info",
      );
    },
    [data, editor, view],
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

  // ── 起名工具（R18 / 步骤三）：双出口 + 收藏夹编排 ──────────────────────────
  // (editorPaneRef 已在 AI 上下文段上方声明，供润色 / 续写共用)

  /**
   * 把名字插入正文光标处（不依赖选区；选区非空则替换）。
   *
   * ⚠️ 只有真的插进去才上报 adopt：编辑器未挂载（书架视图 / 章节还没起来）时
   * 上报会把「采纳率」抬高成假数据 —— 度量必须跟着真实副作用走。
   */
  const handleInsertName = useCallback(
    (name: string): void => {
      const pane = editorPaneRef.current;
      if (!pane) {
        view.showToast("编辑器还没就绪，先把光标放到正文里", "warning");
        return;
      }
      pane.insertText(name);
      // 起名采纳上报（M1a）：B1 判据②「起名 → 插入正文 落一条 adopt」
      void logAiEvent({ intent: "naming", step: "adopt" });
    },
    [view],
  );

  /**
   * 起名结果「寓意」插入正文（2.8.1）
   *
   * 寓意本身就是一句命名释义，作者常直接写进人物出场段或设定清单。
   * 拼成 `名字：寓意` 而不是只丢寓意：单看一句话读者不知道说的是谁，
   * 而插入后就地编辑的成本远低于重新补名字。
   */
  const handleInsertMeaning = useCallback(
    (name: string, meaning: string): void => {
      const text = meaning.trim();
      if (!text) return;
      const pane = editorPaneRef.current;
      if (!pane) {
        view.showToast("编辑器还没就绪，先把光标放到正文里", "warning");
        return;
      }
      pane.insertText(`${name}：${text}`);
      // 寓意插入正文同样算「采纳」
      void logAiEvent({ intent: "naming", step: "adopt" });
    },
    [view],
  );

  /**
   * 行囊表格「插入本章末尾」（REQ-034）：跨窗口桥。
   *
   * 行囊已迁独立窗口（PackWindow），它把 Markdown 文本经
   * `pack-insert-into-chapter` 广播发过来，本窗口订阅后写入当前章末尾。
   * 广播会送达所有窗口，但只有本窗口注册了写入能力，其余窗口忽略。
   *
   * 不在这里调 flushSave：`appendText` 走的是 CodeMirror 的 dispatch，
   * 会经 updateListener → `setContent` → 编辑器自己的防抖保存落库。
   */
  useEffect(() => {
    const api = window.electronAPI?.windowAPI;
    if (!api) return undefined;
    const handler = (...args: unknown[]): void => {
      const text = args[0];
      if (typeof text !== "string" || !text) return;
      editorPaneRef.current?.appendText(text);
    };
    api.on("pack-insert-into-chapter", handler);
    return () => api.off("pack-insert-into-chapter", handler);
  }, []);

  // ── 行囊独立窗口（PackWindow）联动 ──────────────────────────────────────
  /**
   * 唤起行囊窗口（单实例；已开则聚焦）。上下文随打开请求携带。
   *
   * 零作品必须有守卫（P2-5）：空 workId 一路放行的话，主进程会播种
   * `work_id=''` 的垃圾角色行（下次打开还复用它），行囊窗口也只能显示
   * 一份空壳。这里给出明确提示，快捷键（Ctrl+Shift+B）与顶栏按钮都走本入口，
   * 一个口子拦全。
   */
  const openPackWindow = useCallback((): void => {
    if (!data.activeWorkId) {
      view.showToast("先创建一部作品，再打开行囊", "warning");
      return;
    }
    // 先给反馈再发 IPC：窗口装载期间屏幕上只有这颗按钮能动，
    // 没有它作者只会看到「点了没反应」（见 packOpening 的注释）
    setPackOpening(true);
    if (packOpeningTimerRef.current) clearTimeout(packOpeningTimerRef.current);
    packOpeningTimerRef.current = setTimeout(() => {
      packOpeningTimerRef.current = null;
      setPackOpening(false);
    }, PACK_OPENING_TIMEOUT_MS);
    window.electronAPI?.send("pack-window-open", {
      workId: data.activeWorkId,
      chapterId: data.activeChapterId ?? "",
      nonce: packNonce,
    });
  }, [data.activeWorkId, data.activeChapterId, packNonce, view]);

  /**
   * 唤起人物关系网络独立窗口（R27，单实例；已开则聚焦）。
   *
   * 零作品同样必须拦：图窗口没有 workId 只能显示空壳，后续写回还会落错书。
   * 与行囊窗口同一条守卫口径（一个口子拦全）。
   */
  const openRelationWindow = useCallback((): void => {
    if (!data.activeWorkId) {
      view.showToast("先创建一部作品，再打开人物关系网络", "warning");
      return;
    }
    window.electronAPI?.send("relation-window-open", {
      workId: data.activeWorkId,
    });
  }, [data.activeWorkId, view]);

  /**
   * 行囊窗口「真的可见」的回执（主进程 `notifyPackShown` → `pack-window-shown`）。
   *
   * 收到即复位 loading；同时清掉兜底定时器 —— 两者谁先到都行，
   * 但都必须保证不残留一个「8 秒后才复位」的幽灵定时器。
   */
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.receive) return undefined;
    const unsubscribe = api.receive("pack-window-shown", () => {
      if (packOpeningTimerRef.current) {
        clearTimeout(packOpeningTimerRef.current);
        packOpeningTimerRef.current = null;
      }
      setPackOpening(false);
    });
    return () => {
      unsubscribe();
      if (packOpeningTimerRef.current) {
        clearTimeout(packOpeningTimerRef.current);
        packOpeningTimerRef.current = null;
      }
    };
  }, []);

  /**
   * 行囊窗口主动跟进：作品 / 章节变化（含编辑器首挂载）即广播新上下文。
   * PackWindow 收到后 flush 旧作品草稿（重挂载兜底）并重新装载 bundle。
   * 签名去重：同一上下文不重复广播，避免数据 hook 的中间态抖动连发。
   *
   * `nonce` 参与签名与依赖：重置后 workId / chapterId 可能都没变，只有它
   * 能区分「真的换了书」与「同一本书被清库重播了」。
   *
   * 空 workId 也广播（作品被删光）：行囊窗口据此退回占位态，而不是一直
   * 显示已删作品的旧文档；App 侧按空串不装载，不会触发建行。
   */
  const workContextRef = useRef("");
  useEffect(() => {
    const workId = data.activeWorkId;
    const chapterId = data.activeChapterId ?? "";
    const signature = `${workId}\u0000${chapterId}\u0000${packNonce}`;
    if (workContextRef.current === signature) return;
    workContextRef.current = signature;
    void window.electronAPI?.windowAPI?.broadcast("novel-work-changed", {
      workId,
      chapterId,
      nonce: packNonce,
    });
  }, [data.activeWorkId, data.activeChapterId, packNonce]);

  /** 把名字建为角色卡（type=character，名字带入；复用 markSelectionAsEntity 走查重 + 落库） */
  const handleCreateEntityFromName = useCallback(
    (name: string): void => {
      const trimmed = name.trim();
      if (!trimmed || !data.activeWorkId) return;
      const result = data.markSelectionAsEntity(trimmed, "character");
      if (!result) {
        view.showToast("建卡失败，请重试", "warning");
        return;
      }
      if (result.mode === "created") {
        view.showToast(`已创建角色「${result.entity.name}」`);
      } else if (result.mode === "linked") {
        view.showToast(`已关联为「${result.entity.name}」的别名`);
      } else {
        view.showToast(`「${result.entity.name}」已在设定库中`, "info");
      }
      // 起名 → 建角色卡同样算「采纳」（M1a）
      void logAiEvent({ intent: "naming", step: "adopt" });
    },
    [data, view],
  );

  /** 起名工具动作组（透传给 NameGeneratorPanel） */
  const namingActions = useMemo<NamingActions>(
    () => ({
      onInsertToEditor: handleInsertName,
      onInsertMeaning: handleInsertMeaning,
      onCreateCharacter: handleCreateEntityFromName,
      onAddFavorite: (name, kind, style, source) =>
        data.addNameFavorite(data.activeWorkId, name, kind, style, source),
      onRemoveFavorite: data.removeNameFavorite,
      // 「去设置」：面板不碰窗口层，由这里发跨窗口消息。用 sendTo 而不是
      // settings-window-open 是为了带 section —— 只把设置窗口拉到首页，
      // 用户还要自己再找「AI 配置」，等于把「去配置」的摩擦推后一步。
      // `create` + `queue`：窗口没开会先拉起、消息入队，preload 挂载后补投。
      onOpenAiSettings: () => {
        void window.electronAPI?.windowAPI.sendTo(
          "settings",
          "settings-section-jump",
          { section: "ai" },
          true,
          { create: true, queue: true },
        );
      },
    }),
    [handleInsertName, handleInsertMeaning, handleCreateEntityFromName, data],
  );

  /** 起名工具避开已用名：当前作品的要素 name + aliases 去重 */
  const namingExclude = useMemo(() => {
    const owned = data.entities.filter(
      (entity) => entity.workId === data.activeWorkId,
    );
    const set = new Set<string>();
    for (const entity of owned) {
      if (entity.name) set.add(entity.name);
      for (const alias of entity.aliases) {
        if (alias) set.add(alias);
      }
    }
    return Array.from(set);
  }, [data.entities, data.activeWorkId]);

  /** 当前作品收藏夹（按 createdAt 倒序，已由 useNovelData 排好） */
  const namingFavorites = useMemo(
    () => data.nameFavoritesOf(data.activeWorkId),
    [data],
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

  // Esc 关闭链：设置 → 快照 → 专注模式（逐层退出，章节跳转面板自己处理 Esc；
  // 行囊已是独立窗口，本窗口的 Esc 不再越界管它）
  const handleEscape = useCallback((): void => {
    // 设定中心是最上层浮层，先关它：否则 Esc 会穿透去关排版抽屉，
    // 作者以为关的是眼前这个大面板
    if (view.settingCenterOpen) {
      view.closeSettingCenter();
      return;
    }
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
    onTogglePack: openPackWindow,
    onOpenSettings: () => view.openSettingCenter(null),
    onEscape: handleEscape,
  });

  // 目标达成只提示一次：跨过目标线的那一刻给轻提示 + 进度条填满（设计方案 §07），
  // 并上报 usage_log（R14：goal_reach 是北极星指标的达成事件）。
  //
  // 这里用 store.subscribe 而不是 useMemo 订阅：今日字数每敲一个字都在变，
  // 若让页面根订阅它，打字又会把整棵树推一遍。subscribe 只跑副作用、不渲染。
  const goalNotifiedRef = useRef(false);
  const showToastRef = useRef(view.showToast);
  useEffect(() => {
    showToastRef.current = view.showToast;
  }, [view.showToast]);

  useEffect(() => {
    const check = (todayTotal: number, dailyGoal: number): void => {
      if (dailyGoal <= 0) return;
      if (todayTotal < dailyGoal) {
        goalNotifiedRef.current = false;
        return;
      }
      if (goalNotifiedRef.current) return;
      goalNotifiedRef.current = true;
      showToastRef.current(`今日目标达成 · ${formatThousands(dailyGoal)} 字`);
      void logUsageEvent("goal_reach", { goal: dailyGoal, words: todayTotal });
    };

    const unsubscribe = useNovelEditorStore.subscribe((state, previous) => {
      if (
        state.todayTotal === previous.todayTotal &&
        state.settings.dailyGoal === previous.settings.dailyGoal
      ) {
        return;
      }
      check(state.todayTotal, state.settings.dailyGoal);
    });
    return unsubscribe;
  }, []);

  // ── 跨窗口导航：行囊窗口 → 本窗口设定中心（UI-03） ──
  // 行囊窗口的空态引导「去设定中心创建等级体系」自己开不了设定中心（它不是
  // NovelWindow 的组件），靠这条频道把请求送过来。主进程已把本窗口拉到前面并
  // 转发负载，这里只负责落地：打开设定中心 + 定位到目标分类。
  //
  // 防串书：行囊窗口可能开着另一本书（多作品场景），负载带 workId，不是当前
  // 作品就忽略 —— 否则会把作者正在写的书拽到别的书的设定中心。
  //
  // 定位失败（分类被删 / 传了 null）回落默认态，不报错：导航失败不该把作者
  // 卡在错误上（见 open-setting-center.ts 的 categoryId 语义）。
  //
  // 依赖 openSettingCenter 这个 useCallback([]) 稳定引用，而非整个 view 对象
  // （view 是每渲染新建的字面量，会白订阅一遍）。
  const openSettingCenter = view.openSettingCenter;
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const req = parseOpenSettingCenterRequest(args);
      if (!req) return;
      if (req.workId && req.workId !== data.activeWorkId) return;
      openSettingCenter(req.categoryId);
    };
    return subscribeDualChannel(NOVEL_OPEN_SETTING_CENTER_CHANNEL, handler);
  }, [data.activeWorkId, openSettingCenter]);

  // 关窗前的最后一次 flush（PRD §2：关窗永不询问，数据由持久化兜底）；
  // 位置记忆同步落库，下次打开原位续写（R6）
  useEffect(() => {
    // failed 也要补一次：这是编辑者能拿到的最后一次落库机会，
    // 只判 pending 会让「上次保存失败的那段正文」在关窗时静默丢失
    const flush = () => {
      if (needsFlushSave()) void editorActions.flushSave();
      savePositionNow();
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [savePositionNow]);

  return {
    data,
    editor,
    view,
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
    handleSelectWork,
    openPackWindow,
    openRelationWindow,
    packOpening,
    handleRollback,
    handleMark,
    handleOpenEntity,
    handleRestoreRecovery,
    ctxMenu,
    handleEditorContextMenu,
    closeCtxMenu,
    handleCtxMark,
    handleCtxBind,
    handleCtxToPack,
    // AI 润色 / 文本变换（R-AI-03 / R-AI-06）
    polish,
    handleCtxPolish,
    handleCtxTransform,
    handlePolishConfirm,
    handlePolishClose,
    handlePolishRetry,
    runPolish,
    // AI 续写（R-AI-07 / B5 流式）
    continuation,
    runContinuation,
    handleContinuationConfirm,
    handleContinuationClose,
    handleContinuationRetry,
    handleContinuationStop: abortContinuation,
    // AI 章节摘要（R-AI-09）
    summary,
    summaryPending,
    /** 弹窗里的「将发送约 N 字」+ 范围提示：随授权范围实时重算，与实际发送同源 */
    summaryPendingScope,
    aiConsent,
    // AI 可用性门控（M8）：六个入口据此禁用并说明 / 走本地兜底
    aiAvailability,
    runChapterSummary,
    handleSummaryConsentConfirm,
    handleSummaryConsentCancel,
    handleSummaryClose,
    handleApplySummaryNote,
    handleNewVolume,
    handleSaveEntity,
    handleRenameVolume,
    handleDeleteVolume,
    handleAddRelation,
    handleRemoveRelation,
    handleCursorChange,
    handleScrollChange,
    handleCreateWork,
    handleRenameWork,
    handleSetWorkGenre,
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
    handleRecolorCustomType,
    handleRemoveCustomType,
    // 起名工具（R18 / 步骤三）
    editorPaneRef,
    namingActions,
    namingExclude,
    namingFavorites,
    namingBook: bookSnapshot,
    // 行囊主角绑定（右侧要素栏）
    protagonistEntityId,
    handleSetProtagonist,
  };
}
