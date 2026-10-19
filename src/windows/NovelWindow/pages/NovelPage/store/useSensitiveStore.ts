/**
 * 敏感词检测状态（模块级 Zustand store）
 *
 * 为什么抽到模块级：词库与扫描结果要被三处同时消费——
 * 编辑器高亮层（词库）、右栏检测面板（结果 / 词库管理）、底部状态条（计数）。
 * 走 props 透传会让页面根持有全部结果，切一次 Tab 或扫一次全书就推整棵树。
 *
 * 两种检测机制（用户自己选，持久化在 `SensitiveConfig.mode`）：
 *   - `auto`   边写边扫当前章。正文每次变更打一个 500ms 防抖，
 *              扫完只更新 `chapterResult`，编辑器同时实时高亮
 *   - `manual` 只在面板里点「扫描本章 / 扫描全书」时检测
 *   - `off`    完全不检测（编辑器也不高亮）
 *
 * 全书扫描走分批调度：3000 章一次性同步扫会占满主线程（`useAppearanceStore`
 * 踩过同一个坑，实测 9 秒假死）。每批 `BOOK_BATCH_SIZE` 章后让出主线程，
 * 结果渐进刷新，面板顶部有进度可看。
 */

import { create } from "zustand";
import {
  bucketMatches,
  buildActiveWords,
  buildScanResult,
  DEFAULT_SENSITIVE_CONFIG,
  parseSensitiveConfig,
  sanitizeTerms,
  scanChapter,
  scanChapterWithMatches,
  summarizeHits,
  type SensitiveConfig,
  type SensitiveHit,
  type SensitiveRange,
  type SensitiveScanMode,
  type SensitiveScanResult,
} from "../sensitive";
import type { NovelChapter } from "../types";

/**
 * 持久化实现由页面注入（AGENTS §6.2：store 不 import service）。
 * 组件挂载时注册、卸载时注销，注册动作本身不发起任何请求。
 */
export interface SensitivePersistence {
  load: () => Promise<string | null>;
  save: (config: SensitiveConfig) => Promise<boolean>;
}

let persistence: SensitivePersistence | null = null;

export function registerSensitivePersistence(
  impl: SensitivePersistence | null,
): void {
  persistence = impl;
}

/** 自动扫描防抖：比保存（800ms）短，改完字很快能看到结果 */
const AUTO_SCAN_DEBOUNCE_MS = 500;

/** config 落库防抖：增删词条是连点操作，攒一下再写 */
const CONFIG_SAVE_DEBOUNCE_MS = 500;

/** 全书扫描单批章数：200 章 × ~0.1ms ≈ 一帧内，超过就掉帧 */
const BOOK_BATCH_SIZE = 200;

/** 面板点结果时的跳转意图，由页面侧消费后清空 */
export interface SensitiveJumpTarget {
  chapterId: string;
  from: number;
}

export interface SensitiveState {
  config: SensitiveConfig;
  /** 合并后的实际词库（内置 - 屏蔽 + 用户），派生自 config */
  activeWords: string[];
  /** 首次读盘是否完成 */
  ready: boolean;

  /** 本章扫描结果（自动模式随输入刷新） */
  chapterResult: SensitiveScanResult | null;
  /**
   * 本章每一处命中的原文区间（手动模式的标注源）。
   *
   * `SensitiveHit` 是「词 × 章」的聚合、每个词只留首个位置，标红不够用；
   * 这里存逐处区间。**没有扫描结果时为 null/空** —— 手动模式据此做到
   * 「没扫过就一个字不标」，标注与面板列表、状态条计数三者同源。
   */
  chapterMatches: SensitiveRange[] | null;
  /** `chapterResult` 实际扫的是哪一章：面板据此判断结果是否已过期 */
  chapterResultId: string | null;
  /** 全书扫描结果 */
  bookResult: SensitiveScanResult | null;
  scanningChapter: boolean;
  scanningBook: boolean;
  /** 全书扫描进度 0–1 */
  bookProgress: number;

  jumpTarget: SensitiveJumpTarget | null;

  /** 读盘（幂等，页面挂载时调一次） */
  load: () => void;
  setMode: (mode: SensitiveScanMode) => void;
  /** 批量加词，返回实际新增 / 跳过的条数 */
  addWords: (terms: readonly string[]) => { added: number; skipped: number };
  /** 删除用户词 / 屏蔽内置词 */
  removeWord: (term: string) => void;
  /** 取消屏蔽内置词 */
  restoreBuiltin: (term: string) => void;
  /** 重命名词条；空串或重名返回 false */
  renameWord: (from: string, to: string) => boolean;

  /** 扫当前章（手动按钮 / 自动防抖都走这里） */
  scanCurrentChapter: (chapter: { id: string; title: string; content: string }) => void;
  /**
   * 正文脉搏：编辑器每次内容变更调一次。
   *
   * 两个职责：① 记录最新草稿（面板的手动「扫描本章」用它，避免页面根
   * 为了拿实时正文而订阅草稿、每敲一个字重渲染整棵树）；
   * ② `auto` 模式下打防抖、扫完更新结果。
   */
  noteDraft: (chapter: { id: string; title: string; content: string }) => void;
  /** 用最近一次记录的草稿扫本章；没有记录时返回 false */
  scanLatestDraft: () => boolean;
  /**
   * 正文编辑后，编辑器把「跟着挪过」的区间报回来。
   *
   * 只接受**本章**的上报（结果换了章就丢弃，避免把 A 章的坐标写到 B 章）。
   * 不重跑扫描：区间就是扫描结论，只是坐标随编辑平移了，这里只重算聚合
   * （词数 / 处数 / 跳转位置 / 上下文片段），让面板与正文高亮同源。
   */
  syncChapterRanges: (chapterId: string, ranges: SensitiveRange[]) => void;
  /** 全书扫描（分批） */
  scanBook: (chapters: readonly NovelChapter[]) => void;
  /** 中止在途的全书扫描 */
  cancelBookScan: () => void;

  /** 面板点结果 → 记录跳转意图 */
  requestJump: (target: SensitiveJumpTarget) => void;
  consumeJump: () => void;
  /** 切作品：清结果与在途调度，保留词库 */
  resetResults: () => void;
}

// ── 模块级调度句柄（不进 state：它们不该触发重渲染）────────────────────

let autoTimer: number | null = null;
let saveTimer: number | null = null;
let bookCancel: (() => void) | null = null;
let loaded = false;

/**
 * 最近一次的正文草稿（模块级，不进 state）。
 *
 * 放这里而不是 state：正文每敲一个字都变，进 state 会让所有订阅者
 * （面板、状态条）跟着逐键重渲染。只有「点扫描本章」这一下才需要读它。
 */
let latestDraft: { id: string; title: string; content: string } | null = null;

function clearAutoTimer(): void {
  if (autoTimer !== null) {
    window.clearTimeout(autoTimer);
    autoTimer = null;
  }
}

function cancelBook(): void {
  bookCancel?.();
  bookCancel = null;
}

function scheduleIdle(task: () => void): () => void {
  const host = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof host.requestIdleCallback === "function") {
    const handle = host.requestIdleCallback(task, { timeout: 300 });
    return () => host.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(task, 0);
  return () => clearTimeout(handle);
}

/**
 * config 变更统一出口：同步派生词库 + 防抖落库。
 *
 * `invalidate` 在**词库本身变了**时为 true：旧结果是用旧词库算出来的，
 * 留着会给出错误结论（删掉的词还在列表里）。只切扫描模式时不清，
 * 免得用户从自动切到手动的瞬间面板突然变空。
 */
function applyConfig(
  set: (partial: Partial<SensitiveState>) => void,
  next: SensitiveConfig,
  invalidate = false,
): void {
  const patch: Partial<SensitiveState> = {
    config: next,
    activeWords: buildActiveWords(next),
  };
  if (invalidate) {
    patch.chapterResult = null;
    patch.chapterMatches = null;
    patch.chapterResultId = null;
    patch.bookResult = null;
  }
  set(patch);
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    // 未注册持久化（单测 / 面板未挂载）时静默跳过：内存词库仍然有效
    void persistence?.save(next).catch(() => {
      // 落库失败不阻断使用：内存里的词库仍然有效，下次改动会再写一次
    });
  }, CONFIG_SAVE_DEBOUNCE_MS);
}

export const useSensitiveStore = create<SensitiveState>()((set, get) => ({
  config: { ...DEFAULT_SENSITIVE_CONFIG },
  activeWords: buildActiveWords(DEFAULT_SENSITIVE_CONFIG),
  ready: false,
  chapterResult: null,
  chapterMatches: null,
  chapterResultId: null,
  bookResult: null,
  scanningChapter: false,
  scanningBook: false,
  bookProgress: 0,
  jumpTarget: null,

  load: () => {
    if (loaded) return;
    loaded = true;
    const impl = persistence;
    if (!impl) {
      set({ ready: true });
      return;
    }
    void impl
      .load()
      .then((raw) => {
        const config = parseSensitiveConfig(raw);
        set({ config, activeWords: buildActiveWords(config), ready: true });
      })
      .catch(() => {
        set({ ready: true });
      });
  },

  setMode: (mode) => {
    const { config } = get();
    if (config.mode === mode) return;
    clearAutoTimer();
    applyConfig(set, { ...config, mode });
    // 关掉检测时把已有结果一起清掉，避免面板显示上一模式的陈旧数据
    if (mode === "off") {
      cancelBook();
      set({
        chapterResult: null,
        chapterMatches: null,
        chapterResultId: null,
        bookResult: null,
        scanningBook: false,
        bookProgress: 0,
      });
      return;
    }
    /*
     * 切到自动：立刻补一次扫描。
     *
     * 自动模式的正文是「按词库实时标」的，而角标计数读扫描结果 —— 不补这一次，
     * 切过来会有一个「正文已经标了、计数还是上一次的」窗口期，直到用户下一次
     * 停笔才对齐。防抖仍然走 500ms，只是把触发点从「敲字」挪到「切模式」。
     */
    if (mode === "auto" && latestDraft) get().noteDraft(latestDraft);
  },

  addWords: (terms) => {
    const clean = sanitizeTerms(terms);
    const { config } = get();
    const existing = new Set([...config.words, ...buildActiveWords(config)]);
    const mutedNow = new Set(config.muted);
    // 已屏蔽的内置词重新导入 = 恢复它，而不是加进用户库
    const revived = clean.filter((term) => mutedNow.has(term));
    const fresh = clean.filter(
      (term) => !existing.has(term) && !mutedNow.has(term),
    );
    if (fresh.length === 0 && revived.length === 0) {
      return { added: 0, skipped: clean.length };
    }
    const muted = revived.length
      ? config.muted.filter((term) => !revived.includes(term))
      : config.muted;
    applyConfig(
      set,
      { ...config, words: [...config.words, ...fresh], muted },
      true,
    );
    return {
      added: fresh.length + revived.length,
      skipped: clean.length - fresh.length - revived.length,
    };
  },

  removeWord: (term) => {
    const { config } = get();
    if (config.words.includes(term)) {
      applyConfig(
        set,
        { ...config, words: config.words.filter((item) => item !== term) },
        true,
      );
      return;
    }
    if (!config.muted.includes(term)) {
      applyConfig(set, { ...config, muted: [...config.muted, term] }, true);
    }
  },

  restoreBuiltin: (term) => {
    const { config } = get();
    if (!config.muted.includes(term)) return;
    applyConfig(
      set,
      { ...config, muted: config.muted.filter((item) => item !== term) },
      true,
    );
  },

  renameWord: (from, to) => {
    const { config } = get();
    const next = to.replace(/\s+/g, " ").trim();
    if (!next || next === from) return false;
    if (!config.words.includes(from)) return false;
    if (config.words.includes(next) || buildActiveWords(config).includes(next)) return false;
    applyConfig(
      set,
      {
        ...config,
        words: config.words.map((item) => (item === from ? next : item)),
      },
      true,
    );
    return true;
  },

  scanCurrentChapter: (chapter) => {
    const { activeWords } = get();
    const { hits, matches } = scanChapterWithMatches(
      chapter.id,
      chapter.title,
      chapter.content,
      activeWords,
    );
    set({
      chapterResult: buildScanResult(hits, "chapter", Date.now()),
      chapterMatches: matches,
      chapterResultId: chapter.id,
      scanningChapter: false,
    });
  },

  noteDraft: (chapter) => {
    latestDraft = chapter;
    if (get().config.mode !== "auto") return;
    clearAutoTimer();
    autoTimer = window.setTimeout(() => {
      autoTimer = null;
      get().scanCurrentChapter(chapter);
    }, AUTO_SCAN_DEBOUNCE_MS);
  },

  scanLatestDraft: () => {
    const draft = latestDraft;
    if (!draft) return false;
    get().scanCurrentChapter(draft);
    return true;
  },

  syncChapterRanges: (chapterId, ranges) => {
    const state = get();
    // 没扫过（手动模式）或结果属于别的章：这条上报无处可落，丢弃
    if (state.chapterMatches === null || state.chapterResultId !== chapterId) return;
    const draft = latestDraft;
    const { hits } = bucketMatches(
      ranges,
      draft?.content ?? "",
      chapterId,
      draft?.title ?? "",
    );
    // 扫描时间保持第一次扫描的那个：结果还是同一次扫描的结论，只是坐标挪了，
    // 每敲一次字就刷新时间会让面板看起来像「一直在重扫」
    const scannedAt = state.chapterResult?.scannedAt ?? Date.now();
    set({
      chapterMatches: ranges,
      chapterResult: buildScanResult(hits, "chapter", scannedAt),
    });
  },

  scanBook: (chapters) => {
    if (get().scanningBook) return;
    cancelBook();

    const words = get().activeWords;
    const total = chapters.length;
    if (total === 0) {
      set({
        bookResult: buildScanResult([], "book", Date.now()),
        scanningBook: false,
        bookProgress: 1,
      });
      return;
    }

    const collected: SensitiveHit[] = [];
    let cursor = 0;
    set({ scanningBook: true, bookProgress: 0 });

    const pump = (): void => {
      const end = Math.min(cursor + BOOK_BATCH_SIZE, total);
      for (; cursor < end; cursor += 1) {
        const chapter = chapters[cursor];
        for (const hit of scanChapter(
          chapter.id,
          chapter.title,
          chapter.content,
          words,
        )) {
          collected.push(hit);
        }
      }

      if (cursor < total) {
        // 进度先落，再让出主线程；面板据此显示「已扫 N/M 章」
        set({ bookProgress: cursor / total });
        bookCancel = scheduleIdle(pump);
        return;
      }

      bookCancel = null;
      const patch: Partial<SensitiveState> = {
        bookResult: buildScanResult(summarizeHits(collected), "book", Date.now()),
        scanningBook: false,
        bookProgress: 1,
      };
      /*
       * 全书扫完顺手把「本章」也刷新一次。
       *
       * 手动模式的正文红字来自 `chapterMatches`，状态条计数读 `chapterResult` ——
       * 只更新全书结果的话，扫完全书会「正文标红了、角标还是 0」，又是一次
       * 「这些红色从哪来」。用 latestDraft 而不是列表里的 content：前者含未保存
       * 的编辑，和屏幕上看到的正文是同一份。
       */
      const draft = latestDraft;
      if (draft) {
        const chapterScan = scanChapterWithMatches(
          draft.id,
          draft.title,
          draft.content,
          words,
        );
        patch.chapterResult = buildScanResult(chapterScan.hits, "chapter", Date.now());
        patch.chapterMatches = chapterScan.matches;
        patch.chapterResultId = draft.id;
      }
      set(patch);
    };

    pump();
  },

  cancelBookScan: () => {
    cancelBook();
    set({ scanningBook: false });
  },

  requestJump: (target) => set({ jumpTarget: target }),
  consumeJump: () => set({ jumpTarget: null }),

  resetResults: () => {
    clearAutoTimer();
    cancelBook();
    latestDraft = null;
    set({
      chapterResult: null,
      chapterMatches: null,
      chapterResultId: null,
      bookResult: null,
      scanningChapter: false,
      scanningBook: false,
      bookProgress: 0,
      jumpTarget: null,
    });
  },
}));

/**
 * 测试 / 切作品时重置模块级状态。
 *
 * store 是模块级单例，用例之间会串（AGENTS 记忆里的既有坑）：
 * 定时器与 `loaded` 标记都不在 state 里，必须显式清。
 */
export function resetSensitiveStoreForTest(): void {
  clearAutoTimer();
  cancelBook();
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  loaded = false;
  latestDraft = null;
  useSensitiveStore.setState({
    config: { ...DEFAULT_SENSITIVE_CONFIG },
    activeWords: buildActiveWords(DEFAULT_SENSITIVE_CONFIG),
    ready: false,
    chapterResult: null,
    chapterMatches: null,
    chapterResultId: null,
    bookResult: null,
    scanningChapter: false,
    scanningBook: false,
    bookProgress: 0,
    jumpTarget: null,
  });
}
