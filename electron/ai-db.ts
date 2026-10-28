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
import { log, logAlways } from "./logger";

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

    -- 产品维度事件表（与技术日志 ai_log 分工，见 prd-ai-roadmap 架构复核 §5.1）
    -- 只记元数据，绝不记正文 / 作品名 / 邮箱。
    CREATE TABLE IF NOT EXISTS ai_event (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      intent       TEXT    NOT NULL,   -- naming/polish/transform/continuation/extract/
                                       --   summary/consistency/branch/report/qa/card/fill/test
      step         TEXT    NOT NULL,   -- trigger|success|fallback|adopt|edit|cancel
      provider     TEXT,               -- openai/ollama（trigger 时可能为空）
      model        TEXT,
      prompt_ver   TEXT,               -- prompt 模板版本（M7，用于效果归因）
      duration_ms  INTEGER,
      error_code   TEXT,               -- 归一化错误码；成功为空
      item_count   INTEGER,            -- 产出条数（json-array 场景）
      char_count   INTEGER,            -- 送模型的总输入字数（用户提示词 + system 上下文，只记字数不记正文）
      scope        TEXT,               -- chapter|selection|recent3 —— L3 授权范围（授权拒绝率 / 范围分布）
      created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_ai_event_intent_step ON ai_event(intent, step);
    CREATE INDEX IF NOT EXISTS idx_ai_event_created     ON ai_event(created_at DESC);
  `);

  // ── 增量迁移（§6.5）───────────────────────────────────────────────
  // M7：ai_log 补 prompt_version 列（改 prompt 后对比前后效果用）。可空，
  // 老日志一律视为「版本未知」，无需回填。
  const logColumns = database.pragma("table_info(ai_log)") as Array<{ name: string }>;
  if (!logColumns.some((column) => column.name === "prompt_version")) {
    database.exec("ALTER TABLE ai_log ADD COLUMN prompt_version TEXT");
  }
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
  log("info", "main", "ai", `ai.db 已就绪: ${dbPath}`);
  // 启动即清一次过期调用日志：不走写入路径也能保证 30 天保留期生效
  trimAiLogs(true);
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
  // 换用户 / 退出后重新打开时，节流窗口从头算（新库该立刻清一次）
  aiLogTrimmedAt = 0;
  log("info", "main", "ai", "ai.db 已关闭");
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

// ── AI 事件（产品度量）───────────────────────────────────────────────

/** ai_event 滚动清理：默认最近 5000 条 **且** 90 天内（见 prd 架构复核 §5.1） */
const AI_EVENT_RETAIN_COUNT = 5000;
const AI_EVENT_RETAIN_DAYS = 90;

/** 一条 AI 产品事件（只记元数据，见 AiEventEntry 的字段约定） */
export interface AiEventEntry {
  intent: string;
  step: "trigger" | "success" | "fallback" | "adopt" | "edit" | "cancel";
  provider?: string;
  model?: string;
  promptVer?: string;
  durationMs?: number;
  errorCode?: string;
  itemCount?: number;
  charCount?: number;
  scope?: string;
}

/**
 * 落一条 AI 产品事件（M1a）。
 *
 * 与 `ai_log` 严格分工：本表只存元数据（intent / step / 耗时 / 错误码 / 条数 /
 * 字数 / 范围），**不存任何正文、作品名、章节标题、邮箱**（合规白名单，见守卫）。
 *
 * 失败静默（同 `logUsageEvent` 范式）：埋点绝不能阻塞写作主链路。
 * 每次写入顺带做滚动清理，避免事件表无限增长撑爆磁盘。
 */
export function logAiEvent(entry: AiEventEntry): void {
  if (!aiDb) return; // 未初始化（lite 版 / 未登录）时静默跳过
  try {
    aiRun(
      `INSERT INTO ai_event
        (intent, step, provider, model, prompt_ver, duration_ms,
         error_code, item_count, char_count, scope)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.intent,
        entry.step,
        entry.provider ?? null,
        entry.model ?? null,
        entry.promptVer ?? null,
        entry.durationMs ?? null,
        entry.errorCode ?? null,
        entry.itemCount ?? null,
        entry.charCount ?? null,
        entry.scope ?? null,
      ],
    );
    trimAiEvents();
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    logAlways("warn", "main", "ai", `ai_event 写入失败: ${raw}`);
  }
}

/** 滚动清理：超出条数上限或时间下界的老事件，批量删到界限内 */
export function trimAiEvents(): void {
  if (!aiDb) return;
  try {
    aiRun(
      `DELETE FROM ai_event
        WHERE id NOT IN (
          SELECT id FROM ai_event
          ORDER BY id DESC LIMIT ?
        )`,
      [AI_EVENT_RETAIN_COUNT],
    );
    aiRun(
      `DELETE FROM ai_event
        WHERE created_at < datetime('now', 'localtime', ?)`,
      [`-${AI_EVENT_RETAIN_DAYS} days`],
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    logAlways("warn", "main", "ai", `ai_event 清理失败: ${raw}`);
  }
}

// ── AI 技术日志（ai_log）保留期 ──────────────────────────────────────

/**
 * ai_log 保留期：**只保留最近 30 天**。
 *
 * 与 ai_event 的「条数 + 天数」双限不同，本表只按天数淘汰：
 * 每行含截断后的 system / user prompt 与模型输出（各上限 4000 字），
 * 真实体量比事件表大两个量级；而它的用途是「刚调完 prompt 时回看那次答歪的
 * 原文」，属一次性排障资料，30 天足够复盘一个版本周期。
 *
 * 不设条数上限：密集调 prompt 的一天可能有几百条，条数上限会把昨天的有效记录
 * 挤掉，而按天淘汰的语义对用户可解释（「一个月前的记录会被清掉」）。
 */
const AI_LOG_RETAIN_DAYS = 30;

/**
 * 上次清理的时间戳（节流用）。
 *
 * 清理挂在写入路径上，但不必每条日志都扫一遍索引——一小时最多一次足够：
 * 保留期以「天」为单位，秒级延迟毫无意义，而 ai_log 的行很宽，删除代价不为零。
 */
const AI_LOG_TRIM_INTERVAL_MS = 60 * 60 * 1000;
let aiLogTrimmedAt = 0;

/**
 * 删掉 `ai_log` 里超过 30 天的记录。
 *
 * 调用时机：
 * - 每次写入调用日志后（节流：1 小时内至多一次），见 `appendAiLog`；
 * - 每次切库 / 启动时 `force = true`，见 `switchAiDb` ——
 *   只有在「一直不调 AI」的场景下写入路径不会触发，而那种场景下记录同样
 *   在变旧，靠启动补一次才能保证保留期真的生效。
 *
 * 失败静默（warn 走 `logAlways`）：清理不该影响任何主链路。
 * `created_at` 上有 DESC 索引，这条 DELETE 是索引范围扫描，不是全表扫。
 */
export function trimAiLogs(force = false): void {
  if (!aiDb) return;
  const now = Date.now();
  if (!force && now - aiLogTrimmedAt < AI_LOG_TRIM_INTERVAL_MS) return;
  aiLogTrimmedAt = now;
  try {
    const { changes } = aiRun(
      `DELETE FROM ai_log WHERE created_at < datetime('now', 'localtime', ?)`,
      [`-${AI_LOG_RETAIN_DAYS} days`],
    );
    if (changes > 0) {
      log(
        "info",
        "main",
        "ai",
        `ai_log 清理：删除 ${changes} 条超过 ${AI_LOG_RETAIN_DAYS} 天的调用记录`,
      );
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    logAlways("warn", "main", "ai", `ai_log 清理失败: ${raw}`);
  }
}
