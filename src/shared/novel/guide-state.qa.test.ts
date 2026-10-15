import { describe, expect, it } from "vitest";
import {
  FORCED_MAX_STEP,
  GUIDE_TOTAL_STEPS,
  TOUR_STEPS,
  viewOfStep,
} from "./guide-copy";
import {
  createDefaultRecord,
  markDone,
  markSkipped,
  parseGuideRecord,
  recordStepViewed,
  resetForReplay,
  shouldAutoStart,
  shouldShowHelpBadge,
  type GuideRecord,
} from "./guide-state";

/**
 * QA 独立验证 · 引导「5 步 → 6 步」迁移兼容（P1-2）
 *
 * 风险：老装机（1.3x 及以前）存的是 5 步时代的状态。若迁移把 currentStep=5
 * 当成越界而夹到 6、或把老 done 记录判成未完成，老用户一升级就会被莫名
 * 重放/跳过。步数从 5 加到 6 时，**存量的语义必须原样保留**。
 *
 * 本文件只打纯函数层（guide-state / guide-copy），不依赖 DOM。
 */

/** 造一条「5 步时代」的存量记录（version 就是 1，未升版） */
function legacyRecord(over: Partial<GuideRecord> = {}): string {
  return JSON.stringify({
    version: 1,
    state: "in_progress",
    currentStep: 5,
    stepsViewed: [1, 2, 3, 4, 5],
    tooltipSeen: ["T-03"],
    helpOpened: false,
    updatedAt: 111,
    ...over,
  });
}

describe("引导 5→6 迁移：存量记录原样保留", () => {
  it("老 in_progress 停在 currentStep=5：解析后仍是 5（不被夹到新总步 6）", () => {
    const record = parseGuideRecord(legacyRecord());
    expect(record.state).toBe("in_progress");
    expect(record.currentStep).toBe(5);
    expect(record.stepsViewed).toEqual([1, 2, 3, 4, 5]);
    expect(record.tooltipSeen).toEqual(["T-03"]);
  });

  it("老 done 记录：不因步数 5→6 被判定为需要自动重放", () => {
    const record = parseGuideRecord(
      legacyRecord({ state: "done", currentStep: 5 }),
    );
    expect(record.state).toBe("done");
    // 自动播放的唯一判据是 state=not_started，与步数无关
    expect(shouldAutoStart(record)).toBe(false);
    // B-01：done 即不再亮红点（PRD B-01「guideState ≠ done 时显示」；
    // 注意 guide-state.ts 顶部注释把 done 也写进了「红点保留」，与实现/PRD 不符
    // ——注释措辞问题，行为以 PRD 为准，见收条 P2 观察项）
    expect(shouldShowHelpBadge(record)).toBe(false);
    // skipped（从未开帮助中心）→ 红点保留，把跳过的作者拉回来
    expect(
      shouldShowHelpBadge(parseGuideRecord(legacyRecord({ state: "skipped" }))),
    ).toBe(true);
  });

  it("老 skipped / deferred 记录同样不被重放", () => {
    expect(shouldAutoStart(parseGuideRecord(legacyRecord({ state: "skipped" })))).toBe(
      false,
    );
    expect(
      shouldAutoStart(parseGuideRecord(legacyRecord({ state: "deferred" }))),
    ).toBe(false);
  });

  it("currentStep 越界（老数据损坏写 7）：夹到新总步 6，而不是抛错", () => {
    expect(parseGuideRecord(legacyRecord({ currentStep: 7 })).currentStep).toBe(6);
    expect(parseGuideRecord(legacyRecord({ currentStep: -3 })).currentStep).toBe(1);
    expect(parseGuideRecord(legacyRecord({ currentStep: 0 })).currentStep).toBe(1);
  });

  it("stepsViewed 里混入越界值（老数据 7）：过滤后保留合法项", () => {
    const record = parseGuideRecord(
      legacyRecord({ stepsViewed: [1, 2, 7, 0, 999, 3] }),
    );
    expect(record.stepsViewed).toEqual([1, 2, 3]);
  });

  it("版本不符 / 损坏 JSON：一律退回默认（not_started），引导可重放", () => {
    expect(parseGuideRecord(legacyRecord({ version: 0 } as never)).state).toBe(
      "not_started",
    );
    expect(parseGuideRecord("{ not json").state).toBe("not_started");
    expect(parseGuideRecord(null).state).toBe("not_started");
  });
});

describe("引导步数常量与视图归属（5→6 一致性）", () => {
  it("GUIDE_TOTAL_STEPS = 6、FORCED_MAX_STEP = 4，TOUR_STEPS 恰好 6 条", () => {
    expect(GUIDE_TOTAL_STEPS).toBe(6);
    expect(FORCED_MAX_STEP).toBe(4);
    expect(TOUR_STEPS).toHaveLength(6);
    expect(TOUR_STEPS.map((step) => step.step)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("viewOfStep：第 1、6 步属书架，第 2-5 步属编辑器，越界返回 null", () => {
    expect(viewOfStep(1)).toBe("shelf");
    expect([2, 3, 4, 5].map(viewOfStep)).toEqual([
      "editor",
      "editor",
      "editor",
      "editor",
    ]);
    expect(viewOfStep(6)).toBe("shelf");
    expect(viewOfStep(7)).toBeNull();
    expect(viewOfStep(0)).toBeNull();
  });

  it("viewOfStep 与 TOUR_STEPS 的声明一致（新增步别只在一边登记）", () => {
    for (const step of TOUR_STEPS) {
      expect(viewOfStep(step.step)).toBe(step.view);
    }
  });

  it("第 6 步锚点存在且指向书架顶栏「全局设定中心」", () => {
    const step6 = TOUR_STEPS.find((step) => step.step === 6);
    expect(step6).toBeDefined();
    expect(step6!.target).toBe("shelf-global-setting");
    expect(step6!.view).toBe("shelf");
  });
});

describe("引导推进（步数变化后仍自洽）", () => {
  it("recordStepViewed 推进到第 6 步：state 转 in_progress、currentStep=6", () => {
    const record = createDefaultRecord();
    const next = recordStepViewed(record, 6);
    expect(next.state).toBe("in_progress");
    expect(next.currentStep).toBe(6);
    expect(next.stepsViewed).toEqual([6]);
  });

  it("markDone 收敛到 GUIDE_TOTAL_STEPS（不是写死 5）", () => {
    const next = markDone(createDefaultRecord());
    expect(next.state).toBe("done");
    expect(next.currentStep).toBe(6);
  });

  it("markSkipped 不改 currentStep（保留现场以便帮助中心续看）", () => {
    const record = recordStepViewed(createDefaultRecord(), 3);
    const skipped = markSkipped(record);
    expect(skipped.state).toBe("skipped");
    expect(skipped.currentStep).toBe(3);
  });

  it("replay 重置为从头：not_started + currentStep=1，但保留已看过的弱提示", () => {
    const record = recordStepViewed(createDefaultRecord(), 5);
    const withTooltip: GuideRecord = { ...record, tooltipSeen: ["T-02"] };
    const replay = resetForReplay(withTooltip);
    expect(replay.state).toBe("not_started");
    expect(replay.currentStep).toBe(1);
    expect(replay.stepsViewed).toEqual([]);
    // 重看引导不该把长尾提示再骚扰一遍
    expect(replay.tooltipSeen).toEqual(["T-02"]);
    expect(replay.helpOpened).toBe(true);
  });
});
