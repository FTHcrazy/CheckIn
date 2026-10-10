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
   * 上报正文变化。语义由 `baseContent` 区分两类来源：
   *
   * - **用户输入**（编辑器传 `update.startState.doc` 或省略）：以「变更前正文」为基线，
   *   差值计入今日新增与会话字数。
   * - **程序化灌入**（切章 / 回滚 / 恢复）：编辑器必须传 `baseContent === next`。
   *   此时 `previous` 必然等于 `next`，走下方早返回分支 —— 只切换 activeChapterId。
   *   ⚠️ 灌入若也传「变更前正文」，会导致爆破式字数：首次进入把整章字数算成今日新增，
   *   长章切短章则出现负增长（EditorPane 的 hydratingRef 就是为此存在）。
   */
  setContent: (chapterId: string, next: string, baseContent?: string) => void;
  applyExternalContent: (chapterId: string, next: string) => void;
  /** 返回是否全部落库成功（调用方据此决定提示文案，不要无条件说「已保存」） */
  flushSave: () => Promise<boolean>;
  updateSetting: <K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K],
  ) => void;
  toggleAnnotationType: (type: EditorSettings["annotationTypes"][number]) => void;
  setSelection: (selection: EditorSelection | null) => void;
  markSelection: (type: EditorSettings["annotationTypes"][number]) => MarkResult;
  dismissRecovery: () => void;
  /**
   * 丢弃某一章的草稿（删章时调用）。
   *
   * 草稿的生命周期与库里的章节是两套账：章节被删后，指向它的在途防抖
   * 仍会在 800ms 后拿这个 id 去落库，而 `novel-chapter-save` 找不到章节会
   * 如实返回 false —— 于是 saveState 永久停在 "failed"，30s 兜底每半分钟
   * 重试一次注定失败的请求，顶栏也一直红着「保存失败」，可真实情况是
   * 「没有任何东西需要保存」。删章必须连带把草稿与在途防抖一起撤掉。
   */
  dropChapterDraft: (chapterId: string) => void;
  /** 丢弃全部草稿（删作品 / 重置模板库：章节 id 整批换掉，旧草稿全部失效） */
  clearDrafts: () => void;
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
  /**
   * 落库指定章节的草稿（无论当前处于哪个保存态）。
   *
   * 返回是否成功：调用方据此决定提示文案与是否需要提醒用户。
   * 没有草稿时算成功——本来就无需写，不是失败。
   */
  const persistChapterNow = async (chapterId: string): Promise<boolean> => {
    const state = get();
    const { draftMap, settings } = state;

    const content = draftMap[chapterId];
    if (content === undefined) return true;

    set({ saveState: "saving" });
    let ok: boolean;
    try {
      ok = runner
        ? await runner.persistChapter(
            chapterId,
            content,
            countWords(content, settings.wordCountMode),
          )
        : false;
    } catch {
      // 必须在这里收住：IPC reject（写盘失败 / 主进程异常）会让整个 async 抛出去，
      // 而调用点是 void 调用 → 变成 unhandled rejection，且下面这行 set 永不执行，
      // saveState 永久停在 "saving"，此后所有兜底通道都不再重试
      ok = false;
    }
    set({
      saveState: ok ? "saved" : "failed",
      lastSavedAt: ok ? Date.now() : state.lastSavedAt,
    });
    return ok;
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

    /**
     * 程序化改写正文（回滚快照 / 崩溃恢复）。
     *
     * 与 `setContent` 的区别是**它确实改变了正文**，所以字数必须跟着走：
     * 回滚到一份更短的旧正文时，主进程 `novel-chapter-save` 是按
     * `wordCount - 库里旧字数` 记负 delta 的，今日累计在库里会如实回退；
     * 若渲染层不跟着减，状态条的「今日新增」就与库里的统计对不上，
     * 一直错到下次重启（hydrateUsage 才会把它拉回来）。
     */
    applyExternalContent: (chapterId, next) => {
      const state = get();
      const previous = state.draftMap[chapterId] ?? "";
      if (previous === next) {
        if (state.activeChapterId !== chapterId) {
          set({ activeChapterId: chapterId });
        }
        return;
      }
      const delta =
        countWords(next, state.settings.wordCountMode) -
        countWords(previous, state.settings.wordCountMode);
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

    flushSave: async () => {
      // 手动保存 / 关窗前 flush：先落库在途防抖针对的章（可能是刚切走的旧章），
      // 再落库当前章；两者同章时只写一次
      const pendingId = pendingSaveChapterId;
      cancelPendingSave();
      const staleOk = pendingId ? await persistChapterNow(pendingId) : true;
      const currentId = get().activeChapterId;
      const currentOk =
        currentId && currentId !== pendingId
          ? await persistChapterNow(currentId)
          : true;
      return staleOk && currentOk;
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

    dropChapterDraft: (chapterId) => {
      const state = get();
      // 在途防抖若正是这一章，连定时器一起撤掉：章节都没了，没得可存
      const wasPending = pendingSaveChapterId === chapterId;
      if (wasPending) cancelPendingSave();
      if (!(chapterId in state.draftMap)) return;
      const draftMap = { ...state.draftMap };
      delete draftMap[chapterId];
      set({
        draftMap,
        // 撤掉的是唯一的在途保存 → 回到 idle，别把 pending 留给兜底通道
        saveState:
          wasPending && state.saveState === "pending" ? "idle" : state.saveState,
      });
    },

    clearDrafts: () => {
      cancelPendingSave();
      set({
        draftMap: {},
        activeChapterId: null,
        selection: null,
        saveState: "idle",
      });
    },

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
 * 是否值得再 flush 一次。
 *
 * `pending` 是防抖在途，`failed` 是上一次落库没成功 —— **两者都必须重试**。
 * 只判 pending 的后果是：一次 IPC 抖动后就再也没人去救那段草稿，
 * 而此时用户看到的仍是「已保存」类文案，直到关窗才发现正文丢了。
 */
export function needsFlushSave(): boolean {
  const { saveState } = useNovelEditorStore.getState();
  return saveState === "pending" || saveState === "failed";
}

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
  flushSave: (): Promise<boolean> => useNovelEditorStore.getState().flushSave(),
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
  dropChapterDraft: (chapterId: string): void => {
    useNovelEditorStore.getState().dropChapterDraft(chapterId);
  },
  clearDrafts: (): void => {
    useNovelEditorStore.getState().clearDrafts();
  },
};
