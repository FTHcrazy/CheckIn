/**
 * 行囊纯函数层（PRD §9.4 汇总管线 / §9.3 量纲模型 / §9.7 阶内进位）
 *
 * 全部为「参数进、结果出」的纯函数，不触碰 IPC 与 DOM —— 便于单测覆盖，
 * 也让汇总管线是唯一可反查明细的实现（REQ-017）。
 */
import type {
  PackAttribute,
  PackItem,
  PackModifier,
  PackNature,
  PackSkill,
  PackSlot,
} from "./types";

export const CARRIER_DELIM = ":";

/** 载体标识（闸门 1 的判定单位）：`item:i1` / `skill:s2` / `status:c1` */
export function carrierKey(ownerType: string, ownerId: string): string {
  return `${ownerType}${CARRIER_DELIM}${ownerId}`;
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
 */
export function isCounted(mod: PackModifier): boolean {
  if (mod.disabled) return false;
  if (mod.nature === "cast") return false;
  if (mod.nature === "sustained") return mod.active === true;
  if (mod.nature === "passive" && mod.trigger) return false;
  return true;
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
    // 闸门 1：载体在效
    if (!input.activeCarriers.has(carrierKey(mod.ownerType, mod.ownerId))) continue;
    // 闸门 2：性质允许计入（此处已排除 cast 与事件型，剩下的 sustained 看 active）
    if (!isCounted(mod)) continue;

    const row = mod.targetAttrId ? rows.get(mod.targetAttrId) : undefined;
    if (!row) continue;

    const raw = mod.scaleByProficiency
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
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
