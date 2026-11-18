import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InterviewMuteHintDTO } from "@/shared/types/electron";
import type { GlossaryTerm } from "../../data/interview-glossary";
import MutePanel from "./index";

function hintOf(overrides: Partial<InterviewMuteHintDTO> = {}): InterviewMuteHintDTO {
  return {
    id: "u-n-1",
    termId: "g-throttle",
    key: "节流",
    left: "字",
    right: "与限流",
    createdAt: new Date(2026, 10, 18).getTime(),
    ...overrides,
  };
}

const THROTTLE: GlossaryTerm = {
  id: "g-throttle",
  term: "节流",
  domain: "browser",
  short: "限制单位时间内的执行次数。",
  detail: ["窗口内只跑一次。"],
};

/**
 * 「已解除的名词绑定」面板。
 *
 * 解除之后那段文字就不再是按钮，也就无法再右键它 —— 这个抽屉是唯一的撤销口，
 * 所以它必须把「哪一处」讲清楚（词名 + 当时的上下文 + 命中的键），
 * 只显示 id 等于让用户盲选。
 */
describe("MutePanel", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("没有记录时给空态（入口只在这时隐藏，抽屉本身仍要能解释清楚）", () => {
    render(
      <MutePanel
        open
        items={[]}
        termOf={() => undefined}
        pendingId={null}
        onRestore={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("没有解除过任何名词绑定")).not.toBeNull();
  });

  it("一条记录：词名 + 上下文回放 + 命中键", () => {
    render(
      <MutePanel
        open
        items={[hintOf()]}
        termOf={() => THROTTLE}
        pendingId={null}
        onRestore={() => {}}
        onClose={() => {}}
      />,
    );

    // 词名与上下文里那处命中词都写着「节流」：一个在标题位，一个在回放里
    expect(document.querySelector(".interview-mute__term")?.textContent).toBe("节流");
    // 前后各 6 字原样拼回来（左 + 命中 + 右），用户认得出是哪一句
    expect(document.querySelector(".interview-mute__context")?.textContent).toBe("字节流与限流");
    expect(document.querySelector(".interview-mute__meta")?.textContent).toBe("命中键「节流」");
    // 词名与命中键一致时不该标注「别名」（否则每条都像别名）
    expect(document.querySelector(".interview-mute__meta")?.textContent).not.toContain("别名");
  });

  it("命中别名时明确标出来（用户点的是别名，不是词名）", () => {
    render(
      <MutePanel
        open
        items={[hintOf({ key: "throttle" })]}
        termOf={() => THROTTLE}
        pendingId={null}
        onRestore={() => {}}
        onClose={() => {}}
      />,
    );
    expect(document.querySelector(".interview-mute__meta")?.textContent).toBe(
      "命中键「throttle」（别名）",
    );
  });

  it("词条已被删掉时回落显示 id，而不是整行消失", () => {
    render(
      <MutePanel
        open
        items={[hintOf({ termId: "u-g-gone" })]}
        termOf={() => undefined}
        pendingId={null}
        onRestore={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("u-g-gone")).not.toBeNull();
  });

  it("点「恢复」把 id 交给页面（撤销是唯一的反悔路径）", () => {
    const onRestore = vi.fn();
    render(
      <MutePanel
        open
        items={[hintOf()]}
        termOf={() => THROTTLE}
        pendingId={null}
        onRestore={onRestore}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /恢复/ }));
    expect(onRestore).toHaveBeenCalledWith("u-n-1");
  });
});
