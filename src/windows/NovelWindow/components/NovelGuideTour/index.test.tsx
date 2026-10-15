import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P2-1（1.4x）回归守卫：第 5 步点「下一步」后引导不再静默消失。
 *
 * 第 5 步属编辑器视图、第 6 步属书架视图。修复前点下一步 → playingStep 改拍成 6，
 * 书架实例此时 `visible=false` 会 pause()、编辑器实例又因步属书架不渲染 ——
 * 整屏无 Tour、零反馈。修复后：主按钮文案明示「下一步 · 去书架」，点击先推进
 * playingStep（5→6）、再请求 App 切回书架，交给书架实例接管第 6 步。
 *
 * 测法说明：antd `Tour` 走 portal、且真实目标探测在 jsdom 下（无布局）恒返回不可见，
 * 两条都会把用例引向 antd 自身而非本次修复。故这里把 antd `Tour` 换成「透出
 * nextButtonProps 的空替身」、把 `./target` 探测打桩恒成功 —— 精确落在
 * 「主按钮文案 + onClick 接线」这一修复点上。替身不渲染任何原生控件
 * （`*.ui-kit` 守卫禁止窗口内出现原生 <button>/<input>）。
 */
let captured: {
  steps: Array<{ nextButtonProps: { children: string; onClick: () => void } }>;
} | null = null;

vi.mock("antd", () => ({
  Tour: (props: unknown) => {
    captured = props as typeof captured;
    return null;
  },
}));

vi.mock("./target", () => ({
  resolveStepTarget: () => document.createElement("div"),
  isElementVisible: () => true,
  queryTourTarget: () => null,
}));

// 注意：vi.mock 会被提升到顶部，下面的 import 依旧照常用于取真实实现
import { TOUR_STEPS } from "@/shared/novel/guide-copy";
import { useGuideStore } from "../../store/useGuideStore";
import NovelGuideTour from "./index";

const viewOf = (step: number) => TOUR_STEPS.find((item) => item.step === step)!.view;

/** 渲染某一步并等目标探测完成（探测在 rAF 里），返回该步的主按钮描述 */
async function renderAt(step: number) {
  captured = null;
  useGuideStore.setState({ playingStep: step });
  const onGoToView = vi.fn();
  render(<NovelGuideTour view={viewOf(step)} visible onGoToView={onGoToView} />);
  await waitFor(() => expect(captured).not.toBeNull());
  return { next: () => captured!.steps[0].nextButtonProps, onGoToView };
}

beforeEach(() => {
  captured = null;
  useGuideStore.setState({
    record: {
      version: 1,
      state: "in_progress",
      currentStep: 1,
      stepsViewed: [],
      tooltipSeen: [],
      helpOpened: false,
      updatedAt: 0,
    },
    hydrated: true,
    playingStep: null,
    playSource: null,
    helpOpen: false,
    lastTypingAt: 0,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("NovelGuideTour：下一步按钮的跨视图行为（P2-1）", () => {
  it("第 5 步：主按钮「下一步 · 去书架」，点击后推进到第 6 步并请求切回书架", async () => {
    const { next, onGoToView } = await renderAt(5);

    expect(next().children).toBe("下一步 · 去书架");
    act(() => next().onClick());

    expect(useGuideStore.getState().playingStep).toBe(6);
    expect(onGoToView).toHaveBeenCalledWith("shelf");
  });

  it.each([2, 3, 4])(
    "编辑器内第 %i 步：主按钮「下一步」，点击只推进、不切视图",
    async (step) => {
      const { next, onGoToView } = await renderAt(step);

      expect(next().children).toBe("下一步");
      act(() => next().onClick());

      expect(useGuideStore.getState().playingStep).toBe(step + 1);
      expect(onGoToView).not.toHaveBeenCalled();
    },
  );

  it("第 1 步（书架）：主按钮「下一步」，不切视图（反方向由作者动作驱动）", async () => {
    const { next, onGoToView } = await renderAt(1);

    expect(next().children).toBe("下一步");
    act(() => next().onClick());

    expect(useGuideStore.getState().playingStep).toBe(2);
    expect(onGoToView).not.toHaveBeenCalled();
  });

  it("第 6 步（末步）：主按钮「完成」，点击即收尾且不触发切视图", async () => {
    const { next, onGoToView } = await renderAt(6);

    expect(next().children).toBe("完成");
    act(() => next().onClick());

    expect(useGuideStore.getState().playingStep).toBeNull();
    expect(useGuideStore.getState().record.state).toBe("done");
    expect(onGoToView).not.toHaveBeenCalled();
  });

  it("未注入 onGoToView 时点「去书架」不崩（仅推进步，供独立/降级场景）", async () => {
    captured = null;
    useGuideStore.setState({ playingStep: 5 });
    render(<NovelGuideTour view="editor" visible />);

    await waitFor(() => expect(captured).not.toBeNull());
    act(() => captured!.steps[0].nextButtonProps.onClick());

    expect(useGuideStore.getState().playingStep).toBe(6);
  });
});
