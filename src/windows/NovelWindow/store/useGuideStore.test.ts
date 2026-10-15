import { beforeEach, describe, expect, it } from "vitest";
import { consumeGuideTooltip, useGuideStore, TYPING_GUARD_MS } from "./useGuideStore";

/**
 * `consumeGuideTooltip`：编辑器内三个弱提示（T-05 梗概 / T-06 悬浮卡 /
 * T-07 排序确认）的统一消费入口。
 *
 * 三条语义各自对应一类**不会自己报错**的退化：
 * 1. 只消费一次 —— 漏了就会每次挂载都弹（章行随虚拟列表反复进出）
 * 2. Tour 正在播时让位 —— 漏了两个气泡会叠在一起互相遮挡
 * 3. 打字保护期内既不放行也不记账 —— 漏了会在作者码字时打扰，且把机会用掉
 */

describe("consumeGuideTooltip", () => {
  beforeEach(() => {
    useGuideStore.setState((state) => ({
      record: { ...state.record, tooltipSeen: [] },
      playingStep: null,
      playSource: null,
      lastTypingAt: 0,
    }));
  });

  it("第一次返回 true 并立即记入已看，第二次返回 false", () => {
    expect(consumeGuideTooltip("T-05")).toBe(true);
    expect(useGuideStore.getState().record.tooltipSeen).toEqual(["T-05"]);
    expect(consumeGuideTooltip("T-05")).toBe(false);
  });

  it("不同点位互不影响", () => {
    expect(consumeGuideTooltip("T-06")).toBe(true);
    expect(consumeGuideTooltip("T-07")).toBe(true);
    expect(useGuideStore.getState().record.tooltipSeen).toEqual(["T-06", "T-07"]);
  });

  it("Tour 正在播时让位，且**不**记入已看（下次还有机会）", () => {
    useGuideStore.setState({ playingStep: 3, playSource: "auto" });
    expect(consumeGuideTooltip("T-06")).toBe(false);
    expect(useGuideStore.getState().record.tooltipSeen).toEqual([]);

    // Tour 结束后同一个点位仍能弹
    useGuideStore.setState({ playingStep: null });
    expect(consumeGuideTooltip("T-06")).toBe(true);
  });

  it("打字保护期内不放行、也不记账", () => {
    useGuideStore.setState({ lastTypingAt: Date.now() });
    expect(consumeGuideTooltip("T-07")).toBe(false);
    expect(useGuideStore.getState().record.tooltipSeen).toEqual([]);
  });

  it("打字保护窗口是个有名字的常量，不是散落的魔法数字", () => {
    expect(TYPING_GUARD_MS).toBe(3000);
  });
});
