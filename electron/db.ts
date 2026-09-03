/**
 * 本地 SQLite 数据库模块
 * 使用 better-sqlite3 提供持久化存储
 */
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { app } from 'electron'

let authDb: Database.Database | null = null
let db: Database.Database | null = null

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
  `)
}

/** 初始化应用级用户数据库 */
export function initDb(): Database.Database {
  if (authDb) return authDb

  const dbPath = getLegacyDbPath()
  console.log(`[db] 初始化数据库: ${dbPath}`)

  authDb = new Database(dbPath)

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
}

export function getAuthDb(): Database.Database {
  return authDb ?? initDb()
}

/** 关闭数据库 */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
    console.log('[db] 数据库已关闭')
  }
  if (authDb) {
    authDb.close()
    authDb = null
  }
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
