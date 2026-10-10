import { describe, expect, it } from "vitest";
import { detectEncoding } from "./import.worker";
import { parseTxtBook } from "./novel-import-parser";

/**
 * 端到端（纯函数级）：字节 → 编码探测 → 拆章 → 卷章结构。
 * 覆盖真实场景：GB18030 旧书、卷章混排、盗版广告行。
 */

/** 用 GB18030 手工构造字节（Node 侧用 TextEncoder 不支持该编码，故用转义样本） */
function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("detectEncoding", () => {
  it("UTF-8 文本走 UTF-8 分支", () => {
    const { text, encoding } = detectEncoding(utf8Bytes("第一章 初见\n正文内容"));
    expect(encoding).toBe("utf-8");
    expect(text).toContain("第一章 初见");
  });

  it("明显 GB18030 字节流被识别并正确解码", () => {
    // 「中文测试」的 GB18030 字节：D6 D0 CE C4 B2 E2 CA D4
    const gb = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]);
    const { text, encoding } = detectEncoding(gb);
    expect(encoding).toBe("gb18030");
    expect(text).toBe("中文测试");
  });
});

describe("端到端：字节 → 卷章结构", () => {
  it("卷章混排 + 广告行过滤（UTF-8）", () => {
    const raw = [
      "《样例小说》",
      "作者：某某",
      "www.example.com",
      "第一卷 少年游",
      "",
      "第一章 出生",
      "他在风雪夜里出生。",
      "",
      "第二章 离乡",
      "十二年后他离乡远行。",
      "",
      "第二卷 江湖路",
      "第一章 初入江湖",
      "他第一次见到了江湖。",
      "最新章节请记住本站",
      "第二章 拜师",
      "他拜入一位老者门下。",
    ].join("\r\n");

    const { text, encoding } = detectEncoding(utf8Bytes(raw));
    expect(encoding).toBe("utf-8");
    const book = parseTxtBook(text);

    expect(book.structured).toBe(true);
    expect(book.volumes.map((v) => v.name)).toEqual(["第一卷 少年游", "第二卷 江湖路"]);

    // 书名 / 作者 / 网址行不是标题，归入卷首兜底章
    const titles = book.chapters.map((c) => c.title);
    expect(titles).toContain("第一卷 少年游 · 序");
    expect(titles).toContain("第一章 出生");
    expect(titles).toContain("第二章 离乡");
    expect(titles).toContain("第一章 初入江湖");
    expect(titles).toContain("第二章 拜师");
    // 广告行不成为章节
    expect(titles.some((t) => t.includes("最新章节"))).toBe(false);

    // 卷归属正确
    const byTitle = (t: string) => book.chapters.find((c) => c.title === t)!;
    expect(byTitle("第一章 出生").volumeIndex).toBe(0);
    expect(byTitle("第二章 离乡").volumeIndex).toBe(0);
    expect(byTitle("第一章 初入江湖").volumeIndex).toBe(1);
    expect(byTitle("第二章 拜师").volumeIndex).toBe(1);

    // 广告行被并入正文而非丢弃
    expect(byTitle("第一章 初入江湖").content).toContain("最新章节请记住本站");
  });

  it("超大单章不会吞掉后续章节（标题依然切分）", () => {
    const body = Array.from({ length: 500 }, (_, i) => `第 ${i} 段正文。`).join("\n");
    const raw = `第一章 甲\n${body}\n第二章 乙\n收尾。`;
    const book = parseTxtBook(raw);
    expect(book.chapters.map((c) => c.title)).toEqual(["第一章 甲", "第二章 乙"]);
    expect(book.chapters[1].content).toBe("收尾。");
  });
});
