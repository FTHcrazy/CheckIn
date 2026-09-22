/**
 * 记账视图状态：周期 / 自选区间 / 筛选 / 占比口径
 * 纯交互状态，不触碰数据
 */
import { useCallback, useMemo, useState } from "react";
import { rangeOfPeriod } from "../ledger-utils";
import type { LedgerPeriod, LedgerRange } from "../ledger-utils";

export type LedgerTypeFilter = "all" | "expense" | "income";

export interface LedgerViewState {
  period: LedgerPeriod;
  range: LedgerRange;
  keyword: string;
  type: LedgerTypeFilter;
  categoryId: string | null;
  pieType: "expense" | "income";
  setPeriod: (period: LedgerPeriod) => void;
  setCustomRange: (range: LedgerRange) => void;
  setKeyword: (keyword: string) => void;
  setType: (type: LedgerTypeFilter) => void;
  setCategoryId: (categoryId: string | null) => void;
  setPieType: (type: "expense" | "income") => void;
}

export function useLedgerViewState(): LedgerViewState {
  const [period, setPeriodState] = useState<LedgerPeriod>("month");
  const [customRange, setCustomRange] = useState<LedgerRange>(() => rangeOfPeriod("month"));
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState<LedgerTypeFilter>("all");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [pieType, setPieType] = useState<"expense" | "income">("expense");

  const range = useMemo<LedgerRange>(
    () => (period === "custom" ? customRange : rangeOfPeriod(period)),
    [period, customRange],
  );

  const setPeriod = useCallback((next: LedgerPeriod) => {
    setPeriodState(next);
    if (next !== "custom") return;
    // 切到自选时先给一个默认区间，避免 RangePicker 空值
    setCustomRange((current) => current ?? rangeOfPeriod("month"));
  }, []);

  return {
    period,
    range,
    keyword,
    type,
    categoryId,
    pieType,
    setPeriod,
    setCustomRange,
    setKeyword,
    setType,
    setCategoryId,
    setPieType,
  };
}
