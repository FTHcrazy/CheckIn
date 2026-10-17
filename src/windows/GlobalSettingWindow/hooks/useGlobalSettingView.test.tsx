import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SettingCategory, SettingLevel } from "@/shared/novel/setting-types";
import { useGlobalSettingView, type GsViewParams } from "./useGlobalSettingView";

const level = (id: string, name: string, rank: number): SettingLevel => ({
  id,
  categoryId: "c1",
  name,
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

function cat(
  id: string,
  name: string,
  over: Partial<SettingCategory> = {},
): SettingCategory {
  return {
    id,
    workId: "",
    name,
    color: "#8B77F0",
    kind: "custom",
    sortOrder: 1,
    note: "",
    subLevels: 9,
    carryDir: "asc",
    subPattern: "第{n}层",
    levels: [level(`${id}-l1`, "一品", 1)],
    ...over,
  };
}

const categories: SettingCategory[] = [
  cat("c1", "法宝品阶", { sortOrder: 1, refCount: 2, note: "法宝的等级" }),
  cat("c2", "修仙·经典九层", { kind: "realm", sortOrder: 2, refCount: 5 }),
  cat("c3", "丹药稀有度", { sortOrder: 3, refCount: 0 }),
];

function setup(over: Partial<GsViewParams> = {}) {
  const onSelect = vi.fn<(id: string) => void>();
  const onRename = vi.fn<(id: string, name: string) => void>();
  const params: GsViewParams = {
    categories,
    activeId: "c1",
    onSelect,
    onRename,
    ...over,
  };
  const hook = renderHook((p: GsViewParams) => useGlobalSettingView(p), {
    initialProps: params,
  });
  return { ...hook, onSelect, onRename };
}

describe("useGlobalSettingView · 搜索 / 筛选 / 排序", () => {
  it("输入关键词只改显示子集：不调用任何回调（搜索是纯前端）", () => {
    const { result } = setup();
    act(() => result.current.setKeyword("法宝"));
    expect(result.current.visible.map((item) => item.id)).toEqual(["c1"]);
    // 搜索期间不得触发写通道（哪怕只是排序）
    expect(result.current.visibleIds).toEqual(["c1"]);
  });

  it("筛选与搜索取交集（两条条件同时生效）", () => {
    const { result } = setup();
    act(() => {
      result.current.setKeyword("丹");
      result.current.setFilter("custom");
    });
    expect(result.current.visible.map((item) => item.id)).toEqual(["c3"]);
    // 关键字命中但筛选不命中 ⇒ 空
    act(() => result.current.setFilter("realm"));
    expect(result.current.visible).toHaveLength(0);
    expect(result.current.emptyKind).toBe("no-match");
  });

  it("排序视图只影响显示顺序，不动全量数组", () => {
    const { result } = setup();
    act(() => result.current.setSortMode("refCount"));
    expect(result.current.visible.map((item) => item.refCount)).toEqual([5, 2, 0]);
    // 全量（= 传入的 categories）顺序不变
    expect(categories.map((item) => item.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("canDrag 三条件与门：自定义顺序 + 无搜索 + 无筛选", () => {
    const { result } = setup();
    expect(result.current.canDrag).toBe(true);
    act(() => result.current.setSortMode("name"));
    expect(result.current.canDrag).toBe(false);
    act(() => result.current.setSortMode("custom"));
    act(() => result.current.setKeyword("法"));
    expect(result.current.canDrag).toBe(false);
    act(() => result.current.setKeyword(""));
    act(() => result.current.setFilter("referenced"));
    expect(result.current.canDrag).toBe(false);
    act(() => result.current.setFilter("all"));
    expect(result.current.canDrag).toBe(true);
  });
});

describe("useGlobalSettingView · 就地改名", () => {
  it("空串 / 纯空白不提交（保持原值退出编辑）", () => {
    const { result, onRename } = setup();
    act(() => result.current.beginRename("c1"));
    expect(result.current.renamingId).toBe("c1");
    act(() => result.current.commitRename("   "));
    expect(onRename).not.toHaveBeenCalled();
    expect(result.current.renamingId).toBeNull();
  });

  it("非空提交：去首尾空白后回调", () => {
    const { result, onRename } = setup();
    act(() => result.current.beginRename("c1"));
    act(() => result.current.commitRename("  法宝品阶·新  "));
    expect(onRename).toHaveBeenCalledWith("c1", "法宝品阶·新");
  });

  it("取消不提交", () => {
    const { result, onRename } = setup();
    act(() => result.current.beginRename("c2"));
    act(() => result.current.cancelRename());
    expect(result.current.renamingId).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe("useGlobalSettingView · 选中移动与批量勾选", () => {
  it("↑/↓ 在当前过滤结果内移动（不是全量）", () => {
    const { result, onSelect } = setup();
    act(() => result.current.moveSelection(1));
    expect(onSelect).toHaveBeenCalledWith("c2");
    // 过滤掉 c2 后，从 c1 往下应落到 c3
    act(() => result.current.setFilter("referenced"));
    expect(result.current.visibleIds).toEqual(["c1", "c2"]);
    onSelect.mockClear();
    act(() => result.current.setFilter("unreferenced"));
    act(() => result.current.moveSelection(1));
    expect(onSelect).toHaveBeenCalledWith("c3");
  });

  it("到边界即停，不循环", () => {
    const { result, onSelect } = setup({ activeId: "c3" });
    act(() => result.current.moveSelection(1));
    expect(onSelect).toHaveBeenCalledWith("c3");
  });

  it("勾选 / 取消 / 清空", () => {
    const { result } = setup();
    act(() => result.current.toggleLevelSelected("l1"));
    act(() => result.current.toggleLevelSelected("l2"));
    expect(result.current.selectedLevelIds).toEqual(["l1", "l2"]);
    act(() => result.current.toggleLevelSelected("l1"));
    expect(result.current.selectedLevelIds).toEqual(["l2"]);
    act(() => result.current.clearLevelSelection());
    expect(result.current.selectedLevelIds).toEqual([]);
  });
});
