/**
 * 类型 chips 行滚动策略（W-08）
 *
 * 2.71.1 起语义改为「选中项居中」：切一次筛选，选中的 chip 停在可视区正中，
 * 左右各露半颗邻项作为「还能滚」的提示。首尾贴边由调用方 clamp 兜住。
 */
import { describe, expect, it } from "vitest";
import { resolveChipsScrollDelta } from "./chips-scroll";

// 视口宽 300，中心 x = 250
const row = { left: 100, right: 400 };

describe("resolveChipsScrollDelta（居中）", () => {
  it("已经在正中：一像素都不动", () => {
    expect(resolveChipsScrollDelta(row, { left: 220, right: 280 })).toBe(0);
    expect(resolveChipsScrollDelta(row, { left: 230, right: 270 })).toBe(0);
  });

  it("选中项偏左：向左滚到其中心对齐容器中心（负值）", () => {
    // 芯片中心 190，容器中心 250 → -60
    expect(resolveChipsScrollDelta(row, { left: 160, right: 220 })).toBe(-60);
  });

  it("选中项偏右：向右滚到其中心对齐容器中心（正值）", () => {
    // 芯片中心 340，容器中心 250 → +90
    expect(resolveChipsScrollDelta(row, { left: 300, right: 380 })).toBe(90);
  });

  it("宽于整行的芯片也按中心对齐（由调用方 clamp 到首尾）", () => {
    // 芯片中心 250 = 容器中心 → 不动；即使它比容器宽，也不额外偏移
    expect(resolveChipsScrollDelta(row, { left: 0, right: 500 })).toBe(0);
  });

  it("位移只看中心差，不受芯片宽度影响", () => {
    // 两颗芯片中心都是 225 → 同为 -25
    expect(resolveChipsScrollDelta(row, { left: 195, right: 255 })).toBe(-25);
    expect(resolveChipsScrollDelta(row, { left: 150, right: 300 })).toBe(-25);
  });
});
