/**
 * 小说域本地数据库（novel.db）
 *
 * novel 窗口与行囊窗口的**全部**持久化数据都在本库，与 checkin.db 完全分离：
 *
 *   user-data/{email-hash}/
 *   ├─ checkin.db   todo / memo / ledger / checkin / activities / config
 *   └─ novel.db     novel_* 业务表 + novel_pack_* 行囊表 + novel_config + novel_usage_log
 *
 * 分离的三个理由：
 * 1. **体积**：正文与快照是量级最大的数据（快照是正文的整份拷贝），把它们从
 *    每日高频读写的 checkin.db 里摘出去，待办 / 日程的读写不再被正文库体积拖累；
 * 2. **备份**：novel.db 可单独拷贝 / 恢复（一部书的迁移不该带上账本和待办）；
 * 3. **边界**：novel 域的 schema 演进不再触碰 checkin 的表结构，两个模块彻底解耦。
 *
 * ⚠️ 本库是 1.33.0 按 §6.7 `refactor` 口径**从零重设**的结果：
 * checkin.db 里历史遗留的 novel_* / novel_pack_* / usage_log 表**不再被读取**
 * （建表语句已从 db.ts 移除），也没有任何运行时迁移 / 兼容层。老数据需要
 * 重建时走「导入书籍」入口，而不是写一段「新旧都能读」的适配代码。
 *
 * 边界：SQL 只出现在本文件与 handlers/novel-*.ts；不导入 main.ts。
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getCurrentUserEmail, getUserDataDir, registerUserDbLifecycle } from "./db";

let novelDb: Database.Database | null = null;

/**
 * 编辑器会话标记键（崩溃恢复）：running = 会话进行中；非 running = 上次正常关闭。
 *
 * 与业务表同库是刻意的 —— 会话标记必须与「它守护的那批正文」同生共死，
 * 放在 checkin.db 里会出现「换了用户库但标记还在」的错配。
 */
export const NOVEL_SESSION_KEY = "novel_editor_session";

export function getNovelDbPath(email: string): string {
  return path.join(getUserDataDir(email), "novel.db");
}

/**
 * novel.db 的初始 schema（一次性建库）。
 *
 * 历史增量迁移（`ALTER TABLE` 补列）在这里**直接写进 CREATE TABLE**：本库从零
 * 建立，没有需要就地升级的老库；将来加列仍按 §6.5 走增量迁移。
 *
 * 时间戳统一毫秒整数（渲染层 `Date.now()` 口径）；JSON 字段统一 TEXT。
 */
function initializeNovelDb(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.exec(`
    -- ── 领域设置（替代 checkin.db 的 config 的 novel_* 键）──
    CREATE TABLE IF NOT EXISTS novel_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- ── 埋点（R14 北极星漏斗：editor_open / chapter_save / snapshot / book_import）──
    CREATE TABLE IF NOT EXISTS novel_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_novel_usage_event ON novel_usage_log(event, created_at);

    -- ── 作品 / 卷 / 章 / 快照 ──
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
    CREATE INDEX IF NOT EXISTS idx_novel_volumes_work ON novel_volumes(work_id, sort);
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

    -- ── 灵感速记 / 伏笔（大纲条目）──
    -- 灵感 work_id = '' 表示「未归属的全局池」，是合法值（novel-note-move 的目标）
    CREATE TABLE IF NOT EXISTS novel_notes (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      foreshadow_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_novel_notes_work ON novel_notes(work_id);
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
    CREATE INDEX IF NOT EXISTS idx_novel_outline_work ON novel_outline_entries(work_id);

    -- ── 要素库（实体 + 多态关联）──
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
    CREATE INDEX IF NOT EXISTS idx_novel_entities_work ON novel_entities(work_id, sort);
    -- 多态关联：from/to 各自带 type，可指向要素 / 等级项 / 章节
    CREATE TABLE IF NOT EXISTS novel_links (
      id TEXT PRIMARY KEY,
      from_type TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_type TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_novel_links_from ON novel_links(from_type, from_id);
    CREATE INDEX IF NOT EXISTS idx_novel_links_to ON novel_links(to_type, to_id);

    -- ── 等级体系（R25）──
    CREATE TABLE IF NOT EXISTS novel_level_systems (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_novel_level_systems_work ON novel_level_systems(work_id);
    CREATE TABLE IF NOT EXISTS novel_levels (
      id TEXT PRIMARY KEY,
      system_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rank INTEGER NOT NULL,
      note TEXT,
      -- 小层数与战力当量（PRD §9.7.2）：行囊境界换算依赖这两列
      sub_levels INTEGER NOT NULL DEFAULT 1,
      power REAL
    );
    CREATE INDEX IF NOT EXISTS idx_novel_levels_system ON novel_levels(system_id, rank);
    CREATE TABLE IF NOT EXISTS novel_level_conversions (
      id TEXT PRIMARY KEY,
      from_level_id TEXT NOT NULL,
      to_level_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      note TEXT
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
      -- 负重上限（REQ-033）：0 = 不限
      weight_limit REAL NOT NULL DEFAULT 0,
      -- 格数上限（F-5）：0 = 不限
      capacity_limit INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_char_work ON novel_pack_characters(work_id, sort_order);
    CREATE TABLE IF NOT EXISTS novel_pack_attributes (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '基础属性',
      name TEXT NOT NULL,
      base_value REAL NOT NULL DEFAULT 0,
      decimals INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 1,
      -- 最近一次改动的落点时刻（REQ-028 本章变动角标）；0 = 不算变动
      updated_at INTEGER NOT NULL DEFAULT 0
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
      -- 单件重量（REQ-033）：0 = 没记。总重按 weight × qty 累计
      weight REAL NOT NULL DEFAULT 0,
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
      sort_order INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT 0
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
      -- 剩余回合数（REQ-025 状态效果时效）：NULL = 不限时。到 0 即视为已过期
      rounds_left INTEGER,
      target TEXT,
      trigger TEXT,
      condition TEXT,
      note TEXT NOT NULL DEFAULT '',
      disabled INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_mod_owner ON novel_pack_modifiers(owner_type, owner_id);
    -- 换装方案（REQ-032）：payload 只存「谁穿在哪个部位的哪一格」，不存物品本身
    CREATE TABLE IF NOT EXISTS novel_pack_presets (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pack_preset_char ON novel_pack_presets(character_id, sort_order);
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
    -- 折叠状态 / 面板宽度 / 列表视图属于界面偏好，走 novel_config 的 novel_pack_ui
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
  `);
}

/** 打开（或切换到）当前用户的 novel.db */
export function switchNovelDb(email: string): void {
  if (novelDb) {
    novelDb.close();
    novelDb = null;
  }
  const dbPath = getNovelDbPath(email);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  novelDb = new Database(dbPath);
  initializeNovelDb(novelDb);
  console.log(`[novel-db] 已就绪: ${dbPath}`);
}

/** 获取 novel.db 实例（用户库未初始化时抛错） */
export function getNovelDb(): Database.Database {
  if (!novelDb) throw new Error("尚未初始化 novel 数据");
  return novelDb;
}

/** novel.db 是否已就绪（供「未登录 / 未切换用户」时静默跳过） */
export function isNovelDbReady(): boolean {
  return novelDb !== null;
}

/**
 * 把 novel.db 挂到用户库生命周期上。
 *
 * 必须在 `switchUserDb` 之前或之后都能生效：注册时若已有当前用户，立即补一次
 * 打开（启动流程是 `switchUserDb` 在前、`registerNovelHandlers` 在后）。
 */
export function registerNovelDbBridge(): void {
  registerUserDbLifecycle({
    onSwitched: switchNovelDb,
    onClosed: closeNovelDb,
  });
  const email = getCurrentUserEmail();
  if (email) switchNovelDb(email);
}

/** 关闭 novel.db */
export function closeNovelDb(): void {
  if (!novelDb) return;
  novelDb.close();
  novelDb = null;
  console.log("[novel-db] 已关闭");
}

// ── CRUD 封装（与 db.ts 同签名，便于 handlers 平移）──

export function novelAll(sql: string, params: unknown[] = []): unknown[] {
  return getNovelDb().prepare(sql).all(...params);
}

export function novelGet(sql: string, params: unknown[] = []): unknown {
  return getNovelDb().prepare(sql).get(...params);
}

export function novelRun(
  sql: string,
  params: unknown[] = [],
): { changes: number; lastInsertRowid: number } {
  const result = getNovelDb().prepare(sql).run(...params);
  return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
}

export function novelExec(sql: string): void {
  getNovelDb().exec(sql);
}
