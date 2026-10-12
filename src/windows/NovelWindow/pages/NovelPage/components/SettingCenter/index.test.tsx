import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingCategory } from "../../types";
import SettingCenter from "./index";

/**
 * 按可见文案点按钮（去空白匹配 + 限定 BUTTON）
 *
 * ⚠️ antd 会给两字中文按钮自动插字间距（「生成」渲染成「生 成」），
 * 且本测试不经 ThemeProvider，autoInsertSpace 关不掉 —— 直接 getByText 会 miss。
 */
function clickButton(text: string): void {
  const target = screen
    .getAllByRole("button")
    .find((button) => (button.textContent ?? "").replace(/\s/g, "") === text);
  if (!target) throw new Error(`找不到按钮：${text}`);
  fireEvent.click(target);
}

/**
 * 设定中心的回归守卫
 *
 * 钉的是几个「错了不报错、但很难发现」的点：
 * - 境界体系分类要能被 focusCategoryId 直接选中（从角色卡「管理境界」进来）
 * - 新建分类传色点（不传则全部同色，分类列表没法扫读）
 * - 插入条在失焦 / Esc 时要收起，否则会残留一条空输入盖在行间
 */
const level = (id: string, name: string, rank: number): SettingCategory["levels"][number] => ({
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

const realm: SettingCategory = {
  id: "c1",
  workId: "w1",
  name: "境界体系",
  color: "#8B77F0",
  kind: "realm",
  sortOrder: 1,
  note: "修行的境界阶梯",
  subLevels: 9,
  carryDir: "asc",
  subPattern: "第{n}层",
  levels: [level("l1", "引气", 1), level("l2", "筑基", 2)],
};

const custom: SettingCategory = {
  ...realm,
  id: "c2",
  name: "丹药稀有度",
  kind: "custom",
  color: "#E8935E",
  sortOrder: 2,
  levels: [level("l3", "凡品", 1)],
};

const buildProps = (over: Partial<Parameters<typeof SettingCenter>[0]> = {}) => ({
  open: true,
  workName: "《九霄剑途》",
  settings: [realm, custom],
  focusCategoryId: null,
  onClose: vi.fn(),
  onCreateCategory: vi.fn(),
  onPatchCategory: vi.fn(),
  onDeleteCategory: vi.fn(),
  onReorderCategories: vi.fn(),
  onAddLevel: vi.fn(),
  onBatchAddLevels: vi.fn(),
  onPatchLevel: vi.fn(),
  onDeleteLevel: vi.fn(),
  onReorderLevels: vi.fn(),
  onSplitLevel: vi.fn(),
  onMergeLevel: vi.fn(),
  onExport: vi.fn(),
  onSaveTemplate: vi.fn(),
  templates: [],
  onRefreshTemplates: vi.fn(),
  onApplyTemplate: vi.fn(),
  onDeleteTemplate: vi.fn(),
  onApplyPreset: vi.fn(),
  ...over,
});

describe("设定中心", () => {
  afterEach(() => {
    cleanup();
  });

  it("focusCategoryId 直接落到指定分类（从角色卡「管理境界」进来）", () => {
    render(<SettingCenter {...buildProps({ focusCategoryId: "c2" })} />);
    // 分类头显示的是被聚焦的那个，而不是列表里第一个。
    // 限定 .nv-sc__cat-title：分类名在左栏列表里也出现一次，且 Modal 渲染在
    // portal 里，拿 container 查不到
    expect(
      screen.getByText("丹药稀有度", { selector: ".nv-sc__cat-title" }),
    ).toBeInTheDocument();
  });

  it("未指定聚焦时落到第一个分类", () => {
    render(<SettingCenter {...buildProps()} />);
    expect(
      screen.getByText("境界体系", { selector: ".nv-sc__cat-title" }),
    ).toBeInTheDocument();
  });

  it("新建分类带色点：全部同色的列表没法扫读", () => {
    const onCreateCategory = vi.fn();
    render(<SettingCenter {...buildProps({ onCreateCategory })} />);
    fireEvent.change(screen.getByLabelText("新分类名"), {
      target: { value: "法宝品阶" },
    });
    fireEvent.click(screen.getByText("新建"));
    expect(onCreateCategory).toHaveBeenCalled();
    const [name, kind, color] = onCreateCategory.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(name).toBe("法宝品阶");
    expect(kind).toBe("custom");
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("空分类名不落库", () => {
    const onCreateCategory = vi.fn();
    render(<SettingCenter {...buildProps({ onCreateCategory })} />);
    const button = screen.getByText("新建").closest("button");
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    expect(onCreateCategory).not.toHaveBeenCalled();
  });

  it("进位方向有选择器，desc 时示例跟着反向（「九品 → 一品」）", () => {
    const { rerender } = render(<SettingCenter {...buildProps()} />);
    // 正序示例：引气 第1层 → … → 筑基 第1层
    expect(screen.getByText(/引气 第1层.*筑基 第1层/)).toBeInTheDocument();
    expect(screen.getByLabelText("进位方向")).toBeInTheDocument();

    rerender(
      <SettingCenter
        {...buildProps({ settings: [{ ...realm, carryDir: "desc" }] })}
      />,
    );
    // 倒序示例反过来：筑基 第1层 → … → 引气 第1层
    expect(screen.getByText(/筑基 第1层.*引气 第1层/)).toBeInTheDocument();
  });

  it("点等级 chip 之外：行间插入条回车后回调带落点下标", () => {
    const onAddLevel = vi.fn();
    render(<SettingCenter {...buildProps({ onAddLevel })} />);
    const insertButtons = screen.getAllByText("在此插入");
    fireEvent.click(insertButtons[0]);
    const input = screen.getByLabelText("在此插入新等级");
    fireEvent.change(input, { target: { value: "元丹" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddLevel).toHaveBeenCalledWith("c1", "元丹", 0);
  });

  it("「在末尾插入」落点是行数（rank 有空洞时也不能用 max(rank) 当行数）", () => {
    const onAddLevel = vi.fn();
    // rank 是 1、2、5：max(rank)=5，行数=3；末尾落点必须是 3
    const holed: SettingCategory = {
      ...realm,
      levels: [level("l1", "引气", 1), level("l2", "筑基", 2), level("l3", "金丹", 5)],
    };
    render(<SettingCenter {...buildProps({ settings: [holed], onAddLevel })} />);
    fireEvent.click(screen.getByText("在末尾插入"));
    const input = screen.getByLabelText("在此插入新等级");
    fireEvent.change(input, { target: { value: "登仙" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddLevel).toHaveBeenCalledWith("c1", "登仙", 3);
  });

  it("阶梯里平铺出每一阶的小境界名 —— 「练气」不再是光秃秃一行", () => {
    // 练气 3 层用小层命名模板，筑基沿用分类的「第{n}层」
    const cat: SettingCategory = {
      ...realm,
      levels: [
        level("l1", "引气", 1),
        { ...level("l2", "筑基", 2), subLevels: 3, subPattern: "" },
      ],
    };
    render(<SettingCenter {...buildProps({ settings: [cat] })} />);
    // 每一阶都要有小境界清单：引气（分类模板 9 层）+ 筑基（3 层）
    expect(screen.getByText("9 小境界")).toBeInTheDocument();
    expect(screen.getByText("3 小境界")).toBeInTheDocument();
    // 小境界名本身可见（此前只有一个存在于文案里的数字，行里看不到）
    expect(screen.getAllByText("第1层").length).toBeGreaterThan(0);
    expect(screen.getByText("第9层")).toBeInTheDocument();
  });

  it("小境界总计入状态条，且拆分过的阶不重复计数", () => {
    const cat: SettingCategory = {
      ...realm,
      levels: [
        { ...level("l1", "练气", 1), subLevels: 4, segFrom: 1, segTo: 4 },
        {
          ...level("l1s2", "练气 · 第2段", 2),
          subLevels: 5,
          segFrom: 5,
          segTo: 9,
          parentId: "l1",
        },
        { ...level("l2", "筑基", 3), subLevels: 4 },
      ],
    };
    render(<SettingCenter {...buildProps({ settings: [cat] })} />);
    // 9 + 4 = 13：派生段不另算
    expect(screen.getByText(/13 小境界/)).toBeInTheDocument();
  });

  it("Esc 收起插入条，不留空输入盖在行间", () => {
    render(<SettingCenter {...buildProps()} />);
    fireEvent.click(screen.getAllByText("在此插入")[0]);
    const input = screen.getByLabelText("在此插入新等级");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("在此插入新等级")).toBeNull();
  });

  it("空分类时给出引导而不是空白", () => {
    render(<SettingCenter {...buildProps({ settings: [] })} />);
    expect(screen.getByText("先新建一个设定分类")).toBeInTheDocument();
  });

  it("等级序列按进位方向展示：desc 时高阶在上", () => {
    render(<SettingCenter {...buildProps({ settings: [{ ...realm, carryDir: "desc" }] })} />);
    const names = screen
      .getAllByText(/引气|筑基/)
      .map((node) => node.textContent);
    // 「筑基」排在「引气」之前 —— 倒序阶梯在展示上要反过来
    expect(names.indexOf("筑基")).toBeLessThan(names.indexOf("引气"));
  });

  it("批量生成（逐行输入）：空行被过滤，名称顺序即提交顺序", () => {
    const onBatchAddLevels = vi.fn();
    render(<SettingCenter {...buildProps({ onBatchAddLevels })} />);
    fireEvent.click(screen.getByText("批量生成"));
    const textarea = screen.getByLabelText("批量等级名（每行一个）");
    fireEvent.change(textarea, { target: { value: "练气\n\n筑基\n金丹\n" } });
    clickButton("生成");
    expect(onBatchAddLevels).toHaveBeenCalledWith("c1", ["练气", "筑基", "金丹"]);
  });

  it("批量生成（模板生成）：按数量 + 模板渲染，预览先行", () => {
    const onBatchAddLevels = vi.fn();
    render(<SettingCenter {...buildProps({ onBatchAddLevels })} />);
    fireEvent.click(screen.getByText("批量生成"));
    fireEvent.click(screen.getByText("模板生成"));
    fireEvent.change(screen.getByLabelText("生成数量"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("批量命名模板"), {
      target: { value: "第{n}重" },
    });
    expect(screen.getByText(/预览/)).toBeInTheDocument();
    clickButton("生成");
    expect(onBatchAddLevels).toHaveBeenCalledWith("c1", ["第1重", "第2重", "第3重"]);
  });

  it("子层级弹窗：命名模板一并提交（首个子层级 id 复用的口径由数据层保证）", () => {
    const onSplitLevel = vi.fn();
    render(<SettingCenter {...buildProps({ onSplitLevel })} />);
    // 打开「引气」行的 ⋯ 菜单 → 新增子层级
    const row = screen.getByText("引气", { selector: ".nv-sc__col-name" });
    const rowOps = row.closest(".nv-sc__row");
    fireEvent.click(rowOps!.querySelector('[aria-label="更多操作"]')!);
    fireEvent.click(screen.getByText("新增子层级…"));
    fireEvent.change(screen.getByLabelText("子层级数量"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("子层级命名模板"), {
      target: { value: "{name}·{n}重" },
    });
    clickButton("新增");
    expect(onSplitLevel).toHaveBeenCalledWith("l1", 3, "{name}·{n}重");
  });

  it("行内编辑可写本阶小层命名：空值原样提交（空 = 沿用分类）", () => {
    const onPatchLevel = vi.fn();
    render(<SettingCenter {...buildProps({ onPatchLevel })} />);
    const row = screen.getByText("引气", { selector: ".nv-sc__col-name" });
    fireEvent.click(row.closest(".nv-sc__row")!.querySelector('[aria-label="更多操作"]')!);
    fireEvent.click(screen.getByText("编辑名称 / 别名 / 说明"));
    fireEvent.change(screen.getByLabelText("小层命名"), {
      target: { value: "初期,中期,后期,圆满" },
    });
    clickButton("保存");
    expect(onPatchLevel).toHaveBeenCalledWith(
      "l1",
      expect.objectContaining({ subPattern: "初期,中期,后期,圆满" }),
    );
  });

  it("模板库列出内置预设，点击按 id 回调", () => {
    const onApplyPreset = vi.fn();
    render(<SettingCenter {...buildProps({ onApplyPreset })} />);
    fireEvent.click(screen.getByText("模板库"));
    fireEvent.click(screen.getByText("修仙 · 经典九层").closest(".nv-sc__lib-row")!.querySelector("button")!);
    expect(onApplyPreset).toHaveBeenCalledWith("preset-xiuxian-9");
  });
});
