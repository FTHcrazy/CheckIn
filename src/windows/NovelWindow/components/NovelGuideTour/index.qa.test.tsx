import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * QA 独立验证 · P2-1（第 5 → 6 步跨视图）——不复用工程师的用例，专门打两个他
 * 没覆盖的面：
 *
 * 1. **两个视图实例同时挂载**（与真实挂法一致：editor 实例注入 onGoToView、
 *    shelf 实例不注入），点第 5 步按钮后断言**书架实例真的把第 6 步渲染出来**——
 *    工程师的用例只挂了单个实例、只断言「回调被调」，证明不了「第 6 步不再静默消失」；
 * 2. **走真实 DOM 点击**（`fireEvent.click` 派发到真节点，而非直接调 props.onClick）：
 *    主按钮确实是可点击元素、事件链通，而不是「拿变量当按钮调一下」。
 *
 * 只把 antd `Tour`（portal + jsdom 无布局）换成透出主按钮的**真实 DOM 节点**，
 * 把 `./target` 探测打桩恒成功（jsdom 无布局，getClientRects 恒空）。store 用真的。
 */

vi.mock("antd", () => ({
  // 真节点 + 真 onClick：让 fireEvent.click 走完整 React 合成事件链。
  // 用 <span>（非原生表单控件，不触发窗口 ui-kit 守卫）。
  Tour: ({
    steps,
  }: {
    steps: Array<{
      nextButtonProps: { children: React.ReactNode; onClick: () => void };
    }>;
  }) => (
    <span data-testid="tour-next" onClick={steps[0].nextButtonProps.onClick}>
      {steps[0].nextButtonProps.children}
    </span>
  ),
}));

vi.mock("./target", () => ({
  resolveStepTarget: () => document.body,
  isElementVisible: () => true,
  queryTourTarget: () => null,
}));

import type { GuideView } from "@/shared/novel/guide-copy";
import { resolveNextAction, TOUR_STEPS } from "@/shared/novel/guide-copy";
import { useGuideStore } from "../../store/useGuideStore";
import NovelGuideTour from "./index";

const labelForStep = (step: number): string =>
  resolveNextAction(TOUR_STEPS.find((item) => item.step === step)!).label;

function resetStore(playingStep: number | null = null): void {
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
    playingStep,
    playSource: null,
    helpOpen: false,
    lastTypingAt: 0,
  });
}

/**
 * 与真实挂法一致：
 * - 编辑器实例**懒挂载**（App 层 `editorMounted`：首次进编辑器才 mount），
 *   一旦挂载便常驻（display 切换）；只有它注入 onGoToView。
 * - 书架实例常驻、不注入 onGoToView。
 *
 * `editorMounted` 随 view 变 editor 自动置真 —— 这样「点第 1 步按钮若误切到编辑器」
 * 会让编辑器实例真的冒出来（可被断言捕捉），而不是被懒挂载掩盖。
 */
function Harness({ initial }: { initial: GuideView }) {
  const [view, setView] = useState<GuideView>(initial);
  const [editorMounted, setEditorMounted] = useState(initial === "editor");
  useEffect(() => {
    if (view === "editor") setEditorMounted(true);
  }, [view]);
  return (
    <>
      {editorMounted && (
        <NovelGuideTour
          view="editor"
          visible={view === "editor"}
          onGoToView={setView}
        />
      )}
      <NovelGuideTour view="shelf" visible={view === "shelf"} />
    </>
  );
}

const nextButton = () => screen.getByTestId("tour-next");

beforeEach(() => resetStore(null));
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("NovelGuideTour 跨视图衔接（QA 独立 · 双实例 + 真点击）", () => {
  it("第 5 步点「下一步 · 去书架」→ 步进到 6、切到书架、且第 6 步真的渲染出来（不再静默消失）", async () => {
    resetStore(5);
    render(<Harness initial="editor" />);

    // 编辑器实例播第 5 步：主按钮明示后果
    await waitFor(() => expect(nextButton().textContent).toBe("下一步 · 去书架"));

    fireEvent.click(nextButton());

    // 步进到第 6 步
    await waitFor(() => expect(useGuideStore.getState().playingStep).toBe(6));

    // 关键：此刻应已切到书架、由 shelf 实例接管第 6 步 —— 主按钮变「完成」，
    // 且**只有一个**实例在渲染（编辑器实例对第 6 步 belongsToThisView=false → null）
    await waitFor(() => expect(nextButton().textContent).toBe("完成"));
    expect(screen.getAllByTestId("tour-next")).toHaveLength(1);
    // 这一步真的「续上了」：记录里的 currentStep 被推进到 6
    expect(useGuideStore.getState().record.currentStep).toBe(6);
  });

  it("编辑器内中间步（2→3 / 3→4 / 4→5）：点「下一步」只推进、不切视图", async () => {
    for (const step of [2, 3, 4]) {
      resetStore(step);
      const { unmount } = render(<Harness initial="editor" />);
      await waitFor(() =>
        expect(nextButton().textContent).toBe(labelForStep(step)),
      );

      fireEvent.click(nextButton());

      await waitFor(() =>
        expect(useGuideStore.getState().playingStep).toBe(step + 1),
      );
      // 换步会先清空目标再在 rAF 里重新探测，故按钮短暂消失后重现。
      // 若误切到 shelf，编辑器实例收摊、shelf 实例对 editor 步不渲染 → 按钮永不回来。
      // 按钮重现（视图未切走）且文案等于新一步「应由数据派生出的文案」：
      // 2→3 / 3→4 为「下一步」；4→5 时新步正是第 5 步，其文案本就是「下一步 · 去书架」。
      await waitFor(() =>
        expect(nextButton().textContent).toBe(labelForStep(step + 1)),
      );
      unmount();
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("第 1 步（书架）：跨视图到第 2 步但不切视图（反方向由作者动作驱动）", async () => {
    resetStore(1);
    render(<Harness initial="shelf" />);

    await waitFor(() => expect(nextButton().textContent).toBe("下一步"));
    fireEvent.click(nextButton());

    await waitFor(() => expect(useGuideStore.getState().playingStep).toBe(2));
    // 仍未切视图：书架实例对第 2 步不渲染，编辑器实例 visible=false 也不渲染 → 按钮消失
    // （若误判为 switch，会切到 editor 并把第 2 步渲染出来 —— 这正是要防的「判据过宽」）
    await waitFor(() =>
      expect(screen.queryByTestId("tour-next")).toBeNull(),
    );
  });

  it("第 6 步（末步）：主按钮「完成」，点击收尾为 done、不切视图", async () => {
    resetStore(6);
    render(<Harness initial="shelf" />);

    await waitFor(() => expect(nextButton().textContent).toBe("完成"));
    fireEvent.click(nextButton());

    await waitFor(() => expect(useGuideStore.getState().playingStep).toBeNull());
    expect(useGuideStore.getState().record.state).toBe("done");
    // 收尾后不再有引导按钮
    expect(screen.queryByTestId("tour-next")).toBeNull();
  });

  it("边界：未注入 onGoToView 时点「去书架」不崩，仅推进步（该回调只在编辑器实例注入）", async () => {
    resetStore(5);
    render(<NovelGuideTour view="editor" visible />); // 故意不传 onGoToView

    await waitFor(() => expect(nextButton().textContent).toBe("下一步 · 去书架"));
    expect(() => fireEvent.click(nextButton())).not.toThrow();

    expect(useGuideStore.getState().playingStep).toBe(6);
  });
});

describe("P2-1 判据可持续性（源码级：不写死步骤号）", () => {
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const body = (() => {
    const src = stripComments(
      readFileSync(
        join(process.cwd(), "src/shared/novel/guide-copy.ts"),
        "utf8",
      ),
    );
    const start = src.indexOf("export function resolveNextAction");
    const open = src.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (; end < src.length; end += 1) {
      if (src[end] === "{") depth += 1;
      else if (src[end] === "}" && (depth -= 1) === 0) break;
    }
    return src.slice(open + 1, end);
  })();

  it("判据是数据驱动的「下一视图 ≠ 当前视图 且 目标为书架」，而非裸跨视图", () => {
    expect(body).toContain("next.view !== step.view");
    expect(body).toContain('next.view === "shelf"');
    // 两者是 && 关系（顺序不限）：裸 `next.view !== step.view` 会把第 1→2 步
    // （书架→编辑器）也判成 switch，作者点第 1 步的「下一步」就会被拽进编辑器
    expect(body).toMatch(/next\.view\s*!==\s*step\.view\s*&&\s*next\.view\s*===\s*"shelf"/);
  });

  it("不引用任何步骤号字面量：靠 step.step + 1 查下一步（以后增删步骤自动跟随）", () => {
    expect(body).toContain("step.step + 1");
    // 不得出现「拿步骤号跟数字比较/判等」的写法（写死 5 会在加步后失效）
    expect(body).not.toMatch(/step\.step\s*===\s*\d/);
    expect(body).not.toMatch(/\bstep\.step\s*[<>]=?\s*\d/);
  });
});

describe("P2-1 接线（App / NovelPage / BookshelfPage 源码级）", () => {
  const read = (...seg: string[]): string => readFileSync(join(process.cwd(), ...seg), "utf8");
  const strip = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("App 的 goToView 来自跳转 store，并作为 onGoToView 传给 NovelPage", () => {
    const app = strip(read("src/windows/NovelWindow/App.tsx"));
    // 视图状态已收口 useEntityJumpStore：App 只订阅并透传，不再自己持 setView
    expect(app).toContain("const goToView = useEntityJumpStore((s) => s.goToView);");
    expect(app).toContain("onGoToView={goToView}");
  });

  it("只有编辑器 Tour 实例注入 onGoToView；书架实例不注入（反方向由作者动作驱动）", () => {
    const editor = strip(
      read("src/windows/NovelWindow/pages/NovelPage/NovelPage.tsx"),
    );
    const shelf = strip(
      read("src/windows/NovelWindow/pages/BookshelfPage/BookshelfPage.tsx"),
    );
    // 允许属性换行（格式化会把四个属性拆成多行）：
    // 断的是「同一个实例上这三个 prop 都在」，不是某一行的字面写法
    expect(editor).toMatch(
      /<NovelGuideTour\s+view="editor"\s+visible=\{visible\}\s+onGoToView=\{onGoToView\}\s*\/>/,
    );
    expect(shelf).toContain('<NovelGuideTour view="shelf" visible={visible} />');
    // 书架实例不接该 prop：反方向（书架→编辑器）由「新建作品」动作挂载编辑器，
    // 不由引导按钮代劳；给书架实例接上会让第 1 步也出现「去书架」语义错乱
    expect(shelf).not.toContain("onGoToView");
  });

  it("Tour 对 onGoToView 走可选调用（降级 / 未注入时不崩）", () => {
    const tour = strip(
      read("src/windows/NovelWindow/components/NovelGuideTour/index.tsx"),
    );
    expect(tour).toContain("onGoToView?.(nextAction.view)");
  });
});
