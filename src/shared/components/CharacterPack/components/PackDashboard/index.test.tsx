import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PackDashboard from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import type { LadderRung } from "../../pack-utils";
import {
  DEFAULT_UI_PREFS,
  type PackAttribute,
  type PackModifier,
  type PackModuleState,
} from "../../types";

/**
 * 行囊 L0 看板（UI-01）。
 *
 * 钉住各区的关键行为：
 * - B 境界卡：大读数 + 镜像条；「调整」是**导航入口**，恒展开语义、不出「收起」；
 * - C 核心属性：默认条数受档位限制、点行开来源明细、「展开全部」放出其余；
 * - D 生效状态：只列 active、开关可点。
 * 只读看板不改数据 —— 所有写动作都通过回调 / API 方法，断言校验调用即可。
 *
 * ⚠️ E「关键设定」摘要行 2026-10 第二轮整卡移除，相关用例一并删除。
 *
 * ⚠️ 曾经有一版 A 区身份卡（名字 / 境界 chip / 绑定态 / 改动角标），因与头部
 * 逐项重复已删。若有人想加回来，先看 index.tsx 顶部那段说明。
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

function rung(partial: Partial<LadderRung> = {}): LadderRung {
  return {
    id: "r1",
    name: "炼气",
    rank: 1,
    subLevels: 13,
    power: null,
    hasChildren: false,
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
    />,
  );
  return { api, onExpandModule, onToggleAttrs, container: result.container };
}

describe("PackDashboard —— B 境界卡", () => {
  afterEach(cleanup);

  it("给大读数与「实体面板显示」镜像条（同源态）", () => {
    renderBoard();
    expect(screen.getAllByText("炼气 1 层").length).toBeGreaterThan(0);
    expect(screen.getByText("实体面板显示")).toBeInTheDocument();
    expect(screen.getByText("同源")).toBeInTheDocument();
  });

  it("两处读数不一致时标注「已分叉」", () => {
    renderBoard({ panelRealmText: "筑基 2 层" });
    expect(screen.getByText("已分叉")).toBeInTheDocument();
    expect(screen.getByText("筑基 2 层")).toBeInTheDocument();
  });

  it("没有等级体系时不渲染「调整」入口", () => {
    renderBoard({ rungs: [] });
    // ⚠️ 两个坑：① antd 会给两字中文按钮插字间距（测试环境没挂 ThemeProvider，
    // 走 antd 默认 autoInsertSpace=true），文本实际是「调 整」→ 用文案断言会假通过；
    // ② `.cpk-board__entry` 同时是 C 区「展开全部」的类名 → 必须限定在境界卡内查。
    expect(document.querySelector(".cpk-board__realm .cpk-board__entry")).toBeNull();
  });

  it("「调整」是导航入口：模块已展开时也仍可点，不出「收起」", () => {
    const api = makeApi({ rungs: [rung()] });
    const onExpandModule = vi.fn();
    render(
      <PackDashboard
        api={api}
        tier="wide"
        attrsExpanded={false}
        onToggleAttrs={vi.fn()}
        onExpandModule={onExpandModule}
      />,
    );
    const entry = document.querySelector(
      ".cpk-board__realm .cpk-board__entry",
    ) as HTMLButtonElement;
    expect(entry).not.toBeNull();
    // 旧版在展开态下把文案切成「收起」，而这张卡本身没有可收起的内容
    // → 点完卡面毫无变化，用户报障「这颗按钮没用」。（比对时去掉 antd 插的字间距）
    expect((entry.textContent ?? "").replace(/\s/g, "")).toBe("调整");
    fireEvent.click(entry);
    expect(onExpandModule).toHaveBeenCalledWith("realm");
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
