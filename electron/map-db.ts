/**
 * 地图域本地数据库（map.db）
 *
 *   user-data/{email-hash}/
 *   ├─ checkin.db   todo / memo / ledger / checkin / activities / config
 *   ├─ novel.db     novel_* 业务表 + 行囊 + 领域设置
 *   └─ map.db       map_docs / map_revisions / map_assets / map_config   ← 本文件
 *
 * 为什么再开一本库，而不是并进 novel.db（三条硬理由，与 novel.db 拆库同源）：
 * 1. **体积**：地图文档是当前项目**单条记录最大**的一类数据（陆地多边形 + 数百区块
 *    + 数百素材 + 地名，序列化后 1~8 MB）。塞进 novel.db 会让「开章 / 存章」这种
 *    高频小写与地图整存共享 WAL 与页缓存，正文读写被明显拖慢。
 * 2. **生命周期**：map 窗口是独立窗口、即关即销；lite 版根本不打包它（见
 *    `edition.ts`）。独立库可以在地图窗口没打开时完全不加载，连接与内存成本为零。
 * 3. **演进边界**：地图 schema 仍在快速变化（区域层级 / 子图 / 要素 / 折线）。
 *    独立库允许「清库换代」，不牵连作品与正文（口径同 novel.db 1.33.0）。
 *
 * 与 novel.db 的关系：**平级、并列、互不 import**。唯一共用的是 `db.ts` 的
 * `registerUserDbLifecycle` 生命周期桥（与 novel-db 完全一致的接法）。
 *
 * 边界：SQL 只出现在本文件与 `handlers/map-handlers.ts`；不导入 main.ts。
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getCurrentUserEmail, getUserDataDir, registerUserDbLifecycle } from "./db";

let mapDb: Database.Database | null = null;

/** 地图库文件名（与 checkin.db / novel.db 同级） */
export const MAP_DB_FILE = "map.db";

/** 资源目录名（缩略图之外的底图 / 自定义符号本体，本体走文件系统不进库） */
export const MAP_ASSETS_DIR = "map-assets";

export function getMapDbPath(email: string): string {
  return path.join(getUserDataDir(email), MAP_DB_FILE);
}

/**
 * 某张地图的资源目录（`user-data/{hash}/map-assets/{docId}/`）。
 *
 * 【为什么资源不进库】底图与自定义符号是 PNG/JPG，一张就可能几 MB；存 BLOB 会让
 * 每次列表查询都拖着整包二进制。表里只留索引（`map_assets.file_path`），
 * 与项目既有「图片不进库」的取舍一致。
 */
export function getMapAssetsDir(docId: string): string {
  const email = getCurrentUserEmail();
  if (!email) throw new Error("尚未登录，无法定位地图资源目录");
  return path.join(getUserDataDir(email), MAP_ASSETS_DIR, docId);
}

/**
 * map.db 的初始 schema（一次性建齐）。
 *
 * 四张表一次到位（含首期**不启用**的 `map_assets`）：B2 接自定义素材时再补建表
 * 意味着要写第二遍迁移，而空表的成本是零。
 */
function initializeMapDb(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.exec(`
    -- ── 地图文档（一行 = 一张地图）──
    -- doc_json 整存：文档内部高度耦合（区块挂子图、素材挂区块、地名挂素材、
    -- 层级定义被生成与手画共用），拆表后每次编辑要跨 5 张表做事务，
    -- 而写入频率只有 800ms 一次 —— 收益远小于成本。真需要局部更新时
    -- 靠 rev 做「整存 + 差异不落库」。
    --
    -- work_id 可空 = 未绑定作品：地图是「世界容器」，不是「作品附件」。
    -- 不建外键（跨库无法约束）：绑定关系由应用层校验，见 map-handlers 的
    -- assertWorkBindable。
    CREATE TABLE IF NOT EXISTS map_docs (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      work_id        TEXT,
      doc_json       TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      rev            INTEGER NOT NULL DEFAULT 0,
      thumb          BLOB,
      last_viewport  TEXT,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      opened_at      INTEGER,
      deleted_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_map_docs_work  ON map_docs(work_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_map_docs_order ON map_docs(updated_at DESC);

    -- ── 历史版本（每 10 版留一档，只保留最近 N 份）──
    CREATE TABLE IF NOT EXISTS map_revisions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id     TEXT NOT NULL,
      rev        INTEGER NOT NULL,
      doc_json   TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_map_rev_doc ON map_revisions(doc_id, rev DESC);

    -- ── 资源索引（本体在文件系统：map-assets/{docId}/{assetId}.png）──
    CREATE TABLE IF NOT EXISTS map_assets (
      id         TEXT PRIMARY KEY,
      doc_id     TEXT,
      kind       TEXT NOT NULL,
      file_path  TEXT NOT NULL,
      width      INTEGER NOT NULL,
      height     INTEGER NOT NULL,
      meta_json  TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_map_assets_doc ON map_assets(doc_id, kind);

    -- ── 键值配置（上次打开的地图、面板折叠状态等）──
    CREATE TABLE IF NOT EXISTS map_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

/** 打开（或切换到）当前用户的 map.db */
export function switchMapDb(email: string): void {
  if (mapDb) {
    mapDb.close();
    mapDb = null;
  }
  const dbPath = getMapDbPath(email);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  mapDb = new Database(dbPath);
  initializeMapDb(mapDb);
  console.log(`[map-db] 已就绪: ${dbPath}`);
}

/** 获取 map.db 实例（用户库未初始化时抛错） */
export function getMapDb(): Database.Database {
  if (!mapDb) throw new Error("尚未初始化地图数据");
  return mapDb;
}

/** map.db 是否已就绪（未登录 / 未切用户时静默跳过） */
export function isMapDbReady(): boolean {
  return mapDb !== null;
}

/**
 * 把 map.db 挂到用户库生命周期上（切用户 / 登出 / 退出应用时同步开关）。
 *
 * 注册时若已有当前用户立即补开一次 —— 启动流程是 `switchUserDb` 在前、
 * `registerMapDbBridge` 在后，不补这一次，第一屏就会读到一个空连接。
 */
export function registerMapDbBridge(): void {
  registerUserDbLifecycle({
    onSwitched: switchMapDb,
    onClosed: closeMapDb,
  });
  const email = getCurrentUserEmail();
  if (email) switchMapDb(email);
}

/** 关闭 map.db */
export function closeMapDb(): void {
  if (!mapDb) return;
  mapDb.close();
  mapDb = null;
  console.log("[map-db] 已关闭");
}

// ── CRUD 封装（与 db.ts / novel-db.ts 同签名，便于 handler 平移）──

export function mapAll(sql: string, params: unknown[] = []): unknown[] {
  return getMapDb().prepare(sql).all(...params);
}

export function mapGet(sql: string, params: unknown[] = []): unknown {
  return getMapDb().prepare(sql).get(...params);
}

export function mapRun(
  sql: string,
  params: unknown[] = [],
): { changes: number; lastInsertRowid: number } {
  const result = getMapDb().prepare(sql).run(...params);
  return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
}

export function mapExec(sql: string): void {
  getMapDb().exec(sql);
}

/**
 * 事务包装（一次保存要写 `map_docs` + `map_revisions` 两张表）。
 *
 * 用 better-sqlite3 的同步事务：写一半崩掉会留下「rev 涨了但历史没留」的错位，
 * 而这张库没有 WAL 回放之外的修补手段。
 */
export function mapTransaction<T>(run: () => T): T {
  return getMapDb().transaction(run)();
}
