/**
 * 记账页纯函数工具
 * 金额格式化 / 校验、周期区间、分组、占比聚合、趋势 —— 全部可单测，不依赖 React
 */
import dayjs from "dayjs";
import quarterOfYear from "dayjs/plugin/quarterOfYear";
import type { LedgerCategoryDTO, LedgerTransactionDTO } from "@/shared/services/ledger";

// 季度周期需要 quarterOfYear 插件（startOf('quarter')）
dayjs.extend(quarterOfYear);

/** 周期类型：本月 / 本季 / 本年 / 自选 */
export type LedgerPeriod = "month" | "quarter" | "year" | "custom";

/** 日期区间（闭区间，YYYY-MM-DD） */
export interface LedgerRange {
  start: string;
  end: string;
}

/** 收支汇总 */
export interface LedgerSummary {
  income: number;
  expense: number;
  balance: number;
}

/** 按日期分组的流水 */
export interface LedgerDayGroup {
  date: string;
  label: string;
  income: number;
  expense: number;
  items: LedgerTransactionDTO[];
}

/** 分类占比切片 */
export interface LedgerCategorySlice {
  id: string;
  name: string;
  color: string;
  amount: number;
  /** 占比 0–1 */
  ratio: number;
}

/** 趋势点 */
export interface LedgerTrendPoint {
  date: string;
  label: string;
  expense: number;
  income: number;
}

/** 金额上限：单笔 999 万，防误输入 */
export const MAX_AMOUNT = 9_999_999;

const WEEK_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 千分位 + 固定两位小数 */
export function formatMoney(value: number): string {
  const safe = Number.isFinite(value) ? Math.abs(value) : 0;
  const [intPart, decimalPart] = safe.toFixed(2).split(".");
  const withSeparator = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${withSeparator}.${decimalPart}`;
}

/**
 * 带符号金额：支出 `−¥28.50`，收入 `+¥28.50`
 * 不依赖颜色单独传达方向（WCAG 1.4.1），符号与颜色并行
 */
export function formatSignedAmount(type: string, amount: number): string {
  const sign = type === "income" ? "+" : "−";
  return `${sign}¥${formatMoney(amount)}`;
}

/** 无符号金额（用于汇总与图例） */
export function formatAmount(amount: number): string {
  return `¥${formatMoney(amount)}`;
}

export interface AmountParseResult {
  ok: boolean;
  value: number;
  error: string | null;
}

/**
 * 金额输入校验：空 / 非数字 / 0 / 负数 / 超限 / 超两位小数 一律拦截
 * 返回 ok=false 时 error 为可直接展示的文案
 */
export function parseAmountInput(raw: string): AmountParseResult {
  const trimmed = raw.trim().replace(/[，,\s￥¥]/g, "");
  if (!trimmed) {
    return { ok: false, value: 0, error: "请输入金额" };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, value: 0, error: "请输入大于 0 的金额" };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, value: 0, error: "请输入大于 0 的金额" };
  }
  if (value > MAX_AMOUNT) {
    return { ok: false, value: 0, error: `单笔金额不能超过 ${formatMoney(MAX_AMOUNT)}` };
  }
  return { ok: true, value, error: null };
}

/** `YYYY-MM-DD HH:mm:ss` → `YYYY-MM-DD` */
export function dateKeyOf(happenedAt: string): string {
  return happenedAt.slice(0, 10);
}

/** 本地日期 → `YYYY-MM-DD` */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 周期 → 日期区间（本地时区） */
export function rangeOfPeriod(period: LedgerPeriod, base: Date = new Date()): LedgerRange {
  const now = dayjs(base);
  if (period === "year") {
    return { start: now.startOf("year").format("YYYY-MM-DD"), end: now.format("YYYY-MM-DD") };
  }
  if (period === "quarter") {
    return { start: now.startOf("quarter").format("YYYY-MM-DD"), end: now.format("YYYY-MM-DD") };
  }
  return { start: now.startOf("month").format("YYYY-MM-DD"), end: now.format("YYYY-MM-DD") };
}

/** 上一同期区间（环比基准）：与当前区间等长的前一段 */
export function previousRange(range: LedgerRange): LedgerRange {
  const start = dayjs(range.start);
  const end = dayjs(range.end);
  const days = end.diff(start, "day") + 1;
  return {
    start: start.subtract(days, "day").format("YYYY-MM-DD"),
    end: start.subtract(1, "day").format("YYYY-MM-DD"),
  };
}

/** 区间内天数（用于趋势粒度选择） */
export function countDays(range: LedgerRange): number {
  return dayjs(range.end).diff(dayjs(range.start), "day") + 1;
}

/** 收支汇总 */
export function summarize(transactions: readonly LedgerTransactionDTO[]): LedgerSummary {
  let income = 0;
  let expense = 0;
  for (const tx of transactions) {
    if (tx.type === "income") income += tx.amount;
    else if (tx.type === "expense") expense += tx.amount;
  }
  return { income, expense, balance: income - expense };
}

/**
 * 环比变化率：返回 0–1 的小数；基期为 0 时返回 null（无法计算，UI 显示「暂无对比」）
 */
export function growthRate(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

/** 分组标题：今天 / 昨天 / MM-DD 周X */
export function formatDayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "今天";
  const yesterday = dayjs(todayKey).subtract(1, "day").format("YYYY-MM-DD");
  if (dateKey === yesterday) return "昨天";
  const date = dayjs(dateKey);
  return `${date.format("MM-DD")} ${WEEK_LABELS[date.day()]}`;
}

/**
 * 按日期倒序分组（入参需已按 happenedAt 倒序）
 * 组内保持原顺序，分组头携带当日收支合计
 */
export function groupByDate(
  transactions: readonly LedgerTransactionDTO[],
  todayKey: string,
): LedgerDayGroup[] {
  const groups: LedgerDayGroup[] = [];
  const index = new Map<string, LedgerDayGroup>();
  for (const tx of transactions) {
    const date = dateKeyOf(tx.happenedAt);
    let group = index.get(date);
    if (!group) {
      group = { date, label: formatDayLabel(date, todayKey), income: 0, expense: 0, items: [] };
      index.set(date, group);
      groups.push(group);
    }
    if (tx.type === "income") group.income += tx.amount;
    else if (tx.type === "expense") group.expense += tx.amount;
    group.items.push(tx);
  }
  return groups;
}

/** 分类占比：按金额降序，超过 max 类折叠为「其他」 */
export function buildCategorySlices(
  transactions: readonly LedgerTransactionDTO[],
  categories: readonly LedgerCategoryDTO[],
  type: "expense" | "income",
  max = 7,
): LedgerCategorySlice[] {
  const nameOf = new Map(categories.map((category) => [category.id, category]));
  const totals = new Map<string, number>();
  let grand = 0;
  for (const tx of transactions) {
    if (tx.type !== type) continue;
    const key = tx.categoryId ?? "unknown";
    totals.set(key, (totals.get(key) ?? 0) + tx.amount);
    grand += tx.amount;
  }

  const sorted = [...totals.entries()]
    .map(([id, amount]) => {
      const category = nameOf.get(id);
      return {
        id,
        name: category?.name ?? "未分类",
        color: category?.color ?? "--app-text-muted",
        amount,
        ratio: grand > 0 ? amount / grand : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  if (sorted.length <= max) return sorted;

  const head = sorted.slice(0, max - 1);
  const tailAmount = sorted.slice(max - 1).reduce((sum, item) => sum + item.amount, 0);
  return [
    ...head,
    {
      id: "__others__",
      name: "其他",
      color: "--app-text-muted",
      amount: tailAmount,
      ratio: grand > 0 ? tailAmount / grand : 0,
    },
  ];
}

/**
 * 趋势点：以 endKey 为终点回溯 days 天，逐日聚合
 * 区间跨度 > 92 天时按月聚合（避免 365 个点）
 */
export function buildTrend(
  transactions: readonly LedgerTransactionDTO[],
  endKey: string,
  days = 30,
): LedgerTrendPoint[] {
  const end = dayjs(endKey);
  const start = end.subtract(days - 1, "day");
  const buckets = new Map<string, LedgerTrendPoint>();
  for (let i = 0; i < days; i += 1) {
    const key = start.add(i, "day").format("YYYY-MM-DD");
    buckets.set(key, { date: key, label: key.slice(5), expense: 0, income: 0 });
  }
  for (const tx of transactions) {
    const bucket = buckets.get(dateKeyOf(tx.happenedAt));
    if (!bucket) continue;
    if (tx.type === "income") bucket.income += tx.amount;
    else if (tx.type === "expense") bucket.expense += tx.amount;
  }
  return [...buckets.values()];
}

/** 筛选：关键词（备注 / 分类名）+ 类型 + 分类 */
export function filterTransactions(
  transactions: readonly LedgerTransactionDTO[],
  filters: { keyword?: string; type?: "all" | "expense" | "income"; categoryId?: string | null },
  categories: readonly LedgerCategoryDTO[],
): LedgerTransactionDTO[] {
  const keyword = filters.keyword?.trim().toLowerCase() ?? "";
  const nameOf = new Map(categories.map((category) => [category.id, category.name]));
  return transactions.filter((tx) => {
    if (filters.type && filters.type !== "all" && tx.type !== filters.type) return false;
    if (filters.categoryId && tx.categoryId !== filters.categoryId) return false;
    if (!keyword) return true;
    const categoryName = tx.categoryId ? nameOf.get(tx.categoryId) ?? "" : "";
    return (
      tx.note.toLowerCase().includes(keyword) || categoryName.toLowerCase().includes(keyword)
    );
  });
}

/** 按类型过滤分类（「其他」type=both 恒可见） */
export function categoriesForType(
  categories: readonly LedgerCategoryDTO[],
  type: "expense" | "income",
): LedgerCategoryDTO[] {
  return categories.filter(
    (category) => !category.archived && (category.type === type || category.type === "both"),
  );
}

/** 智能默认分类：该类型下最近一笔使用的分类，否则取第一个 */
export function guessDefaultCategory(
  transactions: readonly LedgerTransactionDTO[],
  categories: readonly LedgerCategoryDTO[],
  type: "expense" | "income",
): string | null {
  const available = categoriesForType(categories, type);
  if (available.length === 0) return null;
  const usable = new Set(available.map((category) => category.id));
  for (const tx of transactions) {
    if (tx.type === type && tx.categoryId && usable.has(tx.categoryId)) return tx.categoryId;
  }
  return available[0]?.id ?? null;
}
