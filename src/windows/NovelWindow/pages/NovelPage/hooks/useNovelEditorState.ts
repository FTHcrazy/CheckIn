import { useEffect, useRef } from "react";
import { SAVE } from "../novel-config";
import { mergeEditorSettings, parseJsonOrNull } from "../novel-utils";
import {
  fetchEditorSettings,
  fetchUsageToday,
  saveEditorSettings,
} from "../services/novel-service";
import {
  editorActions,
  registerEditorRunner,
  sessionStartedAt,
  sessionWords,
  useNovelEditorStore,
} from "../store/useNovelEditorStore";
import type { EditorSettings } from "../types";
import type { useNovelData } from "./useNovelData";

type NovelData = ReturnType<typeof useNovelData>;

/** 码字速度采样间隔（10s，避免每键重算） */
const SPEED_SAMPLING_MS = 10_000;

/**
 * 编辑器交互状态编排层
 *
 * 状态本体已搬到 `store/useNovelEditorStore`：正文草稿、保存态、今日字数这些
 * **每次按键都变**的数据，由真正用到它们的组件（EditorPane / StatusBar /
 * NovelTopBar）各自订阅；本 Hook 只订阅低频切片（排版设置、选区、恢复横幅），
 * 于是「敲一个字」不再把整棵页面树推一遍。
 *
 * 这里剩下的都是副作用编排：
 * - 注册数据层能力（落库 / 建要素 / 设置持久化）
 * - 启动时恢复排版设置与今日累计字数
 * - 码字速度采样、30s 兜底 flush
 */
export function useNovelEditorState(data: NovelData) {
  const { updateChapterContent, markSelectionAsEntity } = data;

  // ── 低频切片：只有这些变化才会让页面根重渲染 ────────────────────
  const settings = useNovelEditorStore((state) => state.settings);
  const selection = useNovelEditorStore((state) => state.selection);
  const recoveryDismissed = useNovelEditorStore(
    (state) => state.recoveryDismissed,
  );

  // 数据层能力注册（注册本身不触发任何请求）
  useEffect(() => {
    registerEditorRunner({
      persistChapter: (chapterId, content, words) =>
        updateChapterContent(chapterId, content, words),
      markSelectionAsEntity,
      persistSettings: (next: EditorSettings) => {
        void saveEditorSettings(next);
      },
    });
    return () => registerEditorRunner(null);
  }, [updateChapterContent, markSelectionAsEntity]);

  /**
   * 排版设置恢复（R5）：启动时从 userDb config 读回。
   * loadedRef 门禁保证首帧默认值不会先于恢复把已存设置覆盖掉
   * （写回改为在 store 的 updateSetting / toggleAnnotationType 里即时触发）。
   */
  const settingsLoadedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void fetchEditorSettings()
      .then((raw) => {
        if (cancelled) return;
        useNovelEditorStore
          .getState()
          .hydrateSettings(mergeEditorSettings(parseJsonOrNull(raw)));
      })
      .catch(() => {
        // IPC 失败：保持默认设置，持久化链路照常可用
      })
      .finally(() => {
        if (!cancelled) settingsLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 今日写作（R14）：跨会话累计，启动时由 usage_log 聚合初始化
  useEffect(() => {
    let cancelled = false;
    void fetchUsageToday()
      .then((summary) => {
        if (cancelled) return;
        useNovelEditorStore.getState().hydrateUsage(summary.todayWords);
      })
      .catch(() => {
        // 拉取失败从 0 起算：统计缺失可接受，不阻塞写作
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 码字速度按 10s 采样刷新：只更新 store，不通知页面根
  useEffect(() => {
    const timer = window.setInterval(() => {
      const startedAt = sessionStartedAt();
      if (startedAt === null) return;
      const minutes = (Date.now() - startedAt) / 60_000;
      useNovelEditorStore
        .getState()
        .setSpeed(minutes > 0 ? Math.round(sessionWords() / minutes) : 0);
    }, SPEED_SAMPLING_MS);
    return () => window.clearInterval(timer);
  }, []);

  // 兜底强制 flush：防抖若被持续输入一直重置，这里 30s 补一次
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (useNovelEditorStore.getState().saveState === "pending") {
        void editorActions.flushSave();
      }
    }, SAVE.flushIntervalMs);
    return () => window.clearInterval(timer);
  }, []);

  const recoveryVisible = Boolean(data.recovery) && !recoveryDismissed;

  return {
    settings,
    selection,
    recoveryVisible,
    // 以下动作身份恒定，可安全透传给子组件
    setContent: editorActions.setContent,
    applyExternalContent: editorActions.applyExternalContent,
    flushSave: editorActions.flushSave,
    updateSetting: editorActions.updateSetting,
    toggleAnnotationType: editorActions.toggleAnnotationType,
    setSelection: editorActions.setSelection,
    markSelection: editorActions.markSelection,
    dismissRecovery: editorActions.dismissRecovery,
  };
}

/** 编辑器选区类型沿用 store 定义（避免类型重复定义） */
export type { EditorSelection } from "../store/useNovelEditorStore";
