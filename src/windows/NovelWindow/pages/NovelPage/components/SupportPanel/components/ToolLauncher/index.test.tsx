import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as sass from "sass";
import ToolLauncher from ".";

/**
 * 工具箱启动器的两条契约：
 *
 * 1. UI-09「规划中」占位交互规范 —— 回归背景：规划中的两张卡此前是 `<div>` 死链，
 *    外观只比可用卡淡一点，作者点下去毫无反应，观感就是「点了没反应 / 是不是坏了」。
 *    现在三张卡都是真按钮：可用的进入二级面板，规划中的给一条 toast 说明。
 * 2. REQ-047 描述换行 —— antd `.ant-btn` 自带 `white-space: nowrap`，而可进入的
 *    工具卡正是 antd `Button` 承载，描述文字未显式声明时会继承 nowrap，长文案撑破
 *    卡片。修法是在复合选择器 `.nv-tools__card.ant-btn .nv-tools__desc` 内显式改回
 *    `white-space: normal` 并配 `overflow-wrap: anywhere`。
 *
 *    为什么换行那条钉**编译后的 CSS**而不是渲染差量：jsdom 不做真实排版，
 *    vitest 也未处理 `.scss` 导入（`getComputedStyle` 拿不到外部样式表），
 *    渲染层根本看不出「溢出」。能挡住这次回归的只有产物里那条规则 + 它确实命中
 *    真实 DOM（描述嵌在 antd 卡内），所以两条断言一起写。
 */

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const setup = () => {
  const onOpenNaming = vi.fn();
  const onOpenSensitive = vi.fn();
  const onOpenConsistency = vi.fn();
  const onOpenExtract = vi.fn();
  const onNotify = vi.fn();
  render(
    <ToolLauncher
      onOpenNaming={onOpenNaming}
      onOpenSensitive={onOpenSensitive}
      onOpenConsistency={onOpenConsistency}
      onOpenExtract={onOpenExtract}
      onNotify={onNotify}
    />,
  );
  return { onOpenNaming, onOpenSensitive, onOpenConsistency, onOpenExtract, onNotify };
};

describe("ToolLauncher：规划中的工具不是死链", () => {
  it("每张卡都是真按钮（占位卡可看不可点是这次要修的病）", () => {
    setup();
    const cards = document.querySelectorAll(".nv-tools__card");
    // 起名 / 敏感词 / 一致性校对 / 抽取设定 / 关系网络 / 架空地图
    expect(cards).toHaveLength(6);
    cards.forEach((card) => {
      expect(card.tagName).toBe("BUTTON");
    });
    // 「规划中」的卡也必须能被键盘聚焦到，否则读屏用户完全够不着
    expect(screen.getAllByRole("button")).toHaveLength(6);
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
    const { onOpenNaming, onOpenSensitive, onOpenConsistency, onOpenExtract, onNotify } =
      setup();
    screen.getByText("起名器", { selector: "span" }).click();
    expect(onOpenNaming).toHaveBeenCalledTimes(1);
    expect(onNotify).not.toHaveBeenCalled();

    screen.getByText("敏感词检测", { selector: "span" }).click();
    expect(onOpenSensitive).toHaveBeenCalledTimes(1);

    // B6 两个新入口：一致性校对（纯本地）与抽取设定（AI）
    screen.getByText("一致性校对", { selector: "span" }).click();
    expect(onOpenConsistency).toHaveBeenCalledTimes(1);

    screen.getByText("抽取设定", { selector: "span" }).click();
    expect(onOpenExtract).toHaveBeenCalledTimes(1);

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

describe("ToolLauncher：人物关系网络入口（R27）", () => {
  it("传入 onOpenRelation 后卡片翻成可用态，点击开窗口且不再走「规划中」toast", () => {
    const onOpenRelation = vi.fn();
    const onNotify = vi.fn();
    render(
      <ToolLauncher
        onOpenNaming={vi.fn()}
        onOpenSensitive={vi.fn()}
        onOpenConsistency={vi.fn()}
        onOpenExtract={vi.fn()}
        onNotify={onNotify}
        onOpenRelation={onOpenRelation}
      />,
    );

    const card = [...document.querySelectorAll(".nv-tools__card")].find((item) =>
      item.textContent?.includes("人物关系网络"),
    );
    expect(card).toBeTruthy();
    expect(card!.className).not.toContain("is-planned");

    screen.getByText("人物关系网络", { selector: "span" }).click();
    expect(onOpenRelation).toHaveBeenCalledTimes(1);
    expect(onNotify).not.toHaveBeenCalled();
  });
});

describe("ToolLauncher：描述换行契约（REQ-047）", () => {
  const compiled = (): string =>
    sass
      .compile(
        path.resolve(
          process.cwd(),
          "src/windows/NovelWindow/pages/NovelPage/components/SupportPanel/components/ToolLauncher/index.scss",
        ),
        { style: "expanded" },
      )
      .css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("复合选择器把 .nv-tools__desc 的 white-space 覆盖回 normal", () => {
    const css = compiled();
    const at = css.indexOf(".nv-tools__card.ant-btn .nv-tools__desc");
    expect(at, "缺少 .nv-tools__card.ant-btn .nv-tools__desc 规则").toBeGreaterThan(-1);

    const open = css.indexOf("{", at);
    const end = css.indexOf("}", open);
    const body = css.slice(open + 1, end);
    expect(body).toContain("white-space: normal");
    expect(body).toContain("overflow-wrap: anywhere");
  });

  it("描述确实嵌在 .nv-tools__card.ant-btn 内（规则不会失配成死 CSS），长文案整段保留", () => {
    const { container } = render(
      <ToolLauncher
        onOpenNaming={vi.fn()}
        onOpenSensitive={vi.fn()}
        onOpenConsistency={vi.fn()}
        onOpenExtract={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    const card = container.querySelector<HTMLElement>(".nv-tools__card.ant-btn");
    expect(card).not.toBeNull();
    const desc = card!.querySelector(".nv-tools__desc");
    expect(desc).not.toBeNull();

    // 最坏情况：无空格长串（≥60 字）。渲染层不做任何截断，换行交给上面的 CSS。
    const long = "长".repeat(60);
    expect([...long].length).toBeGreaterThanOrEqual(60);
    desc!.textContent = long;
    expect(desc!.textContent).toBe(long);
  });
});
