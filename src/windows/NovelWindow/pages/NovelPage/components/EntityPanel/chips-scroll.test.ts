/**
 * 类型 chips 行滚动策略（W-08）
 *
 * 钉住的是用户实际看到的那条 bug：切一次筛选后，第一个分类 tab 只剩半个字。
 * 根因是「把选中项滚到行中间」——居中必然把左邻推到容器外。
 */
import { describe, expect, it } from "vitest";
import { resolveChipsScrollDelta } from "./chips-scroll";

const row = { left: 100, right: 400 };

describe("resolveChipsScrollDelta", () => {
  it("完整可见时一像素都不动（居中会切掉左邻 chip）", () => {
    expect(resolveChipsScrollDelta(row, { left: 108, right: 160 })).toBe(0);
    expect(resolveChipsScrollDelta(row, { left: 120, right: 300 })).toBe(0);
  });

  it("左侧被遮住：只补回被遮的那几像素（含 8px 留白），不是居中", () => {
    // 左边缘超出留白区 38px → scrollLeft 减 38；居中会减到 100+
    expect(resolveChipsScrollDelta(row, { left: 70, right: 130 })).toBe(-38);
    // 刚好压住留白区也要补齐
    expect(resolveChipsScrollDelta(row, { left: 106, right: 150 })).toBe(-2);
  });

  it("右侧被遮住：向右滚到刚好露出", () => {
    // 右边缘超出留白区 28px → scrollLeft 加 28
    expect(resolveChipsScrollDelta(row, { left: 350, right: 420 })).toBe(28);
  });

  it("两侧都比行宽时先保证开头可见", () => {
    expect(resolveChipsScrollDelta(row, { left: 0, right: 500 })).toBe(-108);
  });

  it("gap 可调：0 表示贴边也算可见", () => {
    expect(resolveChipsScrollDelta(row, { left: 100, right: 150 }, 0)).toBe(0);
    expect(resolveChipsScrollDelta(row, { left: 99, right: 150 }, 0)).toBe(-1);
  });
});
