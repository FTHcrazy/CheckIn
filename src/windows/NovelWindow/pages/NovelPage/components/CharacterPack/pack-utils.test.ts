import { describe, expect, it } from "vitest";
import { CHANGED_TTL_MS, type PackAttribute, type PackItem, type PackModifier, type PackSkill, type PackSlot } from "./types";
import {
  buildActiveCarriers,
  buildActiveCarriersFrom,
  buildPackMarkdown,
  buildPackTable,
  carrierKeyOf,
  carryRealm,
  capacityStatus,
  castOwnerIds,
  clamp,
  clampRealm,
  computeHypotheticalSummary,
  computeSummary,
  countRecentChanges,
  escapeMarkdownCell,
  formatAttrValue,
  formatRatio,
  formatRealm,
  formatRelativeTime,
  formatWeight,
  hasRecentChange,
  isCounted,
  isExpired,
  itemWeight,
  matchesKeyword,
  normalizeLimit,
  safeText,
  scaleByProficiency,
  sortLadder,
  stepQty,
  summaryDeltas,
  thresholdOf,
  toMarkdownTable,
  totalWeight,
  weightStatus,
  type HypotheticalInput,
  type LadderRung,
  type SummaryResult,
} from "./pack-utils";

function mod(partial: Partial<PackModifier>): PackModifier {
  return {
    id: "m1",
    ownerType: "item",
    ownerId: "i1",
    nature: "passive",
    name: "",
    targetAttrId: "a1",
    op: "add",
    value: 0,
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
    ...partial,
  };
}

function attr(partial: Partial<PackAttribute>): PackAttribute {
  return {
    id: "a1",
    characterId: "c1",
    groupName: "基础属性",
    name: "攻击力",
    baseValue: 0,
    decimals: 0,
    unit: "",
    sortOrder: 1,
    updatedAt: 0,
    ...partial,
  };
}

const LADDER: LadderRung[] = [
  { id: "l1", name: "炼气", rank: 1, subLevels: 9, power: 100 },
  { id: "l2", name: "筑基", rank: 2, subLevels: 9, power: 1000 },
  { id: "l3", name: "金丹", rank: 3, subLevels: 1, power: 10000 },
];

describe("isCounted —— 闸门矩阵（§9.4.1，本功能最易回归的缺陷点）", () => {
  it("cast 型永不参与汇总", () => {
    expect(isCounted(mod({ nature: "cast", trigger: "" }))).toBe(false);
  });

  it("sustained 型开启时计入", () => {
    expect(isCounted(mod({ nature: "sustained", active: true }))).toBe(true);
  });

  it("sustained 型关闭时不计入", () => {
    expect(isCounted(mod({ nature: "sustained", active: false }))).toBe(false);
  });

  it("passive 型带触发条件（事件型）不计入", () => {
    expect(isCounted(mod({ nature: "passive", trigger: "on_damaged" }))).toBe(false);
  });

  it("passive 型无触发条件计入", () => {
    expect(isCounted(mod({ nature: "passive", trigger: "" }))).toBe(true);
  });

  it("同一载体同时带 passive 与 cast —— 只有 passive 计入", () => {
    const passive = mod({ id: "m1", nature: "passive", value: 320 });
    const cast = mod({ id: "m2", nature: "cast", value: 300 });
    expect(isCounted(passive)).toBe(true);
    expect(isCounted(cast)).toBe(false);
  });

  it("条目被禁用时不计入（配置层开关先于性质判断）", () => {
    expect(isCounted(mod({ nature: "passive", disabled: true }))).toBe(false);
    expect(isCounted(mod({ nature: "sustained", active: true, disabled: true }))).toBe(false);
  });
});

describe("computeSummary —— 三段分解与运算优先级（§9.4.2）", () => {
  const attributes: PackAttribute[] = [attr({ id: "a1", baseValue: 1200 })];

  it("加算 → 百分比 → 乘算，被动与持续同池只分段展示", () => {
    const modifiers: PackModifier[] = [
      mod({ id: "m1", nature: "passive", op: "add", value: 320, sortOrder: 1 }),
      mod({
        id: "m2",
        nature: "sustained",
        op: "percent",
        value: 40,
        active: true,
        sortOrder: 2,
      }),
      mod({ id: "m3", nature: "passive", op: "mul", value: 1.1, sortOrder: 3 }),
    ];
    const result = computeSummary({
      attributes,
      modifiers,
      activeCarriers: new Set(["item:i1"]),
      proficiency: {},
    });
    const row = result.byAttr.get("a1")!;
    // (1200 + 320) × 1.4 × 1.1 = 2340.8
    expect(row.final).toBeCloseTo(2340.8, 6);
    expect(row.addPassive).toBe(320);
    expect(row.addSustained).toBe(0);
    expect(row.percentSustained).toBe(40);
    expect(row.mulPassive).toBeCloseTo(1.1, 6);
  });

  it("关掉持续只掉持续贡献，被动纹丝不动（两轴分离关键用例）", () => {
    const passive = mod({ id: "m1", nature: "passive", op: "add", value: 500, sortOrder: 1 });
    const sustained = mod({
      id: "m2",
      nature: "sustained",
      op: "percent",
      value: 40,
      active: true,
      sortOrder: 2,
    });
    const carriers = new Set(["item:i1"]);

    const on = computeSummary({
      attributes,
      modifiers: [passive, sustained],
      activeCarriers: carriers,
      proficiency: {},
    }).byAttr.get("a1")!;
    expect(on.final).toBeCloseTo((1200 + 500) * 1.4, 6);

    const off = computeSummary({
      attributes,
      modifiers: [passive, { ...sustained, active: false }],
      activeCarriers: carriers,
      proficiency: {},
    }).byAttr.get("a1")!;

    expect(off.addPassive).toBe(500); // 被动不受影响
    expect(off.percentSustained).toBe(0); // 持续贡献消失
    expect(off.final).toBeCloseTo(1700, 6);
  });

  it("纯释放型装备装上后属性零变化，但被收集进 casts", () => {
    const modifiers: PackModifier[] = [
      mod({ id: "m1", nature: "cast", value: 300, targetAttrId: "" }),
    ];
    const result = computeSummary({
      attributes,
      modifiers,
      activeCarriers: new Set(["item:i1"]),
      proficiency: {},
    });
    expect(result.byAttr.get("a1")!.final).toBe(1200);
    expect(result.casts).toHaveLength(1);
    expect(result.countedCount).toBe(0);
  });

  it("载体不在效时全部效果不参与（闸门 1）", () => {
    const result = computeSummary({
      attributes,
      modifiers: [mod({ nature: "passive", op: "add", value: 320 })],
      activeCarriers: new Set(),
      proficiency: {},
    });
    expect(result.byAttr.get("a1")!.final).toBe(1200);
  });

  it("override 优先级最高，取 sortOrder 末位并计数告警", () => {
    const result = computeSummary({
      attributes,
      modifiers: [
        mod({ id: "m1", nature: "passive", op: "add", value: 999, sortOrder: 1 }),
        mod({ id: "m2", nature: "passive", op: "override", value: 5000, sortOrder: 2 }),
        mod({ id: "m3", nature: "sustained", op: "override", value: 7000, active: true, sortOrder: 3 }),
      ],
      activeCarriers: new Set(["item:i1"]),
      proficiency: {},
    });
    const row = result.byAttr.get("a1")!;
    expect(row.final).toBe(7000);
    expect(row.overrideCount).toBe(2);
  });

  it("按熟练度缩放的条目随熟练度插值（§9.4.3）", () => {
    const modifiers: PackModifier[] = [
      mod({
        id: "m1",
        ownerType: "skill",
        ownerId: "s1",
        nature: "passive",
        op: "add",
        value: 100,
        scaleByProficiency: true,
      }),
    ];
    const result = computeSummary({
      attributes,
      modifiers,
      activeCarriers: new Set(["skill:s1"]),
      proficiency: { s1: 250 },
      scaling: { maxProficiency: 500, minScale: 0.5, maxScale: 1.5 },
    });
    // lerp(0.5, 1.5, 0.5) = 1.0 → 100 × 1.0
    expect(result.byAttr.get("a1")!.final).toBeCloseTo(1300, 6);
  });

  it("熟练度缩放只对技能宿主生效：装备 / 状态宿主不被 ×0.5 腰斩", () => {
    // `proficiency` 的键是 skill.id。拿装备 id 去查必然落空，若沿用 `?? 0`
    // 就会算出 ratio 0 → factor 取下界 0.5，数值静默腰斩（列表仍显示原始值）
    const [
      { final: skillScaled },
      { final: itemRaw },
    ] = [
      { ownerType: "skill" as const, ownerId: "s1", carriers: ["skill:s1"] },
      { ownerType: "item" as const, ownerId: "i1", carriers: ["item:i1"] },
    ].map(({ ownerType, ownerId, carriers }) =>
      computeSummary({
        attributes,
        modifiers: [
          mod({
            id: "m1",
            ownerType,
            ownerId,
            nature: "passive",
            op: "add",
            value: 100,
            scaleByProficiency: true,
          }),
        ],
        activeCarriers: new Set(carriers),
        proficiency: { s1: 250 },
        scaling: { maxProficiency: 500, minScale: 0.5, maxScale: 1.5 },
      }).byAttr.get("a1")!,
    );

    // 技能宿主：lerp(0.5, 1.5, 0.5) = 1.0
    expect(skillScaled).toBeCloseTo(1300, 6);
    // 非技能宿主：不缩放，老实现这里会给 1250（100 × 0.5）
    expect(itemRaw).toBeCloseTo(1300, 6);
  });

  it("不指向属性的条目（cast 除外）不会污染任何一行", () => {
    const result = computeSummary({
      attributes,
      modifiers: [mod({ nature: "passive", targetAttrId: "", value: 500 })],
      activeCarriers: new Set(["item:i1"]),
      proficiency: {},
    });
    expect(result.byAttr.get("a1")!.final).toBe(1200);
    expect(result.countedCount).toBe(0);
  });
});

describe("buildActiveCarriers —— 闸门 1 的组装", () => {
  const slots = [
    {
      id: "s1",
      characterId: "c1",
      name: "戒指",
      capacity: 2,
      accepts: [] as string[],
      enabled: true,
      note: "",
      sortOrder: 1,
    },
  ];

  it("槽位满员（超出容量）时不再判定为在效", () => {
    const items = [1, 2, 3].map((n) => ({
      id: `i${n}`,
      characterId: "c1",
      name: `戒指${n}`,
      category: "装备",
      qty: 1,
      rarity: "common",
      icon: "",
      desc: "",
      tags: [],
      equippedSlotId: "s1",
      slotIndex: n - 1,
      sourceChapterId: "",
      weight: 0,
      updatedAt: 0,
    }));
    const active = buildActiveCarriers(slots, items, [], []);
    expect(active.size).toBe(0);
  });

  it("accepts 不匹配的穿戴物不被接受", () => {
    const limited = [{ ...slots[0], accepts: ["武器"] }];
    const items = [
      {
        id: "i1",
        characterId: "c1",
        name: "丹药",
        category: "消耗品",
        qty: 1,
        rarity: "common",
        icon: "",
        desc: "",
        tags: [],
        equippedSlotId: "s1",
        slotIndex: 0,
        sourceChapterId: "",
        weight: 0,
        updatedAt: 0,
      },
    ];
    expect(buildActiveCarriers(limited, items, [], []).size).toBe(0);
  });

  it("每条状态各自成键：同组的 passive 不会被 sustained 的开关串扰", () => {
    // 所有 status 效果的 ownerId 都是同一个角色 id，用它当键会让整组折叠成一个
    // 键 —— 全关时 passive 被连坐丢弃、任一 sustained 开着时 passive 开关失效
    const statuses = [
      { id: "m1", active: true },
      { id: "m2", active: false },
    ];
    const active = buildActiveCarriers([], [], [], statuses);
    expect(active.has("status:m1")).toBe(true);
    expect(active.has("status:m2")).toBe(false);
  });
});

describe("carryRealm —— 阶内进位（§9.7.2 缺口③）", () => {
  it("阶内推进：筑基 7 层 +1 → 8 层", () => {
    expect(carryRealm(LADDER, { index: 1, sub: 7 }, 1)).toEqual({ index: 1, sub: 8 });
  });

  it("满层进位：筑基 9 层 +1 → 金丹 1 层", () => {
    expect(carryRealm(LADDER, { index: 1, sub: 9 }, 1)).toEqual({ index: 2, sub: 1 });
  });

  it("顶阶末层再进一次停在原地（不溢出）", () => {
    expect(carryRealm(LADDER, { index: 2, sub: 1 }, 1)).toEqual({ index: 2, sub: 1 });
  });

  it("阶内回退：筑基 1 层 -1 → 炼气 9 层（反向借位）", () => {
    expect(carryRealm(LADDER, { index: 1, sub: 1 }, -1)).toEqual({ index: 0, sub: 9 });
  });

  it("首阶首层再退一次停在原地", () => {
    expect(carryRealm(LADDER, { index: 0, sub: 1 }, -1)).toEqual({ index: 0, sub: 1 });
  });

  it("一次跨越多层：炼气 8 层 +3 → 筑基 2 层", () => {
    expect(carryRealm(LADDER, { index: 0, sub: 8 }, 3)).toEqual({ index: 1, sub: 2 });
  });

  it("无小层的阶显示只带阶名", () => {
    expect(formatRealm(LADDER, { index: 2, sub: 1 })).toBe("金丹");
    expect(formatRealm(LADDER, { index: 1, sub: 7 })).toBe("筑基 7/9");
  });
});

describe("formatRatio —— 进制型换算（D-1 货币）", () => {
  const levels = [
    { name: "金", ratioToBase: 10000 },
    { name: "银", ratioToBase: 100 },
    { name: "铜", ratioToBase: 1 },
  ];

  it("开启自动进位时逐级拆分", () => {
    expect(formatRatio(12350, levels, true)).toBe("1 金 23 银 50 铜");
  });

  it("关闭自动进位时保持原样（铜钱换不成银的设定）", () => {
    expect(formatRatio(12350, levels, false)).toBe("12,350 铜");
  });
});

describe("thresholdOf —— 阈值型（熟练度分级）", () => {
  const levels = [
    { name: "入门", min: 0, max: 99 },
    { name: "熟练", min: 100, max: 499 },
    { name: "大师", min: 500, max: null },
  ];

  it("落在区间内时给出等级名与区间进度", () => {
    const position = thresholdOf(levels, 250)!;
    expect(position.name).toBe("熟练");
    expect(position.progress).toBeCloseTo(150 / 399, 9);
    expect(position.overflow).toBe(false);
  });

  it("低于最低阈值时不给等级名", () => {
    expect(thresholdOf(levels, -5)!.name).toBe("");
  });

  it("末档无上限（500+ 大师）不算溢出，只表达已越档位起点", () => {
    const position = thresholdOf(levels, 800)!;
    expect(position.name).toBe("大师");
    expect(position.overflow).toBe(false);
    expect(position.progress).toBe(1);
  });

  it("末档有上限时超限标注溢出而不是截断（超越体系常态化）", () => {
    const bounded = [
      { name: "入门", min: 0, max: 99 },
      { name: "熟练", min: 100, max: 499 },
    ];
    const position = thresholdOf(bounded, 800)!;
    expect(position.name).toBe("熟练");
    expect(position.overflow).toBe(true);
  });
});

describe("scaleByProficiency", () => {
  it("熟练度为 0 取下界、达上限取上界、居中时插值", () => {
    const scaling = { maxProficiency: 500, minScale: 0.5, maxScale: 1.5 };
    expect(scaleByProficiency(100, 0, scaling)).toBeCloseTo(50, 9);
    expect(scaleByProficiency(100, 500, scaling)).toBeCloseTo(150, 9);
    expect(scaleByProficiency(100, 250, scaling)).toBeCloseTo(100, 9);
    expect(scaleByProficiency(100, 9999, scaling)).toBeCloseTo(150, 9);
  });
});

describe("杂项纯函数（汇总管线的边角：夹取 / 步进 / 匹配 / 格式化）", () => {
  it("clamp：NaN 落到下界而不是把 NaN 传下去", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    // NaN 一路传下去会让属性面板显示「NaN / NaN」，必须夹到下界
    expect(clamp(Number.NaN, 2, 8)).toBe(2);
  });

  it("stepQty：负数与小数都收敛到 ≥0 的整数", () => {
    expect(stepQty(3, 1)).toBe(4);
    expect(stepQty(0, -1)).toBe(0);
    expect(stepQty(2.7, 0)).toBe(2);
    expect(stepQty(1, -2.5)).toBe(0);
  });

  it("matchesKeyword：空关键词全通过，大小写不敏感", () => {
    expect(matchesKeyword("玄铁重剑", "")).toBe(true);
    expect(matchesKeyword("玄铁重剑", "   ")).toBe(true);
    expect(matchesKeyword("玄铁重剑", "重剑")).toBe(true);
    expect(matchesKeyword("Iron Sword", "sword")).toBe(true);
    expect(matchesKeyword("玄铁重剑", "木")).toBe(false);
  });

  it("safeText：空串与 undefined 都回落，不会渲染出空白格", () => {
    expect(safeText("稀有", "—")).toBe("稀有");
    expect(safeText("", "—")).toBe("—");
    expect(safeText(undefined, "—")).toBe("—");
  });

  it("sortLadder 按 rank 升序且不改入参", () => {
    const rungs: LadderRung[] = [
      { id: "c", name: "金丹", rank: 3, subLevels: 1, power: 30 },
      { id: "a", name: "炼气", rank: 1, subLevels: 9, power: 10 },
    ];
    expect(sortLadder(rungs).map((r) => r.name)).toEqual(["炼气", "金丹"]);
    expect(rungs[0].name).toBe("金丹");
  });

  it("clampRealm：空阶梯与越界位置都收敛", () => {
    const ladder: LadderRung[] = [
      { id: "a", name: "炼气", rank: 1, subLevels: 9, power: 10 },
      { id: "b", name: "筑基", rank: 2, subLevels: 3, power: 20 },
    ];
    expect(clampRealm([], { index: 9, sub: 9 })).toEqual({ index: 0, sub: 1 });
    expect(clampRealm(ladder, { index: 99, sub: 99 })).toEqual({
      index: 1,
      sub: 3,
    });
    // sub 不能小于 1（0 会让「第 0 层」出现在界面上）
    expect(clampRealm(ladder, { index: 0, sub: 0 })).toEqual({
      index: 0,
      sub: 1,
    });
  });

  it("castOwnerIds 按宿主类型分组，重复宿主只出现一次", () => {
    // 只传释放型是调用方的责任（本函数不二次判断 nature），
    // 所以这里刻意先按 nature 过滤，模拟真实调用路径
    const mods = [
      mod({ nature: "cast", ownerType: "skill", ownerId: "s1" }),
      mod({ nature: "cast", ownerType: "skill", ownerId: "s1" }),
      mod({ nature: "cast", ownerType: "item", ownerId: "i1" }),
      mod({ nature: "passive", ownerType: "skill", ownerId: "s2" }),
    ];
    const casts = mods.filter((m) => m.nature === "cast");
    expect(castOwnerIds(casts)).toEqual({ skills: ["s1"], items: ["i1"] });
  });

  it("formatAttrValue：千分位 + 小数位夹取（负数的小数位也被夹）", () => {
    expect(formatAttrValue(1234567, 0)).toBe("1,234,567");
    expect(formatAttrValue(1234.5678, 2)).toBe("1,234.57");
    // toFixed(0) 对 -1234.5 取 -1235（JS 的舍入规则），这里只钉「小数位被夹掉」
    expect(formatAttrValue(-1234.5, 0)).toBe("-1,235");
    expect(formatAttrValue(5, 99)).toBe("5.0000");
  });

  it("formatRelativeTime 走行囊口径：超过一天只给天数", () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(now - 30_000, now)).toBe("刚刚");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 小时前");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2 天前");
  });
});

// ─────────────────────────────────────────────────────────────
// 状态效果的载体键（闸门 1 的判定键）
// ─────────────────────────────────────────────────────────────

function statusMod(partial: Partial<PackModifier>): PackModifier {
  // 真实数据里所有 status 效果的 ownerId 都是同一个角色 id（多态表约定）
  return mod({ ownerType: "status", ownerId: "c1", nature: "sustained", ...partial });
}

describe("carrierKeyOf —— 状态效果自己就是载体", () => {
  const attributes = [attr({ id: "a1", baseValue: 100 })];

  it("状态取效果自己的 id，装备 / 技能取 ownerId", () => {
    expect(carrierKeyOf({ id: "m9", ownerType: "status", ownerId: "c1" })).toBe("status:m9");
    expect(carrierKeyOf({ id: "m9", ownerType: "item", ownerId: "i1" })).toBe("item:i1");
    expect(carrierKeyOf({ id: "m9", ownerType: "skill", ownerId: "s1" })).toBe("skill:s1");
  });

  it("开着的状态效果真的计入总属性（曾经被闸门 1 整条丢弃）", () => {
    // 真缺陷：载体集合按 `status:<mod.id>` 建键，computeSummary 却拿 ownerId 去查，
    // 两边永远对不上 → 状态开着、总属性纹丝不动，且不报任何错。
    const status = statusMod({ id: "m1", value: 50, active: true });
    const result = computeSummary({
      attributes,
      modifiers: [status],
      activeCarriers: buildActiveCarriersFrom({
        slots: [],
        items: [],
        skills: [],
        modifiers: [status],
      }),
      proficiency: {},
    });
    expect(result.byAttr.get("a1")!.final).toBe(150);
    expect(result.countedCount).toBe(1);
  });

  it("关掉的状态不计入；同组里另一条开着不会把它的开关架空", () => {
    // 另一种折叠症状：若状态共用 `status:<charId>` 一个键，
    // 「任一条 sustained 开着」会让同组 passive 的开关彻底失效。
    const on = statusMod({ id: "m1", value: 50, active: true });
    const off = statusMod({ id: "m2", value: 70, active: false });
    const result = computeSummary({
      attributes,
      modifiers: [on, off],
      activeCarriers: buildActiveCarriersFrom({
        slots: [],
        items: [],
        skills: [],
        modifiers: [on, off],
      }),
      proficiency: {},
    });
    expect(result.byAttr.get("a1")!.final).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────
// 假想输入（REQ-018 换装预览 / REQ-037 估算模式）
// ─────────────────────────────────────────────────────────────

function item(partial: Partial<PackItem>): PackItem {
  return {
    id: "i1",
    characterId: "c1",
    name: "剑",
    category: "装备",
    qty: 1,
    rarity: "common",
    icon: "",
    desc: "",
    tags: [],
    equippedSlotId: "",
    slotIndex: null,
    sourceChapterId: "",
    weight: 0,
    updatedAt: 0,
    ...partial,
  };
}

function slot(partial: Partial<PackSlot>): PackSlot {
  return {
    id: "s1",
    characterId: "c1",
    name: "武器",
    capacity: 1,
    accepts: [],
    enabled: true,
    note: "",
    sortOrder: 1,
    ...partial,
  };
}

describe("computeHypotheticalSummary —— 预览必须与真实汇总同源", () => {
  const attributes = [attr({ id: "a1", baseValue: 100 })];

  function input(partial: Partial<HypotheticalInput>): HypotheticalInput {
    return {
      attributes,
      slots: [],
      items: [],
      skills: [],
      modifiers: [],
      proficiency: {},
      ...partial,
    };
  }

  it("空位：直接穿上，Δ 等于该装备的效果", () => {
    const sword = item({ id: "i1" });
    const mods = [mod({ id: "m1", ownerType: "item", ownerId: "i1", value: 30 })];
    const before = computeSummary({
      attributes,
      modifiers: mods,
      activeCarriers: buildActiveCarriersFrom({ slots: [], items: [], skills: [], modifiers: mods }),
      proficiency: {},
    });
    const after = computeHypotheticalSummary(
      input({ slots: [slot({})], items: [sword], modifiers: mods }),
      { equip: { itemId: "i1", slotId: "s1" } },
    );
    expect(before.byAttr.get("a1")!.final).toBe(100);
    expect(after.byAttr.get("a1")!.final).toBe(130);
    expect(summaryDeltas(before, after)).toEqual([
      { attrId: "a1", before: 100, after: 130, delta: 30 },
    ]);
  });

  it("满位：顶掉原占用者，不会出现「两件同时生效」", () => {
    // 若只改新物品的 slotIndex，同槽位会同时存在两件，
    // `isItemActive` 的 itemsInSlot.length > capacity 判定让两件双双失效 ——
    // 界面看不出异常，只有总属性悄悄回落。
    const oldSword = item({ id: "i0", equippedSlotId: "s1", slotIndex: 0 });
    const newSword = item({ id: "i1" });
    const mods = [
      mod({ id: "m0", ownerType: "item", ownerId: "i0", value: 20 }),
      mod({ id: "m1", ownerType: "item", ownerId: "i1", value: 30 }),
    ];
    const after = computeHypotheticalSummary(
      input({ slots: [slot({ capacity: 1 })], items: [oldSword, newSword], modifiers: mods }),
      { equip: { itemId: "i1", slotId: "s1" } },
    );
    // 只有新剑的 +30 生效（= 100 + 30），而不是两件都没算或两件都算
    expect(after.byAttr.get("a1")!.final).toBe(130);
    expect(after.countedCount).toBe(1);
  });

  it("临时加成按 status 型叠加（估算模式：不落库也要过两道闸门）", () => {
    const temp = statusMod({ id: "est-1", value: 88, active: true });
    const after = computeHypotheticalSummary(input({}), { extraModifiers: [temp] });
    expect(after.byAttr.get("a1")!.final).toBe(188);
  });

  it("括号里的运算顺序与真实汇总一致（百分比走同一个池）", () => {
    const temp = statusMod({ id: "est-1", op: "percent", value: 50, active: true });
    const after = computeHypotheticalSummary(input({}), { extraModifiers: [temp] });
    expect(after.byAttr.get("a1")!.final).toBe(150);
  });

  it("不改原输入（纯函数）", () => {
    const sword = item({ id: "i1" });
    const slots = [slot({})];
    const source = input({ slots, items: [sword] });
    computeHypotheticalSummary(source, { equip: { itemId: "i1", slotId: "s1" } });
    expect(slots[0]).toEqual(expect.objectContaining({ id: "s1" }));
    expect(source.items[0].equippedSlotId).toBe("");
  });

  it("summaryDeltas 只回传变化非零的行", () => {
    const base = computeSummary({ attributes, modifiers: [], activeCarriers: new Set(), proficiency: {} });
    expect(summaryDeltas(base, base)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 本章变动角标（REQ-028 / F-2）
// ─────────────────────────────────────────────────────────────

describe("hasRecentChange —— 三个条件缺一不可", () => {
  const NOW = 1_700_000_000_000;

  it("24 小时内且晚于已读底线 → 算变动", () => {
    expect(hasRecentChange(NOW - 60_000, 0, NOW)).toBe(true);
  });

  it("超过 24 小时自动过期（不依赖用户点「全部已读」）", () => {
    expect(hasRecentChange(NOW - CHANGED_TTL_MS - 1, 0, NOW)).toBe(false);
    // 边界：正好 24 小时也算过期 —— 窗口左闭右开，否则会出现「永远差一毫秒还在亮」
    expect(hasRecentChange(NOW - CHANGED_TTL_MS, 0, NOW)).toBe(false);
  });

  it("早于「全部已读」底线的条目不再算变动", () => {
    expect(hasRecentChange(NOW - 60_000, NOW - 30_000, NOW)).toBe(false);
  });

  it("时间戳与已读底线相等不算变动（点已读那一毫秒正好也被改过，不能继续亮）", () => {
    expect(hasRecentChange(NOW - 30_000, NOW - 30_000, NOW)).toBe(false);
  });

  it("updatedAt 为 0 / undefined 一律不算：旧数据补列后不能凭空亮角标", () => {
    expect(hasRecentChange(0, 0, NOW)).toBe(false);
    expect(hasRecentChange(undefined, 0, NOW)).toBe(false);
  });

  it("countRecentChanges 只数满足条件的条目", () => {
    const entries = [
      { updatedAt: NOW - 1_000 },
      { updatedAt: NOW - CHANGED_TTL_MS - 1 },
      { updatedAt: 0 },
      {},
    ];
    expect(countRecentChanges(entries, 0, NOW)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 导出为 Markdown 表格（REQ-030 / F-4）
// ─────────────────────────────────────────────────────────────

function skill(partial: Partial<PackSkill>): PackSkill {
  return {
    id: "k1",
    characterId: "c1",
    name: "御剑术",
    desc: "",
    enabled: true,
    proficiencyRaw: 0,
    tags: [],
    sortOrder: 1,
    updatedAt: 0,
    ...partial,
  };
}

/** 组装一份最小导出上下文：只要给定切片，其余给空 */
function exportCtx(partial: Partial<Parameters<typeof buildPackTable>[1]> = {}) {
  const attributes = partial.attributes ?? [attr({ id: "a1", name: "攻击力", baseValue: 100 })];
  const modifiers = partial.modifiers ?? [];
  const summary: SummaryResult =
    partial.summary ??
    computeSummary({
      attributes,
      modifiers,
      activeCarriers: buildActiveCarriersFrom({
        slots: partial.slots ?? [],
        items: partial.items ?? [],
        skills: partial.skills ?? [],
        modifiers,
      }),
      proficiency: {},
    });
  return {
    attributes,
    slots: partial.slots ?? [],
    items: partial.items ?? [],
    skills: partial.skills ?? [],
    modifiers,
    summary,
    proficiencyLevels: partial.proficiencyLevels,
    currency: partial.currency ?? null,
  };
}

describe("Markdown 表格与单元格转义", () => {
  it("表头 + 分隔行 + 数据行的结构", () => {
    expect(toMarkdownTable({ headers: ["a", "b"], rows: [["1", "2"]] })).toBe(
      "| a | b |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  it("竖线被转义：物品名里的 | 不能把表格列数打乱", () => {
    expect(escapeMarkdownCell("双刃|短刀")).toBe("双刃\\|短刀");
    expect(
      toMarkdownTable({ headers: ["名"], rows: [["双刃|短刀"]] }),
    ).toContain("| 双刃\\|短刀 |");
  });

  it("反斜杠先于竖线处理：否则把补上的转义符又转一遍，粘贴出去仍然断列", () => {
    // 源串是「a\|b」：反斜杠 → \\，竖线 → \|，结果为 a\\\|b
    expect(escapeMarkdownCell("a\\|b")).toBe("a\\\\\\|b");
  });

  it("换行折成 <br>：表格单元格里不能出现软换行", () => {
    expect(escapeMarkdownCell("第一行\n第二行")).toBe("第一行<br>第二行");
    expect(escapeMarkdownCell("  去空白  ")).toBe("去空白");
  });
});

describe("buildPackMarkdown —— 各模块的表格口径", () => {
  it("带标题与表格；空模块给一句显式说明而不是只有表头的空壳", () => {
    const md = buildPackMarkdown("status", exportCtx(), "状态效果");
    expect(md).toContain("## 行囊 · 状态效果");
    expect(md).toContain("（暂无内容）");
    expect(md).not.toContain("| --- |");
  });

  it("属性表按 sortOrder 出，并带上分组 / 单位 / 小数位", () => {
    const md = buildPackMarkdown(
      "attributes",
      exportCtx({
        attributes: [
          attr({ id: "a2", name: "防御力", baseValue: 50, sortOrder: 2, unit: "点" }),
          attr({ id: "a1", name: "攻击力", baseValue: 100, sortOrder: 1 }),
        ],
      }),
      "人物属性",
    );
    const lines = md.trim().split("\n");
    // 0=标题 1=空行 2=表头 3=分隔 4、5=数据行
    expect(lines[2]).toContain("分组");
    expect(lines[4]).toContain("攻击力");
    expect(lines[5]).toContain("防御力");
    expect(lines[5]).toContain("点");
  });

  it("物品表带上穿戴部位名（查不到部位时给「已删除的部位」而不是裸 id）", () => {
    const md = buildPackMarkdown(
      "inventory",
      exportCtx({
        slots: [slot({ id: "s1", name: "武器", capacity: 2 })],
        items: [
          item({ id: "i1", name: "风雷双匕", equippedSlotId: "s1", slotIndex: 0, tags: ["武器", "雷"] }),
          item({ id: "i2", name: "野草", equippedSlotId: "s9" }),
        ],
      }),
      "物品栏",
    );
    expect(md).toContain("武器");
    expect(md).toContain("武器 / 雷");
    expect(md).toContain("(已删除的部位)");
  });

  it("装备表每个部位一行，空部位也留在表里（否则「哪儿还空着」看不出来）", () => {
    const table = buildPackTable(
      "equipment",
      exportCtx({
        slots: [
          slot({ id: "s1", name: "武器", capacity: 1 }),
          slot({ id: "s2", name: "护甲", capacity: 1, sortOrder: 2 }),
        ],
        items: [item({ id: "i1", name: "铁剑", equippedSlotId: "s1", slotIndex: 0 })],
      }),
    );
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].join("|")).toContain("铁剑");
    expect(table.rows[1]).toEqual(["护甲", "（空）", "—", "—", "—", "—"]);
  });

  it("技能表在没有熟练度体系时不出「档位」列（列头与数据行数必须一致）", () => {
    const noTier = buildPackTable("skills", exportCtx({ skills: [skill({})] }));
    expect(noTier.headers).not.toContain("档位");
    expect(noTier.rows[0]).toHaveLength(noTier.headers.length);

    const withTier = buildPackTable(
      "skills",
      exportCtx({
        skills: [skill({ proficiencyRaw: 120 })],
        proficiencyLevels: [
          { name: "入门", min: 0, max: 99 },
          { name: "熟练", min: 100, max: 499 },
        ],
      }),
    );
    expect(withTier.headers).toContain("档位");
    expect(withTier.rows[0]).toHaveLength(withTier.headers.length);
    expect(withTier.rows[0]).toContain("熟练");
  });

  it("汇总表把被动 / 持续分开列（与 §9.4.2 的分段口径一致）", () => {
    const attributes = [attr({ id: "a1", name: "攻击力", baseValue: 100 })];
    const modifiers = [
      mod({ id: "m1", ownerType: "item", ownerId: "i1", nature: "passive", value: 30 }),
      mod({ id: "m2", ownerType: "status", ownerId: "c1", nature: "sustained", active: true, value: 20 }),
    ];
    const table = buildPackTable(
      "summary",
      exportCtx({
        attributes,
        slots: [slot({ id: "s1" })],
        items: [item({ id: "i1", equippedSlotId: "s1", slotIndex: 0 })],
        modifiers,
      }),
    );
    expect(table.headers).toContain("被动加算");
    expect(table.headers).toContain("持续加算");
    expect(table.rows[0]).toContain("30");
    expect(table.rows[0]).toContain("20");
    expect(table.rows[0]).toContain("150");
  });

  it("货币表导的是换算体系本身，不是某个余额", () => {
    const table = buildPackTable(
      "currency",
      exportCtx({
        currency: {
          autoCarry: true,
          levels: [
            { name: "金", ratioToBase: 10000 },
            { name: "银", ratioToBase: 100 },
            { name: "铜", ratioToBase: 1 },
          ],
        },
      }),
    );
    expect(table.headers).toEqual(["单位", "进制", "自动进位"]);
    expect(table.rows.map((row) => row[0])).toEqual(["金", "银", "铜"]);
    expect(table.rows[0][1]).toBe("1 金 = 10,000 铜");
    expect(table.rows[2][1]).toContain("基准");
  });

  it("所有模块的数据行宽度都与表头一致（列错位是 Markdown 表最典型的坏法）", () => {
    const ctx = exportCtx({
      slots: [slot({ id: "s1", capacity: 2 })],
      items: [item({ id: "i1", equippedSlotId: "s1", slotIndex: 0 })],
      skills: [skill({})],
      modifiers: [mod({ id: "m1", ownerType: "status", ownerId: "c1" })],
      currency: { autoCarry: false, levels: [{ name: "铜", ratioToBase: 1 }] },
    });
    for (const key of ["summary", "attributes", "equipment", "inventory", "skills", "status", "currency"] as const) {
      const table = buildPackTable(key, ctx);
      for (const row of table.rows) {
        expect(row, `${key} 的某一行列数不对`).toHaveLength(table.headers.length);
      }
    }
  });
});

/**
 * 状态效果时效（REQ-025）
 *
 * 这一组测的是「过期」这件事的**边界语义**，不是某个 if 的分支：
 *  - 过期只对持续型成立（被动是常驻、释放不进汇总，给它们判过期是玄学）；
 *  - 过期**不翻 active**（那是作者的开关，翻了就是工具偷偷改设定，而且不可逆）。
 */
describe("isCounted / isExpired —— 时效闸门（REQ-025）", () => {
  it("持续型：开着且没到 0 才算数；roundsLeft 为 null 视为不限时", () => {
    expect(isCounted(mod({ nature: "sustained", active: true, roundsLeft: null }))).toBe(true);
    expect(isCounted(mod({ nature: "sustained", active: true, roundsLeft: 3 }))).toBe(true);
    expect(isCounted(mod({ nature: "sustained", active: true, roundsLeft: 0 }))).toBe(false);
    expect(isCounted(mod({ nature: "sustained", active: true, roundsLeft: -2 }))).toBe(false);
    // 关着的持续型本来就不计入，与时效无关
    expect(isCounted(mod({ nature: "sustained", active: false, roundsLeft: 9 }))).toBe(false);
  });

  it("被动 / 释放型不适用时效：给它们填回合数不产生任何效果", () => {
    expect(isExpired(mod({ nature: "passive", roundsLeft: 0 }))).toBe(false);
    expect(isExpired(mod({ nature: "cast", roundsLeft: 0 }))).toBe(false);
    expect(isCounted(mod({ nature: "passive", roundsLeft: 0 }))).toBe(true);
  });

  it("过期不翻 active —— 回合数加回来就恢复（工具不该改作者的开关）", () => {
    const expired = mod({ nature: "sustained", active: true, roundsLeft: 0 });
    expect(isExpired(expired)).toBe(true);
    expect(expired.active).toBe(true);
  });

  it("汇总把过期的单列一桶，且不计入 final", () => {
    const attributes = [attr({ id: "a1", baseValue: 100 })];
    const carriers = new Set([carrierKeyOf(mod({ id: "m1", ownerType: "status", ownerId: "c1" }))]);
    const result = computeSummary({
      attributes,
      modifiers: [
        // status 型效果的载体键是**它自己的 id**：ownerId 一律是同一个角色 id
        mod({
          id: "m1",
          ownerType: "status",
          ownerId: "c1",
          nature: "sustained",
          active: true,
          roundsLeft: 0,
          value: 50,
        }),
      ],
      activeCarriers: carriers,
      proficiency: {},
    });
    expect(result.expired).toHaveLength(1);
    expect(result.countedCount).toBe(0);
    expect(result.byAttr.get("a1")?.final).toBe(100);
    // 过期 ≠ 事件型：两者必须分桶（混在一起会误导作者去改触发条件）
    expect(result.eventOnly).toHaveLength(0);
  });
});

/**
 * 负重与容量（REQ-033 / F-5）
 *
 * 「0 = 不限」是这一组的核心：把「不限」和「上限为零」合并的实现在空库上
 * 看不出任何异常，只在作者真的填了重量时集体变红。
 */
describe("weightStatus / capacityStatus —— 负重与容量（REQ-033）", () => {
  it("总重按「单件重量 × 数量」累计，并修掉浮点尾巴", () => {
    const items = [
      item({ id: "i1", weight: 1.1, qty: 2 }),
      item({ id: "i2", weight: 2.2, qty: 1 }),
      item({ id: "i3", weight: 0, qty: 99 }),
    ];
    expect(totalWeight(items)).toBe(4.4);
    expect(itemWeight(items[0])).toBe(2.2);
  });

  it("上限为 0 是「不限」：永远不超载，比例也是 0（不是 Infinity）", () => {
    const status = weightStatus([item({ weight: 999, qty: 3 })], 0);
    expect(status.over).toBe(false);
    expect(status.ratio).toBe(0);
    expect(status.limit).toBe(0);
  });

  it("压在上限上不算超载（> 而不是 >=）—— 有第 20.0 公斤，没有第 41 件", () => {
    expect(weightStatus([item({ weight: 20, qty: 1 })], 20).over).toBe(false);
    expect(weightStatus([item({ weight: 20.5, qty: 1 })], 20).over).toBe(true);
    // 容量反过来：上限 40 格就是第 41 件放不下
    const nine = Array.from({ length: 40 }, (_, index) => item({ id: `i${index}` }));
    expect(capacityStatus(nine, 40).full).toBe(true);
    expect(capacityStatus(nine.slice(0, 39), 40).full).toBe(false);
  });

  it("格数按条目算而不是件数（200 株草药占 1 格）", () => {
    expect(capacityStatus([item({ qty: 200 })], 40).used).toBe(1);
  });

  it("hasWeight 区分「没记重量」与「真的没负重」", () => {
    expect(weightStatus([item({ weight: 0 })], 20).hasWeight).toBe(false);
    expect(weightStatus([item({ weight: 0.1 })], 20).hasWeight).toBe(true);
  });

  it("重量文案去掉尾随零（0.50 → 0.5，3.00 → 3，0 → 0）", () => {
    expect(formatWeight(0)).toBe("0");
    expect(formatWeight(3)).toBe("3");
    expect(formatWeight(0.5)).toBe("0.5");
    expect(formatWeight(12.34)).toBe("12.34");
    expect(formatWeight(31.5)).toBe("31.5");
  });

  it("上限输入规范化：负数 / 非有限数夹到 0，格数取整", () => {
    expect(normalizeLimit(-3)).toBe(0);
    expect(normalizeLimit(-3, true)).toBe(0);
    expect(normalizeLimit(Number.NaN)).toBe(0);
    expect(normalizeLimit(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeLimit(12.5)).toBe(12.5);
    // 格数没有半格
    expect(normalizeLimit(40.9, true)).toBe(40);
  });

  it("物品表导出重量小计，没记重量给「—」而不是 0", () => {
    const ctx = exportCtx({
      items: [item({ id: "i1", name: "玄铁剑", weight: 1.5, qty: 3 }), item({ id: "i2", name: "水囊" })],
    });
    const table = buildPackTable("inventory", ctx);
    expect(table.headers).toContain("重量");
    expect(table.rows[0]).toContain("4.5");
    expect(table.rows[1]).toContain("—");
  });

  it("状态表导出时效：持续型给「剩 N 回合 / 已过期 / 不限时」，被动给「—」", () => {
    const ctx = exportCtx({
      modifiers: [
        mod({ id: "m1", ownerType: "status", ownerId: "c1", nature: "sustained", roundsLeft: 3 }),
        mod({ id: "m2", ownerType: "status", ownerId: "c1", nature: "sustained", roundsLeft: 0 }),
        mod({ id: "m3", ownerType: "status", ownerId: "c1", nature: "sustained", roundsLeft: null }),
        mod({ id: "m4", ownerType: "status", ownerId: "c1", nature: "passive", roundsLeft: 0 }),
      ],
    });
    const table = buildPackTable("status", ctx);
    expect(table.rows[0]).toContain("剩 3 回合");
    expect(table.rows[1]).toContain("已过期");
    expect(table.rows[2]).toContain("不限时");
    expect(table.rows[3]).toContain("—");
  });
});
