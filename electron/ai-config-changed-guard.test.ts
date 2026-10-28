/**
 * REQ-063 守卫：`ai-config-save` 成功后必须广播 `ai-config-changed`。
 *
 * 这条广播不是「顺手加的埋点」，而是「开关即时生效」的唯一通路：
 * AI 入口散布在作品窗口（六个）与设置窗口（导航两页）里，这些窗口在用户改开关
 * 时早就开着了。只在挂载时读一次配置的话，用户看到的是「开关点了没反应，
 * 得重开窗口才好」。
 *
 * 另钉住「不排除发送窗口」这个刻意的选择：设置窗口自己也是消费者 —— 它要靠
 * 重读来收掉「AI 记录 / 用量与效果」。若照搬 `global-setting-changed` 的
 * 防回声手法（排除 sender），发送方就永远停在旧状态，正是本次要修的 bug。
 * 回声无害的依据：监听方只做「重读配置」（幂等，不写库、不改草稿）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const AI_HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/ai-handlers.ts"),
  "utf8",
);
const HOOK = readFileSync(
  resolve(process.cwd(), "src/shared/ai/hooks/useAiAvailability.ts"),
  "utf8",
);

describe("AI 配置保存后广播（REQ-063）", () => {
  it("主进程保存成功后广播 ai-config-changed", () => {
    expect(AI_HANDLERS).toContain('windowManager.broadcast("ai-config-changed"');
    // 必须挂在保存成功的分支上：保存失败还广播，会让各窗口去重读一份没变的配置，
    // 更糟的是把「保存失败」表现成「已生效」
    const saveStart = AI_HANDLERS.indexOf('"ai-config-save"');
    const saveEnd = AI_HANDLERS.indexOf('"ai-config-test"');
    expect(saveStart).toBeGreaterThan(-1);
    expect(saveEnd).toBeGreaterThan(saveStart);
    expect(AI_HANDLERS.slice(saveStart, saveEnd)).toContain("notifyConfigChanged(");
  });

  it("反向断言：不排除发送窗口（设置窗口自己也要刷新）", () => {
    const at = AI_HANDLERS.indexOf('windowManager.broadcast("ai-config-changed"');
    const call = AI_HANDLERS.slice(at, AI_HANDLERS.indexOf(");", at));
    // 第三个参数是 exclude：这里必须没有，否则「在本窗口关掉 AI」后导航不更新
    expect(call).not.toContain("exclude");
  });

  it("渲染层订阅：useAiAvailability 收到就重读，并在卸载时退订", () => {
    expect(HOOK).toContain('api.on("ai-config-changed"');
    expect(HOOK).toContain('api.off("ai-config-changed"');
    // 通道缺失（lite / 测试环境）时静默降级，不许抛错
    expect(HOOK).toMatch(/const api = window\.electronAPI\?\.windowAPI;\s*\n\s*if \(!api\) return;/);
  });

  it("两侧都写明「为什么不排除发送窗口」：这是刻意选择，不是漏了防回声", () => {
    // 只说「不排除」而不说为什么，下一个人会当成 bug 顺手补上 exclude，
    // 于是「在设置窗口关掉 AI 后导航不更新」原地复活 —— 把论证钉在源码里
    expect(AI_HANDLERS).toContain("为什么不排除发送窗口");
    expect(HOOK).toContain("自己刚触发的那条");
    expect(HOOK).toContain("过滤掉发送方");
  });
});
