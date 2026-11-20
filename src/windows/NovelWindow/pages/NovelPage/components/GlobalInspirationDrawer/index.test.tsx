/**
 * 全局灵感抽屉（O-12）契约：
 * - antd Drawer 承载，受控 open / onClose
 * - 内嵌 IdeaLibraryContent，showCapture=false（只读查看，不重复给新增入口）
 * - 关闭单一出口 onClose 前先 restoreFocus（O-17 焦点回焦）
 */
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import * as sass from "sass";
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

/**
 * 抽屉内的排布契约（真机反馈：卡片只占左半边，右侧一大片空白）。
 *
 * `.bs-rail` 是书架右栏的造型，自带 `width: 320px` / 内边距 / 左边框，
 * 直接搬进 420 宽的抽屉里就会把卡片钉在半宽处。这里钉住三件事：
 * 宽度交还给 100%、右栏专属内边距与边框清零、浮层底色跟随主题内容面。
 */
describe("GlobalInspirationDrawer：抽屉内的排布与底色", () => {
  const css = sass
    .compile(
      path.join(
        process.cwd(),
        "src/windows/NovelWindow/pages/NovelPage/components/GlobalInspirationDrawer/index.scss",
      ),
      { style: "expanded" },
    )
    .css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("覆盖 .bs-rail 的固定宽度与内边距，卡片铺满抽屉", () => {
    const at = css.indexOf(".nv-idea-drawer__body.bs-rail {");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("}", at));
    expect(block).toContain("width: 100%");
    expect(block).toContain("padding: 0");
    expect(block).toContain("border-left: 0");
  });

  it("抽屉底色走主题内容面（覆盖 antd 的 colorBgElevated 变量，不硬写属性）", () => {
    expect(css).toMatch(
      /\.nv-idea-drawer\s*\{[^}]*--ant-color-bg-elevated:\s*var\(--app-surface\)/,
    );
  });
});
