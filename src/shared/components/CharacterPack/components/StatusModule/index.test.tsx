import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StatusModule from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import { DEFAULT_UI_PREFS, type PackAttrValue, type PackAttribute, type PackModifier } from "../../types";

/**
 * 状态效果行内编辑（1.39.1 重写后）。
 *
 * 剩余回合 / 持续时间 / 消耗这些时效概念已整体下线（语义由作者写进备注），
 * 行内只剩：名称、性质、目标属性、运算、数值与开关。这一组钉的是：
 *  - 回合输入框**彻底不再出现**（旧数据里残留的 roundsLeft 也不许把它召回来）；
 *  - 预览文案与「未开启」标注仍然准确。
 */

function attr(partial: Partial<PackAttribute> = {}): PackAttribute {
  return {
    id: "a1",
    characterId: "c1",
    groupName: "基础属性",
    name: "气血",
    defaultValue: 100,
    baseValue: 100,
    decimals: 0,
    unit: "",
    sortOrder: 1,
    updatedAt: 0,
    ...partial,
  };
}

/** 数值行（角色级实例）：doc.attributes 里存的是这个；视图行 id 恒等于 defId */
function val(partial: Partial<PackAttrValue> = {}): PackAttrValue {
  return {
    id: "v-a1",
    characterId: "c1",
    defId: "a1",
    baseValue: 100,
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
    duration: "",
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
      displayName: "主角",
      avatar: "",
      isProtagonist: true,
      entityId: "",
      realmAt: "",
      note: "",
      sortOrder: 1,
    },
    attrDefs: [],
    attributes: [val()],
    mappings: [],
    slots: [],
    groups: [],
    categories: [],
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
    attrView: [attr()],
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

describe("StatusModule —— 行内编辑（时效概念已下线）", () => {
  afterEach(cleanup);

  it("不再出现剩余回合输入框 —— 旧数据带 roundsLeft 也一样", () => {
    render(<StatusModule api={makeApi({ statuses: [mod({ roundsLeft: 3 })] })} />);
    expect(screen.queryByLabelText("剩余回合")).toBeNull();
    expect(screen.queryByText(/剩余回合/)).toBeNull();
  });

  it("预览行给出属性加成文案；持续型未开启时带「（未开启）」标注", () => {
    const { unmount } = render(<StatusModule api={makeApi()} />);
    const preview = document.querySelector(".cpk-stt__preview") as HTMLElement;
    expect(preview.textContent).toContain("气血 -10");
    unmount();

    render(
      <StatusModule api={makeApi({ statuses: [mod({ active: false })] })} />,
    );
    const off = document.querySelector(".cpk-stt__preview") as HTMLElement;
    expect(off.textContent).toContain("（未开启）");
  });

  it("目标属性为空时提示「暂不参与汇总」而不是渲染 undefined", () => {
    render(<StatusModule api={makeApi({ statuses: [mod({ targetAttrId: "" })] })} />);
    expect(screen.getByText(/未选择属性，暂不参与汇总/)).toBeInTheDocument();
  });
});
