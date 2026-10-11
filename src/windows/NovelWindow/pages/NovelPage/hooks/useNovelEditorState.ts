import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, SAVE } from "../novel-config";
import { mergeEditorSettings, parseJsonOrNull } from "../novel-utils";
import {
  fetchEditorSettings,
  fetchUsageToday,
  saveEditorSettings,
} from "../services/novel-service";
import {
  applyWorkNumbering,
  fetchWorkNumbering,
  saveWorkNumberingRule,
  type WorkNumberingEntry,
} from "@/shared/novel/work-numbering";
import {
  editorActions,
  needsFlushSave,
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
  const workIdRef = useRef("");
  useEffect(() => {
    workIdRef.current = data.activeWorkId;
  }, [data.activeWorkId]);

  /**
   * 排版设置恢复（R5）：启动时从 userDb config 读回。
   * loadedRef 门禁保证首帧默认值不会先于恢复把已存设置覆盖掉
   * （写回改为在 store 的 updateSetting / toggleAnnotationType 里即时触发）。
   */
  const settingsLoadedRef = useRef(false);
  /** 全局设置基线：序号三字段之外的全部设置以它为准（store 里是叠加过本书规则后的） */
  const globalBaseRef = useRef<EditorSettings>(DEFAULT_SETTINGS);
  /**
   * 按书序号规则映射：随加载 / 写入更新，驱动 store 里的设置重新叠加。
   *
   * ⚠️ 声明必须早于下面 registerEditorRunner 的 effect —— 它的 persistSettings
   * 闭包要读 setNumberingMap，声明在后会被 lint 判为「使用先于声明」。
   */
  const [numberingMap, setNumberingMap] = useState<Record<string, WorkNumberingEntry>>({});

  useEffect(() => {
    registerEditorRunner({
      persistChapter: (chapterId, content, words) =>
        updateChapterContent(chapterId, content, words),
      markSelectionAsEntity,
      persistSettings: (next: EditorSettings) => {
        // 序号三字段（numberStyle / chapterSuffix / volumeSuffix）归**本书**：
        // 全局基线保持原值只收非序号字段，序号改动写进该书的规则记录 ——
        // 否则换一本书就会把上一本改的规则带过去（1.34.0 按书独立的关键）。
        const base = globalBaseRef.current;
        const numberingTouched =
          next.numberStyle !== base.numberStyle ||
          next.chapterSuffix !== base.chapterSuffix ||
          next.volumeSuffix !== base.volumeSuffix;
        if (!numberingTouched) {
          globalBaseRef.current = next;
        } else {
          globalBaseRef.current = {
            ...next,
            numberStyle: base.numberStyle,
            chapterSuffix: base.chapterSuffix,
            volumeSuffix: base.volumeSuffix,
          };
        }
        void saveEditorSettings(globalBaseRef.current);

        const workId = workIdRef.current;
        if (workId) {
          const rule: WorkNumberingEntry = {
            numberStyle: next.numberStyle,
            chapterSuffix: next.chapterSuffix,
            volumeSuffix: next.volumeSuffix,
          };
          // updater 必须是纯函数（StrictMode 会双跑）：逐字段比而非比对象引用，
          // 否则每次都是新对象、永远「不相等」，白白多一轮重渲染
          setNumberingMap((current) => {
            const prev = current[workId];
            if (
              prev &&
              prev.numberStyle === rule.numberStyle &&
              prev.chapterSuffix === rule.chapterSuffix &&
              prev.volumeSuffix === rule.volumeSuffix
            ) {
              return current;
            }
            return { ...current, [workId]: rule };
          });
          void saveWorkNumberingRule(workId, rule);
        }
      },
    });
    return () => registerEditorRunner(null);
  }, [updateChapterContent, markSelectionAsEntity]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchEditorSettings(), fetchWorkNumbering()])
      .then(([raw, map]) => {
        if (cancelled) return;
        globalBaseRef.current = mergeEditorSettings(parseJsonOrNull(raw));
        setNumberingMap(map);
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

  /**
   * 把本书的序号规则叠加进 store 设置（换书 / 规则映射变化时重算）。
   *
   * 顶层 store 只认一份 settings，所有消费方（章节树 / 大纲 / 导出 /
   * 「插入章节标题」）读到的都是叠加后的口径 —— 每本书互不影响就在这里收口。
   */
  useEffect(() => {
    useNovelEditorStore
      .getState()
      .hydrateSettings(
        applyWorkNumbering(globalBaseRef.current, data.activeWorkId, numberingMap),
      );
  }, [data.activeWorkId, numberingMap]);

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

  // 兜底强制 flush：防抖若被持续输入一直重置，这里 30s 补一次。
  // failed 也要补 —— 上次落库没能成功时，这里是唯一的自动重试通道
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (needsFlushSave()) void editorActions.flushSave();
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
    dropChapterDraft: editorActions.dropChapterDraft,
    clearDrafts: editorActions.clearDrafts,
  };
}

/** 编辑器选区类型沿用 store 定义（避免类型重复定义） */
export type { EditorSelection } from "../store/useNovelEditorStore";
