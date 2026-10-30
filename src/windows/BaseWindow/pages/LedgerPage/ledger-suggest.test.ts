import { describe, expect, it } from "vitest";
import {
  buildSuggestHistory,
  normalizeNote,
  suggestCategories,
  suggestCategoriesFromHistory,
  type SuggestCategory,
  type SuggestHistoryItem,
} from "./ledger-suggest";

/**
 * 记账分类建议（R-AI-16a）单测
 *
 * 这个功能的成败同样在**信噪比**：建议对了是「一键确认」，建议错了是
 * 「每次都要先删掉一个错分类」，比没有更烦。所以每条用例都写清
 * 「凭什么给它这个分」。
 */

const CATEGORIES: SuggestCategory[] = [
  { id: "food", name: "餐饮", type: "expense" },
  { id: "transport", name: "交通", type: "expense" },
  { id: "shopping", name: "购物", type: "expense" },
  { id: "fun", name: "娱乐", type: "expense" },
  { id: "salary", name: "工资", type: "income" },
  { id: "other", name: "其他", type: "both" },
];

function history(
  note: string,
  categoryId: string,
  type: "expense" | "income" | "transfer" = "expense",
): SuggestHistoryItem {
  return { note, categoryId, type };
}

describe("normalizeNote", () => {
  it("去掉空白与标点、转小写（「地铁 2 号线」与「地铁2号线」是同一条）", () => {
    expect(normalizeNote("地铁 2 号线")).toBe("地铁2号线");
    expect(normalizeNote("Starbucks，咖啡")).toBe("starbucks咖啡");
  });
});

describe("关键词兜底（没有历史样本时）", () => {
  it("「地铁」建议交通", () => {
    const result = suggestCategoriesFromHistory({
      note: "地铁",
      type: "expense",
      categories: CATEGORIES,
      history: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe("transport");
    expect(result[0].reason).toBe("keyword");
    expect(result[0].word).toBe("地铁");
  });

  it("类型不匹配时不出建议（支出里记「工资到账」，不该推收入分类）", () => {
    const result = suggestCategoriesFromHistory({
      note: "工资到账",
      type: "expense",
      categories: CATEGORIES,
      history: [],
    });
    expect(result).toEqual([]);
  });

  it("同一句在收入下就建议工资", () => {
    const result = suggestCategoriesFromHistory({
      note: "工资到账",
      type: "income",
      categories: CATEGORIES,
      history: [],
    });
    expect(result.map((item) => item.categoryId)).toEqual(["salary"]);
  });

  it("分类被改名也能命中：按分类名里的「吃饭」找到自定义分类", () => {
    const result = suggestCategoriesFromHistory({
      note: "外卖",
      type: "expense",
      categories: [{ id: "c1", name: "吃饭喝水", type: "expense" }],
      history: [],
    });
    expect(result.map((item) => item.categoryId)).toEqual(["c1"]);
  });

  it("已归档的分类不参与建议", () => {
    const result = suggestCategoriesFromHistory({
      note: "地铁",
      type: "expense",
      categories: [{ id: "transport", name: "交通", type: "expense", archived: true }],
      history: [],
    });
    expect(result).toEqual([]);
  });

  it("完全不像任何一类时不硬猜", () => {
    const result = suggestCategoriesFromHistory({
      note: "随手记一笔",
      type: "expense",
      categories: CATEGORIES,
      history: [],
    });
    expect(result).toEqual([]);
  });
});

describe("历史学习", () => {
  it("备注完全一致时给满分，且排在关键词建议之前", () => {
    const result = suggestCategoriesFromHistory({
      note: "星巴克",
      type: "expense",
      // 用户习惯把咖啡记成「娱乐」——历史就该压过词表
      history: [history("星巴克", "fun"), history("星巴克", "fun"), history("星巴克", "fun")],
      categories: CATEGORIES,
    });
    expect(result[0].categoryId).toBe("fun");
    expect(result[0].reason).toBe("history");
    expect(result[0].score).toBe(1);
    expect(result[0].count).toBe(3);
    // 词表仍然给出第二条候选（餐饮），只是排在后面
    expect(result[1].categoryId).toBe("food");
  });

  it("部分重合按证据条数升分：一条 0.55、两条 0.65", () => {
    const one = suggestCategoriesFromHistory({
      note: "星巴克",
      type: "expense",
      categories: CATEGORIES,
      history: [history("楼下星巴克", "fun")],
    });
    const two = suggestCategoriesFromHistory({
      note: "星巴克",
      type: "expense",
      categories: CATEGORIES,
      history: [history("楼下星巴克", "fun"), history("星巴克美式", "fun")],
    });
    const oneFun = one.find((item) => item.categoryId === "fun");
    const twoFun = two.find((item) => item.categoryId === "fun");
    expect(oneFun?.score).toBeCloseTo(0.55, 5);
    expect(twoFun?.score).toBeCloseTo(0.65, 5);
    expect(twoFun?.count).toBe(2);
  });

  it("一字备注不进索引（「饭」「水」跟任何输入都能重合，是噪声源）", () => {
    const index = buildSuggestHistory([history("饭", "food"), history("食堂", "food")]);
    expect(index).toHaveLength(1);
    expect(index[0].note).toBe("食堂");
  });

  it("历史里的转账记录不参与（转账没有分类语义）", () => {
    const result = suggestCategoriesFromHistory({
      note: "还款",
      type: "expense",
      categories: CATEGORIES,
      history: [history("还款", "shopping", "transfer")],
    });
    expect(result.some((item) => item.reason === "history")).toBe(false);
  });

  it("归一后才比对：「地铁 2 号线」与「地铁2号线」算同一条备注", () => {
    const result = suggestCategoriesFromHistory({
      note: "地铁 2 号线",
      type: "expense",
      categories: CATEGORIES,
      history: [history("地铁2号线", "transport")],
    });
    expect(result[0]).toMatchObject({ categoryId: "transport", reason: "history", score: 1 });
  });
});

describe("边界", () => {
  it("空备注 / 一字备注不出建议（一进输入框就弹是骚扰）", () => {
    const index = buildSuggestHistory([history("星巴克", "fun")]);
    const base = { type: "expense" as const, categories: CATEGORIES, index };
    expect(suggestCategories({ ...base, note: "" })).toEqual([]);
    expect(suggestCategories({ ...base, note: "星" })).toEqual([]);
  });

  it("最多 3 条，按分数降序", () => {
    const same = ["food", "transport", "shopping", "fun"] as const;
    const result = suggestCategoriesFromHistory({
      note: "超市买菜",
      type: "expense",
      categories: CATEGORIES,
      history: same.map((id) => history("超市买菜", id)),
    });
    expect(result).toHaveLength(3);
    expect(new Set(result.map((item) => item.categoryId)).size).toBe(3);
    const scores = result.map((item) => item.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("同一分类被历史与关键词同时指向时只留一条，取更强的来源", () => {
    const result = suggestCategoriesFromHistory({
      note: "地铁",
      type: "expense",
      categories: CATEGORIES,
      history: [history("地铁", "transport")],
    });
    expect(result.filter((item) => item.categoryId === "transport")).toHaveLength(1);
    expect(result[0].reason).toBe("history");
    expect(result[0].score).toBe(1);
  });
});
