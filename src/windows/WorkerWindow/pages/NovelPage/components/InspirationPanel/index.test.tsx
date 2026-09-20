import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NovelNote } from "../../types";
import InspirationPanel, { type InspirationActions } from "./index";

// jsdom 没有真实布局，Virtuoso 视口高度为 0 导致不渲染任何行；
// 测试中用平铺渲染等价替身，只保留 data + itemContent 的行为契约。
vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>(props: {
    data: T[];
    itemContent: (index: number, item: T) => ReactNode;
  }) => <>{props.data.map((item, index) => props.itemContent(index, item))}</>,
}));

const buildActions = (
  over: Partial<InspirationActions> = {},
): InspirationActions => ({
  onAddNote: vi.fn(),
  onUpdateNote: vi.fn(),
  onTogglePin: vi.fn(),
  onRemoveNote: vi.fn(),
  onPromoteNote: vi.fn(),
  ...over,
});

const now = Date.now();

const notes: NovelNote[] = [
  {
    id: "n1",
    workId: "w1",
    content: "掌门的旧诺是什么？",
    createdAt: now,
    pinned: true,
  },
  {
    id: "n2",
    workId: "w1",
    content: "下一章开头：雨停",
    createdAt: now - 60_000,
    pinned: false,
    foreshadowId: "f1",
  },
];

describe("InspirationPanel 组件", () => {
  afterEach(() => {
    cleanup();
  });

  it("展示条数与置顶计数", () => {
    render(<InspirationPanel notes={notes} actions={buildActions()} />);
    expect(screen.getByText("2 条 · 置顶 1")).toBeInTheDocument();
  });

  it("Enter 新增灵感并清空草稿", () => {
    const onAddNote = vi.fn();
    render(<InspirationPanel notes={[]} actions={buildActions({ onAddNote })} />);

    const box = screen.getByPlaceholderText("甩一句灵感进来…（Enter 记录）");
    fireEvent.change(box, { target: { value: "  雨停，山门钟声  " } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onAddNote).toHaveBeenCalledWith("雨停，山门钟声");
    expect(box).toHaveValue("");
  });

  it("搜索按内容过滤，计数切换为命中 / 总数", () => {
    render(<InspirationPanel notes={notes} actions={buildActions()} />);

    fireEvent.change(screen.getByLabelText("搜索灵感"), {
      target: { value: "雨停" },
    });

    expect(screen.getByText("1 / 2 · 置顶 1")).toBeInTheDocument();
    expect(screen.queryByText("掌门的旧诺是什么？")).toBeNull();
    expect(screen.getByText("下一章开头：雨停")).toBeInTheDocument();
  });

  it("行内编辑回车保存，取消不落库", () => {
    const onUpdateNote = vi.fn();
    render(<InspirationPanel notes={notes} actions={buildActions({ onUpdateNote })} />);

    const [firstCard] = screen.getAllByRole("group");
    fireEvent.click(within(firstCard).getByLabelText("编辑灵感"));

    const box = screen.getByLabelText("编辑灵感内容");
    fireEvent.change(box, { target: { value: "旧诺 = 师父的剑冢" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onUpdateNote).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getAllByRole("group")[0]).getByLabelText("编辑灵感"));
    const box2 = screen.getByLabelText("编辑灵感内容");
    fireEvent.change(box2, { target: { value: "旧诺 = 师父的剑冢" } });
    fireEvent.keyDown(box2, { key: "Enter" });

    expect(onUpdateNote).toHaveBeenCalledWith("n1", "旧诺 = 师父的剑冢");
  });

  it("置顶与转为伏笔按卡片分发正确的 id", () => {
    const onTogglePin = vi.fn();
    const onPromoteNote = vi.fn();
    render(
      <InspirationPanel
        notes={notes}
        actions={buildActions({ onTogglePin, onPromoteNote })}
      />,
    );

    const items = screen.getAllByRole("group");
    fireEvent.click(within(items[0]).getByLabelText("取消置顶"));
    expect(onTogglePin).toHaveBeenCalledWith("n1", false);

    fireEvent.click(within(items[1]).getByLabelText("置顶"));
    expect(onTogglePin).toHaveBeenCalledWith("n2", true);

    fireEvent.click(within(items[0]).getByLabelText("转为伏笔"));
    expect(onPromoteNote).toHaveBeenCalledWith("n1");
  });

  it("已转为伏笔的灵感禁用再转化并展示标记", () => {
    render(<InspirationPanel notes={notes} actions={buildActions()} />);

    const items = screen.getAllByRole("group");
    expect(within(items[1]).getByLabelText("转为伏笔")).toBeDisabled();
    expect(screen.getByText("已转为伏笔")).toBeInTheDocument();
  });
});
