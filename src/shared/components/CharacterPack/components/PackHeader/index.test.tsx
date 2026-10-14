import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PackHeader from "./index";

/**
 * 保存条三态 + 失败态逃生出口（G-3 / G-4 / REQ-045）
 *
 * 这一组的核心是**「保存失败时不能只有一句抱歉」**：面板存不进去时，
 * 作者唯一能救回那半小时改动的方式是把草稿整份导出成 JSON。
 * 而这个入口只在失败态出现 —— 常驻的话它和 REQ-030 的模块级 Markdown 导出
 * 会在同一个面板里共存，作者分不清哪个是给人读的、哪个是给机器读的。
 *
 * 头部已从「三层堆叠」改成「一条横向概览带」：三态现在是**整条带的底色**
 * （`.cpk-head.is-*`）+ 一段按钮前的状态文字（`.cpk-savebar__state`），
 * 不再是独立的 `.cpk-savebar` 条 —— 断言跟着改，语义不变。
 */

function props(over: Partial<Parameters<typeof PackHeader>[0]> = {}) {
  const onExportDraft = vi.fn();
  const base: Parameters<typeof PackHeader>[0] = {
    characterName: "主角",
    realmText: "筑基 1/9",
    realmSubText: "",
    realmHint: "",
    realmBound: false,
    compact: false,
    dirty: 0,
    saving: false,
    saveFailed: false,
    savedAt: 0,
    breathe: false,
    changedCount: 0,
    onMarkAllRead: vi.fn(),
    onRename: vi.fn(),
    onSave: vi.fn(),
    onRevertAll: vi.fn(),
    onExportDraft,
    onOpenModules: vi.fn(),
    onOpenUnitManager: vi.fn(),
    onOpenRecords: vi.fn(),
    ...over,
  };
  return { base, onExportDraft };
}

const exportButton = () => screen.queryByRole("button", { name: /导\s*出\s*草\s*稿/ });
const header = () => document.querySelector(".cpk-head");
const stateText = () => document.querySelector(".cpk-savebar__state");

describe("PackHeader —— 保存条（G-3）", () => {
  afterEach(cleanup);

  it("三态文案互斥：干净 / 脏 / 保存中 / 失败各说各的", () => {
    const { unmount } = render(<PackHeader {...props().base} />);
    expect(header()?.className).toContain("is-idle");
    expect(stateText()?.className).toContain("is-idle");
    expect(stateText()?.textContent).toBe("已保存");
    unmount();

    render(<PackHeader {...props({ dirty: 3 }).base} />);
    expect(header()?.className).toContain("is-dirty");
    expect(stateText()?.textContent).toBe("3 处改动未保存");
  });

  it("「全部已读」只在真有角标时出现（常驻一个无事发生的按钮更让人困惑）", () => {
    const { unmount } = render(<PackHeader {...props().base} />);
    expect(screen.queryByRole("button", { name: /全部已读/ })).toBeNull();
    unmount();

    render(<PackHeader {...props({ changedCount: 2 }).base} />);
    expect(screen.getByRole("button", { name: /全部已读/ })).toBeInTheDocument();
  });
});

describe("PackHeader —— 失败态逃生出口（REQ-045）", () => {
  afterEach(cleanup);

  it("干净态与脏态都没有「导出草稿」（它不是常规导出）", () => {
    render(<PackHeader {...props().base} />);
    expect(exportButton()).toBeNull();
    cleanup();
    render(<PackHeader {...props({ dirty: 4 }).base} />);
    expect(exportButton()).toBeNull();
  });

  it("失败态出现，点了就把草稿整份导出；主按钮变成「重试」", () => {
    const { base, onExportDraft } = props({ saveFailed: true, dirty: 4 });
    render(<PackHeader {...base} />);

    const button = exportButton();
    expect(button).toBeInTheDocument();
    fireEvent.click(button as HTMLElement);
    expect(onExportDraft).toHaveBeenCalledTimes(1);
    // 失败时不该出现「保存失败」+「保存 (4)」这种自相矛盾的组合
    expect(screen.getByRole("button", { name: /重\s*试/ })).toBeInTheDocument();
  });

  it("失败态下「撤销全部」让位给逃生出口（此刻最怕的是误撤掉那半小时）", () => {
    render(<PackHeader {...props({ saveFailed: true, dirty: 4 }).base} />);
    expect(screen.queryByRole("button", { name: /撤销全部/ })).toBeNull();
  });
});

/**
 * 窄档紧凑模式（<600px）：工具收进「更多」。
 *
 * 小窗下把「盘点记录 / 量纲 / 模块管理」三个图标摊平，
 * 会和保存态抢同一行的宽度 —— 实测结果是身份区被挤到 0 宽、
 * 「全部已读」被裁出右边界。收进菜单是**主动让位**：
 * 留白比留一排点不到的按钮重要（点不到的按钮比藏起来的更糟）。
 *
 * 两个方向都要钉住：紧凑档只能有一个入口按钮、且不能出现平铺的工具条；
 * 宽档反过来 —— 一排图标点起来比展开菜单快，空间够用时不该留着菜单。
 *
 * 头部**没有**关闭按钮（2026-10 用户报障）：窗口自己有关闭按钮、Esc 也能关，
 * 再摆一枚「×」是第三个重复入口，且紧挨着「模块管理」，误点即关窗。
 * 这条同时钉窄档菜单里也不许再出现「关闭行囊」。
 */
describe("PackHeader —— 窄档工具收进「更多」", () => {
  afterEach(cleanup);

  it("compact 时工具不出现，只有一个「更多」入口", () => {
    render(<PackHeader {...props({ compact: true }).base} />);
    // 平铺工具条整块不渲染
    expect(document.querySelector(".cpk-head__tools")).toBeNull();
    // 宽档那三个图标按钮都不在
    const titles = Array.from(document.querySelectorAll(".cpk-iconbtn")).map(
      (node) => node.getAttribute("title"),
    );
    expect(titles).not.toContain("盘点记录 / 与本章初对比");
    expect(titles).not.toContain("量纲设置（货币 / 熟练度）");
    expect(titles).not.toContain("模块管理");
    // 唯一保留的是「更多」
    expect(titles).toEqual(["更多"]);
  });

  it("compact 时次要文字动作也收进菜单，不留在外面被压成碎片", () => {
    // 脏态 + 有角标：宽档会出现「全部已读」「撤销全部」两个按钮
    render(<PackHeader {...props({ compact: true, dirty: 2, changedCount: 3 }).base} />);
    const ops = document.querySelector(".cpk-head__ops");
    // 留在 ops 里的文字按钮一个都没有；只剩保存态 pill + 保存 + 更多
    const inlineTextButtons = Array.from(ops?.querySelectorAll(".cpk-btn.ghost") ?? []);
    expect(inlineTextButtons).toHaveLength(0);
    // 「保存」还在，且带着改动数
    expect(screen.getByRole("button", { name: /保存 \(2\)/ })).toBeInTheDocument();
  });

  it("宽档（compact=false）保持三个工具平铺，不出「更多」", () => {
    render(<PackHeader {...props({ compact: false }).base} />);
    expect(document.querySelector(".cpk-head__tools")).not.toBeNull();
    const titles = Array.from(document.querySelectorAll(".cpk-iconbtn")).map(
      (node) => node.getAttribute("title"),
    );
    expect(titles).toEqual([
      "盘点记录 / 与本章初对比",
      "量纲设置（货币 / 熟练度）",
      "模块管理",
    ]);
    expect(titles).not.toContain("更多");
  });

  it("宽档下次要文字按钮仍平铺（空间够用时不该藏进菜单）", () => {
    render(<PackHeader {...props({ compact: false, dirty: 2, changedCount: 3 }).base} />);
    expect(screen.getByRole("button", { name: /全部已读/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /撤销全部/ })).toBeInTheDocument();
  });

  it("compact 下「保存」主按钮仍然可达（工具让位不许把操作区一起收走）", () => {
    render(<PackHeader {...props({ compact: true, dirty: 2 }).base} />);
    expect(screen.getByRole("button", { name: /保\s*存/ })).toBeInTheDocument();
  });

  it("两档都不出现关闭按钮（窗口自身有关闭按钮，Esc 也能关，不该有第三个入口）", () => {
    const { unmount } = render(<PackHeader {...props({ compact: false }).base} />);
    expect(screen.queryByRole("button", { name: /关闭/ })).toBeNull();
    unmount();

    render(<PackHeader {...props({ compact: true }).base} />);
    expect(screen.queryByRole("button", { name: /关闭/ })).toBeNull();
  });
});

/**
 * 头像必须是图标而不是 emoji。
 *
 * 一度用 🧑 当头像：它跟着系统字体渲染，在 Windows 上是彩色表情，
 * 与整块中性配色打架，暗色主题下尤其突兀（AGENTS.md §6.1 明确不用 emoji 当图标）。
 */
describe("PackHeader —— 头像不用 emoji", () => {
  afterEach(cleanup);

  it("头像容器里没有 emoji 字符，用的是 antd 图标", () => {
    render(<PackHeader {...props().base} />);
    const avatar = document.querySelector(".cpk-head__avatar");
    expect(avatar).not.toBeNull();
    expect(avatar?.querySelector(".anticon")).not.toBeNull();
    // 任何 emoji 区段的字符都不该出现在头部里
    expect(header()?.textContent ?? "").not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

/**
 * 小境界别名 chip（1.41.0）：头部此前只显示「合体 2/4」，与境界模块的
 * 「合体 2/4 · 中期」不同口径。同源数据两处读数必须一致 —— 要么都带名，
 * 要么都不带。空串（纯数字小层 / 未配置）不渲染。
 */
describe("PackHeader —— 头部小境界别名", () => {
  afterEach(cleanup);

  it("realmSubText 有值时在境界 chip 旁显示别名", () => {
    render(<PackHeader {...props({ realmText: "合体 2/4", realmSubText: "中期" }).base} />);
    const sub = document.querySelector(".cpk-head__sub");
    expect(sub?.textContent).toBe("中期");
  });

  it("realmSubText 为空串时不渲染（不出现空 chip）", () => {
    render(<PackHeader {...props({ realmSubText: "" }).base} />);
    expect(document.querySelector(".cpk-head__sub")).toBeNull();
  });
});

