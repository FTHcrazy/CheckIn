import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterGroup } from "../../novel-utils";
import type { NovelChapter, NovelVolume } from "../../types";
import ChapterTree from "./index";

/**
 * 平铺渲染替身：jsdom 无真实布局，真 Virtuoso 视口高 0、一行都不渲染。
 * 替身额外暴露 `scrollToIndex` 供断言——这正是本次要测的行为。
 */
const scrollToIndex = vi.fn();
vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>(props: {
    data: T[];
    itemContent: (index: number, item: T) => React.ReactNode;
  }) => {
    // 把 handle 挂到 ref 上，模拟真组件的 useImperativeHandle
    const ref = props as unknown as { ref?: { current: unknown } };
    if (ref.ref) ref.ref.current = { scrollToIndex };
    return <>{props.data.map((item, index) => props.itemContent(index, item))}</>;
  },
}));

const volume = (id: string, sort: number): NovelVolume => ({
  id,
  workId: "w1",
  name: `第${sort}卷`,
  sort,
});

const chapter = (
  id: string,
  volumeId: string,
  sort: number,
  title: string,
): NovelChapter => ({
  id,
  workId: "w1",
  volumeId,
  title,
  content: "",
  wordCount: 0,
  status: "draft",
  sort,
  updatedAt: 0,
});

/** 两卷 × 各 3 章：扁平行 = v1, c1, c2, c3, v2, c4, c5, c6 */
const groups: ChapterGroup[] = [
  {
    volume: volume("v1", 1),
    chapters: [
      chapter("c1", "v1", 1, "出生"),
      chapter("c2", "v1", 2, "离乡"),
      chapter("c3", "v1", 3, "入城"),
    ],
  },
  {
    volume: volume("v2", 2),
    chapters: [
      chapter("c4", "v2", 1, "拜师"),
      chapter("c5", "v2", 2, "悟道"),
      chapter("c6", "v2", 3, "出山"),
    ],
  },
];

const baseProps = {
  collapsed: false,
  groups,
  chapterNumbers: new Map(groups.flatMap((g) => g.chapters).map((c, i) => [c.id, i + 1])),
  numberStyle: "arabic" as const,
  volumeSuffix: "卷",
  onSelect: vi.fn(),
  onToggleStatus: vi.fn(),
  onCreate: vi.fn(),
  onCreateChapterInVolume: vi.fn(),
  onCreateVolume: vi.fn(),
  onRenameChapter: vi.fn(),
  onDeleteChapter: vi.fn(),
  onReorderChapter: vi.fn(),
  onMoveChapterToVolume: vi.fn(),
  onReorderVolume: vi.fn(),
  onRenameVolume: vi.fn(),
};

describe("ChapterTree 激活章自动滚动（跳转正文时左栏定位）", () => {
  beforeEach(() => {
    scrollToIndex.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("挂载时已带激活章 → 滚到该章", () => {
    render(<ChapterTree {...baseProps} activeChapterId="c3" />);
    // 扁平行下标：v1=0, c1=1, c2=2, c3=3
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 3, align: "center" });
  });

  it("激活章变化 → 再次滚动（大纲 / 出处章节跳转的路径）", () => {
    const { rerender } = render(<ChapterTree {...baseProps} activeChapterId="c1" />);
    scrollToIndex.mockClear();

    rerender(<ChapterTree {...baseProps} activeChapterId="c6" />);
    // v1=0,c1=1,c2=2,c3=3,v2=4,c4=5,c5=6,c6=7
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 7, align: "center" });
  });

  it("激活章未变则不重复滚动（避免每次渲染都抢用户手动滚动）", () => {
    const { rerender } = render(<ChapterTree {...baseProps} activeChapterId="c3" />);
    scrollToIndex.mockClear();

    rerender(<ChapterTree {...baseProps} activeChapterId="c3" collapsed />);
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("无激活章时不滚动", () => {
    render(<ChapterTree {...baseProps} activeChapterId={null} />);
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("目标章被搜索词滤掉（index = -1）不滚动，也不报错", () => {
    const { container } = render(<ChapterTree {...baseProps} activeChapterId="c6" />);
    scrollToIndex.mockClear();

    // 搜索「出生」只留 c1，激活章 c6 已不在扁平行里
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "出生" } });

    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});
