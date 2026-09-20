import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchChapterSnapshots,
  fetchNovelBundle,
  removeNote as removeNoteRemote,
  removeOutlineEntry as removeOutlineEntryRemote,
  saveChapterContent,
  saveChapterOutline,
  saveNote as saveNoteRemote,
  saveOutlineEntry,
  searchAcrossBook,
  type NovelBundle,
} from "../services/novel-demo-source";
import { UNNAMED_VOLUME } from "../novel-config";
import {
  buildChapterGroups,
  buildChapterNumbers,
  patchChapterOutlineNote,
  patchNote,
  patchOutlineEntry,
  previewChapterReorder,
  previewChapterToVolume,
  previewVolumeReorder,
  sortNotes,
  type ChapterGroup,
} from "../novel-utils";
import type {
  EntityRelationView,
  EntityType,
  ForeshadowPatch,
  NotePatch,
  NovelChapter,
  NovelEntity,
  NovelLink,
  NovelNote,
  NovelSnapshot,
  NovelVolume,
  OutlineEntry,
  OutlineEntryDraft,
  SearchHit,
} from "../types";

/** 选区标记的结果：新建要素 / 关联为别名 / 已存在 */
export type MarkResult =
  | { entity: NovelEntity; mode: "created" | "linked" | "existing" };

/**
 * 小说编辑器数据层 Hook
 *
 * 负责：作品 / 卷 / 章节 / 要素 / 关联 / 灵感 / 大纲 / 快照的加载与 CRUD，
 * 以及由原始表派生的领域数据（卷章分组、要素关联视图）。
 * 不负责：输入草稿、弹窗开关、筛选折叠等视图状态（分别在另外两个 Hook）。
 */
export function useNovelData() {
  const [bundle, setBundle] = useState<NovelBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeWorkId, setActiveWorkId] = useState("");
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<NovelSnapshot[]>([]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const next = await fetchNovelBundle();
      setBundle(next);
      setActiveWorkId((current) => current || next.works[0]?.id || "");
      setActiveChapterId((current) => current ?? next.chapters[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allEntities = useMemo(() => bundle?.entities ?? [], [bundle]);
  const entities = useMemo(
    () => allEntities.filter((entity) => entity.workId === activeWorkId),
    [allEntities, activeWorkId],
  );
  const links = useMemo(() => bundle?.links ?? [], [bundle]);
  const levelSystems = useMemo(
    () => (bundle?.levelSystems ?? []).filter((item) => item.workId === activeWorkId),
    [bundle, activeWorkId],
  );
  const volumes = useMemo(
    () => (bundle?.volumes ?? []).filter((volume) => volume.workId === activeWorkId),
    [bundle, activeWorkId],
  );
  const chapters = useMemo(
    () => (bundle?.chapters ?? []).filter((chapter) => chapter.workId === activeWorkId),
    [bundle, activeWorkId],
  );
  const notes = useMemo(
    () => sortNotes((bundle?.notes ?? []).filter((note) => note.workId === activeWorkId)),
    [bundle, activeWorkId],
  );
  const outlineEntries = useMemo(
    () =>
      (bundle?.outlineEntries ?? []).filter(
        (entry) => entry.workId === activeWorkId,
      ),
    [bundle, activeWorkId],
  );
  const works = useMemo(() => bundle?.works ?? [], [bundle]);
  const recovery = useMemo(() => bundle?.recovery ?? null, [bundle]);

  const groups: ChapterGroup[] = useMemo(
    () => buildChapterGroups(volumes, chapters),
    [volumes, chapters],
  );

  /** 全书章节序号（拖拽重排后自动跟随的派生属性） */
  const chapterNumbers = useMemo(
    () => buildChapterNumbers(volumes, chapters),
    [volumes, chapters],
  );

  const activeChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === activeChapterId) ?? null,
    [chapters, activeChapterId],
  );

  // 切换作品后旧的章节 id 不属于当前作品：重置到该作品的第一章，
  // 否则编辑器停在空态、且 handleNewChapter 拿不到 volumeId 兜底
  useEffect(() => {
    if (
      activeChapterId &&
      chapters.length > 0 &&
      !chapters.some((chapter) => chapter.id === activeChapterId)
    ) {
      setActiveChapterId(chapters[0].id);
    }
  }, [activeChapterId, chapters]);

  const selectChapter = useCallback((chapterId: string) => {
    setActiveChapterId(chapterId);
  }, []);

  /** 保存正文并同步本地字数 / 更新时间（真数据落库时这里走 novel-chapter-save） */
  const updateChapterContent = useCallback(
    async (chapterId: string, content: string, wordCount: number): Promise<boolean> => {
      setBundle((current) =>
        current
          ? {
              ...current,
              chapters: current.chapters.map((chapter) =>
                chapter.id === chapterId
                  ? { ...chapter, content, wordCount, updatedAt: Date.now() }
                  : chapter,
              ),
            }
          : current,
      );
      return saveChapterContent(chapterId, content);
    },
    [],
  );

  const createChapter = useCallback(
    (volumeId?: string): string | null => {
      if (!bundle) return null;
      let targetVolumeId = volumeId ?? volumes[volumes.length - 1]?.id ?? null;

      // 目标作品还没有任何卷（全新作品 / 空作品）：自动创建第一卷，
      // 保证「写下第一章」永远可用（PRD R1：零配置开写）
      if (!targetVolumeId) {
        const createdVolume: NovelVolume = {
          id: `v-${Date.now()}`,
          workId: activeWorkId,
          // 序号由 sort 派生，存储名保持「未命名卷」，避免卷头出现「第一卷 · 第一卷」
          name: UNNAMED_VOLUME,
          sort: 1,
        };
        targetVolumeId = createdVolume.id;
        setBundle((current) =>
          current
            ? { ...current, volumes: [...current.volumes, createdVolume] }
            : current,
        );
      }

      const siblings = bundle.chapters.filter(
        (chapter) => chapter.volumeId === targetVolumeId,
      );
      const id = `c-${Date.now()}`;
      const chapter: NovelChapter = {
        id,
        workId: activeWorkId,
        volumeId: targetVolumeId,
        // 序号是排序的派生属性（见 chapterNumbers），标题只存章节名
        title: "未命名",
        content: "",
        wordCount: 0,
        status: "draft",
        sort: siblings.length + 1,
        updatedAt: Date.now(),
      };

      setBundle((current) =>
        current ? { ...current, chapters: [...current.chapters, chapter] } : current,
      );
      setActiveChapterId(id);
      return id;
    },
    [bundle, volumes, activeWorkId],
  );

  /** 新建卷（左栏底部入口）：排序追加到当前作品末尾 */
  const createVolume = useCallback((): string | null => {
    if (!bundle) return null;
    const maxSort = volumes.reduce((max, volume) => Math.max(max, volume.sort), 0);
    const volume: NovelVolume = {
      id: `v-${Date.now()}`,
      workId: activeWorkId,
      // 卷头展示由 sort 派生（第N卷 / 第N部…），存储名仅作兜底
      name: UNNAMED_VOLUME,
      sort: maxSort + 1,
    };
    setBundle((current) =>
      current ? { ...current, volumes: [...current.volumes, volume] } : current,
    );
    return volume.id;
  }, [bundle, volumes, activeWorkId]);

  /**
   * 拖拽重排（R9）：把 fromId 章节拖到 toId 章节的位置。
   * 同卷 = 卷内重排；跨卷 = 移入目标卷并落到目标章节的位置。
   * 排序计算在 previewChapterReorder 纯函数中，与确认弹框的预览共用一套逻辑。
   */
  const reorderChapters = useCallback((fromId: string, toId: string) => {
    setBundle((current) => {
      if (!current) return current;
      const nextChapters = previewChapterReorder(current.chapters, fromId, toId);
      if (nextChapters === current.chapters) return current;
      return { ...current, chapters: nextChapters };
    });
  }, []);

  /** 拖拽章节到卷头：移入该卷并排到末尾 */
  const moveChapterToVolume = useCallback((chapterId: string, volumeId: string) => {
    setBundle((current) => {
      if (!current) return current;
      const nextChapters = previewChapterToVolume(current.chapters, chapterId, volumeId);
      if (nextChapters === current.chapters) return current;
      return { ...current, chapters: nextChapters };
    });
  }, []);

  /** 拖拽卷头重排卷顺序 */
  const reorderVolumes = useCallback(
    (fromId: string, toId: string) => {
      setBundle((current) => {
        if (!current) return current;
        const scoped = current.volumes.filter(
          (volume) => volume.workId === activeWorkId,
        );
        const ordered = previewVolumeReorder(scoped, fromId, toId);
        if (ordered === scoped) return current;
        const order = new Map(ordered.map((volume) => [volume.id, volume.sort]));
        return {
          ...current,
          volumes: current.volumes.map((volume) =>
            order.has(volume.id)
              ? { ...volume, sort: order.get(volume.id) ?? volume.sort }
              : volume,
          ),
        };
      });
    },
    [activeWorkId],
  );

  /** 章节重命名（R1）：空标题与同名不落 */
  const renameChapter = useCallback((chapterId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBundle((current) =>
      current
        ? {
            ...current,
            chapters: current.chapters.map((chapter) =>
              chapter.id === chapterId
                ? { ...chapter, title: trimmed, updatedAt: Date.now() }
                : chapter,
            ),
          }
        : current,
    );
  }, []);

  /** 卷命名（R9 扩展）：卷头展示为「第N卷 - 名字」，序号仍由 sort 派生 */
  const renameVolume = useCallback((volumeId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBundle((current) =>
      current
        ? {
            ...current,
            volumes: current.volumes.map((volume) =>
              volume.id === volumeId ? { ...volume, name: trimmed } : volume,
            ),
          }
        : current,
    );
  }, []);

  const toggleChapterStatus = useCallback((chapterId: string) => {
    setBundle((current) =>
      current
        ? {
            ...current,
            chapters: current.chapters.map((chapter) =>
              chapter.id === chapterId
                ? {
                    ...chapter,
                    status: chapter.status === "done" ? "draft" : "done",
                  }
                : chapter,
            ),
          }
        : current,
    );
  }, []);

  /** 选区 → 要素：无卡秒建、有卡关联别名（PRD R20 ③） */
  const markSelectionAsEntity = useCallback(
    (text: string, type: EntityType): MarkResult | null => {
      const name = text.trim();
      if (!name || !bundle) return null;

      const existed = bundle.entities.find(
        (entity) =>
          entity.workId === activeWorkId &&
          (entity.name === name || entity.aliases.includes(name)),
      );

      if (existed) {
        if (existed.name === name) return { entity: existed, mode: "existing" };
        const linked: NovelEntity = {
          ...existed,
          aliases: [...existed.aliases, name],
        };
        setBundle((current) =>
          current
            ? {
                ...current,
                entities: current.entities.map((entity) =>
                  entity.id === existed.id ? linked : entity,
                ),
              }
            : current,
        );
        return { entity: linked, mode: "linked" };
      }

      const created: NovelEntity = {
        id: `e-${Date.now()}`,
        workId: activeWorkId,
        type,
        name,
        aliases: [],
        summary: "",
        content: "",
        fields: {},
        sort: bundle.entities.length + 1,
      };
      setBundle((current) =>
        current
          ? { ...current, entities: [...current.entities, created] }
          : current,
      );
      return { entity: created, mode: "created" };
    },
    [bundle, activeWorkId],
  );

  const getEntityById = useCallback(
    (entityId: string): NovelEntity | null =>
      entities.find((entity) => entity.id === entityId) ?? null,
    [entities],
  );

  /** 资料卡编辑（R23）：合并保存名称 / 类型 / 别名 / 简介等字段 */
  const updateEntity = useCallback(
    (entityId: string, patch: Partial<Omit<NovelEntity, "id" | "workId">>): void => {
      setBundle((current) =>
        current
          ? {
              ...current,
              entities: current.entities.map((entity) =>
                entity.id === entityId ? { ...entity, ...patch } : entity,
              ),
            }
          : current,
      );
    },
    [],
  );

  /** 手动绑定（R20 ③右键菜单版）：把选中文本绑定到指定资料卡（关联为别名） */
  const bindTextToEntity = useCallback(
    (text: string, entityId: string): MarkResult | null => {
      const name = text.trim();
      const target = bundle?.entities.find((entity) => entity.id === entityId);
      if (!name || !target) return null;

      if (target.name === name || target.aliases.includes(name)) {
        return { entity: target, mode: "existing" };
      }
      const linked: NovelEntity = {
        ...target,
        aliases: [...target.aliases, name],
      };
      setBundle((current) =>
        current
          ? {
              ...current,
              entities: current.entities.map((entity) =>
                entity.id === entityId ? linked : entity,
              ),
            }
          : current,
      );
      return { entity: linked, mode: "linked" };
    },
    [bundle],
  );

  /**
   * 添加要素关联（R24）：人物关系等任意两要素互相关联。
   * 同对要素 + 同关系名不重复建；NovelLink 多态表天然支撑后期关系网络图。
   */
  const addLink = useCallback(
    (
      fromId: string,
      fromType: EntityType,
      toId: string,
      toType: EntityType,
      relation: string,
    ): boolean => {
      if (!bundle) return false;
      const trimmed = relation.trim() || "相关";
      const duplicated = bundle.links.some(
        (link) =>
          ((link.fromId === fromId && link.toId === toId) ||
            (link.fromId === toId && link.toId === fromId)) &&
          link.relation === trimmed,
      );
      if (duplicated) return false;
      const link: NovelLink = {
        id: `l-${Date.now()}`,
        fromType,
        fromId,
        toType,
        toId,
        relation: trimmed,
      };
      setBundle((current) =>
        current ? { ...current, links: [link, ...current.links] } : current,
      );
      return true;
    },
    [bundle],
  );

  /** 解除要素关联 */
  const removeLink = useCallback((linkId: string): void => {
    setBundle((current) =>
      current
        ? {
            ...current,
            links: current.links.filter((link) => link.id !== linkId),
          }
        : current,
    );
  }, []);

  /** 要素关联的双向视图（PRD R24） */
  const getEntityRelations = useCallback(
    (entityId: string, entityType: EntityType): EntityRelationView[] => {
      const nameOf = (id: string): { name: string; type: EntityType } => {
        const target = entities.find((entity) => entity.id === id);
        return {
          name: target?.name ?? "未知要素",
          type: target?.type ?? "custom",
        };
      };

      return links
        .filter(
          (link) =>
            (link.fromId === entityId && link.fromType === entityType) ||
            (link.toId === entityId && link.toType === entityType),
        )
        .map<EntityRelationView>((link) => {
          const outgoing = link.fromId === entityId;
          const targetId = outgoing ? link.toId : link.fromId;
          const target = nameOf(targetId);
          return {
            id: link.id,
            direction: outgoing ? "out" : "in",
            targetId,
            targetName: target.name,
            targetType: target.type,
            relation: link.relation,
            note: link.note,
          };
        });
    },
    [entities, links],
  );

  const addNote = useCallback(
    (content: string): void => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const note: NovelNote = {
        id: `n-${Date.now()}`,
        workId: activeWorkId,
        content: trimmed,
        createdAt: Date.now(),
        pinned: false,
      };
      setBundle((current) =>
        current ? { ...current, notes: [note, ...current.notes] } : current,
      );
      void saveNoteRemote(note);
    },
    [activeWorkId],
  );

  /**
   * 灵感局部更新（R7）：正文 / 置顶 / 已转伏笔标记。
   * 空正文与不存在的 id 由 patchNote 直接返回原引用，这里不做二次校验。
   */
  const updateNote = useCallback((noteId: string, patch: NotePatch): void => {
    setBundle((current) => {
      if (!current) return current;
      const next = patchNote(current.notes, noteId, patch);
      if (next === current.notes) return current;
      const target = next.find((note) => note.id === noteId);
      if (target) void saveNoteRemote(target);
      return { ...current, notes: next };
    });
  }, []);

  const removeNote = useCallback((noteId: string): void => {
    setBundle((current) =>
      current
        ? {
            ...current,
            notes: current.notes.filter((note) => note.id !== noteId),
          }
        : current,
    );
    void removeNoteRemote(noteId);
  }, []);

  /** 章节一句话梗概（大纲板行内编辑，空串即清除） */
  const updateChapterOutlineNote = useCallback(
    (chapterId: string, note: string): void => {
      setBundle((current) => {
        if (!current) return current;
        const next = patchChapterOutlineNote(current.chapters, chapterId, note);
        if (next === current.chapters) return current;
        void saveChapterOutline(chapterId, note.trim());
        return { ...current, chapters: next };
      });
    },
    [],
  );

  /**
   * 新建伏笔条目（R7 大纲板 / 灵感一键转化共用入口）。
   * 新条目插到列表头部，返回创建结果供调用方回填「已转为伏笔」标记。
   */
  const addOutlineEntry = useCallback(
    (draft: OutlineEntryDraft): OutlineEntry | null => {
      const title = draft.title.trim();
      if (!title) return null;
      const entry: OutlineEntry = {
        ...draft,
        title,
        note: draft.note.trim(),
        id: `f-${Date.now()}`,
        createdAt: Date.now(),
      };
      setBundle((current) =>
        current
          ? { ...current, outlineEntries: [entry, ...current.outlineEntries] }
          : current,
      );
      void saveOutlineEntry(entry);
      return entry;
    },
    [],
  );

  /** 伏笔编辑（标题 / 说明） */
  const updateOutlineEntry = useCallback(
    (entryId: string, patch: ForeshadowPatch): void => {
      setBundle((current) => {
        if (!current) return current;
        const next = patchOutlineEntry(current.outlineEntries, entryId, patch);
        if (next === current.outlineEntries) return current;
        const target = next.find((entry) => entry.id === entryId);
        if (target) void saveOutlineEntry(target);
        return { ...current, outlineEntries: next };
      });
    },
    [],
  );

  /** 伏笔回收状态切换（待回收 ⇄ 已回收） */
  const toggleOutlineEntryStatus = useCallback((entryId: string): void => {
    setBundle((current) => {
      if (!current) return current;
      const target = current.outlineEntries.find((entry) => entry.id === entryId);
      if (!target) return current;
      const next: OutlineEntry = {
        ...target,
        status: target.status === "resolved" ? "open" : "resolved",
      };
      void saveOutlineEntry(next);
      return {
        ...current,
        outlineEntries: current.outlineEntries.map((entry) =>
          entry.id === entryId ? next : entry,
        ),
      };
    });
  }, []);

  const removeOutlineEntry = useCallback((entryId: string): void => {
    setBundle((current) =>
      current
        ? {
            ...current,
            outlineEntries: current.outlineEntries.filter(
              (entry) => entry.id !== entryId,
            ),
          }
        : current,
    );
    void removeOutlineEntryRemote(entryId);
  }, []);

  const loadSnapshots = useCallback(async (chapterId: string): Promise<void> => {
    const list = await fetchChapterSnapshots(chapterId);
    setSnapshots(list);
  }, []);

  /** 回滚：返回该快照的正文，由上层灌入编辑器（PRD R3） */
  const rollbackSnapshot = useCallback(
    async (snapshotId: string): Promise<string | null> => {
      const target = snapshots.find((snapshot) => snapshot.id === snapshotId);
      return target?.content ?? null;
    },
    [snapshots],
  );

  const searchBook = useCallback(
    async (keyword: string): Promise<SearchHit[]> =>
      searchAcrossBook(keyword, chapters),
    [chapters],
  );

  return {
    works,
    volumes,
    chapters,
    entities,
    links,
    levelSystems,
    notes,
    outlineEntries,
    groups,
    chapterNumbers,
    activeChapter,
    activeChapterId,
    activeWorkId,
    recovery,
    snapshots,
    loading,
    setActiveWorkId,
    selectChapter,
    updateChapterContent,
    updateChapterOutlineNote,
    createChapter,
    createVolume,
    renameChapter,
    renameVolume,
    reorderChapters,
    moveChapterToVolume,
    reorderVolumes,
    toggleChapterStatus,
    markSelectionAsEntity,
    updateEntity,
    bindTextToEntity,
    addLink,
    removeLink,
    getEntityById,
    getEntityRelations,
    addNote,
    updateNote,
    removeNote,
    addOutlineEntry,
    updateOutlineEntry,
    toggleOutlineEntryStatus,
    removeOutlineEntry,
    loadSnapshots,
    rollbackSnapshot,
    searchBook,
    reload: load,
  };
}
