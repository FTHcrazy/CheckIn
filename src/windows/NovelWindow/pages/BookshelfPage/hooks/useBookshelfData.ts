import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addShelfWork,
  createShelfId,
  fetchShelfBundle,
  fetchShelfPositionRaw,
  fetchShelfSettingsRaw,
  fetchShelfUsage,
  moveShelfNote,
  removeShelfNote,
  saveShelfNote,
  type ShelfUsage,
} from "../services/bookshelf-service";
import {
  buildWorkCards,
  countIdeaNotes,
  resolveHero,
  type HeroView,
  type IdeaFilter,
  type ShelfNumberStyle,
  type ShelfPosition,
  type WorkCardView,
} from "../bookshelf-utils";
import type {
  NovelBundleDTO,
  NovelNoteDTO,
  NovelWorkDTO,
} from "@/shared/types/electron";

/**
 * 书架数据层 Hook（R32）
 *
 * 负责：全量数据包 / 今日聚合 / 设置与位置记忆的加载，书卡与 Hero 派生，
 * 以及灵感库（全局 note 池）的新增 / 置顶 / 归属迁移 / 删除。
 * 写操作全部先做乐观本地更新，再异步落库；筛选排序等视图状态留在页面组件。
 */

const DEFAULT_STYLE: ShelfNumberStyle = {
  numberStyle: "chinese",
  chapterSuffix: "章",
  volumeSuffix: "卷",
  dailyGoal: 3000,
};

const textOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;

/** 编辑器设置 JSON → 书架关心的字段（损坏数据安全回退默认值） */
function parseNumberStyle(raw: string | null): ShelfNumberStyle {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_STYLE;
    }
    const source = parsed as Record<string, unknown>;
    return {
      numberStyle: source.numberStyle === "arabic" ? "arabic" : "chinese",
      chapterSuffix: textOr(source.chapterSuffix, "章"),
      volumeSuffix: textOr(source.volumeSuffix, "卷"),
      dailyGoal:
        typeof source.dailyGoal === "number" && Number.isFinite(source.dailyGoal) && source.dailyGoal > 0
          ? Math.round(source.dailyGoal)
          : DEFAULT_STYLE.dailyGoal,
    };
  } catch {
    return DEFAULT_STYLE;
  }
}

/** 位置记忆 JSON → {workId, chapterId}（有效性校验在 resolveHero 内做） */
function parsePosition(raw: string | null): ShelfPosition | null {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const source = parsed as Record<string, unknown>;
    if (
      typeof source.workId !== "string" ||
      typeof source.chapterId !== "string" ||
      !source.workId ||
      !source.chapterId
    ) {
      return null;
    }
    return { workId: source.workId, chapterId: source.chapterId };
  } catch {
    return null;
  }
}

export function useBookshelfData() {
  const [bundle, setBundle] = useState<NovelBundleDTO | null>(null);
  const [usage, setUsage] = useState<ShelfUsage>({
    todayWords: 0,
    saveCount: 0,
    streakDays: 0,
  });
  const [style, setStyle] = useState<ShelfNumberStyle>(DEFAULT_STYLE);
  const [position, setPosition] = useState<ShelfPosition | null>(null);
  const [loading, setLoading] = useState(true);

  /** silent = 静默刷新（从编辑器返回书架时重算统计，不闪 loading） */
  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true);
    try {
      const [nextBundle, nextUsage, settingsRaw, positionRaw] = await Promise.all([
        fetchShelfBundle(),
        fetchShelfUsage(),
        fetchShelfSettingsRaw(),
        fetchShelfPositionRaw(),
      ]);
      setBundle(nextBundle);
      setUsage(nextUsage);
      setStyle(parseNumberStyle(settingsRaw));
      setPosition(parsePosition(positionRaw));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = useMemo(() => (bundle ? buildWorkCards(bundle) : []), [bundle]);
  const notes = useMemo(() => bundle?.notes ?? [], [bundle]);
  const ideaCounts = useMemo(() => countIdeaNotes(notes), [notes]);
  const hero = useMemo(
    () => (bundle ? resolveHero(bundle, position, style) : null),
    [bundle, position, style],
  );

  // ── 作品 ────────────────────────────────────────────────────────

  /** 新建作品：本地先建并返回 id（书架随后跳编辑器开写），异步落库 */
  const createWork = useCallback(
    (name: string): string | null => {
      const trimmed = name.trim();
      if (!trimmed || !bundle) return null;
      const work: NovelWorkDTO = {
        id: createShelfId("w"),
        name: trimmed,
        createdAt: Date.now(),
      };
      setBundle((current) =>
        current ? { ...current, works: [...current.works, work] } : current,
      );
      void addShelfWork(work);
      return work.id;
    },
    [bundle],
  );

  // ── 全局灵感库 ──────────────────────────────────────────────────

  /** 记一条灵感：workId 传 '' 即未归属（跨作品收集池） */
  const addNote = useCallback((content: string, workId: string): boolean => {
    const trimmed = content.trim();
    if (!trimmed) return false;
    const note: NovelNoteDTO = {
      id: createShelfId("n"),
      workId,
      content: trimmed,
      createdAt: Date.now(),
      pinned: false,
    };
    setBundle((current) =>
      current ? { ...current, notes: [note, ...current.notes] } : current,
    );
    void saveShelfNote(note);
    return true;
  }, []);

  const toggleNotePinned = useCallback((noteId: string): void => {
    setBundle((current) => {
      if (!current) return current;
      const target = current.notes.find((note) => note.id === noteId);
      if (!target) return current;
      const next = { ...target, pinned: !target.pinned };
      void saveShelfNote(next);
      return {
        ...current,
        notes: current.notes.map((note) => (note.id === noteId ? next : note)),
      };
    });
  }, []);

  /** 归属迁移：归档到作品 / 退回未归属池（workId=''） */
  const moveNoteTo = useCallback((noteId: string, workId: string): void => {
    setBundle((current) =>
      current
        ? {
            ...current,
            notes: current.notes.map((note) =>
              note.id === noteId ? { ...note, workId } : note,
            ),
          }
        : current,
    );
    void moveShelfNote(noteId, workId);
  }, []);

  const removeNoteById = useCallback((noteId: string): void => {
    setBundle((current) =>
      current
        ? { ...current, notes: current.notes.filter((note) => note.id !== noteId) }
        : current,
    );
    void removeShelfNote(noteId);
  }, []);

  return {
    bundle,
    cards,
    notes,
    ideaCounts,
    hero,
    usage,
    style,
    loading,
    createWork,
    addNote,
    toggleNotePinned,
    moveNoteTo,
    removeNoteById,
    refresh: load,
  };
}

export type BookshelfData = ReturnType<typeof useBookshelfData>;
export type { HeroView, IdeaFilter, WorkCardView };
