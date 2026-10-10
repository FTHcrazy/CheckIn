import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SkillsModule from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import { DEFAULT_UI_PREFS, type PackSkill, type PackUnitSystem } from "../../types";

/**
 * 熟练度的**可见性边界**（REQ-014 收尾：进度条）。
 *
 * 「熟练度」是一个模块级开关，它的语义是「关掉即整块缺席，不是置灰」——
 * 所以第一组断言直接数 DOM（置灰的写法会让元素照样存在，只是变淡）。
 *
 * 第二组钉的是「数值」与「档位名 / 进度条」的**可见条件不同**：
 * 数值是熟练度的本体（效果可以按它缩放），没配等级体系时也得能改；
 * 而进度条要有阈值体系才有意义。两者绑成同一个条件的话，
 * 用户刚新建的行囊（没有等级体系）会发现熟练度根本改不了。
 */

const skill: PackSkill = {
  id: "k1",
  characterId: "c1",
  name: "听潮步",
  desc: "",
  enabled: true,
  proficiencyRaw: 150,
  tags: [],
  sortOrder: 1,
  updatedAt: 0,
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
  skills: [skill],
  modifiers: [],
  unitSystems: [],
  layouts: [],
  presets: [],
};

/** 三档：入门 0–99 / 熟练 100–299 / 精通 300+（末档无上限，网文里的常态） */
const PROFICIENCY: PackUnitSystem = {
  id: "u1",
  characterId: "c1",
  kind: "threshold",
  name: "熟练度",
  config: '{ "use": "proficiency" }',
  isDefault: true,
  levels: JSON.stringify([
    { name: "入门", min: 0, max: 99 },
    { name: "熟练", min: 100, max: 299 },
    { name: "精通", min: 300, max: null },
  ]),
  sortOrder: 1,
};

function makeApi(over: Partial<PackPanelApi> = {}) {
  return {
    doc,
    summary: { rows: [], ignoredCast: 0 },
    dirty: 0,
    prefs: { ...DEFAULT_UI_PREFS, collapsed: {} },
    toggleModuleCollapsed: vi.fn(),
    patchPrefs: vi.fn(),
    isRecentlyChanged: () => false,
    proficiencySystem: undefined,
    modifiersOf: () => [],
    isCarrierActive: () => true,
    addSkill: vi.fn(),
    updateSkill: vi.fn(),
    removeSkill: vi.fn(),
    stepProficiency: vi.fn(),
    openEffectEditor: vi.fn(),
    toggleModifierActive: vi.fn(),
    toggleModifierDisabled: vi.fn(),
    duplicateModifier: vi.fn(),
    removeModifier: vi.fn(),
    setDetailAttrId: vi.fn(),
    ...over,
  } as unknown as PackPanelApi;
}

const bar = () => document.querySelector(".cpk-skl__prog");
const numberInput = () => document.querySelector(".cpk-skl .ant-input-number-input");

describe("SkillsModule —— 熟练度开关（REQ-014）", () => {
  afterEach(cleanup);

  it("关闭时进度条与数值都完全缺席（不是置灰）", () => {
    render(<SkillsModule api={makeApi()} />);
    expect(bar()).toBeNull();
    expect(numberInput()).toBeNull();
    expect(screen.queryByText("熟练")).toBeNull();
  });

  it("开启且配了等级体系 → 数值 / 档位名 / 进度条三样都在", () => {
    render(
      <SkillsModule
        api={makeApi({
          prefs: { ...DEFAULT_UI_PREFS, collapsed: {}, showProficiency: true },
          proficiencySystem: PROFICIENCY,
        })}
      />,
    );
    expect(numberInput()).not.toBeNull();
    expect(bar()).not.toBeNull();
    expect(screen.getByText("熟练")).toBeInTheDocument();
  });

  it("开启但没配等级体系 → 数值仍可改，档位名与进度条不出现", () => {
    render(
      <SkillsModule
        api={makeApi({ prefs: { ...DEFAULT_UI_PREFS, collapsed: {}, showProficiency: true } })}
      />,
    );
    expect(numberInput()).not.toBeNull();
    expect(bar()).toBeNull();
    expect(document.querySelector(".cpk-skl__tier")).toBeNull();
  });
});

describe("SkillsModule —— 进度条口径（REQ-014）", () => {
  afterEach(cleanup);

  const renderWithProficiency = (proficiencyRaw: number) =>
    render(
      <SkillsModule
        api={makeApi({
          prefs: { ...DEFAULT_UI_PREFS, collapsed: {}, showProficiency: true },
          proficiencySystem: PROFICIENCY,
          doc: { ...doc, skills: [{ ...skill, proficiencyRaw }] },
        })}
      />,
    );

  it("进度只表达「当前档位内走了多少」，并标出档位量纲", () => {
    renderWithProficiency(150);
    // 150 落在 100–299 里 → (150-100)/(299-100) ≈ 25%
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("100–299")).toBeInTheDocument();
  });

  it("档位起点是 0%，不是「没渲染」", () => {
    renderWithProficiency(100);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("末档无上限时条是满的，量纲标成「起点+」而不是编一个上限", () => {
    renderWithProficiency(500);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("300+")).toBeInTheDocument();
  });
});

describe("SkillsModule —— 数值回写", () => {
  afterEach(cleanup);

  it("改数值回写 proficiencyRaw（负数归零）", () => {
    const api = makeApi({
      prefs: { ...DEFAULT_UI_PREFS, collapsed: {}, showProficiency: true },
      proficiencySystem: PROFICIENCY,
    });
    render(<SkillsModule api={api} />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "260" } });
    expect(api.updateSkill).toHaveBeenCalledWith("k1", { proficiencyRaw: 260 });
  });
});
