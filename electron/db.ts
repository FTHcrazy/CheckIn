/**
 * 本地 SQLite 数据库模块
 * 使用 better-sqlite3 提供持久化存储
 */
import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'

let db: Database.Database | null = null

/** 获取数据库文件路径 */
function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'checkin.db')
}

/** 初始化数据库，创建表结构 */
export function initDb(): Database.Database {
  if (db) return db

  const dbPath = getDbPath()
  console.log(`[db] 初始化数据库: ${dbPath}`)

  db = new Database(dbPath)

  // 开启 WAL 模式提升性能
  db.pragma('journal_mode = WAL')

  // 创建通用 KV 配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `)

  // 创建活动表
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#1677ff',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `)

  // 创建索引
  db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date)`)

  console.log('[db] 数据库初始化完成')
  return db
}

/** 获取数据库实例 */
export function getDb(): Database.Database {
  if (!db) return initDb()
  return db
}

/** 关闭数据库 */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
    console.log('[db] 数据库已关闭')
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
