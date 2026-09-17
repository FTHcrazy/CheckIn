import { describe, expect, it } from "vitest";
import { escapeHtml, highlightText } from "./memo-utils";

describe("escapeHtml", () => {
  it("转义全部 HTML 特殊字符", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#039;",
    );
  });

  it("普通文本原样返回", () => {
    expect(escapeHtml("普通文本 123")).toBe("普通文本 123");
  });

  it("空字符串返回空字符串", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("highlightText", () => {
  it("无搜索词时仅做 HTML 转义", () => {
    expect(highlightText("a<b", "", 0)).toBe("a&lt;b");
  });

  it("命中时用 <mark> 包裹全部匹配", () => {
    const result = highlightText("one two one", "one", 0);
    expect(result).toBe(
      '<mark class="memo-search-highlight memo-search-highlight--active">one</mark> ' +
        'two <mark class="memo-search-highlight">one</mark>',
    );
  });

  it("activeIndex 决定哪个匹配高亮为 active", () => {
    const result = highlightText("x y x", "x", 1);
    expect(result).toBe(
      '<mark class="memo-search-highlight">x</mark> y ' +
        '<mark class="memo-search-highlight memo-search-highlight--active">x</mark>',
    );
  });

  it("大小写不敏感匹配", () => {
    expect(highlightText("Foo foo", "foo", 0)).toContain(">Foo</mark>");
    expect(highlightText("Foo foo", "foo", 0)).toContain(">foo</mark>");
  });

  it("搜索词含正则特殊字符时按字面匹配", () => {
    expect(highlightText("a.b c", "a.b", 0)).toBe(
      '<mark class="memo-search-highlight memo-search-highlight--active">a.b</mark> c',
    );
  });

  it("搜索词含 HTML 特殊字符时不破坏标记结构", () => {
    // 原文 AT&T 先被 escapeHtml 转成 AT&amp;T，搜索 "&" 也应命中同一片段
    const result = highlightText("AT&T and <b>bold</b>", "&", 0);
    expect(result).toBe(
      'AT<mark class="memo-search-highlight memo-search-highlight--active">&amp;</mark>T ' +
        "and &lt;b&gt;bold&lt;/b&gt;",
    );
  });

  it("搜索词含尖括号时高亮转义后的实体而不是真实标签", () => {
    const result = highlightText("1 < 2", "<", 0);
    expect(result).toBe(
      '1 <mark class="memo-search-highlight memo-search-highlight--active">&lt;</mark> 2',
    );
  });

  it("未命中时返回转义后的原文", () => {
    expect(highlightText("hello world", "zzz", 0)).toBe("hello world");
  });
});
