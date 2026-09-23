import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLedgerViewStore } from "./useLedgerViewStore";

const view = () => useLedgerViewStore.getState();

/** 每月 1 号跑测试时本月区间只有一天，这里只断言结构合法 */
const RANGE_RE = /^\d{4}-\d{2}-\d{2}$/;

function reset(): void {
  useLedgerViewStore.setState({
    period: "month",
    customRange: { start: "2026-01-01", end: "2026-01-31" },
    keyword: "",
    type: "all",
    categoryId: null,
    pieType: "expense",
  });
}

describe("useLedgerViewStore（记账视图状态）", () => {
  beforeEach(reset);
  afterEach(reset);

  it("初始态：本月周期、空筛选、支出口径", () => {
    expect(view().period).toBe("month");
    expect(view().type).toBe("all");
    expect(view().categoryId).toBeNull();
    expect(view().pieType).toBe("expense");
    expect(view().keyword).toBe("");
  });

  it("筛选三元组各自独立更新，互不影响", () => {
    view().setKeyword("午饭");
    view().setType("expense");
    view().setCategoryId("food");

    expect(view().keyword).toBe("午饭");
    expect(view().type).toBe("expense");
    expect(view().categoryId).toBe("food");

    view().setCategoryId(null);
    expect(view().categoryId).toBeNull();
    expect(view().keyword).toBe("午饭");
  });

  it("切换周期只改周期，不动筛选条件", () => {
    view().setKeyword("午饭");
    view().setPeriod("year");

    expect(view().period).toBe("year");
    expect(view().keyword).toBe("午饭");
  });

  it("切到自选保留已设区间，不覆盖成默认", () => {
    view().setCustomRange({ start: "2026-03-01", end: "2026-03-31" });
    view().setPeriod("custom");

    expect(view().period).toBe("custom");
    expect(view().customRange).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
    });
  });

  it("区间是 YYYY-MM-DD 且 start 不晚于 end", () => {
    view().setCustomRange({ start: "2026-02-01", end: "2026-02-28" });
    const { start, end } = view().customRange;

    expect(start).toMatch(RANGE_RE);
    expect(end).toMatch(RANGE_RE);
    expect(start <= end).toBe(true);
  });

  it("状态活在模块里：模拟卸载再回来，筛选条件仍在", () => {
    view().setKeyword("打车");
    view().setPieType("income");

    // 页面卸载不会 reset store（这就是搬出 useState 的意义）
    const snapshot = useLedgerViewStore.getState();
    reset();
    expect(view().keyword).toBe("");

    useLedgerViewStore.setState(snapshot);
    expect(view().keyword).toBe("打车");
    expect(view().pieType).toBe("income");
  });
});
