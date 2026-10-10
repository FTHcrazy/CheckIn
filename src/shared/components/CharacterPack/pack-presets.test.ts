import { describe, expect, it } from "vitest";
import {
  applyPreset,
  buildPresetPayload,
  describeApply,
  parsePresetPayload,
  readPreset,
  serializePresetPayload,
} from "./pack-presets";
import type { PackItem, PackSlot } from "./types";

/**
 * 换装方案（REQ-032）纯函数层
 *
 * 这一组的重点是两类**静默失败**：
 *  - 方案存的是映射而不是物品快照 → 物品被删/被改之后方案必须仍然可读，
 *    并且套用时如实报数，而不是整个方案变成不可用；
 *  - 「方案 = 一整套装束」→ 套用必须先全体卸下。只做加法的实现看起来
 *    「也能穿上」，但会留下两套叠加的半成品，作者得自己回头一件件脱。
 */
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

describe("buildPresetPayload —— 收方案", () => {
  it("只收真的穿上了的（半个穿戴状态不收）", () => {
    const payload = buildPresetPayload([
      item({ id: "i1", equippedSlotId: "s1", slotIndex: 0 }),
      // equippedSlotId 有值但 slotIndex 为 null 是中间态：收进去会写回无效组合
      item({ id: "i2", equippedSlotId: "s1", slotIndex: null }),
      item({ id: "i3" }),
    ]);
    expect(payload).toEqual([{ itemId: "i1", slotId: "s1", slotIndex: 0 }]);
  });

  it("按部位 + 序号排序（方案文本可比对，diff 不会因为数组换位而整体重排）", () => {
    const payload = buildPresetPayload([
      item({ id: "i2", equippedSlotId: "s2", slotIndex: 0 }),
      item({ id: "i1", equippedSlotId: "s1", slotIndex: 0 }),
    ]);
    expect(payload.map((entry) => entry.itemId)).toEqual(["i1", "i2"]);
  });
});

describe("parsePresetPayload —— 顶住脏数据", () => {
  it("非 JSON / 非数组 → 空列表，而不是抛异常", () => {
    expect(parsePresetPayload("")).toEqual([]);
    expect(parsePresetPayload("{")).toEqual([]);
    expect(parsePresetPayload('{"a":1}')).toEqual([]);
  });

  it("坏条目逐条丢弃，好条目仍然可用（一条脏数据不该毁掉整个方案）", () => {
    const raw = JSON.stringify([
      { itemId: "i1", slotId: "s1", slotIndex: 0 },
      { itemId: "", slotId: "s1", slotIndex: 0 },
      { itemId: "i2", slotId: "s1", slotIndex: -1 },
      { itemId: "i3", slotId: "s1", slotIndex: 2.7 },
      null,
      "x",
    ]);
    expect(parsePresetPayload(raw)).toEqual([
      { itemId: "i1", slotId: "s1", slotIndex: 0 },
      { itemId: "i3", slotId: "s1", slotIndex: 2 },
    ]);
  });

  it("序列化 → 解析是恒等变换（round-trip）", () => {
    const entries = [{ itemId: "i1", slotId: "s1", slotIndex: 1 }];
    expect(parsePresetPayload(serializePresetPayload(entries))).toEqual(entries);
  });
});

describe("applyPreset —— 先全体卸下，再按方案穿", () => {
  const slots = [slot({ id: "s1", capacity: 2, accepts: ["装备"] }), slot({ id: "s2" })];

  it("不在方案里的东西会被卸下（方案 = 一整套装束）", () => {
    const items = [
      item({ id: "i1", category: "装备" }),
      item({ id: "i9", equippedSlotId: "s1", slotIndex: 1 }),
    ];
    const result = applyPreset(items, [{ itemId: "i1", slotId: "s1", slotIndex: 0 }], slots, 1000);
    expect(result.applied).toBe(1);
    expect(result.items.find((entry) => entry.id === "i9")).toMatchObject({
      equippedSlotId: "",
      slotIndex: null,
      updatedAt: 1000,
    });
    expect(result.items.find((entry) => entry.id === "i1")).toMatchObject({
      equippedSlotId: "s1",
      slotIndex: 0,
    });
  });

  it("物品被删掉时跳过并报数，方案本身仍然可用", () => {
    const items = [item({ id: "i1", category: "装备" })];
    const result = applyPreset(
      items,
      [
        { itemId: "i1", slotId: "s1", slotIndex: 0 },
        { itemId: "i404", slotId: "s1", slotIndex: 1 },
      ],
      slots,
      1000,
    );
    expect(result.applied).toBe(1);
    expect(result.missing).toBe(1);
    expect(result.broken).toBe(0);
  });

  it("每一类失效都算 broken：部位停用 / 超出容量 / 类别不符 / 格位打架", () => {
    const items = [
      item({ id: "i1", category: "装备" }),
      item({ id: "i2", category: "装备" }),
      item({ id: "i3", category: "丹药" }),
    ];
    const result = applyPreset(
      items,
      [
        { itemId: "i1", slotId: "s1", slotIndex: 0 },
        // 和上一条抢同一格
        { itemId: "i2", slotId: "s1", slotIndex: 0 },
        // accepts 只收「装备」
        { itemId: "i3", slotId: "s1", slotIndex: 1 },
        // 容量 2，序号 5 越界
        { itemId: "i2", slotId: "s1", slotIndex: 5 },
        // 部位不存在
        { itemId: "i2", slotId: "s404", slotIndex: 0 },
      ],
      slots,
      1000,
    );
    expect(result.applied).toBe(1);
    expect(result.broken).toBe(4);
  });

  it("部位停用时那一件穿不上（停用是作者的显式选择）", () => {
    const result = applyPreset(
      [item({ id: "i1", category: "装备" })],
      [{ itemId: "i1", slotId: "s1", slotIndex: 0 }],
      [slot({ id: "s1", enabled: false })],
      1000,
    );
    expect(result.applied).toBe(0);
    expect(result.broken).toBe(1);
  });

  it("不改原数组（纯函数，别把作者的文档就地改坏）", () => {
    const items = [item({ id: "i1", category: "装备" })];
    const snapshot = JSON.stringify(items);
    applyPreset(items, [{ itemId: "i1", slotId: "s1", slotIndex: 0 }], slots, 1000);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe("readPreset / describeApply —— 说人话", () => {
  it("读数与套用结果同源（预览说能穿几件，套用后就真穿上几件）", () => {
    const items = [item({ id: "i1", category: "装备" })];
    const entries = [
      { itemId: "i1", slotId: "s1", slotIndex: 0 },
      { itemId: "i404", slotId: "s1", slotIndex: 1 },
    ];
    const slots = [slot({ id: "s1", capacity: 2, accepts: ["装备"] })];
    const readout = readPreset(entries, items, slots);
    const applied = applyPreset(items, entries, slots, 1000);
    expect(readout).toMatchObject({ total: 2, available: 1, missing: 1, broken: 0 });
    expect(applied.applied).toBe(readout.available);
    expect(applied.missing).toBe(readout.missing);
    expect(applied.broken).toBe(readout.broken);
  });

  it("文案一定带上「缺了几件 / 几条失效」，报数才是它的全部价值", () => {
    expect(describeApply({ applied: 5, missing: 0, broken: 0 })).toBe("已穿上 5 件");
    expect(describeApply({ applied: 3, missing: 2, broken: 1 })).toBe(
      "已穿上 3 件 · 2 件物品已不在物品栏 · 1 条位置已失效",
    );
  });
});
