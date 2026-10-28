/**
 * QA 独立复核（REQ-064）：「平均耗时」这条 SQL **真的跑一遍**。
 *
 * 为什么不满足于源码断言：`ai-usage-stats-guard.test.ts` 只证明「文件里出现了
 * `step IN ('success','fallback')` 这个字符串」。字符串对了、SQL 却写错表 / 写错
 * 别名 / `AVG` 被 COALESCE 包在错的位置，守卫一样是绿的。这里用项目已依赖的
 * `better-sqlite3` 建一个内存库，把 **handler 源码里的那几条 SQL 原样抠出来**
 * （不是手抄——手抄会漂移），按真实触发顺序插数据再跑一遍，看聚合结果。
 *
 * 判据（需求口径，见 CHANGELOG 2.12.0）：
 * - `totalCalls` 仍按 `step='trigger'`（一次请求算一次）；
 * - `avgDurationMs` 只由 `success` / `fallback` 决定，`cancel` 不参与；
 * - 老数据只有 `trigger` 行时返回 0，**不能是 NaN**（否则界面显示 `NaN ms`）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const AI_HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/ai-handlers.ts"),
  "utf8",
);
const AI_DB = readFileSync(resolve(process.cwd(), "electron/ai-db.ts"), "utf8");

/**
 * 从源码里抠出一个模板字符串（反引号之间），用**唯一标记**定位。
 *
 * 用标记而不是「第 N 个反引号」：源码里的注释也常引用 SQL 片段，按序数取必然
 * 在下次改动后取错一段（而且取错了通常是"悄悄绿"，不是红）。
 */
function templateLiteralContaining(source: string, marker: string, label: string): string {
  const at = source.indexOf(marker);
  expect(at, `找不到 ${label} 的标记（SQL 被改写或删除了？）：${marker}`).toBeGreaterThan(-1);
  const start = source.lastIndexOf("`", at);
  const end = source.indexOf("`", at);
  expect(start, `${label} 不在模板字符串里`).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start + 1, end);
}

/** `ai_event` 的建表语句：同样从 ai-db.ts 抠出来，避免测试自己维护一份会漂的 schema */
function aiEventSchema(): string {
  const marker = "CREATE TABLE IF NOT EXISTS ai_event (";
  const at = AI_DB.indexOf(marker);
  expect(at, "ai-db.ts 里找不到 ai_event 建表语句").toBeGreaterThan(-1);
  const close = AI_DB.indexOf("    );", at);
  expect(close).toBeGreaterThan(at);
  return AI_DB.slice(at, close + "    );".length);
}

const CALL_SQL = templateLiteralContaining(
  AI_HANDLERS,
  "COUNT(*) AS c FROM ai_event WHERE step = 'trigger'",
  "调用次数 SQL",
);
const DURATION_SQL = templateLiteralContaining(
  AI_HANDLERS,
  "AVG(duration_ms), 0) AS avg_dur",
  "平均耗时 SQL",
);
const ADOPT_SQL = templateLiteralContaining(
  AI_HANDLERS,
  "COUNT(*) AS c FROM ai_event WHERE step = 'adopt'",
  "采纳数 SQL",
);
const BY_INTENT_SQL = templateLiteralContaining(
  AI_HANDLERS,
  "GROUP BY intent",
  "按意图分布 SQL",
);

/**
 * 复刻 handler 的参数绑定：`since` 为空时 `${sinceCond}` 展开成空串、不带参数。
 * 这里把源码里的占位符换成真实条件，等价于运行期行为。
 */
function withSince(sql: string, since: string | null): { sql: string; args: string[] } {
  if (!sql.includes("${sinceCond}")) {
    // 没有时间窗的 SQL 不该被这里"悄悄"通过：handler 里三条都带时间窗
    throw new Error(`SQL 里没有 \${sinceCond} 占位符，参数绑定可能被删了：${sql}`);
  }
  return {
    sql: sql.replace("${sinceCond}", since ? "AND created_at >= ?" : ""),
    args: since ? [since] : [],
  };
}

interface Row {
  intent: string;
  step: string;
  duration_ms: number | null;
  created_at?: string;
}

function makeDb(rows: Row[]): Database.Database {
  const db = new Database(":memory:");
  db.exec(aiEventSchema());
  const insert = db.prepare(
    "INSERT INTO ai_event (intent, step, duration_ms, created_at) VALUES (?, ?, ?, COALESCE(?, datetime('now','localtime')))",
  );
  for (const row of rows) insert.run(row.intent, row.step, row.duration_ms, row.created_at ?? null);
  return db;
}

/** 复刻 handler 的聚合逻辑（三条查询 + adoptRate + Math.round） */
function stats(db: Database.Database, since: string | null = null) {
  const call = withSince(CALL_SQL, since);
  const duration = withSince(DURATION_SQL, since);
  const adopt = withSince(ADOPT_SQL, since);
  const byIntent = withSince(BY_INTENT_SQL, since);

  const callRow = db.prepare(call.sql).get(...call.args) as { c: number } | undefined;
  const durationRow = db.prepare(duration.sql).get(...duration.args) as
    | { avg_dur: number | null }
    | undefined;
  const adoptRow = db.prepare(adopt.sql).get(...adopt.args) as { c: number } | undefined;
  const byIntentRows = db.prepare(byIntent.sql).all(...byIntent.args) as Array<{
    intent: string;
    calls: number;
    adopts: number;
  }>;

  const totalCalls = callRow?.c ?? 0;
  const adoptCount = adoptRow?.c ?? 0;
  return {
    totalCalls,
    adoptCount,
    adoptRate: totalCalls > 0 ? adoptCount / totalCalls : 0,
    avgDurationMs: Math.round(durationRow?.avg_dur ?? 0),
    byIntent: byIntentRows.map((row) => ({
      intent: row.intent,
      calls: Number(row.calls) || 0,
      adopts: Number(row.adopts) || 0,
    })),
  };
}

/** 一次完整调用的四条事件（trigger 无耗时，终态才有） */
const FULL_CALL: Row[] = [
  { intent: "naming", step: "trigger", duration_ms: null },
  { intent: "naming", step: "success", duration_ms: 1200 },
  { intent: "naming", step: "adopt", duration_ms: null },
  { intent: "polish", step: "trigger", duration_ms: null },
  { intent: "polish", step: "fallback", duration_ms: 800 },
  // 用户主动中断：duration 有值，但它没有「跑完」的语义，不该进平均
  { intent: "polish", step: "cancel", duration_ms: 9000 },
  { intent: "continuation", step: "edit", duration_ms: 400 },
];

describe("ai-event-stats 三条 SQL 真跑（REQ-064）", () => {
  it("平均耗时只由 success / fallback 决定（cancel 不参与）", () => {
    const db = makeDb(FULL_CALL);
    const result = stats(db);
    // (1200 + 800) / 2，cancel 的 9000 若被算进来会是 3666
    expect(result.avgDurationMs).toBe(1000);
    expect(result.avgDurationMs).not.toBe(Math.round((1200 + 800 + 9000) / 3));
    db.close();
  });

  it("调用次数口径不变：仍按 trigger 数（cancel / edit / adopt 不计入）", () => {
    const db = makeDb(FULL_CALL);
    expect(stats(db).totalCalls).toBe(2);
    db.close();
  });

  it("采纳率仍按 adopt / trigger（改耗时口径不许把采纳率带偏）", () => {
    const db = makeDb(FULL_CALL);
    const result = stats(db);
    expect(result.adoptCount).toBe(1);
    expect(result.adoptRate).toBeCloseTo(0.5, 10);
    db.close();
  });

  it("按意图分布仍按 trigger / adopt 数（cancel 不进 calls）", () => {
    const db = makeDb(FULL_CALL);
    const byIntent = stats(db).byIntent;
    const naming = byIntent.find((row) => row.intent === "naming");
    const polish = byIntent.find((row) => row.intent === "polish");
    expect(naming).toEqual({ intent: "naming", calls: 1, adopts: 1 });
    expect(polish).toEqual({ intent: "polish", calls: 1, adopts: 0 });
    // continuation 只有 edit，不该出现在分布里
    expect(byIntent.map((row) => row.intent)).not.toContain("continuation");
    db.close();
  });

  it("老数据只有 trigger 行 → 平均耗时是 0，不是 NaN（界面否则会显示 NaN ms）", () => {
    const db = makeDb([
      { intent: "naming", step: "trigger", duration_ms: null },
      { intent: "polish", step: "trigger", duration_ms: null },
    ]);
    const result = stats(db);
    expect(Number.isNaN(result.avgDurationMs), "AVG 空集合回落成了 NaN").toBe(false);
    expect(result.avgDurationMs).toBe(0);
    expect(result.totalCalls).toBe(2);
    db.close();
  });

  it("回归对照：旧写法（耗时也按 step='trigger' 聚合）恒为 0 —— 这正是被修的缺陷", () => {
    const db = makeDb(FULL_CALL);
    const legacy = db
      .prepare("SELECT COALESCE(AVG(duration_ms), 0) AS avg_dur FROM ai_event WHERE step = 'trigger'")
      .get() as { avg_dur: number };
    expect(Math.round(legacy.avg_dur)).toBe(0);
    // 新写法在同一份数据上给出真实值
    expect(stats(db).avgDurationMs).toBe(1000);
    db.close();
  });

  it("时间窗：since 生效且是参数绑定（不是拼字符串）", () => {
    const rows: Row[] = [
      ...FULL_CALL,
      { intent: "naming", step: "success", duration_ms: 9999, created_at: "2020-01-01 00:00:00" },
    ];
    const db = makeDb(rows);

    // 不传 since：老记录也算进去
    expect(stats(db).avgDurationMs).toBe(Math.round((1200 + 800 + 9999) / 3));

    // 传 30 天下界：2020 年那条被排除，回到 1000
    const since = db
      .prepare("SELECT datetime('now','-30 days','localtime') AS s")
      .get() as { s: string };
    expect(stats(db, since.s).avgDurationMs).toBe(1000);

    // 参数绑定：把注入串当参数传进去只会"匹配不到"，绝不会改变 SQL 结构
    expect(() => stats(db, "'; DROP TABLE ai_event; --")).not.toThrow();
    db.close();
  });

  it("空库：全零而不是 NaN / 抛错（新装用户第一次打开看板）", () => {
    const db = makeDb([]);
    const result = stats(db);
    expect(result).toMatchObject({ totalCalls: 0, adoptCount: 0, adoptRate: 0, avgDurationMs: 0 });
    expect(result.byIntent).toEqual([]);
    db.close();
  });
});
