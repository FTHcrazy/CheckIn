import { describe, expect, it } from "vitest";
import { buildTaxonomySuggestion } from "./useTaxonomySuggest";

/**
 * 分类建议的归一（规范 §9 闸门 ①）。
 *
 * 这一层的产物**不进侧栏**，只是「建议」：所以重名 / 超长不做静默丢弃，
 * 而是记 `errors` 让用户看见 —— 「模型建议了一个已经存在的分类」本身就是
 * 有用信息（说明这块已经有人占了）。
 */
const base = { track: "foundation" as const, takenLabels: ["React", "浏览器"], keySeed: "k" };

describe("buildTaxonomySuggestion", () => {
  it("正常建议：label / track / note / 示例题名都归一好", () => {
    const suggestion = buildTaxonomySuggestion({
      ...base,
      entry: {
        label: "RSC 与服务端组件",
        track: "written",
        note: "服务端组件与客户端组件的边界",
        sampleTitles: "RSC 与 SSR 的区别、use client 的边界、序列化限制",
      },
    });
    expect(suggestion?.errors).toEqual([]);
    expect(suggestion?.track).toBe("written");
    expect(suggestion?.samples).toEqual(["RSC 与 SSR 的区别", "use client 的边界", "序列化限制"]);
  });

  it("没有 label 直接丢（没有名字的分类无处可落）", () => {
    expect(buildTaxonomySuggestion({ ...base, entry: { note: "只有说明" } })).toBeNull();
  });

  it("超过上限与重名都记 errors（但不丢建议）", () => {
    const tooLong = buildTaxonomySuggestion({
      ...base,
      entry: { label: "一个特别特别特别特别特别特别长的分类名称啊" },
    });
    expect(tooLong?.errors.length).toBeGreaterThan(0);
    expect(tooLong?.errors.join("；")).toContain("超过");

    const duplicated = buildTaxonomySuggestion({ ...base, entry: { label: "react" } });
    expect(duplicated?.errors.join("；")).toContain("已经有");
  });

  it("中文轨道名也认，认不出回落调用方的轨道", () => {
    expect(
      buildTaxonomySuggestion({ ...base, entry: { label: "A", track: "手写题" } })?.track,
    ).toBe("written");
    expect(
      buildTaxonomySuggestion({ ...base, entry: { label: "B", track: "不认识" } })?.track,
    ).toBe("foundation");
  });

  it("示例题名最多留 3 条，并剥掉编号前缀", () => {
    const suggestion = buildTaxonomySuggestion({
      ...base,
      entry: { label: "C", sampleTitles: "1. 一、2. 二\n3. 三；4. 四" },
    });
    expect(suggestion?.samples).toEqual(["一", "二", "三"]);
  });
});
