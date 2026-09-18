import { describe, expect, it } from "vitest";
import dayjs from "dayjs";
import {
  calcWorkdays,
  getCommitOutput,
  getThisMonthRange,
  isWorkday,
} from "./code-utils";

const d = (date: string) => dayjs(date);

describe("isWorkday", () => {
  it("周一到周五是工作日", () => {
    // 2026-09-14 是周一
    expect(isWorkday(d("2026-09-14"))).toBe(true);
    expect(isWorkday(d("2026-09-18"))).toBe(true);
  });

  it("周六周日不是工作日", () => {
    // 2026-09-19 周六、2026-09-20 周日
    expect(isWorkday(d("2026-09-19"))).toBe(false);
    expect(isWorkday(d("2026-09-20"))).toBe(false);
  });

  it("法定节假日不算工作日（即使落在工作日）", () => {
    // 2026-10-01 周四，国庆放假
    expect(isWorkday(d("2026-10-01"))).toBe(false);
    // 2026-02-17 周二，春节假期
    expect(isWorkday(d("2026-02-17"))).toBe(false);
  });

  it("调休补班日算工作日（即使落在周末）", () => {
    // 2026-09-28 周一补班（2026-09-25~27 中秋假期顺延）
    expect(isWorkday(d("2026-09-28"))).toBe(true);
    // 2026-02-14 周六补班
    expect(isWorkday(d("2026-02-14"))).toBe(true);
  });
});

describe("calcWorkdays", () => {
  it("单日区间：工作日计 1，周末计 0", () => {
    expect(calcWorkdays(d("2026-09-14"), d("2026-09-14"))).toBe(1);
    expect(calcWorkdays(d("2026-09-19"), d("2026-09-19"))).toBe(0);
  });

  it("一整周（周一到周日）计 5 个工作日", () => {
    expect(calcWorkdays(d("2026-09-14"), d("2026-09-20"))).toBe(5);
  });

  it("区间含节假日与调休正确扣减/加回", () => {
    // 2026-09-25(五)~09-27(日) 中秋假，2026-09-28(一) 补班顺延
    // 09-21(一) ~ 09-28(一)：工作日 = 21,22,23,24 + 28（25-27放假）= 5
    expect(calcWorkdays(d("2026-09-21"), d("2026-09-28"))).toBe(5);
  });

  it("from 晚于 to 返回 0", () => {
    expect(calcWorkdays(d("2026-09-20"), d("2026-09-14"))).toBe(0);
  });

  it("跨年区间正常计数", () => {
    // 2025-12-29(一) ~ 2026-01-04(日)：工作日 29,30,31（01-01~01-02 放假）+ 无 = 3
    expect(calcWorkdays(d("2025-12-29"), d("2026-01-04"))).toBe(3);
  });
});

describe("getCommitOutput", () => {
  it("有效产出 = 新增行 + 删除行 × 0.3", () => {
    expect(getCommitOutput({ insertions: "100", deletions: "50" })).toBe(115);
  });

  it("非数字输入按 0 处理", () => {
    expect(getCommitOutput({ insertions: "", deletions: "abc" })).toBe(0);
  });

  it("删除行取整数字符串前缀", () => {
    expect(getCommitOutput({ insertions: "10", deletions: "20px" })).toBe(16);
  });
});

describe("getThisMonthRange", () => {
  it("月中日期：区间为本月 1 号 ~ 今天（含今天）", () => {
    const [from, to] = getThisMonthRange(dayjs("2026-09-18 15:30:00"));
    expect(from.format("YYYY-MM-DD HH:mm:ss")).toBe("2026-09-01 00:00:00");
    expect(to.format("YYYY-MM-DD HH:mm:ss")).toBe("2026-09-18 00:00:00");
  });

  it("月初当天：两端为同一天（查询当天全天）", () => {
    const [from, to] = getThisMonthRange(dayjs("2026-09-01 08:00:00"));
    expect(from.isSame(to, "day")).toBe(true);
    expect(from.format("YYYY-MM-DD")).toBe("2026-09-01");
  });

  it("跨年月切换：1 月 1 号视角区间正确", () => {
    const [from, to] = getThisMonthRange(dayjs("2027-01-01 23:00:00"));
    expect(from.format("YYYY-MM-DD")).toBe("2027-01-01");
    expect(to.format("YYYY-MM-DD")).toBe("2027-01-01");
  });
});
