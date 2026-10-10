import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StatusModule from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import { DEFAULT_UI_PREFS, type PackAttribute, type PackModifier } from "../../types";

/**
 * 状态效果时效（REQ-025）
 *
 * 这一组钉的是**「过期」的语义边界**，而不是某个 if：
 *  - 回合数只对持续型出现（被动是常驻、释放不进汇总，给它们一个回合输入框
 *    会让作者以为它会自己掉回合）；
 *  - 已过期要**看得见**（文案 + 高亮牌），但**不能翻 `active`** ——
 *    `active` 是作者的开关，工具擅自关掉属于偷偷改设定，而且不可逆。
 */

function attr(partial: Partial<PackAttribute> = {}): PackAttribute {
  return {
    id: "a1",
    characterId: "c1",
    groupName: "基础属性",
    name: "气血",
    baseValue: 100,
    decimals: 0,
    unit: "",
    sortOrder: 1,
    updatedAt: 0,
    ...partial,
  };
}

function mod(partial: Partial<PackModifier> = {}): PackModifier {
  return {
    id: "pm1",
    ownerType: "status",
    ownerId: "c1",
    nature: "sustained",
    name: "中毒",
    targetAttrId: "a1",
    op: "add",
    value: -10,
    valueUnit: "",
    scaleByProficiency: false,
    active: true,
    defaultOn: false,
    cost: "",
    cooldown: null,
    duration: "3 回合",
    roundsLeft: null,
    target: "",
    trigger: "",
    condition: "",
    note: "",
    disabled: false,
    sortOrder: 1,
    ...partial,
  };
}

function makeApi(over: { doc?: Partial<PackDoc>; statuses?: PackModifier[] } = {}) {
  const statuses = over.statuses ?? [mod()];
  const doc: PackDoc = {
    character: {
      id: "c1",
      workId: "w1",
      name: "主角",
      avatar: "",
      isProtagonist: true,
      entityId: "",
      realmAt: "",
      note: "",
      weightLimit: 0,
      capacityLimit: 0,
      sortOrder: 1,
    },
    attributes: [attr()],
    slots: [],
    items: [],
    skills: [],
    modifiers: statuses,
    unitSystems: [],
    layouts: [],
    presets: [],
    realmLink: null,
    ...over.doc,
  };
  return {
    doc,
    statusModifiers: statuses,
    summary: { rows: [], ignoredCast: 0, casts: [], eventOnly: [], expired: [] },
    dirty: 0,
    prefs: { ...DEFAULT_UI_PREFS, collapsed: {} },
    toggleModuleCollapsed: vi.fn(),
    patchPrefs: vi.fn(),
    isRecentlyChanged: () => false,
    addStatus: vi.fn(() => "pm2"),
    updateModifier: vi.fn(),
    removeModifier: vi.fn(),
    toggleModifierActive: vi.fn(),
    openEffectEditor: vi.fn(),
    showToast: vi.fn(),
  } as unknown as PackPanelApi;
}

const roundsInput = () => screen.getByLabelText("剩余回合") as HTMLInputElement;

describe("StatusModule —— 时效（REQ-025）", () => {
  afterEach(cleanup);

  it("持续型才有回合数输入框，被动没有", () => {
    const { unmount } = render(<StatusModule api={makeApi()} />);
    expect(roundsInput()).toBeInTheDocument();
    unmount();

    render(<StatusModule api={makeApi({ statuses: [mod({ nature: "passive" })] })} />);
    expect(screen.queryByLabelText("剩余回合")).toBeNull();
  });

  it("roundsLeft 为 null 时不显示「已过期」，只显示「不限」占位", () => {
    render(<StatusModule api={makeApi()} />);
    expect(document.querySelector(".cpk-stt__preview.is-expired")).toBeNull();
    expect(roundsInput().placeholder).toBe("不限");
    expect(document.querySelector(".cpk-stt.is-expired")).toBeNull();
  });

  it("回合数归零 → 预览行标出「已过期」并高亮（但开关仍是开着的）", () => {
    const api = makeApi({ statuses: [mod({ roundsLeft: 0 })] });
    render(<StatusModule api={api} />);
    const preview = document.querySelector(".cpk-stt__preview") as HTMLElement;
    expect(preview.textContent).toContain("已过期");
    expect(preview.className).toContain("is-expired");
    // ⚠️ 工具不翻 active：这一行仍然是「开着」的状态
    expect(api.updateModifier).not.toHaveBeenCalled();
  });

  it("改回合数写回 roundsLeft；清空即恢复「不限时」", () => {
    const api = makeApi({ statuses: [mod({ roundsLeft: 3 })] });
    render(<StatusModule api={api} />);

    fireEvent.change(roundsInput(), { target: { value: "7" } });
    expect(api.updateModifier).toHaveBeenCalledWith("pm1", { roundsLeft: 7 });

    fireEvent.change(roundsInput(), { target: { value: "" } });
    expect(api.updateModifier).toHaveBeenCalledWith("pm1", { roundsLeft: null });
  });
});
