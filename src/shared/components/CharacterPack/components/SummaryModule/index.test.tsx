import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SummaryModule from "./index";
import EquipDeltaPreview from "../DeltaPreview";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import {
  buildActiveCarriersFrom,
  computeHypotheticalSummary,
  computeSummary,
  summaryDeltas,
} from "../../pack-utils";
import type { PackAttribute, PackItem, PackModifier, PackSlot } from "../../types";

/**
 * 估算模式（REQ-037）与穿戴 Δ 预览（REQ-018）的 DOM 不变量。
 *
 * 数值口径已经在 `pack-utils.test.ts` 里钉过（两者都只是 `computeHypotheticalSummary`
 * 的展示层）。这里只钉**组件结构**上那两条会静默出错的事：
 *  1. 估算编辑器里有 Select / InputNumber —— 它**必须**在行按钮之外。
 *     `<button>` 里套交互控件是无效 HTML，浏览器会把内层控件踢出按钮，
 *     表现成「点了没反应」或「点输入框变成了看明细」。
 *  2. Δ 预览只列真的会变的属性；没变的行不占位。
 */

const attributes: PackAttribute[] = [
  {
    id: "a1",
    characterId: "c1",
    groupName: "战斗属性",
    name: "攻击力",
    baseValue: 100,
    decimals: 0,
    unit: "",
    sortOrder: 1,
    updatedAt: 0,
  },
  {
    id: "a2",
    characterId: "c1",
    groupName: "战斗属性",
    name: "防御力",
    baseValue: 50,
    decimals: 0,
    unit: "",
    sortOrder: 2,
    updatedAt: 0,
  },
];

const slots: PackSlot[] = [
  {
    id: "s1",
    characterId: "c1",
    name: "武器",
    capacity: 1,
    accepts: [],
    enabled: true,
    note: "",
    sortOrder: 1,
  },
];

const items: PackItem[] = [
  {
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
  },
];

const modifiers: PackModifier[] = [
  {
    id: "m1",
    ownerType: "item",
    ownerId: "i1",
    nature: "passive",
    name: "剑锋",
    targetAttrId: "a1",
    op: "add",
    value: 30,
    valueUnit: "",
    scaleByProficiency: false,
    active: false,
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
];

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
  attributes,
  slots,
  items,
  skills: [],
  modifiers,
  unitSystems: [],
  layouts: [],
  presets: [],
  realmLink: null,
};

function makeApi(over: Partial<PackPanelApi> = {}): PackPanelApi {
  const summary = computeSummary({
    attributes,
    modifiers,
    activeCarriers: buildActiveCarriersFrom(doc),
    proficiency: {},
  });
  const estimateEntries = over.estimateEntries ?? [];
  const estimateSummary = estimateEntries.length
    ? computeHypotheticalSummary(
        { ...doc, proficiency: {} },
        {
          extraModifiers: estimateEntries.map((entry, index) => ({
            id: `est-${entry.id}`,
            ownerType: "status",
            ownerId: "c1",
            nature: "sustained",
            name: "估算",
            targetAttrId: entry.attrId,
            op: entry.op,
            value: entry.value,
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
            sortOrder: 900000 + index,
          })),
        },
      )
    : null;

  return {
    doc,
    summary,
    dirty: 0,
    prefs: { collapsed: {} },
    toggleModuleCollapsed: vi.fn(),
    estimateOn: false,
    setEstimateOn: vi.fn(),
    estimateEntries,
    estimateSummary,
    estimateDeltas: estimateSummary ? summaryDeltas(summary, estimateSummary) : [],
    addEstimate: vi.fn(),
    updateEstimate: vi.fn(),
    removeEstimate: vi.fn(),
    clearEstimates: vi.fn(),
    setDetailAttrId: vi.fn(),
    previewEquipDeltas: (itemId: string, slotId: string) =>
      summaryDeltas(summary, computeHypotheticalSummary({ ...doc, proficiency: {} }, { equip: { itemId, slotId } })),
    ...over,
  } as unknown as PackPanelApi;
}

describe("SummaryModule —— 估算模式（REQ-037）", () => {
  afterEach(cleanup);

  it("关闭时完全不出现估算编辑器", () => {
    render(<SummaryModule api={makeApi()} />);
    expect(screen.queryByText("临时加成只参与试算，不会保存，也不计入未保存改动数。")).toBeNull();
  });

  it("打开且有条目时，估算控件不在属性行按钮内（无嵌套交互控件）", () => {
    render(
      <SummaryModule
        api={makeApi({
          estimateOn: true,
          estimateEntries: [{ id: "e1", attrId: "a1", op: "add", value: 50 }],
        })}
      />,
    );

    // 编辑器确实渲染了
    expect(screen.getByText("临时加成只参与试算，不会保存，也不计入未保存改动数。")).toBeInTheDocument();

    // 行按钮里不能有任何交互控件：一旦估算编辑器被挪进行按钮，
    // 这里立刻会数出 0 以外的东西（Select / InputNumber 都渲染成可聚焦元素）。
    const rowButtons = document.querySelectorAll(".cpk-sum__row");
    expect(rowButtons.length).toBe(2);
    rowButtons.forEach((row) => {
      expect(row.querySelectorAll("button, input, [role='combobox']").length).toBe(0);
    });
  });

  it("有条目时属性行显示估算值与 Δ 增量", () => {
    render(
      <SummaryModule
        api={makeApi({
          estimateOn: true,
          estimateEntries: [{ id: "e1", attrId: "a1", op: "add", value: 50 }],
        })}
      />,
    );
    // 攻击力 100 → 150，Δ +50
    expect(document.querySelectorAll(".cpk-sum__num.is-est").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".cpk-seg.is-est").length).toBeGreaterThan(0);
  });
});

describe("EquipDeltaPreview —— 穿戴 Δ（REQ-018）", () => {
  afterEach(cleanup);

  it("只列真的会变的属性，未变的属性不占位", () => {
    render(<EquipDeltaPreview api={makeApi()} itemId="i1" slotId="s1" />);
    expect(screen.getByText("攻击力")).toBeInTheDocument();
    // 防御力没有任何加成变化 → 不该出现在 Δ 清单里
    expect(screen.queryByText("防御力")).toBeNull();
    // 100 → 130
    expect(screen.getByText("130")).toBeInTheDocument();
  });

  it("穿上后属性不变时给一句话，而不是空白浮层", () => {
    render(<EquipDeltaPreview api={makeApi()} itemId="missing" slotId="s1" />);
    expect(screen.getByText("穿上后总属性不变")).toBeInTheDocument();
  });
});
