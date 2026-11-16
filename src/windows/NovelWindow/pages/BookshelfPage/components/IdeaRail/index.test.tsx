import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NovelNoteDTO } from "@/shared/types/electron";
import IdeaRail from "./index";

/**
 * 灵感库列表的**分流守卫**（2.55.0）。
 *
 * 起因：右栏滚到最底部会抖动。虚拟列表在「内容刚好比视口高一点点」时，会把
 * 滚动位置随高度修正反复回拉；而灵感库常态只有个位数条目，本就不需要虚拟化。
 * 所以条数低于阈值必须走普通渲染 —— 这条断言钉的就是「别再退回一律虚拟化」。
 *
 * jsdom 没有布局，Virtuoso 视口高度为 0 不渲染任何行；这里用平铺替身，只保留
 * data + itemContent 的行为契约，并把「是否被调用」记下来当作分流证据。
 */
const state = vi.hoisted(() => ({
  calls: [] as number[],
  estimates: [] as Array<number | undefined>,
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>(props: {
    className?: string;
    data: T[];
    defaultItemHeight?: number;
    itemContent: (index: number, item: T) => ReactNode;
  }) => {
    state.calls.push(props.data.length);
    state.estimates.push(props.defaultItemHeight);
    return (
      <div className={props.className}>
        {props.data.map((item, index) => (
          <div key={index}>{props.itemContent(index, item)}</div>
        ))}
      </div>
    );
  },
}));

const makeNotes = (count: number): NovelNoteDTO[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    workId: "",
    content: `第 ${index} 条灵感`,
    createdAt: Date.now() - index * 1000,
    pinned: false,
  }));

const renderRail = (notes: NovelNoteDTO[]) =>
  render(
    <IdeaRail
      counts={{ all: notes.length, unassigned: notes.length, pinned: 0, archived: 0 }}
      filter="all"
      onFilterChange={() => undefined}
      visibleNotes={notes}
      workOptions={[]}
      workNameOf={() => null}
      onAdd={() => true}
      onTogglePin={() => undefined}
      onMove={() => undefined}
      onUpdateContent={() => undefined}
      onRemove={() => undefined}
    />,
  );

afterEach(() => {
  cleanup();
  state.calls.length = 0;
  state.estimates.length = 0;
});

describe("IdeaRail：小数据集不挂虚拟列表", () => {
  it("常态条数（8 条）走普通渲染，卡片全在 DOM 里", () => {
    const { container } = renderRail(makeNotes(8));

    expect(state.calls).toEqual([]);
    expect(container.querySelectorAll(".bs-idea").length).toBe(8);
  });

  it("达到阈值（30 条）才交给虚拟列表", () => {
    const { container } = renderRail(makeNotes(30));

    expect(state.calls).toEqual([30]);
    expect(container.querySelectorAll(".bs-idea").length).toBe(30);
  });

  it("虚拟列表必须带来行高估算，否则首帧总高会从视口高跳一次", () => {
    renderRail(makeNotes(30));

    expect(state.estimates).toEqual([96]);
  });

  it("空列表既不虚拟化也不留空壳滚动区", () => {
    const { container } = renderRail([]);

    expect(state.calls).toEqual([]);
    expect(container.querySelector(".bs-rail__list")).toBeNull();
    expect(container.textContent).toContain("还没有符合条件的灵感");
  });
});
