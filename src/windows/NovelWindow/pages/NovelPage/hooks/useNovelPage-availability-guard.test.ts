/**
 * AI 可用性门控接线守卫（M8 落地，G2 修复）
 *
 * 钉住「入口可消失」这条不变量：`useAiAvailability` 不再只是「有实现、有单测、
 * 无消费方」的空转，而是真正接进了页面层，并据此控制六个 AI 入口的
 * 「禁用 + 说明原因」或「本地兜底」。review G2 的痛点就是门控 hook 零消费者。
 *
 * 为什么用源码断言：useNovelPage 依赖 CodeMirror 编辑器实例，纯单元测代价高；
 * 把「页面层挂载了 hook、入口组件接收了 availability 状态」钉在源码上最省。
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
const TOP_BAR = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/NovelWindow/pages/NovelPage/components/NovelTopBar/index.tsx",
  ),
  "utf8",
);
const CONTINUE_FAB = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/NovelWindow/pages/NovelPage/components/ContinueFab/index.tsx",
  ),
  "utf8",
);
const CTX_MENU = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/NovelWindow/pages/NovelPage/components/EntityContextMenu/index.tsx",
  ),
  "utf8",
);
const NAME_PANEL = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/NovelWindow/pages/NovelPage/components/NameGeneratorPanel/index.tsx",
  ),
  "utf8",
);

describe("AI 可用性门控接线（G2 守卫）", () => {
  it("页面层挂载 useAiAvailability（门控不再零消费方）", () => {
    expect(USE_NOVEL_PAGE).toContain('useAiAvailability()');
    expect(USE_NOVEL_PAGE).toContain('from "@/shared/ai/hooks/useAiAvailability"');
  });

  it("页面层把 aiAvailability 暴露给编排层（NovelPage 消费）", () => {
    expect(USE_NOVEL_PAGE).toContain("aiAvailability,");
    expect(NOVEL_PAGE).toContain("aiAvailability");
  });

  it("续写入口（正文右下角悬浮按钮，REQ-061）接收 aiAvailable 并据其禁用", () => {
    // 入口从顶栏搬到悬浮按钮，但「不可用即禁用 + 说明原因」的判据不变
    expect(CONTINUE_FAB).toContain("aiAvailable");
    expect(CONTINUE_FAB).toMatch(/disabled=\{!aiAvailable\}/);
    expect(CONTINUE_FAB).toContain("aiUnavailableText");
    // 顶栏不再放这颗闪电（否则等于两个入口、两份门控）
    expect(TOP_BAR).not.toContain("onContinue");
    expect(TOP_BAR).not.toContain("ThunderboltOutlined");
    // 页面层真的把它挂上了，而且走的是「先确认再发起」的入口
    expect(NOVEL_PAGE).toContain("<ContinueFab");
    expect(NOVEL_PAGE).toContain("requestContinuation");
    // 阅读模式 / 无章节时不挂载：这两种情况下没有「光标前的前文」，
    // 留一颗点了只会提示「先到正文里点一下」的按钮是噪音。
    // （REQ-063 又加了一层「AI 关掉就整颗不渲染」，判据是 hidden —— 见
    // `ai-hidden-guard.test.ts`；这里只钉「三个不出现的情形并列在同一个条件里」）
    expect(NOVEL_PAGE).toMatch(/!aiAvailability\.hidden\s*&&\s*!editor\.settings\.readMode/);
    expect(NOVEL_PAGE).toMatch(/!editor\.settings\.readMode\s*&&\s*data\.activeChapter/);
  });

  it("润色 / 变换入口（右键菜单）接收 aiAvailable 并据其禁用", () => {
    expect(CTX_MENU).toContain("aiAvailable");
    expect(CTX_MENU).toMatch(/disabled=\{!aiAvailable\}/);
  });

  it("起名入口保留本地兜底：AI 按钮禁用，但面板不整块隐藏", () => {
    expect(NAME_PANEL).toContain("aiAvailable");
    expect(NAME_PANEL).toMatch(/disabled=\{aiLoading \|\| !aiAvailable\}/);
    // 本地引擎入口（换一批）不随 AI 可用性消失
    expect(NAME_PANEL).toContain("换一批（本地）");
  });

  it("摘要入口在 AI 不可用时给出明确说明（不弹空面板）", () => {
    expect(USE_NOVEL_PAGE).toContain("aiAvailability.available");
    expect(USE_NOVEL_PAGE).toContain("aiAvailability.reasonText");
  });
});
