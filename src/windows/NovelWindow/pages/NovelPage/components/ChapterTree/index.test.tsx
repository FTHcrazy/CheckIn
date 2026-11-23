import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    className?: string;
    onScroll?: React.UIEventHandler<HTMLDivElement>;
    onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
  }) => {
    // 把 handle 挂到 ref 上，模拟真组件的 useImperativeHandle
    const ref = props as unknown as { ref?: { current: unknown } };
    if (ref.ref) ref.ref.current = { scrollToIndex };
    return (
      <div className={props.className} onScroll={props.onScroll} onMouseMove={props.onMouseMove}>
        {props.data.map((item, index) => props.itemContent(index, item))}
      </div>
    );
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
  onDeleteVolume: vi.fn(),
  onOpenSummary: vi.fn(),
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

/**
 * 删除二次确认（章节 / 卷共用列表容器里唯一一个共享 Popconfirm）。
 *
 * 行组件只上报「要删谁 + 锚点 DOM」，浮层由 ChapterTree 渲染 ——
 * 虚拟化列表不能每行挂一个 Portal。这里测的是这条链路的契约：
 * 点删除图标 → 出现确认浮层（不直接删）→ 确认才回调、取消不回调。
 *
 * ⚠️ antd 浮层挂 `document.body` portal，RTL 自动清理收不走：
 * 每条用例后必须手动清空 body，否则上一个用例的浮层活到下一个，
 * `getByText` 会报 found multiple。单跑永远看不出来。
 *
 * ⚠️ antd Button 会在两个中文字符之间插空格（「删除」→「删 除」），
 * 按文案查按钮一律用 `/删\s*除/` 之类的正则。
 */
describe("ChapterTree 删除二次确认（共享 Popconfirm）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  /**
   * 取浮层内的确认 / 取消按钮。
   *
   * 按 textContent 匹配而非 accessible name：行内删除按钮是纯图标
   * （textContent 为空），但其 aria-label 含「删除」—— 用 getByRole
   * 会撞车。antd Button 会把两个中文字符之间插一个空格
   * （「删除」→「删 除」），正则里用 \s* 吃掉。
   */
  const popupButton = (name: RegExp): HTMLElement => {
    const btns = Array.from(document.body.querySelectorAll("button")).filter((node) =>
      name.test(node.textContent ?? ""),
    );
    expect(btns).toHaveLength(1);
    return btns[0] as HTMLElement;
  };

  it("点卷头删除图标 → 弹「删除这个卷？」→ 确认后 onDeleteVolume 带卷 id", async () => {
    const onDeleteVolume = vi.fn();
    const onDeleteChapter = vi.fn();
    const { container } = render(
      <ChapterTree
        {...baseProps}
        activeChapterId={null}
        onDeleteVolume={onDeleteVolume}
        onDeleteChapter={onDeleteChapter}
      />,
    );

    fireEvent.click(container.querySelector<HTMLElement>(".nv-volume__del")!);

    // 二次确认浮层出现（不是点了就删）
    expect(await screen.findByText(/删\s*除\s*这\s*个\s*卷/)).toBeTruthy();
    // 级联影响写进 description：章数 + 「可恢复」的出口
    expect(screen.getByText(/及其下 3 章将移入回收站/)).toBeTruthy();

    fireEvent.click(popupButton(/移入回收站/));

    expect(onDeleteVolume).toHaveBeenCalledTimes(1);
    expect(onDeleteVolume).toHaveBeenCalledWith("v1");
    expect(onDeleteChapter).not.toHaveBeenCalled();
  });

  it("空卷的确认文案不带章数级联说明", async () => {
    const { container } = render(
      <ChapterTree
        {...baseProps}
        groups={[groups[1], { volume: volume("v3", 3), chapters: [] }]}
        activeChapterId={null}
      />,
    );

    // 空卷 v3 的删除按钮
    const dels = container.querySelectorAll<HTMLElement>(".nv-volume__del");
    fireEvent.click(dels[dels.length - 1]!);

    expect(await screen.findByText(/删\s*除\s*这\s*个\s*卷/)).toBeTruthy();
    expect(screen.getByText(/（空卷）将移入回收站/)).toBeTruthy();
  });

  it("取消确认则不触发任何删除回调", async () => {
    const onDeleteVolume = vi.fn();
    const { container } = render(
      <ChapterTree {...baseProps} activeChapterId={null} onDeleteVolume={onDeleteVolume} />,
    );

    fireEvent.click(container.querySelector<HTMLElement>(".nv-volume__del")!);
    await screen.findByText(/删\s*除\s*这\s*个\s*卷/);

    fireEvent.click(popupButton(/取\s*消/));
    expect(onDeleteVolume).not.toHaveBeenCalled();
  });

  it("点章节删除图标 → 弹「删除章节」→ 确认后 onDeleteChapter 带章 id", async () => {
    const onDeleteChapter = vi.fn();
    const onDeleteVolume = vi.fn();
    const { container } = render(
      <ChapterTree
        {...baseProps}
        activeChapterId={null}
        onDeleteChapter={onDeleteChapter}
        onDeleteVolume={onDeleteVolume}
      />,
    );

    fireEvent.click(container.querySelector<HTMLElement>(".nv-chapter__del")!);

    expect(await screen.findByText(/删\s*除\s*章\s*节/)).toBeTruthy();
    expect(screen.getByText(/将移入回收站/)).toBeTruthy();

    fireEvent.click(popupButton(/移入回收站/));

    expect(onDeleteChapter).toHaveBeenCalledTimes(1);
    expect(onDeleteChapter).toHaveBeenCalledWith("c1");
    expect(onDeleteVolume).not.toHaveBeenCalled();
  });
});

/**
 * 章节标题悬浮气泡（全列表唯一共享自绘气泡，portal 到 body）。
 *
 * 行组件只上报「标题 + 锚点坐标」，ChapterTree 渲染唯一气泡。
 * 契约两条：
 * 1. 所有章节标题 hover 都弹（产品裁定，不判断是否被省略号截断）；
 * 2. 气泡必须挂在 document.body —— 树根 overflow:hidden 会把往右弹出的
 *    气泡整个裁掉（真机表现就是「hover 了但什么都没出现」），这条断言防回归。
 * 历史：antd Tooltip 两轮都翻车（默认容器裁剪；显式 body 后真机仍不出现），
 * 已换成纯 div portal，测试只认 `.nv-tree__title-tip`。
 */
describe("ChapterTree 章节标题悬浮气泡", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("hover 行（热区为整行）：气泡出现且挂在树容器之外（body）", async () => {
    const { container } = render(<ChapterTree {...baseProps} activeChapterId="c1" />);

    // 触发点钉在行容器：热区是整行，不只是标题 span
    const row = screen.getByText("出生").closest(".nv-chapter__row")!;
    fireEvent.mouseEnter(row);

    const tip = await screen.findByText("出生", { selector: ".nv-tree__title-tip" });
    expect(tip.getAttribute("role")).toBe("tooltip");
    // 防回归的关键断言：气泡不在树容器内，否则被 overflow:hidden 裁掉
    expect(container.querySelector(".nv-tree__title-tip")).toBeNull();
  });

  it("移出行 / 滚动列表都收起气泡", async () => {
    const { container } = render(<ChapterTree {...baseProps} activeChapterId="c1" />);

    const row = screen.getByText("出生").closest(".nv-chapter__row")!;
    fireEvent.mouseEnter(row);
    await screen.findByText("出生", { selector: ".nv-tree__title-tip" });

    // 行根容器挂着 onMouseLeave（收起）
    fireEvent.mouseLeave(row);
    await waitFor(() => {
      expect(document.querySelector(".nv-tree__title-tip")).toBeNull();
    });

    // 再弹出后滚动列表也要收（滚动时锚点留在旧坐标，气泡会悬空）
    fireEvent.mouseEnter(row);
    await screen.findByText("出生", { selector: ".nv-tree__title-tip" });
    // 滚动事件同步收起；落点重判 180ms 后才跑，先断「立即收」
    fireEvent.scroll(container.querySelector(".nv-tree__list")!);
    expect(document.querySelector(".nv-tree__title-tip")).toBeNull();
  });

  it("滚停落点重判：鼠标停在章节行上，气泡重新出现", async () => {
    const { container } = render(<ChapterTree {...baseProps} activeChapterId="c1" />);
    const list = container.querySelector(".nv-tree__list")!;
    const row = screen.getByText("出生").closest(".nv-chapter__row")!;

    // 记录鼠标位置（滚轮滚动不产生 mousemove，组件靠最后已知位置重判）
    fireEvent.mouseMove(list, { clientX: 100, clientY: 200 });

    // jsdom 没有 elementFromPoint：滚停后桩回「鼠标下正是那行字数列」（行内子元素也命中）
    const elementFromPoint = vi.fn(() => row.querySelector(".nv-chapter__index"));
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });

    fireEvent.scroll(list);

    await waitFor(
      () => {
        expect(document.querySelector(".nv-tree__title-tip")).not.toBeNull();
      },
      { timeout: 600 },
    );
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: undefined });
  });

  it("滚停落点重判：鼠标下不是标题则保持收起", async () => {
    const { container } = render(<ChapterTree {...baseProps} activeChapterId="c1" />);
    const list = container.querySelector(".nv-tree__list")!;

    fireEvent.mouseMove(list, { clientX: 100, clientY: 200 });
    const elementFromPoint = vi.fn(() => null);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });

    fireEvent.mouseMove(list, { clientX: 100, clientY: 200 });
    fireEvent.scroll(list);

    // 等过重判窗口（180ms + 余量），气泡仍不应出现
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(document.querySelector(".nv-tree__title-tip")).toBeNull();
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: undefined });
  });
});
