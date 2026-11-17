/**
 * 面试题库本地数据库（interview.db）
 *
 *   user-data/{email-hash}/
 *   ├─ checkin.db     todo / memo / ledger / checkin / activities / config
 *   ├─ novel.db       novel_* + novel_pack_* + novel_config
 *   ├─ map.db         map_*
 *   └─ interview.db   interview_item + interview_taxonomy + interview_meta   ← 本文件
 *
 * 【本库只装「用户增量」，不装题库本体】
 * 243 题 / 约 100 词条 / 24 图解 / 22 个分类继续以**源码常量**形式存在，
 * 是**只读基线**（`src/windows/BaseWindow/pages/InterviewPage/data/`）。本库只存
 * 用户与之**不一致的部分**：
 *
 *   - 用户新建的题 / 词条 / 图解     → `action='new'`，id 带 `u-` 前缀
 *   - 用户改了基线某一条             → `action='override'`，id **等于基线 id**
 *   - 用户删了基线某一条             → 同上，`status='hidden'`（墓碑）
 *   - 用户新增的分类                 → `interview_taxonomy`（不镜像 22 个基线）
 *
 * 这条「写时复制（COW）」规则是整个设计的支点：**升级 = 换常量，不是迁数据**。
 * 未被动过的题永远自动跟随新版本；动过的题由本库的一行覆盖住，升级不覆盖用户的
 * 修改、也不复活用户删掉的题。反过来，如果把基线「物化」进库，每次发版都要写一段
 * 「增量合并 / 脏标记 / 谁赢谁输」的迁移代码，且用户误删库就永久失去整份题库。
 *
 * 【为什么再开一本库】与 novel.db / map.db 拆库同源：
 * 1. **写频隔离**：划词转词条是高频小写入（一次划词 = 1 条 INSERT），不该与
 *    待办 / 日程 / 正文共享 WAL 与页缓存。
 * 2. **可整包搬运**：本库体积只装增量（通常几 KB），单独拷贝 / 恢复 / 排障都成立；
 *    挂进 checkin.db 就再也拆不出来。
 * 3. **演进边界**：taxonomy 与产物表仍在首次落地，允许「清库换代、不写迁移」，
 *    与 novel.db 1.33.0、map.db 同策略，不牵连三本既有库。
 *
 * 【边界】
 * - SQL 只出现在本文件与 `handlers/interview/*`；不导入 main.ts。
 * - 与 ai.db **平级、互不 import**：`interview_item.ai_log_id` 只存整数，
 *   跨库按值引用、不建外键（跨库无法约束）。
 * - 本模块**不做**任何 payload 语义校验（那是 `src/shared/interview/payload-shape.ts`
 *   与页面 `interview-validation.ts` 的职责），只靠 SQL 的 CHECK 守住状态机。
 *
 * 规范：docs/spec/interview-db-ai-spec.md
 */
import Database from "better-sqlite3";
import { app } from "electron";
import fs from "fs";
import path from "path";
import { getCurrentUserEmail, getUserDataDir, registerUserDbLifecycle } from "../core/db";

let interviewDb: Database.Database | null = null;

/** 题库库文件名（与 checkin.db / novel.db / map.db 同级） */
export const INTERVIEW_DB_FILE = "interview.db";

/** schema 版本（改表结构时 +1，供将来写迁移时判分支；当前只写入不判读） */
export const INTERVIEW_SCHEMA_VERSION = 1;

/** `interview_meta` 的键名（唯一产地，handler 与渲染层都从这里取） */
export const INTERVIEW_META_KEYS = {
  schemaVersion: "schema_version",
  baselineVersion: "baseline_version",
  lastImportAt: "last_import_at",
  lastExportAt: "last_export_at",
  /** 词条版本号：每次词条增删改 +1，供渲染层判断「行内高亮的关键词表要不要重建」 */
  glossaryVersion: "glossary_version",
} as const;

export function getInterviewDbPath(email: string): string {
  return path.join(getUserDataDir(email), INTERVIEW_DB_FILE);
}

/**
 * interview.db 的初始 schema（一次性建齐）。
 *
 * `interview_item` 用一张表装三类产物（question / glossary / diagram）：它们的
 * **访问模式同构**（按 `kind+status` 翻列表、按 `id` 取一条、按 `status='adopted'`
 * 全量导出），差异全在 `payload_json`。拆成三张表只会得到三份几乎相同的
 * SELECT，合并成一张「按类型分列」的大宽表又会因为三类字段不重叠而浪费一半列。
 *
 * 下方 CHECK 不是装饰：它们是 COW 语义的**唯一强制点**。渲染层 bug、导入脏数据、
 * 手改库文件都会在这里被拒，而不是等合并视图算出「一道题同时存在两种状态」。
 */
function initializeInterviewDb(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.exec(`
    -- ── 内容产物：题 / 词条 / 图解三类共用，差异全在 payload_json ──
    --
    -- id 是本题库最硬的约束：覆盖基线题时 id **必须等于基线 id**（不是新造一个）。
    -- 用户收藏存在 localStorage 的 string[] 里（favorites-storage.ts），按
    -- question.id 比对；换 id = 用户收藏全丢，词条 / 图解的 related / diagramId
    -- 也会变成悬空引用。所以 id 一旦落库就不许改，只有还原默认（删行）才消失。
    CREATE TABLE IF NOT EXISTS interview_item (
      id             TEXT PRIMARY KEY,
      kind           TEXT NOT NULL,                 -- question | glossary | diagram
      action         TEXT NOT NULL DEFAULT 'new',   -- new（用户自建）| override（作用于基线某条）
      base_id        TEXT,                          -- override：必须 = id；new：NULL
      status         TEXT NOT NULL DEFAULT 'draft', -- draft | adopted | rejected | hidden | deleted
      origin         TEXT NOT NULL,                 -- ai | manual | seed-import（往返原样保留）
      category_id    TEXT,                          -- u-c-… 或 22 个基线 id；图解为 NULL
      track          TEXT,                          -- written | foundation；图解为 NULL
      title          TEXT NOT NULL,                 -- 列表与去重用；hidden 行也存基线 title
      payload_json   TEXT,                          -- hidden 行为 NULL；override / new 必须非空
      base_stamp     TEXT,                          -- 覆盖时基线题的 updatedAt（"你基于 2026-01 版修改"）
      base_hash      TEXT,                          -- 覆盖时基线 payload 指纹（判「基线已更新」）
      ack_base_hash  TEXT,                          -- 用户点过「沿用我的」时的指纹（抑制重复提示）
      errors_json    TEXT,                          -- 采纳前校验 errors（draft 也落，供红字展示）
      source_intent  TEXT,                          -- interviewDraft:question 等，与 ai_event 口径一致
      ai_log_id      INTEGER,                       -- ai.db 的 ai_log.id（按值引用，不建外键）
      reviewed_at    INTEGER,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      deleted_at     INTEGER,                       -- 回收站：NULL = 在架
      CHECK (action IN ('new','override')),
      CHECK (status IN ('draft','adopted','rejected','hidden','deleted')),
      -- override 必须认领一条基线（base_id = id），new 必须不认领且带 u- 前缀。
      -- 这两条合起来保证「id 空间」与「覆盖关系」不可能互相矛盾。
      CHECK (action <> 'override' OR base_id IS NOT NULL),
      CHECK (action <> 'override' OR base_id = id),
      CHECK (action <> 'new'      OR base_id IS NULL),
      CHECK (action <> 'new'      OR id LIKE 'u-%'),
      -- 墓碑只允许「在基线上隐身」：payload 必须清空，否则会同时存在
      -- 「已删除」的内容和一份可被误读的副本。
      CHECK (status <> 'hidden'   OR (action = 'override' AND payload_json IS NULL)),
      -- 回收站只收用户自建（override 删了叫「还原默认」，是删行不是进回收站）
      CHECK (status <> 'deleted'  OR action = 'new'),
      CHECK (action <> 'override' OR payload_json IS NOT NULL OR status = 'hidden')
    );
    CREATE INDEX IF NOT EXISTS idx_item_action_status ON interview_item(action, status);
    CREATE INDEX IF NOT EXISTS idx_item_base          ON interview_item(base_id);
    CREATE INDEX IF NOT EXISTS idx_item_kind_status   ON interview_item(kind, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_item_category      ON interview_item(category_id, status);

    -- ── 分类体系：只存新增分类，不镜像 22 个基线 ──
    -- id 用 u-c-<slug>：22 个基线分类是 CategoryId 的字符串字面量联合，
    -- 前缀隔离保证两边不可能撞 id（也就不会在合并视图里互相覆盖）。
    CREATE TABLE IF NOT EXISTS interview_taxonomy (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,               -- 侧栏展示名（<= 12 字，超了侧栏换行）
      track       TEXT NOT NULL,               -- 只能挂 written / foundation 之一
      order_no    INTEGER NOT NULL,            -- 基线之后续排（>= 100）
      status      TEXT NOT NULL DEFAULT 'draft',
      origin      TEXT NOT NULL,
      note        TEXT,                        -- 一句话「这块考什么」
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER,
      CHECK (status IN ('draft','adopted')),
      -- 新增分类必须排在基线之后，否则侧栏顺序会插入到既有分组中间
      CHECK (order_no >= 100)
    );
    CREATE INDEX IF NOT EXISTS idx_taxonomy_track ON interview_taxonomy(track, status, order_no);

    -- ── 库级元信息 ──
    -- 只装「导出 / 导入要标注的口径」，不参与合并逻辑。
    CREATE TABLE IF NOT EXISTS interview_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // baseline_version：标注「这份增量是基于哪个基线版本产生的」。
  // 每次建连都写一遍（INSERT OR REPLACE 幂等）：app 升级后首次打开即自更新，
  // 不需要任何迁移钩子。它**不参与合并**，只在导出文件里留一行出处。
  writeMeta(
    database,
    INTERVIEW_META_KEYS.schemaVersion,
    String(INTERVIEW_SCHEMA_VERSION),
  );
  writeMeta(database, INTERVIEW_META_KEYS.baselineVersion, app.getVersion());
}

/** 写一条 meta（建库期与 handler 共用；幂等） */
function writeMeta(database: Database.Database, key: string, value: string): void {
  database
    .prepare(
      `INSERT INTO interview_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, Date.now());
}

/** 读一条 meta（缺省返回 null，不抛错 —— meta 缺失不该阻断业务） */
export function readInterviewMeta(key: string): string | null {
  const row = getInterviewDb()
    .prepare("SELECT value FROM interview_meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

/** 写一条 meta（供 handler 记录 last_import_at / last_export_at） */
export function setInterviewMeta(key: string, value: string): void {
  writeMeta(getInterviewDb(), key, value);
}

/** 打开（或切换到）当前用户的 interview.db */
export function switchInterviewDb(email: string): void {
  if (interviewDb) {
    interviewDb.close();
    interviewDb = null;
  }
  const dbPath = getInterviewDbPath(email);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  interviewDb = new Database(dbPath);
  initializeInterviewDb(interviewDb);
  console.log(`[interview-db] 已就绪: ${dbPath}`);
}

/** 获取 interview.db 实例（用户库未初始化时抛错） */
export function getInterviewDb(): Database.Database {
  if (!interviewDb) throw new Error("尚未初始化 interview 数据");
  return interviewDb;
}

/** interview.db 是否已就绪（供「未登录 / 未切换用户」时静默跳过） */
export function isInterviewDbReady(): boolean {
  return interviewDb !== null;
}

/**
 * 把 interview.db 挂到用户库生命周期上。
 *
 * 注册时若已有当前用户，立即补一次打开：启动流程是 `switchUserDb` 在前、
 * 各域 handler 注册在后，桥晚注册时必须自己补开，否则首个请求打到未打开的库。
 *
 * 与 novel.db / map.db 的差异：题库属 **base 窗口**（full / lite 打包，
 * novel 版不打包 BaseWindow），所以 lite 版要注册、novel 版不用。
 */
export function registerInterviewDbBridge(): void {
  registerUserDbLifecycle({
    onSwitched: switchInterviewDb,
    onClosed: closeInterviewDb,
  });
  const email = getCurrentUserEmail();
  if (email) switchInterviewDb(email);
}

/** 关闭 interview.db */
export function closeInterviewDb(): void {
  if (!interviewDb) return;
  interviewDb.close();
  interviewDb = null;
  console.log("[interview-db] 已关闭");
}

// ── CRUD 封装（与 novel-db / map-db 同签名，便于 handlers 平移）──

export function interviewAll(sql: string, params: unknown[] = []): unknown[] {
  return getInterviewDb().prepare(sql).all(...params);
}

export function interviewGet(sql: string, params: unknown[] = []): unknown {
  return getInterviewDb().prepare(sql).get(...params);
}

export function interviewRun(
  sql: string,
  params: unknown[] = [],
): { changes: number; lastInsertRowid: number } {
  const result = getInterviewDb().prepare(sql).run(...params);
  return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
}

export function interviewExec(sql: string): void {
  getInterviewDb().exec(sql);
}

/**
 * 事务封装。
 *
 * 用于「一次用户动作要写多行」的场景（导入、批量采纳）。better-sqlite3 的
 * `transaction` 是同步的，内部**不能 await** —— 需要异步先算好再进来。
 */
export function interviewTransaction<T>(run: () => T): T {
  return getInterviewDb().transaction(run)();
}
