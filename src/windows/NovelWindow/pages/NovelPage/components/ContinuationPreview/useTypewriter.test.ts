import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TYPEWRITER_SLOW_LAG,
  TYPEWRITER_TICK_MS,
  nextRevealCount,
  useTypewriter,
} from "./useTypewriter";

/**
 * 逐字上屏（REQ-058 守卫）
 *
 * 事故：续写虽然走 SSE，但服务商一次吐半段，一帧糊上屏 → 作者看到的是
 * 「一段一段蹦」。这里钉住两条：① 永远从 1 个字开始揭示；② 落后越多追得
 * 越快（不会让一屏文字慢慢爬）。
 */
describe("nextRevealCount", () => {
  it("正常节奏：每帧走 1 个字（有打字感）", () => {
    expect(nextRevealCount(0, TYPEWRITER_SLOW_LAG)).toBe(1);
    expect(nextRevealCount(3, TYPEWRITER_SLOW_LAG)).toBe(4);
  });

  it("落后很多时按比例追赶，且不会越过总数", () => {
    const step = nextRevealCount(0, 500) - 0;
    expect(step).toBeGreaterThan(TYPEWRITER_SLOW_LAG);
    // 渐近：再跑一帧仍旧提速，但永不越界
    let shown = 0;
    for (let i = 0; i < 200; i += 1) {
      shown = nextRevealCount(shown, 500);
      expect(shown).toBeLessThanOrEqual(500);
    }
    expect(shown).toBe(500);
  });

  it("已揭示完 → 原地不动", () => {
    expect(nextRevealCount(10, 10)).toBe(10);
    expect(nextRevealCount(10, 0)).toBe(0);
  });
});

describe("useTypewriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * 推进 N 帧。
   *
   * 不能一次 `advanceTimersByTime(3000)`：每帧的定时器要在**上一帧 setState
   * 触发的重渲染之后**才注册，一次性推进只会跑到第一帧就停住（假绿/假红）。
   */
  const tick = (frames: number): void => {
    for (let i = 0; i < frames; i += 1) {
      act(() => {
        vi.advanceTimersByTime(TYPEWRITER_TICK_MS);
      });
    }
  };

  it("一次收到一整块也分批上屏，最终与完整文本一致", () => {
    const full = "他推门而入，风从窗缝里灌进来。";
    const { result, rerender } = renderHook(({ t }) => useTypewriter(t), {
      initialProps: { t: "" },
    });
    expect(result.current.shown).toBe("");

    rerender({ t: full });
    // 首帧还没开始走：不可能一次全糊上去
    expect(result.current.shown.length).toBeLessThan(full.length);
    expect(result.current.revealing).toBe(true);

    tick(2);
    const partial = result.current.shown.length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(full.length);

    tick(300);
    expect(result.current.shown).toBe(full);
    expect(result.current.revealing).toBe(false);
  });

  it("文本变短（重试 / 换位置）时游标跟着收回，新内容从第一个字开始上屏", () => {
    const { result, rerender } = renderHook(({ t }) => useTypewriter(t), {
      initialProps: { t: "" },
    });
    rerender({ t: "一二三四五" });
    tick(300);
    expect(result.current.shown).toBe("一二三四五");

    rerender({ t: "" });
    rerender({ t: "新" });
    expect(result.current.shown.length).toBeLessThanOrEqual(1);
    tick(300);
    expect(result.current.shown).toBe("新");
  });
});
