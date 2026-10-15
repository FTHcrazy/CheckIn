import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PackDashboard from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import {
  DEFAULT_UI_PREFS,
  type PackAttribute,
  type PackModifier,
  type PackModuleState,
} from "../../types";

/**
 * 行囊 L0 看板（UI-01）。
 *
 * 钉住五区的关键行为：
 * - A 身份卡：读名字 / 绑定态 / 变动角标；
 * - C 核心属性：默认条数受档位限制、点行开来源明细、「展开全部」放出其余；
 * - D 生效状态：只列 active、开关可点；
 * - E 摘要行：一行一模块、点击触发展开回调、箭头随展开态。
 * 只读看板不改数据 —— 所有写动作都通过回调 / API 方法，断言校验调用即可。
 */

function attr(id: string, name: string, partial: Partial<PackAttribute> = {}): PackAttribute {
  return {
    id,
    characterId: "c1",
    groupName: "基础属性",
    name,
    defaultValue: 100,
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

function makeDoc(partial: Partial<PackDoc> = {}): PackDoc {
  return {
    character: {
      id: "c1",
      workId: "w1",
      name: "陆长安",
      displayName: "陆长安",
      avatar: "",
      isProtagonist: true,
      entityId: "",
      realmAt: "",
      note: "",
      sortOrder: 1,
    },
    attrDefs: [],
    attributes: [],
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
    ...partial,
  };
}

function makeApi(over: Partial<PackPanelApi> = {}): PackPanelApi {
  const attrs = [
    attr("a1", "气血"),
    attr("a2", "攻击力"),
    attr("a3", "防御力"),
    attr("a4", "敏捷"),
    attr("a5", "智力"),
    attr("a6", "幸运"),
    attr("a7", "暴击"),
    attr("a8", "闪避"),
    attr("a9", "命中"),
    attr("a10", "韧性"),
  ];
  const enabledModules: PackModuleState[] = [
    { key: "summary", enabled: true, sortOrder: 1 },
    { key: "attributes", enabled: true, sortOrder: 2 },
    { key: "realm", enabled: true, sortOrder: 3 },
    { key: "equipment", enabled: true, sortOrder: 4 },
  ];
  const byAttr = new Map(
    attrs.map((a) => [
      a.id,
      {
        attrId: a.id,
        base: a.baseValue,
        final: a.baseValue + 10,
        preMapping: a.baseValue,
        addPassive: 10,
        addSustained: 0,
        addMapped: 0,
        mappedHits: [],
        percentPassive: 0,
        percentSustained: 0,
        mulPassive: 1,
        mulSustained: 1,
        override: null,
        overrideCount: 0,
        contributions: [],
      },
    ]),
  );
  return {
    doc: makeDoc(),
    attrView: attrs,
    summary: { rows: attrs, byAttr, casts: [], eventOnly: [], expired: [], groupOff: [], mappingProblems: new Map(), mappingApplied: new Map(), countedCount: 0 },
    statusModifiers: [mod(), mod({ id: "pm2", name: "阵法增益", active: false })],
    enabledModules,
    rungs: [],
    realmText: "炼气 1 层",
    panelRealmText: "炼气 1 层",
    realmBound: false,
    realmHint: "",
    changedCount: 0,
    prefs: { ...DEFAULT_UI_PREFS, collapsed: {} },
    setDetailAttrId: vi.fn(),
    toggleModifierActive: vi.fn(),
    markAllChangesRead: vi.fn(),
    setModuleManagerOpen: vi.fn(),
    ...over,
  } as unknown as PackPanelApi;
}

function renderBoard(over: Partial<PackPanelApi> = {}, tier: "wide" | "mid" | "narrow" = "wide") {
  const api = makeApi(over);
  const onExpandModule = vi.fn();
  const onToggleAttrs = vi.fn();
  const result = render(
    <PackDashboard
      api={api}
      tier={tier}
      attrsExpanded={false}
      onToggleAttrs={onToggleAttrs}
      onExpandModule={onExpandModule}
      expandedKeys={new Set()}
    />,
  );
  return { api, onExpandModule, onToggleAttrs, container: result.container };
}

describe("PackDashboard —— A 主角身份卡", () => {
  afterEach(cleanup);

  it("显示角色名、境界读数与绑定态", () => {
    renderBoard();
    expect(screen.getByText("陆长安")).toBeInTheDocument();
    // 境界读数在读 chip 与 B 区大读数各出现一次
    expect(screen.getAllByText("炼气 1 层").length).toBeGreaterThan(0);
    expect(screen.getByText("未绑定主角")).toBeInTheDocument();
  });

  it("有改动时出现变动角标，点击走全部已读", () => {
    const { api } = renderBoard({ changedCount: 3 });
    const badge = screen.getByText("3 处改动").closest("button") as HTMLButtonElement;
    fireEvent.click(badge);
    expect(api.markAllChangesRead).toHaveBeenCalledTimes(1);
  });
});

describe("PackDashboard —— C 核心属性总览", () => {
  afterEach(cleanup);

  it("宽档默认最多显示 8 条，其余由「展开全部」放出", () => {
    const { container } = renderBoard({}, "wide");
    expect(container.querySelectorAll(".cpk-board__attrrow")).toHaveLength(8);
    expect(screen.getByText(/展开全部（10）/)).toBeInTheDocument();
    expect(screen.getByText(/还有 2 项/)).toBeInTheDocument();
  });

  it("窄档默认最多 4 条", () => {
    const { container } = renderBoard({}, "narrow");
    expect(container.querySelectorAll(".cpk-board__attrrow")).toHaveLength(4);
  });

  it("点属性行开来源明细（setDetailAttrId）", () => {
    const { api } = renderBoard();
    const first = document.querySelector(".cpk-board__attrrow") as HTMLButtonElement;
    fireEvent.click(first);
    expect(api.setDetailAttrId).toHaveBeenCalledWith("a1");
  });
});

describe("PackDashboard —— D 生效状态", () => {
  afterEach(cleanup);

  it("只列 active 的状态，未生效不出现", () => {
    renderBoard();
    expect(screen.getByText("中毒")).toBeInTheDocument();
    expect(screen.queryByText("阵法增益")).toBeNull();
  });

  it("开关可点，走 toggleModifierActive", () => {
    const { api } = renderBoard();
    const toggle = document.querySelector(".cpk-board__statusrow .ant-switch") as HTMLElement;
    fireEvent.click(toggle);
    expect(api.toggleModifierActive).toHaveBeenCalledWith("pm1");
  });
});

describe("PackDashboard —— E 关键设定摘要行", () => {
  afterEach(cleanup);

  it("一行一模块，点击触发展开回调", () => {
    const { onExpandModule } = renderBoard();
    const row = screen.getByText("装备栏").closest("button") as HTMLButtonElement;
    expect(row).toBeTruthy();
    fireEvent.click(row);
    expect(onExpandModule).toHaveBeenCalledWith("equipment");
  });

  it("已展开的模块箭头 aria-expanded=true", () => {
    const api = makeApi();
    render(
      <PackDashboard
        api={api}
        tier="wide"
        attrsExpanded={false}
        onToggleAttrs={vi.fn()}
        onExpandModule={vi.fn()}
        expandedKeys={new Set(["equipment"])}
      />,
    );
    const row = screen.getByText("装备栏").closest("button") as HTMLButtonElement;
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });

  it("「模块管理」按钮打开模块管理器", () => {
    const { api } = renderBoard();
    fireEvent.click(screen.getByText("模块管理").closest("button") as HTMLButtonElement);
    expect(api.setModuleManagerOpen).toHaveBeenCalledWith(true);
  });
});

describe("PackDashboard —— 空态", () => {
  afterEach(cleanup);

  it("无属性时给引导文案而非空表", () => {
    renderBoard({ attrView: [], summary: { rows: [], byAttr: new Map(), casts: [], eventOnly: [], expired: [], groupOff: [], mappingProblems: new Map(), mappingApplied: new Map(), countedCount: 0 } });
    expect(screen.getByText(/还没有属性/)).toBeInTheDocument();
  });

  it("无生效状态时给引导文案", () => {
    renderBoard({ statusModifiers: [] });
    expect(screen.getByText(/当前没有生效中的状态/)).toBeInTheDocument();
  });
});
