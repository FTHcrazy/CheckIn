/**
 * 换装方案（REQ-032）纯函数层
 *
 * 方案存的是**映射**（谁穿在哪个部位的哪一格），不是物品快照 —— 物品被改名
 * 甚至是同一件被重新编辑过，方案仍然指向它；物品被删掉时方案也不失效，只是
 * 套用的时候少穿一件并如实报数。存快照会造出第二份「物品」数据，从此两边要
 * 各自维护，而这正是这个模块最不需要的东西。
 *
 * 与 `pack-utils` 的分工：这里只管「方案 ↔ 穿戴状态」的换算，不碰汇总管线。
 */
import { isItemEquipped } from "./pack-utils";
import type { PackItem, PackSlot } from "./types";

/** 方案里的一条穿戴映射 */
export interface PresetEntry {
  itemId: string;
  slotId: string;
  /** 部位内第几个槽位（0 起） */
  slotIndex: number;
}

/**
 * 把当前穿戴状态收成一份方案。
 *
 * **只收真的穿戴上了的**（`isItemEquipped`）：`equippedSlotId` 有值但
 * `slotIndex` 为 null 是中间态（历史上出现过），收进方案会让套用时写回一个
 * 无效组合，表现为「套用了方案但装备栏还是空的」。
 *
 * 排序按 `slotId + slotIndex`：方案文本可比对，存档 diff 也不会因为
 * 物品在数组里换了位置就整体重排。
 */
export function buildPresetPayload(items: PackItem[]): PresetEntry[] {
  return items
    .filter(isItemEquipped)
    .map((item) => ({
      itemId: item.id,
      slotId: item.equippedSlotId,
      slotIndex: item.slotIndex ?? 0,
    }))
    .sort(
      (a, b) =>
        a.slotId.localeCompare(b.slotId) ||
        a.slotIndex - b.slotIndex ||
        a.itemId.localeCompare(b.itemId),
    );
}

/**
 * 解析方案 payload（JSON 字符串）。
 *
 * 顶住任意脏输入：库里的 `payload` 是 TEXT，历史数据或手工改库都可能塞进
 * 别的东西。坏条目**逐条丢弃**而不是整份作废 —— 一条脏数据不该让整个方案
 * 变得不可用（那等于把作者保存的这一套装备弄丢了）。
 */
export function parsePresetPayload(raw: string): PresetEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: PresetEntry[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const itemId = typeof record.itemId === "string" ? record.itemId : "";
    const slotId = typeof record.slotId === "string" ? record.slotId : "";
    const slotIndex = Number(record.slotIndex);
    if (!itemId || !slotId) continue;
    if (!Number.isFinite(slotIndex) || slotIndex < 0) continue;
    out.push({ itemId, slotId, slotIndex: Math.floor(slotIndex) });
  }
  return out;
}

export function serializePresetPayload(entries: PresetEntry[]): string {
  return JSON.stringify(entries);
}

/** 一套方案在当前物品 / 部位下能穿成什么样（用于「套用」前的预览读数） */
export interface PresetReadout {
  /** 方案里的映射总数 */
  total: number;
  /** 能穿上的条数 */
  available: number;
  /** 指向的物品已经不在了 */
  missing: number;
  /** 部位没了 / 部位停用 / 序号超出容量 / 类别不符 / 位置被同方案的另一条占了 */
  broken: number;
}

/**
 * 逐条试穿一遍，**不改数据**。
 *
 * 与 `applyPreset` 共用 `planPreset` 的那个内层判断，所以「预览说 5 件能穿」
 * 和「套用后真的穿上 5 件」不可能对不上 —— 两边各写一遍的话，差异是纯静默的。
 */
function planPreset(
  entries: PresetEntry[],
  items: PackItem[],
  slots: PackSlot[],
): {
  accepted: PresetEntry[];
  missing: number;
  broken: number;
} {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const taken = new Set<string>();
  const accepted: PresetEntry[] = [];
  let missing = 0;
  let broken = 0;

  for (const entry of entries) {
    const item = itemById.get(entry.itemId);
    if (!item) {
      missing += 1;
      continue;
    }
    const slot = slotById.get(entry.slotId);
    if (!slot || !slot.enabled || entry.slotIndex >= Math.max(1, slot.capacity)) {
      broken += 1;
      continue;
    }
    if (slot.accepts.length > 0 && !slot.accepts.includes(item.category)) {
      broken += 1;
      continue;
    }
    const seat = `${entry.slotId}#${entry.slotIndex}`;
    if (taken.has(seat)) {
      // 方案自己内部打架（两条指向同一格）：先到先得，后一条算坏条目。
      // 不能「后者顶掉前者」—— 方案是静态文本，没有「谁更新」这个概念，
      // 静默顶替会让作者每次套用都得到不同结果（取决于解析顺序）。
      broken += 1;
      continue;
    }
    taken.add(seat);
    accepted.push(entry);
  }
  return { accepted, missing, broken };
}

export function readPreset(
  entries: PresetEntry[],
  items: PackItem[],
  slots: PackSlot[],
): PresetReadout {
  const { accepted, missing, broken } = planPreset(entries, items, slots);
  return { total: entries.length, available: accepted.length, missing, broken };
}

export interface ApplyPresetResult {
  /** 套用后的 items（新数组，不改原对象） */
  items: PackItem[];
  /** 真的穿上了几件 */
  applied: number;
  /** 方案里的物品已经不在物品栏 */
  missing: number;
  /** 部位没了 / 停用 / 容量不够 / 类别不符 / 格位打架 */
  broken: number;
}

/**
 * 套用方案：**先全体卸下，再按方案穿**。
 *
 * 「方案 = 一套完整的装束」是作者的直觉：套用「战斗装」就该把「日常装」脱掉。
 * 只做加法会得到「两套叠加」的半成品，而且作者还要自己回头一件件卸 —— 那
 * 还不如手动穿。已卸下的物品**留在物品栏**（`equippedSlotId` 清空，不删行）。
 *
 * `updatedAt` 统一推到 `now`：这一步在作者眼里就是「我换装了」，
 * 不给角标的话，物品栏那几行的变动完全看不见（REQ-028）。
 */
export function applyPreset(
  items: PackItem[],
  entries: PresetEntry[],
  slots: PackSlot[],
  now: number = Date.now(),
): ApplyPresetResult {
  const { accepted, missing, broken } = planPreset(entries, items, slots);
  const seatOf = new Map(accepted.map((entry) => [entry.itemId, entry]));

  const next = items.map((item) => {
    const target = seatOf.get(item.id);
    if (!target) {
      if (!isItemEquipped(item)) return item;
      return { ...item, equippedSlotId: "", slotIndex: null, updatedAt: now };
    }
    if (item.equippedSlotId === target.slotId && item.slotIndex === target.slotIndex) return item;
    return { ...item, equippedSlotId: target.slotId, slotIndex: target.slotIndex, updatedAt: now };
  });

  return { items: next, applied: accepted.length, missing, broken };
}

/**
 * 套用结果 → 一句人话。
 *
 * 放在纯函数层而不是组件里：`usePackPanel` 与将来的独立窗口都要说同一句话，
 * 各拼一遍必然会有一处忘了带「缺了几件」——而那句话的全部价值就是报数。
 */
export function describeApply(result: Pick<ApplyPresetResult, "applied" | "missing" | "broken">): string {
  const parts: string[] = [`已穿上 ${result.applied} 件`];
  if (result.missing > 0) parts.push(`${result.missing} 件物品已不在物品栏`);
  if (result.broken > 0) parts.push(`${result.broken} 条位置已失效`);
  return parts.join(" · ");
}
