import { describe, expect, it } from "vitest";
import {
  countWords,
  DEFAULT_VOLUME_NAME,
  isChapterTitle,
  isVolumeTitle,
  parseTxtBook,
} from "./novel-import-parser";

describe("标题识别", () => {
  it("识别常见章节标题", () => {
    for (const line of [
      "第一章 初见",
      "第1章 初见",
      "第一百二十三章 终局",
      "第十回 交手",
      "第五十七节 尾声",
      "Chapter 12 The End",
      "  第003章 无缩进  ",
    ]) {
      expect(isChapterTitle(line), line).toBe(true);
    }
  });

  it("识别卷标题（严格模式）", () => {
    for (const line of [
      "第一卷 风起云涌",
      "第一卷：风起",
      "第 二 卷",
      "卷一",
      "卷12 少年游",
      "12卷 少年游",
      "Volume 3",
      "Book 2 归途",
    ]) {
      expect(isVolumeTitle(line), line).toBe(true);
    }
  });

  it("卷标题不算章，章标题不算卷", () => {
    expect(isChapterTitle("第一卷 风起")).toBe(false);
    expect(isVolumeTitle("第一章 初见")).toBe(false);
  });

  it("广告元信息行一律不识别为标题", () => {
    for (const line of [
      "第一章 请记住本站",
      "www.example.com",
      "最新章节",
      "作者：某某",
      "内容简介：",
      "【『第一章』】",
      "http://abc.com",
    ]) {
      expect(isChapterTitle(line), line).toBe(false);
      expect(isVolumeTitle(line), line).toBe(false);
    }
  });

  it("普通句子不误判", () => {
    for (const line of ["他走进第一卷书库", "这是一个很长的普通叙述段落，不属于任何标题"]) {
      expect(isChapterTitle(line), line).toBe(false);
      expect(isVolumeTitle(line), line).toBe(false);
    }
  });
});

describe("parseTxtBook", () => {
  it("无卷结构：全部章节归入默认卷「正文」", () => {
    const text = [
      "第一章 开端",
      "正文一。",
      "",
      "第二章 发展",
      "正文二。",
    ].join("\n");

    const book = parseTxtBook(text);
    expect(book.structured).toBe(true);
    expect(book.volumes).toHaveLength(1);
    expect(book.volumes[0].name).toBe(DEFAULT_VOLUME_NAME);
    expect(book.chapters.map((c) => c.title)).toEqual(["第一章 开端", "第二章 发展"]);
    expect(book.chapters.every((c) => c.volumeIndex === 0)).toBe(true);
    expect(book.chapters[0].content).toBe("正文一。");
    expect(book.chapters[1].content).toBe("正文二。");
  });

  it("卷归档：章节归属最近一个卷", () => {
    const text = [
      "第一卷 少年",
      "第一章 出生",
      "他出生了。",
      "第二章 求学",
      "他去求学。",
      "第二卷 风云",
      "第三章 出山",
      "他出山了。",
    ].join("\n");

    const book = parseTxtBook(text);
    expect(book.volumes.map((v) => v.name)).toEqual(["第一卷 少年", "第二卷 风云"]);
    expect(book.chapters.map((c) => c.title)).toEqual([
      "第一章 出生",
      "第二章 求学",
      "第三章 出山",
    ]);
    // 前两章属卷 0，第三章属卷 1
    expect(book.chapters.map((c) => c.volumeIndex)).toEqual([0, 0, 1]);
  });

  it("开新卷后章节不会被上一卷续写", () => {
    const text = ["第一卷 A", "第一章 x", "aaa", "第二卷 B", "bbb"].join("\n");
    const book = parseTxtBook(text);
    // 「bbb」应落在卷 1 的兜底序章，而不是续到「第一章 x」里
    const first = book.chapters.find((c) => c.title === "第一章 x");
    expect(first?.content).toBe("aaa");
    const volumeOneChapters = book.chapters.filter((c) => c.volumeIndex === 1);
    expect(volumeOneChapters).toHaveLength(1);
    expect(volumeOneChapters[0].content).toBe("bbb");
  });

  it("无卷标记但开头有引文：开兜底序章容纳", () => {
    const text = ["这是引子。", "第一章 开端", "正文。"].join("\n");
    const book = parseTxtBook(text);
    expect(book.chapters[0].title).toContain("序");
    expect(book.chapters[0].content).toBe("这是引子。");
    expect(book.chapters[1].title).toBe("第一章 开端");
    expect(book.structured).toBe(true);
  });

  it("卷标记前的前言并入首个真实卷（不留「正文」空卷）", () => {
    // 书名 / 作者 / 网址在前，首个「第X卷」在后
    const text = [
      "《样例小说》",
      "作者：某某",
      "www.example.com",
      "第一卷 少年游",
      "第一章 出生",
      "他出生了。",
    ].join("\n");

    const book = parseTxtBook(text);
    // 没有多余的「正文」卷
    expect(book.volumes.map((v) => v.name)).toEqual(["第一卷 少年游"]);
    // 前言归入该卷的「· 序」章，且卷下标已修正为 0
    expect(book.chapters[0].title).toBe("第一卷 少年游 · 序");
    expect(book.chapters[0].volumeIndex).toBe(0);
    expect(book.chapters[0].content).toContain("《样例小说》");
    // 正常章节紧随其后，同属卷 0
    expect(book.chapters[1].title).toBe("第一章 出生");
    expect(book.chapters[1].volumeIndex).toBe(0);
  });

  it("无任何卷标记时前言仍留「正文 · 序」", () => {
    const text = ["前言一句。", "第一章 开端", "正文。"].join("\n");
    const book = parseTxtBook(text);
    expect(book.volumes.map((v) => v.name)).toEqual([DEFAULT_VOLUME_NAME]);
    expect(book.chapters[0].title).toBe("正文 · 序");
    expect(book.chapters[0].volumeIndex).toBe(0);
  });

  it("相邻重复标题折叠", () => {
    const text = ["第一章 开端", "第一章 开端", "正文。"].join("\n");
    const book = parseTxtBook(text);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].content).toBe("正文。");
  });

  it("完全没有章节结构：整本兜底成一章且 structured=false", () => {
    const text = "这是一段没有任何章节标题的散文。\n第二段。";
    const book = parseTxtBook(text);
    expect(book.structured).toBe(false);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].content).toContain("散文");
    expect(book.volumes[0].name).toBe(DEFAULT_VOLUME_NAME);
  });

  it("只有卷、没有章标题：仍算未结构化，不产出空章", () => {
    const text = ["第一卷 少年", "", "第二卷 风云"].join("\n");
    const book = parseTxtBook(text);
    expect(book.structured).toBe(false);
    expect(book.chapters).toHaveLength(1);
  });

  it("Windows 换行 \\r\\n 正确处理", () => {
    const text = "第一章 A\r\naaa\r\n第二章 B\r\nbbb";
    const book = parseTxtBook(text);
    expect(book.chapters.map((c) => c.title)).toEqual(["第一章 A", "第二章 B"]);
    expect(book.chapters[0].content).toBe("aaa");
    expect(book.chapters[1].content).toBe("bbb");
  });

  it("章标题里的多余空白被规整", () => {
    const book = parseTxtBook("第  一  章    开端\n正文");
    expect(book.chapters[0].title).toBe("第 一 章 开端");
  });
});

describe("countWords", () => {
  it("忽略空白字符", () => {
    expect(countWords("你好 世界\n第二行")).toBe(7);
    expect(countWords("   ")).toBe(0);
  });
});
