import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ToolLauncher from ".";

/**
 * 工具箱启动器（UI-09「规划中」占位交互规范）。
 *
 * 回归背景：规划中的两张卡此前是 `<div>` 死链 —— 外观只比可用卡淡一点，
 * 作者点下去毫无反应，观感就是「点了没反应 / 是不是坏了」。现在三张卡都是
 * 真按钮：可用的进入二级面板，规划中的给一条 toast 说明。
 */

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const setup = () => {
  const onOpenNaming = vi.fn();
  const onNotify = vi.fn();
  render(<ToolLauncher onOpenNaming={onOpenNaming} onNotify={onNotify} />);
  return { onOpenNaming, onNotify };
};

describe("ToolLauncher：规划中的工具不是死链", () => {
  it("三张卡都是真按钮（占位卡可看不可点是这次要修的病）", () => {
    setup();
    const cards = document.querySelectorAll(".nv-tools__card");
    expect(cards).toHaveLength(3);
    cards.forEach((card) => {
      expect(card.tagName).toBe("BUTTON");
    });
    // 「规划中」的卡也必须能被键盘聚焦到，否则读屏用户完全够不着
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("点「规划中」的卡给明确反馈，不再静默", () => {
    const { onNotify, onOpenNaming } = setup();

    screen.getByText("人物关系网络", { selector: "span" }).click();
    expect(onNotify).toHaveBeenCalledTimes(1);
    const [text, tone] = onNotify.mock.calls[0] as [string, string];
    expect(text).toContain("人物关系网络");
    expect(text).toContain("规划中");
    expect(tone).toBe("info");

    screen.getByText("架空地图", { selector: "span" }).click();
    expect(onNotify).toHaveBeenCalledTimes(2);
    expect(onNotify.mock.calls[1][0]).toContain("架空地图");

    // 规划中的卡不该顺手把起名器也打开
    expect(onOpenNaming).not.toHaveBeenCalled();
  });

  it("可用的工具正常进入二级面板，且不触发「规划中」提示", () => {
    const { onOpenNaming, onNotify } = setup();
    screen.getByText("起名器", { selector: "span" }).click();
    expect(onOpenNaming).toHaveBeenCalledTimes(1);
    expect(onNotify).not.toHaveBeenCalled();
  });

  it("规划中的卡带 is-planned（平面底 + 虚描边的挂点）", () => {
    setup();
    const planned = [...document.querySelectorAll(".nv-tools__card")].filter(
      (card) => card.className.includes("is-planned"),
    );
    expect(planned).toHaveLength(2);
  });

  it("源码里不再有 `<div className=\"nv-tools__card\"` 这种死链渲染", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "src/windows/NovelWindow/pages/NovelPage/components/SupportPanel/components/ToolLauncher/index.tsx",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/<div[^>]*nv-tools__card/);
    // 占位卡必须有 toast 兜底，否则又会退化成「点了没反应」
    expect(source).toContain("onNotify(tool.plannedHint");
  });
});
