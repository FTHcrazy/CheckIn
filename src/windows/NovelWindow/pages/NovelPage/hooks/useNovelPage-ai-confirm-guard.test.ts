/**
 * AI 生成的「二次确认」守卫（REQ-060）
 *
 * 事故：续写点一下就直接发请求；摘要则「只提示一次」——首次授权后被永久置为
 * `l3_enabled = 1`，此后每章点图标都直接生成、直接落库。作者以为只是「看看」，
 * 实际已经在扣额度、也在把整章正文发出去。
 *
 * 判据（两条都要在）：
 * 1. 续写入口先弹确认框，确认后才调 `runContinuation`；
 * 2. 摘要生成前也确认（已授权也要），首次仍走 L3 授权弹窗。
 *
 * 为什么用源码断言：两条链路都依赖 CodeMirror 编辑器实例与主进程 AI 通道，
 * 纯单元测成本远高于收益（与 `useNovelPage-availability-guard` 同一取舍）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts",
  ),
  "utf8",
);

/** 截取一个 `const xxx = useCallback(` 到 `endMarker` 之间的函数体 */
const bodyOf = (name: string, endMarker: string): string => {
  const start = HOOK.indexOf(`const ${name} = useCallback(`);
  expect(start, `找不到 ${name}`).toBeGreaterThan(-1);
  const end = HOOK.indexOf(endMarker, start);
  return HOOK.slice(start, end > start ? end : start + 4000);
};

describe("续写 / 摘要的二次确认（REQ-060）", () => {
  const requestContinuation = bodyOf(
    "requestContinuation",
    "const handleContinuationConfirm",
  );
  const runChapterSummary = bodyOf(
    "runChapterSummary",
    "const handleSummaryConsentConfirm",
  );

  it("续写入口先确认再发起（确认框说明发送字数与模型服务）", () => {
    expect(requestContinuation).toContain("modal.confirm");
    expect(requestContinuation).toContain("开始续写");
    // 确认框里要写清「发多少字出去」，只写「确定吗」等于没告知
    expect(requestContinuation).toMatch(/约.*字/);
    // 真正的请求在 onOk 里
    expect(requestContinuation).toMatch(/onOk:[\s\S]*runContinuation\(\)/);
  });

  it("续写的「重新生成 / 重试」不再重复确认（作者刚刚确认过）", () => {
    const retry = bodyOf("handleContinuationRetry", "const requestContinuation");
    expect(retry).toContain("runContinuation()");
    expect(retry).not.toContain("modal.confirm");
  });

  it("摘要每次生成前都确认，而不是「只第一次提示」", () => {
    expect(runChapterSummary).toContain("modal.confirm");
    expect(runChapterSummary).toContain("开始生成");
    // 生成动作必须挂在 onOk 上（而不是直接 `void doGenerateSummary(...)`，
    // 那是旧行为）；请求本体收在 `start`，确认框只负责放行
    expect(runChapterSummary).toMatch(/const start = \(\): void => \{[\s\S]*doGenerateSummary\(/);
    expect(runChapterSummary).toMatch(/onOk: start/);
    // 取消要把加载态退回来，否则面板永远转圈
    expect(runChapterSummary).toMatch(/onCancel:[\s\S]*loading: false/);
  });

  it("浮层里的「重新生成」不再重复确认（点这个按钮本身就是这一次同意）", () => {
    // 与续写「浮层里的重试不重复确认」同一口径：force 分支必须在
    // modal.confirm **之前** return，否则会叠成两层确认
    const forceIndex = runChapterSummary.indexOf("if (force)");
    const confirmIndex = runChapterSummary.indexOf("modal.confirm");
    expect(forceIndex).toBeGreaterThan(-1);
    expect(forceIndex).toBeLessThan(confirmIndex);
    expect(runChapterSummary).toMatch(/if \(force\) \{[\s\S]*?return;\s*\}/);
  });

  it("首次（未授权）仍走 L3 授权弹窗，不拿普通确认替代合规告知", () => {
    const consentIndex = runChapterSummary.indexOf("!aiConsent.l3Enabled");
    const confirmIndex = runChapterSummary.indexOf("modal.confirm");
    expect(consentIndex).toBeGreaterThan(-1);
    expect(runChapterSummary).toContain("setSummaryPending");
    // 授权分支在前，确认框在后：先合规、再逐次确认
    expect(confirmIndex).toBeGreaterThan(consentIndex);
  });

  it("确认框用上下文内的实例（App.useApp），不用静态 Modal.confirm", () => {
    // 静态 Modal.confirm 会新建独立 React root，脱离主题（暗色掉成白底）
    expect(HOOK).toContain("App.useApp()");
    expect(HOOK).not.toMatch(/Modal\.confirm\s*\(/);
  });
});
