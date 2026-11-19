/**
 * 灵感库可复用内容体（O-12）契约：
 *
 * - 四档筛选 chips 的计数来自 props（受控，组件自己不算）
 * - 捕捉框由 showCapture 控制（书架要，抽屉不要）
 * - 动作词统一「归属到 / 退回灵感池」，不出现「归档到作品」
 * - onPromote 可选：不传时不渲染转伏笔按钮
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NovelNoteDTO } from "@/shared/types/electron";
import IdeaLibraryContent from ".";

vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>(props: { data: T[]; itemContent: (index: number, item: T) => ReactNode }) => (
    <>{props.data.map((item, index) => props.itemContent(index, item))}</>
  ),
}));

const unassigned: NovelNoteDTO = {
  id: "n1",
  workId: "",
  content: "未归属灵感",
  createdAt: Date.now(),
  pinned: false,
};
const owned: NovelNoteDTO = {
  id: "n2",
  workId: "w1",
  content: "已归属灵感",
  createdAt: Date.now() - 1000,
  pinned: true,
};

const renderContent = (over: Record<string, unknown> = {}) =>
  render(
    <IdeaLibraryContent
      notes={[unassigned, owned]}
      counts={{ all: 2, unassigned: 1, pinned: 1, archived: 1 }}
      filter="all"
      onFilterChange={vi.fn()}
      workOptions={[{ id: "w1", name: "当前书" }]}
      workNameOf={(id) => (id === "w1" ? "当前书" : null)}
      onAdd={() => true}
      onMove={vi.fn()}
      onTogglePin={vi.fn()}
      onUpdate={vi.fn()}
      onRemove={vi.fn()}
      {...over}
    />,
  );

afterEach(cleanup);

describe("IdeaLibraryContent（O-12 单向流）", () => {
  it("四档筛选 chips 显示 props 计数，点击回传筛选档", () => {
    const onFilterChange = vi.fn();
    renderContent({ onFilterChange });
    expect(screen.getByRole("tab", { name: /全部/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /未归属/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /置顶/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /已归档/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /未归属/ }));
    expect(onFilterChange).toHaveBeenCalledWith("unassigned");
  });

  it("showCapture=false 时不渲染捕捉框（抽屉只读场景）", () => {
    renderContent({ showCapture: false });
    expect(screen.queryByText(/随手记一条灵感/)).toBeNull();
  });

  it("showCapture 默认开启时渲染捕捉框", () => {
    renderContent();
    expect(screen.getByPlaceholderText(/随手记一条灵感/)).toBeInTheDocument();
  });

  it("动作词统一为归属到 / 退回灵感池，无归档到作品", () => {
    renderContent();
    expect(screen.getByLabelText("归属到")).toBeInTheDocument();
    expect(screen.getByLabelText("退回灵感池")).toBeInTheDocument();
    expect(screen.queryByText(/归档到作品/)).toBeNull();
  });

  it("onPromote 不传时不渲染转伏笔按钮，传入时渲染", () => {
    const { unmount } = renderContent();
    expect(screen.queryByLabelText("转为伏笔")).toBeNull();
    unmount();

    renderContent({ onPromote: vi.fn() });
    expect(screen.getAllByLabelText("转为伏笔").length).toBeGreaterThan(0);
  });
});
