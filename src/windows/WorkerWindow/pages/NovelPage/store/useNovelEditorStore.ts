/**
 * 编辑器交互状态（模块级 Zustand store）
 *
 * 为什么抽到全局：正文草稿此前放在 `useNovelEditorState`，而那个 Hook 在页面根
 * 被调用——于是**每敲一个字**都要让 NovelPage 整棵树重渲染：左栏上百个卷章节点、
 * 右栏五个面板、顶栏、四个常驻抽屉全部陪跑一次。
 *
 * 放在 store 后：谁用正文谁订阅（EditorPane 订阅草稿、StatusBar 订阅字数、
 * NovelTopBar 订阅保存态），页面根只拿低频的 settings / selection。
 * 打字这条最高频的链路就此收敛到 2–3 个组件。
 *
 * 边界（沿用 useSearchStore 的 runner 范式）：store 不 import service、不认识
 * data Hook——落库、新建要素、设置持久化都由页面注册的 runner 提供；
 * 注册动作不触发任何请求。保存调度也放进 store（防抖 + 30s 兜底在编排层），
 * 不再挂在「依赖数组里有回调」的 effect 上。
 */

import { create } from "zustand";
import {
  DEFAULT_SETTINGS,
  SAVE,
  SAVE_STATE_TEXT,
} from "../novel-config";
import { countWords } from "../novel-utils";
import type {
  EditorSettings,
  EntityType,
  NovelEntity,
  SaveState,
  WritingStats,
} from "../types";

/** 编辑器选区（标记 / 右键菜单的输入） */
export interface EditorSelection {
  text: string;
  from: number;
  to: number;
}

/** 选区标记的结果：新建要素 / 关联为别名 / 已存在 */
export type MarkResult =
  | { entity: NovelEntity; mode: "created" | "linked" | "existing" }
  | null;

/** 数据层能力，由页面注册（store 不认识 useNovelData / service） */
export interface EditorRunner {
  /** 落库一章正文，返回是否成功 */
  persistChapter: (
    chapterId: string,
    content: string,
    words: number,
  ) => Promise<boolean>;
  /** 选区文本 → 要素（新建或关联别名） */
  markSelectionAsEntity: (text: string, type: EntityType) => MarkResult;
  /** 排版设置持久化（config 整读整写） */
  persistSettings: (settings: EditorSettings) => void;
}

export interface EditorState {
  /** 逐章草稿：切换章节天然回到上次正文，不需要同步副作用 */
  draftMap: Record<string, string>;
  /** 当前编辑的章节（由输入动作带进来，保存时用它定位） */
  activeChapterId: string | null;
  saveState: SaveState;
  lastSavedAt: number | null;
  settings: EditorSettings;
  selection: EditorSelection | null;
  recoveryDismissed: boolean;
  /** 会话内新增字数（本次打开编辑器起算） */
  todayAdded: number;
  /** 今日累计（跨会话，启动时由 usage_log 聚合初始化） */
  todayTotal: number;
  /** 码字速度（字/分，10s 采样） */
  speed: number;

  /**
   * 上报正文变化。`baseContent` 是上报方（编辑器）所知的变更前正文——
   * 程序化文档同步（切章灌入 / 回滚回写）必须带上它作为字数基线，
   * 否则无草稿的章节会以空串为基线，把整章字数误计入今日新增。
   * 真实的用户输入可以不传（草稿里已有准确的基线）。
   */
  setContent: (chapterId: string, next: string, baseContent?: string) => void;
  applyExternalContent: (chapterId: string, next: string) => void;
  flushSave: () => Promise<void>;
  updateSetting: <K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K],
  ) => void;
  toggleAnnotationType: (type: EditorSettings["annotationTypes"][number]) => void;
  setSelection: (selection: EditorSelection | null) => void;
  markSelection: (type: EditorSettings["annotationTypes"][number]) => MarkResult;
  dismissRecovery: () => void;
  /** 启动恢复的排版设置（只调一次，loaded 守卫在编排层） */
  hydrateSettings: (settings: EditorSettings) => void;
  /** 启动恢复的今日累计字数 */
  hydrateUsage: (todayWords: number) => void;
  setSpeed: (speed: number) => void;
  /** 切章 / 换作品时清空选区与保存态 */
  resetForChapter: (chapterId: string | null) => void;
}

let runner: EditorRunner | null = null;

/** 防抖保存定时器 */
let saveTimer: number | null = null;

/** 在途防抖保存针对的章节：换章时据此决定「续排」还是「立即落库旧章」 */
let pendingSaveChapterId: string | null = null;

/** 会话采样：用于算码字速度 */
let session: { words: number; startedAt: number } | null = null;

export function registerEditorRunner(next: EditorRunner | null): void {
  runner = next;
}

/** 取消在途防抖（立即保存 / 关窗 flush 用），并清掉其章节标记 */
function cancelPendingSave(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSaveChapterId = null;
}

export const useNovelEditorStore = create<EditorState>()((set, get) => {
  /** 落库指定章节的草稿（无论当前处于哪个保存态） */
  const persistChapterNow = async (chapterId: string): Promise<void> => {
    const state = get();
    const { draftMap, settings } = state;

    const content = draftMap[chapterId];
    if (content === undefined) return;

    set({ saveState: "saving" });
    const ok = runner
      ? await runner.persistChapter(
          chapterId,
          content,
          countWords(content, settings.wordCountMode),
        )
      : false;
    set({
      saveState: ok ? "saved" : "failed",
      lastSavedAt: ok ? Date.now() : state.lastSavedAt,
    });
  };

  /**
   * 排一次防抖保存：每次输入都重置计时器，停顿即落库（PRD §2）。
   * 若在途保存属于**另一章**（换章后立刻输入的场景），旧章立即落库——
   * 防抖计时器只有一个，不能让新章的重排把旧章未保存的尾部编辑丢掉。
   */
  const scheduleSave = (): void => {
    const incomingId = get().activeChapterId;
    if (
      saveTimer !== null &&
      pendingSaveChapterId !== null &&
      pendingSaveChapterId !== incomingId
    ) {
      const staleChapterId = pendingSaveChapterId;
      window.clearTimeout(saveTimer);
      saveTimer = null;
      pendingSaveChapterId = null;
      void persistChapterNow(staleChapterId);
    }
    pendingSaveChapterId = incomingId;
    set({ saveState: "pending" });
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      const chapterId = pendingSaveChapterId;
      pendingSaveChapterId = null;
      if (chapterId) void persistChapterNow(chapterId);
    }, SAVE.debounceMs);
  };

  return {
    draftMap: {},
    activeChapterId: null,
    saveState: "idle",
    lastSavedAt: null,
    settings: DEFAULT_SETTINGS,
    selection: null,
    recoveryDismissed: false,
    todayAdded: 0,
    todayTotal: 0,
    speed: 0,

    setContent: (chapterId, next, baseContent) => {
      const state = get();
      // 字数基线：优先草稿，其次上报方带来的变更前正文（程序化同步场景）
      const previous = state.draftMap[chapterId] ?? baseContent ?? "";
      if (previous === next) {
        // 内容没变（切章灌入 / 输入法中间态 / 重复 dispatch）：不写草稿、
        // 不计字数、也不重启防抖——正在排队的旧章保存因此不受影响
        if (state.activeChapterId !== chapterId) {
          set({ activeChapterId: chapterId });
        }
        return;
      }

      const words = countWords(next, state.settings.wordCountMode);
      const delta = words - countWords(previous, state.settings.wordCountMode);

      // 会话采样：首次输入起算，供 10s 一次的码字速度使用
      if (delta !== 0) {
        session = session ?? { words: 0, startedAt: Date.now() };
        session = { words: session.words + delta, startedAt: session.startedAt };
      }

      set({
        draftMap: { ...state.draftMap, [chapterId]: next },
        activeChapterId: chapterId,
        todayAdded: state.todayAdded + delta,
        todayTotal: state.todayTotal + delta,
      });

      scheduleSave();
    },

    applyExternalContent: (chapterId, next) => {
      const state = get();
      set({
        draftMap: { ...state.draftMap, [chapterId]: next },
        activeChapterId: chapterId,
      });
      scheduleSave();
    },

    flushSave: async () => {
      // 手动保存 / 关窗前 flush：先落库在途防抖针对的章（可能是刚切走的旧章），
      // 再落库当前章；两者同章时只写一次
      const pendingId = pendingSaveChapterId;
      cancelPendingSave();
      if (pendingId) await persistChapterNow(pendingId);
      const currentId = get().activeChapterId;
      if (currentId && currentId !== pendingId) {
        await persistChapterNow(currentId);
      }
    },

    updateSetting: (key, value) => {
      set((state) => ({
        settings: { ...state.settings, [key]: value },
      }));
      runner?.persistSettings(get().settings);
    },

    toggleAnnotationType: (type) => {
      set((state) => {
        const exists = state.settings.annotationTypes.includes(type);
        return {
          settings: {
            ...state.settings,
            annotationTypes: exists
              ? state.settings.annotationTypes.filter((item) => item !== type)
              : [...state.settings.annotationTypes, type],
          },
        };
      });
      runner?.persistSettings(get().settings);
    },

    setSelection: (selection) => set({ selection }),

    markSelection: (type) => {
      const { selection } = get();
      if (!selection || !runner) return null;
      const result = runner.markSelectionAsEntity(selection.text, type);
      set({ selection: null });
      return result;
    },

    dismissRecovery: () => set({ recoveryDismissed: true }),

    hydrateSettings: (settings) => set({ settings }),

    hydrateUsage: (todayWords) => set({ todayTotal: todayWords }),

    setSpeed: (speed) => set({ speed }),

    resetForChapter: (chapterId) =>
      set({ activeChapterId: chapterId, selection: null }),
  };
});

/** 保存态文案（顶栏显示） */
export const saveTextOf = (state: SaveState): string => SAVE_STATE_TEXT[state];

/**
 * 章节草稿订阅：切章时自动拿到该章草稿。
 * 只有真正持有正文的组件会因此重渲染（页面根不再订阅）。
 */
export function useChapterDraft(chapterId: string | null): string | undefined {
  return useNovelEditorStore((state) =>
    chapterId ? state.draftMap[chapterId] : undefined,
  );
}

/** 保存态订阅（顶栏用） */
export function useSaveState(): { saveState: SaveState; lastSavedAt: number | null } {
  const saveState = useNovelEditorStore((state) => state.saveState);
  const lastSavedAt = useNovelEditorStore((state) => state.lastSavedAt);
  return { saveState, lastSavedAt };
}

/**
 * 今日写作统计订阅（状态条用）
 *
 * 逐个标量订阅：任何一项没变就不会带着状态条重渲染，
 * 而「本章字数」只随当前章草稿变化——打字时只有状态条与码字区会动。
 */
export function useWritingStats(): WritingStats {
  const chapterContent = useNovelEditorStore((state) =>
    state.activeChapterId ? state.draftMap[state.activeChapterId] ?? "" : "",
  );
  const wordCountMode = useNovelEditorStore(
    (state) => state.settings.wordCountMode,
  );
  const dailyGoal = useNovelEditorStore((state) => state.settings.dailyGoal);
  const todayAdded = useNovelEditorStore((state) => state.todayAdded);
  const todayTotal = useNovelEditorStore((state) => state.todayTotal);
  const speed = useNovelEditorStore((state) => state.speed);

  return {
    chapterWords: countWords(chapterContent, wordCountMode),
    todayAdded,
    todayTotal,
    speed,
    dailyGoal,
  };
}

/** 采样会话的累计字数（码字速度用） */
export function sessionWords(): number {
  return session?.words ?? 0;
}

/** 采样会话起始时间（码字速度用） */
export function sessionStartedAt(): number | null {
  return session ? session.startedAt : null;
}

/**
 * 稳定动作入口：身份永不变化，可直接当 props 透传，
 * 这样「父层重渲染 → 回调身份变 → 子组件 memo 失效」这条链就断了。
 */
export const editorActions = {
  setContent: (chapterId: string, next: string, baseContent?: string): void => {
    useNovelEditorStore.getState().setContent(chapterId, next, baseContent);
  },
  applyExternalContent: (chapterId: string, next: string): void => {
    useNovelEditorStore.getState().applyExternalContent(chapterId, next);
  },
  flushSave: (): Promise<void> => useNovelEditorStore.getState().flushSave(),
  updateSetting: <K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K],
  ): void => {
    useNovelEditorStore.getState().updateSetting(key, value);
  },
  toggleAnnotationType: (
    type: EditorSettings["annotationTypes"][number],
  ): void => {
    useNovelEditorStore.getState().toggleAnnotationType(type);
  },
  setSelection: (selection: EditorSelection | null): void => {
    useNovelEditorStore.getState().setSelection(selection);
  },
  markSelection: (
    type: EditorSettings["annotationTypes"][number],
  ): MarkResult => useNovelEditorStore.getState().markSelection(type),
  dismissRecovery: (): void => {
    useNovelEditorStore.getState().dismissRecovery();
  },
};
