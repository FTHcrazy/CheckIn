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
/** 当前登录用户 email（switchUserDb 时同步），供业务 handler 定位用户数据目录 */
let currentEmail = ''

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

    -- ── 小说编辑器（PRD v0.4 §7 数据层，M1 一次到位）──
    -- 时间戳统一存毫秒整数（渲染层 Date.now() 口径），避免字符串时区解析
    CREATE TABLE IF NOT EXISTS novel_works (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS novel_volumes (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '未命名卷',
      sort INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS novel_chapters (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      volume_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '未命名',
      content TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'done')),
      sort INTEGER NOT NULL DEFAULT 1,
      outline_note TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_novel_chapters_work
      ON novel_chapters(work_id, volume_id, sort);
    CREATE TABLE IF NOT EXISTS novel_snapshots (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      delta_words INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_novel_snapshots_chapter
      ON novel_snapshots(chapter_id, created_at);
    CREATE TABLE IF NOT EXISTS novel_notes (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      foreshadow_id TEXT
    );
    CREATE TABLE IF NOT EXISTS novel_outline_entries (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'foreshadow',
      volume_id TEXT NOT NULL,
      chapter_id TEXT,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS novel_entities (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'custom',
      name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '{}',
      sort INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS novel_links (
      id TEXT PRIMARY KEY,
      from_type TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_type TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS novel_level_systems (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      name TEXT NOT NULL,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS novel_levels (
      id TEXT PRIMARY KEY,
      system_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rank INTEGER NOT NULL,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_novel_levels_system
      ON novel_levels(system_id, rank);
    CREATE TABLE IF NOT EXISTS novel_level_conversions (
      id TEXT PRIMARY KEY,
      from_level_id TEXT NOT NULL,
      to_level_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      note TEXT
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
    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );

    -- ── 行囊 CharacterPack（PRD docs/character-pack-prd.md §9.2）──
    -- v1 只承载 1 条主角，模型按多角色预留（全部表带 character_id）
    -- 数值统一 REAL、布尔统一 INTEGER 0/1、JSON 字段统一 TEXT
    CREATE TABLE IF NOT EXISTS novel_pack_characters (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '主角',
      avatar TEXT,
      is_protagonist INTEGER NOT NULL DEFAULT 1,
      -- 绑定 EntityPanel 实体（novel_entities.id）：缺失会导致境界同步静默失效（§9.7.5）
      entity_id TEXT,
      -- 未绑定实体时的「仅行囊内使用」境界（JSON {levelId, sub}）；绑定时以 novel_links 为准
      realm_at TEXT,
      note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS novel_pack_attributes (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '基础属性',
      name TEXT NOT NULL,
      base_value REAL NOT NULL DEFAULT 0,
      decimals INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_attr_char ON novel_pack_attributes(character_id, sort_order);
    CREATE TABLE IF NOT EXISTS novel_pack_slots (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1,
      -- 仅接受物品类型（多选）；空数组 = 不限
      accepts TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_slot_char ON novel_pack_slots(character_id, sort_order);
    CREATE TABLE IF NOT EXISTS novel_pack_items (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'misc',
      qty INTEGER NOT NULL DEFAULT 1,
      rarity TEXT NOT NULL DEFAULT 'common',
      icon TEXT NOT NULL DEFAULT '',
      desc TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      -- 穿戴位置：equipped_slot_id 非空即视为佩戴；slot_index 为部位内第几个槽位
      equipped_slot_id TEXT,
      slot_index INTEGER,
      source_chapter_id TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pack_item_char ON novel_pack_items(character_id);
    CREATE TABLE IF NOT EXISTS novel_pack_skills (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      desc TEXT NOT NULL DEFAULT '',
      -- 载体开关（技能级总开关）：停用则全部效果（被动+持续）不参与汇总
      enabled INTEGER NOT NULL DEFAULT 1,
      proficiency_raw REAL NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_skill_char ON novel_pack_skills(character_id, sort_order);
    CREATE TABLE IF NOT EXISTS novel_pack_modifiers (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL CHECK (owner_type IN ('item', 'skill', 'status')),
      owner_id TEXT NOT NULL,
      -- 效果性质（§9.2.1）：passive 被动 / sustained 持续 / cast 释放
      nature TEXT NOT NULL DEFAULT 'passive' CHECK (nature IN ('passive', 'sustained', 'cast')),
      name TEXT NOT NULL DEFAULT '',
      -- 可空：cast 型不指向任何属性
      target_attr_id TEXT,
      op TEXT NOT NULL DEFAULT 'add' CHECK (op IN ('add', 'percent', 'mul', 'override')),
      value REAL NOT NULL DEFAULT 0,
      value_unit TEXT,
      scale_by_proficiency INTEGER NOT NULL DEFAULT 0,
      -- 仅 sustained：效果自己的独立开关（与载体开关分离）
      active INTEGER NOT NULL DEFAULT 0,
      default_on INTEGER NOT NULL DEFAULT 0,
      cost TEXT,
      cooldown REAL,
      duration TEXT,
      target TEXT,
      trigger TEXT,
      condition TEXT,
      note TEXT NOT NULL DEFAULT '',
      disabled INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_mod_owner ON novel_pack_modifiers(owner_type, owner_id);
    CREATE TABLE IF NOT EXISTS novel_pack_unit_systems (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('ladder', 'ratio', 'threshold')),
      levels TEXT NOT NULL DEFAULT '[]',
      config TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_unit_char ON novel_pack_unit_systems(character_id, kind);
    -- 模块拼装：只承载「这本小说要哪些模块、什么顺序」这类设定数据。
    -- 折叠状态 / 面板宽度 / 列表视图属于界面偏好，走 config 的 novel_pack_ui
    -- （判据：改了这个值别人的这本书会变吗？不会 → 即改即存，不进本表）
    CREATE TABLE IF NOT EXISTS novel_pack_layouts (
      character_id TEXT NOT NULL,
      module_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (character_id, module_key)
    );
    CREATE TABLE IF NOT EXISTS novel_pack_records (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      chapter_id TEXT,
      taken_at INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pack_records_char
      ON novel_pack_records(character_id, taken_at DESC);
    -- 草稿（§8.6）：payload 与正式表同构，提交成功后清空
    CREATE TABLE IF NOT EXISTS novel_pack_drafts (
      character_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      dirty_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `)

  // ── 增量迁移：novel_levels 补「小层」与「战力当量」（PRD §9.7.2 缺口①②）
  // 两项必须同一次 migration 做完，避免二次表重建
  const levelColumns = database.prepare("PRAGMA table_info(novel_levels)").all() as Array<{
    name: string
  }>
  if (!levelColumns.some((column) => column.name === "sub_levels")) {
    database.exec("ALTER TABLE novel_levels ADD COLUMN sub_levels INTEGER NOT NULL DEFAULT 1")
  }
  if (!levelColumns.some((column) => column.name === "power")) {
    database.exec("ALTER TABLE novel_levels ADD COLUMN power REAL")
  }
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
}

export function getAuthDb(): Database.Database {
  return authDb ?? initDb()
}

/** 获取当前登录用户 email（未登录时为空串） */
export function getCurrentUserEmail(): string {
  return currentEmail
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
