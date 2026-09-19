import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchChapterSnapshots,
  fetchNovelBundle,
  saveChapterContent,
  searchAcrossBook,
  type NovelBundle,
} from "../services/novel-demo-source";
import { buildChapterGroups, padIndex, type ChapterGroup } from "../novel-utils";
import type {
  EntityRelationView,
  EntityType,
  NovelChapter,
  NovelEntity,
  NovelNote,
  NovelSnapshot,
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
    () => (bundle?.notes ?? []).filter((note) => note.workId === activeWorkId),
    [bundle, activeWorkId],
  );
  const outline = useMemo(() => bundle?.outline ?? [], [bundle]);
  const works = useMemo(() => bundle?.works ?? [], [bundle]);
  const recovery = useMemo(() => bundle?.recovery ?? null, [bundle]);

  const groups: ChapterGroup[] = useMemo(
    () => buildChapterGroups(volumes, chapters),
    [volumes, chapters],
  );

  const activeChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === activeChapterId) ?? null,
    [chapters, activeChapterId],
  );

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
      const targetVolumeId = volumeId ?? volumes[volumes.length - 1]?.id;
      if (!targetVolumeId || !bundle) return null;

      const siblings = bundle.chapters.filter(
        (chapter) => chapter.volumeId === targetVolumeId,
      );
      const id = `c-${Date.now()}`;
      const chapter: NovelChapter = {
        id,
        workId: activeWorkId,
        volumeId: targetVolumeId,
        title: `第${padIndex(siblings.length + 1)}章 · 未命名`,
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

  /** 同卷内上下移动，简洁实现：交换相邻两项的 sort */
  const moveChapter = useCallback(
    (chapterId: string, direction: "up" | "down") => {
      setBundle((current) => {
        if (!current) return current;
        const target = current.chapters.find((chapter) => chapter.id === chapterId);
        if (!target) return current;

        const siblings = current.chapters
          .filter((chapter) => chapter.volumeId === target.volumeId)
          .sort((a, b) => a.sort - b.sort);
        const index = siblings.findIndex((chapter) => chapter.id === chapterId);
        const swapIndex = direction === "up" ? index - 1 : index + 1;
        if (swapIndex < 0 || swapIndex >= siblings.length) return current;

        const order = new Map<string, number>();
        siblings.forEach((chapter, position) => order.set(chapter.id, position + 1));
        order.set(siblings[index].id, swapIndex + 1);
        order.set(siblings[swapIndex].id, index + 1);

        return {
          ...current,
          chapters: current.chapters.map((chapter) =>
            order.has(chapter.id)
              ? { ...chapter, sort: order.get(chapter.id) ?? chapter.sort }
              : chapter,
          ),
        };
      });
    },
    [],
  );

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
      };
      setBundle((current) =>
        current ? { ...current, notes: [note, ...current.notes] } : current,
      );
    },
    [activeWorkId],
  );

  const removeNote = useCallback((noteId: string): void => {
    setBundle((current) =>
      current
        ? {
            ...current,
            notes: current.notes.filter((note) => note.id !== noteId),
          }
        : current,
    );
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
    outline,
    groups,
    activeChapter,
    activeChapterId,
    activeWorkId,
    recovery,
    snapshots,
    loading,
    setActiveWorkId,
    selectChapter,
    updateChapterContent,
    createChapter,
    moveChapter,
    toggleChapterStatus,
    markSelectionAsEntity,
    getEntityById,
    getEntityRelations,
    addNote,
    removeNote,
    loadSnapshots,
    rollbackSnapshot,
    searchBook,
    reload: load,
  };
}
