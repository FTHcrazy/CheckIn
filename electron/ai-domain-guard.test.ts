/**
 * AI 域架构守卫（M1a / M1b / M7）
 *
 * 钉的是 B1 批次最容易回退的几处欠债：
 * 1. intent 又被写死（`intent: "generate"` 字面量）——那会再次让所有功能度量归零；
 * 2. AI 产品事件写到 `novel_usage_log` 而不是 ai.db（双库边界）；
 * 3. `ai_event` 只记元数据，绝不记正文 / 作品名 / 邮箱（合规白名单）；
 * 4. 事件写入带滚动清理 + try/catch 静默（不撑爆磁盘、不阻塞主链路）；
 * 5. `ai_log` 补了 `prompt_version` 列（prompt 效果归因的前提）。
 *
 * 为什么用源码断言：better-sqlite3 的 native 按 Electron ABI 编译，vitest
 * （node 进程）下 require 直接抛，跑不了真实建库，只能把不变量钉在源码上。
 * 同先例 `novel-db-split.test.ts` / `ai-log-guard.test.ts`。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const AI_DB = readFileSync(path.resolve(process.cwd(), "electron/ai-db.ts"), "utf8");
const AI_HANDLERS = readFileSync(
  path.resolve(process.cwd(), "electron/handlers/ai-handlers.ts"),
  "utf8",
);

describe("AI 产品事件（ai_event，守卫）", () => {
  it("ai.db 建了 ai_event 表与索引，且只记元数据", () => {
    expect(AI_DB).toContain("CREATE TABLE IF NOT EXISTS ai_event");
    expect(AI_DB).toContain("idx_ai_event_intent_step");
    expect(AI_DB).toContain("idx_ai_event_created");
  });

  it("ai_event 的列里不出现正文 / 作品名 / 邮箱等 PII 字段", () => {
    // 截出 CREATE TABLE ai_event 到其收尾括号，逐列核对白名单
    const start = AI_DB.indexOf("CREATE TABLE IF NOT EXISTS ai_event");
    expect(start).toBeGreaterThan(-1);
    const open = AI_DB.indexOf("(", start);
    const close = AI_DB.indexOf(");", open);
    const ddl = AI_DB.slice(open, close);

    for (const column of ["intent", "step", "provider", "model", "prompt_ver", "duration_ms", "error_code", "item_count", "char_count", "scope", "created_at"]) {
      expect(ddl, `ai_event 缺列 ${column}`).toContain(column);
    }
    // 白名单之外的敏感字段一律不许出现
    for (const forbidden of ["content", "prompt TEXT", "output TEXT", "work_name", "email"]) {
      expect(ddl, `ai_event 混入了 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("事件写入带滚动清理（条数上限 + 时间下界），不无限增长", () => {
    expect(AI_DB).toContain("AI_EVENT_RETAIN_COUNT");
    expect(AI_DB).toContain("AI_EVENT_RETAIN_DAYS");
    expect(AI_DB).toContain("trimAiEvents");
    expect(AI_DB).toMatch(/DELETE FROM ai_event[\s\S]*?LIMIT \?/);
    expect(AI_DB).toMatch(/datetime\('now', 'localtime', \?\)/);
  });

  it("事件写入静默失败（try/catch），绝不阻塞写作主链路", () => {
    const start = AI_DB.indexOf("export function logAiEvent");
    expect(start).toBeGreaterThan(-1);
    const body = AI_DB.slice(start, AI_DB.indexOf("export function trimAiEvents"));
    expect(body).toContain("try {");
    expect(body).toContain("catch");
  });
});

describe("AI 事件的双库边界（守卫）", () => {
  it("AI 事件落 ai.db，不写进 novel_usage_log", () => {
    // ai-handlers 只能从 ../ai-db 取写通道
    expect(AI_HANDLERS).toContain('from "../ai-db"');
    expect(AI_HANDLERS).not.toMatch(/from\s+"\.\.\/novel-db"/);
    // 事件落库走 ai-db 的 logAiEvent（INSERT 在 ai-db.ts 内），handler 只负责调用
    expect(AI_HANDLERS).toContain("logAiEvent(");
    expect(AI_DB).toContain("INSERT INTO ai_event");
    // 两处都绝不出现 novel_usage_log
    expect(AI_HANDLERS).not.toContain("novel_usage_log");
    expect(AI_DB).not.toContain("novel_usage_log");
  });

  it("intent 不硬编码（取值自请求，否则度量再次归零）", () => {
    // 主进程侧：intent 来自 req.intent，不允许出现 `intent: "generate"` 字面量兜底
    expect(AI_HANDLERS).not.toMatch(/intent:\s*"generate"/);
    expect(AI_HANDLERS).toMatch(/req\.intent\?\.trim\(\)\s*\|\|\s*"generate"/);
  });
});

describe("prompt 版本归因（M7，守卫）", () => {
  it("ai_log 增量迁移补了 prompt_version 列", () => {
    expect(AI_DB).toContain('table_info(ai_log)');
    expect(AI_DB).toContain("ALTER TABLE ai_log ADD COLUMN prompt_version TEXT");
  });

  it("落 ai_log 时写 prompt_version（从注册表取，不硬编码）", () => {
    const start = AI_HANDLERS.indexOf("INSERT INTO ai_log");
    expect(start).toBeGreaterThan(-1);
    const sql = AI_HANDLERS.slice(start, AI_HANDLERS.indexOf("`", start));
    expect(sql).toContain("prompt_version");
    expect(AI_HANDLERS).toContain("promptVersionOf(");
  });
});
