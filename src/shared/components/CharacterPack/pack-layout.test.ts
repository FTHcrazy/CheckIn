import { describe, expect, it } from "vitest";
import {
  PACK_ZONE_LABEL,
  PACK_ZONE_OF,
  PACK_ZONE_ORDER,
  activeZones,
  coreFirstOrder,
  isAutoCollapsed,
  missingZoneOf,
  moduleSummary,
  splitByZone,
} from "./pack-layout";
import {
  isCorePackModule,
  PACK_WINDOW_BREAKPOINTS,
  packWidthTier,
} from "./pack-config";
import { PACK_MODULES, type PackModuleKey, type PackModuleState } from "./types";

/** 造一份「全部启用、顺序即出厂顺序」的模块清单 */
function allModules(): PackModuleState[] {
  return PACK_MODULES.map((module, index) => ({
    key: module.key,
    enabled: true,
    sortOrder: index + 1,
  }));
}

/**
 * 分区映射是**穷尽**的。
 *
 * 这一组钉死的失效模式是「新增模块忘了登记分区」：漏了之后 `PACK_ZONE_OF[key]`
 * 是 undefined，`splitByZone` 会把它静默丢进 stats 栏（else 分支），
 * 表现为「新模块在宽档下莫名其妙跑到右栏」，而且不会有任何报错。
 * `satisfies Record<PackModuleKey, PackZone>` 已经在类型层拦一道，
 * 这里再钉一道运行时断言 —— 类型守卫可以被 `as` 绕过，测试不能。
 */
describe("分区映射（PackZone）", () => {
  it("每个模块都有分区，没有漏登记", () => {
    for (const module of PACK_MODULES) {
      expect(PACK_ZONE_OF[module.key]).toBeDefined();
    }
  });

  it("核心三块必须落在 stats 栏（它们是「读数」，不是「挑装备」）", () => {
    for (const key of PACK_WINDOW_BREAKPOINTS.coreModules) {
      expect(PACK_ZONE_OF[key]).toBe("stats");
    }
  });

  it("装备 / 物品 / 技能三个「操作类」模块在同一栏", () => {
    expect(PACK_ZONE_OF.equipment).toBe("gear");
    expect(PACK_ZONE_OF.inventory).toBe("gear");
    expect(PACK_ZONE_OF.skills).toBe("gear");
  });

  it("映射跟属性同栏（它解释的是属性读数，不是「挑装备」）", () => {
    expect(PACK_ZONE_OF.mapping).toBe(PACK_ZONE_OF.attributes);
    expect(PACK_ZONE_OF.mapping).toBe("stats");
  });

  it("两栏各有中文眉标，且互不相同", () => {
    expect(PACK_ZONE_LABEL.gear).toBeTruthy();
    expect(PACK_ZONE_LABEL.stats).toBeTruthy();
    expect(PACK_ZONE_LABEL.gear).not.toBe(PACK_ZONE_LABEL.stats);
  });

  /*
    左栏必须是「数值与状态」：左上第一屏给了装备类，作者开行囊第一眼看到的
    就不是属性与境界。这条同时钉死与 `index.scss` 的 `&__zones` 栏宽配比同序
    —— 两处一旦不同步，右栏（装备类，行内元素多）会被压成窄条挤成两行。
  */
  it("宽档落位：stats 在左、gear 在右", () => {
    expect(PACK_ZONE_ORDER).toEqual(["stats", "gear"]);
    expect(PACK_ZONE_ORDER).toHaveLength(2);
  });
});

/**
 * splitByZone 的两条硬约束：
 * 1. **不丢模块**（两边并起来必须等于输入）；
 * 2. **不重排**（各自保持输入的相对顺序）。
 *
 * 第 2 条是拖拽排序能不能用的关键：作者在模块管理里把「技能」拖到「物品」前面，
 * 宽档下必须还看得见这个顺序。若在这里按固定顺序重排，拖拽会「看似失效」。
 */
describe("splitByZone", () => {
  it("两条栏合并后不丢模块", () => {
    const input = allModules();
    const { gear, stats } = splitByZone(input);
    expect([...gear, ...stats]).toHaveLength(input.length);
    expect(new Set([...gear, ...stats].map((m) => m.key))).toEqual(
      new Set(input.map((m) => m.key)),
    );
  });

  it("保持各自在输入里的相对顺序（拖拽排序不被重排吞掉）", () => {
    const input = allModules();
    const { gear, stats } = splitByZone(input);
    const gearOrder = input.filter((m) => PACK_ZONE_OF[m.key] === "gear").map((m) => m.key);
    const statsOrder = input.filter((m) => PACK_ZONE_OF[m.key] === "stats").map((m) => m.key);
    expect(gear.map((m) => m.key)).toEqual(gearOrder);
    expect(stats.map((m) => m.key)).toEqual(statsOrder);
  });

  it("换一个顺序进来，分栏结果跟着换（不是写死的）", () => {
    const reversed = [...allModules()].reverse();
    const { gear } = splitByZone(reversed);
    expect(gear.map((m) => m.key)).toEqual(["skills", "inventory", "equipment"]);
  });

  it("空输入给两个空栏，不抛", () => {
    expect(splitByZone([])).toEqual({ gear: [], stats: [] });
  });
});

/**
 * activeZones / missingZoneOf：新书出厂只开核心三块（全在 stats 栏）时的
 * 宽档编排 —— 空分区不渲染，对面栏出引导卡。这是「初始界面不发空」的关键规则。
 */
describe("activeZones / missingZoneOf", () => {
  it("新书出厂态（只有核心三块）：只渲染 stats，gear 整栏退场", () => {
    const core = allModules().filter((m) =>
      ["summary", "attributes", "realm"].includes(m.key),
    );
    const active = activeZones(splitByZone(core));
    expect(active).toEqual(["stats"]);
    expect(missingZoneOf(active)).toBe("gear");
  });

  it("双栏都有模块：两栏都渲染，不出引导卡", () => {
    const active = activeZones(splitByZone(allModules()));
    expect(active).toEqual(["stats", "gear"]);
    expect(missingZoneOf(active)).toBeNull();
  });

  it("左栏是「数值与状态」—— 核心三块（汇总 / 属性 / 境界）落在第一栏", () => {
    const split = splitByZone(allModules());
    const active = activeZones(split);
    expect(active[0]).toBe("stats");
    const leftKeys = split[active[0]].map((m) => m.key);
    for (const key of ["summary", "attributes", "realm"]) {
      expect(leftKeys).toContain(key);
    }
    // 装备 / 物品 / 技能在右栏，不在左栏
    expect(leftKeys).not.toContain("equipment");
    expect(split[active[1]].map((m) => m.key)).toEqual([
      "equipment",
      "inventory",
      "skills",
    ]);
  });

  it("只有装备类模块：只渲染 gear，对面引导卡指向 stats", () => {
    const gearOnly = allModules().filter((m) => PACK_ZONE_OF[m.key] === "gear");
    const active = activeZones(splitByZone(gearOnly));
    expect(active).toEqual(["gear"]);
    expect(missingZoneOf(active)).toBe("stats");
  });

  it("全空：不出引导卡（整版空态由上游「所有模块都关掉了」分支负责）", () => {
    const active = activeZones(splitByZone([]));
    expect(active).toEqual([]);
    expect(missingZoneOf(active)).toBeNull();
  });
});

/**
 * coreFirstOrder：核心三块钉顶。存量书的布局顺序里核心三块可能排在末尾，
 * 每新开一个模块它就插在核心三块上面，把主内容越顶越深 —— 钉顶后不会。
 */
describe("coreFirstOrder", () => {
  const byKey = (list: PackModuleState[]) => list.map((m) => m.key);

  it("核心三块恒在最前，即使输入把它们排在末尾", () => {
    // 显式造「核心三块沉底」的输入（allModules 的出厂顺序核心本来就靠前，
    // 构造不出这个场景）
    const input: PackModuleState[] = [
      { key: "currency", enabled: true, sortOrder: 1 },
      { key: "mapping", enabled: true, sortOrder: 2 },
      { key: "note", enabled: true, sortOrder: 3 },
      { key: "summary", enabled: true, sortOrder: 4 },
      { key: "realm", enabled: true, sortOrder: 5 },
      { key: "attributes", enabled: true, sortOrder: 6 },
    ];
    expect(byKey(coreFirstOrder(input))).toEqual([
      "summary",
      "realm",
      "attributes",
      "currency",
      "mapping",
      "note",
    ]);
  });

  it("两段各自保持相对顺序（其余模块的作者排序不被打乱）", () => {
    const input: PackModuleState[] = [
      { key: "note", enabled: true, sortOrder: 1 },
      { key: "realm", enabled: true, sortOrder: 2 },
      { key: "status", enabled: true, sortOrder: 3 },
      { key: "attributes", enabled: true, sortOrder: 4 },
      { key: "currency", enabled: true, sortOrder: 5 },
      { key: "summary", enabled: true, sortOrder: 6 },
    ];
    const rest = byKey(coreFirstOrder(input)).slice(3);
    expect(rest).toEqual(["note", "status", "currency"]);
  });

  it("空输入给空数组，不抛", () => {
    expect(coreFirstOrder([])).toEqual([]);
  });
});

/**
 * 窄档自动折叠。
 *
 * 三条规则在这里逐条钉死。最容易写错的是第 3 条与第 2 条的边界：
 * 「未表态」才自动折叠，作者一旦手动展开过就必须尊重 —— 否则窄档下
 * 作者怎么点都展不开（点了写进 prefs，但被自动折叠又盖回去）。
 */
describe("isAutoCollapsed", () => {
  it("核心三块在任何档位都不自动折叠", () => {
    for (const key of PACK_WINDOW_BREAKPOINTS.coreModules) {
      expect(isAutoCollapsed(key, "wide", {})).toBe(false);
      expect(isAutoCollapsed(key, "mid", {})).toBe(false);
      expect(isAutoCollapsed(key, "narrow", {})).toBe(false);
      // 即便作者手动折叠过，核心块也不折叠
      expect(isAutoCollapsed(key, "narrow", { [key]: true })).toBe(false);
    }
  });

  it("宽 / 中档一概遵从作者偏好（未表态 = 展开）", () => {
    expect(isAutoCollapsed("inventory", "wide", {})).toBe(false);
    expect(isAutoCollapsed("inventory", "mid", {})).toBe(false);
    expect(isAutoCollapsed("inventory", "wide", { inventory: true })).toBe(true);
    expect(isAutoCollapsed("inventory", "mid", { inventory: true })).toBe(true);
  });

  it("窄档下未表态的次要模块默认折叠（这就是「自动折叠成标题行」）", () => {
    const secondary: PackModuleKey[] = [
      "equipment",
      "inventory",
      "skills",
      "mapping",
      "currency",
      "status",
      "note",
    ];
    for (const key of secondary) {
      expect(isCorePackModule(key)).toBe(false);
      expect(isAutoCollapsed(key, "narrow", {})).toBe(true);
    }
  });

  it("窄档下作者手动展开过的模块保持展开（自动规则不覆盖显式偏好）", () => {
    expect(isAutoCollapsed("inventory", "narrow", { inventory: false })).toBe(false);
  });

  it("窄档下作者手动折叠过的次要模块保持折叠", () => {
    expect(isAutoCollapsed("inventory", "narrow", { inventory: true })).toBe(true);
  });
});

/**
 * 档位断点。
 *
 * 边界值必须精确 —— 断点是窗口拉伸时判定的，差 1px 就会在临界处抖动。
 */
describe("packWidthTier", () => {
  it("≥900 是宽档，恰好在断点上算宽档", () => {
    expect(packWidthTier(PACK_WINDOW_BREAKPOINTS.wide)).toBe("wide");
    expect(packWidthTier(1080)).toBe("wide");
  });

  it("<600 是窄档，恰好在断点上一格算窄档", () => {
    expect(packWidthTier(PACK_WINDOW_BREAKPOINTS.narrow - 1)).toBe("narrow");
    expect(packWidthTier(380)).toBe("narrow");
    expect(packWidthTier(0)).toBe("narrow");
  });

  it("600–899 是中档", () => {
    expect(packWidthTier(PACK_WINDOW_BREAKPOINTS.narrow)).toBe("mid");
    expect(packWidthTier(899)).toBe("mid");
  });

  it("未测出宽度（0）落到最保守的窄档，不会误排双栏", () => {
    expect(packWidthTier(0)).toBe("narrow");
  });
});

/** 造一份最小的 PackDoc，只填 moduleSummary 会用到的字段 */
function docWith(overrides: {
  slots?: Array<{ equippedSlotId?: string }>;
  items?: Array<{ qty: number; equippedSlotId?: string }>;
  skills?: Array<{ enabled: boolean }>;
  modifiers?: Array<{ ownerType: string; active: boolean }>;
  unitSystems?: Array<{ config: string }>;
  mappings?: Array<{ rate: number }>;
  note?: string;
}) {
  return {
    slots: overrides.slots ?? [],
    items: overrides.items ?? [],
    skills: overrides.skills ?? [],
    modifiers: overrides.modifiers ?? [],
    unitSystems: overrides.unitSystems ?? [],
    mappings: overrides.mappings ?? [],
    character: { note: overrides.note ?? "" },
  } as never;
}

/**
 * 折叠行摘要。
 *
 * 摘要的价值在于「不展开也知道这栏空不空」，所以每条都要能被验证为
 * 「数得出来的真话」。这里特别钉死两条口径：
 * - 物品报的是 **qty 之和**（作者关心「还剩几颗丹药」），不是条目数；
 * - 货币**没有余额字段**（正文里写金额），所以只报「进制配没配」，不编余额。
 */
describe("moduleSummary", () => {
  it("无文档时一律空串，不抛", () => {
    expect(moduleSummary("inventory", null)).toBe("");
  });

  it("核心三块（不折叠）不产出摘要", () => {
    const doc = docWith({});
    expect(moduleSummary("summary", doc)).toBe("");
    expect(moduleSummary("attributes", doc)).toBe("");
    expect(moduleSummary("realm", doc)).toBe("");
  });

  it("装备：报部位总数与已穿戴数（按 equippedSlotId 去重计数）", () => {
    const doc = docWith({
      slots: [{}, {}, {}],
      items: [
        { qty: 1, equippedSlotId: "s1" },
        { qty: 1, equippedSlotId: "s1" }, // 同一部位两件 → 只算一个部位
        { qty: 1, equippedSlotId: "s2" },
      ],
    });
    expect(moduleSummary("equipment", doc)).toBe("3 部位 · 2 已穿戴");
  });

  it("物品：报的是 qty 之和，不是条目数", () => {
    const doc = docWith({
      items: [{ qty: 10 }, { qty: 5 }, { qty: 0 }],
    });
    expect(moduleSummary("inventory", doc)).toBe("3 种 · 共 15 件");
  });

  it("物品栏为空时说「空」，而不是「0 种 · 共 0 件」", () => {
    expect(moduleSummary("inventory", docWith({ items: [] }))).toBe("空");
  });

  it("技能：报总数与启用数", () => {
    const doc = docWith({
      skills: [{ enabled: true }, { enabled: false }, { enabled: true }],
    });
    expect(moduleSummary("skills", doc)).toBe("3 项 · 2 启用");
  });

  it("技能为空时说「暂无技能」", () => {
    expect(moduleSummary("skills", docWith({ skills: [] }))).toBe("暂无技能");
  });

  it("货币：认 config.use === 'currency' 判据（kind 只表示换算模型）", () => {
    expect(
      moduleSummary("currency", docWith({ unitSystems: [{ config: '{"use":"currency"}' }] })),
    ).toBe("已配置");
    expect(
      moduleSummary("currency", docWith({ unitSystems: [{ config: '{"use":"proficiency"}' }] })),
    ).toBe("未配置");
  });

  it("货币：config 是坏 JSON 时不抛，按未配置处理", () => {
    expect(moduleSummary("currency", docWith({ unitSystems: [{ config: "{坏" }] }))).toBe(
      "未配置",
    );
  });

  it("状态：只数 ownerType 为 status 且 active 的效果", () => {
    const doc = docWith({
      modifiers: [
        { ownerType: "status", active: true },
        { ownerType: "status", active: false }, // 未生效不计
        { ownerType: "equipment", active: true }, // 非状态不计
      ],
    });
    expect(moduleSummary("status", doc)).toBe("1 项生效");
  });

  it("无生效状态时说「无生效中」", () => {
    expect(moduleSummary("status", docWith({ modifiers: [] }))).toBe("无生效中");
  });

  it("备注：报字数（去首尾空白后）", () => {
    expect(moduleSummary("note", docWith({ note: "  记得带干粮  " }))).toBe("5 字");
  });

  it("映射：只数系数非 0 的（系数 0 = 停用，混进来会显得「哪条坏了」）", () => {
    expect(moduleSummary("mapping", docWith({ mappings: [] }))).toBe("暂无换算");
    expect(moduleSummary("mapping", docWith({ mappings: [{ rate: 1 }, { rate: 2 }] }))).toBe("2 条换算");
    // 有停用的才写成 `生效 / 总数`
    expect(moduleSummary("mapping", docWith({ mappings: [{ rate: 1 }, { rate: 0 }] }))).toBe("1 / 2 条换算");
    expect(moduleSummary("mapping", docWith({ mappings: [{ rate: 0 }] }))).toBe("0 / 1 条换算");
  });

  it("备注空白时说「空白」", () => {
    expect(moduleSummary("note", docWith({ note: "   \n  " }))).toBe("空白");
  });
});
