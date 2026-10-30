import { describe, expect, it } from "vitest";
import type { SettingCategory, SettingLevel } from "@/shared/novel/setting-types";
import { formatReferenceCountLabel } from "@/shared/novel/setting-reference";
import {
  GS_IMPACT_THRESHOLD,
  emptyKindOf,
  filterCategories,
  impactTextOf,
  impactTierOf,
  impactWarningOf,
  isTypingTarget,
  matchesFilter,
  matchesKeyword,
  nextIdInList,
  normalizeKeyword,
  sortCategories,
  visibleCategories,
} from "./gs-view-utils";

const level = (id: string, name: string, rank: number): SettingLevel => ({
  id,
  categoryId: "c1",
  name,
  rank,
  aliases: [],
  note: "",
  subLevels: 9,
  subPattern: "",
  power: null,
  parentId: null,
  segFrom: null,
  segTo: null,
});

/** 造一个分类：只给会影响判定的字段，其余走默认 */
function cat(
  id: string,
  name: string,
  over: Partial<SettingCategory> = {},
): SettingCategory {
  return {
    id,
    workId: "",
    name,
    color: "#8B77F0",
    kind: "custom",
    sortOrder: 1,
    note: "",
    subLevels: 9,
    carryDir: "asc",
    subPattern: "第{n}层",
    levels: [level(`${id}-l1`, "一品", 1)],
    ...over,
  };
}

const list: SettingCategory[] = [
  cat("c1", "法宝品阶", { kind: "custom", sortOrder: 1, refCount: 2, note: "法宝的等级" }),
  cat("c2", "修仙·经典九层", { kind: "realm", sortOrder: 2, refCount: 5, note: "境界" }),
  cat("c3", "丹药稀有度", { kind: "custom", sortOrder: 3, refCount: 0, note: "" }),
];

describe("gs-view-utils · 关键词与过滤", () => {
  it("normalizeKeyword 只去首尾空白，不动内部空白", () => {
    expect(normalizeKeyword("  法 宝  ")).toBe("法 宝");
    expect(normalizeKeyword("   ")).toBe("");
  });

  it("matchesKeyword 命中分类名与说明，且忽略大小写", () => {
    expect(matchesKeyword(list[0], "法宝")).toBe(true);
    expect(matchesKeyword(list[0], "法宝的等级")).toBe(true);
    expect(matchesKeyword(list[0], "FABAO")).toBe(false);
    expect(matchesKeyword(cat("c9", "Realm"), "realm")).toBe(true);
    // 空关键词一律命中（不过滤）
    expect(matchesKeyword(list[2], "   ")).toBe(true);
  });

  it("matchesFilter：全部 / 境界体系 / 自定义 / 已被引用 / 暂无引用", () => {
    expect(matchesFilter(list[0], "all")).toBe(true);
    expect(matchesFilter(list[1], "realm")).toBe(true);
    expect(matchesFilter(list[0], "realm")).toBe(false);
    expect(matchesFilter(list[0], "custom")).toBe(true);
    expect(matchesFilter(list[1], "custom")).toBe(false);
    expect(matchesFilter(list[1], "referenced")).toBe(true);
    expect(matchesFilter(list[2], "referenced")).toBe(false);
    expect(matchesFilter(list[2], "unreferenced")).toBe(true);
    expect(matchesFilter(list[1], "unreferenced")).toBe(false);
  });

  it("refCount 为 undefined 时按「暂无引用」处理（与徽标同一口径）", () => {
    const missing = cat("c4", "无计数字段");
    expect(matchesFilter(missing, "unreferenced")).toBe(true);
    expect(matchesFilter(missing, "referenced")).toBe(false);
  });

  it("filterCategories 是搜索与筛选的交集，且不改原数组", () => {
    const snapshot = list.map((item) => item.id);
    const realmOnly = filterCategories(list, "", "realm");
    expect(realmOnly.map((item) => item.id)).toEqual(["c2"]);
    // 「法」只命中法宝品阶；与「境界体系」取交集 ⇒ 空
    expect(filterCategories(list, "法", "realm")).toHaveLength(0);
    expect(filterCategories(list, "法", "all").map((item) => item.id)).toEqual(["c1"]);
    expect(list.map((item) => item.id)).toEqual(snapshot);
  });
});

describe("gs-view-utils · 排序", () => {
  it("custom 顺序：保持 sortOrder", () => {
    const unordered = [list[2], list[0], list[1]];
    expect(sortCategories(unordered, "custom").map((item) => item.id)).toEqual([
      "c3",
      "c1",
      "c2",
    ]);
  });

  it("name 顺序：按名称升序，同名按 sortOrder 兜底", () => {
    const same = [cat("b", "同名", { sortOrder: 2 }), cat("a", "同名", { sortOrder: 1 })];
    expect(sortCategories(same, "name").map((item) => item.id)).toEqual(["a", "b"]);
    expect(sortCategories(list, "name").map((item) => item.name)).toEqual([
      "丹药稀有度",
      "法宝品阶",
      "修仙·经典九层",
    ]);
  });

  it("refCount 顺序：按引用数降序，同数按 sortOrder", () => {
    expect(sortCategories(list, "refCount").map((item) => item.refCount)).toEqual([
      5, 2, 0,
    ]);
    const tie = [cat("x", "甲", { sortOrder: 1, refCount: 3 }), cat("y", "乙", { sortOrder: 2, refCount: 3 })];
    expect(sortCategories(tie, "refCount").map((item) => item.id)).toEqual(["x", "y"]);
  });

  it("排序不原地改数组（避免污染 c.sorted）", () => {
    const source = [list[2], list[1], list[0]];
    const before = source.map((item) => item.id);
    sortCategories(source, "name");
    expect(source.map((item) => item.id)).toEqual(before);
  });

  it("visibleCategories 先过滤再排序：名次是过滤后口径", () => {
    const visible = visibleCategories(list, "", "all", "refCount");
    expect(visible.map((item) => item.refCount)).toEqual([5, 2, 0]);
    // 筛掉 realm（只剩 custom）后再按引用数排：引用 5 的那条不在结果里
    const noRealm = visibleCategories(list, "", "custom", "refCount");
    expect(noRealm.map((item) => item.id)).toEqual(["c1", "c3"]);
    expect(noRealm.map((item) => item.refCount)).toEqual([2, 0]);
  });
});

describe("gs-view-utils · 空态判定", () => {
  it("有命中 ⇒ none", () => {
    expect(emptyKindOf(3, 3)).toBe("none");
    expect(emptyKindOf(3, 1)).toBe("none");
  });

  it("库里本来就没有分类 ⇒ no-category", () => {
    expect(emptyKindOf(0, 0)).toBe("no-category");
  });

  it("有分类但 0 命中 ⇒ no-match（文案必须与 no-category 不同）", () => {
    expect(emptyKindOf(3, 0)).toBe("no-match");
  });
});

describe("gs-view-utils · 影响面分档与文案（R11 口径）", () => {
  it("impactTierOf 的 0/1/2/3 边界", () => {
    expect(impactTierOf(0)).toBe("none");
    expect(impactTierOf(1)).toBe("low");
    expect(impactTierOf(2)).toBe("low");
    expect(impactTierOf(GS_IMPACT_THRESHOLD.high)).toBe("high");
    expect(impactTierOf(9)).toBe("high");
  });

  it("impactTierOf：undefined / 负数 / 小数一律按 0 / 向下取整处理", () => {
    expect(impactTierOf(undefined)).toBe("none");
    expect(impactTierOf(-3)).toBe("none");
    expect(impactTierOf(2.9)).toBe("low");
    expect(impactTierOf(3.5)).toBe("high");
  });

  it("impactTextOf：0 引用与 N>0 两种口径", () => {
    expect(impactTextOf(0)).toBe("暂无作品引用 · 改动只影响全局库");
    expect(impactTextOf(5)).toBe(
      `被 ${formatReferenceCountLabel(5)} · 改动会即时同步到这 5 部书`,
    );
    expect(impactTextOf(5)).toBe("被 5 部书引用 · 改动会即时同步到这 5 部书");
    expect(impactTextOf(1)).toBe("被 1 部书引用 · 改动会即时同步到这 1 部书");
  });

  it("impactWarningOf：仅 ≥3 档非空，其余空串（且不进确认框）", () => {
    expect(impactWarningOf(0)).toBe("");
    expect(impactWarningOf(1)).toBe("");
    expect(impactWarningOf(2)).toBe("");
    expect(impactWarningOf(3)).toBe("影响面较大，建议先确认这些书是否需要同步改名");
  });
});

describe("gs-view-utils · 焦点判定", () => {
  it("输入控件 / 可编辑区算「正在输入」，普通元素不算", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const div = document.createElement("div");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");

    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(select)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("gs-view-utils · 选中移动", () => {
  const ids = ["c1", "c2", "c3"];

  it("在列表内按 delta 移动", () => {
    expect(nextIdInList(ids, "c1", 1)).toBe("c2");
    expect(nextIdInList(ids, "c3", -1)).toBe("c2");
    expect(nextIdInList(ids, "c2", 1)).toBe("c3");
  });

  it("到边界即停（不循环）", () => {
    expect(nextIdInList(ids, "c3", 1)).toBe("c3");
    expect(nextIdInList(ids, "c1", -1)).toBe("c1");
  });

  it("当前 id 不在列表里：往下落首条、往上落末条", () => {
    expect(nextIdInList(ids, "gone", 1)).toBe("c1");
    expect(nextIdInList(ids, "gone", -1)).toBe("c3");
  });

  it("空列表返回 null（调用方据此什么都不做）", () => {
    expect(nextIdInList([], "c1", 1)).toBeNull();
  });
});
