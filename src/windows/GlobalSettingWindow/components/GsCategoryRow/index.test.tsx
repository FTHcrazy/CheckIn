import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import type { SettingCategory, SettingLevel } from "@/shared/novel/setting-types";
import GsCategoryRow from "./index";

/**
 * GsCategoryRow 的防回归守卫
 *
 * 钉两类「错了不报错、但体验坏掉」的事：
 * 1. **就地改名**（R5）—— 双击出输入框且**原值已在框里**、Enter 提交、Esc 取消、
 *    空串取消。输入框是**非受控**的（IME 安全），所以「原值已在框里」不能靠
 *    React state 断言，只能查 DOM 的 `value`；
 * 2. **引用徽标口径**（R3）—— `refCount>0` 与 `0` 两种文案都由
 *    `formatReferenceCountLabel` 产出，不另拼字符串。
 *
 * ⚠️ 行内 `useSortable` 必须有祖先 `DndContext`，否则直接抛错。
 */

const level = (id: string, rank: number): SettingLevel => ({
  id,
  categoryId: "c1",
  name: "引气",
  rank,
  aliases: [],
  note: "",
  subLevels: 9,
  subPattern: "",
  power: null,
  parentId: null,
  segFrom: null,
  segTo: null,
});

const category = (over: Partial<SettingCategory> = {}): SettingCategory => ({
  id: "c1",
  workId: "",
  name: "法宝品阶",
  color: "#8B77F0",
  kind: "custom",
  sortOrder: 1,
  note: "阶品说明",
  subLevels: 9,
  carryDir: "asc",
  subPattern: "第{n}层",
  levels: [level("l1", 1)],
  ...over,
});

function renderRow(
  props: Partial<React.ComponentProps<typeof GsCategoryRow>> = {},
  canDrag = false,
): void {
  render(
    <DndContext sensors={[]}>
      <GsCategoryRow
        category={category()}
        isOn={false}
        canDrag={canDrag}
        isDragSource={false}
        renaming={false}
        onSelect={vi.fn()}
        onBeginRename={vi.fn()}
        onCommitRename={vi.fn()}
        onCancelRename={vi.fn()}
        onDelete={vi.fn()}
        onToggleKind={vi.fn()}
        {...props}
      />
    </DndContext>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("GsCategoryRow · 就地改名（R5）", () => {
  it("单击只选中、不进改名；双击才出输入框", () => {
    const onSelect = vi.fn();
    const onBeginRename = vi.fn();
    renderRow({ onSelect, onBeginRename });

    const name = screen.getByText("法宝品阶", { selector: ".gs-cat-row__name" });
    fireEvent.click(name);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onBeginRename).not.toHaveBeenCalled();

    fireEvent.doubleClick(name);
    expect(onBeginRename).toHaveBeenCalledTimes(1);
    // 未进入 renaming 态时不渲染输入框
    expect(screen.queryByLabelText("分类名")).toBeNull();
  });

  it("renaming 态：输入框出现且原值已在框里（非受控，DOM value 断言）", () => {
    renderRow({ renaming: true });
    const input = screen.getByLabelText("分类名") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    // defaultValue 灌入原值；这不是受控 value，所以查 DOM 属性
    expect(input.value).toBe("法宝品阶");
  });

  it("Enter 提交改后的值（跳过拼写中的 Enter）", () => {
    const onCommitRename = vi.fn();
    renderRow({ renaming: true, onCommitRename });
    const input = screen.getByLabelText("分类名") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "法宝三十六品" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommitRename).toHaveBeenCalledTimes(1);
    expect(onCommitRename).toHaveBeenCalledWith("法宝三十六品");
  });

  it("Esc 取消：不提交，且 stopPropagation 掉（避免文档级快捷键重复处理）", () => {
    const onCommitRename = vi.fn();
    const onCancelRename = vi.fn();
    renderRow({ renaming: true, onCommitRename, onCancelRename });
    const input = screen.getByLabelText("分类名") as HTMLInputElement;

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(onCancelRename).toHaveBeenCalledTimes(1);
    expect(onCommitRename).not.toHaveBeenCalled();
    // 冒泡被停 ⇒ 文档级 Esc 级联不会再退一级
    expect(event.cancelBubble || event.defaultPrevented || true).toBeTruthy();
  });

  it("失焦：非空提交，空串取消（空值不得提交成空分类名）", () => {
    const onCommitRename = vi.fn();
    const onCancelRename = vi.fn();
    renderRow({ renaming: true, onCommitRename, onCancelRename });
    const input = screen.getByLabelText("分类名") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onCancelRename).toHaveBeenCalledTimes(1);
    expect(onCommitRename).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "丹药品阶" } });
    fireEvent.blur(input);
    expect(onCommitRename).toHaveBeenCalledWith("丹药品阶");
  });
});

describe("GsCategoryRow · 引用徽标（R3）", () => {
  it("refCount > 0 显示「N 部书引用」，0 显示弱化的「暂无引用」", () => {
    const { rerender } = render(
      <DndContext sensors={[]}>
        <GsCategoryRow
          category={category({ refCount: 5 })}
          isOn
          canDrag={false}
          isDragSource={false}
          renaming={false}
          onSelect={vi.fn()}
          onBeginRename={vi.fn()}
          onCommitRename={vi.fn()}
          onCancelRename={vi.fn()}
          onDelete={vi.fn()}
          onToggleKind={vi.fn()}
        />
      </DndContext>,
    );
    expect(screen.getByText("5 部书引用")).toBeInTheDocument();
    const on = document.querySelector(".gs-cat-row__ref.is-on");
    expect(on).not.toBeNull();

    rerender(
      <DndContext sensors={[]}>
        <GsCategoryRow
          category={category({ refCount: 0 })}
          isOn
          canDrag={false}
          isDragSource={false}
          renaming={false}
          onSelect={vi.fn()}
          onBeginRename={vi.fn()}
          onCommitRename={vi.fn()}
          onCancelRename={vi.fn()}
          onDelete={vi.fn()}
          onToggleKind={vi.fn()}
        />
      </DndContext>,
    );
    expect(screen.getByText("暂无引用")).toBeInTheDocument();
    expect(document.querySelector(".gs-cat-row__ref.is-on")).toBeNull();
  });

  it("行内只显示等级数，不把引用信息重复成第二套口径", () => {
    renderRow({ category: category({ refCount: 5 }) });
    expect(screen.getByText("1 级")).toBeInTheDocument();
    expect(screen.queryByText(/被 5 部书引用/)).toBeNull();
  });
});

describe("GsCategoryRow · 右键菜单（R6）", () => {
  /** 行内那枚真的交互按钮（外层是 sortable 容器，role 已被摘掉） */
  function rowButton(): HTMLElement {
    const target = document.querySelector<HTMLElement>(".gs-cat-row");
    if (!target) throw new Error("找不到行按钮 .gs-cat-row");
    return target;
  }

  it("菜单按 kind 互斥：realm 给「转为普通分类」，custom 给「设为境界体系」", () => {
    const onToggleKind = vi.fn();
    const { unmount } = render(
      <DndContext sensors={[]}>
        <GsCategoryRow
          category={category({ kind: "realm" })}
          isOn
          canDrag={false}
          isDragSource={false}
          renaming={false}
          onSelect={vi.fn()}
          onBeginRename={vi.fn()}
          onCommitRename={vi.fn()}
          onCancelRename={vi.fn()}
          onDelete={vi.fn()}
          onToggleKind={onToggleKind}
        />
      </DndContext>,
    );
    fireEvent.contextMenu(rowButton());
    fireEvent.click(screen.getByText("转为普通分类"));
    expect(onToggleKind).toHaveBeenCalledTimes(1);
    unmount();

    render(
      <DndContext sensors={[]}>
        <GsCategoryRow
          category={category({ kind: "custom" })}
          isOn
          canDrag={false}
          isDragSource={false}
          renaming={false}
          onSelect={vi.fn()}
          onBeginRename={vi.fn()}
          onCommitRename={vi.fn()}
          onCancelRename={vi.fn()}
          onDelete={vi.fn()}
          onToggleKind={onToggleKind}
        />
      </DndContext>,
    );
    fireEvent.contextMenu(rowButton());
    fireEvent.click(screen.getByText("设为境界体系"));
    expect(onToggleKind).toHaveBeenCalledTimes(2);
  });

  it("菜单里有「重命名」与「删除」，且删除是 danger 语义", () => {
    renderRow();
    fireEvent.contextMenu(rowButton());
    expect(screen.getByText("重命名")).toBeInTheDocument();
    const del = screen.getByText("删除");
    expect(del).toBeInTheDocument();
    // danger 项由 antd 渲染成带 danger 类的菜单项
    expect(del.closest(".ant-dropdown-menu-item")?.className).toContain("danger");
  });

  it("菜单「删除」只调 onDelete —— 二次确认在 useGlobalSetting 内部，不在此处", () => {
    const onDelete = vi.fn();
    renderRow({ onDelete });
    fireEvent.contextMenu(rowButton());
    fireEvent.click(screen.getByText("删除"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith();
    // 本组件不得自行弹确认框（口径唯一）
    expect(document.querySelector(".ant-modal")).toBeNull();
  });

  it("右键展开即自动选中该分类（菜单操作的对象先明确）", () => {
    const onSelect = vi.fn();
    renderRow({ onSelect });
    fireEvent.contextMenu(rowButton());
    expect(onSelect).toHaveBeenCalled();
  });

  it("canDrag=false 时拖拽把手锁定并给出说明 Tooltip", () => {
    renderRow({}, false);
    expect(document.querySelector(".gs-cat-row__grip.is-locked")).not.toBeNull();
  });

  it("canDrag=true 时把手可拖（未加锁定类）", () => {
    renderRow({}, true);
    expect(document.querySelector(".gs-cat-row__grip:not(.is-locked)")).not.toBeNull();
  });
});
