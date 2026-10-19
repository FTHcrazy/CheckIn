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
  buildActiveWords,
  buildScanResult,
  DEFAULT_SENSITIVE_CONFIG,
  parseSensitiveConfig,
  sanitizeTerms,
  scanChapter,
  summarizeHits,
  type SensitiveConfig,
  type SensitiveHit,
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
        chapterResultId: null,
        bookResult: null,
        scanningBook: false,
        bookProgress: 0,
      });
    }
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
    const hits = scanChapter(chapter.id, chapter.title, chapter.content, activeWords);
    set({
      chapterResult: buildScanResult(hits, "chapter", Date.now()),
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
      set({
        bookResult: buildScanResult(summarizeHits(collected), "book", Date.now()),
        scanningBook: false,
        bookProgress: 1,
      });
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
    chapterResultId: null,
    bookResult: null,
    scanningChapter: false,
    scanningBook: false,
    bookProgress: 0,
    jumpTarget: null,
  });
}
