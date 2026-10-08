import { describe, expect, it } from "vitest";
import type { PackAttribute, PackModifier } from "./types";
import {
  buildActiveCarriers,
  carryRealm,
  computeSummary,
  formatRatio,
  formatRealm,
  isCounted,
  scaleByProficiency,
  thresholdOf,
  type LadderRung,
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
