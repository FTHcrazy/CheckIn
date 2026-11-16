import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { QUESTION_BANK } from "../data/interview-bank";
import {
  PAGE_SIZE,
  collectTags,
  countByCategory,
  createInitialFilterState,
  filterQuestions,
  interviewFilterReducer,
  paginate,
  sortQuestions,
  type CategoryCounts,
} from "../data/interview-filter-utils";
import type {
  CategoryKey,
  DifficultyKey,
  InterviewFilterState,
  InterviewQuestion,
  QuestionTrack,
  SortBy,
} from "../data/interview-types";
import { useInterviewFavorites } from "./useInterviewFavorites";

/** 输入防抖窗口：300ms 是「打字不卡」与「停下就出结果」的折中 */
const KEYWORD_DEBOUNCE_MS = 300;

export interface InterviewPageApi {
  filter: InterviewFilterState;
  /** 输入框的即时值（受控），与 `filter.keyword` 之间隔着 300ms 防抖 */
  keywordInput: string;
  setKeywordInput: (value: string) => void;
  submitKeyword: () => void;
  questions: InterviewQuestion[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  counts: CategoryCounts;
  tagOptions: string[];
  favorites: ReadonlySet<string>;
  favoriteCount: number;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  setTrack: (track: QuestionTrack) => void;
  setCategory: (categoryId: CategoryKey) => void;
  setDifficulty: (difficulty: DifficultyKey) => void;
  toggleTag: (tag: string) => void;
  setTags: (tags: string[]) => void;
  clearTags: () => void;
  setFavoritesOnly: (favoritesOnly: boolean) => void;
  setSortBy: (sortBy: SortBy) => void;
  setPage: (page: number) => void;
  reset: () => void;
}

/**
 * 前端面试题页面的全部状态与派生数据。
 *
 * 数据流是单向的：`filter`（唯一状态）→ `filtered` → `counts` / `sorted` → `paged`。
 * 四步都用 `useMemo` 串起来，任何一环变化只重算它下游，题库本身不参与渲染。
 */
export function useInterviewPage(): InterviewPageApi {
  const [filter, dispatch] = useReducer(
    interviewFilterReducer,
    undefined,
    createInitialFilterState,
  );
  const [keywordInput, setKeywordInput] = useState<string>(
    () => createInitialFilterState().keyword,
  );
  const { favorites, favoriteCount, isFavorite, toggle } =
    useInterviewFavorites();

  // 防抖提交：输入停顿 300ms 才真正参与筛选，回车走 submitKeyword 立即提交
  useEffect(() => {
    const trimmed = keywordInput.trim();
    if (trimmed === filter.keyword) return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "setKeyword", keyword: trimmed });
    }, KEYWORD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [keywordInput, filter.keyword]);

  const submitKeyword = useCallback(() => {
    dispatch({ type: "setKeyword", keyword: keywordInput });
  }, [keywordInput]);

  const filtered = useMemo(
    () => filterQuestions(QUESTION_BANK, filter, favorites),
    [filter, favorites],
  );
  const counts = useMemo(
    () => countByCategory(QUESTION_BANK, filter, favorites),
    [filter, favorites],
  );
  const sorted = useMemo(
    () => sortQuestions(filtered, filter.sortBy),
    [filtered, filter.sortBy],
  );
  const paged = useMemo(
    () => paginate(sorted, filter.page, PAGE_SIZE),
    [sorted, filter.page],
  );
  const tagOptions = useMemo(
    () => collectTags(QUESTION_BANK, filter.track, 10),
    [filter.track],
  );

  const setTrack = useCallback((track: QuestionTrack) => {
    dispatch({ type: "setTrack", track });
  }, []);
  const setCategory = useCallback((categoryId: CategoryKey) => {
    dispatch({ type: "setCategory", categoryId });
  }, []);
  const setDifficulty = useCallback((difficulty: DifficultyKey) => {
    dispatch({ type: "setDifficulty", difficulty });
  }, []);
  const toggleTag = useCallback((tag: string) => {
    dispatch({ type: "toggleTag", tag });
  }, []);
  const clearTags = useCallback(() => {
    dispatch({ type: "clearTags" });
  }, []);
  const setTags = useCallback((tags: string[]) => {
    dispatch({ type: "setTags", tags });
  }, []);
  const setFavoritesOnly = useCallback((favoritesOnly: boolean) => {
    dispatch({ type: "setFavoritesOnly", favoritesOnly });
  }, []);
  const setSortBy = useCallback((sortBy: SortBy) => {
    dispatch({ type: "setSortBy", sortBy });
  }, []);
  const setPage = useCallback((page: number) => {
    dispatch({ type: "setPage", page });
  }, []);
  const reset = useCallback(() => {
    setKeywordInput("");
    dispatch({ type: "reset" });
  }, []);

  return {
    filter,
    keywordInput,
    setKeywordInput,
    submitKeyword,
    questions: paged.items,
    total: paged.total,
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: PAGE_SIZE,
    counts,
    tagOptions,
    favorites,
    favoriteCount,
    isFavorite,
    toggleFavorite: toggle,
    setTrack,
    setCategory,
    setDifficulty,
    toggleTag,
    setTags,
    clearTags,
    setFavoritesOnly,
    setSortBy,
    setPage,
    reset,
  };
}
