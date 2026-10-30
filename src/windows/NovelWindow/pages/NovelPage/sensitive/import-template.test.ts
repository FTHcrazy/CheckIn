import { describe, expect, it } from "vitest";
import { parseImportedWords } from "./words";
import {
  IMPORT_RULES,
  IMPORT_TEMPLATE_JSON_ARRAY,
  IMPORT_TEMPLATE_JSON_OBJECT,
  IMPORT_TEMPLATE_TEXT,
} from "./import-template";

/**
 * 模板与解析器的一致性守卫（1.47.0）
 *
 * 模板是给用户抄的**承诺**：里面出现的每种写法都必须真能导入。这条测试把
 * 「模板文本」直接喂给 `parseImportedWords`，一旦哪天解析器收窄了分隔符或
 * 注释规则，模板会立刻红灯 —— 否则用户照着模板写反而导不进来。
 */
describe("导入模板与解析器一致", () => {
  it("纯文本模板解析出预期的全部词条（含顿号 / 竖线同行写法）", () => {
    expect(parseImportedWords(IMPORT_TEMPLATE_TEXT)).toEqual([
      "色情",
      "赌博",
      "毒品",
      "血腥",
      "暴力",
      "恐怖",
      "诈骗",
      "洗钱",
    ]);
  });

  it("模板里的 # 注释行不会被当成词条", () => {
    const terms = parseImportedWords(IMPORT_TEMPLATE_TEXT);
    expect(terms.some((term) => term.startsWith("#"))).toBe(false);
    expect(terms.some((term) => term.includes("注释"))).toBe(false);
  });

  it("JSON 数组 / JSON 对象两种写法都能解析", () => {
    expect(parseImportedWords(IMPORT_TEMPLATE_JSON_ARRAY)).toEqual([
      "色情",
      "赌博",
      "毒品",
    ]);
    expect(parseImportedWords(IMPORT_TEMPLATE_JSON_OBJECT)).toEqual([
      "色情",
      "赌博",
      "毒品",
    ]);
  });

  it("模板里的词条都不超过 40 字上限（抄进去不会被整条丢弃）", () => {
    for (const term of parseImportedWords(IMPORT_TEMPLATE_TEXT)) {
      expect(term.length).toBeLessThanOrEqual(40);
    }
  });

  it("规则清单覆盖三种格式与注释约定（避免文案与实现漂移）", () => {
    expect(IMPORT_RULES.length).toBeGreaterThanOrEqual(5);
    const rules = IMPORT_RULES.join("\n");
    expect(rules).toContain("UTF-8");
    expect(rules).toContain("每行一个词");
    expect(rules).toContain("注释");
    expect(rules).toContain("40");
  });
});
