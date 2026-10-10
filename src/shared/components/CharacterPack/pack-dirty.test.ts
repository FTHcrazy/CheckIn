import { describe, expect, it } from "vitest";
import { countNetChanges, type DirtyDoc } from "./pack-dirty";

/**
 * 未保存计数口径的测试。
 *
 * 这些用例把用户的原话钉成代码：
 * 「输入框文本变动几次算几次未保存」→ 现在**不再如此**；
 * 「未保存维度为新增 / 修改 / 删除 / 移动属性值的最终变化」→ 见各组用例。
 */

function doc(partial: Partial<DirtyDoc> = {}): DirtyDoc {
  return {
    character: { id: "ch1", workId: "w1", entityId: "", realmAt: "" } as DirtyDoc["character"],
    attributes: [],
    slots: [],
    items: [],
    skills: [],
    modifiers: [],
    unitSystems: [],
    presets: [],
    realmLink: null,
    ...partial,
  };
}

function attr(id: string, name: string, baseValue = 0, extra: Record<string, unknown> = {}) {
  return {
    id,
    characterId: "ch1",
    groupName: "基础",
    name,
    baseValue,
    decimals: 0,
    unit: "",
    sortOrder: 1,
    updatedAt: 0,
    ...extra,
  } as never;
}

function item(id: string, name: string, qty = 1, extra: Record<string, unknown> = {}) {
  return {
    id,
    characterId: "ch1",
    name,
    category: "",
    rarity: "common",
    desc: "",
    tags: [],
    qty,
    weight: 0,
    equippedSlotId: null,
    sortOrder: 1,
    updatedAt: 0,
    ...extra,
  } as never;
}

/**
 * `sortedDoc` 的 helper：给列表按 sortOrder 重排（上面 attr/item 的默认 sortOrder 都是 1，
 * 需要位置用例时显式改写）。
 */

describe("countNetChanges：输入框逐字编辑只算 1 处", () => {
  it("一个字段连改多次（模拟逐字输入）仍只算 1 处", () => {
    const saved = doc({ attributes: [attr("a1", "攻击")] });
    // 「破境丹」三个字 = 三次 updateAttribute({name: ...})
    let cur = doc({ attributes: [attr("a1", "破")] });
    expect(countNetChanges(saved, cur)).toBe(1);
    cur = doc({ attributes: [attr("a1", "破境")] });
    expect(countNetChanges(saved, cur)).toBe(1);
    cur = doc({ attributes: [attr("a1", "破境丹")] });
    expect(countNetChanges(saved, cur)).toBe(1);
  });

  it("改回原值 = 0 处（净变化为零）", () => {
    const saved = doc({ attributes: [attr("a1", "攻击")] });
    // 打了一串又全删回原样
    const cur = doc({ attributes: [attr("a1", "攻击")] });
    expect(countNetChanges(saved, cur)).toBe(0);
  });

  it("updatedAt 变化不算改动（它是打点，不是内容）", () => {
    const saved = doc({ attributes: [attr("a1", "攻击")] });
    const cur = doc({ attributes: [attr("a1", "攻击", 0, { updatedAt: 999 })] });
    expect(countNetChanges(saved, cur)).toBe(0);
  });

  it("两个字段各改一次 = 2 处（不是 2 次按键）", () => {
    const saved = doc({ attributes: [attr("a1", "攻击")] });
    const cur = doc({ attributes: [attr("a1", "攻击", 42)] });
    expect(countNetChanges(saved, cur)).toBe(1);
  });
});

describe("countNetChanges：新增 / 删除 / 修改 / 移动", () => {
  it("新增 2 个条目 = 2 处", () => {
    const saved = doc({ attributes: [attr("a1", "攻击")] });
    const cur = doc({ attributes: [attr("a1", "攻击"), attr("a2", "防御"), attr("a3", "速度")] });
    expect(countNetChanges(saved, cur)).toBe(2);
  });

  it("删除 2 个条目 = 2 处", () => {
    const saved = doc({ attributes: [attr("a1", "攻击"), attr("a2", "防御"), attr("a3", "速度")] });
    const cur = doc({ attributes: [attr("a1", "攻击")] });
    expect(countNetChanges(saved, cur)).toBe(2);
  });

  it("移动排序 = 1 处（一次拖动，不是每行各算一处）", () => {
    const saved = doc({
      attributes: [
        attr("a1", "攻击", 0, { sortOrder: 1 }),
        attr("a2", "防御", 0, { sortOrder: 2 }),
      ],
    });
    const cur = doc({
      attributes: [
        attr("a1", "攻击", 0, { sortOrder: 2 }),
        attr("a2", "防御", 0, { sortOrder: 1 }),
      ],
    });
    expect(countNetChanges(saved, cur)).toBe(1);
  });

  it("新增 + 修改 + 删除 = 3 处（成员变化时顺序位移不重复计「移动」）", () => {
    const saved = doc({
      attributes: [
        attr("a1", "攻击", 0, { sortOrder: 1 }),
        attr("a2", "防御", 0, { sortOrder: 2 }),
        attr("a3", "速度", 0, { sortOrder: 3 }),
      ],
    });
    const cur = doc({
      attributes: [
        // a2 改值（修改）
        attr("a2", "防御", 88, { sortOrder: 1 }),
        // a1 位置换到后面（顺序位移，属于增删的副产物，不另计）
        attr("a1", "攻击", 0, { sortOrder: 2 }),
        // a3 被删（删除）
        // a4 新增（新增）
        attr("a4", "暴击", 0, { sortOrder: 3 }),
      ],
    });
    expect(countNetChanges(saved, cur)).toBe(3);
  });

  it("「移动」四类齐备时是 4 处（成员不变才认定移动）", () => {
    const saved = doc({
      attributes: [
        attr("a1", "攻击", 0, { sortOrder: 1 }),
        attr("a2", "防御", 0, { sortOrder: 2 }),
        attr("a3", "速度", 0, { sortOrder: 3 }),
        attr("a4", "暴击", 0, { sortOrder: 4 }),
      ],
    });
    const cur = doc({
      attributes: [
        // 新增
        attr("a5", "命中", 0, { sortOrder: 5 }),
        // 修改
        attr("a2", "防御", 88, { sortOrder: 2 }),
        // 移动（a1 ↔ a3）
        attr("a3", "速度", 0, { sortOrder: 1 }),
        attr("a1", "攻击", 0, { sortOrder: 3 }),
        attr("a4", "暴击", 0, { sortOrder: 4 }),
      ],
    });
    // 新增 1 + 修改 1 + 成员不一致时顺序不另计 = 2
    expect(countNetChanges(saved, cur)).toBe(2);
  });
});

describe("countNetChanges：纯移动（成员不变）", () => {
  it("成员完全一致时，顺序变化记 1 处移动", () => {
    const saved = doc({
      attributes: [
        attr("a1", "攻击", 0, { sortOrder: 1 }),
        attr("a2", "防御", 0, { sortOrder: 2 }),
      ],
    });
    const cur = doc({
      attributes: [
        attr("a2", "防御", 0, { sortOrder: 1 }),
        attr("a1", "攻击", 0, { sortOrder: 2 }),
      ],
    });
    expect(countNetChanges(saved, cur)).toBe(1);
  });
});

describe("countNetChanges：跨类实体都要计到", () => {
  it("物品 / 技能 / 效果 / 部位 / 量纲 / 方案 的改动都计数", () => {
    const saved = doc({
      items: [item("i1", "铁剑")],
      skills: [{ id: "k1", characterId: "ch1", name: "剑术", enabled: true, proficiencyRaw: 0, updatedAt: 0 } as never],
      modifiers: [{ id: "m1", characterId: "ch1", name: "燃血", ownerType: "status", ownerId: "ch1", nature: "status", enabled: true, updatedAt: 0 } as never],
      slots: [{ id: "s1", characterId: "ch1", name: "主手", enabled: true, capacity: 1, accepts: [], note: "", sortOrder: 1 } as never],
      unitSystems: [{ id: "u1", workId: "w1", name: "货币", kind: "currency", levels: "[]", config: "{}", updatedAt: 0 } as never],
      presets: [{ id: "p1", characterId: "ch1", name: "战备", payload: "{}", updatedAt: 0 } as never],
    });
    const cur = doc({
      items: [item("i1", "铁剑", 3)],                       // 修改
      skills: [],                                            // 删除
      modifiers: [{ id: "m1", characterId: "ch1", name: "燃血", ownerType: "status", ownerId: "ch1", nature: "status", enabled: false, updatedAt: 0 } as never], // 修改
      slots: [{ id: "s1", characterId: "ch1", name: "主手", enabled: true, capacity: 2, accepts: [], note: "", sortOrder: 1 } as never], // 修改
      unitSystems: [{ id: "u2", workId: "w1", name: "熟练度", kind: "threshold", levels: "[]", config: "{}", updatedAt: 0 } as never], // 新增 u2 + 删除 u1
      presets: [],                                           // 删除
    });
    // items 修改 1 + skills 删除 1 + modifiers 修改 1 + slots 修改 1
    // + unitSystems 新增 1 / 删除 1 + presets 删除 1 = 7
    expect(countNetChanges(saved, cur)).toBe(7);
  });

  it("境界关联行的改动算 1 处", () => {
    const saved = doc({ realmLink: null });
    const cur = doc({
      realmLink: { id: "lk", fromType: "character", fromId: "e1", toType: "level", toId: "l2", relation: "当前境界", note: '{"sub":3}' } as never,
    });
    expect(countNetChanges(saved, cur)).toBe(1);
  });

  it("主角绑定（即时落库的那一格）不算未保存改动", () => {
    const saved = doc({
      character: { id: "ch1", workId: "w1", entityId: "", realmAt: "" } as DirtyDoc["character"],
    });
    const cur = doc({
      character: { id: "ch1", workId: "w1", entityId: "e-叶尘", realmAt: "" } as DirtyDoc["character"],
    });
    // 绑定时已经写库了，算进来会让顶栏常亮一个按不掉的角标
    expect(countNetChanges(saved, cur)).toBe(0);
  });
});

describe("countNetChanges：边界", () => {
  it("没有基线（尚未装载）时返回 0，不把整份文档当成全是新增", () => {
    expect(countNetChanges(null, doc({ attributes: [attr("a1", "攻击")] }))).toBe(0);
    expect(countNetChanges(doc(), null)).toBe(0);
  });

  it("同一份文档相比为 0", () => {
    const same = doc({ attributes: [attr("a1", "攻击")], items: [item("i1", "铁剑")] });
    expect(countNetChanges(same, same)).toBe(0);
  });
});
