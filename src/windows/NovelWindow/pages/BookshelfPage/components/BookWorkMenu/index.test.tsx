import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "antd";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShelfWorkActions } from "../../hooks/useShelfWorkActions";
import BookWorkMenu from "./index";

/**
 * 书卡右键菜单的**形态守卫**（2.56.0）。
 *
 * 五项动作是这次需求的最小集合，少一项或改名都算没做完；弹框打开时
 * 菜单必须让位（否则遮住 Modal），点捕获层 / Esc 要能收起。
 */
function makeActions(over: Partial<ShelfWorkActions> = {}): ShelfWorkActions {
  return {
    target: { workId: "w1", x: 200, y: 300 },
    modalKind: null,
    activeWork: {
      id: "w1",
      name: "山海拾遗",
      createdAt: 1,
      totalWords: 1200,
      chapterCount: 3,
      doneCount: 1,
      volumeCount: 1,
      updatedAt: 2,
      status: "ongoing",
    },
    nameDraft: "山海拾遗",
    genreDraft: "仙侠",
    nameError: "",
    busy: false,
    menuVisible: true,
    setNameDraft: vi.fn(),
    setGenreDraft: vi.fn(),
    openMenu: vi.fn(),
    closeMenu: vi.fn(),
    openRename: vi.fn(),
    openGenre: vi.fn(),
    openDelete: vi.fn(),
    confirmName: vi.fn(async () => undefined),
    confirmGenre: vi.fn(async () => undefined),
    confirmDelete: vi.fn(async () => undefined),
    pickCover: vi.fn(async () => undefined),
    exportWork: vi.fn(async () => undefined),
    ...over,
  } as ShelfWorkActions;
}

const wrapper = ({ children }: { children: ReactNode }) => <App>{children}</App>;
const renderMenu = (actions: ShelfWorkActions) =>
  render(<BookWorkMenu actions={actions} />, { wrapper });

afterEach(cleanup);

describe("书卡右键菜单：五项作品操作", () => {
  it("菜单项齐全、带书名标题", () => {
    renderMenu(makeActions());

    for (const label of [
      "重命名",
      "修改题材类型",
      "导入图书封面",
      "导出当前作品",
      "删除当前作品",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("《山海拾遗》")).toBeInTheDocument();
  });

  it("点各项分别派发到对应动作", () => {
    const actions = makeActions();
    renderMenu(actions);

    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "修改题材类型" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导入图书封面" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出当前作品" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除当前作品" }));

    expect(actions.openRename).toHaveBeenCalledTimes(1);
    expect(actions.openGenre).toHaveBeenCalledTimes(1);
    expect(actions.pickCover).toHaveBeenCalledTimes(1);
    expect(actions.exportWork).toHaveBeenCalledTimes(1);
    expect(actions.openDelete).toHaveBeenCalledTimes(1);
  });

  it("弹框开着时菜单让位，删除确认明示回收站口径", () => {
    const actions = makeActions({ modalKind: "delete", menuVisible: false });
    renderMenu(actions);

    expect(document.querySelector(".bs-workmenu")).toBeNull();
    expect(screen.getByText(/30 天内原样恢复/)).toBeInTheDocument();
  });

  it("点捕获层收起；Esc 也收起", () => {
    const actions = makeActions();
    renderMenu(actions);

    fireEvent.click(document.querySelector(".bs-workmenu__mask")!);
    expect(actions.closeMenu).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(actions.closeMenu).toHaveBeenCalledTimes(2);
  });
});
