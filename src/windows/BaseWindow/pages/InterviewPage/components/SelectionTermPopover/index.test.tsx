import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SelectionTermPopover from "./index";
import type { SelectionTerm } from "../../hooks/useSelectionTerms";

/**
 * 划词浮层的**复位口径**。
 *
 * 回归的是实机上一个很刺眼的现象：点「问 AI」后解释区一闪就没了，等模型回来
 * 才重新出现。原因是浮层拿 `selection` 的**对象引用**判断「换词了没」，
 * 而划词 hook 每次 `pointerup` 都会读出内容相同的新对象 —— 复位逻辑被空跑一次，
 * 顺手把刚设好的 loading 与 AI 解释一起清掉。
 */

function makeSelection(text: string, top = 100): SelectionTerm {
  return { text, sentence: `${text} 出现在这句话里`, anchor: { top, bottom: top + 18, left: 40 } };
}

const ANSWER = { loading: false, text: null, error: null };

function setup(selection: SelectionTerm | null) {
  const onClearAnswer = vi.fn();
  const element = (next: SelectionTerm | null) => (
    <SelectionTermPopover
      selection={next}
      existing={null}
      onAddTerm={() => undefined}
      onSupplement={() => undefined}
      onAskAi={() => undefined}
      onClose={() => undefined}
      answer={ANSWER}
      onClearAnswer={onClearAnswer}
    />
  );
  const { rerender } = render(element(selection));
  return { onClearAnswer, show: (next: SelectionTerm | null) => rerender(element(next)) };
}

afterEach(cleanup);

describe("SelectionTermPopover 复位", () => {
  it("同一选区换个对象渲染：不清 AI 解释，浮层也不消失", async () => {
    const first = makeSelection("requestIdleCallback");
    const { onClearAnswer, show } = setup(first);
    await screen.findByRole("dialog", { name: /requestIdleCallback/ });
    // 首次出现算一次「新选区」
    expect(onClearAnswer).toHaveBeenCalledTimes(1);

    // 划词 hook 再读一次同一个选区：内容一样、对象是新的
    const again = makeSelection("requestIdleCallback");
    expect(again).not.toBe(first);
    show(again);

    expect(onClearAnswer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: /requestIdleCallback/ })).not.toBeNull();
  });

  it("真的换了一个词：才清掉上一次的解释", async () => {
    const { onClearAnswer, show } = setup(makeSelection("宏任务"));
    await screen.findByRole("dialog", { name: /宏任务/ });

    show(makeSelection("微任务", 260));

    expect(onClearAnswer).toHaveBeenCalledTimes(2);
  });

  it("选区收起时也复位，避免下次弹层挂着旧解释", async () => {
    const { onClearAnswer, show } = setup(makeSelection("闭包"));
    await screen.findByRole("dialog", { name: /闭包/ });

    show(null);

    expect(onClearAnswer).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
