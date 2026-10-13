import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SkillsModule from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import { DEFAULT_UI_PREFS, type PackSkill, type PackUnitSystem } from "../../types";
import { proficiencySchemeOf } from "../../pack-utils";

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
  groupId: "",
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
  skills: [skill],
  modifiers: [],
  unitSystems: [],
  layouts: [],
  presets: [],
  realmLink: null,
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
  // Phase 3：组件经 `schemeForSkill` 解析体系（组绑定 → 默认）。测试里没有分组，
  // 统一回落到 `over.proficiencySystem`（默认体系）。
  const profSystem = over.proficiencySystem;
  const profMeta = profSystem
    ? proficiencySchemeOf(profSystem.levels, profSystem.config)
    : { levels: [], alias: "熟练度", autoCarry: true };
  return {
    doc,
    summary: { rows: [], ignoredCast: 0 },
    dirty: 0,
    prefs: { ...DEFAULT_UI_PREFS, collapsed: {} },
    toggleModuleCollapsed: vi.fn(),
    patchPrefs: vi.fn(),
    isRecentlyChanged: () => false,
    proficiencySystem: undefined,
    proficiencySystems: profSystem ? [profSystem] : [],
    proficiencySchemes: new Map(profSystem ? [[profSystem.id, profMeta]] : []),
    schemeForSkill: () => ({ system: profSystem, meta: profMeta }),
    modifiersOf: () => [],
    isCarrierActive: () => true,
    addSkill: vi.fn(),
    updateSkill: vi.fn(),
    removeSkill: vi.fn(),
    stepProficiency: vi.fn(),
    openEffectEditor: vi.fn(),
    setUnitManagerOpen: vi.fn(),
    applyProficiencyTemplate: vi.fn(),
    upsertUnitSystem: vi.fn(),
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

/**
 * 档位就在行内改（2026-10 用户报障）。
 *
 * 旧版档位只是一个不可点的 `<span>`，区间只能去头部的量纲弹窗里改 ——
 * 读者看到「497 熟练」找不到「熟练」是怎么定义的，也不知道去哪改
 * （原话：「熟练度的入门，熟练不知道去哪设置」）。
 *
 * 这一组钉住三件事：chip 是**按钮**（不是装饰）、点开能切档位、切档位写回数值。
 */
describe("SkillsModule —— 档位行内可改", () => {
  afterEach(cleanup);

  const renderTiered = (over: Partial<PackPanelApi> = {}) =>
    render(
      <SkillsModule
        api={makeApi({
          prefs: { ...DEFAULT_UI_PREFS, collapsed: {}, showProficiency: true },
          proficiencySystem: PROFICIENCY,
          ...over,
        })}
      />,
    );

  it("档位 chip 是一枚可点的按钮，不是纯装饰的 span", () => {
    renderTiered();
    const tier = document.querySelector(".cpk-skl__tier");
    expect(tier).not.toBeNull();
    expect(tier?.tagName).toBe("BUTTON");
    // 按钮自己带「点我能改」的说明
    expect(tier?.getAttribute("title")).toMatch(/档位/);
  });

  it("点开档位菜单能切到另一档 → 数值挪到该档起点", async () => {
    const api = makeApi({
      prefs: { ...DEFAULT_UI_PREFS, collapsed: {}, showProficiency: true },
      proficiencySystem: PROFICIENCY,
    });
    render(<SkillsModule api={api} />);

    fireEvent.click(document.querySelector(".cpk-skl__tier") as HTMLElement);
    // 「入门」那一档出现在菜单里（当前是「熟练」，所以入门项不在 chip 上）
    const entry = await screen.findByText("入门");
    fireEvent.click(entry);

    expect(api.updateSkill).toHaveBeenCalledWith("k1", { proficiencyRaw: 0 });
  });

  it("菜单里有直达量纲设置的入口（不把作者丢在找不到的地方）", async () => {
    const api = makeApi({
      prefs: { ...DEFAULT_UI_PREFS, collapsed: {}, showProficiency: true },
      proficiencySystem: PROFICIENCY,
    });
    render(<SkillsModule api={api} />);

    fireEvent.click(document.querySelector(".cpk-skl__tier") as HTMLElement);
    fireEvent.click(await screen.findByText("改档位区间…"));
    expect(api.setUnitManagerOpen).toHaveBeenCalledWith(true);
  });

  it("没有档位体系时给一次性建立入口，而不是彻底沉默", () => {
    const api = makeApi({ prefs: { ...DEFAULT_UI_PREFS, collapsed: {}, showProficiency: true } });
    render(<SkillsModule api={api} />);

    expect(document.querySelector(".cpk-skl__setuptip")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /套用默认三档/ }));
    expect(api.applyProficiencyTemplate).toHaveBeenCalled();
  });

  it("有档位体系时不出现建立引导（不能常驻）", () => {
    renderTiered();
    expect(document.querySelector(".cpk-skl__setuptip")).toBeNull();
  });
});

/**
 * 新增技能后要主动滚到新行（2026-10 用户报障）。
 *
 * 技能多了以后列表自己滚，新技能追加在**最下面**，不滚就看不到 ——
 * 作者会以为「点了没反应」。这里用 jsdom 里唯一可行的判据：`addSkill`
 * 之后新行被渲染出来，且 `scrollIntoView` 被调用在新行上。
 */
describe("SkillsModule —— 新增技能后滚动到新行", () => {
  afterEach(cleanup);

  it("点「技能」后新行进入视野（scrollIntoView 打在新行上）", () => {
    const scrollIntoView = vi.fn();
    // jsdom 没有实现 scrollIntoView，得自己挂一个
    Element.prototype.scrollIntoView = scrollIntoView;

    const api = makeApi({
      prefs: { ...DEFAULT_UI_PREFS, collapsed: {}, showProficiency: true },
      proficiencySystem: PROFICIENCY,
    });
    // addSkill 返回新 id，但**不**改 doc —— 模拟真实 store 的异步落库：
    // 组件必须自己等下一次渲染再滚，不能在这一刻假设新行已经存在。
    (api.addSkill as ReturnType<typeof vi.fn>).mockReturnValue("k-new");

    const { rerender } = render(<SkillsModule api={api} />);
    // 用 class 定位「+ 技能」那颗按钮：按 accessible name 会同时命中模块标题「技能栏」
    fireEvent.click(document.querySelector(".cpk-skl__add") as HTMLElement);

    // 这一刻新行还不存在 → 不该滚（更不该崩）
    expect(scrollIntoView).not.toHaveBeenCalled();

    // doc 更新后重渲染：新行挂上，滚动发生
    const nextApi = {
      ...api,
      doc: {
        ...doc,
        skills: [...doc.skills, { ...skill, id: "k-new", name: "新技能", proficiencyRaw: 0 }],
      },
    } as unknown as PackPanelApi;
    rerender(<SkillsModule api={nextApi} />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
