/**
 * 全书检索状态（模块级 Zustand store）
 *
 * 为什么抽到全局：检索面板此前把 keyword / hits / loading 放在组件内，检索动作挂在
 * `useEffect` 上，依赖数组里含父层传入的 `onSearch`。而「点命中跳章」会触发编辑器
 * 失焦保存 → bundle 更新 → `chapters` 数组重建 → onSearch 身份变化 → effect 重跑 →
 * `loading` 置真 → 骨架屏闪一下。
 *
 * 放在 store 后：检索动作由状态自己触发（纯 JS 防抖调度），不依赖任何 effect 依赖数组，
 * 父组件怎么重渲染都不会重新发起检索；同时 Tab 切走再切回，结果与关键词仍保留
 * （此前 SearchPanel 会随条件渲染卸载，状态丢失）。
 *
 * 边界：store 只管检索状态与调度，不认识 entities（要素名作用域在组件内派生），
 * 也不认识当前章（「本章」过滤在渲染期按 activeChapterId 过滤）。
 */

import { create } from "zustand";
import type { SearchHit } from "../types";

/** 检索作用域：全书 / 本章 / 要素名 */
export type SearchScope = "book" | "chapter" | "entity";

/** 最近搜索保留条数 */
const RECENT_LIMIT = 6;

/** 输入防抖（与 PRD R10 一致） */
const DEBOUNCE_MS = 300;

export interface SearchState {
  keyword: string;
  scope: SearchScope;
  /** 正文检索结果（全书口径）；「本章」在渲染期过滤 */
  hits: SearchHit[];
  loading: boolean;
  recent: string[];
  setKeyword: (keyword: string) => void;
  setScope: (scope: SearchScope) => void;
  clear: () => void;
}

/** 真实的检索实现（searchBook），由 SearchPanel 注册，避免 store 反向依赖页面 */
let runner: ((keyword: string) => Promise<SearchHit[]>) | null = null;

/** 防抖定时器 */
let timer: number | null = null;

/** 请求票据：每次重新调度自增，过期响应直接丢弃 */
let ticket = 0;

/** 已真正检索过的关键词：用它判断「能否直接复用缓存结果」 */
let searchedFor = "";

/** 注册 / 注销检索实现（组件挂载 / 卸载时调用，不触发任何检索） */
export function registerSearchRunner(
  fn: ((keyword: string) => Promise<SearchHit[]>) | null,
): void {
  runner = fn;
}

/** 取消在途调度：清空定时器并作废票据 */
function cancelPending(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  ticket += 1;
}

/** 按当前 keyword / scope 调度一次防抖检索 */
function scheduleSearch(
  set: (
    partial:
      | Partial<SearchState>
      | ((state: SearchState) => Partial<SearchState>),
  ) => void,
  get: () => SearchState,
): void {
  cancelPending();

  const trimmed = get().keyword.trim();
  if (!trimmed) {
    searchedFor = "";
    set({ hits: [], loading: false });
    return;
  }

  // 要素名作用域不走正文检索（组件内内存比对），切过去不重查
  if (get().scope === "entity") {
    set({ loading: false });
    return;
  }

  // 关键词没变（切作用域、父层重渲染、点最近搜索复填）→ 复用缓存，零往返
  if (trimmed === searchedFor) {
    set({ loading: false });
    return;
  }

  set({ loading: true });
  const mine = ticket;
  timer = window.setTimeout(() => {
    timer = null;
    const run = runner;
    if (!run) {
      set({ loading: false });
      return;
    }
    void run(trimmed).then((result) => {
      // 过期响应 / 关键词已被改写：丢弃，避免结果错位
      if (mine !== ticket) return;
      if (get().keyword.trim() !== trimmed) return;
      searchedFor = trimmed;
      set((state) => ({
        hits: result,
        loading: false,
        recent: state.recent.includes(trimmed)
          ? state.recent
          : [trimmed, ...state.recent].slice(0, RECENT_LIMIT),
      }));
    });
  }, DEBOUNCE_MS);
}

export const useSearchStore = create<SearchState>()((set, get) => ({
  keyword: "",
  scope: "book",
  hits: [],
  loading: false,
  recent: [],

  setKeyword: (keyword) => {
    set({ keyword });
    scheduleSearch(set, get);
  },

  setScope: (scope) => {
    set({ scope });
    scheduleSearch(set, get);
  },

  clear: () => {
    cancelPending();
    searchedFor = "";
    set({ keyword: "", hits: [], loading: false });
  },
}));
