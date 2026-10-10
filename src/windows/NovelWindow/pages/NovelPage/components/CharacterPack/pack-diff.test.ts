import { describe, expect, it } from "vitest";
import {
  DIFF_GROUPS,
  diffPackDoc,
  parsePackDiffDoc,
  type PackDiffDoc,
  type PackDiffEntry,
} from "./pack-diff";
import type { LadderRung } from "./pack-utils";
import type {
  PackAttribute,
  PackItem,
  PackModifier,
  PackRealmLinkDTO,
  PackSkill,
  PackSlot,
  PackUnitSystem,
} from "./types";

/**
 * 「与本章初对比」的纯函数层（REQ-029 / F-3）。
 *
 * 最要紧的两组断言：
 *  1. **属性比的是汇总后的值** —— 只改 base 的实现在「换了一件武器」时不会出任何一行，
 *     而那正是作者点开这张表的原因。这条必须由「base 不动、加成变了」的用例钉死。
 *  2. **境界的三态** —— `undefined`（记录里没这一格）与 `""`（当时真的没设过）
 *     含义完全不同；混为一谈就会出现「炼气 1/9 → 筑基 3/9」这种凭空捏造的起点。
 */

const LADDER: LadderRung[] = [
  { id: "l1", name: "炼气", rank: 1, subLevels: 9, power: 100 },
  { id: "l2", name: "筑基", rank: 2, subLevels: 9, power: 1000 },
];

function attr(partial: Partial<PackAttribute> = {}): PackAttribute {
  return {
    id: "a1",
    characterId: "c1",
    groupName: "基础",
    name: "攻击",
    baseValue: 0,
    decimals: 0,
    unit: "",
    sortOrder: 1,
    updatedAt: 0,
    ...partial,
  };
}

function slot(partial: Partial<PackSlot> = {}): PackSlot {
  return {
    id: "s1",
    characterId: "c1",
    name: "主手",
    capacity: 1,
    accepts: [],
    enabled: true,
    note: "",
    sortOrder: 1,
    ...partial,
  };
}

function item(partial: Partial<PackItem> = {}): PackItem {
  return {
    id: "i1",
    characterId: "c1",
    name: "玄铁剑",
    category: "武器",
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

function skill(partial: Partial<PackSkill> = {}): PackSkill {
  return {
    id: "k1",
    characterId: "c1",
    name: "听潮步",
    desc: "",
    enabled: true,
    proficiencyRaw: 0,
    tags: [],
    sortOrder: 1,
    updatedAt: 0,
    ...partial,
  };
}

function mod(partial: Partial<PackModifier> = {}): PackModifier {
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

function unit(partial: Partial<PackUnitSystem> = {}): PackUnitSystem {
  return {
    id: "u1",
    characterId: "c1",
    name: "灵石",
    kind: "ratio",
    levels: "[]",
    config: "",
    isDefault: true,
    sortOrder: 1,
    ...partial,
  };
}

function realmLink(toId: string, sub: number): PackRealmLinkDTO {
  return {
    id: "nl1",
    fromType: "character",
    fromId: "e1",
    toType: "level",
    toId,
    relation: "当前境界",
    note: JSON.stringify({ sub }),
  };
}

/** 默认是一份「空白但可比」的文档：带境界那一格，属性/物品/技能全空 */
function doc(partial: Partial<PackDiffDoc> = {}): PackDiffDoc {
  return {
    attributes: [],
    slots: [],
    items: [],
    skills: [],
    modifiers: [],
    unitSystems: [],
    character: { realmAt: "", entityId: "e1" },
    realmLink: null,
    ...partial,
  };
}

function texts(entries: PackDiffEntry[]): string[] {
  return entries.map((entry) =>
    `${entry.group}/${entry.kind}|${entry.label}|${entry.before}|${entry.after}`,
  );
}

describe("parsePackDiffDoc —— 读不出来就说读不出来", () => {
  it("正常 payload 解出各段", () => {
    const parsed = parsePackDiffDoc(JSON.stringify(doc({ attributes: [attr({ baseValue: 10 })] })));
    expect(parsed?.attributes).toHaveLength(1);
    expect(parsed?.attributes[0].baseValue).toBe(10);
    expect(parsed?.realmLink).toBeNull();
  });

  it("坏 JSON / 非对象 / 缺 attributes 一律 null（不能当成「全被删了」）", () => {
    expect(parsePackDiffDoc("{ 不是 json")).toBeNull();
    expect(parsePackDiffDoc("null")).toBeNull();
    expect(parsePackDiffDoc(JSON.stringify({ items: [] }))).toBeNull();
  });

  it("缺整段的旧记录按空数组兜底，不影响其余组", () => {
    const parsed = parsePackDiffDoc(JSON.stringify({ attributes: [] }));
    expect(parsed).not.toBeNull();
    expect(parsed?.items).toEqual([]);
    expect(parsed?.skills).toEqual([]);
    expect(parsed?.unitSystems).toEqual([]);
  });

  it("「没有 realmLink 这一格」与「这一格是 null」必须能区分", () => {
    const withoutKey = parsePackDiffDoc(JSON.stringify({ attributes: [] }));
    expect(withoutKey && "realmLink" in withoutKey).toBe(false);

    const withNull = parsePackDiffDoc(JSON.stringify({ attributes: [], realmLink: null }));
    expect(withNull && "realmLink" in withNull).toBe(true);
  });
});

describe("属性组 —— 比的是汇总后的值", () => {
  it("base 变了 → 报变更，且带单位", () => {
    const r = diffPackDoc(
      doc({ attributes: [attr({ baseValue: 3400, unit: "点" })] }),
      doc({ attributes: [attr({ baseValue: 3840, unit: "点" })] }),
      LADDER,
    );
    expect(texts(r.entries)).toEqual(["attribute/change|攻击|3,400点|3,840点"]);
  });

  it("base 不动、只是加成的载体生效 → 同样要报（换武器的场景）", () => {
    const equipped = item({ equippedSlotId: "s1", slotIndex: 0 });
    const r = diffPackDoc(
      doc({ attributes: [attr({ baseValue: 100 })] }),
      doc({
        attributes: [attr({ baseValue: 100 })],
        slots: [slot()],
        items: [equipped],
        modifiers: [mod({ value: 320 })],
      }),
      LADDER,
    );
    // 物品组也会同时报一条「获得玄铁剑」，这里只看属性组
    expect(texts(r.entries.filter((entry) => entry.group === "attribute"))).toEqual([
      "attribute/change|攻击|100|420",
    ]);
  });

  it("数值只差格式化噪声时不报（不出现「3,400 → 3,400」）", () => {
    const r = diffPackDoc(
      doc({ attributes: [attr({ baseValue: 3400 })] }),
      doc({ attributes: [attr({ baseValue: 3400.0001 })] }),
      LADDER,
    );
    expect(r.entries).toEqual([]);
  });

  it("属性增 / 删各自成行，删除排在最后", () => {
    const r = diffPackDoc(
      doc({ attributes: [attr({ id: "a1", name: "攻击", baseValue: 10 })] }),
      doc({ attributes: [attr({ id: "a2", name: "幸运", baseValue: 5 })] }),
      LADDER,
    );
    expect(texts(r.entries)).toEqual([
      "attribute/add|幸运||5",
      "attribute/remove|攻击|10|",
    ]);
  });
});

describe("物品组与穿戴组", () => {
  it("获得 / 用尽 / 数量变化分三种行", () => {
    const r = diffPackDoc(
      doc({
        items: [
          item({ id: "i1", name: "灵石", qty: 5 }),
          item({ id: "i2", name: "破境丹", qty: 2 }),
        ],
      }),
      doc({
        items: [
          item({ id: "i1", name: "灵石", qty: 3 }),
          item({ id: "i3", name: "符纸", qty: 1 }),
        ],
      }),
      LADDER,
    );
    expect(texts(r.entries)).toEqual([
      "item/change|灵石|×5|×3",
      "item/add|符纸||×1",
      "item/remove|破境丹|×2|",
    ]);
  });

  it("穿戴变化报成「部位 → 部位」，未穿戴用可读文案", () => {
    const r = diffPackDoc(
      doc({ slots: [slot()], items: [item({ qty: 1 })] }),
      doc({ slots: [slot()], items: [item({ equippedSlotId: "s1", slotIndex: 0 })] }),
      LADDER,
    );
    expect(texts(r.entries)).toEqual(["equip/change|玄铁剑|未穿戴|主手"]);
  });

  it("新物品由物品组负责，不在穿戴组重复报一次", () => {
    const r = diffPackDoc(
      doc({ slots: [slot()] }),
      doc({
        slots: [slot()],
        items: [item({ equippedSlotId: "s1", slotIndex: 0 })],
      }),
      LADDER,
    );
    expect(r.entries.filter((entry) => entry.group === "equip")).toEqual([]);
    expect(r.entries.filter((entry) => entry.group === "item")).toHaveLength(1);
  });
});

describe("技能组", () => {
  it("学会 / 停用 / 熟练度各自成行", () => {
    const r = diffPackDoc(
      doc({ skills: [skill({ id: "k1", name: "听潮步", enabled: true, proficiencyRaw: 120 })] }),
      doc({
        skills: [
          skill({ id: "k1", name: "听潮步", enabled: false, proficiencyRaw: 260 }),
          skill({ id: "k2", name: "御火术" }),
        ],
      }),
      LADDER,
    );
    expect(texts(r.entries)).toEqual([
      "skill/change|听潮步|在用|已停用",
      "skill/change|听潮步 熟练度|120|260",
      "skill/add|御火术||",
    ]);
  });
});

describe("主动效果组 —— 只有 cast 进这张表", () => {
  it("新增主动效果带参数文案", () => {
    const r = diffPackDoc(
      doc(),
      doc({
        modifiers: [
          mod({
            nature: "cast",
            name: "风雷一击",
            value: 300,
            valueUnit: "攻击力%",
            cooldown: 12,
            target: "单体",
          }),
        ],
      }),
      LADDER,
    );
    expect(texts(r.entries)).toEqual(["cast/add|风雷一击||300攻击力% · CD 12s · 单体"]);
  });

  it("参数改动整串比较（CD 改了也报）", () => {
    const before = mod({ nature: "cast", name: "风雷一击", value: 300, valueUnit: "攻击力%", cooldown: 12 });
    const after = mod({ nature: "cast", name: "风雷一击", value: 300, valueUnit: "攻击力%", cooldown: 8 });
    const r = diffPackDoc(doc({ modifiers: [before] }), doc({ modifiers: [after] }), LADDER);
    expect(texts(r.entries)).toEqual(["cast/change|风雷一击|300攻击力% · CD 12s|300攻击力% · CD 8s"]);
  });

  it("被动/持续的改动不进这张表（已由属性组以汇总值体现）", () => {
    const r = diffPackDoc(
      doc({ attributes: [attr()], modifiers: [mod({ value: 10 })], slots: [slot()], items: [item({ equippedSlotId: "s1", slotIndex: 0 })] }),
      doc({ attributes: [attr()], modifiers: [mod({ value: 20 })], slots: [slot()], items: [item({ equippedSlotId: "s1", slotIndex: 0 })] }),
      LADDER,
    );
    expect(r.entries.filter((entry) => entry.group === "cast")).toEqual([]);
    expect(texts(r.entries)).toEqual(["attribute/change|攻击|10|20"]);
  });
});

describe("境界组 —— 三态不能混", () => {
  it("绑定实体时从关联行读（realm_at 在绑定态下是空的）", () => {
    const r = diffPackDoc(
      doc({ realmLink: realmLink("l1", 3) }),
      doc({ realmLink: realmLink("l2", 7) }),
      LADDER,
    );
    expect(texts(r.entries)).toEqual(["realm/change|境界|炼气 3/9|筑基 7/9"]);
  });

  it("境界从无到有 → 是「新增」，而不是拿第一阶冒充起点", () => {
    const r = diffPackDoc(doc({ realmLink: null }), doc({ realmLink: realmLink("l2", 7) }), LADDER);
    expect(texts(r.entries)).toEqual(["realm/add|境界||筑基 7/9"]);
  });

  it("记录里没存这一格（旧记录）→ 整组跳过，不凭空造起点", () => {
    const past = doc();
    delete past.realmLink;
    const r = diffPackDoc(past, doc({ realmLink: realmLink("l2", 7) }), LADDER);
    expect(r.entries.filter((entry) => entry.group === "realm")).toEqual([]);
  });

  it("没有等级体系时整组不做（无从生成文案）", () => {
    const r = diffPackDoc(
      doc({ realmLink: realmLink("l1", 3) }),
      doc({ realmLink: realmLink("l2", 7) }),
      [],
    );
    expect(r.entries.filter((entry) => entry.group === "realm")).toEqual([]);
  });

  it("未绑定实体时读行囊自持的 realm_at", () => {
    const unbound = (levelId: string) =>
      doc({
        character: { realmAt: JSON.stringify({ levelId, sub: 5 }), entityId: "" },
        realmLink: null,
      });
    const r = diffPackDoc(unbound("l1"), unbound("l2"), LADDER);
    expect(texts(r.entries)).toEqual(["realm/change|境界|炼气 5/9|筑基 5/9"]);
  });
});

describe("设置组", () => {
  it("部位容量与量纲换算都进「设置」", () => {
    const r = diffPackDoc(
      doc({ slots: [slot({ capacity: 1 })], unitSystems: [unit({ levels: "[1]" })] }),
      doc({ slots: [slot({ capacity: 2 })], unitSystems: [unit({ levels: "[2]" })] }),
      LADDER,
    );
    expect(texts(r.entries)).toEqual([
      "setting/change|部位 主手 容量|1|2",
      "setting/change|量纲 灵石||换算已调整",
    ]);
  });
});

describe("分组与排序", () => {
  it("空组不出现，非空组顺序固定（境界 → 属性 → 穿戴 → 物品 → 技能 → 主动 → 设置）", () => {
    const r = diffPackDoc(
      doc({
        attributes: [attr({ baseValue: 1 })],
        items: [item({ id: "i2", name: "灵石", qty: 1 })],
        realmLink: realmLink("l1", 1),
      }),
      doc({
        attributes: [attr({ baseValue: 2 })],
        items: [item({ id: "i2", name: "灵石", qty: 2 })],
        skills: [skill()],
        realmLink: realmLink("l2", 1),
      }),
      LADDER,
    );
    expect(r.buckets.map((bucket) => bucket.group)).toEqual([
      "realm",
      "attribute",
      "item",
      "skill",
    ]);
    // 每个分组都能在 DIFF_GROUPS 里找到位置 → 分组名没有笔误
    for (const bucket of r.buckets) expect(DIFF_GROUPS).toContain(bucket.group);
    expect(r.total).toBe(r.entries.length);
  });

  it("两份完全一样的文档 → 一条都不报", () => {
    const same = doc({
      attributes: [attr({ baseValue: 100 })],
      slots: [slot()],
      items: [item({ equippedSlotId: "s1", slotIndex: 0 })],
      skills: [skill()],
      modifiers: [mod({ nature: "cast", value: 300, valueUnit: "攻击力%" })],
      unitSystems: [unit()],
      realmLink: realmLink("l1", 1),
    });
    expect(diffPackDoc(same, same, LADDER).total).toBe(0);
  });
});
