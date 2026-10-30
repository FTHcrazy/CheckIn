/**
 * AI 调用日志源码守卫
 *
 * 钉的是一次**静默失效**：AI 记录原本走 `log("debug", …)`，而 `log` 会按
 * `settings.level` 过滤 —— 默认级别是 `info`，于是全新安装的用户在日志文件里
 * **看不到任何 AI 调用**，偏偏那正是「模型为什么答歪了」的唯一线索。
 *
 * 同类先例：`novel-safety-guard.test.ts` / `novel-write-guard.test.ts`
 * （better-sqlite3 的 native 在 vitest 下 require 就抛，只能源码断言）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const AI_HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/ai-handlers.ts"),
  "utf8",
);
const AI_DB = readFileSync(resolve(process.cwd(), "electron/ai-db.ts"), "utf8");
const LOGGER = readFileSync(resolve(process.cwd(), "electron/logger.ts"), "utf8");

describe("AI 调用日志（守卫）", () => {
  it("绕开 level 阈值写入，否则默认 info 级别下看不到任何 AI 记录", () => {
    expect(LOGGER).toMatch(/export function logAlways\(/);
    // logAlways 本体不许出现任何 level 比较（出现即说明又开始过滤了）
    const start = LOGGER.indexOf("export function logAlways(");
    const body = LOGGER.slice(start, LOGGER.indexOf("\n}", start));
    expect(body).not.toMatch(/LEVEL_WEIGHT/);
    // ai-handlers 用的是 logAlways，不是 log
    expect(AI_HANDLERS).toContain("logAlways(");
    expect(AI_HANDLERS).not.toMatch(/[^A-Za-z]log\(\s*"debug",\s*entry\.window/);
  });

  it("结构化落库：意图 / 提示词 / 输出 / 错误码 / 耗时一个不少", () => {
    const start = AI_HANDLERS.indexOf("INSERT INTO ai_log");
    expect(start).toBeGreaterThan(-1);
    const sql = AI_HANDLERS.slice(start, AI_HANDLERS.indexOf("`", start));
    for (const column of [
      "intent",
      "provider",
      "model",
      "system_prompt",
      "user_prompt",
      "raw_output",
      "error_code",
      "duration_ms",
    ]) {
      expect(sql).toContain(column);
    }
  });

  it("日志侧一并截断，长章节不会把 ai_log 撑爆", () => {
    expect(AI_HANDLERS).toMatch(/truncateForLog\(/);
    expect(AI_HANDLERS).toMatch(/preview\(/);
  });
});

describe("AI 调用日志保留期（守卫）", () => {
  it("ai_log 只保留 30 天，且按时间淘汰（不设条数上限）", () => {
    expect(AI_DB).toContain("AI_LOG_RETAIN_DAYS = 30");
    expect(AI_DB).toMatch(/export function trimAiLogs\(/);
    expect(AI_DB).toMatch(/DELETE FROM ai_log\s+WHERE created_at </);
    // 条数上限会让密集调 prompt 的那天挤掉前一天的记录，故本表不设 LIMIT 清理
    const start = AI_DB.indexOf("export function trimAiLogs");
    const body = AI_DB.slice(start, AI_DB.indexOf("\n}", start));
    expect(body).not.toMatch(/LIMIT \?/);
  });

  it("清理挂在「写入后 + 启动」两处：不调 AI 时保留期同样生效", () => {
    // 写入路径：appendAiLog 落库后顺带兜一次
    expect(AI_HANDLERS).toMatch(/trimAiLogs\(\s*\)/);
    // 启动 / 切库：强制清一次（此时节流窗口未开始，force 才有意义）
    expect(AI_DB).toMatch(/trimAiLogs\(true\)/);
    // 节流：ai_log 行宽，不能每条日志都做一次删除
    expect(AI_DB).toContain("AI_LOG_TRIM_INTERVAL_MS");
  });
});
