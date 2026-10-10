/**
 * 本地 SQLite 数据库模块
 * 使用 better-sqlite3 提供持久化存储
 *
 * 只承载 **checkin 域**：todo / memo / 日程 / 记账 / 打卡 / 应用级账号。
 * 小说域（novel_* + 行囊 novel_pack_*）自 1.33.0 起独立为 `novel.db`，
 * 见 `electron/novel-db.ts` —— 那边通过下面的生命周期回调跟随本库一起开关，
 * 本模块**不反向依赖**它（避免循环 import）。
 */
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { app } from 'electron'

let authDb: Database.Database | null = null
let db: Database.Database | null = null
/** 当前登录用户 email（switchUserDb 时同步），供业务 handler 定位用户数据目录 */
let currentEmail = ''

/**
 * 用户库生命周期监听（供其它独立库跟随开关，如 novel.db）
 *
 * 注册即返回一个注销函数；多个监听者互不影响。
 * 单个监听者抛错**不阻断**其它监听者，也不阻断本库的切换 —— 附属库挂了不该
 * 让待办 / 日程一起不可用。
 */
export interface UserDbLifecycle {
  /** 用户库已就绪（切换 / 首次打开）后触发，入参为当前 email */
  onSwitched?: (email: string) => void
  /** 用户库关闭后触发 */
  onClosed?: () => void
}

const lifecycleListeners = new Set<UserDbLifecycle>()

export function registerUserDbLifecycle(listener: UserDbLifecycle): () => void {
  lifecycleListeners.add(listener)
  return () => lifecycleListeners.delete(listener)
}

function emitLifecycle<K extends keyof UserDbLifecycle>(
  event: K,
  ...args: Parameters<NonNullable<UserDbLifecycle[K]>>
): void {
  for (const listener of lifecycleListeners) {
    try {
      const handler = listener[event] as ((...a: unknown[]) => void) | undefined
      handler?.(...args)
    } catch (error) {
      console.error(`[db] 生命周期监听 ${String(event)} 失败：`, error)
    }
  }
}

function getLegacyDbPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'checkin.db')
}

export function getUserDataDir(email: string): string {
  const userDataPath = path.join(app.getPath('userData'), 'user-data')
  const normalizedEmail = email.trim().toLowerCase()
  const safePrefix = normalizedEmail
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 64)
    .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i, 'user')
  const emailHash = crypto
    .createHash('sha256')
    .update(normalizedEmail)
    .digest('hex')
    .slice(0, 16)
  const folderName = `${safePrefix || 'user'}-${emailHash}`
  return path.join(userDataPath, folderName)
}

function getUserDbPath(email: string): string {
  return path.join(getUserDataDir(email), 'checkin.db')
}

function getLegacyUserDataDir(email: string): string {
  const userDataPath = path.join(app.getPath('userData'), 'user-data')
  const folderName = email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
  return path.join(userDataPath, folderName || 'default')
}

function initializeDataDb(database: Database.Database): void {
  database.pragma('journal_mode = WAL')
  database.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#1677ff',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);

    -- ── 小说域表已迁出 ──
    -- novel_* / novel_pack_* / usage_log 全部归属 novel.db（见 electron/novel-db.ts）。
    -- 历史上它们建在本库里，1.33.0 起不再创建、也不再读取；老库中残留的
    -- 同名表不会被触碰（数据仍在盘上，只是无人读取）。
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER DEFAULT NULL,
      content TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      note TEXT DEFAULT NULL,
      important INTEGER DEFAULT 0,
      work_hour REAL DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      done_at TEXT DEFAULT NULL
    );

    -- ── 记账（PRD v0.1 数据模型）──
    -- 金额统一 REAL（元），时间统一本地字符串 YYYY-MM-DD HH:mm:ss
    CREATE TABLE IF NOT EXISTS ledger_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'EllipsisOutlined',
      color TEXT NOT NULL DEFAULT '--app-text-muted',
      type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'income', 'both')),
      builtin INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS ledger_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'cash',
      balance REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS ledger_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '--app-text-muted'
    );
    CREATE TABLE IF NOT EXISTS ledger_transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'income', 'transfer')),
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      category_id TEXT,
      account_id TEXT,
      to_account_id TEXT,
      note TEXT NOT NULL DEFAULT '',
      happened_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_tx_happened
      ON ledger_transactions(happened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ledger_tx_category
      ON ledger_transactions(category_id);

    -- ── 每日打卡 ──
    -- checkin_date 为「业务日」YYYY-MM-DD：凌晨 0-5 点的打卡归属前一天（次日 5 点切日），
    -- UNIQUE 保证一个业务日只有一条打卡记录，重复点击由 INSERT OR IGNORE 幂等吸收
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkin_date TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(checkin_date);
    CREATE TABLE IF NOT EXISTS ledger_budgets (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      period TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `)
}

/** 初始化应用级用户数据库 */
export function initDb(): Database.Database {
  if (authDb) return authDb

  const dbPath = getLegacyDbPath()
  console.log(`[db] 初始化数据库: ${dbPath}`)

  authDb = new Database(dbPath)

  // 应用级用户表（单一记录，id 固定为 1）
  authDb.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `)

  console.log('[db] 数据库初始化完成')
  return authDb
}

/** 获取数据库实例 */
export function getDb(): Database.Database {
  if (!db) throw new Error('尚未初始化当前用户数据')
  return db
}

/** 切换当前用户的数据数据库 */
export function switchUserDb(email: string, migrateLegacy = false): void {
  currentEmail = email.trim()
  const userDbPath = getUserDbPath(email)
  const userDataPath = path.dirname(userDbPath)
  const legacyUserDataPath = getLegacyUserDataDir(email)
  const hasTargetDb = fs.existsSync(userDbPath)
  const migratedLegacyFolder =
    !hasTargetDb &&
    legacyUserDataPath !== userDataPath &&
    fs.existsSync(legacyUserDataPath)
  if (migratedLegacyFolder) {
    fs.mkdirSync(path.dirname(userDataPath), { recursive: true })
    fs.renameSync(legacyUserDataPath, userDataPath)
  }
  fs.mkdirSync(userDataPath, { recursive: true })
  if (db) db.close()
  db = new Database(userDbPath)
  initializeDataDb(db)
  const migrationCompleted = db
    .prepare("SELECT value FROM config WHERE key = 'legacy_migration_completed'")
    .get() as { value?: string } | undefined
  const shouldMigrate = migrateLegacy && !migrationCompleted && !migratedLegacyFolder

  if (shouldMigrate && authDb) {
    for (const table of ['config', 'activities', 'todos']) {
      const schema = authDb
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { sql?: string } | undefined
      if (!schema?.sql) continue
      const migrationSchema = schema.sql.replace(
        /^CREATE TABLE\s+/i,
        'CREATE TABLE IF NOT EXISTS ',
      )
      db.exec(migrationSchema)
      const rows = authDb.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]
      if (rows.length === 0) continue
      const columns = Object.keys(rows[0])
      const placeholders = columns.map(() => '?').join(', ')
      const insert = db.prepare(
        `INSERT OR IGNORE INTO "${table}" ("${columns.join('", "')}") VALUES (${placeholders})`,
      )
      const copyRows = db.transaction(() => {
        for (const row of rows) insert.run(...columns.map((column) => row[column]))
      })
      copyRows()
    }
    db.prepare(
      "INSERT OR REPLACE INTO config (key, value) VALUES ('legacy_migration_completed', '1')",
    ).run()
    console.log(`[db] 已迁移旧用户数据: ${userDbPath}`)
  }
  console.log(`[db] 当前用户数据: ${userDbPath}`)
  // 附属库（novel.db）跟随切换：必须放在本库完全就绪之后，
  // 让监听者可以安全地读到当前 email 与用户目录
  emitLifecycle('onSwitched', currentEmail)
}

export function getAuthDb(): Database.Database {
  return authDb ?? initDb()
}

/** 获取当前登录用户 email（未登录时为空串） */
export function getCurrentUserEmail(): string {
  return currentEmail
}

/** 关闭数据库（幂等；只有真的关了东西才广播 onClosed，避免监听者重复收到） */
export function closeDb(): void {
  const hadUserDb = db !== null
  const hadAuthDb = authDb !== null
  if (db) {
    db.close()
    db = null
    console.log('[db] 数据库已关闭')
  }
  if (authDb) {
    authDb.close()
    authDb = null
  }
  if (hadUserDb || hadAuthDb) emitLifecycle('onClosed')
}

// ── 通用 CRUD 方法 ──

/** 执行查询（SELECT），返回结果数组 */
export function dbAll(sql: string, params: unknown[] = []): unknown[] {
  return getDb().prepare(sql).all(...params)
}

/** 执行查询（SELECT），返回单条结果 */
export function dbGet(sql: string, params: unknown[] = []): unknown {
  return getDb().prepare(sql).get(...params)
}

/** 执行写操作（INSERT/UPDATE/DELETE），返回变更结果 */
export function dbRun(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
  const result = getDb().prepare(sql).run(...params)
  return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) }
}

/** 批量执行 SQL */
export function dbExec(sql: string): void {
  getDb().exec(sql)
}
