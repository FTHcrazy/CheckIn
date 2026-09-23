/**
 * 备忘搜索状态（模块级 Zustand store）
 *
 * 与 `useMemoStore` 分开：搜索框每敲一个字都在变，若跟编辑态混在一起，
 * 搜索时也会把「正在编辑的正文」订阅者一起叫醒。
 *
 * 搜索态由持有搜索框的 `MemoHeader` 订阅；编辑区 / 预览区只订阅
 * `activeSearchQuery / activeSearchIndex`（回车才变，不是每键都变），
 * 于是「输入搜索词」只重渲染搜索框本身。
 *
 * `find()` 从 `useMemoStore` 读当前正文（编辑态用草稿、预览态用原文），
 * 返回是否命中——提示文案交给调用方，store 不碰 UI。
 */

import { create } from "zustand";
import { useMemoStore } from "./useMemoStore";

export interface MemoSearchState {
  searchOpen: boolean;
  /** 输入框里的即时值 */
  searchQuery: string;
  /** 已执行查找的关键词（决定高亮） */
  activeSearchQuery: string;
  /** 当前高亮到的第几个匹配 */
  activeSearchIndex: number;

  setSearchQuery: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
  /** 关闭搜索并清掉高亮 */
  closeSearch: () => void;
  /** 执行查找 / 找下一个；返回是否命中 */
  find: () => boolean;
}

export const useMemoSearchStore = create<MemoSearchState>()((set, get) => ({
  searchOpen: false,
  searchQuery: "",
  activeSearchQuery: "",
  activeSearchIndex: 0,

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSearchOpen: (open) => set({ searchOpen: open }),

  closeSearch: () =>
    set({ searchOpen: false, searchQuery: "", activeSearchQuery: "", activeSearchIndex: 0 }),

  find: () => {
    const query = get().searchQuery.trim();
    if (!query) return false;

    const editor = useMemoStore.getState();
    const source = editor.isEditing ? editor.content : editor.originalContent;
    const matches = source.match(
      new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    );
    if (!matches?.length) return false;

    set((state) => ({
      activeSearchQuery: query,
      activeSearchIndex:
        query === state.activeSearchQuery
          ? (state.activeSearchIndex + 1) % matches.length
          : 0,
    }));
    return true;
  },
}));

/** 稳定动作入口 */
export const memoSearchActions = {
  setSearchQuery: (query: string): void => {
    useMemoSearchStore.getState().setSearchQuery(query);
  },
  closeSearch: (): void => {
    useMemoSearchStore.getState().closeSearch();
  },
};
