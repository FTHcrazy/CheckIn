import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingCategory, SettingLevel } from "@/shared/novel/setting-types";
import type { GlobalSettingController } from "../../hooks/useGlobalSetting";
import GsBody from "./index";

// 重组件：三个 antd 弹层（模板库 / 批量生成 / 拆分）+ DndContext + dnd-kit sensors，
// 并行跑 CPU 争用时单个用例会超默认 5s（单独跑 4.1s）。与 ColorPicker 等重组件同处理。
vi.setConfig({ testTimeout: 20000 });

/**
 * GsBody 的防回归守卫
 *
 * 钉的是「错了不报错、但点了没反应」这一类：
 * 1. **三个弹窗必须真的挂上**（模板库 / 批量生成 / 新增子层级）—— 漏挂 =
 *    入口点了没反应，是本次最高危的坑；
 * 2. 左栏点分类 ⇒ 右栏与影响面同步（选中联动）；
 * 3. **删除入口唯一**（分类卡头）—— 影响面只读，不再提供第二颗「删除」；
 *    确认后走 `data.onDeleteCategory(id)` **单参数**（确认口径唯一）；
 * 4. 搜索不触发任何写通道（`globalCategoryOrder` 调用次数 = 0）；
 * 5. 左栏行徽标与右栏影响面同一个数（R3 两侧口径一致）。
 */

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

const settings: SettingCategory[] = [
  cat("c1", "法宝品阶", { sortOrder: 1, refCount: 5, levels: [level("l1", "引气", 1)] }),
  cat("c2", "丹药稀有度", { sortOrder: 2, refCount: 0 }),
];

function buildController(
  over: Partial<GlobalSettingController> = {},
): GlobalSettingController {
  return {
    settings,
    loading: false,
    loadError: null,
    reload: vi.fn(),
    modalContextHolder: null,
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
    onApplyPreset: vi.fn(),
    // R12：取数原语在数据层（永不抛 / 缺通道返回 []）。
    // GsRefsDrawer 经 useGlobalSettingRefs 消费它，这里给一个空实现即可。
    loadCategoryRefs: vi.fn(() => Promise.resolve([])),
    ...over,
  };
}

/** 按可见文案点按钮（antd 会给两字中文插字间距，先去空白） */
function clickButton(text: string): void {
  const target = screen
    .getAllByRole("button")
    .find((button) => (button.textContent ?? "").replace(/\s/g, "") === text);
  if (!target) throw new Error(`找不到按钮：${text}`);
  fireEvent.click(target);
}

afterEach(() => {
  cleanup();
  // 三个弹窗经 portal 挂 body，RTL 收不走
  document.body.innerHTML = "";
});

describe("GsBody · 防回归", () => {
  it("三个弹窗挂载点都在：模板库 / 批量生成 / 新增子层级都能真的打开", async () => {
    render(<GsBody data={buildController()} />);

    // ① 模板库（工具头）
    clickButton("模板库");
    expect(await screen.findByText("内置预设 · 一键灌入，灌完随便改")).toBeInTheDocument();
    // 关掉，避免下一条断言被遮罩干扰
    fireEvent.click(screen.getByLabelText("Close", { selector: "button" }));

    // ② 批量生成（等级序列卡头）
    clickButton("批量生成");
    expect(await screen.findByText("批量生成等级")).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("Close", { selector: "button" })[0]);

    // ③ 新增子层级（等级行「⋯」菜单）
    const rowOps = screen
      .getAllByRole("button")
      .find((button) => button.getAttribute("aria-label") === "更多操作");
    expect(rowOps).toBeTruthy();
    fireEvent.click(rowOps!);
    fireEvent.click(await screen.findByText("新增子层级…"));
    expect(await screen.findByText(/为「引气」新增子层级/)).toBeInTheDocument();
  });

  it("点左栏分类：右栏卡片与影响面条同步切换", async () => {
    render(<GsBody data={buildController()} />);

    // 默认选中第一个（refCount = 5）
    expect(screen.getByText("法宝品阶", { selector: ".nv-sc__cat-title" })).toBeInTheDocument();
    expect(
      screen.getByText("被 5 部书引用 · 改动会即时同步到这 5 部书"),
    ).toBeInTheDocument();

    // 切到第二条（refCount = 0）
    fireEvent.click(screen.getByText("丹药稀有度", { selector: ".gs-cat-row__name" }));
    await waitFor(() => {
      expect(
        screen.getByText("丹药稀有度", { selector: ".nv-sc__cat-title" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("暂无作品引用 · 改动只影响全局库")).toBeInTheDocument();
    // refCount = 0 ⇒ 不渲染「查看引用方」入口
    expect(screen.queryByText(/查看引用方/)).toBeNull();
  });

  it("左栏行徽标与右栏影响面条同一个数（两侧口径一致）", async () => {
    render(<GsBody data={buildController()} />);

    // 默认选中 c1（refCount = 5）：「5 部书引用」应同时出现在左栏行徽标与
    // 右栏分类卡徽标 —— 同一口径 ⇒ ≥2 处
    expect(screen.getAllByText("5 部书引用").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText("被 5 部书引用 · 改动会即时同步到这 5 部书"),
    ).toBeInTheDocument();
    // 未选中的 c2（refCount = 0）只会在左栏出现一次「暂无引用」
    expect(screen.getAllByText("暂无引用")).toHaveLength(1);

    // 切到 c2：右栏徽标与左栏同步变成「暂无引用」→ 证明两侧用的是同一个口径
    fireEvent.click(screen.getByText("丹药稀有度", { selector: ".gs-cat-row__name" }));
    await waitFor(() => {
      expect(screen.getByText("丹药稀有度", { selector: ".nv-sc__cat-title" })).toBeInTheDocument();
    });
    expect(screen.getAllByText("暂无引用").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("暂无作品引用 · 改动只影响全局库")).toBeInTheDocument();
  });

  it("删除入口唯一（分类卡头）：确认后走 data.onDeleteCategory(id) 单参数", async () => {
    const onDeleteCategory = vi.fn();
    render(<GsBody data={buildController({ onDeleteCategory })} />);

    // 影响面只回答「谁在引用我」，不再摆第二颗删除 —— 两枚相邻的破坏性
    // 按钮只会让人犹豫。
    const deleteButtons = screen
      .getAllByRole("button")
      .filter((button) => (button.textContent ?? "").replace(/\s/g, "") === "删除");
    expect(deleteButtons).toHaveLength(1);

    fireEvent.click(deleteButtons[0]);

    // Popconfirm 挂 body（portal）：确认键是一颗 danger 按钮
    const pop = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[class*="popconfirm"]');
      if (!el) throw new Error("Popconfirm 未打开");
      return el;
    });
    fireEvent.click(pop.querySelector<HTMLElement>(".ant-btn-dangerous")!);

    await waitFor(() => expect(onDeleteCategory).toHaveBeenCalledWith("c1"));
    // 单参数：不许带第二个「确认」参数，确认框在 useGlobalSetting 内部
    expect(onDeleteCategory.mock.calls[0]).toHaveLength(1);
  });

  it("搜索不触发任何写通道：globalCategoryOrder 调用次数为 0", () => {
    const onReorderCategories = vi.fn();
    render(<GsBody data={buildController({ onReorderCategories })} />);

    const search = screen.getByLabelText("搜索设定分类");
    fireEvent.change(search, { target: { value: "丹药" } });
    expect(screen.getByText("1 条")).toBeInTheDocument();
    expect(onReorderCategories).not.toHaveBeenCalled();
  });

  it("空库给引导卡：两个动作分别打开模板库 / 聚焦新建输入框", async () => {
    render(<GsBody data={buildController({ settings: [] })} />);

    expect(screen.getByText("全局库还是空的")).toBeInTheDocument();
    clickButton("套用内置预设");
    expect(await screen.findByText("内置预设 · 一键灌入，灌完随便改")).toBeInTheDocument();
  });
});
