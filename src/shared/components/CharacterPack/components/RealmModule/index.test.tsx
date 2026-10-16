import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RealmModule from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import { DEFAULT_UI_PREFS, type PackLevelSystem } from "../../types";

/**
 * 境界台阶推进（报障回归 + 控件去重）。
 *
 * ── 报障一的成因 ──
 * 曾经的「阶内进位」按钮调 `writeRealm(pos, "pack", { delta: 1 })` 时漏了
 * `carry: true`，而写入口按 `options.carry` 分支 —— 缺了就只做 clamp，
 * 位置原样返回（却仍然 mutate + 弹 toast），观感是「点了没反应」。
 *
 * ── 报障二的成因（本文件新增的结论）──
 * 「阶内进位」与上一行的「+ 1 层」调的是**同一个 writeRealm 入参**
 * （`{ carry: true, delta: 1 }`）—— 两颗按钮做同一件事。
 * 且「阶内进位」这名字暗示「满层后跨越到下一阶」，与实际行为（推进一小层）
 * 不符，是误解的来源。去重时**删「阶内进位」、留 stepper**：
 * stepper 有一对加减、覆盖两个方向，删掉只有加的「阶内进位」不损失能力。
 */

vi.mock("@/shared/services/novel-shared", () => ({
  fetchPackBindableEntities: vi.fn(async () => []),
  logUsageEvent: vi.fn(async () => undefined),
}));

const LEVELS: PackLevelSystem = {
  id: "ls1",
  workId: "w1",
  name: "境界",
  rungs: [
    { id: "l1", name: "炼气", rank: 1, subLevels: 3, power: 100 },
    { id: "l2", name: "元婴", rank: 2, subLevels: 3, power: 1000 },
  ],
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
    rungs: LEVELS.rungs,
    realmPos: { index: 1, sub: 1 },
    panelRealmText: "元婴 1/3",
    realmText: "元婴 1/3",
    realmHint: "",
    prefs: { ...DEFAULT_UI_PREFS, collapsed: {} },
    toggleModuleCollapsed: vi.fn(),
    writeRealm: vi.fn(),
    bindEntity: vi.fn(),
    openRealmSettingCenter: vi.fn(),
    showToast: vi.fn(),
    ...over,
  } as unknown as PackPanelApi;
}

/** antd 的 Button 把文案包在 <span> 里 —— 要断言禁用 / title 得取外层 <button> */
const upButton = (): HTMLButtonElement =>
  screen.getByText("+ 1 层").closest("button") as HTMLButtonElement;
const downButton = (): HTMLButtonElement =>
  screen.getByText("− 1 层").closest("button") as HTMLButtonElement;

type WriteCall = [unknown, string, { carry?: boolean; delta?: number }?];
const callsOf = (api: PackPanelApi) =>
  (api.writeRealm as unknown as ReturnType<typeof vi.fn>).mock.calls as WriteCall[];

describe("RealmModule —— 台阶推进带 carry（报障回归）", () => {
  afterEach(cleanup);

  it("点「+ 1 层」必须带 carry: true（漏了就点不动）", () => {
    const api = makeApi();
    render(<RealmModule api={api} />);

    fireEvent.click(upButton());

    expect(api.writeRealm).toHaveBeenCalledTimes(1);
    const [, origin, options] = callsOf(api)[0];
    expect(origin).toBe("pack");
    expect(options?.carry).toBe(true);
    expect(options?.delta).toBe(1);
  });

  it("点「− 1 层」同样带 carry: true，delta 为 -1", () => {
    const api = makeApi({ realmPos: { index: 1, sub: 2 } });
    render(<RealmModule api={api} />);

    fireEvent.click(downButton());

    const [, , options] = callsOf(api)[0];
    expect(options?.carry).toBe(true);
    expect(options?.delta).toBe(-1);
  });
});

describe("RealmModule —— 台阶推进的边界（到头一律显式置灰）", () => {
  afterEach(cleanup);

  it("已在顶阶最后一层时「+ 1 层」置灰，并说明原因", () => {
    const api = makeApi({ realmPos: { index: 1, sub: 3 } });
    render(<RealmModule api={api} />);
    expect(upButton()).toBeDisabled();
    expect(upButton().getAttribute("title")).toContain("最高阶");
  });

  it("已在第一阶第一层时「− 1 层」置灰，并说明原因", () => {
    const api = makeApi({ realmPos: { index: 0, sub: 1 } });
    render(<RealmModule api={api} />);
    expect(downButton()).toBeDisabled();
    expect(downButton().getAttribute("title")).toContain("第一阶第一层");
  });

  it("非边界时两颗都可按，title 说明会自动跨阶", () => {
    const api = makeApi({ realmPos: { index: 0, sub: 2 } });
    render(<RealmModule api={api} />);
    expect(upButton()).not.toBeDisabled();
    expect(downButton()).not.toBeDisabled();
    expect(upButton().getAttribute("title")).toContain("进位");
    expect(downButton().getAttribute("title")).toContain("退位");
  });
});

describe("RealmModule —— 空态分层引导（UI-03）", () => {
  afterEach(cleanup);

  it("无等级体系：给「去设定中心创建」按钮，点击触发跨窗口导航", () => {
    const api = makeApi({ rungs: [] });
    render(<RealmModule api={api} />);

    const cta = screen.getByText("去设定中心创建").closest("button") as HTMLButtonElement;
    expect(cta).toBeTruthy();
    fireEvent.click(cta);
    expect(api.openRealmSettingCenter).toHaveBeenCalledTimes(1);
  });

  it("空态文案不再出现过期术语「设定 → 等级体系」", () => {
    const api = makeApi({ rungs: [] });
    const { container } = render(<RealmModule api={api} />);
    expect(container.textContent).not.toContain("设定 → 等级体系");
    expect(container.textContent).toContain("设定中心");
  });

  it("未绑定主角：出现「设为主角」按钮，点击展开选择器", () => {
    const api = makeApi(); // doc.character.entityId = ""
    render(<RealmModule api={api} />);
    const cta = screen.getByText("设为主角").closest("button") as HTMLButtonElement;
    expect(cta).toBeTruthy();
    // 候选人默认空（mock 返回 []）→ 按钮置灰并说明原因，避免点了没反应
    expect(cta).toBeDisabled();
    expect(cta.getAttribute("title")).toContain("要素");
  });

  it("已绑定主角：不再出现「设为主角」引导按钮", () => {
    const api = makeApi({
      doc: { ...doc, character: { ...doc.character, entityId: "e1" } },
    });
    render(<RealmModule api={api} />);
    expect(screen.queryByText("设为主角")).toBeNull();
  });
});

/**
 * 去重：不许再有第二颗做同一件事的按钮。
 *
 * 这条是**反向断言** —— 钉住「阶内进位」不会以任何形式回来。
 * 它曾经与「+ 1 层」调同一个入参（`{ carry: true, delta: 1 }`），
 * 且名字暗示的是「满层跨阶」而实际只推进一小层。
 */
describe("RealmModule —— 阶内进度条是纯读数，不挂动作按钮", () => {
  afterEach(cleanup);

  it("界面上没有「阶内进位」（它与「+ 1 层」重合）", () => {
    const api = makeApi();
    render(<RealmModule api={api} />);
    expect(screen.queryByText("阶内进位")).toBeNull();
  });

  it("进度条那一行里除条与标签外没有按钮", () => {
    const api = makeApi({ realmPos: { index: 1, sub: 2 } });
    render(<RealmModule api={api} />);
    const progress = document.querySelector(".cpk-rlm__progress");
    expect(progress).not.toBeNull();
    expect(progress?.querySelectorAll("button")).toHaveLength(0);
    // 读数本身还在（删按钮不等于删读数）
    expect(screen.getByText("阶内 2 / 3")).toBeInTheDocument();
  });

  it("整块境界里做「推进」的按钮只有一对（+1 / −1）", () => {
    const api = makeApi({ realmPos: { index: 1, sub: 2 } });
    render(<RealmModule api={api} />);
    const stepper = document.querySelector(".cpk-rlm__stepper");
    expect(stepper?.querySelectorAll("button")).toHaveLength(2);
  });

  it("小层数 = 1 时不渲染小层区（没有「阶内」可言）", () => {
    const api = makeApi({
      rungs: [{ id: "l1", name: "炼气", rank: 1, subLevels: 1, power: null }],
      realmPos: { index: 0, sub: 1 },
    });
    render(<RealmModule api={api} />);
    expect(document.querySelector(".cpk-rlm__progress")).toBeNull();
    expect(screen.queryByText("小层")).toBeNull();
  });
});

describe("RealmModule —— 阶设置弹窗已删，图标只给 hover 提示（1.41.0）", () => {
  afterEach(cleanup);

  it("问号图标带 aria-label，悬停提示指引去设定中心（不再点击弹 toast）", () => {
    const api = makeApi();
    render(<RealmModule api={api} />);

    const hint = screen.getByLabelText("境界层级去哪里设置？");
    // 1.41.0：齿轮（onClick toast）换成问号（Tooltip hover）—— 提示应该在
    // Tooltip 里而不是点击回调里
    expect(hint.tagName).toBe("BUTTON");
    expect(api.showToast).not.toHaveBeenCalled();
    fireEvent.click(hint);
    expect(api.showToast).not.toHaveBeenCalled();
    expect(document.querySelector(".ant-modal-wrap")).toBeNull();
  });

  it("弹窗已删：界面上不存在「阶设置（与实体面板共享同一张表）」标题", () => {
    const api = makeApi();
    render(<RealmModule api={api} />);
    expect(screen.queryByText(/阶设置/)).toBeNull();
  });
});

/**
 * 小层名并入主文案（REQ-051/052，1.4x）：小层名不再单独挂一枚别名 chip，
 * 而是由 `formatRealm` 合成进 `realmText`（`筑基 * 初期 1/4`）。
 * 头部只渲染 `api.realmText` 一处 —— 这个 describe 钉住「不再有第二枚 chip」，
 * 防止回归时又长出一份与主文案重复的小层名。
 */
describe("RealmModule —— 头部小层名（已并入 realmText）", () => {
  afterEach(cleanup);

  const rungsWithLabels = [
    {
      id: "l1",
      name: "炼气",
      rank: 1,
      subLevels: 3,
      power: null,
      // 纯数字小层：没有拆出子层级，没有别名表
    },
    {
      id: "l2",
      name: "元婴",
      rank: 2,
      subLevels: 3,
      power: null,
      hasChildren: true,
      subLabels: ["", "中期", "圆满"],
    },
  ];

  it("带小层名的主文案原样渲染，且不再有独立的别名 chip", () => {
    const api = makeApi({
      rungs: rungsWithLabels,
      realmPos: { index: 1, sub: 3 },
      realmText: "元婴 * 圆满 3/3",
    });
    render(<RealmModule api={api} />);
    expect(screen.getByText("元婴 * 圆满 3/3")).toBeInTheDocument();
    expect(document.querySelector(".cpk-rlm__alias")).toBeNull();
  });

  it("纯数字小层（未拆子层级）只有阶名与进度，也不挂 chip", () => {
    const api = makeApi({
      rungs: rungsWithLabels,
      realmPos: { index: 0, sub: 2 },
      realmText: "炼气 2/3",
    });
    render(<RealmModule api={api} />);
    expect(screen.getByText("炼气 2/3")).toBeInTheDocument();
    expect(document.querySelector(".cpk-rlm__alias")).toBeNull();
  });
});

/**
 * 阶设置弹窗的回归史（1.39.1 弹窗整体删除，这一段留作「为什么删」的注脚）：
 * 先是 × 关不掉（onCancel 漏传），后是空表「没有实际作用」，最终判定
 * 这个弹窗本身就不该存在 —— 层级编辑统一收进设定中心，行囊只读。
 * 上面的 describe 钉住「齿轮只给指引、不再弹窗」。
 */

/**
 * UI-02：阶 + 小层两条直选路径。
 *
 * 目标：选定「阶 + 小层」≤ 2 次点击，全程不离开行囊窗口。
 */
describe("RealmModule —— 小层直选（UI-02）", () => {
  afterEach(cleanup);

  it("层号条给出 1..N 可点按钮，当前层 aria-current", () => {
    const api = makeApi({ realmPos: { index: 1, sub: 2 } });
    render(<RealmModule api={api} />);
    const nums = document.querySelectorAll(".cpk-rlm__subnum");
    expect(nums).toHaveLength(3);
    // 第 2 层选中
    expect(nums[1].getAttribute("aria-current")).toBe("true");
    expect(nums[1].getAttribute("aria-label")).toBe("元婴 第 2 层");
  });

  it("点第 3 层 → 同阶内跳层（index 不变，sub=3），且不带动画式进位", () => {
    const api = makeApi({ realmPos: { index: 1, sub: 1 } });
    render(<RealmModule api={api} />);
    fireEvent.click(document.querySelectorAll(".cpk-rlm__subnum")[2]);

    const [position, origin, options] = callsOf(api)[0];
    expect(origin).toBe("pack");
    expect(position).toEqual({ index: 1, sub: 3 });
    // 直选不做 carry（夹取由 setRealm 兜底）：options 可省略，或未带 carry
    expect(options?.carry).toBeFalsy();
  });

  it("小层数 > 12 时层号条改下拉（13 层不排一行按钮）", () => {
    const api = makeApi({
      rungs: [{ id: "l0", name: "炼气", rank: 1, subLevels: 13, power: null }],
      realmPos: { index: 0, sub: 1 },
    });
    render(<RealmModule api={api} />);
    // 下拉路径：不再渲染 13 颗按钮
    expect(document.querySelectorAll(".cpk-rlm__subnum")).toHaveLength(0);
    expect(document.querySelector(".cpk-rlm__subbar")).not.toBeNull();
  });

  it("小层数 = 1 时整块层号区（含「小层」标签）不渲染", () => {
    const api = makeApi({
      rungs: [{ id: "l1", name: "炼气", rank: 1, subLevels: 1, power: null }],
      realmPos: { index: 0, sub: 1 },
    });
    render(<RealmModule api={api} />);
    expect(document.querySelector(".cpk-rlm__subbar")).toBeNull();
    expect(screen.queryByText("小层")).toBeNull();
  });
});

describe("RealmModule —— 阶直选下拉（UI-02）", () => {
  afterEach(cleanup);

  it("阶数 ≤ 8 仍走阶梯 chip 行（不出现阶下拉）", () => {
    const api = makeApi();
    render(<RealmModule api={api} />);
    expect(document.querySelector(".cpk-rlm__ladder")).not.toBeNull();
    expect(document.querySelector(".cpk-rlm__rungdrop")).toBeNull();
  });

  it("阶数 > 8 时 chip 行让位给下拉", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `l${i}`,
      name: `阶${i + 1}`,
      rank: i + 1,
      subLevels: 3,
      power: null,
    }));
    const api = makeApi({ rungs: many, realmPos: { index: 0, sub: 1 } });
    render(<RealmModule api={api} />);
    expect(document.querySelector(".cpk-rlm__ladder")).toBeNull();
    expect(document.querySelector(".cpk-rlm__rungdrop")).not.toBeNull();
  });
});
