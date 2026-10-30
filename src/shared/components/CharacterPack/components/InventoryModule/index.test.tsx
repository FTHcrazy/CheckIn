import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryModule from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import type { PackItem } from "../../types";

/**
 * 物品栏的两条行内编辑不变量（REQ-010 收尾：稀有度可改 + 描述 / 标签暴露）。
 *
 * 这里钉的不是「渲染出来没有」，而是两类**看着像好了、其实在悄悄丢数据**的写法：
 *
 *  1. 稀有度入口是一个**真按钮**（圆点即入口）。如果退回成不可点的 `<span>`，
 *     功能就退化成「只能看」，这一组断言会立刻失败。
 *  2. 标签在存储里是 `string[]`，输入时是一整串。若每个字符都 `split` 回写模型，
 *     敲到一半的空格会被立刻规范化掉（值被 join 回来），表现为「打不出第二个词」。
 *     所以断言「输入中不写库 / 失焦才提交一次」，以及「折叠详情时草稿也会被提交」
 *     （不提交 = 用户明明打了字、面板一收就没了）。
 */

const item: PackItem = {
  id: "i1",
  characterId: "c1",
  name: "玄铁剑",
  category: "装备",
  qty: 1,
  rarity: "rare",
  icon: "",
  desc: "",
  tags: [],
  equippedSlotId: "",
  groupId: "",
  gradeId: "",
  slotIndex: null,
  sourceChapterId: "",
  updatedAt: 0,
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
  categories: [],
  items: [item],
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
    summary: { rows: [], ignoredCast: 0 },
    dirty: 0,
    prefs: { collapsed: {}, inventoryView: "list" },
    addStatus: vi.fn(() => ""),
    toggleModuleCollapsed: vi.fn(),
    isRecentlyChanged: () => false,
    updateItem: vi.fn(),
    stepItemQty: vi.fn(),
    equipItem: vi.fn(() => ({ ok: true, conflict: false })),
    unequipItem: vi.fn(),
    removeItem: vi.fn(),
    modifiersOf: () => [],
    openEffectEditor: vi.fn(),
    showToast: vi.fn(),
    patchPrefs: vi.fn(),
    addItem: vi.fn(),
    // 体系品阶 / 分类管理（1.40.0）：默认「没有体系」的空态路径
    gradeSystems: [],
    hasGradeSystems: false,
    gradeNameOf: () => "",
    categorySystemIdOf: () => "",
    setCategoryManagerOpen: vi.fn(),
    ...over,
  } as unknown as PackPanelApi;
}

describe("InventoryModule —— 稀有度可改（REQ-010）", () => {
  afterEach(cleanup);

  it("圆点是可点的按钮，文案反映当前稀有度", () => {
    render(<InventoryModule api={makeApi()} />);
    const trigger = screen.getByLabelText("稀有度：稀有");
    expect(trigger.tagName).toBe("BUTTON");
  });

  it("打开菜单选中另一档 → 回写 rarity", async () => {
    const api = makeApi();
    render(<InventoryModule api={api} />);

    fireEvent.click(screen.getByLabelText("稀有度：稀有"));
    const option = await screen.findByRole("menuitem", { name: /传说/ });
    fireEvent.click(option);

    expect(api.updateItem).toHaveBeenCalledWith("i1", { rarity: "legend" });
  });
});

describe("InventoryModule —— 描述 / 标签（REQ-010）", () => {
  afterEach(cleanup);

  /**
   * 行尾「更多」菜单里点一次菜单项。
   *
   * 描述与标签**刻意不做成行内第三个图标按钮**：行囊面板最窄 340px 时，
   * 一行只剩 285px 可用，而「已穿戴 + 刚改动角标」这行的不可压缩宽度已到 285px，
   * 行尾最多只放得下两个图标按钮（实测，见 CHANGELOG 1.27.0）。
   */
  const clickMenu = async (label: string | RegExp) => {
    fireEvent.click(screen.getByLabelText("更多操作"));
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
  };

  /**
   * 详情菜单项。**用正则而不是抄死文案**：它的标签随展开状态变
   * （「描述 / 标签」↔「收起描述与标签」），一个修饰词改动就挂一整片测试，
   * 而那些断言测的是数据回写，不是文案。
   */
  const DETAIL_MENU = /描述/;

  it("默认不渲染描述与标签（行内只占一行）", () => {
    render(<InventoryModule api={makeApi()} />);
    expect(screen.queryByLabelText("物品描述")).toBeNull();
    expect(screen.queryByLabelText("物品标签")).toBeNull();
    expect(document.querySelector(".cpk-inv__detail")).toBeNull();
  });

  it("主行只留 4 个图标按钮，低频入口全进「更多」（340px 的硬约束）", () => {
    render(<InventoryModule api={makeApi()} />);
    const line = document.querySelector(".cpk-inv__line") as HTMLElement;
    // 稀有度 + 减 + 加 + ⋯ = 4。
    // 2026-10 用户报障「行太窄、每行塞太多控件」：分类下拉与 ✦ 加成效果
    // 已移入「更多」菜单，名称输入框因此拿回被分类吃掉的 ~74px。
    expect(line.querySelectorAll(".cpk-iconbtn").length).toBe(4);
    expect(screen.getByLabelText("更多操作")).toBeInTheDocument();
    // 移走的两个都不该再出现在主行里
    expect(screen.queryByTitle("加成效果")).toBeNull();
    expect(line.querySelector(".cpk-inv__cat")).toBeNull();
  });

  it("从菜单展开后描述直改回写 desc", async () => {
    const api = makeApi();
    render(<InventoryModule api={api} />);
    await clickMenu(DETAIL_MENU);

    fireEvent.change(screen.getByLabelText("物品描述"), {
      target: { value: "沉在剑冢里三百年" },
    });
    expect(api.updateItem).toHaveBeenCalledWith("i1", { desc: "沉在剑冢里三百年" });
  });

  it("标签输入中不写库，失焦才提交一次并拆成数组", async () => {
    const api = makeApi();
    render(<InventoryModule api={api} />);
    await clickMenu(DETAIL_MENU);

    const input = screen.getByLabelText("物品标签");
    fireEvent.change(input, { target: { value: "本命法器" } });
    fireEvent.change(input, { target: { value: "本命法器 玄铁" } });
    // 输入过程中一次都不能回写：回写会把「本命法器」（还没打完）当成最终值
    expect(api.updateItem).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith("i1", { tags: ["本命法器", "玄铁"] });
  });

  it("分隔符兼容中英文逗号与顿号", async () => {
    const api = makeApi();
    render(<InventoryModule api={api} />);
    await clickMenu(DETAIL_MENU);

    const input = screen.getByLabelText("物品标签");
    fireEvent.change(input, { target: { value: "玄铁，本命、断剑" } });
    fireEvent.blur(input);

    expect(api.updateItem).toHaveBeenCalledWith("i1", { tags: ["玄铁", "本命", "断剑"] });
  });

  it("收起详情时把未失焦的标签草稿一并提交（不静默丢弃）", async () => {
    const api = makeApi();
    render(<InventoryModule api={api} />);
    await clickMenu(DETAIL_MENU);
    expect(document.querySelector(".cpk-inv__detail")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("物品标签"), { target: { value: "残缺" } });
    // 从菜单收起（不触发 blur）
    await clickMenu(DETAIL_MENU);

    expect(api.updateItem).toHaveBeenCalledWith("i1", { tags: ["残缺"] });
    expect(screen.queryByLabelText("物品标签")).toBeNull();
  });

  it("删除走同一个「更多」菜单，且仍要先确认", async () => {
    const api = makeApi();
    render(<InventoryModule api={api} />);
    await clickMenu("删除");

    // 菜单本身不直接删：先出现确认条（文案里有物品名）
    expect(api.removeItem).not.toHaveBeenCalled();
    const confirm = document.querySelector(".cpk-inv__confirm") as HTMLElement;
    expect(confirm).not.toBeNull();
    // 组件在测试里没有包 ThemeProvider，所以 antd 会给两字中文按钮插字间距（「删 除」）
    fireEvent.click(within(confirm).getByRole("button", { name: /删\s*除/ }));

    expect(api.removeItem).toHaveBeenCalledWith("i1");
  });

  it("已存在的标签按空格回填到输入框", async () => {
    render(
      <InventoryModule api={makeApi({ doc: { ...doc, items: [{ ...item, tags: ["玄铁", "断剑"] }] } })} />,
    );
    await clickMenu(DETAIL_MENU);
    await waitFor(() => {
      expect((screen.getByLabelText("物品标签") as HTMLInputElement).value).toBe("玄铁 断剑");
    });
  });
});

/**
 * 分组与宫格视图下线（1.41.0，用户要求）：物品栏只管「带了什么、有多少」。
 * groupId 列保留（compat，旧数据不丢），只是不再有任何编辑入口；
 * 装备限制仍由部位 accepts × 物品 groupId 匹配，分组管理入口迁到装备栏。
 */
describe("InventoryModule —— 分组与布局切换下线（1.41.0）", () => {
  afterEach(cleanup);

  it("「更多」菜单里没有「分组」行", async () => {
    render(<InventoryModule api={makeApi()} />);
    fireEvent.click(screen.getByLabelText("更多操作"));
    // 菜单已展开（「分类」行在），且「分组」行不再存在
    await screen.findByText("分类");
    expect(screen.queryByText("分组")).toBeNull();
  });

  it("头部没有布局切换按钮，也不再有分组设置入口", () => {
    render(<InventoryModule api={makeApi()} />);
    expect(screen.queryByTitle(/切换到列表视图/)).toBeNull();
    expect(screen.queryByTitle(/切换到宫格视图/)).toBeNull();
    expect(screen.queryByTitle(/分组设置/)).toBeNull();
    // 分类管理入口还在（1.40.0 的功能不受影响）
    expect(screen.getByTitle(/分类管理/)).toBeInTheDocument();
  });

  it("列表只渲染为 ul.cpk-inv 列表形态（没有 is-grid 派生类）", () => {
    render(<InventoryModule api={makeApi()} />);
    const list = document.querySelector("ul.cpk-inv");
    expect(list).not.toBeNull();
    expect(list?.className).not.toContain("is-grid");
  });
});
