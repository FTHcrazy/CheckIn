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
import {
  applyWorkNumbering,
  fetchWorkNumbering,
  type WorkNumberingEntry,
} from "@/shared/novel/work-numbering";
import { notifyNoteChanged } from "@/shared/novel/note-events";

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
  /** 按书序号规则（1.34.0）：「继续写作」Hero 按目标书自己的规则展示 */
  const [numberingMap, setNumberingMap] = useState<Record<string, WorkNumberingEntry>>({});
  const [position, setPosition] = useState<ShelfPosition | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * 装载失败提示（P2-6，仿 useNovelData 范式）：没有它，IPC 失败时 bundle
   * 恒为 null，页面会把失败渲染成「书架还是空的」。只在 bundle 为 null 时
   * 升级为错误视图；静默刷新失败时 bundle 还在，界面照旧、不打扰用户。
   */
  const [loadError, setLoadError] = useState("");
  /**
   * 「现在」的时间戳快照。
   *
   * `resolveHero` 要拿它算「上次写作距今多久」，但**不能在渲染期取** ——
   * `Date.now()` 是副作用函数，放进 useMemo 会让同一份输入在不同渲染间产出
   * 不同结果（React 纯度规则明确禁止）。改为在 load() 里取一次存进 state：
   * Hero 的时间口径与数据同一时刻，反而比每次渲染各取一次更准。
   */
  const [now, setNow] = useState(() => Date.now());

  /** silent = 静默刷新（从编辑器返回书架时重算统计，不闪 loading） */
  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true);
    try {
      const [nextBundle, nextUsage, settingsRaw, positionRaw, numbering] =
        await Promise.all([
          fetchShelfBundle(),
          fetchShelfUsage(),
          fetchShelfSettingsRaw(),
          fetchShelfPositionRaw(),
          fetchWorkNumbering(),
        ]);
      setBundle(nextBundle);
      setUsage(nextUsage);
      setStyle(parseNumberStyle(settingsRaw));
      setNumberingMap(numbering);
      setPosition(parsePosition(positionRaw));
      setNow(Date.now());
      setLoadError("");
    } catch {
      // P2-6：不收 reject 的话异常一路冒到 `void load()` 成为未捕获错误，
      // 且失败会被渲染成空书架。置错误态交给页面出重试入口。
      setLoadError("书架数据装载失败，请重试");
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
    () =>
      bundle
        ? resolveHero(bundle, position, style, now, (workId) =>
            applyWorkNumbering(style, workId, numberingMap),
          )
        : null,
    [bundle, position, style, now, numberingMap],
  );

  // ── 作品 ────────────────────────────────────────────────────────

  /**
   * 新建作品：本地先建并返回 id（书架随后跳编辑器开写），异步落库。
   *
   * `genre` 为可选：建书第二步可以「跳过」（不传 = 未设置题材）。
   */
  const createWork = useCallback(
    (name: string, genre?: string): string | null => {
      const trimmed = name.trim();
      if (!trimmed || !bundle) return null;
      const genreDraft = genre?.replace(/\s+/g, " ").trim();
      const work: NovelWorkDTO = {
        id: createShelfId("w"),
        name: trimmed,
        createdAt: Date.now(),
        ...(genreDraft ? { genre: genreDraft } : {}),
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

  /**
   * 灵感写操作完成后**必须广播** `novel-note-changed`（P2-4）。
   *
   * 书架与编辑器同窗常驻（display 切换），编辑器的 bundle.notes 是一份内存
   * 快照 —— 不广播的话，在书架改完灵感再进编辑器，灵感面板显示的还是旧内容，
   * 作者会基于旧笔记续写。编辑器侧（useNovelData）订阅后就地 patch，不重载。
   */

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
    notifyNoteChanged({ action: "upsert", workId, note });
    return true;
  }, []);

  const toggleNotePinned = useCallback(
    (noteId: string): void => {
      // 先在 updater 之外算出目标行：副作用（落库 / 广播）不能写进 state
      // updater —— StrictMode 下 updater 双调用，会双发 IPC（React 纯度规则）
      const target = bundle?.notes.find((note) => note.id === noteId);
      if (!target) return;
      const next: NovelNoteDTO = { ...target, pinned: !target.pinned };
      setBundle((current) =>
        current
          ? {
              ...current,
              notes: current.notes.map((note) => (note.id === noteId ? next : note)),
            }
          : current,
      );
      void saveShelfNote(next);
      notifyNoteChanged({ action: "upsert", workId: next.workId, note: next });
    },
    [bundle],
  );

  /** 归属迁移：归档到作品 / 退回未归属池（workId=''） */
  const moveNoteTo = useCallback(
    (noteId: string, workId: string): void => {
      // updater 是渲染期才执行的纯计算，别指望在它里面「顺手带出」结果——
      // 与 toggleNotePinned 同一范式：先从 bundle 算出落点行，再写状态
      const source = bundle?.notes.find((note) => note.id === noteId);
      if (!source) return;
      const moved: NovelNoteDTO = { ...source, workId };
      setBundle((current) =>
        current
          ? {
              ...current,
              notes: current.notes.map((note) =>
                note.id === noteId ? moved : note,
              ),
            }
          : current,
      );
      void moveShelfNote(noteId, workId);
      notifyNoteChanged({ action: "upsert", workId, note: moved });
    },
    [bundle],
  );

  /**
   * 编辑灵感内容（1.41.0）：书架灵感库此前只有置顶 / 归属 / 删除，
   * 写错了只能删掉重记。空内容与未改动都不落库（与编辑器灵感面板同口径）。
   */
  const updateNoteContent = useCallback(
    (noteId: string, content: string): void => {
      const trimmed = content.trim();
      const source = bundle?.notes.find((note) => note.id === noteId);
      if (!source || !trimmed || trimmed === source.content) return;
      const next: NovelNoteDTO = { ...source, content: trimmed };
      setBundle((current) =>
        current
          ? {
              ...current,
              notes: current.notes.map((note) => (note.id === noteId ? next : note)),
            }
          : current,
      );
      void saveShelfNote(next);
      notifyNoteChanged({ action: "upsert", workId: next.workId, note: next });
    },
    [bundle],
  );

  const removeNoteById = useCallback((noteId: string): void => {
    setBundle((current) =>
      current
        ? { ...current, notes: current.notes.filter((note) => note.id !== noteId) }
        : current,
    );
    void removeShelfNote(noteId);
    notifyNoteChanged({ action: "remove", noteId });
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
    loadError,
    createWork,
    addNote,
    toggleNotePinned,
    moveNoteTo,
    updateNoteContent,
    removeNoteById,
    refresh: load,
  };
}

export type { HeroView, IdeaFilter, WorkCardView };
