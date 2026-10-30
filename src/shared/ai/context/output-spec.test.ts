import { describe, expect, it } from "vitest";
import {
  NAMING_OUTPUT_FORMAT,
  TEXT_OUTPUT_FORMAT,
  alignParagraphBreaks,
  buildOutputInstruction,
  extractJsonArray,
  normalizeContinuationText,
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

  // 真实事故（2026-10-27 ai_log#9）：模型在第 5 条把 `}` 写成 `]`，整串非法，
  // 旧逻辑退回行切 → 单行坏数组把 `[{"name"` 当成了第一个名字。
  it("数组中间分隔符写错（} 写成 ]）→ 逐条抢救出全部条目，且不弹兜底提示", () => {
    const raw =
      '[{"name":"江长青","meaning":"寓意寿命长青，道心坚固。"},' +
      '{"name":"叶万古","meaning":"气吞万古，格局宏大。"},' +
      '{"name":"慕不朽","meaning":"追求不朽大道。"},' +
      '{"name":"顾长生","meaning":"求得一世长存。"},' +
      '{"name":"凌千劫","meaning":"凌驾于千般劫难之上。"],' +
      '{"name":"沈延寿","meaning":"寿元无尽。"},' +
      '{"name":"陆青松","meaning":"生命力顽强。"}]';
    const parsed = parseOutput(raw, NAMING_OUTPUT_FORMAT);
    expect(parsed.usedFallback).toBe(false);
    expect(parsed.entries).toHaveLength(7);
    expect(parsed.entries[0]).toEqual({
      name: "江长青",
      meaning: "寓意寿命长青，道心坚固。",
    });
    expect(parsed.entries.map((e) => e.name)).toEqual([
      "江长青",
      "叶万古",
      "慕不朽",
      "顾长生",
      "凌千劫",
      "沈延寿",
      "陆青松",
    ]);
  });

  it("输出被 max_tokens 截断（缺尾部 ]）→ 已完整的条目照常可用", () => {
    const raw =
      '[{"name":"江长青","meaning":"寿命长青。"},{"name":"叶万古","meaning":"气吞万古。"},{"name":"慕不朽","mean';
    const parsed = parseOutput(raw, NAMING_OUTPUT_FORMAT);
    expect(parsed.usedFallback).toBe(false);
    expect(parsed.entries.map((e) => e.name)).toEqual(["江长青", "叶万古"]);
  });

  it("单条对象键名漏引号 → 按字段正则救回，不牵连其余", () => {
    const raw =
      '[{"name":"江长青","meaning":"寿命长青。"},{"name":"坏条目",meaning:"缺引号"},' +
      '{"name":"叶万古","meaning":"气吞万古。"}]';
    const parsed = parseOutput(raw, NAMING_OUTPUT_FORMAT);
    expect(parsed.usedFallback).toBe(false);
    expect(parsed.entries).toEqual([
      { name: "江长青", meaning: "寿命长青。" },
      { name: "坏条目", meaning: "缺引号" },
      { name: "叶万古", meaning: "气吞万古。" },
    ]);
  });

  it("主字段是 JSON 残片（`[{\"name\"`）→ 整条丢弃，绝不进结果卡", () => {
    const raw = JSON.stringify([
      { name: '[{"name"', meaning: "半截数组" },
      { name: "江长青", meaning: "寿命长青。" },
    ]);
    const parsed = parseOutput(raw, NAMING_OUTPUT_FORMAT);
    expect(parsed.entries).toEqual([{ name: "江长青", meaning: "寿命长青。" }]);
  });

  it("坏到无法抢救（字段残缺）→ 判定本次无产出，绝不把 JSON 残片当名字", () => {
    const raw = '[{"name":"江长青"';
    const parsed = parseOutput(raw, NAMING_OUTPUT_FORMAT);
    expect(parsed.entries).toEqual([]);
    expect(parsed.usedFallback).toBe(true);
  });

  it("坏返回里的 JSON 残片永远不进结果（回归：`[{\"name\"` 曾被当成名字）", () => {
    const raw = '[{"name":"江长青","meaning":"寿命长青。"},{"缺东西"}]';
    const parsed = parseOutput(raw, NAMING_OUTPUT_FORMAT);
    expect(parsed.entries).toEqual([{ name: "江长青", meaning: "寿命长青。" }]);
    for (const entry of parsed.entries) {
      expect(entry.name).not.toContain("[");
      expect(entry.name).not.toContain("{");
      expect(entry.name).not.toContain('"');
    }
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

describe("normalizeContinuationText", () => {
  const original = "第一段。\n第二段。";

  it("剥掉模型自己加的全角/半角缩进（首行缩进由编辑器 CSS 负责）", () => {
    const raw = "　　他推门而入。\n  风从窗缝里灌进来。";
    expect(normalizeContinuationText(raw, original)).toBe(
      "他推门而入。\n风从窗缝里灌进来。",
    );
  });

  it("空行口径跟前文一致：前文单换行分段 → 输出也折叠成单换行", () => {
    const raw = "　　他推门而入。\n\n　　风从窗缝里灌进来。";
    expect(normalizeContinuationText(raw, original)).toBe(
      "他推门而入。\n风从窗缝里灌进来。",
    );
  });

  it("前文本来就空行分段 → 保留空行（那是作者自己的写法）", () => {
    const raw = "他推门而入。\n\n风从窗缝里灌进来。";
    expect(normalizeContinuationText(raw, "第一段。\n\n第二段。")).toBe(raw);
  });

  it("只有全角空格的「空行」也算空行，不会留一段空白正文", () => {
    const raw = "他推门而入。\n　　\n风从窗缝里灌进来。";
    expect(normalizeContinuationText(raw, original)).toBe(
      "他推门而入。\n风从窗缝里灌进来。",
    );
  });

  it("只动空白，不动文字：标点与句子原样保留", () => {
    const raw = "　　「你来了。」他说，\n　　把伞靠在门边。";
    expect(normalizeContinuationText(raw, original)).toBe(
      "「你来了。」他说，\n把伞靠在门边。",
    );
  });
});
