import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, SAVE, SAVE_STATE_TEXT } from "../novel-config";
import { countWords } from "../novel-utils";
import type {
  EditorSettings,
  NovelChapter,
  SaveState,
  WritingStats,
} from "../types";
import type { useNovelData } from "./useNovelData";

type NovelData = ReturnType<typeof useNovelData>;

/**
 * 编辑器交互状态 Hook
 *
 * 负责：正文草稿、保存状态机（防抖自动保存 / 手动 flush / 失败转快照）、
 * 今日字数与码字速度、选区标记、崩溃恢复横幅确认、排版设置。
 * 不负责：左右栏折叠、面板 Tab、浮层开关等纯展示状态（见 useNovelViewState）。
 */
export function useNovelEditorState(data: NovelData) {
  const { activeChapterId, updateChapterContent, markSelectionAsEntity } = data;

  // 草稿按章节隔离存放，切换章节天然回到上次正文，不需要额外的同步副作用
  const [draftMap, setDraftMap] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);

  // 今日写作：会话级统计，作为 useNovelData 尚未接 usage_log 时的过渡实现
  const [todayAdded, setTodayAdded] = useState(0);
  const [todayTotal, setTodayTotal] = useState(0);
  const [speed, setSpeed] = useState(0);
  const sessionRef = useRef<{ words: number; startedAt: number } | null>(null);

  const activeChapter: NovelChapter | null = data.activeChapter;
  const content = activeChapterId
    ? draftMap[activeChapterId] ?? activeChapter?.content ?? ""
    : "";

  const persist = useCallback(async (): Promise<void> => {
    if (!activeChapterId) return;
    setSaveState("saving");
    const words = countWords(content, settings.wordCountMode);
    const ok = await updateChapterContent(activeChapterId, content, words);
    setSaveState(ok ? "saved" : "failed");
    if (ok) setLastSavedAt(Date.now());
  }, [activeChapterId, content, settings.wordCountMode, updateChapterContent]);

  // 防抖自动保存：每次输入都重置计时器，停顿即落库（PRD §2）
  useEffect(() => {
    if (saveState !== "pending") return;
    const timer = window.setTimeout(() => {
      void persist();
    }, SAVE.debounceMs);
    return () => window.clearTimeout(timer);
  }, [saveState, content, persist]);

  // 兜底强制 flush：关窗 / 失焦由上层调用，这里做 30s 周期兜底（PRD §2）
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (saveState === "pending") void persist();
    }, SAVE.flushIntervalMs);
    return () => window.clearInterval(timer);
  }, [saveState, persist]);

  // 码字速度按 10s 采样刷新，避免每键重算
  useEffect(() => {
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      const minutes = (Date.now() - session.startedAt) / 60_000;
      setSpeed(minutes > 0 ? Math.round(session.words / minutes) : 0);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleContentChange = useCallback(
    (next: string) => {
      if (!activeChapterId) return;
      setDraftMap((current) => ({ ...current, [activeChapterId]: next }));
      setSaveState("pending");

      const words = countWords(next, settings.wordCountMode);
      const previous = countWords(content, settings.wordCountMode);
      const delta = words - previous;
      if (delta === 0) return;

      setTodayAdded((current) => current + delta);
      setTodayTotal((current) => current + delta);
      const session = sessionRef.current ?? {
        words: 0,
        startedAt: Date.now(),
      };
      sessionRef.current = { ...session, words: session.words + delta };
    },
    [activeChapterId, content, settings.wordCountMode],
  );

  /** 外部灌入正文：快照回滚 / 崩溃恢复 */
  const applyExternalContent = useCallback(
    (next: string) => {
      if (!activeChapterId) return;
      setDraftMap((current) => ({ ...current, [activeChapterId]: next }));
      setSaveState("pending");
    },
    [activeChapterId],
  );

  /** 手动保存 / 关窗前 flush：无论当前处于哪个状态都立即落库 */
  const flushSave = useCallback(async (): Promise<void> => {
    await persist();
  }, [persist]);

  const updateSetting = useCallback(
    <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const toggleAnnotationType = useCallback((type: EditorSettings["annotationTypes"][number]) => {
    setSettings((current) => {
      const exists = current.annotationTypes.includes(type);
      return {
        ...current,
        annotationTypes: exists
          ? current.annotationTypes.filter((item) => item !== type)
          : [...current.annotationTypes, type],
      };
    });
  }, []);

  /** 选区 → 标记（O3），返回 toast 文案所需的标记结果 */
  const markSelection = useCallback(
    (type: EditorSettings["annotationTypes"][number]) => {
      if (!selection) return null;
      const result = markSelectionAsEntity(selection.text, type);
      setSelection(null);
      return result;
    },
    [selection, markSelectionAsEntity],
  );

  const stats: WritingStats = useMemo(
    () => ({
      chapterWords: countWords(content, settings.wordCountMode),
      todayAdded,
      speed,
      todayTotal,
      dailyGoal: settings.dailyGoal,
    }),
    [content, settings.wordCountMode, todayAdded, speed, todayTotal, settings.dailyGoal],
  );

  const saveText = useMemo(() => SAVE_STATE_TEXT[saveState], [saveState]);
  const recoveryVisible = Boolean(data.recovery) && !recoveryDismissed;

  return {
    content,
    saveState,
    saveText,
    lastSavedAt,
    settings,
    selection,
    stats,
    recoveryVisible,
    handleContentChange,
    applyExternalContent,
    flushSave,
    updateSetting,
    toggleAnnotationType,
    setSelection,
    markSelection,
    dismissRecovery: () => setRecoveryDismissed(true),
  };
}

export interface EditorSelection {
  text: string;
  from: number;
  to: number;
  /** 选区起点相对码字区的坐标，供「标记为…」工具条定位 */
  x: number;
  y: number;
}
