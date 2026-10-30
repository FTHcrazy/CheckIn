import { describe, expect, it } from "vitest";
import {
  buildActiveWords,
  buildWordList,
  normalizeTerm,
  parseImportedWords,
  parseSensitiveConfig,
  sanitizeSensitiveConfig,
  sanitizeTerms,
} from "./words";
import { BUILTIN_SENSITIVE_WORDS } from "./builtin-words";
import { DEFAULT_SENSITIVE_CONFIG } from "./types";

describe("normalizeTerm", () => {
  it("去首尾空白并压缩内部空白", () => {
    expect(normalizeTerm("  色  情 ")).toBe("色 情");
  });

  it("空串与超长词条返回空串", () => {
    expect(normalizeTerm("   ")).toBe("");
    expect(normalizeTerm("长".repeat(41))).toBe("");
  });
});

describe("sanitizeTerms", () => {
  it("过滤非字符串、空项与重复项", () => {
    expect(sanitizeTerms(["色情", 42, "", null, "色情", " 赌博 "])).toEqual([
      "色情",
      "赌博",
    ]);
  });

  it("非数组输入返回空数组", () => {
    expect(sanitizeTerms(null)).toEqual([]);
    expect(sanitizeTerms("色情")).toEqual([]);
  });
});

describe("sanitizeSensitiveConfig", () => {
  it("非法输入整体回退默认值", () => {
    expect(sanitizeSensitiveConfig(null)).toEqual(DEFAULT_SENSITIVE_CONFIG);
    expect(sanitizeSensitiveConfig("x")).toEqual(DEFAULT_SENSITIVE_CONFIG);
  });

  it("屏蔽列表只保留确实是内置词的项", () => {
    const builtin = BUILTIN_SENSITIVE_WORDS[0];
    const config = sanitizeSensitiveConfig({
      words: ["自定义词"],
      muted: [builtin, "根本不是内置词"],
      mode: "auto",
    });
    expect(config.words).toEqual(["自定义词"]);
    expect(config.muted).toEqual([builtin]);
    expect(config.mode).toBe("auto");
  });

  it("非法模式回退默认值", () => {
    expect(sanitizeSensitiveConfig({ mode: "always" }).mode).toBe(
      DEFAULT_SENSITIVE_CONFIG.mode,
    );
  });
});

describe("parseSensitiveConfig", () => {
  it("坏 JSON 不抛出，回退默认值", () => {
    expect(parseSensitiveConfig("{not json")).toEqual(DEFAULT_SENSITIVE_CONFIG);
    expect(parseSensitiveConfig(null)).toEqual(DEFAULT_SENSITIVE_CONFIG);
  });
});

describe("buildActiveWords", () => {
  it("内置词 + 用户词合并，被屏蔽的内置词剔除", () => {
    const muted = BUILTIN_SENSITIVE_WORDS[0];
    const words = buildActiveWords({
      words: ["自定义词"],
      muted: [muted],
      mode: "manual",
    });
    expect(words).toContain("自定义词");
    expect(words).toContain(BUILTIN_SENSITIVE_WORDS[1]);
    expect(words).not.toContain(muted);
  });

  it("用户词与内置词重名时只出现一次", () => {
    const builtin = BUILTIN_SENSITIVE_WORDS[0];
    const words = buildActiveWords({
      words: [builtin],
      muted: [],
      mode: "manual",
    });
    expect(words.filter((term) => term === builtin)).toHaveLength(1);
  });
});

describe("buildWordList", () => {
  it("用户词标 user、内置词标 builtin，被屏蔽的不再出现在列表里", () => {
    const muted = BUILTIN_SENSITIVE_WORDS[0];
    const rows = buildWordList({ words: ["我的词"], muted: [muted], mode: "manual" });
    expect(rows.find((row) => row.term === "我的词")?.origin).toBe("user");
    expect(rows.find((row) => row.term === muted)).toBeUndefined();
    expect(rows.every((row) => row.origin === "user" || row.origin === "builtin")).toBe(
      true,
    );
  });
});

describe("parseImportedWords", () => {
  it("解析 JSON 数组", () => {
    expect(parseImportedWords('["色情","赌博"]')).toEqual(["色情", "赌博"]);
  });

  it("解析 { words: [...] } 形态", () => {
    expect(parseImportedWords('{"words":["血腥"]}')).toEqual(["血腥"]);
  });

  it("纯文本：每行一个，跳过注释与空行，支持逗号顿号分隔", () => {
    const text = ["# 注释", "色情", "", "赌博、血腥", "// 也是注释", "肢解"].join("\n");
    expect(parseImportedWords(text)).toEqual(["色情", "赌博", "血腥", "肢解"]);
  });

  it("坏 JSON 当纯文本处理而不是整体失败", () => {
    expect(parseImportedWords("[不是数组\n色情")).toEqual(["[不是数组", "色情"]);
  });

  it("空内容返回空数组", () => {
    expect(parseImportedWords("   ")).toEqual([]);
  });

  it("BOM 不影响解析", () => {
    expect(parseImportedWords("\uFEFF色情\n赌博")).toEqual(["色情", "赌博"]);
  });
});
