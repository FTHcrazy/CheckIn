import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 大纲回流接线守卫（R-AI-09 补口）。
 *
 * 摘要与大纲的 `outline_note` 是同一个信息位，分成两次会让作者重复劳动。
 * 这里钉住三件事，避免后续重构把它悄悄退化成「只落摘要、大纲永远空白」：
 *   1. 生成成功后必须走 `parseSummaryReply` 拆分，落库的是长摘要而不是带标记的原文；
 *   2. **已有手写梗概时不得当场写入**（覆盖作者的字要用户点头）；
 *   3. 覆盖动作必须经 `handleApplySummaryNote`，且浮层真把它接上了。
 *
 * 断言刻意写成宽松正则：格式化会拆行、会重排属性，钉死一整行只会制造假红。
 */
const repoRoot = process.cwd();
const read = (rel: string): string =>
  readFileSync(path.resolve(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

const hookSrc = read("src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts");
const pageSrc = read("src/windows/NovelWindow/pages/NovelPage/NovelPage.tsx");
const previewSrc = read(
  "src/windows/NovelWindow/pages/NovelPage/components/SummaryPreview/index.tsx",
);
const promptSrc = read("src/shared/ai/context/prompt/summary.ts");

describe("useNovelPage · 摘要 → 大纲回流", () => {
  it("生成成功后拆分回复，落库用长摘要（不带【摘要】标记）", () => {
    expect(hookSrc).toMatch(/parseSummaryReply\(/);
    // 落库的第一个内容参数必须是拆出来的 summary，不能是原始 text
    expect(hookSrc).toMatch(/updateChapterSummary\(\s*chapterId,\s*bodyText/);
  });

  it("无手写梗概才自动写入；已有手写只置冲突、不当场覆盖", () => {
    // 自动写入发生在「无 existingNote」的分支里
    expect(hookSrc).toMatch(
      /if\s*\(\s*!existingNote[\s\S]{0,80}updateChapterOutlineNote\(/,
    );
    // 冲突分支只赋值，不写库
    expect(hookSrc).toMatch(/noteConflict\s*=\s*existingNote/);
  });

  it("模型没给一句话时不动大纲（oneLiner 为空即跳过整段）", () => {
    expect(hookSrc).toMatch(/if\s*\(\s*reply\.oneLiner\s*\)/);
  });

  it("覆盖动作走 handleApplySummaryNote，且落到本篇大纲梗概", () => {
    expect(hookSrc).toMatch(/const handleApplySummaryNote/);
    expect(hookSrc).toMatch(
      /handleApplySummaryNote[\s\S]{0,400}updateChapterOutlineNote\(\s*summary\.chapterId,\s*summary\.oneLiner/,
    );
    // 必须导出给页面层用
    expect(hookSrc).toMatch(/^\s*handleApplySummaryNote,$/m);
  });

  it("页面把一句话 / 冲突 / 覆盖回调接到浮层上", () => {
    expect(pageSrc).toMatch(/oneLiner=\{summary\.oneLiner\}/);
    expect(pageSrc).toMatch(/noteConflict=\{summary\.noteConflict\}/);
    expect(pageSrc).toMatch(/onApplyNote=\{handleApplySummaryNote\}/);
  });

  it("浮层展示一句话与「已填入 / 覆盖」两种状态", () => {
    expect(previewSrc).toMatch(/一句话梗概/);
    expect(previewSrc).toMatch(/覆盖为这句/);
    expect(previewSrc).toMatch(/已填入大纲/);
  });

  it("prompt 要求两段式输出（改回单段 = 回流静默失效）", () => {
    expect(promptSrc).toMatch(/【一句话】/);
    expect(promptSrc).toMatch(/【摘要】/);
  });

  it("已有摘要点开是「查看」而非重新生成（重生成只走浮层按钮）", () => {
    // 章节行图标文案是「查看 AI 摘要」，点一下就再调一次模型 = 偷偷扣费
    expect(hookSrc).toMatch(/if\s*\(\s*!force\s*&&\s*chapter\?\.aiSummary\s*\)/);
    expect(pageSrc).toMatch(
      /onRegenerate=\{\(\)\s*=>\s*runChapterSummary\(\s*summary\.chapterId,\s*true\s*\)\}/,
    );
  });
});
