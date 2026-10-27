/**
 * B2 文本变换（R-AI-06）守卫
 *
 * 钉的是 B2 批次最容易回退的两处：
 * 1. `ai_log.intent` 用笼统的 `"transform"` 而不是 `transform:expand` 等子类型
 *    —— 那会让「扩写 / 精简 / 改写 / 换语气 / 转视角」五种变换的度量归零、无法归因；
 * 2. 五种变换没走统一的 `buildPromptSpec("transform")` 模板，而是手拼 system prompt
 *    —— 违反 AGENTS §6「每个功能都必须在 PROMPT_BUILDERS 登记」。
 *
 * 为什么用源码断言：渲染层编排（useNovelPage）依赖编辑器实例，纯单元测代价高，
 * 把「intent 子类型契约」这条不变量钉在源码上最省。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const USE_NOVEL_PAGE = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts",
  ),
  "utf8",
);

describe("文本变换 intent 子类型（B2 守卫）", () => {
  it("intent 用 transform:${sub} 动态拼接，不写死单一 transform 字面量", () => {
    // 变换 intent 必须带子类型（TRANSFORM_INTENT_SUB[kind]），否则五种变换无法区分
    expect(USE_NOVEL_PAGE).toMatch(/intent:\s*`transform:\$\{TRANSFORM_INTENT_SUB\[kind\]\}`/);
    // 不允许出现把变换笼统记成 `intent: "transform"` 的硬编码
    expect(USE_NOVEL_PAGE).not.toMatch(/intent:\s*"transform"/);
  });

  it("五种变换走统一模板 buildPromptSpec('transform')，不手拼 system", () => {
    expect(USE_NOVEL_PAGE).toContain('buildPromptSpec("transform"');
    expect(USE_NOVEL_PAGE).toContain('collectBookContext(bookSnapshot, "transform")');
  });

  it("润色仍走 polish 模板与 intent，不与变换混用", () => {
    expect(USE_NOVEL_PAGE).toContain('buildPromptSpec("polish"');
    expect(USE_NOVEL_PAGE).toContain('intent: "polish"');
  });
});

describe("就地续写（B3 守卫）", () => {
  it("续写走统一模板 buildPromptSpec('continuation') 与 intent，不手拼", () => {
    expect(USE_NOVEL_PAGE).toContain('buildPromptSpec("continuation"');
    expect(USE_NOVEL_PAGE).toContain('intent: "continuation"');
  });

  it("续写候选用 json-array 输出契约解析（aiGenerateStructured + CONTINUATION_OUTPUT_FORMAT）", () => {
    expect(USE_NOVEL_PAGE).toContain("aiGenerateStructured");
    expect(USE_NOVEL_PAGE).toContain("CONTINUATION_OUTPUT_FORMAT");
    expect(USE_NOVEL_PAGE).toContain("outputFormat: CONTINUATION_OUTPUT_FORMAT");
  });

  it("续写取光标前文（getTextBeforeCursor），不依赖选区", () => {
    expect(USE_NOVEL_PAGE).toContain("getTextBeforeCursor");
  });

  it("确认候选走 insertText（可 Ctrl+Z 撤销），失败不写原文", () => {
    expect(USE_NOVEL_PAGE).toContain("insertText(text)");
  });
});
