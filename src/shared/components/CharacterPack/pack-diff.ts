/**
 * 「与本章初对比」（REQ-029 / PRD F-3）—— 纯函数层
 *
 * 两边的输入是**同构的文档切片**：左边是「本章初」那条盘点记录的 payload，
 * 右边是面板上正在编辑的文档。输出是一份按组排好序的变更清单。
 *
 * 四条边界，每一条都是踩过或想过才会这么写：
 *
 * 1. **比的是「汇总后的值」，不是 base**。作者要的是「攻击 3,400 → 3,840」，
 *    而 3,400 是加完装备与被动之后的总和。只比 base 的话，换一件武器、
 *    点一个被动都不会出现在这张表上 —— 而那恰恰是最想说的事。
 *
 * 2. **只报「角色身上发生了什么」**。物品 / 穿戴 / 属性 / 境界 / 技能 / 主动效果，
 *    外加一组配置类的「设置」。逐字段比较效果参数、比较备注、比较排序之类的
 *    细粒度 diff 会把这张表淹掉，而作者点开它不是为了看 diff。
 *
 * 3. **不猜**。payload 解析失败（旧记录、坏 JSON、没有 attributes 的版本）
 *    一律返回 `null`，由调用方显示「无法对比」—— 绝不当成「所有东西都被移除了」，
 *    那种把「读不出来」渲染成「全删了」的错误比不显示难查得多。
 *
 * 4. **境界要单独处理**。它的真实值住在 `novel_links`（绑定主角时）或
 *    `character.realmAt`（未绑定时），前者**不随行囊文档走**，所以记录 payload
 *    里另存了一份「当时的关联行」（见主进程 novel-pack-save）；
 *    `realmLink === undefined` 表示那条记录没存过，此时整组跳过。
 */
import { getRealm, parseRealmRaw } from "./pack-realm";
import {
  buildActiveCarriersFrom,
  castParamText,
  computeSummary,
  formatAttrValue,
  formatRealm,
  isItemEquipped,
  type LadderRung,
} from "./pack-utils";
import type {
  PackAttribute,
  PackItem,
  PackModifier,
  PackRealmLinkDTO,
  PackSkill,
  PackSlot,
  PackUnitSystem,
} from "./types";

/** 比对用的文档切片：`PackDoc` 与记录 payload 都满足这个形状 */
export interface PackDiffDoc {
  attributes: PackAttribute[];
  slots: PackSlot[];
  items: PackItem[];
  skills: PackSkill[];
  modifiers: PackModifier[];
  unitSystems?: PackUnitSystem[];
  character?: { realmAt?: string; entityId?: string } | null;
  /**
   * 记录 payload 额外存的那份「当时的境界关联行」。
   * `undefined`（而不是 `null`）表示**这条记录里没有这一格** —— 见文件头第 4 条。
   */
  realmLink?: PackRealmLinkDTO | null;
}

export type PackDiffKind = "add" | "remove" | "change";

export type PackDiffGroup =
  | "realm"
  | "attribute"
  | "equip"
  | "item"
  | "skill"
  | "cast"
  | "setting";

/** 展示顺序：从「最像剧情」到「最像设置」。不按字母序，也不按产生顺序 */
export const DIFF_GROUPS: PackDiffGroup[] = [
  "realm",
  "attribute",
  "equip",
  "item",
  "skill",
  "cast",
  "setting",
];

export const DIFF_GROUP_LABEL: Record<PackDiffGroup, string> = {
  realm: "境界",
  attribute: "属性",
  equip: "穿戴",
  item: "物品",
  skill: "技能",
  cast: "主动效果",
  setting: "设置",
};

export interface PackDiffEntry {
  group: PackDiffGroup;
  kind: PackDiffKind;
  /** 主体名：「破境丹」「攻击」「境界」 */
  label: string;
  /** 变化前文案；`add` 时为空串 */
  before: string;
  /** 变化后文案；`remove` 时为空串 */
  after: string;
}

export interface PackDiffBucket {
  group: PackDiffGroup;
  label: string;
  rows: PackDiffEntry[];
}

export interface PackDiffResult {
  entries: PackDiffEntry[];
  /** 只含非空组，顺序同 `DIFF_GROUPS` */
  buckets: PackDiffBucket[];
  total: number;
}

/** 解析记录 payload；形状不对时返回 null（调用方据此显示「无法对比」） */
export function parsePackDiffDoc(payload: string): PackDiffDoc | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as Partial<PackDiffDoc>;
  // attributes 是这张表的骨架（属性组要跑两次汇总管线），缺了就没法比
  if (!Array.isArray(doc.attributes)) return null;
  return {
    attributes: doc.attributes,
    slots: Array.isArray(doc.slots) ? doc.slots : [],
    items: Array.isArray(doc.items) ? doc.items : [],
    skills: Array.isArray(doc.skills) ? doc.skills : [],
    modifiers: Array.isArray(doc.modifiers) ? doc.modifiers : [],
    unitSystems: Array.isArray(doc.unitSystems) ? doc.unitSystems : [],
    character: doc.character ?? null,
    // 「有这一格但值为 null」= 当时确实没绑境界，是有效信息；
    // 「根本没这一格」= 旧记录没存过，此时不能把它当成「当时无境界」。
    ...("realmLink" in doc ? { realmLink: doc.realmLink ?? null } : {}),
  };
}

export function diffPackDoc(
  baseline: PackDiffDoc,
  current: PackDiffDoc,
  rungs: LadderRung[] = [],
): PackDiffResult {
  const entries: PackDiffEntry[] = [
    ...diffRealm(baseline, current, rungs),
    ...diffAttributes(baseline, current),
    ...diffEquip(baseline, current),
    ...diffItems(baseline, current),
    ...diffSkills(baseline, current),
    ...diffCasts(baseline, current),
    ...diffSettings(baseline, current),
  ];

  const buckets = DIFF_GROUPS.map((group) => ({
    group,
    label: DIFF_GROUP_LABEL[group],
    rows: entries.filter((entry) => entry.group === group),
  })).filter((bucket) => bucket.rows.length > 0);

  return { entries, buckets, total: entries.length };
}

// ─────────────────────────────────────────────────────────────
// 境界
// ─────────────────────────────────────────────────────────────

/**
 * 一份文档的「境界展示文案」。
 *
 * 返回三态，缺一不可：
 * - `null`  → 这份文档没带可比对的境界信息（旧记录），整组跳过
 * - `""`    → 明确「没设过境界」
 * - 其它    → 展示文案，如「筑基七层」
 *
 * ⚠️ 「没设过」必须自己判，不能看位置。`getRealm` 在 `levelId` 为空时会回落到
 * 第 0 阶（刻意的：面板要有东西可显示），于是「从没设过」与「第一层」拿到同一个
 * 位置 —— 用位置判断的话，开局没设境界的角色会被写成「筑基一层 → 筑基七层」，
 * 读起来像他本来就在一层。
 */
function realmTextOf(doc: PackDiffDoc, rungs: LadderRung[]): string | null {
  if (doc.realmLink === undefined) return null;
  const entityId = doc.character?.entityId ?? "";
  const realmRaw = doc.character?.realmAt ?? "";
  const bound = Boolean(entityId);
  const hasRealm = bound ? Boolean(doc.realmLink?.toId) : Boolean(parseRealmRaw(realmRaw)?.levelId);
  if (!hasRealm) return "";
  return formatRealm(
    rungs,
    getRealm({ link: doc.realmLink ?? null, realmRaw, rungs, bound, entityId }),
  );
}

function diffRealm(
  baseline: PackDiffDoc,
  current: PackDiffDoc,
  rungs: LadderRung[],
): PackDiffEntry[] {
  // 没有等级体系时文案无从生成（formatRealm 只会给出「未设置」），整组不做
  if (rungs.length === 0) return [];
  const before = realmTextOf(baseline, rungs);
  const after = realmTextOf(current, rungs);
  if (before === null || after === null || before === after) return [];
  if (!before) return [entry("realm", "add", "境界", "", after)];
  if (!after) return [entry("realm", "remove", "境界", before, "")];
  return [entry("realm", "change", "境界", before, after)];
}

// ─────────────────────────────────────────────────────────────
// 属性（比汇总后的值）
// ─────────────────────────────────────────────────────────────

function summarize(doc: PackDiffDoc) {
  return computeSummary({
    attributes: doc.attributes,
    modifiers: doc.modifiers,
    activeCarriers: buildActiveCarriersFrom({
      slots: doc.slots,
      items: doc.items,
      skills: doc.skills,
      modifiers: doc.modifiers,
    }),
    proficiency: Object.fromEntries(doc.skills.map((skill) => [skill.id, skill.proficiencyRaw])),
  });
}

function attrText(attr: PackAttribute, value: number): string {
  return `${formatAttrValue(value, attr.decimals)}${attr.unit}`;
}

function diffAttributes(baseline: PackDiffDoc, current: PackDiffDoc): PackDiffEntry[] {
  const before = summarize(baseline);
  const after = summarize(current);
  const beforeAttrs = new Map(baseline.attributes.map((attr) => [attr.id, attr]));
  const out: PackDiffEntry[] = [];

  // 以「当前面板的顺序」出表，作者对着面板能一行行核
  for (const attr of current.attributes) {
    const row = after.byAttr.get(attr.id);
    if (!row) continue;
    const now = attrText(attr, row.final);
    const prev = beforeAttrs.get(attr.id);
    if (!prev) {
      out.push(entry("attribute", "add", attr.name, "", now));
      continue;
    }
    const prevRow = before.byAttr.get(attr.id);
    const was = attrText(prev, prevRow?.final ?? prev.baseValue);
    // 比「展示文案」而不是浮点原值：0.1 + 0.2 之类的尾巴会被格式化吃掉，
    // 不会冒出一行「3,400 → 3,400」的假变更
    if (was !== now) out.push(entry("attribute", "change", attr.name, was, now));
  }

  const currentIds = new Set(current.attributes.map((attr) => attr.id));
  for (const attr of baseline.attributes) {
    if (currentIds.has(attr.id)) continue;
    const prevRow = before.byAttr.get(attr.id);
    out.push(
      entry("attribute", "remove", attr.name, attrText(attr, prevRow?.final ?? attr.baseValue), ""),
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 穿戴 / 物品
// ─────────────────────────────────────────────────────────────

/** 该物品穿在哪个部位；没穿或部位已删时给出可读的兜底文案 */
function equipTextOf(doc: PackDiffDoc, item: PackItem): string {
  if (!isItemEquipped(item)) return "未穿戴";
  return doc.slots.find((slot) => slot.id === item.equippedSlotId)?.name || "已穿戴";
}

function diffEquip(baseline: PackDiffDoc, current: PackDiffDoc): PackDiffEntry[] {
  const beforeItems = new Map(baseline.items.map((item) => [item.id, item]));
  const out: PackDiffEntry[] = [];
  for (const item of current.items) {
    const prev = beforeItems.get(item.id);
    // 新物品的「获得」由物品组负责，这里不重复报一次「未穿戴 → 护手槽」
    if (!prev) continue;
    const was = equipTextOf(baseline, prev);
    const now = equipTextOf(current, item);
    if (was === now) continue;
    out.push(entry("equip", "change", item.name || "未命名物品", was, now));
  }
  return out;
}

function qtyText(qty: number): string {
  return `×${qty}`;
}

function diffItems(baseline: PackDiffDoc, current: PackDiffDoc): PackDiffEntry[] {
  const beforeItems = new Map(baseline.items.map((item) => [item.id, item]));
  const currentIds = new Set(current.items.map((item) => item.id));
  const out: PackDiffEntry[] = [];

  for (const item of current.items) {
    const name = item.name || "未命名物品";
    const prev = beforeItems.get(item.id);
    if (!prev) {
      out.push(entry("item", "add", name, "", qtyText(item.qty)));
      continue;
    }
    if (prev.qty !== item.qty) {
      out.push(entry("item", "change", name, qtyText(prev.qty), qtyText(item.qty)));
    }
  }

  for (const item of baseline.items) {
    if (currentIds.has(item.id)) continue;
    out.push(entry("item", "remove", item.name || "未命名物品", qtyText(item.qty), ""));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 技能
// ─────────────────────────────────────────────────────────────

function enabledText(enabled: boolean): string {
  return enabled ? "在用" : "已停用";
}

function diffSkills(baseline: PackDiffDoc, current: PackDiffDoc): PackDiffEntry[] {
  const beforeSkills = new Map(baseline.skills.map((skill) => [skill.id, skill]));
  const currentIds = new Set(current.skills.map((skill) => skill.id));
  const out: PackDiffEntry[] = [];

  for (const skill of current.skills) {
    const name = skill.name || "未命名技能";
    const prev = beforeSkills.get(skill.id);
    if (!prev) {
      out.push(entry("skill", "add", name, "", ""));
      continue;
    }
    if (prev.enabled !== skill.enabled) {
      out.push(entry("skill", "change", name, enabledText(prev.enabled), enabledText(skill.enabled)));
    }
    if (prev.proficiencyRaw !== skill.proficiencyRaw) {
      out.push(
        entry("skill", "change", `${name} 熟练度`, String(prev.proficiencyRaw), String(skill.proficiencyRaw)),
      );
    }
  }

  for (const skill of baseline.skills) {
    if (currentIds.has(skill.id)) continue;
    out.push(entry("skill", "remove", skill.name || "未命名技能", "", ""));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 主动效果（cast）
// ─────────────────────────────────────────────────────────────

function castsOf(modifiers: PackModifier[]): Map<string, PackModifier> {
  return new Map(
    modifiers.filter((mod) => mod.nature === "cast").map((mod) => [mod.id, mod]),
  );
}

/**
 * 只比**主动效果**。
 *
 * 被动 / 持续改动会被「属性」组以汇总值的形式体现出来，再逐条列一遍就是重复；
 * 而主动效果不计入总属性，属性组看不见它们 —— 不在这里报，就等于「本章学会了
 * 一招」这件事在对比里完全不存在。
 */
function diffCasts(baseline: PackDiffDoc, current: PackDiffDoc): PackDiffEntry[] {
  const before = castsOf(baseline.modifiers);
  const after = castsOf(current.modifiers);
  const out: PackDiffEntry[] = [];

  for (const [id, mod] of after) {
    const name = mod.name || "未命名主动效果";
    const prev = before.get(id);
    if (!prev) {
      out.push(entry("cast", "add", name, "", castParamText(mod)));
      continue;
    }
    // 整串比较而不是逐字段：文案本身就是参数快照，逐字段写的话
    // 每加一个参数字段都要回来补一处判断，漏一次就是静默不报
    const was = castParamText(prev);
    const now = castParamText(mod);
    if (was !== now) out.push(entry("cast", "change", name, was, now));
  }

  for (const [id, mod] of before) {
    if (after.has(id)) continue;
    out.push(entry("cast", "remove", mod.name || "未命名主动效果", castParamText(mod), ""));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 设置（部位 / 量纲）
// ─────────────────────────────────────────────────────────────

function diffSettings(baseline: PackDiffDoc, current: PackDiffDoc): PackDiffEntry[] {
  const out: PackDiffEntry[] = [];

  // 部位
  const beforeSlots = new Map(baseline.slots.map((slot) => [slot.id, slot]));
  const currentSlotIds = new Set(current.slots.map((slot) => slot.id));
  for (const slot of current.slots) {
    const label = `部位 ${slot.name || "未命名部位"}`;
    const prev = beforeSlots.get(slot.id);
    if (!prev) {
      out.push(entry("setting", "add", label, "", ""));
      continue;
    }
    if (prev.enabled !== slot.enabled) {
      out.push(entry("setting", "change", label, enabledText(prev.enabled), enabledText(slot.enabled)));
    }
    if (prev.capacity !== slot.capacity) {
      out.push(
        entry("setting", "change", `${label} 容量`, String(prev.capacity), String(slot.capacity)),
      );
    }
  }
  for (const slot of baseline.slots) {
    if (currentSlotIds.has(slot.id)) continue;
    out.push(entry("setting", "remove", `部位 ${slot.name || "未命名部位"}`, "", ""));
  }

  // 量纲（货币 / 熟练度的换算体系）
  const beforeUnits = new Map((baseline.unitSystems ?? []).map((unit) => [unit.id, unit]));
  const currentUnitIds = new Set((current.unitSystems ?? []).map((unit) => unit.id));
  for (const unit of current.unitSystems ?? []) {
    const label = `量纲 ${unit.name || "未命名量纲"}`;
    const prev = beforeUnits.get(unit.id);
    if (!prev) {
      out.push(entry("setting", "add", label, "", ""));
      continue;
    }
    // 换算表是这层唯一有后果的东西，其余字段（排序 / 默认标记）不值得单独开一行
    if (prev.levels !== unit.levels || prev.kind !== unit.kind || prev.config !== unit.config) {
      out.push(entry("setting", "change", label, "", "换算已调整"));
    }
  }
  for (const unit of baseline.unitSystems ?? []) {
    if (currentUnitIds.has(unit.id)) continue;
    out.push(entry("setting", "remove", `量纲 ${unit.name || "未命名量纲"}`, "", ""));
  }

  return out;
}

function entry(
  group: PackDiffGroup,
  kind: PackDiffKind,
  label: string,
  before: string,
  after: string,
): PackDiffEntry {
  return { group, kind, label, before, after };
}
