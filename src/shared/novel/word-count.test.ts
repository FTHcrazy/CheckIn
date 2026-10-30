import { describe, expect, it } from "vitest";
import { countWords, type WordCountMode } from "./word-count";

describe("countWords（N-07 唯一口径）", () => {
  it("空串返回 0", () => {
    expect(countWords("", "withPunctuation")).toBe(0);
    expect(countWords("", "hanOnly")).toBe(0);
  });

  it("纯空白（空格 / 换行 / 制表 / 全角 / 不换行空格）返回 0", () => {
    const blank = " \n\t\r\u3000\u00a0";
    expect(countWords(blank, "withPunctuation")).toBe(0);
    expect(countWords(blank, "hanOnly")).toBe(0);
  });

  it("withPunctuation：统计非空白字符，标点计入", () => {
    expect(countWords("你好，世界！", "withPunctuation")).toBe(6);
    expect(countWords("a b  c", "withPunctuation")).toBe(3);
  });

  it("hanOnly：只数汉字，忽略标点 / 数字 / 空白", () => {
    expect(countWords("你好，世界！ a b", "hanOnly")).toBe(4);
    // 第 / 章 / 灵 / 潮 = 4，数字 1 与空格不计
    expect(countWords("第1章 灵潮", "hanOnly")).toBe(4);
  });

  it("含 emoji（星平面字符）按「码点」计 1 —— 与编辑器口径一致", () => {
    expect(countWords("😀", "withPunctuation")).toBe(1);
    expect(countWords("你好😀", "withPunctuation")).toBe(3);
    // 对照：星平面字符占两个 UTF-16 码元。旧导入实现 `replace(/\s/g,"").length`
    // 会算成 2，这正是 N-07 要消除的口径漂移。
    expect("😀".replace(/\s/g, "").length).toBe(2);
    expect("😀".length).toBe(2);
  });

  it("CJK 扩展 B 区（U+20000，星平面）按码点计 1；hanOnly 沿用既有区间不计入", () => {
    // withPunctuation：\S 带 u 标志 → 1 个码点
    expect(countWords("\u{20000}", "withPunctuation")).toBe(1);
    expect("\u{20000}".length).toBe(2);
    // hanOnly 的区间只覆盖扩展 A / 基本区 / 兼容区（与迁移前一致），扩展 B 不计
    expect(countWords("\u{20000}", "hanOnly")).toBe(0);
  });

  it("与迁移前 novel-utils 的实现（逐字符语义）逐输入等价", () => {
    // 迁移前实现的原样复刻，用作特征化对照
    const legacy = (text: string, mode: WordCountMode): number => {
      if (!text) return 0;
      if (mode === "hanOnly") {
        const matched = text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g);
        return matched ? matched.length : 0;
      }
      const matched = text.match(/\S/gu);
      return matched ? matched.length : 0;
    };

    const corpus = [
      "",
      "   \n\t",
      "你好，世界！",
      "a b\nc\td",
      "😀😀 hello 世界",
      "\u{20000} 汉 字",
      "。。。！？",
      "第1章 灵潮起",
    ];
    for (const text of corpus) {
      expect(countWords(text, "withPunctuation")).toBe(legacy(text, "withPunctuation"));
      expect(countWords(text, "hanOnly")).toBe(legacy(text, "hanOnly"));
    }
  });
});
