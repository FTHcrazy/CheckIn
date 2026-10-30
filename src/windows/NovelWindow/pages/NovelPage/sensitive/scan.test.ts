import { describe, expect, it } from "vitest";
import {
  buildHitSnippet,
  buildScanResult,
  scanChapter,
  scanChapterWithMatches,
  scanText,
} from "./scan";
import type { NovelChapter } from "../types";

const chapter = (over: Partial<NovelChapter>): NovelChapter => ({
  id: "c1",
  workId: "w1",
  volumeId: "v1",
  title: "第一章",
  content: "",
  wordCount: 0,
  status: "draft",
  sort: 1,
  updatedAt: 0,
  ...over,
});

describe("scanText", () => {
  it("返回原文坐标而非归一化坐标", () => {
    const hits = scanText("这是色情内容", ["色情"]);
    expect(hits).toEqual([{ word: "色情", from: 2, to: 4 }]);
  });

  it("命中词之间互不重叠", () => {
    const hits = scanText("色情小说", ["色情", "色情小说"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].word).toBe("色情小说");
  });

  it("空文本 / 空词库返回空数组", () => {
    expect(scanText("", ["色情"])).toEqual([]);
    expect(scanText("色情", [])).toEqual([]);
  });

  it("同一词多次出现各算一条", () => {
    const hits = scanText("赌博赌博", ["赌博"]);
    expect(hits).toHaveLength(2);
    expect(hits.map((hit) => hit.from)).toEqual([0, 2]);
  });
});

describe("buildHitSnippet", () => {
  it("前后各取上下文，换行压成空格", () => {
    const text = "开头\n中间有色情内容\n结尾";
    const from = text.indexOf("色情");
    const snippet = buildHitSnippet(text, from, from + 2, 3);
    expect(snippet).toContain("色情");
    expect(snippet).not.toContain("\n");
  });

  it("命中在开头 / 结尾时不加省略号", () => {
    expect(buildHitSnippet("色情内容", 0, 2, 2)).not.toContain("…");
  });

  it("上下文被截断时两端加省略号", () => {
    const text = "一二三四五六七八色情九十十一十二十三十四";
    const from = text.indexOf("色情");
    const snippet = buildHitSnippet(text, from, from + 2, 2);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });
});

describe("scanChapter", () => {
  it("按词聚合：同一个词只产出一条，count 为命中次数", () => {
    const hits = scanChapter("c1", "第一章", "赌博，又是赌博，还是赌博", ["赌博"]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      word: "赌博",
      chapterId: "c1",
      chapterTitle: "第一章",
      count: 3,
      from: 0,
    });
  });

  it("多个词各成一条，按命中次数降序", () => {
    const hits = scanChapter("c1", "第一章", "赌博赌博血腥", ["赌博", "血腥"]);
    expect(hits.map((hit) => hit.word)).toEqual(["赌博", "血腥"]);
  });

  it("未命中返回空数组", () => {
    expect(scanChapter("c1", "第一章", "干净的正文", ["赌博"])).toEqual([]);
  });
});

describe("buildScanResult", () => {
  it("汇总命中次数 / 词条数 / 章节数", () => {
    const hits = scanChapter("c1", "第一章", "赌博赌博", ["赌博"]).concat(
      scanChapter("c2", "第二章", "血腥", ["血腥"]),
    );
    const result = buildScanResult(hits, "book", 123);
    expect(result.total).toBe(3);
    expect(result.wordCount).toBe(2);
    expect(result.chapterCount).toBe(2);
    expect(result.scannedAt).toBe(123);
    expect(result.scope).toBe("book");
  });

  it("空结果三个计数都是 0", () => {
    const result = buildScanResult([], "chapter", 1);
    expect([result.total, result.wordCount, result.chapterCount]).toEqual([0, 0, 0]);
  });
});

describe("scanChapter 与章标题的耦合", () => {
  it("章节对象为空正文时安全返回", () => {
    const empty = chapter({ content: "" });
    expect(scanChapter(empty.id, empty.title, empty.content, ["色情"])).toEqual([]);
  });
});

describe("scanChapterWithMatches：聚合与逐处区间是同一次扫描", () => {
  it("matches 是每一处、hits 是按词聚合，两者不能各扫一遍", () => {
    const scan = scanChapterWithMatches(
      "c1",
      "第一章",
      "斩首示众，又一次斩首。",
      ["斩首"],
    );
    // 面板列表只给一行（按词聚合），正文标红要两处
    expect(scan.hits).toHaveLength(1);
    expect(scan.hits[0].count).toBe(2);
    expect(scan.matches).toHaveLength(2);
    // 区间必须落在原文里、且就是那个词
    expect(scan.matches.map((m) => m.word)).toEqual(["斩首", "斩首"]);
    expect(scan.matches[0].to).toBeGreaterThan(scan.matches[0].from);
  });

  it("未命中时两份结果都是空（手动模式的空标注来源）", () => {
    const scan = scanChapterWithMatches("c1", "第一章", "干净的正文", ["赌博"]);
    expect(scan.hits).toEqual([]);
    expect(scan.matches).toEqual([]);
  });
});
