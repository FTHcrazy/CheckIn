import { describe, expect, it } from "vitest";
import {
  CHECKIN_BOUNDARY_HOUR,
  nextResetTime,
  resolveCheckinDate,
} from "./checkin-utils";

/** 本地时区构造 Date：new Date(2026, 8, 22, 3, 30) 即 2026-09-22 03:30 */
function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): Date {
  return new Date(year, month - 1, day, hour, minute, second, 0);
}

describe("resolveCheckinDate", () => {
  it("白天打卡归属当天", () => {
    expect(resolveCheckinDate(at(2026, 9, 22, 9, 0))).toBe("2026-09-22");
    expect(resolveCheckinDate(at(2026, 9, 22, 12, 30))).toBe("2026-09-22");
    expect(resolveCheckinDate(at(2026, 9, 22, 23, 59))).toBe("2026-09-22");
  });

  it("凌晨 0-5 点打卡归属前一天", () => {
    expect(resolveCheckinDate(at(2026, 9, 22, 0, 0))).toBe("2026-09-21");
    expect(resolveCheckinDate(at(2026, 9, 22, 4, 59, 59))).toBe("2026-09-21");
  });

  it("恰好 5 点整归属当天（切日点含边界）", () => {
    expect(resolveCheckinDate(at(2026, 9, 22, 5, 0, 0))).toBe("2026-09-22");
  });

  it("月初 1 号凌晨归属上月末天", () => {
    expect(resolveCheckinDate(at(2026, 9, 1, 3, 0))).toBe("2026-08-31");
    expect(resolveCheckinDate(at(2026, 1, 1, 2, 0))).toBe("2025-12-31");
  });

  it("支持自定义切日点", () => {
    expect(resolveCheckinDate(at(2026, 9, 22, 8, 0), 9)).toBe("2026-09-21");
    expect(resolveCheckinDate(at(2026, 9, 22, 9, 0), 9)).toBe("2026-09-22");
  });

  it("默认切日点为 5", () => {
    expect(CHECKIN_BOUNDARY_HOUR).toBe(5);
  });
});

describe("nextResetTime", () => {
  it("切日点之前返回当天 5 点", () => {
    expect(nextResetTime(at(2026, 9, 22, 3, 30))).toEqual(at(2026, 9, 22, 5, 0));
  });

  it("切日点之后返回次日 5 点", () => {
    expect(nextResetTime(at(2026, 9, 22, 9, 0))).toEqual(at(2026, 9, 23, 5, 0));
    expect(nextResetTime(at(2026, 9, 22, 23, 0))).toEqual(at(2026, 9, 23, 5, 0));
  });

  it("恰好等于切日点时顺延到次日 5 点（重置时刻已到来）", () => {
    expect(nextResetTime(at(2026, 9, 22, 5, 0))).toEqual(at(2026, 9, 23, 5, 0));
  });

  it("返回值恒大于传入时刻", () => {
    const now = at(2026, 9, 22, 4, 59, 59);
    expect(nextResetTime(now).getTime()).toBeGreaterThan(now.getTime());
  });
});
