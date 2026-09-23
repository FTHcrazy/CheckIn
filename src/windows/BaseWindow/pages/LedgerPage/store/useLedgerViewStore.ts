/**
 * 记账视图状态（模块级 Zustand store）
 *
 * 为什么搬出来：周期 / 筛选 / 占比口径原先是页面根 `useLedgerViewState`
 * 里的 `useState`，于是**在筛选框里敲一个字**就会让 LedgerPage 整棵树重渲染——
 * 周期条（RangePicker）、总览趋势图、占比环图、虚拟流水、两个弹层全陪跑，
 * 而这些子树的 props 一个都没变。
 *
 * 搬到 store 后：
 * - 页面根只订阅自己真正要用的切片（区间 / 筛选三元组 / 占比口径），
 *   配合子组件 `memo()`，敲关键词只重渲染筛选条和流水本身
 * - 顺带解决跨路由保活：切走再回来，周期与筛选条件都还在
 *
 * 边界：纯交互状态，不碰数据、不 import service，所有 setter 都是同步赋值。
 */

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { create } from "zustand";
import { rangeOfPeriod } from "../ledger-utils";
import type { LedgerPeriod, LedgerRange } from "../ledger-utils";

export type LedgerTypeFilter = "all" | "expense" | "income";
export type LedgerPieType = "expense" | "income";

export interface LedgerViewStore {
  period: LedgerPeriod;
  /** 仅 period === "custom" 时生效 */
  customRange: LedgerRange;
  keyword: string;
  type: LedgerTypeFilter;
  categoryId: string | null;
  pieType: LedgerPieType;

  setPeriod: (period: LedgerPeriod) => void;
  setCustomRange: (range: LedgerRange) => void;
  setKeyword: (keyword: string) => void;
  setType: (type: LedgerTypeFilter) => void;
  setCategoryId: (categoryId: string | null) => void;
  setPieType: (pieType: LedgerPieType) => void;
}

export const useLedgerViewStore = create<LedgerViewStore>()((set, get) => ({
  period: "month",
  customRange: rangeOfPeriod("month"),
  keyword: "",
  type: "all",
  categoryId: null,
  pieType: "expense",

  setPeriod: (period) => {
    set({ period });
    // 切到自选时先给一个默认区间，避免 RangePicker 空值
    if (period === "custom" && !get().customRange) {
      set({ customRange: rangeOfPeriod("month") });
    }
  },

  setCustomRange: (customRange) => set({ customRange }),
  setKeyword: (keyword) => set({ keyword }),
  setType: (type) => set({ type }),
  setCategoryId: (categoryId) => set({ categoryId }),
  setPieType: (pieType) => set({ pieType }),
}));

/** 稳定动作入口：身份恒定，可安全当 props 透传给 memo 子组件 */
export const ledgerViewActions = {
  setPeriod: (period: LedgerPeriod): void => {
    useLedgerViewStore.getState().setPeriod(period);
  },
  setCustomRange: (range: LedgerRange): void => {
    useLedgerViewStore.getState().setCustomRange(range);
  },
  setKeyword: (keyword: string): void => {
    useLedgerViewStore.getState().setKeyword(keyword);
  },
  setType: (type: LedgerTypeFilter): void => {
    useLedgerViewStore.getState().setType(type);
  },
  setCategoryId: (categoryId: string | null): void => {
    useLedgerViewStore.getState().setCategoryId(categoryId);
  },
  setPieType: (pieType: LedgerPieType): void => {
    useLedgerViewStore.getState().setPieType(pieType);
  },
};

/**
 * 当前查询区间
 * 只有 period / customRange 变化才换新对象——`useLedgerData` 依赖它取数，
 * 身份必须稳定，否则「敲一个关键词」就会重新拉一次流水。
 */
export function useLedgerRange(): LedgerRange {
  const period = useLedgerViewStore((state) => state.period);
  const customRange = useLedgerViewStore((state) => state.customRange);

  return useMemo(
    () => (period === "custom" ? customRange : rangeOfPeriod(period)),
    [period, customRange],
  );
}

export interface LedgerFilter {
  keyword: string;
  type: LedgerTypeFilter;
  categoryId: string | null;
}

/**
 * 筛选三元组（useShallow 保证值不变时对象身份不变，可直接进 useMemo 依赖）
 */
export function useLedgerFilter(): LedgerFilter {
  return useLedgerViewStore(
    useShallow((state) => ({
      keyword: state.keyword,
      type: state.type,
      categoryId: state.categoryId,
    })),
  );
}

/** 页面根用的视图切片：区间 + 筛选 + 占比口径 */
export function useLedgerViewState() {
  const period = useLedgerViewStore((state) => state.period);
  const pieType = useLedgerViewStore((state) => state.pieType);
  const range = useLedgerRange();
  const filter = useLedgerFilter();

  return {
    period,
    pieType,
    range,
    ...filter,
    // 动作身份恒定
    setPeriod: ledgerViewActions.setPeriod,
    setCustomRange: ledgerViewActions.setCustomRange,
    setKeyword: ledgerViewActions.setKeyword,
    setType: ledgerViewActions.setType,
    setCategoryId: ledgerViewActions.setCategoryId,
    setPieType: ledgerViewActions.setPieType,
  };
}
