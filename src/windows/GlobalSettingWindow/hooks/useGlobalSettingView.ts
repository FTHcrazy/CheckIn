/**
 * 全局设定中心 · 窗口私有视图状态 hook
 *
 * 只管「怎么看」，不管「怎么存」：搜索词 / 筛选 / 排序视图 / 就地改名 / 选中移动 /
 * 批量勾选。全部是窗口私有、即关即销的内存态 —— **不落库、不持久化、不触发 IPC**
 * （R1⑤ / R2③ 的硬要求：搜索期间 `globalCategoryOrder` 调用次数必须为 0）。
 *
 * 与 `useSettingCenter` 的分工：
 * - `useSettingCenter` 是共享状态机（选中 id、草稿、拖拽、三个弹窗），本 hook 不改它；
 * - 本 hook 只在它给出的 `sorted`（已按 sortOrder）之上算一份**显示用的**子集。
 *
 * ⚠️ 排序视图只影响**显示顺序**：切到「按名称」不会改 sortOrder，也**不允许拖拽**
 * （`canDrag` 三条件与门）—— `handleDragEnd` 的分类重排分支按全量 `sorted` 算下标，
 * 只有全量按 sortOrder 显示时下标才对。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SettingCategory } from "@/shared/novel/setting-types";
import {
  emptyKindOf,
  nextIdInList,
  type GsCategoryFilter,
  type GsEmptyKind,
  type GsSortMode,
  visibleCategories,
} from "./gs-view-utils";

export interface GsViewParams {
  /** 全量分类（传 `c.sorted`，已按 sortOrder 升序） */
  categories: SettingCategory[];
  /** 当前选中的分类 id（传 `c.activeIdResolved`） */
  activeId: string;
  /** 切换选中（传 `c.setActiveId`） */
  onSelect: (id: string) => void;
  /** 提交改名（由 `GsBody` 接到 `data.onPatchCategory` 上） */
  onRename: (id: string, name: string) => void;
}

export interface GsView {
  // ── 搜索 / 筛选 / 排序 ──
  keyword: string;
  setKeyword: (value: string) => void;
  clearKeyword: () => void;
  filter: GsCategoryFilter;
  setFilter: (value: GsCategoryFilter) => void;
  sortMode: GsSortMode;
  setSortMode: (value: GsSortMode) => void;
  /** 当前可见的分类（过滤 ∩ 排序后的结果） */
  visible: SettingCategory[];
  /** 与 `visible` 同序的 id 列表（↑/↓ 选中移动的坐标系） */
  visibleIds: string[];
  emptyKind: GsEmptyKind;
  /** 只有「自定义顺序 + 无搜索词 + 无筛选」才允许拖拽 */
  canDrag: boolean;
  // ── 就地改名 ──
  renamingId: string | null;
  beginRename: (id: string) => void;
  /** 空 / 纯空白 ⇒ 取消（保持原值退出编辑） */
  commitRename: (value: string) => void;
  cancelRename: () => void;
  // ── 选中移动（↑/↓） ──
  moveSelection: (delta: number) => void;
  // ── 批量勾选（R10） ──
  batchSelecting: boolean;
  setBatchSelecting: (value: boolean) => void;
  selectedLevelIds: string[];
  toggleLevelSelected: (id: string) => void;
  clearLevelSelection: () => void;
}

export function useGlobalSettingView(params: GsViewParams): GsView {
  const { categories, activeId, onSelect, onRename } = params;

  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<GsCategoryFilter>("all");
  const [sortMode, setSortMode] = useState<GsSortMode>("custom");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [batchSelecting, setBatchSelecting] = useState(false);
  const [selectedLevelIds, setSelectedLevelIds] = useState<string[]>([]);

  /**
   * 改名目标 id 的镜像。
   *
   * 提交由输入框的 `blur` / `Enter` 触发，那一刻 `renamingId` 可能已被别的
   * 更新清掉；用 ref 记一份，保证「提交的一定是刚在改的那一条」。
   */
  const renamingIdRef = useRef<string | null>(null);

  const clearKeyword = useCallback((): void => {
    setKeyword("");
  }, []);

  const beginRename = useCallback((id: string): void => {
    renamingIdRef.current = id;
    setRenamingId(id);
  }, []);

  const cancelRename = useCallback((): void => {
    renamingIdRef.current = null;
    setRenamingId(null);
  }, []);

  const toggleLevelSelected = useCallback((id: string): void => {
    setSelectedLevelIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }, []);

  const clearLevelSelection = useCallback((): void => {
    setSelectedLevelIds((prev) => (prev.length === 0 ? prev : []));
  }, []);

  /**
   * 换分类即清掉「上一条分类的局部交互态」。
   *
   * 依赖用 **id**（`activeId`）而不是 `active` 派生对象 —— 后者每次写后重载都是
   * 新引用，会把「换分类才做」的副作用变成「每次数据刷新都做」，正在改的名字会被打断。
   */
  useEffect(() => {
    renamingIdRef.current = null;
    setRenamingId(null);
    setSelectedLevelIds((prev) => (prev.length === 0 ? prev : []));
  }, [activeId]);

  const visible = useMemo(
    () => visibleCategories(categories, keyword, filter, sortMode),
    [categories, keyword, filter, sortMode],
  );

  const visibleIds = useMemo(() => visible.map((item) => item.id), [visible]);

  const emptyKind = emptyKindOf(categories.length, visible.length);

  const canDrag = sortMode === "custom" && keyword.trim() === "" && filter === "all";

  /** ↑/↓：在**当前过滤结果**内移动选中（不是全量） */
  const moveSelection = useCallback(
    (delta: number): void => {
      const next = nextIdInList(visibleIds, activeId, delta);
      if (next) onSelect(next);
    },
    [visibleIds, activeId, onSelect],
  );

  /** 提交改名：空 / 纯空白 ⇒ 取消（保持原值退出编辑） */
  const commitRename = useCallback(
    (value: string): void => {
      const id = renamingIdRef.current;
      renamingIdRef.current = null;
      setRenamingId(null);
      const trimmed = value.trim();
      if (!id || !trimmed) return;
      onRename(id, trimmed);
    },
    [onRename],
  );

  return {
    keyword,
    setKeyword,
    clearKeyword,
    filter,
    setFilter,
    sortMode,
    setSortMode,
    visible,
    visibleIds,
    emptyKind,
    canDrag,
    renamingId,
    beginRename,
    commitRename,
    cancelRename,
    moveSelection,
    batchSelecting,
    setBatchSelecting,
    selectedLevelIds,
    toggleLevelSelected,
    clearLevelSelection,
  };
}
