import { beforeEach, describe, expect, it } from "vitest";
import { GUIDE_TOTAL_STEPS } from "@/shared/novel/guide-copy";
import { createDefaultRecord, type GuideRecord } from "@/shared/novel/guide-state";
import { useGuideStore } from "./useGuideStore";

/**
 * QA 独立验证 · 引导跨视图衔接（P1-2：第 5 步 → 第 6 步）
 *
 * 第 5 步属编辑器视图、第 6 步属书架视图。实测链路：
 *   编辑器播第 5 步 → 点「下一步」→ playingStep=6（此步属书架）
 *   → 书架实例此刻不可见 → 它 effect 里 pause() 把 playingStep 清成 null
 *   → 作者返回书架 → App 的 `startGuide(view==="shelf" ? 1 : 2)` 生效
 *   → step = max(record.currentStep=6, 1) = 6 → 第 6 步续播。
 *
 * 这里把上面这条链在 store 层逐步复现，确认「跨视图切走不会把第 6 步吞掉」，
 * 并顺带钉住 store 的「不同视图才改拍」防死锁逻辑（注释里点名的偶现不显示主因）。
 */

function resetStore(over: Partial<GuideRecord> = {}, extra: Record<string, unknown> = {}) {
  useGuideStore.setState({
    record: { ...createDefaultRecord(), ...over },
    hydrated: true,
    playingStep: null,
    playSource: null,
    helpOpen: false,
    lastTypingAt: 0,
    ...extra,
  });
}

const state = () => useGuideStore.getState();

describe("useGuideStore · 第 5→6 步跨视图衔接", () => {
  beforeEach(() => resetStore());

  it("编辑器第 5 步点「下一步」→ 第 6 步；书架不可见时被 pause 清空但仍可续播", () => {
    // 存量：编辑器播到第 5 步
    resetStore({ state: "in_progress", currentStep: 5 }, { playingStep: 5 });

    // 点「下一步」：进入第 6 步（属书架视图），同时把 currentStep 记入 6
    state().goNext();
    expect(state().playingStep).toBe(6);
    expect(state().record.currentStep).toBe(6);

    // 书架实例当前不可见（作者还在编辑器）→ 它 effect 里让位
    state().pause();
    expect(state().playingStep).toBeNull();

    // 作者返回书架：App 的 start(1) 生效 → 用 max(currentStep=6, 1) 续播第 6 步
    state().start(1);
    expect(state().playingStep).toBe(6);
    expect(state().playSource).toBe("auto");
  });

  it("第 6 步点「完成」→ 记录 done，playingStep 归零", () => {
    resetStore({ state: "in_progress", currentStep: 6 }, { playingStep: 6 });
    state().goNext();
    expect(state().playingStep).toBeNull();
    expect(state().record.state).toBe("done");
    expect(state().record.currentStep).toBe(GUIDE_TOTAL_STEPS);
  });
});

describe("useGuideStore · 跨视图改拍（防两个 Tour 互等死锁）", () => {
  beforeEach(() => resetStore());

  it("书架握着第 1 步时编辑器 start(2)：允许改拍到编辑器步，不再互等", () => {
    resetStore({ state: "in_progress", currentStep: 1 }, { playingStep: 1 });
    state().start(2);
    expect(state().playingStep).toBe(2);
  });

  it("同视图已在播：start 不改拍（避免重复触发）", () => {
    resetStore(
      { state: "in_progress", currentStep: 4 },
      { playingStep: 4, playSource: "replay" },
    );
    state().start(2); // 目标步=max(4,2)=4，同属编辑器 → 原地不动
    expect(state().playingStep).toBe(4);
    expect(state().playSource).toBe("replay");
  });

  it("done / skipped / deferred 永不自动起播（迁移后也不重放）", () => {
    for (const s of ["done", "skipped", "deferred"] as const) {
      resetStore({ state: s, currentStep: 2 });
      state().start(2);
      expect(state().playingStep, s).toBeNull();
    }
  });

  it("打字保护窗口内 start 一律不起播（FR-06）", () => {
    resetStore({ state: "in_progress", currentStep: 2 }, { lastTypingAt: Date.now() });
    state().start(2);
    expect(state().playingStep).toBeNull();
  });

  it("越界起始步（> 总步数）直接返回，不写出非法 playingStep", () => {
    resetStore({ state: "in_progress", currentStep: 6 });
    state().start(7);
    expect(state().playingStep).toBeNull();
  });
});
