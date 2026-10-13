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
    weightLimit: 0,
    capacityLimit: 0,
    note: "",
    sortOrder: 1,
  },
  attributes: [],
  attrDefs: [],
  mappings: [],
  slots: [],
  groups: [],
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
    setRungMeta: vi.fn(),
    ...over,
  } as unknown as PackPanelApi;
}

/** antd 的 Button 把文案包在 <span> 里 —— 要断言禁用 / title 得取外层 <button> */
const upButton = (): HTMLButtonElement =>
  screen.getByText("+ 1 层").closest("button") as HTMLButtonElement;
const downButton = (): HTMLButtonElement =>
  screen.getByText("− 1 层").closest("button") as HTMLButtonElement;

type WriteCall = [unknown, string, { carry?: boolean; delta?: number }];
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
    expect(options.carry).toBe(true);
    expect(options.delta).toBe(1);
  });

  it("点「− 1 层」同样带 carry: true，delta 为 -1", () => {
    const api = makeApi({ realmPos: { index: 1, sub: 2 } });
    render(<RealmModule api={api} />);

    fireEvent.click(downButton());

    const [, , options] = callsOf(api)[0];
    expect(options.carry).toBe(true);
    expect(options.delta).toBe(-1);
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

describe("RealmModule —— 拆分子层级后的阶设置（父阶=组）", () => {
  afterEach(cleanup);

  it("拆出子层级的阶：小层数锁定（由子层级决定），没拆的照常可改", () => {
    const api = makeApi({
      rungs: [
        { id: "l1", name: "炼气", rank: 1, subLevels: 9, power: null, hasChildren: true },
        { id: "l2", name: "筑基", rank: 2, subLevels: 3, power: null },
      ],
    });
    render(<RealmModule api={api} />);

    fireEvent.click(screen.getByTitle("阶设置（小层数 / 战力当量）"));
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    // 每行两个数字输入：小层 + 当量
    expect(inputs[0].disabled).toBe(true);
    expect(inputs[1].disabled).toBe(false);
    expect(inputs[2].disabled).toBe(false);
  });
});
