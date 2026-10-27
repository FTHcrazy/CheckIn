import { describe, expect, it } from "vitest";
import dayjs from "dayjs";
import {
  calcWorkdays,
  calcWorkdaysWith,
  DAILY_TARGET,
  getCommitOutput,
  getThisMonthRange,
  isWorkday,
  isWorkdayWith,
} from "./code-utils";
import type { HolidayData } from "./code-utils";

const d = (date: string) => dayjs(date);

describe("DAILY_TARGET", () => {
  it("每日目标为 200 行", () => {
    expect(DAILY_TARGET).toBe(200);
  });
});

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
    // 2026-10-10 周六补班（国庆 10-01~10-07 放假顺延）
    expect(isWorkday(d("2026-10-10"))).toBe(true);
  });

  it("2026 年 10 月整月 18 个工作日（含 10-10 补班）", () => {
    expect(calcWorkdays(d("2026-10-01"), d("2026-10-31"))).toBe(18);
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
  it("月中日期：区间为本月 1 号 ~ 本月最后一天（含两端）", () => {
    const [from, to] = getThisMonthRange(dayjs("2026-09-18 15:30:00"));
    expect(from.format("YYYY-MM-DD HH:mm:ss")).toBe("2026-09-01 00:00:00");
    expect(to.format("YYYY-MM-DD HH:mm:ss")).toBe("2026-09-30 00:00:00");
  });

  it("月初当天：仍覆盖整月（1 号 ~ 月底）", () => {
    const [from, to] = getThisMonthRange(dayjs("2026-09-01 08:00:00"));
    expect(from.format("YYYY-MM-DD")).toBe("2026-09-01");
    expect(to.format("YYYY-MM-DD")).toBe("2026-09-30");
  });

  it("跨年月切换：1 月 1 号视角覆盖整月", () => {
    const [from, to] = getThisMonthRange(dayjs("2027-01-01 23:00:00"));
    expect(from.format("YYYY-MM-DD")).toBe("2027-01-01");
    expect(to.format("YYYY-MM-DD")).toBe("2027-01-31");
  });

  it("闰年 2 月：区间到 2 月最后一天", () => {
    const [from, to] = getThisMonthRange(dayjs("2028-02-10 10:00:00"));
    expect(from.format("YYYY-MM-DD")).toBe("2028-02-01");
    expect(to.format("YYYY-MM-DD")).toBe("2028-02-29");
  });
});

describe("isWorkdayWith / calcWorkdaysWith（动态节假日数据优先）", () => {
  const dynamic: HolidayData = {
    holidays: new Set(["2026-10-01", "2026-10-02", "2026-10-03"]),
    makeupWorkdays: new Set(["2026-10-11"]),
  };

  it("动态数据优先于硬编码表：动态标记的放假日不算工作日", () => {
    // 2026-10-01 在硬编码表里也是放假日，动态数据同样排除
    expect(isWorkdayWith(d("2026-10-01"), dynamic)).toBe(false);
  });

  it("动态数据优先：动态标记的调休补班日算工作日", () => {
    // 2026-10-11 是周日，动态标记为补班 → 算工作日
    expect(isWorkdayWith(d("2026-10-11"), dynamic)).toBe(true);
  });

  it("动态数据为空时回退硬编码表", () => {
    // 不传 dynamic → 用内置 HOLIDAYS/MAKEUP_WORKDAYS
    expect(isWorkdayWith(d("2026-10-10"), null)).toBe(true); // 硬编码表 10-10 补班
    expect(isWorkdayWith(d("2026-10-10"), undefined)).toBe(true);
  });

  it("calcWorkdaysWith 用动态数据计算工作日数", () => {
    // 2026-10-01(四)~10-11(日)：动态放假 1,2,3；10-11 补班；其余 4,5,6,7,8,9,10 里
    // 4(日)5(一)6(二)7(三)8(四)9(五)10(六) —— 工作日=5,6,7,8,9 + 10(周六,非动态补班→休息)
    // 实际工作日 = 5,6,7,8,9 (5天) + 11(补班) = 6 天
    const count = calcWorkdaysWith(d("2026-10-01"), d("2026-10-11"), dynamic);
    expect(count).toBe(6);
  });
});
