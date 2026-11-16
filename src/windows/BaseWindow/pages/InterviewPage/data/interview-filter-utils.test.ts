import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_WEIGHT,
  PAGE_SIZE,
  categoryLabel,
  categoryPath,
  collectTags,
  countByCategory,
  countByCategoryId,
  createInitialFilterState,
  filterQuestions,
  highlightSegments,
  interviewFilterReducer,
  matchesKeyword,
  paginate,
  sortQuestions,
} from "./interview-filter-utils";
import { CATEGORIES, CATEGORY_BY_ID } from "./interview-taxonomy";
import type {
  CategoryId,
  Difficulty,
  InterviewQuestion,
  QuestionTrack,
} from "./interview-types";

let sequence = 0;

/** 造一条测试用题目：只暴露本文件关心的字段，其余给稳定默认值 */
function makeQuestion(
  patch: Partial<InterviewQuestion> & {
    categoryId: CategoryId;
    track: QuestionTrack;
  },
): InterviewQuestion {
  sequence += 1;
  return {
    id: `q-${sequence}`,
    title: `题目 ${sequence}`,
    stem: "题干",
    answer: "答案",
    difficulty: "medium" as Difficulty,
    tags: [],
    topic: "测试主题",
    reviewedAt: "2026-11",
    heat: 50,
    updatedAt: "2026-11-16",
    ...patch,
  };
}

const STATE = createInitialFilterState();

describe("interviewFilterReducer", () => {
  it("初始状态落在基础知识库的第一页且不限分类", () => {
    expect(STATE.track).toBe("foundation");
    expect(STATE.categoryId).toBe("all");
    expect(STATE.page).toBe(1);
    expect(STATE.tags).toEqual([]);
  });

  it("切轨道时分类归零、页码回到 1", () => {
    const start = { ...STATE, track: "foundation" as const, categoryId: "foundation-js" as const, page: 3 };
    const next = interviewFilterReducer(start, { type: "setTrack", track: "written" });
    expect(next.track).toBe("written");
    expect(next.categoryId).toBe("all");
    expect(next.page).toBe(1);
  });

  it("切轨道到同一轨道时原样返回，不制造新对象", () => {
    const start = { ...STATE, page: 2 };
    expect(interviewFilterReducer(start, { type: "setTrack", track: "foundation" })).toBe(start);
  });

  it("任一筛选变更都把页码拉回第 1 页", () => {
    const start = { ...STATE, page: 4 };
    expect(interviewFilterReducer(start, { type: "setCategory", categoryId: "foundation-css" }).page).toBe(1);
    expect(interviewFilterReducer(start, { type: "setDifficulty", difficulty: "hard" }).page).toBe(1);
    expect(interviewFilterReducer(start, { type: "setKeyword", keyword: "event loop" }).page).toBe(1);
    expect(interviewFilterReducer(start, { type: "toggleTag", tag: "高频" }).page).toBe(1);
    expect(interviewFilterReducer(start, { type: "setTags", tags: ["高频", "大厂"] }).page).toBe(1);
    expect(interviewFilterReducer(start, { type: "setFavoritesOnly", favoritesOnly: true }).page).toBe(1);
    expect(interviewFilterReducer(start, { type: "setSortBy", sortBy: "hot" }).page).toBe(1);
    // clearTags 在已选标签时同样要回到第 1 页
    const withTags = { ...start, tags: ["高频"] };
    expect(interviewFilterReducer(withTags, { type: "clearTags" }).page).toBe(1);
    expect(interviewFilterReducer(withTags, { type: "clearTags" }).tags).toEqual([]);
  });

  it("setTags 去重且顺序稳定，内容不变时不制造新对象", () => {
    const once = interviewFilterReducer(STATE, { type: "setTags", tags: ["高频", "大厂", "高频"] });
    expect(once.tags).toEqual(["高频", "大厂"]);
    expect(interviewFilterReducer(once, { type: "setTags", tags: ["大厂", "高频"] })).toBe(once);
    // 已无标签时 clearTags 也是空操作
    expect(interviewFilterReducer(STATE, { type: "clearTags" })).toBe(STATE);
  });

  it("只有翻页动作不改动筛选条件", () => {
    const start = { ...STATE, categoryId: "foundation-js" as const, keyword: "闭包", page: 1 };
    const next = interviewFilterReducer(start, { type: "setPage", page: 2 });
    expect(next).toEqual({ ...start, page: 2 });
  });

  it("关键词入库前先 trim，重复提交同一关键词不产生新对象", () => {
    const once = interviewFilterReducer(STATE, { type: "setKeyword", keyword: "  闭包  " });
    expect(once.keyword).toBe("闭包");
    expect(interviewFilterReducer(once, { type: "setKeyword", keyword: "闭包" })).toBe(once);
  });

  it("标签可反复切换（选中 / 取消）", () => {
    const withTag = interviewFilterReducer(STATE, { type: "toggleTag", tag: "高频" });
    expect(withTag.tags).toEqual(["高频"]);
    const both = interviewFilterReducer(withTag, { type: "toggleTag", tag: "React 19" });
    expect(both.tags).toEqual(["高频", "React 19"]);
    const removed = interviewFilterReducer(both, { type: "toggleTag", tag: "高频" });
    expect(removed.tags).toEqual(["React 19"]);
  });

  it("reset 回到初始状态", () => {
    const dirty = {
      ...STATE,
      track: "written" as const,
      categoryId: "written-algorithm" as const,
      keyword: "链表",
      tags: ["大厂"],
      favoritesOnly: true,
      page: 5,
    };
    expect(interviewFilterReducer(dirty, { type: "reset" })).toEqual(STATE);
  });
});

describe("filterQuestions", () => {
  const jsBasic = makeQuestion({ track: "foundation", categoryId: "foundation-js", difficulty: "basic", tags: ["高频"], title: "闭包是什么", heat: 90 });
  const jsHard = makeQuestion({ track: "foundation", categoryId: "foundation-js", difficulty: "hard", tags: ["高频", "大厂"], title: "事件循环的阶段", heat: 70 });
  const css = makeQuestion({ track: "foundation", categoryId: "foundation-css", difficulty: "medium", tags: ["大厂"], title: "BFC 与外边距折叠" });
  const coding = makeQuestion({ track: "written", categoryId: "written-coding", difficulty: "medium", tags: ["高频"], title: "手写 Promise.all" });
  const pool = [jsBasic, jsHard, css, coding];

  it("只返回当前轨道的题目", () => {
    expect(filterQuestions(pool, STATE).map((item) => item.id)).toEqual([jsBasic.id, jsHard.id, css.id]);
  });

  it("分类筛选精确命中", () => {
    const state = { ...STATE, categoryId: "foundation-css" as const };
    expect(filterQuestions(pool, state).map((item) => item.id)).toEqual([css.id]);
  });

  it("难度筛选与关键词可叠加", () => {
    const state = { ...STATE, difficulty: "hard" as const, keyword: "事件" };
    expect(filterQuestions(pool, state).map((item) => item.id)).toEqual([jsHard.id]);
  });

  it("多个标签取交集", () => {
    const state = { ...STATE, tags: ["高频", "大厂"] };
    expect(filterQuestions(pool, state).map((item) => item.id)).toEqual([jsHard.id]);
  });

  it("只看收藏时按 id 集合收窄", () => {
    const state = { ...STATE, favoritesOnly: true };
    const favorites = new Set<string>([css.id]);
    expect(filterQuestions(pool, state, favorites).map((item) => item.id)).toEqual([css.id]);
  });

  it("关键词忽略大小写并覆盖标题、题干与标签", () => {
    const react = makeQuestion({ track: "foundation", categoryId: "foundation-react", title: "Fiber 是什么", stem: "讲讲 React 的调度", tags: ["React 19"] });
    expect(matchesKeyword(react, "fiber")).toBe(true);
    expect(matchesKeyword(react, "调度")).toBe(true);
    expect(matchesKeyword(react, "react 19")).toBe(true);
    expect(matchesKeyword(react, "vue")).toBe(false);
    expect(matchesKeyword(react, "   ")).toBe(true);
  });
});

describe("countByCategory", () => {
  const pool = [
    makeQuestion({ track: "foundation", categoryId: "foundation-js" }),
    makeQuestion({ track: "foundation", categoryId: "foundation-js" }),
    makeQuestion({ track: "foundation", categoryId: "foundation-css" }),
    makeQuestion({ track: "written", categoryId: "written-coding" }),
  ];

  it("角标数等于「点进去后的条数」，即使当前已选中某个分类", () => {
    const state = { ...STATE, categoryId: "foundation-css" as const };
    const counts = countByCategory(pool, state);
    expect(counts.all).toBe(3);
    expect(counts["foundation-js"]).toBe(2);
    expect(counts["foundation-css"]).toBe(1);
    // 排除分类维度后仍保留轨道维度
    expect(counts["written-coding"]).toBeUndefined();
  });

  it("其它筛选条件继续生效", () => {
    const state = { ...STATE, difficulty: "medium" as const };
    const counts = countByCategory(pool, state);
    expect(counts.all).toBe(3);
    expect(counts["foundation-js"]).toBe(2);
  });
});

describe("sortQuestions", () => {
  const a = makeQuestion({ track: "foundation", categoryId: "foundation-js", updatedAt: "2026-11-14", heat: 60, difficulty: "basic" });
  const b = makeQuestion({ track: "foundation", categoryId: "foundation-js", updatedAt: "2026-11-16", heat: 90, difficulty: "hard" });
  const c = makeQuestion({ track: "foundation", categoryId: "foundation-js", updatedAt: "2026-11-10", heat: 75, difficulty: "medium" });

  it("按校对时间倒序", () => {
    expect(sortQuestions([a, b, c], "updated").map((item) => item.id)).toEqual([b.id, a.id, c.id]);
  });

  it("按热度倒序", () => {
    expect(sortQuestions([a, b, c], "hot").map((item) => item.id)).toEqual([b.id, c.id, a.id]);
  });

  it("按难度从高到低，同难度按热度", () => {
    expect(sortQuestions([a, b, c], "difficulty").map((item) => item.id)).toEqual([b.id, c.id, a.id]);
  });

  it("不修改入参数组", () => {
    const source = [a, b, c];
    sortQuestions(source, "hot");
    expect(source.map((item) => item.id)).toEqual([a.id, b.id, c.id]);
  });

  it("难度权重单调递增", () => {
    expect(DIFFICULTY_WEIGHT.basic).toBeLessThan(DIFFICULTY_WEIGHT.medium);
    expect(DIFFICULTY_WEIGHT.medium).toBeLessThan(DIFFICULTY_WEIGHT.hard);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1);

  it("按默认页大小切页", () => {
    const first = paginate(items, 1, PAGE_SIZE);
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.total).toBe(25);
    expect(first.pageCount).toBe(3);
  });

  it("末页只返回剩余条数", () => {
    const last = paginate(items, 3, PAGE_SIZE);
    expect(last.items).toHaveLength(1);
    expect(last.page).toBe(3);
  });

  it("页码越界时夹到合法区间，而不是返回空列表", () => {
    expect(paginate(items, 99, PAGE_SIZE).page).toBe(3);
    expect(paginate(items, 0, PAGE_SIZE).page).toBe(1);
    expect(paginate(items, Number.NaN, PAGE_SIZE).page).toBe(1);
  });

  it("空列表仍有 1 页，供分页器渲染", () => {
    const empty = paginate([], 2, PAGE_SIZE);
    expect(empty.items).toEqual([]);
    expect(empty.page).toBe(1);
    expect(empty.pageCount).toBe(1);
  });
});

describe("highlightSegments", () => {
  it("空关键词整体返回一个非命中片段", () => {
    expect(highlightSegments("事件循环", "  ")).toEqual([{ text: "事件循环", hit: false }]);
  });

  it("命中多处时按顺序切段", () => {
    expect(highlightSegments("Vue 的响应式与 Vue 编译", "vue")).toEqual([
      { text: "Vue", hit: true },
      { text: " 的响应式与 ", hit: false },
      { text: "Vue", hit: true },
      { text: " 编译", hit: false },
    ]);
  });

  it("未命中时整体作为一个片段", () => {
    expect(highlightSegments("闭包", "promise")).toEqual([{ text: "闭包", hit: false }]);
  });

  it("空文本返回空数组", () => {
    expect(highlightSegments("", "vue")).toEqual([]);
  });

  it("片段拼回去与原文一致（不会漏字或多字）", () => {
    const text = "React 的 Fiber 与 React 的并发特性";
    const joined = highlightSegments(text, "react").map((segment) => segment.text).join("");
    expect(joined).toBe(text);
  });
});

describe("taxonomy 与展示辅助", () => {
  it("分类节点齐全且 order 唯一递增", () => {
    expect(CATEGORIES).toHaveLength(22);
    const orders = CATEGORIES.map((node) => node.order);
    expect(new Set(orders).size).toBe(22);
  });

  it("笔试题 4 类、基础知识库 18 类", () => {
    expect(CATEGORIES.filter((node) => node.track === "written")).toHaveLength(4);
    expect(CATEGORIES.filter((node) => node.track === "foundation")).toHaveLength(18);
  });

  it("categoryPath 返回「轨道 / 分类」", () => {
    expect(categoryPath("foundation-js")).toEqual(["基础知识库", "JavaScript"]);
    expect(categoryPath("written-coding")).toEqual(["笔试题", "手写代码题"]);
  });

  it("categoryLabel 取到分类展示名", () => {
    expect(categoryLabel("foundation-react")).toBe("React");
    expect(CATEGORY_BY_ID["foundation-os"].label).toBe("操作系统与 Linux");
  });

  it("collectTags 按出现次数倒序，且只统计当前轨道", () => {
    const pool = [
      makeQuestion({ track: "foundation", categoryId: "foundation-js", tags: ["高频", "大厂"] }),
      makeQuestion({ track: "foundation", categoryId: "foundation-css", tags: ["高频"] }),
      makeQuestion({ track: "written", categoryId: "written-coding", tags: ["手写", "高频"] }),
    ];
    expect(collectTags(pool, "foundation", 2)).toEqual(["高频", "大厂"]);
  });

  it("countByCategoryId 统计各分类题量", () => {
    const pool = [
      makeQuestion({ track: "foundation", categoryId: "foundation-js" }),
      makeQuestion({ track: "foundation", categoryId: "foundation-js" }),
      makeQuestion({ track: "foundation", categoryId: "foundation-css" }),
    ];
    expect(countByCategoryId(pool)).toEqual({ "foundation-js": 2, "foundation-css": 1 });
  });
});
