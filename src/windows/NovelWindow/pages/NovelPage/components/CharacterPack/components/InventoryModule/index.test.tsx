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
  slotIndex: null,
  sourceChapterId: "",
  weight: 0,
  updatedAt: 0,
};

const doc: PackDoc = {
  character: {
    id: "c1",
    workId: "w1",
    name: "主角",
    avatar: "",
    isProtagonist: true,
    entityId: "",
    realmAt: "",
    weightLimit: 0,
    capacityLimit: 0,
    note: "",
    sortOrder: 1,
  },
  attributes: [],
  slots: [],
  items: [item],
  skills: [],
  modifiers: [],
  unitSystems: [],
  layouts: [],
  presets: [],
};

function makeApi(over: Partial<PackPanelApi> = {}) {
  return {
    doc,
    summary: { rows: [], ignoredCast: 0 },
    dirty: 0,
    prefs: { collapsed: {}, inventoryView: "list" },
    /**
     * 负重 / 容量读数（REQ-033）。
     *
     * 这里给的是**手写的小对象**而不是调 `weightStatus()`：夹具要能独立地表达
     * 「超载」「满格」这些边界（真实函数在重量为 0 时永远算出 over=false），
     * 用真实函数反而测不到警告分支。
     */
    load: {
      weight: { total: 0, limit: 0, over: false, ratio: 0, hasWeight: false },
      capacity: { used: doc.items.length, limit: 0, full: false, ratio: 0 },
    },
    setLoadLimits: vi.fn(),
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
   * （「描述 / 标签 / 重量」↔「收起描述与标签」），一个修饰词改动就挂一整片测试，
   * 而那些断言测的是数据回写，不是文案。
   */
  const DETAIL_MENU = /描述/;

  it("默认不渲染描述与标签（行内只占一行）", () => {
    render(<InventoryModule api={makeApi()} />);
    expect(screen.queryByLabelText("物品描述")).toBeNull();
    expect(screen.queryByLabelText("物品标签")).toBeNull();
    expect(document.querySelector(".cpk-inv__detail")).toBeNull();
  });

  it("行尾只有「加成效果」与「更多」两个图标按钮（340px 的硬约束）", () => {
    render(<InventoryModule api={makeApi()} />);
    const line = document.querySelector(".cpk-inv__line") as HTMLElement;
    // 稀有度 + 减 + 加 + ✦ + ⋯ = 5；再加一个行尾按钮就会在 340px 下溢出
    expect(line.querySelectorAll(".cpk-iconbtn").length).toBe(5);
    expect(screen.getByLabelText("更多操作")).toBeInTheDocument();
    expect(screen.getByTitle("加成效果")).toBeInTheDocument();
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
 * 负重 / 容量条（REQ-033 / F-5）
 *
 * 这里钉的是**两条容易被合并掉的语义**：
 *  - 上限为 0 是「不限」而不是「上限为零」—— 合并的话所有没设上限的书都会顶着红字；
 *  - 满格与超载是**两个独立口径**（200 株草药占 1 格却可能压垮肩膀），必须能各自报警。
 */
describe("InventoryModule —— 负重与容量（REQ-033）", () => {
  afterEach(cleanup);

  const withLoad = (over: Record<string, unknown>) =>
    makeApi({
      doc: { ...doc, character: { ...doc.character, weightLimit: 20, capacityLimit: 40 } },
      ...over,
    } as Partial<PackPanelApi>);

  it("把格数与负重都显示出来（上限为 0 时说「不限」而不是 0）", () => {
    render(<InventoryModule api={makeApi()} />);
    const bar = document.querySelector(".cpk-inv__load") as HTMLElement;
    expect(bar.textContent).toContain("格数 1");
    expect(bar.textContent).toContain("（不限）");
  });

  it("满了 / 超了各自出警告，且不会互相冒充", () => {
    const api = withLoad({
      load: {
        weight: { total: 31.5, limit: 20, over: true, ratio: 1.575, hasWeight: true },
        capacity: { used: 40, limit: 40, full: true, ratio: 1 },
      },
    });
    render(<InventoryModule api={api} />);
    const bar = document.querySelector(".cpk-inv__load") as HTMLElement;
    expect(bar.textContent).toContain("背包已满");
    expect(bar.textContent).toContain("超载");
    expect(bar.textContent).toContain("31.5/20");
  });

  it("只在超载时给「记为状态」入口，且已有同名状态时不重复给", () => {
    const { unmount } = render(
      <InventoryModule
        api={withLoad({
          load: {
            weight: { total: 31.5, limit: 20, over: true, ratio: 1.575, hasWeight: true },
            capacity: { used: 1, limit: 40, full: false, ratio: 0.025 },
          },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /记为状态/ })).toBeInTheDocument();
    unmount();

    // 已经有一条「超载」状态 → 不能让作者点出第二条
    render(
      <InventoryModule
        api={withLoad({
          doc: {
            ...doc,
            character: { ...doc.character, weightLimit: 20, capacityLimit: 40 },
            modifiers: [
              {
                id: "pm1",
                ownerType: "status",
                ownerId: "c1",
                nature: "sustained",
                name: "超载",
                targetAttrId: "",
                op: "add",
                value: 0,
                valueUnit: "",
                scaleByProficiency: false,
                active: true,
                defaultOn: false,
                cost: "",
                cooldown: null,
                duration: "",
                roundsLeft: null,
                target: "",
                trigger: "",
                condition: "",
                note: "",
                disabled: false,
                sortOrder: 1,
              },
            ],
          },
          load: {
            weight: { total: 31.5, limit: 20, over: true, ratio: 1.575, hasWeight: true },
            capacity: { used: 1, limit: 40, full: false, ratio: 0.025 },
          },
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /记为状态/ })).toBeNull();
  });

  it("上限面板里的两个输入框分别回写（规范化在纯函数层，见 pack-utils 的 normalizeLimit）", () => {
    const api = withLoad({});
    render(<InventoryModule api={api} />);
    // 两字中文按钮会被 antd 插字间距（「上 限」），所以按正则去空白匹配
    fireEvent.click(screen.getByRole("button", { name: /上\s*限/ }));

    // ⚠️ 填的值必须与当前值不同：antd 的 InputNumber 在「解析结果和现有值一样」时
    // 不回调 onChange（夹具的初始上限是 40 / 20），填同一个数会得到零调用。
    fireEvent.change(screen.getByLabelText("格数上限"), { target: { value: "60" } });
    expect(api.setLoadLimits).toHaveBeenCalledWith({ capacityLimit: 60 });

    fireEvent.change(screen.getByLabelText("负重上限"), { target: { value: "12.5" } });
    expect(api.setLoadLimits).toHaveBeenCalledWith({ weightLimit: 12.5 });
  });

  it("单件重量在详情行里改，并按「单件 × 数量」显示小计", async () => {
    const api = makeApi({
      doc: {
        ...doc,
        items: [{ ...item, qty: 3, weight: 1.5 }],
      },
    });
    render(<InventoryModule api={api} />);
    const more = screen.getByLabelText("更多操作");
    fireEvent.click(more);
    fireEvent.click(await screen.findByRole("menuitem", { name: /描述/ }));

    expect(screen.getByText(/小计 4.5（3 件）/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("单件重量"), { target: { value: "2" } });
    expect(api.updateItem).toHaveBeenCalledWith("i1", { weight: 2 });
  });
});
