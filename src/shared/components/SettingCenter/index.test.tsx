import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingCategory } from "@/shared/novel/setting-types";
import SettingCenter from "./index";

// 本文件的「本书接线」describe 是重组件：四个 antd 弹层 + DndContext + dnd-kit
// sensors，全仓并行跑 CPU 争用时单例会超默认 5s（单独跑 1.3–1.5s）。
// 与 ColorPicker / GsBody 等重组件同处理，**不改任何既有用例**。
vi.setConfig({ testTimeout: 20000 });

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
    // antd Modal 经 portal 挂到 document.body，RTL 的 cleanup 收不走，
    // 不清会让下一条用例读到上一条残留的浮层
    document.body.innerHTML = "";
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
    // 契约（2.17.1）起传 { name, note } 条目而不是裸名字 —— 断言仍钉「顺序即提交顺序」
    expect(
      onBatchAddLevels.mock.calls[0][1].map((item: { name: string }) => item.name),
    ).toEqual(["练气", "筑基", "金丹"]);
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
    expect(
      onBatchAddLevels.mock.calls[0][1].map((item: { name: string }) => item.name),
    ).toEqual(["第1重", "第2重", "第3重"]);
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

  it("子层级（parentId 非空）不提供「新增子层级」入口：杜绝第三层嵌套", () => {
    const cat: SettingCategory = {
      ...realm,
      levels: [
        level("l1", "练气", 1),
        { ...level("l1s1", "练气 · 第1段", 2), parentId: "l1", segFrom: 1, segTo: 4 },
      ],
    };
    render(<SettingCenter {...buildProps({ settings: [cat] })} />);
    const childRow = screen.getByText("练气 · 第1段", { selector: ".nv-sc__col-name" });
    fireEvent.click(
      childRow.closest(".nv-sc__row")!.querySelector('[aria-label="更多操作"]')!,
    );
    // 子层级的 ⋯ 菜单里没有拆分入口（仍保留编辑 / 删除），
    // 从 UI 上杜绝「练气 · 第1段」再拆出第三层。
    expect(screen.queryByText("新增子层级…")).toBeNull();
    expect(screen.getByText("编辑名称 / 别名 / 说明")).toBeInTheDocument();
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

  /**
   * UI-05：把「境界体系只是 kind='realm' 的一条等级序列」这件事，
   * 翻译成新手能按常识找到的入口 —— 左栏用直白分组名 + 一句人话说明。
   * 钉住这两处，避免后续有人「顺手」改回中性的「设定分类」。
   */
  it("UI-05：左栏用常识化分组名「等级序列」并给出人话说明", () => {
    render(<SettingCenter {...buildProps()} />);
    expect(
      screen.getByText("等级序列", { selector: ".nv-sc__side-head" }),
    ).toBeInTheDocument();
    // 说明里必须出现通用的常识词，否则新手还是找不到入口
    expect(
      screen.getByText(/境界.*品阶.*功法等级都在这里/),
    ).toBeInTheDocument();
  });

  it("UI-05：分类为空时，左栏分组说明与右栏空态引导同时保留", () => {
    render(<SettingCenter {...buildProps({ settings: [] })} />);
    expect(
      screen.getByText("等级序列", { selector: ".nv-sc__side-head" }),
    ).toBeInTheDocument();
    expect(screen.getByText("先新建一个设定分类")).toBeInTheDocument();
  });

  it("FR-05 提示保留：重命名与删除指向右侧卡片按钮（勿回潮到「右键 / 行尾菜单」）", () => {
    render(<SettingCenter {...buildProps()} />);
    expect(
      screen.getByText("重命名与删除在右侧卡片的「编辑 / 删除」按钮"),
    ).toBeInTheDocument();
  });
});

/**
 * `source` 分支（T03）
 *
 * 同一个组件被本书设定中心与全局设定中心窗口共用，靠 `source` 切形态：
 * - book（缺省）：原行为，标题带作品名、提示语本书口径；
 * - global：标题「全局设定中心 · 跨书共享」、分类行带「N 部书引用」徽标、
 *   动作区去掉绑 workId 的「另存为模板」。
 *
 * 只断言**呈现差异**，不碰回调契约（拉哪份数据由调用方决定）。
 */
describe("source 分支（book / global）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("source=book（缺省）：标题带作品名、提示语本书口径、无引用计数徽标", () => {
    render(<SettingCenter {...buildProps()} />);
    expect(screen.getByText("设定中心")).toBeInTheDocument();
    expect(
      screen.getByText("《九霄剑途》", { selector: ".nv-sc__pill" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/设定按作品独立存储/)).toBeInTheDocument();
    expect(screen.queryByText("部书引用")).toBeNull();
    expect(screen.queryByText("暂无引用")).toBeNull();
  });

  it("source=global：标题改跨书共享、提示语全局口径、分类行带引用计数徽标", () => {
    render(
      <SettingCenter
        {...buildProps({
          source: "global",
          settings: [{ ...realm, refCount: 3 }, { ...custom, refCount: 0 }],
        })}
      />,
    );
    expect(screen.getByText("全局设定中心")).toBeInTheDocument();
    expect(
      screen.getByText("跨书共享", { selector: ".nv-sc__pill" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/改动会同步到仍引用它的书/)).toBeInTheDocument();
    // 聚焦分类是第一个（realm，refCount=3）
    expect(screen.getByText("3 部书引用")).toBeInTheDocument();
    // 「已联动角色境界」是本书域概念，全局库不显示
    expect(screen.queryByText("已联动角色境界")).toBeNull();
  });

  it("source=global：动作区去掉「另存为模板」，导出改为整库口径", async () => {
    render(<SettingCenter {...buildProps({ source: "global" })} />);
    fireEvent.click(screen.getByLabelText("更多设定操作"));
    expect(await screen.findByText(/导出为 JSON（全部）/)).toBeInTheDocument();
    expect(screen.queryByText(/另存为模板/)).toBeNull();
  });

  it("source=book（缺省）：动作区保留「另存为模板」", async () => {
    render(<SettingCenter {...buildProps()} />);
    fireEvent.click(screen.getByLabelText("更多设定操作"));
    expect(await screen.findByText(/另存为模板/)).toBeInTheDocument();
    expect(screen.getByText(/导出为 JSON（本分类）/)).toBeInTheDocument();
  });
});

/**
 * 本书接线（T04：从全局库选择 / 放置到全局 / 引用态只读）
 *
 * 引用是「只读 + 自动同步」的镜像（D2）：UI 隐藏/禁用写入口只是降低误触，
 * **主进程才是权威**。这里钉的是呈现与回调契约 —— 入口出现条件、
 * 引用态徽标、只读禁用、上架的冲突二次确认。
 */
describe("本书接线（T04：引用 / 上架）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  const globalRealm: SettingCategory = {
    ...realm,
    id: "g1",
    workId: "",
    name: "通用修仙体系",
    refCount: 2,
  };

  const globalCustom: SettingCategory = {
    ...custom,
    id: "g2",
    workId: "",
    name: "丹药品阶",
    refCount: 0,
  };

  it("source=book：提供回调时出现「从全局库选择」与「放置到全局」", () => {
    render(
      <SettingCenter
        {...buildProps({
          globalCategories: [globalRealm],
          onRefreshGlobalCategories: vi.fn(),
          onReferenceGlobal: vi.fn().mockResolvedValue(true),
          onPublishGlobal: vi.fn().mockResolvedValue({ ok: true }),
        })}
      />,
    );
    expect(screen.getByText("从全局库选择")).toBeInTheDocument();
    expect(screen.getByText("放置到全局")).toBeInTheDocument();
  });

  it("未提供引用回调时不渲染「从全局库选择」（不给够不着的按钮）", () => {
    render(<SettingCenter {...buildProps()} />);
    expect(screen.queryByText("从全局库选择")).toBeNull();
  });

  it("source=global：本书域的引用 / 上架入口都不渲染", () => {
    render(
      <SettingCenter
        {...buildProps({
          source: "global",
          globalCategories: [globalRealm],
          onReferenceGlobal: vi.fn().mockResolvedValue(true),
          onPublishGlobal: vi.fn().mockResolvedValue({ ok: true }),
        })}
      />,
    );
    expect(screen.queryByText("从全局库选择")).toBeNull();
    expect(screen.queryByText("放置到全局")).toBeNull();
  });

  it("引用态分类：显示「全局 · 自动同步」徽标，编辑 / 删除禁用、行内写入口收走", () => {
    const imported: SettingCategory = {
      ...realm,
      id: "c9",
      name: "通用体系",
      sourceGlobalId: "g1",
    };
    render(<SettingCenter {...buildProps({ settings: [imported] })} />);
    expect(screen.getByText("全局 · 自动同步")).toBeInTheDocument();
    expect(screen.getByText("编辑").closest("button")!.disabled).toBe(true);
    expect(screen.getByText("删除").closest("button")!.disabled).toBe(true);
    // 引用项不给行内「⋯」写入口；等级行「操作」列改显只读（每阶一个）
    expect(screen.queryByLabelText("更多操作")).toBeNull();
    expect(screen.getAllByText("只读")).toHaveLength(imported.levels.length);
  });

  it("固化副本：显示「原全局项已删除，已转为本书副本」提示（可继续当普通分类编辑）", () => {
    const detached: SettingCategory = {
      ...realm,
      id: "c8",
      name: "旧体系",
      detachedFromName: "旧全局体系",
    };
    render(<SettingCenter {...buildProps({ settings: [detached] })} />);
    expect(
      screen.getByText("原全局项已删除，已转为本书副本"),
    ).toBeInTheDocument();
    // 固化后是普通分类：编辑入口可用
    expect(screen.getByText("编辑").closest("button")!.disabled).toBe(false);
  });

  it("从全局库选择：列出全局库（含引用计数）+ U6 降级提示，勾选后「加入本书」逐个建立引用", async () => {
    const onReferenceGlobal = vi.fn().mockResolvedValue(true);
    render(
      <SettingCenter
        {...buildProps({
          globalCategories: [globalRealm, globalCustom],
          onRefreshGlobalCategories: vi.fn(),
          onReferenceGlobal,
        })}
      />,
    );
    fireEvent.click(screen.getByText("从全局库选择"));
    // 选择器列出全局分类 + 引用计数
    expect(await screen.findByText("通用修仙体系")).toBeInTheDocument();
    expect(screen.getByText("2 部书引用")).toBeInTheDocument();
    expect(screen.getByText("暂无引用")).toBeInTheDocument();
    // U6：本书已有境界体系（默认 settings 含 realm）⇒ 行内提示降级为普通分类
    expect(
      screen.getByText("本书已有境界体系，已作为普通分类引入"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    clickButton("加入本书");
    expect(onReferenceGlobal).toHaveBeenCalledWith("g1");
  });

  it("放置到全局：先探同名（cancel），无同名即上架并提示成功", async () => {
    const onPublishGlobal = vi.fn().mockResolvedValue({ ok: true });
    const onNotify = vi.fn();
    render(<SettingCenter {...buildProps({ onPublishGlobal, onNotify })} />);
    fireEvent.click(screen.getByText("放置到全局"));
    expect(onPublishGlobal).toHaveBeenNthCalledWith(1, "c1", "cancel");
    await vi.waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith("已上架到全局设定中心", "success"),
    );
  });

  it("放置到全局命中同名：弹冲突确认，默认「新建为副本」以 duplicate 重调", async () => {
    const onPublishGlobal = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, conflict: true })
      .mockResolvedValueOnce({ ok: true });
    render(<SettingCenter {...buildProps({ onPublishGlobal, onNotify: vi.fn() })} />);
    fireEvent.click(screen.getByText("放置到全局"));
    expect(await screen.findByText("全局库已有同名设定")).toBeInTheDocument();
    clickButton("新建为副本");
    expect(onPublishGlobal).toHaveBeenNthCalledWith(2, "c1", "duplicate");
  });
});

/**
 * 模板能力门控（N-04）
 *
 * 5 个模板 props（templates / onSaveTemplate / onRefreshTemplates / onApplyTemplate /
 * onDeleteTemplate）已改为**显式可选**：不传（任缺其一）= 本形态不提供模板能力。
 * 但它只收「另存为模板」这一支能力 —— 动作区菜单项、SaveTemplateModal、模板库
 * 弹窗内的「我的模板」区块（`showTemplates` = hasTemplateCapability）。
 *
 * ⚠️ **不再**门控「模板库」入口与空态 CTA —— 库内「内置预设」是纯本地能力
 * （onApplyPreset 是必填 prop，`SETTING_PRESETS` 直接 import），任何形态都能用。
 * 把模板库一起门控会删掉一个本来可用的功能。
 *
 * 反面断言必须**同时**查渲染树与 `document.body`：antd Modal / Dropdown 走 portal
 * 挂到 body，只查 render 的 container 会漏掉弹窗与菜单。
 */
describe("模板能力门控（N-04：模板能力可选，但模板库 / 内置预设恒可用）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  /** 构造一份「不提供模板能力」的 props：显式删掉那 5 个模板 props */
  const withoutTemplateProps = (): Parameters<typeof SettingCenter>[0] => {
    const clone: Record<string, unknown> = { ...buildProps() };
    for (const key of [
      "onSaveTemplate",
      "templates",
      "onRefreshTemplates",
      "onApplyTemplate",
      "onDeleteTemplate",
    ]) {
      delete clone[key];
    }
    return clone as unknown as Parameters<typeof SettingCenter>[0];
  };

  it("source=global 且不传模板 props：模板库入口恒在、预设可用；无「另存为模板」「我的模板」", async () => {
    render(
      <SettingCenter
        {...withoutTemplateProps()}
        source="global"
        settings={[{ ...realm, refCount: 0 }]}
      />,
    );

    // 「模板库」入口恒渲染（预设是纯本地能力，与模板能力无关）
    expect(screen.getByText("模板库")).toBeInTheDocument();

    // ⋯ 菜单里没有「另存为模板」——先等一个必有的菜单项出现，确保菜单真渲染过
    fireEvent.click(screen.getByLabelText("更多设定操作"));
    expect(await screen.findByText(/导出为 JSON（全部）/)).toBeInTheDocument();
    expect(screen.queryByText(/另存为模板/)).toBeNull();

    // 打开模板库 → 内置预设区块与「应用到全局库」按钮都在（预设能力恒有）
    fireEvent.click(screen.getByText("模板库"));
    expect(await screen.findByText(/内置预设/)).toBeInTheDocument();
    expect(screen.getAllByText("应用到全局库").length).toBeGreaterThan(0);

    // 「我的模板」整块不渲染：标题 / 空态都不出现
    expect(document.body.textContent).not.toContain("我的模板");
    expect(document.body.textContent).not.toContain("还没有自己的模板");
  });

  it("source=book 且模板 props 齐备：模板库弹窗内出现「我的模板」区块", async () => {
    render(<SettingCenter {...buildProps()} />);
    fireEvent.click(screen.getByText("模板库"));
    expect(await screen.findByText(/内置预设/)).toBeInTheDocument();
    expect(screen.getByText(/我的模板/)).toBeInTheDocument();
    expect(screen.getByText("还没有自己的模板")).toBeInTheDocument();
  });

  it("不传模板 props：body 下不得出现 SaveTemplateModal 的文案", () => {
    render(<SettingCenter {...withoutTemplateProps()} />);
    expect(document.body.textContent).not.toContain("另存为模板");
    expect(document.body.textContent).not.toContain("模板名，如");
    const modalTitles = Array.from(
      document.querySelectorAll(".ant-modal-title"),
    ).map((node) => node.textContent ?? "");
    expect(modalTitles.some((title) => /另存为模板/.test(title))).toBe(false);
  });

  /**
   * 「不提供」要在**类型与源码**上都成立，而不是传个空实现凑。
   *
   * 上一轮 N-04 的病灶就是「传个假的」（`onSaveTemplate={() => {}}`、`templates={[]}`…）。
   * 修模板库门控时曾用 `onDeleteTemplate ?? (() => {})` 兜底 —— 运行期虽不可达
   * （showTemplates=false ⇒ 该区块不渲染），但等于给这条不变量留了个例外。
   * 现在三个模板 prop 已改为**可选**，调用方不传即可；这条源码断言把它钉住，
   * 免得下一轮审计又把 `() => {}` 翻出来。
   */
  it("不传 = 「没给」而非「给了个假的」：index.tsx 不出现空实现回调兜底", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/shared/components/SettingCenter/index.tsx"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    // 去掉注释，避免匹配到记录历史 bug 的说明文字（本仓注释习惯把旧写法原文写在旁边）
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/=>\s*\{\s*\}/);
  });

  it("不传模板 props：空态 CTA「套用内置预设」仍渲染（预设能力恒有）", () => {
    render(<SettingCenter {...withoutTemplateProps()} settings={[]} />);
    expect(screen.getByText("先新建一个设定分类")).toBeInTheDocument();
    expect(screen.getByText("套用内置预设")).toBeInTheDocument();
  });

  it("传全模板 props：动作区「另存为模板」菜单项与 SaveTemplateModal 都在", async () => {
    render(<SettingCenter {...buildProps()} />);
    expect(screen.getByText("模板库")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("更多设定操作"));
    const saveItem = await screen.findByRole("menuitem", { name: /另存为模板/ });
    fireEvent.click(saveItem);
    expect(await screen.findByLabelText("模板名")).toBeInTheDocument();
  });
});
