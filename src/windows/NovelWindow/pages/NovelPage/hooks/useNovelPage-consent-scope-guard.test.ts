/**
 * L3 授权范围守卫（M5 / review G4）
 *
 * 钉的是**一次「控件点了没效果」的诚实性事故**：弹窗提供「仅本章 / 选中段落 /
 * 最近 3 章」三档，选中的值只写进 `useAiConsent` 的 useState 就断了——
 * 发送端恒发整章、估算恒按整章算。界面承诺的能力和实际行为不一致，
 * 比「没这个选项」更糟。
 *
 * 三条不变量：
 * 1. 范围是**发送内容的入参**，不是埋点字段：`doGenerateSummary` 带 scope，
 *    并走 `buildChapterScopePayload` 取正文；
 * 2. 「选中段落」没选区时**拒绝发送**，不许悄悄退回整章（那是超发）；
 * 3. 弹窗不再隐藏范围选择器，估算随范围实时重算（`summaryPendingScope`）。
 *
 * 为什么源码断言：渲染层编排依赖编辑器实例与 IPC，纯单测代价高；
 * 同先例 `useNovelPage-transform-guard.test.ts` / `useNovelPage-adopt-guard.test.ts`。
 * ⚠️ 断言只钉语义，不钉排版（格式化会把参数拆行，别写成整行 toContain）。
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
const NOVEL_PAGE = readFileSync(
  path.resolve(process.cwd(), "src/windows/NovelWindow/pages/NovelPage/NovelPage.tsx"),
  "utf8",
);
const DIALOG = readFileSync(
  path.resolve(process.cwd(), "src/shared/components/AiConsentDialog/index.tsx"),
  "utf8",
);
const SUMMARY_PROMPT = readFileSync(
  path.resolve(process.cwd(), "src/shared/ai/context/prompt/summary.ts"),
  "utf8",
);

describe("L3 授权范围真正约束发送内容（守卫）", () => {
  it("摘要按范围取正文：走 buildChapterScopePayload，而不是直接发整章", () => {
    expect(USE_NOVEL_PAGE).toContain("buildChapterScopePayload(");
    // 送进 prompt 的必须是「按范围裁过的那段」
    expect(USE_NOVEL_PAGE).toMatch(/chapter:\s*payload\.chapterText/);
    // 旧实现（恒发整章 + 恒按整章估算）不许回来
    expect(USE_NOVEL_PAGE).not.toMatch(/chapter:\s*clipChapterForPrompt\(\s*chapter\.content/);
  });

  it("「选中段落」没选区时拒绝发送，绝不退回整章", () => {
    // 拒绝分支必须排在「拼 prompt」之前：命中 no-selection 就直接返回，不进发送链路
    const guardAt = USE_NOVEL_PAGE.indexOf("if (!payload.ok)");
    const specAt = USE_NOVEL_PAGE.indexOf('buildPromptSpec("summary"');
    expect(guardAt).toBeGreaterThan(-1);
    expect(specAt).toBeGreaterThan(guardAt);
    // 拒绝要说话，不能静默失败
    expect(USE_NOVEL_PAGE).toContain("当前范围是「选中段落」");
    expect(USE_NOVEL_PAGE).toMatch(/reason === "no-selection"/);
  });

  it("范围随请求下发，落 ai_event.scope（不只是渲染层内存态）", () => {
    const start = USE_NOVEL_PAGE.indexOf('intent: "summary"');
    expect(start).toBeGreaterThan(-1);
    // intent 之后不远处必须出现 scope（注释可能夹在中间，给 300 字余量）
    expect(USE_NOVEL_PAGE.slice(start, start + 300)).toMatch(/scope,/);
  });

  it("弹窗不再隐藏范围选择器，且估算与「可发送内容」联动", () => {
    expect(DIALOG).not.toContain("hideScope");
    expect(DIALOG).toContain("confirmDisabled");
    // 估算来自 hook 的派生值（随范围重算），不是 pending 一次算死的数字
    expect(NOVEL_PAGE).toMatch(/estimate=\{summaryPendingScope\}/);
    expect(NOVEL_PAGE).toContain("confirmDisabled={summaryPendingScope.chars === 0}");
  });

  it("范围进 prompt：选中段落 / 最近 3 章各有对应段落与约束", () => {
    // prompt 模板必须感知范围，否则拿到片段的模型会照常写「本章」
    expect(SUMMARY_PROMPT).toContain("intent.scope");
    expect(SUMMARY_PROMPT).toContain("【选中段落】");
    expect(SUMMARY_PROMPT).toContain("【前情");
  });
});
