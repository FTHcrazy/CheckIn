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
 *
 * ⚠️ 2.10.1：润色与五种变换合并为同一条编排（`runRewrite`），断言跟着放宽为
 * 「按语义成立」而不是「按某一行字面量成立」—— 变量名与三元写法可以变，
 * 「子类型必须拼进去 / 模板必须走 registry / 润色不许混成 transform」不许变。
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
    // 变换 intent 必须带子类型（TRANSFORM_INTENT_SUB[...]），否则五种变换无法区分
    expect(USE_NOVEL_PAGE).toMatch(/`transform:\$\{TRANSFORM_INTENT_SUB\[\w+\]\}`/);
    // 不允许出现把变换笼统记成 `intent: "transform"` 的硬编码
    expect(USE_NOVEL_PAGE).not.toMatch(/intent:\s*"transform"/);
  });

  it("五种变换走统一模板 buildPromptSpec('transform')，不手拼 system", () => {
    expect(USE_NOVEL_PAGE).toContain('buildPromptSpec("transform"');
    // 上下文采集仍按 transform 意图做（快照可被就地补充章节片段，故允许带前缀）
    expect(USE_NOVEL_PAGE).toMatch(/collectBookContext\([\s\S]{0,160}"transform"/);
  });

  it("润色仍走 polish 模板与 intent，不与变换混用", () => {
    expect(USE_NOVEL_PAGE).toContain('buildPromptSpec("polish"');
    // 润色与变换共用一条编排，但 intent 必须仍标成 polish（不是 transform:*）
    expect(USE_NOVEL_PAGE).toMatch(/intent:[\s\S]{0,60}"polish"/);
  });
});

describe("就地续写（B5 流式守卫）", () => {
  it("续写走流式模板 assembleContinuationStreamSpec 与 intent，不手拼", () => {
    expect(USE_NOVEL_PAGE).toContain("assembleContinuationStreamSpec");
    expect(USE_NOVEL_PAGE).toContain('intent: "continuation"');
    expect(USE_NOVEL_PAGE).toContain('collectBookContext(bookSnapshot, "continuation")');
    // B3 非流式路径已移除：useNovelPage 不得再走 buildPromptSpec("continuation")
    expect(USE_NOVEL_PAGE).not.toContain('buildPromptSpec("continuation"');
  });

  it("续写走流式传输 aiGenerateStream（SSE 打字机），非结构化候选", () => {
    expect(USE_NOVEL_PAGE).toContain("aiGenerateStream");
    // 续写不再用结构化候选（B3 的 aiGenerateStructured + CONTINUATION_OUTPUT_FORMAT）
    expect(USE_NOVEL_PAGE).not.toContain("aiGenerateStructured");
    expect(USE_NOVEL_PAGE).not.toContain("CONTINUATION_OUTPUT_FORMAT");
  });

  it("续写取光标前文（getTextBeforeCursor），不依赖选区", () => {
    expect(USE_NOVEL_PAGE).toContain("getTextBeforeCursor");
  });

  it("确认候选写入正文，且不被后续选区覆盖（可 Ctrl+Z 撤销）", () => {
    // 2.10.1：改用「快照光标 → 快照光标」的 replaceRange 插入。
    // 走 insertText 会在「流式期间作者选中了别处」时命中 replaceSelection，
    // 把那段选区覆盖掉；replaceRange 带 userEvent: input.replace，同样进 undo 栈。
    expect(USE_NOVEL_PAGE).toMatch(
      /replaceRange\(continuation\.cursor, continuation\.cursor, text\)/,
    );
    expect(USE_NOVEL_PAGE).not.toContain("insertText(text)");
  });
});
