/**
 * REQ-064 守卫：看板「平均耗时」必须按**终态事件**聚合。
 *
 * 真实缺陷：`ai-event-stats` 原先把 `COUNT(*)` 与 `AVG(duration_ms)` 写在同一条
 * `WHERE step = 'trigger'` 里。而 `trigger` 是在**发起请求那一刻**落的，
 * `writeEvent("trigger", …)` 从不传 `durationMs`（只有 success / fallback /
 * cancel 这些终态事件带耗时）→ `AVG(duration_ms)` 恒为 0 → 前端 `durationText(0)`
 * 显示「-」，看起来像「这个指标没做完」。
 *
 * 两个口径不能混：
 * - 调用次数仍按 `trigger` 数（一次请求算一次，避免重试 / 流式中断重复计数）；
 * - 平均耗时只按 `success` / `fallback` 算（`cancel` 也不算：它没有「跑完」）。
 *
 * 只能做源码断言：`ai-event-stats` 在注册函数里，跑起来要 better-sqlite3 的
 * native（vitest 下 require 即抛，见 MEMORY「守卫写法」）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const AI_HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/ai-handlers.ts"),
  "utf8",
);

/** 取出含 `AVG(duration_ms)` 的那一条 SQL 模板字符串（反引号内），不做全文匹配 */
function avgDurationSql(): string {
  // 用「别名 + 函数调用」整体做锚点：注释里也出现过 `` `AVG(duration_ms)` ``，
  // 只认函数名会命中注释里的反引号片段
  const marker = "AVG(duration_ms), 0) AS avg_dur";
  const at = AI_HANDLERS.indexOf(marker);
  expect(at, "找不到 AVG(duration_ms) —— 平均耗时被删了？").toBeGreaterThan(-1);
  const start = AI_HANDLERS.lastIndexOf("`", at);
  const end = AI_HANDLERS.indexOf("`", at);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return AI_HANDLERS.slice(start, end + 1);
}

describe("ai-event-stats：平均耗时按终态事件聚合（REQ-064）", () => {
  it("耗时 SQL 只统计 success / fallback", () => {
    const sql = avgDurationSql();
    expect(sql).toContain("step IN ('success', 'fallback')");
    // cancel 没有「跑完」的语义，算进去会把用户主动中断也算成一次耗时
    expect(sql).not.toContain("'cancel'");
  });

  it("反向断言：耗时 SQL 里不许再出现 `step = 'trigger'`", () => {
    const sql = avgDurationSql();
    expect(sql).not.toContain("step = 'trigger'");
    // 也不能靠 `step <> 'trigger'` 这种绕法（那会把 adopt / edit / cancel 一起算进耗时）
    expect(sql).not.toMatch(/step\s*<>\s*'trigger'/);
  });

  it("调用次数口径不变：totalCalls 仍按 trigger 计数", () => {
    expect(AI_HANDLERS).toMatch(
      /SELECT COUNT\(\*\) AS c FROM ai_event WHERE step = 'trigger'/,
    );
  });

  it("adopt 口径不变：采纳数仍只数 adopt", () => {
    expect(AI_HANDLERS).toMatch(
      /SELECT COUNT\(\*\) AS c FROM ai_event WHERE step = 'adopt'/,
    );
  });
});
