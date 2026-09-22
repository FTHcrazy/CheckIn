import { describe, expect, it } from "vitest";
import type { LedgerCategoryDTO, LedgerTransactionDTO } from "@/shared/services/ledger";
import {
  buildCategorySlices,
  buildTrend,
  categoriesForType,
  dateKeyOf,
  filterTransactions,
  formatMoney,
  formatSignedAmount,
  guessDefaultCategory,
  groupByDate,
  growthRate,
  parseAmountInput,
  previousRange,
  rangeOfPeriod,
  summarize,
} from "./ledger-utils";

function tx(
  id: string,
  type: "expense" | "income",
  amount: number,
  categoryId: string | null,
  happenedAt: string,
  note = "",
): LedgerTransactionDTO {
  return {
    id,
    type,
    amount,
    currency: "CNY",
    categoryId,
    accountId: null,
    toAccountId: null,
    note,
    happenedAt,
    createdAt: happenedAt,
    updatedAt: happenedAt,
  };
}

const CATEGORIES: LedgerCategoryDTO[] = [
  { id: "food", name: "餐饮", icon: "CoffeeOutlined", color: "--app-accent-orange", type: "expense", builtin: true, sort: 1, archived: false },
  { id: "salary", name: "工资", icon: "WalletOutlined", color: "--app-success", type: "income", builtin: true, sort: 8, archived: false },
  { id: "other", name: "其他", icon: "EllipsisOutlined", color: "--app-text-muted", type: "both", builtin: true, sort: 10, archived: false },
];

describe("金额格式化与校验", () => {
  it("千分位 + 两位小数", () => {
    expect(formatMoney(0)).toBe("0.00");
    expect(formatMoney(28.5)).toBe("28.50");
    expect(formatMoney(1234567.891)).toBe("1,234,567.89");
  });

  it("带符号金额：支出用 −，收入用 +", () => {
    expect(formatSignedAmount("expense", 28.5)).toBe("−¥28.50");
    expect(formatSignedAmount("income", 28.5)).toBe("+¥28.50");
  });

  it("拦截空 / 0 / 负数 / 非数字 / 超两位小数 / 超限", () => {
    expect(parseAmountInput("").ok).toBe(false);
    expect(parseAmountInput("0").ok).toBe(false);
    expect(parseAmountInput("-3").ok).toBe(false);
    expect(parseAmountInput("abc").ok).toBe(false);
    expect(parseAmountInput("12.345").ok).toBe(false);
    expect(parseAmountInput("10000000").ok).toBe(false);
  });

  it("接受合法输入并容忍全角/货币符号", () => {
    expect(parseAmountInput("28.50")).toEqual({ ok: true, value: 28.5, error: null });
    expect(parseAmountInput("¥1,200").ok).toBe(true);
  });
});

describe("周期区间", () => {
  it("本月：月初到今天", () => {
    const range = rangeOfPeriod("month", new Date(2026, 8, 22));
    expect(range).toEqual({ start: "2026-09-01", end: "2026-09-22" });
  });

  it("本年：年初到今天", () => {
    const range = rangeOfPeriod("year", new Date(2026, 8, 22));
    expect(range).toEqual({ start: "2026-01-01", end: "2026-09-22" });
  });

  it("上一同期区间与当前区间等长且紧邻", () => {
    const previous = previousRange({ start: "2026-09-01", end: "2026-09-30" });
    expect(previous).toEqual({ start: "2026-08-02", end: "2026-08-31" });
  });
});

describe("汇总与环比", () => {
  it("收支分别汇总，结余为差", () => {
    const summary = summarize([
      tx("1", "income", 5000, "salary", "2026-09-01 09:00:00"),
      tx("2", "expense", 28.5, "food", "2026-09-02 09:00:00"),
    ]);
    expect(summary).toEqual({ income: 5000, expense: 28.5, balance: 4971.5 });
  });

  it("基期为 0 时环比返回 null", () => {
    expect(growthRate(100, 0)).toBeNull();
    expect(growthRate(150, 100)).toBeCloseTo(0.5);
  });
});

describe("按日期分组", () => {
  it("生成今天 / 昨天 / 日期标签，并汇总当日收支", () => {
    const groups = groupByDate(
      [
        tx("1", "expense", 30, "food", "2026-09-22 12:00:00"),
        tx("2", "income", 100, "salary", "2026-09-22 09:00:00"),
        tx("3", "expense", 12, "food", "2026-09-21 12:00:00"),
        tx("4", "expense", 8, "food", "2026-09-15 12:00:00"),
      ],
      "2026-09-22",
    );
    expect(groups.map((group) => group.label)).toEqual(["今天", "昨天", "09-15 周二"]);
    expect(groups[0]?.expense).toBe(30);
    expect(groups[0]?.income).toBe(100);
    expect(groups[1]?.expense).toBe(12);
  });

  it("取日期键", () => {
    expect(dateKeyOf("2026-09-22 12:34:56")).toBe("2026-09-22");
  });
});

describe("分类占比聚合", () => {
  it("按金额降序并计算占比", () => {
    const slices = buildCategorySlices(
      [
        tx("1", "expense", 30, "food", "2026-09-22 12:00:00"),
        tx("2", "expense", 70, "other", "2026-09-22 12:00:00"),
        tx("3", "income", 999, "salary", "2026-09-22 12:00:00"),
      ],
      CATEGORIES,
      "expense",
    );
    expect(slices.map((slice) => slice.id)).toEqual(["other", "food"]);
    expect(slices[0]?.ratio).toBeCloseTo(0.7);
  });

  it("超过 7 类折叠为「其他」", () => {
    const many: LedgerCategoryDTO[] = Array.from({ length: 9 }, (_, index) => ({
      id: `c${index}`,
      name: `分类${index}`,
      icon: "EllipsisOutlined",
      color: "--app-accent-blue",
      type: "expense",
      builtin: false,
      sort: index,
      archived: false,
    }));
    const transactions = many.map((category, index) =>
      tx(`t${index}`, "expense", 100 - index, category.id, "2026-09-22 12:00:00"),
    );
    const slices = buildCategorySlices(transactions, many, "expense", 7);
    expect(slices).toHaveLength(7);
    expect(slices[6]?.id).toBe("__others__");
    // 折叠项 = 第 7 名之后的合计（94 + 93 + 92）
    expect(slices[6]?.amount).toBe(94 + 93 + 92);
  });

  it("无数据时返回空切片", () => {
    expect(buildCategorySlices([], CATEGORIES, "expense")).toEqual([]);
  });
});

describe("趋势与筛选", () => {
  it("按天补齐空白桶", () => {
    const points = buildTrend(
      [tx("1", "expense", 30, "food", "2026-09-22 12:00:00")],
      "2026-09-22",
      3,
    );
    expect(points).toHaveLength(3);
    expect(points[2]?.expense).toBe(30);
    expect(points[0]?.expense).toBe(0);
  });

  it("关键词命中备注或分类名", () => {
    const rows = [
      tx("1", "expense", 30, "food", "2026-09-22 12:00:00", "午饭"),
      tx("2", "expense", 70, "other", "2026-09-22 12:00:00"),
    ];
    expect(filterTransactions(rows, { keyword: "午饭" }, CATEGORIES)).toHaveLength(1);
    expect(filterTransactions(rows, { keyword: "其他" }, CATEGORIES)).toHaveLength(1);
    expect(filterTransactions(rows, { type: "income" }, CATEGORIES)).toHaveLength(0);
  });
});

describe("分类可用性", () => {
  it("both 类型在支出与收入下都可见", () => {
    expect(categoriesForType(CATEGORIES, "expense").map((item) => item.id)).toEqual([
      "food",
      "other",
    ]);
    expect(categoriesForType(CATEGORIES, "income").map((item) => item.id)).toEqual([
      "salary",
      "other",
    ]);
  });

  it("默认分类取该类型最近一笔所用分类", () => {
    const rows = [
      tx("1", "expense", 30, "food", "2026-09-22 12:00:00"),
      tx("2", "expense", 70, "other", "2026-09-21 12:00:00"),
    ];
    expect(guessDefaultCategory(rows, CATEGORIES, "expense")).toBe("food");
    expect(guessDefaultCategory([], CATEGORIES, "income")).toBe("salary");
  });
});
