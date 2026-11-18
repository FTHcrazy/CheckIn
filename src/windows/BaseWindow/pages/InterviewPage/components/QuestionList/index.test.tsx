import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import QuestionList from "./index";

/**
 * 换分类时列表要回到顶部。
 *
 * 实机反馈：在「JavaScript」里翻到列表中间换到「React」，右侧还停在原来的
 * 滚动位置，第一屏看到半截列表，很像这个分类只有这么几道题。
 */
const baseProps = {
  questions: [],
  total: 0,
  page: 1,
  pageCount: 1,
  pageSize: 10,
  keyword: "",
  favorites: new Set<string>(),
  originById: {},
  staleIds: new Set<string>(),
  pendingId: null,
  onToggleFavorite: () => undefined,
  onPageChange: () => undefined,
  onReset: () => undefined,
  onEdit: () => undefined,
  onHide: () => undefined,
  onRevert: () => undefined,
  onDeleteNew: () => undefined,
  onAckBase: () => undefined,
};

function scrollerOf(container: HTMLElement): HTMLDivElement {
  const el = container.querySelector<HTMLDivElement>(".interview-list__scroll");
  if (!el) throw new Error("找不到列表滚动容器");
  return el;
}

describe("QuestionList 滚动位置", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("换分类后回到顶部", () => {
    const { container, rerender } = render(
      <QuestionList {...baseProps} scrollResetKey="foundation:all" />,
    );
    const scroller = scrollerOf(container);
    scroller.scrollTop = 240;

    rerender(<QuestionList {...baseProps} scrollResetKey="foundation:foundation-react" />);

    expect(scroller.scrollTop).toBe(0);
  });

  it("翻页后回到顶部（翻页按钮就在底部，不重置等于翻页没反应）", () => {
    const { container, rerender } = render(
      <QuestionList {...baseProps} page={1} scrollResetKey="foundation:all" />,
    );
    const scroller = scrollerOf(container);
    scroller.scrollTop = 240;

    rerender(<QuestionList {...baseProps} page={2} scrollResetKey="foundation:all" />);

    expect(scroller.scrollTop).toBe(0);
  });

  it("同一个分类内重新渲染不动滚动位置（否则收藏一下就被弹回顶部）", () => {
    const { container, rerender } = render(
      <QuestionList {...baseProps} scrollResetKey="foundation:all" />,
    );
    const scroller = scrollerOf(container);
    scroller.scrollTop = 240;

    rerender(<QuestionList {...baseProps} scrollResetKey="foundation:all" />);

    expect(scroller.scrollTop).toBe(240);
  });
});
