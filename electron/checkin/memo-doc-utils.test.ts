import { describe, expect, it } from "vitest";
import {
  collapseBlankLines,
  markdownToDocxBlocks,
  markdownToPlainText,
  stripInlineMarkdown,
} from "./memo-doc-utils";

describe("stripInlineMarkdown", () => {
  it("去掉加粗 / 斜体 / 行内代码标记", () => {
    expect(stripInlineMarkdown("**加粗** 和 *斜体* 与 `code`")).toBe(
      "加粗 和 斜体 与 code",
    );
  });

  it("链接保留文字，图片保留 alt", () => {
    expect(stripInlineMarkdown("[首页](https://a.b) 与 ![logo](x.png)")).toBe(
      "首页 与 logo",
    );
  });

  it("普通文本原样返回", () => {
    expect(stripInlineMarkdown("第一卷 · 风起")).toBe("第一卷 · 风起");
  });
});

describe("collapseBlankLines", () => {
  it("三个以上连续空行压缩为一个空行", () => {
    expect(collapseBlankLines("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("首尾空白被裁剪", () => {
    expect(collapseBlankLines("\n\n a \n\n")).toBe("a");
  });
});

describe("markdownToPlainText", () => {
  it("标题、列表、引用与行内标记都被剥离", () => {
    const md = [
      "# 标题",
      "",
      "- 项目一",
      "- 项目二",
      "",
      "> 引用一句话",
      "",
      "正文含 **重点** 与 [链接](https://x.y)。",
    ].join("\n");
    expect(markdownToPlainText(md)).toBe(
      [
        "标题",
        "",
        "• 项目一",
        "• 项目二",
        "",
        "引用一句话",
        "",
        "正文含 重点 与 链接。",
      ].join("\n"),
    );
  });

  it("有序列表保留编号，分隔线丢弃", () => {
    const md = "1. 第一步\n2. 第二步\n\n---\n\n结尾";
    expect(markdownToPlainText(md)).toBe("1. 第一步\n2. 第二步\n\n结尾");
  });

  it("CRLF 换行被归一", () => {
    expect(markdownToPlainText("# A\r\n\r\nbody\r\n")).toBe("A\n\nbody");
  });
});

describe("markdownToDocxBlocks", () => {
  it("解析标题层级、无序列表与正文段落", () => {
    const md = "# 卷一\n\n## 第一节\n\n- 甲\n- 乙\n\n正文一段。";
    expect(markdownToDocxBlocks(md)).toEqual([
      { type: "heading", level: 1, text: "卷一" },
      { type: "heading", level: 2, text: "第一节" },
      { type: "bullet", text: "甲" },
      { type: "bullet", text: "乙" },
      { type: "paragraph", text: "正文一段。" },
    ]);
  });

  it("空行丢弃；分隔线丢弃；引用按段落保留文字；五级标题收敛到 4", () => {
    const md = "##### 深层\n\n> 引用\n\n---\n\n尾巴";
    expect(markdownToDocxBlocks(md)).toEqual([
      { type: "heading", level: 4, text: "深层" },
      { type: "paragraph", text: "引用" },
      { type: "paragraph", text: "尾巴" },
    ]);
  });

  it("空文档返回空数组", () => {
    expect(markdownToDocxBlocks("\n\n  \n")).toEqual([]);
  });
});
