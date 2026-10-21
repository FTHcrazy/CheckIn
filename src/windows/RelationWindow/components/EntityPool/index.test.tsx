/**
 * 要素资料池单测（R27 / S2）
 *
 * 池子是「要素一个都没少」的唯一可见证据，所以断言的重点是**状态与计数**，
 * 不是像素：已上图 / 未上图 / 有关联但未上图，三种状态必须能区分开，
 * 否则用户会以为要素丢了。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityPool, { REL_NODE_DND_TYPE } from "./index";
import type { RelationGraphNode } from "@/shared/novel/relation-graph";

afterEach(cleanup);

const metaOf = (type: string) => ({
  label: type === "character" ? "角色" : "地点",
  color: "var(--app-primary)",
  colorWeak: "var(--app-primary-weak)",
});

function node(overrides: Partial<RelationGraphNode> & { id: string }): RelationGraphNode {
  return {
    entityId: overrides.id,
    type: "character",
    name: overrides.id,
    aliases: [],
    summary: "",
    realm: "",
    relationCount: 0,
    linked: false,
    ...overrides,
  };
}

const nodes: RelationGraphNode[] = [
  node({ id: "a", name: "林晚", linked: true, relationCount: 2, aliases: ["晚晚"] }),
  node({ id: "b", name: "青云镇", type: "location", linked: false, relationCount: 1 }),
  node({ id: "c", name: "孤峰", type: "location", linked: false }),
];

function renderPool(overrides: Partial<Parameters<typeof EntityPool>[0]> = {}) {
  const props = {
    nodes,
    metaOf,
    selectedId: null,
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  render(<EntityPool {...props} />);
  return props;
}

describe("EntityPool：可见性", () => {
  it("列出全部要素（含已上图），并给出「已上图 / 总数」与「未上图 N」", () => {
    renderPool();
    expect(screen.getByText("1 / 3 已上图")).toBeTruthy();
    // W-07：未上图数量必须常驻，且与「全部 − 成员」相等
    expect(screen.getByText("未上图 2")).toBeTruthy();
    for (const name of ["林晚", "青云镇", "孤峰"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("三种状态可区分：图上 / 有关联 / 未上图", () => {
    renderPool();
    expect(screen.getByText("图上")).toBeTruthy();
    // 「有关联但没上图」是唯一会让人以为要素丢了的状态，必须显性提示
    expect(screen.getByText("有关联")).toBeTruthy();
    expect(screen.getByText("未上图")).toBeTruthy();
  });
});

describe("EntityPool：检索与筛选", () => {
  it("按名称 / 别名 / 简介检索（与右栏要素库同口径）", () => {
    renderPool();
    const search = screen.getByLabelText("搜索要素");
    fireEvent.change(search, { target: { value: "晚晚" } });
    expect(screen.getByText("林晚")).toBeTruthy();
    expect(screen.queryByText("青云镇")).toBeNull();

    fireEvent.change(search, { target: { value: "不存在的人" } });
    // W-08：无命中的文案固定为「未找到要素」
    expect(screen.getByText("未找到要素")).toBeTruthy();
  });

  it("按类型分组（W-08），组头可折叠且折叠后不参与键盘导航", () => {
    renderPool();
    // 两个类型分组：角色 1 / 地点 2
    const characterGroup = screen.getByRole("button", { name: /角色/ });
    const locationGroup = screen.getByRole("button", { name: /地点/ });
    expect(characterGroup.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(locationGroup);
    expect(locationGroup.getAttribute("aria-expanded")).toBe("false");
    expect(
      locationGroup.closest("[data-pool-group]")?.getAttribute("data-open"),
    ).toBe("0");

    // 折叠组的行仍在 DOM（动画需要），但方向键导航只走展开的组
    const first = screen.getByText("林晚").closest("button") as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);

    fireEvent.click(locationGroup);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("青云镇").closest("button"));
  });

  it("检索命中时强制展开所有分组（否则结果藏在折叠组里）", () => {
    renderPool();
    fireEvent.click(screen.getByRole("button", { name: /地点/ }));
    fireEvent.change(screen.getByLabelText("搜索要素"), { target: { value: "青云" } });
    expect(
      screen.getByRole("button", { name: /地点/ }).getAttribute("aria-expanded"),
    ).toBe("true");
  });
});

describe("EntityPool：上图 / 移出", () => {
  it("拖拽时把要素 id 写进约定的 dataTransfer 类型", () => {
    renderPool();
    const setData = vi.fn();
    const row = screen.getByText("青云镇").closest("button");
    expect(row).toBeTruthy();
    fireEvent.dragStart(row as HTMLElement, { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(REL_NODE_DND_TYPE, "b");
  });

  it("未上图的行提供「放到画布上」，已上图的行提供「从画布移出」", () => {
    const props = renderPool();
    fireEvent.click(screen.getByLabelText("把「青云镇」放到画布上"));
    expect(props.onAdd).toHaveBeenCalledWith("b");

    fireEvent.click(screen.getByLabelText("把「林晚」从画布移出"));
    expect(props.onRemove).toHaveBeenCalledWith("a");
  });

  it("点行本身是选中（不是上图），两者不混", () => {
    const props = renderPool();
    fireEvent.click(screen.getByText("孤峰"));
    expect(props.onSelect).toHaveBeenCalledWith("c");
    expect(props.onAdd).not.toHaveBeenCalled();
  });
});

describe("EntityPool：键盘可达（S4）", () => {
  it("↓↓ 在可见行之间移动焦点（不跨过筛选掉的行）", () => {
    renderPool();
    const first = screen.getByText("林晚").closest("button") as HTMLElement;
    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("青云镇").closest("button"));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("孤峰").closest("button"));

    // 到底不回绕：游标停在最后一行，不会突然跳回顶部（避免 Enter 误伤）
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("孤峰").closest("button"));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByText("青云镇").closest("button"));
  });

  it("Home / End 直达首尾", () => {
    renderPool();
    const first = screen.getByText("林晚").closest("button") as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(screen.getByText("孤峰").closest("button"));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("Enter = 主操作：未上图 → 上图，已上图 → 选中（不改画布）", () => {
    const props = renderPool();

    const off = screen.getByText("青云镇").closest("button") as HTMLElement;
    fireEvent.keyDown(off, { key: "Enter" });
    expect(props.onAdd).toHaveBeenCalledWith("b");
    expect(props.onSelect).not.toHaveBeenCalled();

    const on = screen.getByText("林晚").closest("button") as HTMLElement;
    fireEvent.keyDown(on, { key: "Enter" });
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith("a");
  });

  it("检索框里按 ↓ 直接进入结果列表（搜索 → 定位 → Enter）", () => {
    renderPool({ nodes: [node({ id: "solo", name: "独家要素" })] });
    const search = screen.getByLabelText("搜索要素");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("独家要素").closest("button"));
  });

  it("画布节点不进 tab 序（焦点在池子里，节点只由画布交互接管）", () => {
    renderPool();
    const rows = document.querySelectorAll("[data-pool-row]");
    expect(rows.length).toBe(3);
    // 这一条是反向断言：池子行必须是可聚焦元素，否则「Tab 到池子」不成立
    for (const row of Array.from(rows)) {
      expect((row as HTMLElement).tagName).toBe("BUTTON");
      expect((row as HTMLElement).hasAttribute("disabled")).toBe(false);
    }
  });
});
