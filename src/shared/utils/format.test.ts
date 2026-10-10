import { describe, expect, it } from "vitest";
import { formatRelativeTime, formatThousands } from "./format";

/**
 * 这两个函数此前在 novel 窗口里各有 2~3 份实现（书架 / 编辑器 / 行囊），
 * 抽到共享层后由本文件钉住口径：改文案时只改一处，三家联动。
 */

describe("formatThousands", () => {
  it("三位一组加逗号", () => {
    expect(formatThousands(0)).toBe("0");
    expect(formatThousands(999)).toBe("999");
    expect(formatThousands(1000)).toBe("1,000");
    expect(formatThousands(1234567)).toBe("1,234,567");
  });

  it("负数与小数收敛到非负整数（字数不可能为负，旧数据显示成 -1 是 bug）", () => {
    expect(formatThousands(-1234)).toBe("0");
    expect(formatThousands(1234.6)).toBe("1,235");
    expect(formatThousands(-0.4)).toBe("0");
  });
});

describe("formatRelativeTime", () => {
  const now = 1_700_000_000_000;

  it("分钟 / 小时阶梯", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("刚刚");
    expect(formatRelativeTime(now - 59_999, now)).toBe("刚刚");
    expect(formatRelativeTime(now - 60_000, now)).toBe("1 分钟前");
    expect(formatRelativeTime(now - 59 * 60_000, now)).toBe("59 分钟前");
    expect(formatRelativeTime(now - 60 * 60_000, now)).toBe("1 小时前");
    expect(formatRelativeTime(now - 23 * 3_600_000, now)).toBe("23 小时前");
  });

  it("时钟回拨（未来时间戳）也显示「刚刚」，不出现负数", () => {
    expect(formatRelativeTime(now + 5 * 60_000, now)).toBe("刚刚");
  });

  it("超过一天默认 M月D日", () => {
    const at = new Date(2026, 9, 8, 10, 0, 0).getTime();
    const ref = new Date(2026, 9, 9, 10, 0, 0).getTime();
    expect(formatRelativeTime(at, ref)).toBe("10月8日");
  });

  it("empty：时间戳为空时走调用方给的占位文案", () => {
    expect(formatRelativeTime(0, now, { empty: "尚未动笔" })).toBe("尚未动笔");
    // 没给 empty 就按普通时间算（0 = 1970 年，落进默认分支）
    expect(formatRelativeTime(0, now)).not.toBe("尚未动笔");
  });

  it("beyondDay：超过一天的部分交给调用方（三家口径不同）", () => {
    expect(
      formatRelativeTime(now - 3 * 86_400_000, now, {
        beyondDay: (_at, current) => `${current}`,
      }),
    ).toBe(String(now));
  });
});
