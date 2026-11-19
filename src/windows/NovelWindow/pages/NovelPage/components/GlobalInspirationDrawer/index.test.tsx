/**
 * 全局灵感抽屉（O-12）契约：
 * - antd Drawer 承载，受控 open / onClose
 * - 内嵌 IdeaLibraryContent，showCapture=false（只读查看，不重复给新增入口）
 * - 关闭单一出口 onClose 前先 restoreFocus（O-17 焦点回焦）
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GlobalInspirationDrawer from ".";

vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>(props: { data: T[]; itemContent: (index: number, item: T) => ReactNode }) => (
    <>{props.data.map((item, index) => props.itemContent(index, item))}</>
  ),
}));

const { captureTrigger, restoreFocus } = vi.hoisted(() => ({
  captureTrigger: vi.fn(),
  restoreFocus: vi.fn(),
}));
vi.mock("@/shared/hooks/useDrawerFocusReturn", () => ({
  useDrawerFocusReturn: () => ({ captureTrigger, restoreFocus }),
}));

afterEach(() => {
  cleanup();
  restoreFocus.mockClear();
});

const baseProps = {
  notes: [
    { id: "n1", workId: "", content: "未归属一条", createdAt: Date.now(), pinned: false },
  ],
  workOptions: [{ id: "w1", name: "当前书" }],
  workNameOf: () => null,
  onAdd: () => true,
  onMove: vi.fn(),
  onTogglePin: vi.fn(),
  onUpdate: vi.fn(),
  onRemove: vi.fn(),
};

describe("GlobalInspirationDrawer（O-12）", () => {
  it("打开时渲染标题与四档筛选，且不渲染捕捉框", () => {
    render(<GlobalInspirationDrawer open onClose={vi.fn()} {...baseProps} />);
    expect(screen.getByText("全部灵感")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /全部/ })).toBeInTheDocument();
    expect(screen.getByText("未归属一条")).toBeInTheDocument();
    expect(screen.queryByText(/随手记一条灵感/)).toBeNull();
  });

  it("关闭走单一出口：onClose 前先回焦触发元素", () => {
    const onClose = vi.fn();
    render(<GlobalInspirationDrawer open onClose={onClose} {...baseProps} />);
    const closeBtn = document.querySelector(".ant-drawer-close");
    expect(closeBtn).not.toBeNull();
    (closeBtn as HTMLElement).click();
    expect(restoreFocus).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
