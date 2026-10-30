import { describe, expect, it } from "vitest";
import {
  FORCED_MAX_STEP,
  GUIDE_TOTAL_STEPS,
  resolveNextAction,
  TOUR_STEPS,
} from "@/shared/novel/guide-copy";

/**
 * 引导「下一步」按钮行为（P2-1 · 1.4x）。
 *
 * 判据**来自数据**（当前步与下一步各属哪个视图），所以这里直接枚举 `TOUR_STEPS`
 * 自证，而不是逐个写死步骤号 —— 以后增删步骤，这份用例跟着新数据自动覆盖。
 */
describe("resolveNextAction：下一步主按钮文案与跨视图判定", () => {
  it("步骤是连续的 1..GUIDE_TOTAL_STEPS（判定依赖 step + 1 是否存在）", () => {
    TOUR_STEPS.forEach((step, index) => {
      expect(step.step).toBe(index + 1);
    });
    expect(TOUR_STEPS.length).toBe(GUIDE_TOTAL_STEPS);
  });

  it("末步（第 6 步）→ 完成", () => {
    const last = TOUR_STEPS[TOUR_STEPS.length - 1];
    expect(resolveNextAction(last)).toEqual({
      kind: "finish",
      label: "完成",
      view: null,
    });
  });

  it("第 5 步 → 跨视图回书架：文案明示「去书架」并带切换目标", () => {
    const step5 = TOUR_STEPS.find((item) => item.step === 5)!;
    expect(resolveNextAction(step5)).toEqual({
      kind: "switch",
      label: "下一步 · 去书架",
      view: "shelf",
    });
  });

  it("编辑器内的中间步（2→3 / 3→4 / 4→5）→ 普通「下一步」，不切视图", () => {
    for (const stepNumber of [2, 3, 4]) {
      const step = TOUR_STEPS.find((item) => item.step === stepNumber)!;
      expect(
        resolveNextAction(step),
        `第 ${stepNumber} → ${stepNumber + 1} 步`,
      ).toEqual({ kind: "next", label: "下一步", view: null });
    }
  });

  it("书架 → 编辑器（第 1→2 步）不切视图：那一步由作者动作驱动", () => {
    const step1 = TOUR_STEPS.find((item) => item.step === 1)!;
    expect(step1.view).toBe("shelf");
    expect(resolveNextAction(step1)).toEqual({
      kind: "next",
      label: "下一步",
      view: null,
    });
  });

  it("全步骤枚举：只有「回书架」一个方向被判为 switch（防止判据过宽）", () => {
    const switching = TOUR_STEPS.filter(
      (step) => resolveNextAction(step).kind === "switch",
    ).map((step) => step.step);
    expect(switching).toEqual([5]);
  });

  it("强制段仍为 1–4：第 5、6 步不在强制段内（语义未被本修复改动）", () => {
    expect(FORCED_MAX_STEP).toBe(4);
    const step5 = TOUR_STEPS.find((item) => item.step === 5)!;
    const step6 = TOUR_STEPS.find((item) => item.step === 6)!;
    expect(step5.step <= FORCED_MAX_STEP).toBe(false);
    expect(step6.step <= FORCED_MAX_STEP).toBe(false);
  });
});
