/**
 * 全局设定中心 · 窗口私有视图纯函数
 *
 * 搜索 / 筛选 / 排序 / 空态判定 / 影响面分档与文案 / 焦点判定 / 选中移动
 * 全部收在这里，组件与 hook 只调用、不自算 —— 口径集中一处，单测能直接钉死。
 *
 * ⚠️ 引用计数文案**只**由 `formatReferenceCountLabel` 产出（shared/novel/setting-reference），
 * 本文件不另拼「N 部书引用」这类字符串，避免左右两栏口径漂移。
 *
 * 本文件不含 React、不读 IPC —— 纯函数，参数进、结果出。
 */

import type { SettingCategory } from "@/shared/novel/setting-types";
import { formatReferenceCountLabel } from "@/shared/novel/setting-reference";

/** 左栏筛选：全部 / 境界体系 / 自定义 / 已被引用 / 暂无引用 */
export type GsCategoryFilter =
  | "all"
  | "realm"
  | "custom"
  | "referenced"
  | "unreferenced";

/** 左栏排序视图：按名称 / 按引用数 / 自定义顺序（sortOrder） */
export type GsSortMode = "name" | "refCount" | "custom";

/** 左栏空态：无空态 / 库里本来就没有分类 / 当前搜索或筛选 0 命中 */
export type GsEmptyKind = "none" | "no-category" | "no-match";

/** 影响面分档：0 → none；1–2 → low；≥3 → high */
export type GsImpactTier = "none" | "low" | "high";

/** R11 阈值单一口径：只有「高影响」有一个阈值，其余由它反推 */
export const GS_IMPACT_THRESHOLD = { high: 3 } as const;

/**
 * 关键词归一：去首尾空白。
 *
 * 不去内部空白 —— 「法宝 品阶」这种输入在中文里是合法的分段写法，
 * 折叠成「法宝品阶」反而搜不到。大小写不敏感由匹配侧统一 `toLowerCase`。
 */
export function normalizeKeyword(raw: string): string {
  return raw.trim();
}

/** 关键词命中：分类名 + 分类说明，忽略大小写 */
export function matchesKeyword(category: SettingCategory, keyword: string): boolean {
  const kw = normalizeKeyword(keyword).toLowerCase();
  if (!kw) return true;
  const haystack = `${category.name}\n${category.note}`.toLowerCase();
  return haystack.includes(kw);
}

/**
 * 筛选命中。
 *
 * 「已被引用 / 暂无引用」以 `refCount > 0` 为准 —— 与 `formatReferenceCountLabel`
 * 的 0 判定同一口径（undefined / 0 / 负数都算「暂无引用」）。
 */
export function matchesFilter(category: SettingCategory, filter: GsCategoryFilter): boolean {
  const refCount = category.refCount ?? 0;
  switch (filter) {
    case "realm":
      return category.kind === "realm";
    case "custom":
      return category.kind === "custom";
    case "referenced":
      return refCount > 0;
    case "unreferenced":
      return !(refCount > 0);
    case "all":
      return true;
    default:
      return true;
  }
}

/** 只过滤（搜索 ∩ 筛选），不改顺序 */
export function filterCategories(
  list: SettingCategory[],
  keyword: string,
  filter: GsCategoryFilter,
): SettingCategory[] {
  return list.filter(
    (category) => matchesKeyword(category, keyword) && matchesFilter(category, filter),
  );
}

/**
 * 只排序，不改内容。
 *
 * - `name`：按名称升序，同名称时按 sortOrder 兜底（稳定、可预期）；
 * - `refCount`：按引用数**降序**（引用多的排前面，正是要优先看见的），同数按 sortOrder；
 * - `custom`：保持 sortOrder（传入的 list 本身已按 sortOrder 排好）。
 *
 * ⚠️ 一律不原地排序（`slice()` 复制），避免污染 `c.sorted`。
 */
export function sortCategories(
  list: SettingCategory[],
  mode: GsSortMode,
): SettingCategory[] {
  if (mode === "name") {
    return list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN") || a.sortOrder - b.sortOrder);
  }
  if (mode === "refCount") {
    return list
      .slice()
      .sort(
        (a, b) => (b.refCount ?? 0) - (a.refCount ?? 0) || a.sortOrder - b.sortOrder,
      );
  }
  return list.slice();
}

/**
 * 先过滤再排序 —— 组件与 hook 的**唯一入口**。
 *
 * 顺序不能反：排序后再过滤会白白排一批不显示的条目，且「按引用数」的名次
 * 在过滤后会变成错的一组数（名次是全量口径，不是过滤后口径）。
 */
export function visibleCategories(
  list: SettingCategory[],
  keyword: string,
  filter: GsCategoryFilter,
  mode: GsSortMode,
): SettingCategory[] {
  return sortCategories(filterCategories(list, keyword, filter), mode);
}

/**
 * 左栏空态判定。
 *
 * `total === 0` ⇒ 库里本来就没有分类（引导「去新建」）；
 * `total > 0 && visibleCount === 0` ⇒ 搜/筛 0 命中（引导「清空搜索」）。
 * 两者文案必须不同 —— 混在一起会让人以为数据没了。
 */
export function emptyKindOf(total: number, visibleCount: number): GsEmptyKind {
  if (visibleCount > 0) return "none";
  return total > 0 ? "no-match" : "no-category";
}

/** 影响面分档（R11）：0 → none；1–2 → low；≥3 → high */
export function impactTierOf(refCount: number | undefined): GsImpactTier {
  const n = Math.max(0, Math.floor(refCount ?? 0));
  if (n === 0) return "none";
  return n >= GS_IMPACT_THRESHOLD.high ? "high" : "low";
}

/**
 * R4 影响面文案。
 *
 * 计数部分由 `formatReferenceCountLabel` 唯一产出，本文件只拼「后果」那半句。
 */
export function impactTextOf(refCount: number): string {
  const n = Math.max(0, Math.floor(refCount) || 0);
  if (n === 0) return "暂无作品引用 · 改动只影响全局库";
  return `被 ${formatReferenceCountLabel(n)} · 改动会即时同步到这 ${n} 部书`;
}

/**
 * R11② 追加提示（≥3 档非空，其余空串）。
 *
 * ⚠️ **只**用于影响面条的 ⚠ 强调标记 + Tooltip，**不进删除确认框** ——
 * 确认框口径唯一（`useGlobalSetting.onDeleteCategory` 原文案，
 * 该文件本次一个字不动）；用一次性弹窗去解决常驻可见性问题，方向是反的。
 */
export function impactWarningOf(refCount: number): string {
  return impactTierOf(refCount) === "high"
    ? "影响面较大，建议先确认这些书是否需要同步改名"
    : "";
}

/**
 * 焦点是否落在「正在输入」的元素上（快捷键要不要让路）。
 *
 * 判定覆盖三类：原生表单控件、可编辑区（contenteditable）、antd 的
 * `Input.TextArea`（它渲染成 `textarea`，已被第一类命中）。
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // jsdom 不实现 `isContentEditable`，故先查属性（真浏览器两者都成立）
  if (target.isContentEditable || target.getAttribute("contenteditable") === "true") {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * 在 id 列表里按 delta 移动选中（↑/↓）。
 *
 * - 当前 id 不在列表里（被筛掉了 / 还没选中）⇒ 落到首条（delta>0）或末条（delta<0）；
 * - 走到边界即停（不循环）—— 循环会让「↓ 到底」变成「跳回第一条」，
 *   在几十条分类里是纯粹的迷路；
 * - 列表为空 ⇒ 返回 null（调用方据此什么都不做）。
 */
export function nextIdInList(
  ids: string[],
  currentId: string,
  delta: number,
): string | null {
  if (ids.length === 0) return null;
  const current = ids.indexOf(currentId);
  if (current < 0) return delta > 0 ? ids[0] : ids[ids.length - 1];
  const next = Math.min(ids.length - 1, Math.max(0, current + delta));
  return ids[next];
}
