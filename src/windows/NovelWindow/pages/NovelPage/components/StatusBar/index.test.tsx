import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StatusBar from "./index";
import { useSensitiveStore } from "../../store/useSensitiveStore";

/**
 * 状态条的「敏感标注」独立开关（D-08，QA 独立补充）
 *
 * 验收 §2.2-1/2 说的是**界面行为**：状态条上多一颗开关，它只改标注显示，
 * 不动检测与计数。store 与纯函数侧已有用例（`useSensitiveStore.test.ts` /
 * `sensitive/types.test.ts`），但「开关真的出现在状态条上、mode=off 时禁用」
 * 只在渲染层看得见 —— 这两条若不钉，改版时很容易把开关顺手删掉而全仓仍绿。
 */
function resetSensitive(overrides: Partial<{ mode: "auto" | "manual" | "off"; markVisible: boolean }> = {}) {
  useSensitiveStore.setState((state) => ({
    config: {
      ...state.config,
      mode: overrides.mode ?? "manual",
      markVisible: overrides.markVisible ?? true,
    },
  }));
}

describe("StatusBar：敏感标注独立开关（D-08）", () => {
  beforeEach(() => {
    resetSensitive();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("状态条上有独立的「敏感标注显示」开关，且与「敏感 N」角标并存", () => {
    render(<StatusBar annotationOn onToggleAnnotation={vi.fn()} onOpenSensitive={vi.fn()} />);
    const toggle = screen.getByLabelText("敏感词标注显示");
    expect(toggle).toBeTruthy();
    // 关闭标注不该把「检测结果」这颗角标一起藏掉 —— 两者是不同的东西
    expect(screen.getByText("敏感标注")).toBeTruthy();
  });

  it("点开关只改 markVisible，不改检测模式（关标注不等于关检测）", () => {
    resetSensitive({ mode: "auto", markVisible: true });
    render(<StatusBar annotationOn onToggleAnnotation={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("敏感词标注显示"));

    const state = useSensitiveStore.getState();
    expect(state.config.markVisible).toBe(false);
    expect(state.config.mode).toBe("auto");
  });

  it("检测模式为 off 时开关禁用：没有标注可显示，不给「点了没反应」的错觉", () => {
    resetSensitive({ mode: "off", markVisible: true });
    render(<StatusBar annotationOn onToggleAnnotation={vi.fn()} />);

    const toggle = screen.getByLabelText("敏感词标注显示");
    expect(toggle.hasAttribute("disabled") || toggle.getAttribute("aria-disabled") === "true").toBe(
      true,
    );
  });
});
