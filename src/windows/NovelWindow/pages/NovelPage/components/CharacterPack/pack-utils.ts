/**
 * 行囊纯函数层（PRD §9.4 汇总管线 / §9.3 量纲模型 / §9.7 阶内进位）
 *
 * 全部为「参数进、结果出」的纯函数，不触碰 IPC 与 DOM —— 便于单测覆盖，
 * 也让汇总管线是唯一可反查明细的实现（REQ-017）。
 */
import { formatRelativeTime as relativeTime } from "@/shared/utils/format";
import {
  CHANGED_TTL_MS,
  NATURE_META,
  OP_META,
  RARITY_META,
  type PackAttribute,
  type PackItem,
  type PackModifier,
  type PackNature,
  type PackSkill,
  type PackSlot,
} from "./types";

export const CARRIER_DELIM = ":";

/** 载体标识（闸门 1 的判定单位）：`item:i1` / `skill:s2` / `status:m3` */
export function carrierKey(ownerType: string, ownerId: string): string {
  return `${ownerType}${CARRIER_DELIM}${ownerId}`;
}

/**
 * 一条效果「挂在哪个载体上」——闸门 1 的**唯一**判定键。
 *
 * ⚠️ 状态效果是「自己就是载体」，键取 **效果自己的 id**，不能取 `ownerId`：
 * 多态表约定下所有 status 效果的 `ownerId` 都是同一个角色 id，用它当键会把整组
 * 折叠成一个 `status:<charId>` —— 而 `buildActiveCarriers` 是按 `mod.id` 建的键，
 * 两边永远对不上，于是状态效果被闸门 1 整条丢弃（表现为「状态开着，总属性纹丝不动」，
 * 实测 final 恒等于基础值）。判定键必须只有一个产出点，否则两侧各写一遍必然分叉。
 */
export function carrierKeyOf(mod: Pick<PackModifier, "id" | "ownerType" | "ownerId">): string {
  return mod.ownerType === "status"
    ? carrierKey("status", mod.id)
    : carrierKey(mod.ownerType, mod.ownerId);
}

// ─────────────────────────────────────────────────────────────
// 闸门 2：效果性质是否允许计入（§9.4.1）
// ─────────────────────────────────────────────────────────────

/**
 * 两道闸门的第二道：这条效果「有没有资格」参与属性汇总。
 *
 * 判定优先级（必须按此顺序，否则 cast 会被算进总属性 —— 视觉上毫无异常，
 * 只有对着数字才发现，是本功能最易回归的缺陷点）：
 *   cast                        → 否（永不参与汇总）
 *   sustained                   → 看 active（效果自己的开关）
 *   passive + 有 trigger        → 否（事件型，不修改常驻属性）
 *   其余（passive 无 trigger）  → 是
 *
 * 注意：`disabled`（条目临时禁用）是配置层的开关，先于性质判断。
 *
 * 时效（REQ-025）也在这里判，而不是在组件里各写一遍：过期是「还算不算数」的
 * 同一类判断，散出去就会出现「列表里画着已过期、汇总里还在加」的静默分裂。
 */
export function isCounted(mod: PackModifier): boolean {
  if (mod.disabled) return false;
  if (mod.nature === "cast") return false;
  if (mod.nature === "sustained") return mod.active === true && !isExpired(mod);
  if (mod.nature === "passive" && mod.trigger) return false;
  return true;
}

/**
 * 时效是否已耗尽（REQ-025）。
 *
 * 只有「持续型」有时效：被动是常驻，释放型本来就不进汇总，给它们判过期只会
 * 让作者在表单里填的回合数产生玄学效果。
 *
 * ⚠️ 判过期**不翻 `active`**。`active` 是作者的开关（「这一条现在开着」），
 * 工具擅自把它关掉属于偷偷改设定 —— 而且不可逆：改成 0 之后就再也看不出
 * 作者原本开着它。过期的唯一后果是「暂时不计入汇总」，回合数加回去就恢复。
 *
 * `null` / `undefined`（旧数据、新建的条目）一律视为不限时。
 */
export function isExpired(mod: PackModifier): boolean {
  if (mod.nature !== "sustained") return false;
  if (mod.roundsLeft === null || mod.roundsLeft === undefined) return false;
  return mod.roundsLeft <= 0;
}

/** 载体（装备 / 技能 / 状态）是否在效（§9.4.1 闸门 1） */
export function isItemEquipped(item: PackItem): boolean {
  return item.equippedSlotId !== "" && item.slotIndex !== null;
}

/** 闸门 1：按部位配置判定某物品是否真的穿得上（容量与 accepts 都满足） */
export function isItemActive(
  item: PackItem,
  slots: PackSlot[],
  itemsInSlot: PackItem[],
): boolean {
  if (!isItemEquipped(item)) return false;
  const slot = slots.find((candidate) => candidate.id === item.equippedSlotId);
  if (!slot || !slot.enabled) return false;
  if (slot.capacity < 1) return false;
  if (itemsInSlot.length > slot.capacity) return false;
  if (slot.accepts.length > 0 && !slot.accepts.includes(item.category)) return false;
  return true;
}

/** 汇总当前「在效载体」集合，供 computeSummary 的闸门 1 使用 */
export function buildActiveCarriers(
  slots: PackSlot[],
  items: PackItem[],
  skills: PackSkill[],
  statuses: Array<{ id: string; active: boolean }>,
): Set<string> {
  const active = new Set<string>();
  for (const slot of slots) {
    if (!slot.enabled) continue;
    const occupants = items.filter((item) => item.equippedSlotId === slot.id);
    for (const item of occupants) {
      if (isItemActive(item, slots, occupants)) active.add(carrierKey("item", item.id));
    }
  }
  for (const skill of skills) {
    if (skill.enabled) active.add(carrierKey("skill", skill.id));
  }
  for (const status of statuses) {
    if (status.active) active.add(carrierKey("status", status.id));
  }
  return active;
}

/**
 * 从文档切片组装闸门 1 的载体集合。
 *
 * 面板的实时汇总与预览的假想汇总**必须**走这同一个组装口径：各写一遍的话，
 * 只要有一侧忘了「状态取 mod.id」（就是 `carrierKeyOf` 注释里那个洞），
 * 预览与真实值就会长期不一致，而且是纯静默的。
 */
export function buildActiveCarriersFrom(parts: {
  slots: PackSlot[];
  items: PackItem[];
  skills: PackSkill[];
  modifiers: PackModifier[];
}): Set<string> {
  return buildActiveCarriers(
    parts.slots,
    parts.items,
    parts.skills,
    parts.modifiers
      .filter((mod) => mod.ownerType === "status")
      .map((mod) => ({ id: mod.id, active: mod.active })),
  );
}

// ─────────────────────────────────────────────────────────────
// 熟练度缩放（§9.4.3）
// ─────────────────────────────────────────────────────────────

export interface ProficiencyScaling {
  /** 达到上限的熟练度原始值 */
  maxProficiency: number;
  /** 熟练度为 0 时的缩放系数 */
  minScale: number;
  /** 熟练度达上限时的缩放系数 */
  maxScale: number;
}

export const DEFAULT_SCALING: ProficiencyScaling = {
  maxProficiency: 500,
  minScale: 0.5,
  maxScale: 1.5,
};

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** scaled = value × lerp(minScale, maxScale, clamp(prof / maxProf, 0, 1)) */
export function scaleByProficiency(
  value: number,
  proficiency: number,
  scaling: ProficiencyScaling,
): number {
  const max = scaling.maxProficiency > 0 ? scaling.maxProficiency : 1;
  const ratio = clamp(proficiency / max, 0, 1);
  const factor = scaling.minScale + (scaling.maxScale - scaling.minScale) * ratio;
  return value * factor;
}

// ─────────────────────────────────────────────────────────────
// 汇总管线（§9.4.1 / §9.4.2 / §9.4.4）
// ─────────────────────────────────────────────────────────────

export interface SummaryContribution {
  modifierId: string;
  ownerType: string;
  ownerId: string;
  /** 该条最终实际参与计算的数值（含熟练度缩放） */
  applied: number;
  nature: PackNature;
  op: PackModifier["op"];
}

export interface SummaryRow {
  attrId: string;
  base: number;
  final: number;
  addPassive: number;
  addSustained: number;
  percentPassive: number;
  percentSustained: number;
  mulPassive: number;
  mulSustained: number;
  /** 命中的覆盖值（多条时取 sortOrder 末位，并在明细中给出警示） */
  override: number | null;
  overrideCount: number;
  /** 逐条明细（已通过两道闸门） */
  contributions: SummaryContribution[];
}

export interface SummaryResult {
  rows: SummaryRow[];
  byAttr: Map<string, SummaryRow>;
  /** 释放型效果（不计入属性，供「另有 N 项主动技能」提示行） */
  casts: PackModifier[];
  /** 被动但带触发条件（事件型）而不计入的条目 */
  eventOnly: PackModifier[];
  /**
   * 因时效耗尽而暂时不计入的持续型效果（REQ-025）。
   *
   * 单列一桶而不是塞进 `eventOnly`：那两者对作者意味着完全不同的两件事 ——
   * 「到 0 回合了」是**期望内**的暂停（把回合数加回去就好），
   * 「带触发条件」是**设计如此**（它本来就不该进汇总）。
   * 混在一起写提示，作者会以为自己的触发条件设错了。
   */
  expired: PackModifier[];
  /** 参与计算的贡献条数（埋点 / 性能观测用） */
  countedCount: number;
}

export interface SummaryInput {
  attributes: PackAttribute[];
  modifiers: PackModifier[];
  /** 闸门 1：在效载体 id 集合（carrierKey 形式） */
  activeCarriers: Set<string>;
  /** 技能熟练度原始值：skillId → value */
  proficiency: Record<string, number>;
  scaling?: ProficiencyScaling;
}

const DEFAULT_MUL = 1;

/**
 * 总属性汇总。
 *
 * final = (base + Σadd_被动 + Σadd_持续)
 *         × (1 + (Σpercent_被动 + Σpercent_持续) / 100)
 *         × Π mul_被动 × Π mul_持续
 *
 * 被动与持续是**同一个运算池**，只在展示层分段（§9.4.2）——
 * 拆成两轮乘算会算出与作者预期不符的结果，这里刻意不拆。
 */
export function computeSummary(input: SummaryInput): SummaryResult {
  const scaling = input.scaling ?? DEFAULT_SCALING;
  const rows = new Map<string, SummaryRow>();
  for (const attr of input.attributes) {
    rows.set(attr.id, {
      attrId: attr.id,
      base: attr.baseValue,
      final: attr.baseValue,
      addPassive: 0,
      addSustained: 0,
      percentPassive: 0,
      percentSustained: 0,
      mulPassive: DEFAULT_MUL,
      mulSustained: DEFAULT_MUL,
      override: null,
      overrideCount: 0,
      contributions: [],
    });
  }

  const casts: PackModifier[] = [];
  const eventOnly: PackModifier[] = [];
  const expired: PackModifier[] = [];
  let countedCount = 0;

  const ordered = [...input.modifiers].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const mod of ordered) {
    if (mod.disabled) continue;
    // 释放型：收集起来供提示行，绝不进入算式（§9.2.1 边界判断）
    if (mod.nature === "cast") {
      casts.push(mod);
      continue;
    }
    if (mod.nature === "passive" && mod.trigger) {
      eventOnly.push(mod);
      continue;
    }
    // 闸门 1：载体在效。判定键只从 `carrierKeyOf` 来 —— 状态效果用它自己的 id，
    // 装备 / 技能用 ownerId（见该函数的注释：两侧各写一遍必然分叉）。
    if (!input.activeCarriers.has(carrierKeyOf(mod))) continue;
    // 时效耗尽：收集起来供提示行，不入算式。放在闸门 1 **之后** ——
    // 关着的状态本来就看不见，再报一句「它过期了」只是噪声。
    if (isExpired(mod)) {
      expired.push(mod);
      continue;
    }
    // 闸门 2：性质允许计入（此处已排除 cast 与事件型，剩下的 sustained 看 active）
    if (!isCounted(mod)) continue;

    const row = mod.targetAttrId ? rows.get(mod.targetAttrId) : undefined;
    if (!row) continue;

    // ⚠️ 熟练度只对宿主是「技能」的效果成立：`proficiency` 的键就是 skill.id，
    // 拿装备 / 状态的 id 去查必然落空，若再沿用 `?? 0` 就会把 ratio 算成 0、
    // 系数取到 minScale（0.5）——数值被静默腰斩，而列表里仍显示原始值，
    // 只有对着汇总与「来源明细」才看得出来。宿主不是技能时一律不缩放。
    const raw =
      mod.scaleByProficiency && mod.ownerType === "skill"
        ? scaleByProficiency(
            mod.value,
            input.proficiency[mod.ownerId] ?? 0,
            scaling,
          )
        : mod.value;
    const applied = roundTo(raw, 4);
    const sustained = mod.nature === "sustained";

    row.contributions.push({
      modifierId: mod.id,
      ownerType: mod.ownerType,
      ownerId: mod.ownerId,
      applied,
      nature: mod.nature,
      op: mod.op,
    });
    countedCount += 1;

    switch (mod.op) {
      case "add":
        if (sustained) row.addSustained += applied;
        else row.addPassive += applied;
        break;
      case "percent":
        if (sustained) row.percentSustained += applied;
        else row.percentPassive += applied;
        break;
      case "mul":
        if (sustained) row.mulSustained *= applied;
        else row.mulPassive *= applied;
        break;
      case "override":
        row.override = applied;
        row.overrideCount += 1;
        break;
    }
  }

  for (const row of rows.values()) {
    if (row.override !== null) {
      row.final = roundTo(row.override, 4);
      continue;
    }
    const sumAdd = row.addPassive + row.addSustained;
    const sumPercent = row.percentPassive + row.percentSustained;
    const product = row.mulPassive * row.mulSustained;
    row.final = roundTo(
      (row.base + sumAdd) * (1 + sumPercent / 100) * product,
      4,
    );
  }

  const list = [...rows.values()];
  return {
    rows: list,
    byAttr: rows,
    casts,
    eventOnly,
    expired,
    countedCount,
  };
}

/** 释放型效果涉及的技能 / 装备名（「另有 N 项主动技能」提示行要能跳转） */
export function castOwnerIds(casts: PackModifier[]): {
  skills: string[];
  items: string[];
} {
  const skills = new Set<string>();
  const items = new Set<string>();
  for (const cast of casts) {
    if (cast.ownerType === "skill") skills.add(cast.ownerId);
    else if (cast.ownerType === "item") items.add(cast.ownerId);
  }
  return { skills: [...skills], items: [...items] };
}

// ─────────────────────────────────────────────────────────────
// 负重与容量（REQ-033 / F-5）
// ─────────────────────────────────────────────────────────────

/**
 * 单件总重：重量 × 件数。
 *
 * **数量即件数** —— 「龙血草 ×20」的重量就是二十株。「×20 只算一份重量」在
 * 网文里没有对应直觉（真那样写，作者反而要把总重自己乘好填进单件）。
 *
 * 值为 0 表示**没记**（列默认 0），此时贡献 0，不影响总重。
 */
export function itemWeight(item: PackItem): number {
  const per = item.weight ?? 0;
  if (!per) return 0;
  return per * Math.max(0, item.qty ?? 0);
}

/** 全部物品的总重（含未穿戴的 —— 背在身上和揣在包里的都算负重） */
export function totalWeight(items: PackItem[]): number {
  let sum = 0;
  for (const item of items) sum += itemWeight(item);
  // 浮点尾巴会一路累积到展示层（1.1 + 2.2 = 3.3000000000000003）
  return roundTo(sum, 3);
}

export interface WeightStatus {
  total: number;
  /** 上限；**0 = 不限**（列默认值），不是「上限为零」 */
  limit: number;
  /** 是否超载。上限为 0 时恒 false —— 不限重量的书永远不该看到超载红字 */
  over: boolean;
  /** 已用比例（可 > 1 表示超载）；上限为 0 时为 0 */
  ratio: number;
  /** 有没有任何一件记了重量：全都没记时「总重 0」是「没填」而不是「没负重」 */
  hasWeight: boolean;
}

/**
 * 负重状态。
 *
 * 判定用 `>`：压在上限上不算超载（作者写「上限 20」时想的是「20 以内都行」）。
 * 这与容量上限的 `>=` 不同，两者是真不一样 —— 没有第 41 件，但有第 20.0 公斤。
 */
export function weightStatus(items: PackItem[], limit: number): WeightStatus {
  const total = totalWeight(items);
  const bound = limit > 0 ? limit : 0;
  return {
    total,
    limit: bound,
    over: bound > 0 && total > bound,
    ratio: bound > 0 ? total / bound : 0,
    hasWeight: items.some((item) => (item.weight ?? 0) > 0),
  };
}

export interface CapacityStatus {
  /** 已占格数（按**条目**算，不是件数：200 株龙血草占 1 格） */
  used: number;
  /** 格数上限；**0 = 不限** */
  limit: number;
  /** 是否已满（`used >= limit`）—— 「上限 40 格」的意思就是第 41 件放不下 */
  full: boolean;
  ratio: number;
}

export function capacityStatus(items: PackItem[], limit: number): CapacityStatus {
  const used = items.length;
  const bound = limit > 0 ? limit : 0;
  return {
    used,
    limit: bound,
    full: bound > 0 && used >= bound,
    ratio: bound > 0 ? used / bound : 0,
  };
}

/**
 * 上限输入的规范化。
 *
 * 抽成纯函数是为了让它**可测**：这段逻辑原本埋在 `setLoadLimits` 的 mutation 里，
 * 而 antd 的 `InputNumber` 在 `min={0}` 时对越界输入**根本不会回调 `onChange`**，
 * 于是「负数夹到 0」这条不变量在组件测试里永远测不到，只能靠人肉点。
 *
 * `integer` 用于格数（格没有半格）；`weight` 允许小数（半斤、1.5 公斤）。
 * 非有限数（NaN / Infinity，来自输入框被清空或粘贴垃圾）一律归 0 = 不限。
 */
export function normalizeLimit(value: number, integer = false): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(0, value);
  return integer ? Math.floor(clamped) : clamped;
}

/**
 * 重量文案：最多 2 位小数并去掉尾随零（`0.50` → `0.5`，`3.00` → `3`）。
 *
 * 不复用 `formatAttrValue`：那个按属性自己声明的小数位补零（丹药重量是 0.5，
 * 补成 `0.50` 反而像是有两位精度）。作者填什么精度就显示什么精度。
 */
export function formatWeight(value: number): string {
  const fixed = (Math.round(value * 100) / 100).toFixed(2);
  return fixed.replace(/\.?0+$/, "") || "0";
}

// ─────────────────────────────────────────────────────────────
// 假想输入（REQ-018 换装预览 / REQ-037 估算模式）
// ─────────────────────────────────────────────────────────────

/**
 * 假想输入的文档切片：与 `computeSummary` 的输入同源，另加「可被改写的那几部分」。
 *
 * 为什么把文档切片也搬过来、而不是给 `computeSummary` 开一个「额外加成」旁路参数：
 * 预览必须与真实汇总**走同一条管线**。旁路参数意味着闸门 1（载体在效）、闸门 2
 * （性质可计入）与运算顺序都要在旁路里再实现一遍，两份实现迟早分叉 ——
 * 而分叉的表现是「预览说 +200，装上后只加了 150」，属于最难查的一类。
 */
export interface HypotheticalInput {
  attributes: PackAttribute[];
  slots: PackSlot[];
  items: PackItem[];
  skills: PackSkill[];
  modifiers: PackModifier[];
  proficiency: Record<string, number>;
  scaling?: ProficiencyScaling;
}

/** 一次「还没发生」的改动：不改文档、不落库、不计入未保存改动 */
export interface HypotheticalPatch {
  /** 把某件物品穿到某部位；满位时顶掉该槽位原有的占用者（与 equipItem → replaceInSlot 同语义） */
  equip?: { itemId: string; slotId: string } | null;
  /** 追加的临时效果词条（估算模式） */
  extraModifiers?: PackModifier[];
}

/**
 * 「把某件物品穿上」之后的 items（纯函数）。
 *
 * 与 `equipItem` 的两段语义严格对齐：**先找空位，满位才顶替**。
 * 顶替时占用被顶者的槽位序号 —— 若不这么做，同槽位会同时存在两件，
 * `isItemActive` 的 `itemsInSlot.length > capacity` 判定让两件双双失效，
 * 预览与真装的差异就藏在这里。
 */
function equipHypothetically(
  items: PackItem[],
  slots: PackSlot[],
  equip: { itemId: string; slotId: string },
): PackItem[] {
  const slot = slots.find((candidate) => candidate.id === equip.slotId);
  const item = items.find((candidate) => candidate.id === equip.itemId);
  if (!slot || !item) return items;

  const occupants = items.filter(
    (candidate) => candidate.equippedSlotId === slot.id && candidate.id !== equip.itemId,
  );
  const used = new Set(occupants.map((candidate) => candidate.slotIndex ?? 0));
  let index = 0;
  while (used.has(index) && index < slot.capacity) index += 1;

  if (index < slot.capacity) {
    return items.map((candidate) =>
      candidate.id === equip.itemId
        ? { ...candidate, equippedSlotId: slot.id, slotIndex: index }
        : candidate,
    );
  }

  // 满位：顶掉该序号上的占用者，没有就取第一件（与 equipItem 的 conflict 兜底一致）
  const victim =
    occupants.find((candidate) => (candidate.slotIndex ?? 0) === index) ?? occupants[0];
  const target = victim ? (victim.slotIndex ?? 0) : 0;
  return items.map((candidate) => {
    if (candidate.id === equip.itemId) {
      return { ...candidate, equippedSlotId: slot.id, slotIndex: target };
    }
    if (victim && candidate.id === victim.id) {
      return { ...candidate, equippedSlotId: "", slotIndex: null };
    }
    return candidate;
  });
}

/** 把一次假想改动应用到输入上（纯函数，不改原对象） */
export function applyHypothetical(
  input: HypotheticalInput,
  patch: HypotheticalPatch,
): HypotheticalInput {
  return {
    ...input,
    items: patch.equip
      ? equipHypothetically(input.items, input.slots, patch.equip)
      : input.items,
    modifiers: patch.extraModifiers?.length
      ? [...input.modifiers, ...patch.extraModifiers]
      : input.modifiers,
  };
}

/**
 * 假想汇总：「如果那样改，总属性会是多少」。
 *
 * 与真实汇总共用 `buildActiveCarriersFrom` + `computeSummary`，所以预览里出现的
 * 每个数，真做那件事之后都会原样出现。
 */
export function computeHypotheticalSummary(
  input: HypotheticalInput,
  patch: HypotheticalPatch,
): SummaryResult {
  const next = applyHypothetical(input, patch);
  return computeSummary({
    attributes: next.attributes,
    modifiers: next.modifiers,
    activeCarriers: buildActiveCarriersFrom(next),
    proficiency: next.proficiency,
    scaling: next.scaling,
  });
}

/** 汇总差异的一项（预览只展示真的变了的行，噪声最小） */
export interface SummaryDelta {
  attrId: string;
  before: number;
  after: number;
  delta: number;
}

/** 两份汇总的差异：**只回传变化量非零的行**（没变的行不占位） */
export function summaryDeltas(base: SummaryResult, next: SummaryResult): SummaryDelta[] {
  const deltas: SummaryDelta[] = [];
  for (const [attrId, row] of next.byAttr) {
    const before = base.byAttr.get(attrId)?.final ?? row.base;
    const delta = roundTo(row.final - before, 4);
    if (delta !== 0) deltas.push({ attrId, before, after: row.final, delta });
  }
  return deltas;
}

/** 四舍五入到指定小数位（避免浮点尾巴污染展示） */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** 按属性自身的小数位格式化；带千分位便于读大数 */
export function formatAttrValue(value: number, decimals: number): string {
  const fixed = value.toFixed(clampInt(decimals, 0, 4));
  const [integer, fraction] = fixed.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * 释放型（cast）效果的参数文案：`300% 攻击力 · CD 12s · 蓝耗 30 · 单体`
 *
 * 放在纯函数层而不是组件里，是因为它有**两个**消费方：效果词条列表（展示）
 * 与「与本章初对比」（比较）。两边各写一遍的话，只要有一边少拼一个字段，
 * 「参数改过」就永远判不出来 —— 而且不会报错，只是那一行静默消失。
 *
 * 空字段整体不出现（而不是留一个空档），所以零参数的释放型返回空串。
 */
export function castParamText(mod: PackModifier): string {
  const parts: string[] = [];
  if (mod.value) parts.push(`${formatAttrValue(mod.value, 0)}${mod.valueUnit || ""}`);
  if (mod.cooldown) parts.push(`CD ${mod.cooldown}s`);
  if (mod.cost) parts.push(mod.cost);
  if (mod.target) parts.push(mod.target);
  return parts.join(" · ");
}

// ─────────────────────────────────────────────────────────────
// 量纲：阶梯型（§9.3 ladder / §9.7.2 阶内进位）
// ─────────────────────────────────────────────────────────────

export interface LadderRung {
  id: string;
  name: string;
  rank: number;
  /** 该阶有几小层；1 = 无小层 */
  subLevels: number;
  /** 作者自定义的战力当量（跨阶比较基准，可空） */
  power: number | null;
}

export interface RealmPosition {
  /** 阶梯下标（0 起） */
  index: number;
  /** 当前小层（1 起；无小层时恒为 1） */
  sub: number;
}

/** 阶梯排序（按 rank 升序），作为一切进位运算的前提 */
export function sortLadder(rungs: LadderRung[]): LadderRung[] {
  return [...rungs].sort((a, b) => a.rank - b.rank);
}

/** 规范化位置：夹取到合法区间，保证不越界 */
export function clampRealm(rungs: LadderRung[], pos: RealmPosition): RealmPosition {
  if (rungs.length === 0) return { index: 0, sub: 1 };
  const index = clampInt(pos.index, 0, rungs.length - 1);
  const subLevels = Math.max(1, rungs[index]?.subLevels ?? 1);
  return { index, sub: clampInt(pos.sub, 1, subLevels) };
}

/**
 * 阶内进位：`at_sub >= sub_levels` → 进位到下一 rank 的第 1 层。
 *
 * 这是 §9.7.2 缺口③ 的落地：规则放渲染层纯函数，不入库、不改表。
 * delta 为负（回退）时反向借位：sub < 1 → 上一阶的最后一小层。
 */
export function carryRealm(
  rungs: LadderRung[],
  pos: RealmPosition,
  delta: number,
): RealmPosition {
  const ladder = rungs;
  if (ladder.length === 0) return { index: 0, sub: 1 };
  let index = clampInt(pos.index, 0, ladder.length - 1);
  let sub = clampInt(pos.sub, 1, Math.max(1, ladder[index]?.subLevels ?? 1));
  let remain = Math.trunc(delta);

  while (remain > 0) {
    const subLevels = Math.max(1, ladder[index]?.subLevels ?? 1);
    if (sub < subLevels) {
      sub += 1;
    } else if (index < ladder.length - 1) {
      index += 1;
      sub = 1;
    } else {
      break; // 已到顶阶最后一层，停住（不溢出）
    }
    remain -= 1;
  }

  while (remain < 0) {
    if (sub > 1) {
      sub -= 1;
    } else if (index > 0) {
      index -= 1;
      sub = Math.max(1, ladder[index]?.subLevels ?? 1);
    } else {
      break; // 已到第一阶第一层
    }
    remain += 1;
  }

  return { index, sub };
}

/** 境界显示文案：`筑基 7/9`（无小层时只显示阶名） */
export function formatRealm(
  rungs: LadderRung[],
  pos: RealmPosition,
): string {
  const rung = rungs[pos.index];
  if (!rung) return "未设置";
  const subLevels = Math.max(1, rung.subLevels);
  if (subLevels <= 1) return rung.name;
  return `${rung.name} ${pos.sub}/${subLevels}`;
}

// ─────────────────────────────────────────────────────────────
// 量纲：进制型（§9.3 ratio / D-1 货币自动进位）
// ─────────────────────────────────────────────────────────────

export interface RatioLevel {
  name: string;
  /** 相对基准单位的折算率；基准单位本身为 1 */
  ratioToBase: number;
}

/**
 * 进制型换算展示。autoCarry 为假时保持输入原样（「铜钱换不成银」的设定）。
 * levels 按 ratioToBase 降序取用，逐级贪心拆分。
 */
export function formatRatio(
  amount: number,
  levels: RatioLevel[],
  autoCarry: boolean,
  baseName?: string,
): string {
  const ordered = [...levels].sort((a, b) => b.ratioToBase - a.ratioToBase);
  const base = ordered[ordered.length - 1];
  if (!autoCarry || ordered.length === 0 || !base) {
    return `${formatAttrValue(amount, 0)} ${baseName ?? base?.name ?? ""}`.trim();
  }
  let remain = Math.max(0, Math.floor(amount));
  const parts: string[] = [];
  for (const level of ordered) {
    const unit = Math.max(1, Math.round(level.ratioToBase));
    const count = Math.floor(remain / unit);
    if (count > 0 || (level === base && parts.length === 0)) {
      parts.push(`${count} ${level.name}`);
      remain -= count * unit;
    }
  }
  return parts.join(" ").trim();
}

// ─────────────────────────────────────────────────────────────
// 量纲：阈值型（§9.3 threshold / 熟练度分级）
// ─────────────────────────────────────────────────────────────

export interface ThresholdLevel {
  name: string;
  min: number;
  max: number | null;
}

export interface ThresholdPosition {
  name: string;
  /** 区间内进度 0–1（区间无上限时以 min 起算的溢出量做渐进，封顶 1） */
  progress: number;
  min: number;
  max: number | null;
  /** 已超出最后一级上限（网文里「超越大师」常态化，只标注不截断） */
  overflow: boolean;
}

export function thresholdOf(
  levels: ThresholdLevel[],
  value: number,
): ThresholdPosition | null {
  if (levels.length === 0) return null;
  const ordered = [...levels].sort((a, b) => a.min - b.min);
  const last = ordered[ordered.length - 1];
  if (value < ordered[0].min) {
    return {
      name: "",
      progress: 0,
      min: ordered[0].min,
      max: null,
      overflow: false,
    };
  }
  for (const level of ordered) {
    const upper = level.max;
    if (value >= level.min && (upper === null || value <= upper)) {
      if (upper === null) {
        // 末档无上限（如「500+ 大师」）：不存在溢出，进度只表达「是否已越过档位起点」
        return {
          name: level.name,
          progress: value > level.min ? 1 : 0,
          min: level.min,
          max: null,
          overflow: false,
        };
      }
      if (upper === level.min) {
        return {
          name: level.name,
          progress: 1,
          min: level.min,
          max: upper,
          overflow: false,
        };
      }
      const progress = (value - level.min) / (upper - level.min);
      return {
        name: level.name,
        progress: clamp(progress, 0, 1),
        min: level.min,
        max: upper,
        overflow: false,
      };
    }
  }
  return {
    name: last.name,
    progress: 1,
    min: last.min,
    max: last.max,
    overflow: true,
  };
}

// ─────────────────────────────────────────────────────────────
// 杂项
// ─────────────────────────────────────────────────────────────

/** 稀有度 / 分类等短标签的安全取值 */
export function safeText(value: string | undefined | null, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** 数量增减：夹取到 ≥ 0 的整数 */
export function stepQty(qty: number, delta: number): number {
  return Math.max(0, Math.floor(qty + delta));
}

/** 字符级子串匹配（物品搜索，防抖由调用方负责） */
export function matchesKeyword(text: string, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return text.toLowerCase().includes(needle);
}

/** 相对时间文案（保存条「已保存 · n 分钟前」） */
export function formatRelativeTime(at: number, now = Date.now()): string {
  // 行囊的口径：盘点记录都是近期条目，超过一天只给天数
  return relativeTime(at, now, {
    beyondDay: (timestamp, current) =>
      `${Math.floor((current - timestamp) / 86_400_000)} 天前`,
  });
}

// ─────────────────────────────────────────────────────────────
// 本章变动角标（REQ-028 / F-2）
// ─────────────────────────────────────────────────────────────

/**
 * 该条目是否算「刚改动」。
 *
 * 三个条件缺一不可，且**必须都在纯函数里判**（组件各写一遍必然有一处漏条件）：
 * - `updatedAt > 0`：条目有改动落点。旧数据补列后是 0，不能凭空亮角标；
 * - `updatedAt > readAt`：晚于「全部已读」的底线，否则点过已读还在亮；
 * - `now - updatedAt < CHANGED_TTL_MS`：24 小时自动过期，不必依赖用户点已读。
 *
 * 口径「晚于」而非「不早于」：`readAt` 取的正是点击那一刻的 `Date.now()`，
 * 用 `>=` 会让「点已读的那一毫秒刚好也改了这条」永远亮着。
 */
export function hasRecentChange(
  updatedAt: number | undefined,
  readAt: number,
  now = Date.now(),
): boolean {
  if (!updatedAt || updatedAt <= 0) return false;
  if (updatedAt <= readAt) return false;
  return now - updatedAt < CHANGED_TTL_MS;
}

/** 当前处于「刚改动」状态的条目数（表头的「全部已读」据此显隐） */
export function countRecentChanges(
  entries: Array<{ updatedAt?: number }>,
  readAt: number,
  now = Date.now(),
): number {
  return entries.filter((entry) => hasRecentChange(entry.updatedAt, readAt, now)).length;
}

// ─────────────────────────────────────────────────────────────
// 导出为 Markdown 表格（REQ-030 / F-4 表格那一半）
// ─────────────────────────────────────────────────────────────

/** 可导出的模块（与 `PackModuleKey` 同名前缀，但备注速记没有结构化表格） */
export type PackExportKey =
  | "summary"
  | "attributes"
  | "equipment"
  | "inventory"
  | "skills"
  | "status"
  | "currency";

export interface PackExportTable {
  headers: string[];
  rows: string[][];
}

/** 组装一张表所需的全部只读输入（纯数据，不含 api / DOM） */
export interface PackExportContext {
  attributes: PackAttribute[];
  slots: PackSlot[];
  items: PackItem[];
  skills: PackSkill[];
  modifiers: PackModifier[];
  summary: SummaryResult;
  /** 熟练度档位（技能表用；为空则不出「档位」这一列） */
  proficiencyLevels?: ThresholdLevel[];
  /** 货币：进制型量纲 + 当前数值（没建货币体系时为 null） */
  currency?: { levels: RatioLevel[]; autoCarry: boolean } | null;
}

/**
 * 单元格转义。
 *
 * 反斜杠必须**先**处理：物品名里带 `|`（「双刃|短刀」）会把整张表的列数打乱，
 * 而 Markdown 里只有 `\|` 才是真正的字面竖线；先转 `|` 会把后补的 `\` 又转一遍，
 * 结果是 `\\|`，粘贴出去仍然断列。换行同理 —— 表格单元格内不能有软换行。
 */
export function escapeMarkdownCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

/** 表头分隔行：全部左对齐（数值列也左对齐 —— 中文表宽不定，右对齐反而参差） */
export function toMarkdownTable(table: PackExportTable): string {
  const head = `| ${table.headers.map(escapeMarkdownCell).join(" | ")} |`;
  const divider = `| ${table.headers.map(() => "---").join(" | ")} |`;
  const body = table.rows.map(
    (row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`,
  );
  return [head, divider, ...body].join("\n");
}

const DASH = "—";

function labelOf(map: Record<string, { label: string }>, key: string): string {
  return map[key]?.label ?? key;
}

function attrNameOf(attributes: PackAttribute[], id: string): string {
  if (!id) return DASH;
  return attributes.find((attr) => attr.id === id)?.name ?? "(已删除的属性)";
}

/** 总属性汇总：基础值 → 总览值，并按被动 / 持续分列（与 §9.4.2 的分段口径一致） */
function summaryTable(ctx: PackExportContext): PackExportTable {
  const ordered = ctx.attributes
    .map((attr) => ({ attr, row: ctx.summary.byAttr.get(attr.id) }))
    .filter((entry): entry is { attr: PackAttribute; row: SummaryRow } => Boolean(entry.row));
  return {
    headers: ["属性", "基础值", "总览值", "被动加算", "持续加算", "百分比", "乘算", "单位"],
    rows: ordered.map(({ attr, row }) => {
      const decimals = attr.decimals ?? 0;
      const percent = (row.percentPassive || 0) + (row.percentSustained || 0);
      const mul = row.mulPassive * row.mulSustained;
      return [
        attr.name,
        formatAttrValue(row.base, decimals),
        formatAttrValue(row.final, decimals),
        row.addPassive ? formatAttrValue(row.addPassive, decimals) : DASH,
        row.addSustained ? formatAttrValue(row.addSustained, decimals) : DASH,
        percent ? `${percent > 0 ? "+" : ""}${formatAttrValue(percent, 1)}%` : DASH,
        mul !== 1 ? `×${formatAttrValue(mul, 2)}` : DASH,
        attr.unit || DASH,
      ];
    }),
  };
}

function attributesTable(ctx: PackExportContext): PackExportTable {
  return {
    headers: ["分组", "属性", "基础值", "单位", "小数位"],
    rows: [...ctx.attributes]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((attr) => [
        attr.groupName,
        attr.name,
        formatAttrValue(attr.baseValue, attr.decimals ?? 0),
        attr.unit || DASH,
        String(attr.decimals ?? 0),
      ]),
  };
}

/**
 * 装备栏：一个槽位一行不够用（容量 >1 时有多件），所以**每件一 row**，
 * 空部位单独给一行「（空）」—— 否则「哪些部位还空着」在导出里看不出来。
 */
function equipmentTable(ctx: PackExportContext): PackExportTable {
  const rows: string[][] = [];
  for (const slot of [...ctx.slots].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const occupants = ctx.items
      .filter((item) => item.equippedSlotId === slot.id && item.slotIndex !== null)
      .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
    const slotLabel = slot.enabled ? slot.name : `${slot.name}（已停用）`;
    if (occupants.length === 0) {
      rows.push([slotLabel, "（空）", DASH, DASH, DASH, DASH]);
      continue;
    }
    for (const item of occupants) {
      const mods = ctx.modifiers.filter(
        (mod) => mod.ownerType === "item" && mod.ownerId === item.id,
      ).length;
      rows.push([
        slotLabel,
        (item.slotIndex ?? 0) + 1 + "/" + slot.capacity,
        item.name,
        item.category,
        labelOf(RARITY_META, item.rarity),
        String(mods),
      ]);
    }
  }
  return { headers: ["部位", "槽位", "物品", "分类", "稀有度", "加成条数"], rows };
}

function inventoryTable(ctx: PackExportContext): PackExportTable {
  const slotNameOf = (id: string): string =>
    id ? (ctx.slots.find((slot) => slot.id === id)?.name ?? "(已删除的部位)") : DASH;
  return {
    // 「重量」导出的是**小计**（单件 × 件数）而不是单件值：这张表是给作者盘账用的，
    // 单件重量乘一遍再抄进正文毫无意义，而小计可以直接当「这一趟背了多少」。
    headers: ["物品", "分类", "数量", "重量", "稀有度", "穿戴部位", "标签"],
    rows: ctx.items.map((item) => {
      const subtotal = itemWeight(item);
      return [
        item.name,
        item.category,
        String(item.qty),
        subtotal > 0 ? formatWeight(subtotal) : DASH,
        labelOf(RARITY_META, item.rarity),
        slotNameOf(item.equippedSlotId),
        item.tags.join(" / ") || DASH,
      ];
    }),
  };
}

function skillsTable(ctx: PackExportContext): PackExportTable {
  const levels = ctx.proficiencyLevels ?? [];
  const withTier = levels.length > 0;
  return {
    headers: withTier
      ? ["技能", "开关", "熟练度", "档位", "加成条数"]
      : ["技能", "开关", "熟练度", "加成条数"],
    rows: [...ctx.skills]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((skill) => {
        const mods = ctx.modifiers.filter(
          (mod) => mod.ownerType === "skill" && mod.ownerId === skill.id,
        ).length;
        const base = [
          skill.name,
          skill.enabled ? "在用" : "已关闭",
          String(skill.proficiencyRaw),
        ];
        const tier = thresholdOf(levels, skill.proficiencyRaw);
        return withTier
          ? [...base, tier?.name ? `${tier.name}${tier.overflow ? "+" : ""}` : DASH, String(mods)]
          : [...base, String(mods)];
      }),
  };
}

function statusTable(ctx: PackExportContext): PackExportTable {
  const statuses = ctx.modifiers.filter((mod) => mod.ownerType === "status");
  return {
    headers: ["状态", "性质", "开关", "目标属性", "运算", "数值", "时效", "备注"],
    rows: statuses.map((mod) => [
      mod.name || "(未命名状态)",
      labelOf(NATURE_META, mod.nature),
      mod.disabled ? "已禁用" : mod.active ? "开" : "关",
      mod.nature === "cast" ? DASH : attrNameOf(ctx.attributes, mod.targetAttrId),
      OP_META[mod.op]?.symbol ?? mod.op,
      `${formatAttrValue(mod.value, Math.abs(mod.value) < 1 ? 2 : 0)}${mod.valueUnit ?? ""}`,
      // 时效只对持续型有意义（被动是常驻、释放不进汇总）——
      // 给被动也填「剩 N 回合」会让作者以为它真的会自己掉回合。
      mod.nature !== "sustained"
        ? DASH
        : mod.roundsLeft === null
          ? "不限时"
          : mod.roundsLeft <= 0
            ? "已过期"
            : `剩 ${mod.roundsLeft} 回合`,
      mod.note || DASH,
    ]),
  };
}

/**
 * 货币：导出的是**换算体系本身**（逐级进制），不是某个余额。
 *
 * 面板里的金额输入框是「试算」，只活在 `CurrencyModule` 的局部 state 里
 * （作者在正文里写金额，行囊不持有余额字段）—— 拿不到、也不该硬凑一个数，
 * 于是这张表回答的是「这套货币怎么换算」。
 */
function currencyTable(ctx: PackExportContext): PackExportTable {
  const currency = ctx.currency;
  if (!currency || currency.levels.length === 0) {
    return { headers: ["单位", "进制"], rows: [] };
  }
  const ordered = [...currency.levels].sort((a, b) => b.ratioToBase - a.ratioToBase);
  const base = ordered[ordered.length - 1];
  return {
    headers: ["单位", "进制", "自动进位"],
    rows: ordered.map((level) => [
      level.name,
      level === base
        ? `基准（1 ${level.name}）`
        : `1 ${level.name} = ${formatAttrValue(Math.max(1, Math.round(level.ratioToBase)), 0)} ${base?.name ?? ""}`,
      level === base ? DASH : currency.autoCarry ? "是" : "否",
    ]),
  };
}

/** 按模块组装表格；该模块没有结构化内容时返回 headers + 空 rows（而不是 null） */
export function buildPackTable(
  key: PackExportKey,
  ctx: PackExportContext,
): PackExportTable {
  switch (key) {
    case "summary":
      return summaryTable(ctx);
    case "attributes":
      return attributesTable(ctx);
    case "equipment":
      return equipmentTable(ctx);
    case "inventory":
      return inventoryTable(ctx);
    case "skills":
      return skillsTable(ctx);
    case "status":
      return statusTable(ctx);
    case "currency":
      return currencyTable(ctx);
    default:
      return { headers: [], rows: [] };
  }
}

/**
 * 完整导出文档：`## 行囊 · <模块名>` + 表格 + 「本表为空」时的显式说明。
 *
 * 空表刻意不输出只有表头的空壳 —— 粘进正文里那就是一段噪声；
 * 一句「（暂无内容）」能让作者立刻确认「确实没有」，而不是以为导出坏了。
 */
export function buildPackMarkdown(
  key: PackExportKey,
  ctx: PackExportContext,
  label: string,
): string {
  const table = buildPackTable(key, ctx);
  const title = `## 行囊 · ${label}`;
  if (table.headers.length === 0 || table.rows.length === 0) {
    return `${title}\n\n（暂无内容）\n`;
  }
  return `${title}\n\n${toMarkdownTable(table)}\n`;
}
