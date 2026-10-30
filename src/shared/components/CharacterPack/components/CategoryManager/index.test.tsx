import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CategoryManager from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import type { PackCategory } from "../../types";

/**
 * 分类管理（1.40.0）的三条不变量：
 *
 * 1. 「绑定体系」下拉的选项来自 api.gradeSystems（挂载即有，不出现裸 id）；
 * 2. 设定域一个体系都没有时，给「去设定中心创建」的引导 ——
 *    用户要求「没有小说体系则提示引导」；
 * 3. 删除分类要走确认框（分类下物品退回「未分类」是有后果的操作）。
 */

const category: PackCategory = {
  id: "cat1",
  characterId: "c1",
  name: "装备",
  systemId: "",
  sortOrder: 1,
};

const doc: PackDoc = {
  character: {
    id: "c1",
    workId: "w1",
    name: "主角",
    displayName: "主角",
    avatar: "",
    isProtagonist: true,
    entityId: "",
    realmAt: "",
    note: "",
    sortOrder: 1,
  },
  attributes: [],
  attrDefs: [],
  mappings: [],
  slots: [],
  groups: [],
  categories: [category],
  items: [],
  skills: [],
  modifiers: [],
  unitSystems: [],
  layouts: [],
  presets: [],
  realmLink: null,
};

function makeApi(over: Partial<PackPanelApi> = {}) {
  return {
    doc,
    categoryManagerOpen: true,
    setCategoryManagerOpen: vi.fn(),
    gradeSystems: [],
    addCategory: vi.fn(),
    updateCategory: vi.fn(() => true),
    removeCategory: vi.fn(() => 0),
    showToast: vi.fn(),
    ...over,
  } as unknown as PackPanelApi;
}

afterEach(cleanup);

describe("CategoryManager —— 分类管理（1.40.0）", () => {
  it("没有小说体系时给引导文案（用户要求：没有体系则提示引导）", () => {
    render(<CategoryManager api={makeApi()} />);
    expect(screen.getByText(/这本书还没有等级体系/)).toBeTruthy();
  });

  it("绑定体系下拉的选项来自 gradeSystems，换绑回写 systemId", async () => {
    const api = makeApi({
      gradeSystems: [
        {
          id: "sys-fabao",
          name: "法宝品阶",
          levels: [
            { id: "lv-1", name: "法器" },
            { id: "lv-2", name: "神器" },
          ],
        },
      ],
    });
    render(<CategoryManager api={api} />);
    expect(screen.queryByText(/这本书还没有等级体系/)).toBeNull();
    // antd Select：mouseDown 展开下拉 → 点选项
    // （Modal 挂在 body 的 portal 上，不能用 render 返回的 container 查询；
    //  antd 6 的可点区域是内层只读 input，v5 的 .ant-select-selector 已移除）
    const system = document.querySelector(".cpk-catmgr__system");
    expect(system).toBeTruthy();
    const trigger = system?.querySelector("input.ant-select-input") as HTMLElement;
    expect(trigger).toBeTruthy();
    fireEvent.mouseDown(trigger);
    fireEvent.click(await screen.findByText("法宝品阶（2 级）"));
    expect(api.updateCategory).toHaveBeenCalledWith("cat1", { systemId: "sys-fabao" });
  });

  it("改名走 updateCategory；返回 false（撞名）时提示", () => {
    const api = makeApi();
    render(<CategoryManager api={api} />);
    const input = screen.getByLabelText("分类名：装备") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "武器" } });
    expect(api.updateCategory).toHaveBeenCalledWith("cat1", { name: "武器" });
    expect(api.showToast).not.toHaveBeenCalled();

    const dup = makeApi({ updateCategory: vi.fn(() => false) });
    cleanup();
    render(<CategoryManager api={dup} />);
    const dupInput = screen.getByLabelText("分类名：装备") as HTMLInputElement;
    fireEvent.change(dupInput, { target: { value: "丹药" } });
    expect(dup.showToast).toHaveBeenCalledWith("已有同名分类，换个名字", "warning");
  });

  it("删除分类先确认再执行，并报受影响物品数", () => {
    const api = makeApi({ removeCategory: vi.fn(() => 2) });
    render(<CategoryManager api={api} />);
    fireEvent.click(screen.getByTitle(/删除分类/));
    fireEvent.click(screen.getByRole("button", { name: "删除分类" }));
    expect(api.removeCategory).toHaveBeenCalledWith("cat1");
    expect(api.showToast).toHaveBeenCalledWith(
      "已删除分类，2 个物品退回「未分类」",
      "info",
    );
  });
});
