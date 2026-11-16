import type { Dayjs } from "dayjs";

/** 每日代码产出目标（行/天）：所有「剩余缺口/目标线」共用这一份事实源 */
export const DAILY_TARGET = 200;

/**
 * 动态节假日数据（由接口拉取后注入，覆盖硬编码表）。
 * 结构对齐 jieri8.com 接口：rest_days=放假日、work_days=调休补班日。
 * 为空表示尚未拉取 / 拉取失败，回退到下方硬编码表兜底。
 */
export interface HolidayData {
  holidays: Set<string>;
  makeupWorkdays: Set<string>;
}

/** 法定节假日（放假日期，含调休放假） */
export const HOLIDAYS = new Set([
  // 2026 年
  "2026-01-01",
  "2026-01-02",
  "2026-01-03",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20",
  "2026-02-21",
  "2026-02-22",
  "2026-04-05",
  "2026-04-06",
  "2026-04-07",
  "2026-05-01",
  "2026-05-02",
  "2026-05-03",
  "2026-05-04",
  "2026-05-05",
  "2026-06-19",
  "2026-06-20",
  "2026-06-21",
  "2026-09-25",
  "2026-09-26",
  "2026-09-27",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  // 2025 年
  "2025-01-01",
  "2025-01-28",
  "2025-01-29",
  "2025-01-30",
  "2025-01-31",
  "2025-02-01",
  "2025-02-02",
  "2025-02-03",
  "2025-02-04",
  "2025-04-04",
  "2025-04-05",
  "2025-04-06",
  "2025-05-01",
  "2025-05-02",
  "2025-05-03",
  "2025-05-04",
  "2025-05-05",
  "2025-05-31",
  "2025-06-01",
  "2025-06-02",
  "2025-10-01",
  "2025-10-02",
  "2025-10-03",
  "2025-10-04",
  "2025-10-05",
  "2025-10-06",
  "2025-10-07",
  "2025-10-08",
]);

/** 调休补班日（周末上班） */
export const MAKEUP_WORKDAYS = new Set([
  // 2026 年
  "2026-02-14",
  "2026-02-28",
  "2026-04-26",
  "2026-09-28",
  "2026-10-10",
  // 2025 年
  "2025-01-26",
  "2025-02-08",
  "2025-04-27",
  "2025-09-28",
  "2025-10-11",
]);

/** 判断日期是否为工作日（周末或节假日不算，调休补班日算） */
export function isWorkday(d: Dayjs): boolean {
  const key = d.format("YYYY-MM-DD");
  return MAKEUP_WORKDAYS.has(key) || (!HOLIDAYS.has(key) && d.day() >= 1 && d.day() <= 5);
}

/**
 * 判断日期是否为工作日（支持动态节假日数据优先、硬编码表兜底）。
 *
 * @param d 日期
 * @param dynamic 接口拉取的动态数据；不传或为空则用内置硬编码表
 */
export function isWorkdayWith(
  d: Dayjs,
  dynamic?: HolidayData | null,
): boolean {
  if (dynamic && (dynamic.holidays.size > 0 || dynamic.makeupWorkdays.size > 0)) {
    const key = d.format("YYYY-MM-DD");
    return (
      dynamic.makeupWorkdays.has(key) ||
      (!dynamic.holidays.has(key) && d.day() >= 1 && d.day() <= 5)
    );
  }
  return isWorkday(d);
}

/** 计算区间内的工作日数量（含两端） */
export function calcWorkdays(from: Dayjs, to: Dayjs): number {
  let count = 0;
  let cur = from.startOf("day");
  const end = to.startOf("day");
  while (cur.isBefore(end) || cur.isSame(end)) {
    if (isWorkday(cur)) {
      count++;
    }
    cur = cur.add(1, "day");
  }
  return count;
}

/**
 * 计算区间内的工作日数量（支持动态节假日数据优先）。
 * 与 calcWorkdays 的区别：工作日判定走 isWorkdayWith 的动态数据源。
 */
export function calcWorkdaysWith(
  from: Dayjs,
  to: Dayjs,
  dynamic?: HolidayData | null,
): number {
  let count = 0;
  let cur = from.startOf("day");
  const end = to.startOf("day");
  while (cur.isBefore(end) || cur.isSame(end)) {
    if (isWorkdayWith(cur, dynamic)) {
      count++;
    }
    cur = cur.add(1, "day");
  }
  return count;
}

/** 单次提交的有效产出行数：新增行 + 删除行 × 0.3 */
export function getCommitOutput(item: { insertions: string; deletions: string }): number {
  return (parseInt(item.insertions) || 0) + (parseInt(item.deletions) || 0) * 0.3;
}

/** 「查询当月」区间：本月 1 号 ~ 本月最后一天（含两端） */
export function getThisMonthRange(now: Dayjs): [Dayjs, Dayjs] {
  const base = now.startOf("day");
  return [base.startOf("month"), base.endOf("month").startOf("day")];
}
