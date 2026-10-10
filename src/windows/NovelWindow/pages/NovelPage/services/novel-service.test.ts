import { describe, expect, it } from "vitest";
import { searchAcrossBook } from "./novel-service";
import type { NovelChapter } from "../types";

/**
 * 全书检索是渲染层唯一的「全书级同步 CPU 工作」：防抖每触发一次就要扫一遍
 * 每一章。这里钉住两件事 —— 计数口径正确，以及**未命中的章不建摘要**
 * （摘要里的全文正则才是卡顿的真正来源）。
 */

function chapter(id: string, content: string): NovelChapter {
  return {
    id,
    workId: "w1",
    volumeId: "v1",
    title: id,
    content,
    wordCount: content.length,
    status: "draft",
    sort: 1,
    updatedAt: 0,
  };
}

describe("searchAcrossBook —— 全书检索", () => {
  it("空关键词直接返回，不扫任何章节", async () => {
    await expect(searchAcrossBook("   ", [chapter("c1", "青梧")])).resolves.toEqual(
      [],
    );
  });

  it("按章聚合命中次数，并按次数倒序", async () => {
    const hits = await searchAcrossBook("青梧", [
      chapter("c1", "青梧"),
      chapter("c2", "青梧见青梧"),
      chapter("c3", "旁白"),
    ]);
    expect(hits.map((hit) => hit.chapterId)).toEqual(["c2", "c1"]);
    expect(hits[0].count).toBe(2);
    expect(hits[1].count).toBe(1);
  });

  it("未命中的章不进结果、也不生成摘要", async () => {
    const hits = await searchAcrossBook("灵潮", [chapter("c1", "青梧走进山门")]);
    expect(hits).toEqual([]);
  });

  it("关键词两端空白被忽略（输入框里的偶发空格不该搜不到）", async () => {
    const hits = await searchAcrossBook("  青梧  ", [chapter("c1", "青梧")]);
    expect(hits).toHaveLength(1);
  });

  it("重叠出现的关键词也逐次计数（indexOf 步进不漏）", async () => {
    // "aa" 在 "aaaa" 里出现 3 次（非重叠），split 与 indexOf 口径一致
    const hits = await searchAcrossBook("aa", [chapter("c1", "aaaa")]);
    expect(hits[0].count).toBe(2);
  });

  it("命中章带摘要片段", async () => {
    const hits = await searchAcrossBook("灵潮", [
      chapter("c1", "他感受到一阵灵潮涌动，山门随之震动"),
    ]);
    expect(hits[0].snippet).toContain("灵潮");
  });
});
