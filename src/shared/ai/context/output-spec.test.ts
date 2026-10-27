import { describe, expect, it } from "vitest";
import {
  NAMING_OUTPUT_FORMAT,
  TEXT_OUTPUT_FORMAT,
  alignParagraphBreaks,
  buildOutputInstruction,
  extractJsonArray,
  parseOutput,
  stripCodeFence,
} from "./output-spec";

describe("buildOutputInstruction", () => {
  it("json-array：写死字段、示例与反例", () => {
    const text = buildOutputInstruction(NAMING_OUTPUT_FORMAT);
    expect(text).toContain("JSON 数组");
    expect(text).toContain('"name"');
    expect(text).toContain('"meaning"');
    expect(text).toContain("严禁");
  });

  it("text：只要求直接输出、不要代码块", () => {
    const text = buildOutputInstruction(TEXT_OUTPUT_FORMAT);
    expect(text).toContain("直接输出");
    expect(text).not.toContain("JSON");
  });
});

describe("stripCodeFence / extractJsonArray", () => {
  it("剥掉 ```json 包裹", () => {
    expect(stripCodeFence('```json\n[{"a":1}]\n```')).toBe('[{"a":1}]');
  });

  it("数组夹在前后缀之间也能抠出来", () => {
    const raw = '好的，结果如下：\n[{"name":"凌霜","meaning":"清冷"}]\n希望对你有帮助';
    expect(extractJsonArray(raw)).toEqual([{ name: "凌霜", meaning: "清冷" }]);
  });

  it("不是数组 / 非法 JSON 返回 null", () => {
    expect(extractJsonArray('{"name":"凌霜"}')).toBeNull();
    expect(extractJsonArray("[1,2")).toBeNull();
  });
});

describe("parseOutput", () => {
  it("text 格式不产出 entries", () => {
    const parsed = parseOutput("润色后的文字", TEXT_OUTPUT_FORMAT);
    expect(parsed.entries).toEqual([]);
    expect(parsed.usedFallback).toBe(false);
  });

  it("标准 JSON：按字段归一 + 首字段去重 + 按 limit 截断", () => {
    const raw = JSON.stringify([
      { name: "凌霜", meaning: "清冷孤傲" },
      { name: "凌霜", meaning: "重复项被丢弃" },
      { name: "苏白衣", meaning: "温润" },
    ]);
    const parsed = parseOutput(raw, NAMING_OUTPUT_FORMAT, { limit: 1 });
    expect(parsed.usedFallback).toBe(false);
    expect(parsed.entries).toEqual([{ name: "凌霜", meaning: "清冷孤傲" }]);
  });

  it("字段缺失 / 空值的条目被丢弃，不污染整批", () => {
    const raw = JSON.stringify([
      { name: "凌霜", meaning: "清冷" },
      { name: "", meaning: "空名" },
      { name: "无寓意" },
    ]);
    const parsed = parseOutput(raw, NAMING_OUTPUT_FORMAT);
    expect(parsed.entries).toEqual([{ name: "凌霜", meaning: "清冷" }]);
    expect(parsed.usedFallback).toBe(false);
  });

  it("模型不遵 JSON → 启发式兜底，仍能拆出名字与寓意", () => {
    const raw = "以下是十个名字：\n1. 凌霜——清冷孤傲的剑修\n2. 苏白衣：温润如玉\n";
    const parsed = parseOutput(raw, NAMING_OUTPUT_FORMAT);
    expect(parsed.usedFallback).toBe(true);
    expect(parsed.entries).toEqual([
      { name: "凌霜", meaning: "清冷孤傲的剑修" },
      { name: "苏白衣", meaning: "温润如玉" },
    ]);
  });
});

describe("alignParagraphBreaks", () => {
  const original = "第一段。\n第二段。\n第三段。";

  it("原文单换行分段 → 折叠模型加的空行（整段回填后不用手删）", () => {
    const polished = "第一段改。\n\n第二段改。\n\n\n第三段改。";
    expect(alignParagraphBreaks(polished, original)).toBe(
      "第一段改。\n第二段改。\n第三段改。",
    );
  });

  it("原文本来就空行分段 → 保留模型的分段（那是作者自己的写法）", () => {
    const spaced = "第一段。\n\n第二段。";
    expect(alignParagraphBreaks("第一段改。\n\n第二段改。", spaced)).toBe(
      "第一段改。\n\n第二段改。",
    );
  });

  it("行尾空格与 CRLF 一并归一，只动换行不动文字", () => {
    const polished = "第一段改。  \r\n\r\n第二段改。";
    expect(alignParagraphBreaks(polished, original)).toBe("第一段改。\n第二段改。");
  });

  it("空串 → 空串（调用方据此判定「这次没产出」）", () => {
    expect(alignParagraphBreaks("   \n\n  ", original)).toBe("");
  });
});
