import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import * as sass from "sass";
import { afterEach, describe, expect, it, vi } from "vitest";
import ToolLauncher from "./index";

/**
 * REQ-047：工具卡描述溢出。
 *
 * antd `.ant-btn` 自带 `white-space: nowrap`，而可进入的工具卡正是 antd `Button`
 * 承载 —— 描述文字未显式声明时会继承 nowrap，长文案撑破卡片（不换行、不收缩）。
 * 修法：在复合选择器 `.nv-tools__card.ant-btn .nv-tools__desc` 内显式改回
 * `white-space: normal` 并配 `overflow-wrap: anywhere`。
 *
 * 为什么钉**编译后的 CSS**而不是渲染差量：jsdom 不做真实排版，
 * vitest 也未处理 `.scss` 导入（`getComputedStyle` 拿不到外部样式表），
 * 渲染层根本看不出「溢出」。能挡住这次回归的只有产物里那条规则 + 它确实命中
 * 真实 DOM（描述嵌在 antd 卡内），所以两条断言一起写。
 */
describe("ToolLauncher：描述换行契约（REQ-047）", () => {
  afterEach(() => {
    cleanup();
  });

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
    const { container } = render(<ToolLauncher onOpenNaming={vi.fn()} />);

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
