import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RealmModule from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import { DEFAULT_UI_PREFS, type PackLevelSystem } from "../../types";

/**
 * 境界「阶内进位」（报障回归）。
 *
 * 报障现象是「点了没反应」：按钮调 `writeRealm(pos, "pack", { delta: 1 })` 时
 * 漏了 `carry: true`，而写入口按 `options.carry` 分支 —— 缺了就只做 clamp，
 * 位置原样返回（却仍然 mutate + 弹 toast）。这里把「必须进位」钉在 UI 层。
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
const subButton = (): HTMLButtonElement =>
  screen.getByText("阶内进位").closest("button") as HTMLButtonElement;

describe("RealmModule —— 阶内进位（报障回归）", () => {
  afterEach(cleanup);

  it("点「阶内进位」必须带 carry: true（漏了就点不动）", () => {
    const api = makeApi();
    render(<RealmModule api={api} />);

    fireEvent.click(subButton());

    expect(api.writeRealm).toHaveBeenCalledTimes(1);
    const [, origin, options] = (api.writeRealm as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, string, { carry?: boolean; delta?: number }];
    expect(origin).toBe("pack");
    expect(options.carry).toBe(true);
    expect(options.delta).toBe(1);
  });

  it("已在顶阶最后一层时置灰，并说明原因（不再是「点了没反应」）", () => {
    const api = makeApi({ realmPos: { index: 1, sub: 3 } });
    render(<RealmModule api={api} />);
    expect(subButton()).toBeDisabled();
    expect(subButton().getAttribute("title")).toContain("最高阶");
  });

  it("非顶阶时可按，title 说明它会自动进位", () => {
    const api = makeApi({ realmPos: { index: 0, sub: 2 } });
    render(<RealmModule api={api} />);
    expect(subButton()).not.toBeDisabled();
    expect(subButton().getAttribute("title")).toContain("进位");
  });

  it("小层数 = 1 时不渲染小层区（没有「阶内」可言）", () => {
    const api = makeApi({
      rungs: [{ id: "l1", name: "炼气", rank: 1, subLevels: 1, power: null }],
      realmPos: { index: 0, sub: 1 },
    });
    render(<RealmModule api={api} />);
    expect(screen.queryByText("阶内进位")).toBeNull();
    expect(screen.queryByText("小层")).toBeNull();
  });
});
