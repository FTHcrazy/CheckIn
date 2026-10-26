/**
 * AI 域本地数据库（ai.db）
 *
 * AI 相关配置与「后续可能扩展的记忆/偏好」都放本库，与 checkin.db / novel.db
 * 完全分离：
 *
 *   user-data/{email-hash}/
 *   ├─ checkin.db   todo / memo / ledger / checkin / activities / config
 *   ├─ novel.db     novel_* 业务表 + novel_pack_* 行囊表 + novel_config
 *   └─ ai.db        ai_config（首版单表；ai_memory / ai_usage_log 留演进）
 *
 * 分离理由（R-AI-01 已定）：
 * 1. **边界**：AI 的 schema 演进不触碰 checkin / novel 两域的表结构；
 * 2. **隔离**：AI 是横切多域的通用能力，不隶属任一业务域；
 * 3. **安全**：Key 加密字段单独成库，备份 / 清理时可独立处理。
 *
 * ⚠️ 随 edition 开关（R-AI-04 预研点 2 已定）：本库只在 `EDITION !== "lite"`
 * 时初始化（full / novel 含 novel 域，AI 入口先落在 novel 侧的起名增强上），
 * lite 版不建库、设置窗口也不展示 AI 分区。后续 checkin 窗口接入 AI 时，
 * 删掉 main.ts 里的 edition 判断即可放开到全版本。
 *
 * 边界：SQL 只出现在本文件与 handlers/ai-handlers.ts；不导入 main.ts。
 */
import Database from "better-sqlite3";
import path from "path";
import { getCurrentUserEmail, getUserDataDir, registerUserDbLifecycle } from "./db";

let aiDb: Database.Database | null = null;

export function getAiDbPath(email: string): string {
  return path.join(getUserDataDir(email), "ai.db");
}

/**
 * ai.db 的初始 schema（一次性建库）。
 *
 * 首版只建 `ai_config` 一张表（R-AI-04 预研点 2 已定），与 checkin.db 的
 * `config`、novel.db 的 `novel_config` 同构。`ai_memory`（用户给 AI 的长期
 * 记忆/偏好）、`ai_usage_log`（用量埋点）是 R-AI-01「后续可能存记忆」预留的
 * 演进位，本版**不建**，真正需要时再 `CREATE TABLE` + 增量迁移（§6.5）。
 *
 * Key 用单独的 `api_key_enc` 键存 `safeStorage` 加密串，绝不明文落盘。
 */
function initializeAiDb(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS ai_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intent TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      system_prompt TEXT,
      user_prompt TEXT,
      raw_output TEXT,
      parsed_output TEXT,
      error_code TEXT,
      error_message TEXT,
      duration_ms INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_ai_log_created ON ai_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_log_intent ON ai_log(intent);
  `);
}

/** 打开 / 切换用户的 ai.db（用户库生命周期回调，见 registerAiDbBridge） */
function switchAiDb(email: string): void {
  if (aiDb) {
    aiDb.close();
    aiDb = null;
  }
  const dbPath = getAiDbPath(email);
  aiDb = new Database(dbPath);
  initializeAiDb(aiDb);
  console.log(`[ai-db] 已就绪: ${dbPath}`);
}

/** 获取 ai.db 实例（未初始化时抛错） */
export function getAiDb(): Database.Database {
  if (!aiDb) throw new Error("尚未初始化 AI 数据");
  return aiDb;
}

/** ai.db 是否已就绪（供「未登录 / 未切换用户」时静默跳过） */
export function isAiDbReady(): boolean {
  return aiDb !== null;
}

/**
 * 把 ai.db 挂到用户库生命周期上。
 *
 * 与 `registerNovelDbBridge` 同范式：注册时若已有当前用户，立即补一次打开
 * （启动流程是 `switchUserDb` 在前、`registerAiHandlers` 在后）。
 *
 * ⚠️ 调用方（main.ts）必须用 `EDITION !== "lite"` 包起来 —— lite 版不建库。
 */
export function registerAiDbBridge(): void {
  registerUserDbLifecycle({
    onSwitched: switchAiDb,
    onClosed: closeAiDb,
  });
  const email = getCurrentUserEmail();
  if (email) switchAiDb(email);
}

/** 关闭 ai.db */
export function closeAiDb(): void {
  if (!aiDb) return;
  aiDb.close();
  aiDb = null;
  console.log("[ai-db] 已关闭");
}

// ── CRUD 封装（与 novel-db.ts 同签名，便于 handlers 平移）──

export function aiAll(sql: string, params: unknown[] = []): unknown[] {
  return getAiDb().prepare(sql).all(...params);
}

export function aiGet(sql: string, params: unknown[] = []): unknown {
  return getAiDb().prepare(sql).get(...params);
}

export function aiRun(
  sql: string,
  params: unknown[] = [],
): { changes: number; lastInsertRowid: number } {
  const result = getAiDb().prepare(sql).run(...params);
  return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
}

export function aiExec(sql: string): void {
  getAiDb().exec(sql);
}
