import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addChapter as addChapterRemote,
  addLevel as addLevelRemote,
  addLevelSystem as addLevelSystemRemote,
  addLink as addLinkRemote,
  addVolume as addVolumeRemote,
  addWork as addWorkRemote,
  createNovelId,
  fetchChapterSnapshots,
  fetchLastPosition,
  fetchNovelBundle,
  removeLevel as removeLevelRemote,
  removeLevelSystem as removeLevelSystemRemote,
  removeLink as removeLinkRemote,
  removeNote as removeNoteRemote,
  removeOutlineEntry as removeOutlineEntryRemote,
  removeWork as removeWorkRemote,
  removeChapter as removeChapterRemote,
  renameChapter as renameChapterRemote,
  renameLevel as renameLevelRemote,
  renameLevelSystem as renameLevelSystemRemote,
  renameVolume as renameVolumeRemote,
  renameWork as renameWorkRemote,
  resetTemplateBook,
  saveChapterContent,
  saveChapterOrder,
  saveChapterOutline,
  saveEntity,
  saveLevelOrder,
  saveNote as saveNoteRemote,
  saveOutlineEntry,
  saveVolumeOrder,
  searchAcrossBook,
  setChapterStatus,
} from "../services/novel-service";
import { LEVEL_RELATION, UNNAMED_VOLUME } from "../novel-config";
import {
  buildChapterGroups,
  buildChapterNumbers,
  patchChapterOutlineNote,
  patchNote,
  patchOutlineEntry,
  parseJsonOrNull,
  previewChapterReorder,
  previewChapterToVolume,
  previewVolumeReorder,
  sanitizeRestorePosition,
  sortNotes,
  type ChapterGroup,
  type RestorePosition,
} from "../novel-utils";
import type {
  EntityRelationView,
  EntityType,
  ForeshadowPatch,
  LevelRung,
  LevelSystem,
  NotePatch,
  NovelBundle,
  NovelChapter,
  NovelEntity,
  NovelLink,
  NovelNote,
  NovelSnapshot,
  NovelVolume,
  NovelWork,
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
 * 全部写操作先做乐观本地更新，再异步落库（novel_* 表，userDb）；
 * 不负责：输入草稿、弹窗开关、筛选折叠等视图状态（分别在另外两个 Hook）。
 */
export function useNovelData() {
  const [bundle, setBundle] = useState<NovelBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeWorkId, setActiveWorkId] = useState("");
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<NovelSnapshot[]>([]);
  /** 上次续写位置（R6）：仅启动恢复用，消费一次后清空 */
  const [lastPosition, setLastPosition] = useState<RestorePosition | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const next = await fetchNovelBundle();
      const saved = sanitizeRestorePosition(
        parseJsonOrNull(await fetchLastPosition()),
        next.works,
        next.chapters,
      );
      setBundle(next);
      setActiveWorkId(
        (current) => current || saved?.workId || next.works[0]?.id || "",
      );
      if (saved) {
        setActiveChapterId((current) => current ?? saved.chapterId);
        setLastPosition(saved);
      } else {
        setActiveChapterId((current) => current ?? next.chapters[0]?.id ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 光标 / 滚动恢复完成后由编辑器回调清空，避免切章时误用旧位置 */
  const consumeLastPosition = useCallback((): void => setLastPosition(null), []);

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
  /** 等级项索引（R25）：关联视图与当前境界绑定把 novel_levels.id 翻译成可读名 */
  const levelRungIndex = useMemo(() => {
    const index = new Map<string, { name: string; systemName: string }>();
    for (const system of bundle?.levelSystems ?? []) {
      for (const rung of system.rungs) {
        index.set(rung.id, { name: rung.name, systemName: system.name });
      }
    }
    return index;
  }, [bundle?.levelSystems]);
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

  /** 保存正文并同步本地字数 / 更新时间（novel-chapter-save，主进程同事务写快照） */
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
      return saveChapterContent(chapterId, content, wordCount);
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
          id: createNovelId("v"),
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
        void addVolumeRemote(createdVolume);
      }

      const siblings = bundle.chapters.filter(
        (chapter) => chapter.volumeId === targetVolumeId,
      );
      const id = createNovelId("c");
      const chapter: NovelChapter = {
        id,
        workId: activeWorkId,
        volumeId: targetVolumeId,
        // 序号是排序的派生属性（见 chapterNumbers），标题只存章节名
        title: "未命名",
        content: "",
        wordCount: 0,
        status: "draft",
        // 取卷内最大 sort + 1：删除过章节后 length+1 会撞号
        sort:
          siblings.reduce((max, chapter) => Math.max(max, chapter.sort), 0) + 1,
        updatedAt: Date.now(),
      };

      setBundle((current) =>
        current ? { ...current, chapters: [...current.chapters, chapter] } : current,
      );
      setActiveChapterId(id);
      void addChapterRemote(chapter);
      return id;
    },
    [bundle, volumes, activeWorkId],
  );

  /** 新建卷（左栏底部入口）：排序追加到当前作品末尾 */
  const createVolume = useCallback((): string | null => {
    if (!bundle) return null;
    const maxSort = volumes.reduce((max, volume) => Math.max(max, volume.sort), 0);
    const volume: NovelVolume = {
      id: createNovelId("v"),
      workId: activeWorkId,
      // 卷头展示由 sort 派生（第N卷 / 第N部…），存储名仅作兜底
      name: UNNAMED_VOLUME,
      sort: maxSort + 1,
    };
    setBundle((current) =>
      current ? { ...current, volumes: [...current.volumes, volume] } : current,
    );
    void addVolumeRemote(volume);
    return volume.id;
  }, [bundle, volumes, activeWorkId]);

  /**
   * 拖拽重排（R9）：把 fromId 章节拖到 toId 章节的位置。
   * 同卷 = 卷内重排；跨卷 = 移入目标卷并落到目标章节的位置。
   * 排序计算在 previewChapterReorder 纯函数中，与确认弹框的预览共用一套逻辑；
   * 应用后把受影响章节的 {sort, volumeId} 批量落库。
   */
  const reorderChapters = useCallback(
    (fromId: string, toId: string) => {
      if (!bundle) return;
      const nextChapters = previewChapterReorder(bundle.chapters, fromId, toId);
      if (nextChapters === bundle.chapters) return;
      setBundle({ ...bundle, chapters: nextChapters });
      void saveChapterOrder(
        nextChapters.map((chapter) => ({
          id: chapter.id,
          sort: chapter.sort,
          volumeId: chapter.volumeId,
        })),
      );
    },
    [bundle],
  );

  /** 拖拽章节到卷头：移入该卷并排到末尾 */
  const moveChapterToVolume = useCallback(
    (chapterId: string, volumeId: string) => {
      if (!bundle) return;
      const nextChapters = previewChapterToVolume(bundle.chapters, chapterId, volumeId);
      if (nextChapters === bundle.chapters) return;
      setBundle({ ...bundle, chapters: nextChapters });
      void saveChapterOrder(
        nextChapters.map((chapter) => ({
          id: chapter.id,
          sort: chapter.sort,
          volumeId: chapter.volumeId,
        })),
      );
    },
    [bundle],
  );

  /** 拖拽卷头重排卷顺序 */
  const reorderVolumes = useCallback(
    (fromId: string, toId: string) => {
      if (!bundle) return;
      const scoped = bundle.volumes.filter(
        (volume) => volume.workId === activeWorkId,
      );
      const ordered = previewVolumeReorder(scoped, fromId, toId);
      if (ordered === scoped) return;
      const order = new Map(ordered.map((volume) => [volume.id, volume.sort]));
      const nextVolumes = bundle.volumes.map((volume) =>
        order.has(volume.id)
          ? { ...volume, sort: order.get(volume.id) ?? volume.sort }
          : volume,
      );
      setBundle({ ...bundle, volumes: nextVolumes });
      void saveVolumeOrder(
        ordered.map((volume) => ({ id: volume.id, sort: volume.sort })),
      );
    },
    [bundle, activeWorkId],
  );

  /** 章节重命名（R1）：空标题与同名不落 */
  const renameChapter = useCallback(
    (chapterId: string, title: string) => {
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
      void renameChapterRemote(chapterId, trimmed);
    },
    [],
  );

  /** 卷命名（R9 扩展）：卷头展示为「第N卷 - 名字」，序号仍由 sort 派生 */
  const renameVolume = useCallback(
    (volumeId: string, name: string) => {
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
      void renameVolumeRemote(volumeId, trimmed);
    },
    [],
  );

  // ── 作品管理（R29） ────────────────────────────────────────────────

  /** 新建作品：本地先建并切为当前作品（空作品由「写下第一章」兜底），异步落库 */
  const createWork = useCallback(
    (name: string): NovelWork | null => {
      const trimmed = name.trim();
      if (!trimmed || !bundle) return null;
      const work: NovelWork = {
        id: createNovelId("w"),
        name: trimmed,
        createdAt: Date.now(),
      };
      setBundle((current) =>
        current ? { ...current, works: [...current.works, work] } : current,
      );
      setActiveWorkId(work.id);
      setActiveChapterId(null);
      void addWorkRemote(work);
      return work;
    },
    [bundle],
  );

  /** 作品重命名：空名不落 */
  const renameWork = useCallback((workId: string, name: string): boolean => {
    const trimmed = name.trim();
    if (!trimmed || !workId) return false;
    setBundle((current) =>
      current
        ? {
            ...current,
            works: current.works.map((work) =>
              work.id === workId ? { ...work, name: trimmed } : work,
            ),
          }
        : current,
    );
    void renameWorkRemote(workId, trimmed);
    return true;
  }, []);

  /**
   * 删除作品（R29）：本地级联摘除 + 远端事务级联删除。
   * 删的是当前作品 → 切到剩余第一部；全部删完 → 重新装载（主进程重新播种默认作品）。
   */
  const deleteWork = useCallback(
    (workId: string): void => {
      if (!bundle) return;
      const remaining = bundle.works.filter((work) => work.id !== workId);
      const entityIds = new Set(
        bundle.entities
          .filter((entity) => entity.workId === workId)
          .map((entity) => entity.id),
      );
      setBundle((current) =>
        current
          ? {
              ...current,
              works: current.works.filter((work) => work.id !== workId),
              volumes: current.volumes.filter((volume) => volume.workId !== workId),
              chapters: current.chapters.filter((chapter) => chapter.workId !== workId),
              entities: current.entities.filter((entity) => entity.workId !== workId),
              links: current.links.filter(
                (link) => !entityIds.has(link.fromId) && !entityIds.has(link.toId),
              ),
              levelSystems: current.levelSystems.filter(
                (system) => system.workId !== workId,
              ),
              notes: current.notes.filter((note) => note.workId !== workId),
              outlineEntries: current.outlineEntries.filter(
                (entry) => entry.workId !== workId,
              ),
            }
          : current,
      );
      void removeWorkRemote(workId);

      if (remaining.length > 0) {
        if (activeWorkId === workId) {
          const nextWorkId = remaining[0].id;
          setActiveWorkId(nextWorkId);
          setActiveChapterId(
            bundle.chapters.find((chapter) => chapter.workId === nextWorkId)?.id ?? null,
          );
        }
        return;
      }

      // 最后一部也被删除：清掉活动态后重新装载，主进程会重新播种「未命名作品」
      setActiveWorkId("");
      setActiveChapterId(null);
      void load();
    },
    [bundle, activeWorkId, load],
  );

  /**
   * 一键重置为模板书籍（调试）：主进程清库重播种后全量重载。
   * 必须先清空活动作品 / 章节 id 再 load——load 只在 current 为空时才
   * 接受远端首选项，残留旧 id 会让编辑器停在已不存在的作品上。
   * 返回重置摘要（卷 / 章 / 字数 / 要素数），主进程失败时返回 null。
   */
  const resetTemplate = useCallback(async (): Promise<{
    volumes: number;
    chapters: number;
    words: number;
    entities: number;
  } | null> => {
    let summary: Awaited<ReturnType<typeof resetTemplateBook>>;
    try {
      summary = await resetTemplateBook();
    } catch {
      return null;
    }
    setActiveWorkId("");
    setActiveChapterId(null);
    setLastPosition(null);
    await load();
    return summary;
  }, [load]);

  /** 章节状态切换（草稿 ⇄ 完稿） */
  const toggleChapterStatus = useCallback(
    (chapterId: string) => {
      const target = chapters.find((chapter) => chapter.id === chapterId);
      if (!target) return;
      const nextStatus = target.status === "done" ? "draft" : "done";
      setBundle((current) =>
        current
          ? {
              ...current,
              chapters: current.chapters.map((chapter) =>
                chapter.id === chapterId ? { ...chapter, status: nextStatus } : chapter,
              ),
            }
          : current,
      );
      void setChapterStatus(chapterId, nextStatus);
    },
    [chapters],
  );

  /**
   * 删除章节：本地摘除 + 远端同事务清理快照。
   * 删的是当前章节 → 按展示顺序自动切到后一个，没有后一个切前一个；
   * 快照由主进程随章节一并删除，本地草稿残留无害（同 id 不会复用）。
   */
  const deleteChapter = useCallback(
    (chapterId: string): void => {
      if (!bundle) return;
      const ordered = groups.flatMap((group) => group.chapters);
      const index = ordered.findIndex((chapter) => chapter.id === chapterId);
      if (index < 0) return;
      const wasActive = activeChapterId === chapterId;
      setBundle((current) =>
        current
          ? {
              ...current,
              chapters: current.chapters.filter((chapter) => chapter.id !== chapterId),
            }
          : current,
      );
      if (wasActive) {
        setActiveChapterId(
          (ordered[index + 1] ?? ordered[index - 1])?.id ?? null,
        );
      }
      void removeChapterRemote(chapterId);
    },
    [bundle, groups, activeChapterId],
  );

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
        void saveEntity(linked);
        return { entity: linked, mode: "linked" };
      }

      const created: NovelEntity = {
        id: createNovelId("e"),
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
      void saveEntity(created);
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
      const target = entities.find((entity) => entity.id === entityId);
      if (!target) return;
      const merged: NovelEntity = { ...target, ...patch };
      setBundle((current) =>
        current
          ? {
              ...current,
              entities: current.entities.map((entity) =>
                entity.id === entityId ? merged : entity,
              ),
            }
          : current,
      );
      void saveEntity(merged);
    },
    [entities],
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
      void saveEntity(linked);
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
        id: createNovelId("l"),
        fromType,
        fromId,
        toType,
        toId,
        relation: trimmed,
      };
      setBundle((current) =>
        current ? { ...current, links: [link, ...current.links] } : current,
      );
      void addLinkRemote(link);
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
    void removeLinkRemote(linkId);
  }, []);

  // ── 等级体系管理（R25）：体系 / 等级项 CRUD + 当前境界绑定 ──────────

  /** 新建体系：本地先建空体系并乐观落库，返回 null 表示名称非法 */
  const createLevelSystem = useCallback(
    (name: string): LevelSystem | null => {
      const trimmed = name.trim();
      if (!trimmed || !bundle) return null;
      const system: LevelSystem = {
        id: createNovelId("ls"),
        workId: activeWorkId,
        name: trimmed,
        rungs: [],
      };
      setBundle((current) =>
        current
          ? { ...current, levelSystems: [...current.levelSystems, system] }
          : current,
      );
      void addLevelSystemRemote({
        id: system.id,
        workId: system.workId,
        name: system.name,
      });
      return system;
    },
    [bundle, activeWorkId],
  );

  /** 体系重命名：空名不落 */
  const renameLevelSystem = useCallback((systemId: string, name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBundle((current) =>
      current
        ? {
            ...current,
            levelSystems: current.levelSystems.map((system) =>
              system.id === systemId ? { ...system, name: trimmed } : system,
            ),
          }
        : current,
    );
    void renameLevelSystemRemote(systemId, trimmed);
  }, []);

  /** 删除体系：本地级联摘除该体系全部等级项的当前境界绑定（主进程同事务级联） */
  const deleteLevelSystem = useCallback(
    (systemId: string): void => {
      if (!bundle) return;
      const system = bundle.levelSystems.find((item) => item.id === systemId);
      if (!system) return;
      const rungIds = new Set(system.rungs.map((rung) => rung.id));
      setBundle((current) =>
        current
          ? {
              ...current,
              levelSystems: current.levelSystems.filter(
                (item) => item.id !== systemId,
              ),
              links: current.links.filter((link) => !rungIds.has(link.toId)),
            }
          : current,
      );
      void removeLevelSystemRemote(systemId);
    },
    [bundle],
  );

  /** 追加等级项：rank 取该体系当前最大值 + 1，与主进程 MAX(rank)+1 同口径 */
  const addLevel = useCallback(
    (systemId: string, name: string): LevelRung | null => {
      const trimmed = name.trim();
      if (!trimmed || !bundle) return null;
      const system = bundle.levelSystems.find((item) => item.id === systemId);
      if (!system) return null;
      const rung: LevelRung = {
        id: createNovelId("lr"),
        name: trimmed,
        rank: system.rungs.reduce((max, rung) => Math.max(max, rung.rank), 0) + 1,
      };
      setBundle((current) =>
        current
          ? {
              ...current,
              levelSystems: current.levelSystems.map((item) =>
                item.id === systemId
                  ? { ...item, rungs: [...item.rungs, rung] }
                  : item,
              ),
            }
          : current,
      );
      void addLevelRemote(systemId, rung.id, trimmed);
      return rung;
    },
    [bundle],
  );

  /** 等级项重命名：空名不落 */
  const renameLevel = useCallback((rungId: string, name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBundle((current) =>
      current
        ? {
            ...current,
            levelSystems: current.levelSystems.map((system) => ({
              ...system,
              rungs: system.rungs.map((rung) =>
                rung.id === rungId ? { ...rung, name: trimmed } : rung,
              ),
            })),
          }
        : current,
    );
    void renameLevelRemote(rungId, trimmed);
  }, []);

  /** 删除等级项：本地摘除 + 摘掉指向它的当前境界绑定（主进程级联） */
  const deleteLevel = useCallback((rungId: string): void => {
    setBundle((current) =>
      current
        ? {
            ...current,
            levelSystems: current.levelSystems.map((system) => ({
              ...system,
              rungs: system.rungs.filter((rung) => rung.id !== rungId),
            })),
            links: current.links.filter(
              (link) => !(link.toType === "level" && link.toId === rungId),
            ),
          }
        : current,
    );
    void removeLevelRemote(rungId);
  }, []);

  /** 等级项重排：orderedIds 为目标顺序（rank 从 1 起），本地排序 + 全量回写 */
  const reorderLevels = useCallback(
    (systemId: string, orderedIds: string[]): void => {
      if (!bundle) return;
      const rankOf = new Map(orderedIds.map((id, index) => [id, index + 1]));
      setBundle((current) =>
        current
          ? {
              ...current,
              levelSystems: current.levelSystems.map((system) =>
                system.id === systemId
                  ? {
                      ...system,
                      rungs: system.rungs
                        .map((rung) => ({
                          ...rung,
                          rank: rankOf.get(rung.id) ?? rung.rank,
                        }))
                        .sort((a, b) => a.rank - b.rank),
                    }
                  : system,
              ),
            }
          : current,
      );
      void saveLevelOrder(
        orderedIds.map((id, index) => ({ id, rank: index + 1 })),
      );
    },
    [bundle],
  );

  /**
   * 设定 / 替换 / 取消要素的「当前境界」（R25）。
   * 绑定存 novel_links：toType='level'、toId=novel_levels.id、relation 固定
   * 「当前境界」；一个要素同时只持有一条——先摘旧绑定再落新绑定。
   * rungId 传 null 即取消绑定。
   */
  const setEntityLevel = useCallback(
    (
      entityId: string,
      entityType: EntityType,
      rungId: string | null,
    ): void => {
      if (!bundle) return;
      const binding = bundle.links.find(
        (link) =>
          link.fromId === entityId &&
          link.fromType === entityType &&
          link.toType === "level",
      );
      const created: NovelLink | null =
        rungId === null || rungId === binding?.toId
          ? null
          : {
              id: createNovelId("l"),
              fromType: entityType,
              fromId: entityId,
              toType: "level",
              toId: rungId,
              relation: LEVEL_RELATION,
            };
      setBundle((current) => {
        if (!current) return current;
        const links = binding
          ? current.links.filter((link) => link.id !== binding.id)
          : current.links;
        return { ...current, links: created ? [created, ...links] : links };
      });
      if (binding) void removeLinkRemote(binding.id);
      if (created) void addLinkRemote(created);
    },
    [bundle],
  );

  /**
   * 自建类型删除时的实体迁移（R23）：该类型全部要素卡回退到 toType
   * （通常是 custom 兜底），返回迁移数量供 toast 汇报。
   */
  const migrateEntityType = useCallback(
    (fromType: EntityType, toType: EntityType): number => {
      if (!bundle) return 0;
      const affected = bundle.entities.filter(
        (entity) => entity.type === fromType,
      );
      if (affected.length === 0) return 0;
      setBundle((current) =>
        current
          ? {
              ...current,
              entities: current.entities.map((entity) =>
                entity.type === fromType ? { ...entity, type: toType } : entity,
              ),
            }
          : current,
      );
      for (const entity of affected) {
        void saveEntity({ ...entity, type: toType });
      }
      return affected.length;
    },
    [bundle],
  );

  /** 要素关联的双向视图（PRD R24；R25 起目标可为等级项 toType='level'） */
  const getEntityRelations = useCallback(
    (entityId: string, entityType: EntityType): EntityRelationView[] => {
      const nameOf = (
        id: string,
        type: EntityType,
      ): { name: string; type: EntityType } => {
        // 当前境界绑定的目标是 novel_levels.id，不在要素表里，查等级项索引
        if (type === "level") {
          const rung = levelRungIndex.get(id);
          return {
            name: rung ? `${rung.name}（${rung.systemName}）` : "未知等级",
            type,
          };
        }
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
          const targetType = outgoing ? link.toType : link.fromType;
          const target = nameOf(targetId, targetType);
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
    [entities, links, levelRungIndex],
  );

  const addNote = useCallback(
    (content: string): void => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const note: NovelNote = {
        id: createNovelId("n"),
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
        id: createNovelId("f"),
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
    lastPosition,
    setActiveWorkId,
    selectChapter,
    consumeLastPosition,
    createWork,
    renameWork,
    deleteWork,
    resetTemplate,
    updateChapterContent,
    updateChapterOutlineNote,
    createChapter,
    createVolume,
    renameChapter,
    deleteChapter,
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
    createLevelSystem,
    renameLevelSystem,
    deleteLevelSystem,
    addLevel,
    renameLevel,
    deleteLevel,
    reorderLevels,
    setEntityLevel,
    migrateEntityType,
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
