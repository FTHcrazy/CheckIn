/**
 * 小说设定域的**共享内核**（本书域 / 全局域共用）
 *
 * 全局设定中心（D1）把「设定」拆成两个数据域：
 * - **本书域**：`novel_setting_categories` / `novel_setting_levels`（带 work_id）；
 * - **全局域**：`novel_global_setting_categories` / `novel_global_setting_levels`（无 work_id）。
 *
 * 两域的列名、约束、rank 语义**完全一致**，只有作用域列不同。所以这里集中放：
 * - 域无关的取值校验与清洗（`isCarryDir` / `isSettingKind` / `normalizeAliases` / `normalizeSubPattern`）；
 * - **rank 三件套**（`maxRank` / `levelCount` / `rankAt`）与 `maxSortOrder` —— 按域取表，
 *   两个域共用同一套口径（H4：行数用 `COUNT(*)`、末尾落点 `maxRank + 1`、中间落点 `rankAt`）；
 * - 导入导出快照的组装（`readSnapshots` / `parseSnapshot` / `assembleSnapshots`）；
 * - **引用模型**（D2/D3/D4）：建立引用、实时同步、上架、固化、引用计数、只读守卫。
 *
 * 为什么单独成文件而不是塞进任一 handler：本书域 handler（`novel-setting-handlers.ts`）
 * 与全局域 handler（`novel-global-setting-handlers.ts`）**互相不能 import**（会成环），
 * 而引用模型横跨两个域（一本书引用一个全局分类 ⇒ 同时读写本书表与全局表）。
 * 把跨域逻辑下沉到这里，两个 handler 都只依赖本文件，依赖图保持单向无环。
 *
 * 边界：SQL 只出现在本文件、`novel-db.ts` 与 `handlers/novel-*.ts`；本文件不 import `../db`。
 * 主进程不 import `src/`（构建分离），两端各自保留纯函数实现是既有惯例。
 */
import {
  novelAll as dbAll,
  novelGet as dbGet,
  novelRun as dbRun,
  getNovelDb as getDb,
} from "../novel-db";
import { DEFAULT_CATEGORY_COLOR, DEFAULT_SUB_PATTERN } from "./novel-handlers";

// ── 域 ──────────────────────────────────────────────────────────────

/** 设定数据域：本书（带 work_id）/ 全局（跨书共享） */
export type SettingDomain = "book" | "global";

// ── 行类型（snake_case，对应表结构） ─────────────────────────────────

/**
 * 设定分类行。本书域有 `work_id` / `source_global_id` / `detached_from_name` 三列；
 * 全局域没有 `work_id`，且全局行本身永不「被引用」，故三个可选列读全局时都是 undefined。
 */
export interface SettingCategoryRow {
  id: string;
  name: string;
  color: string;
  kind: string;
  sort_order: number;
  note: string;
  sub_levels: number;
  carry_dir: string;
  sub_pattern: string;
  /** 本书域专属：所属作品 */
  work_id?: string;
  /** 本书域专属：非空 = 本分类镜像自某个全局分类（引用只读的判据） */
  source_global_id?: string | null;
  /** 本书域专属：非空 = 原全局项已删除，已就地固化为本书副本（D4 徽标文案） */
  detached_from_name?: string | null;
}

/** 设定等级行。`source_global_id` 仅本书域镜像行有值（指向全局等级行） */
export interface SettingLevelRow {
  id: string;
  category_id: string;
  name: string;
  rank: number;
  aliases: string;
  note: string;
  sub_levels: number;
  power: number | null;
  parent_id: string | null;
  seg_from: number | null;
  seg_to: number | null;
  sub_pattern: string;
  /** 仅本书域镜像行：非空 = 指向 `novel_global_setting_levels.id` */
  source_global_id?: string | null;
}

// ── 取值校验 / 清洗（两域共用） ──────────────────────────────────────

export function isCarryDir(value: unknown): value is "asc" | "desc" {
  return value === "asc" || value === "desc";
}

export function isSettingKind(value: unknown): value is "realm" | "custom" {
  return value === "realm" || value === "custom";
}

/** 别名数组落库前统一清洗：去空白、去重、去空串 */
export function normalizeAliases(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/** 小层命名模板清洗：去空白、截断到 60 字（模板是短句，超长必是误粘） */
export function normalizeSubPattern(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, 60);
}

/** 行 ID：与渲染层 `createNovelId` 同构（分类 sc/gsc、等级 sl/gsl，避免前缀冲突） */
export function createSettingId(prefix: "sc" | "sl" | "gsc" | "gsl"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── rank / sort_order 三件套（两个域同一口径，H4） ───────────────────

/**
 * 取分类内当前最大 rank（没有等级项时为 0）。
 *
 * ⚠️ 仅用于「追加到末尾」的落点，**不能**当行数用（见 `levelCount`）。
 */
export function maxRank(domain: SettingDomain, categoryId: string): number {
  const sql =
    domain === "book"
      ? "SELECT COALESCE(MAX(rank), 0) AS max FROM novel_setting_levels WHERE category_id = ?"
      : "SELECT COALESCE(MAX(rank), 0) AS max FROM novel_global_setting_levels WHERE category_id = ?";
  const row = dbGet(sql, [categoryId]) as { max: number };
  return row.max;
}

/**
 * 取分类内当前的等级行数（不是 max(rank)）。
 *
 * 删除 / 拆分 / 旧数据裁剪都会让 rank 出现空洞，此时 `max(rank) > count`；
 * 拿 max 当行数会让「在末尾插入」算出越界落点（1.38.0 修）。
 */
export function levelCount(domain: SettingDomain, categoryId: string): number {
  const sql =
    domain === "book"
      ? "SELECT COUNT(*) AS n FROM novel_setting_levels WHERE category_id = ?"
      : "SELECT COUNT(*) AS n FROM novel_global_setting_levels WHERE category_id = ?";
  const row = dbGet(sql, [categoryId]) as { n: number };
  return row.n;
}

/** 按行序取第 index 行的 rank；index >= 行数时返回 max(rank) + 1（即末尾之后） */
export function rankAt(domain: SettingDomain, categoryId: string, index: number): number {
  const sql =
    domain === "book"
      ? "SELECT rank FROM novel_setting_levels WHERE category_id = ? ORDER BY rank LIMIT 1 OFFSET ?"
      : "SELECT rank FROM novel_global_setting_levels WHERE category_id = ? ORDER BY rank LIMIT 1 OFFSET ?";
  const rows = dbAll(sql, [categoryId, Math.max(0, index)]) as Array<{ rank: number }>;
  if (rows.length > 0) return rows[0].rank;
  return maxRank(domain, categoryId) + 1;
}

/**
 * 取分类当前最大 sort_order（没有分类时为 0）。
 *
 * `scopeId`：本书域传 workId（按作品收口）；全局域忽略（全局本无作用域），
 * 仍写**字面量 WHERE** 满足「不裸查整表」的可读性约束。
 */
export function maxSortOrder(domain: SettingDomain, scopeId: string): number {
  if (domain === "book") {
    const row = dbGet(
      "SELECT COALESCE(MAX(sort_order), 0) AS max FROM novel_setting_categories WHERE work_id = ?",
      [scopeId],
    ) as { max: number };
    return row.max;
  }
  const row = dbGet(
    "SELECT COALESCE(MAX(sort_order), 0) AS max FROM novel_global_setting_categories WHERE id IS NOT NULL",
  ) as { max: number };
  return row.max;
}

// ── 导入导出快照 ────────────────────────────────────────────────────

/** 导入导出用的分类快照（与 DTO 同构，去掉 id / workId 以便跨作品 / 跨域搬运） */
export interface SettingCategorySnapshot {
  name: string;
  color: string;
  kind: "realm" | "custom";
  sortOrder: number;
  note: string;
  subLevels: number;
  carryDir: "asc" | "desc";
  subPattern: string;
  levels: Array<{
    name: string;
    rank: number;
    aliases: string[];
    note: string;
    subLevels: number;
    power: number | null;
    /** 本阶专属小层命名模板；空串 = 沿用分类。旧版快照缺省按空串处理 */
    subPattern: string;
  }>;
}

/** 导入导出的文件载荷 */
export interface SettingExportPayload {
  version: 1;
  exportedAt: string;
  categories: SettingCategorySnapshot[];
}

/**
 * 把「外部传入的分类快照」解析成可落库的形式。
 *
 * 返回 `null` 表示这份快照不可用（连名字都没有）——导入时静默跳过它，
 * 而不是整批失败：一份文件里有一条脏数据不该让作者白选一次文件。
 */
export function parseSnapshot(input: unknown): SettingCategorySnapshot | null {
  if (input === null || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const levels: SettingCategorySnapshot["levels"] = [];
  if (Array.isArray(raw.levels)) {
    for (const item of raw.levels) {
      if (item === null || typeof item !== "object") continue;
      const level = item as Record<string, unknown>;
      const levelName = typeof level.name === "string" ? level.name.trim() : "";
      if (!levelName) continue;
      levels.push({
        name: levelName,
        rank:
          typeof level.rank === "number" && Number.isFinite(level.rank)
            ? level.rank
            : levels.length + 1,
        aliases: normalizeAliases(level.aliases),
        note: typeof level.note === "string" ? level.note : "",
        subLevels:
          typeof level.subLevels === "number" && level.subLevels >= 1
            ? Math.floor(level.subLevels)
            : 1,
        power:
          typeof level.power === "number" && Number.isFinite(level.power)
            ? level.power
            : null,
        subPattern: normalizeSubPattern(level.subPattern),
      });
    }
  }
  // rank 可能重复 / 缺失：按数组顺序重排，保证阶梯连续可读
  levels.forEach((level, index) => {
    level.rank = index + 1;
  });
  return {
    name,
    color: typeof raw.color === "string" && raw.color ? raw.color : DEFAULT_CATEGORY_COLOR,
    kind: isSettingKind(raw.kind) ? raw.kind : "custom",
    sortOrder: typeof raw.sortOrder === "number" ? raw.sortOrder : 0,
    note: typeof raw.note === "string" ? raw.note : "",
    subLevels:
      typeof raw.subLevels === "number" && raw.subLevels >= 1
        ? Math.floor(raw.subLevels)
        : 1,
    carryDir: isCarryDir(raw.carryDir) ? raw.carryDir : "asc",
    subPattern:
      typeof raw.subPattern === "string" && raw.subPattern
        ? raw.subPattern
        : DEFAULT_SUB_PATTERN,
    levels,
  };
}

/** 把「分类行 + 等级行」组装成快照（导出 / 存模板共用，两域共用） */
function assembleSnapshots(
  categories: SettingCategoryRow[],
  levels: Array<{
    category_id: string;
    name: string;
    rank: number;
    aliases: string;
    note: string;
    sub_levels: number;
    power: number | null;
    sub_pattern: string;
  }>,
): SettingCategorySnapshot[] {
  const byCategory = new Map<string, SettingCategorySnapshot["levels"]>();
  for (const level of levels) {
    const list = byCategory.get(level.category_id) ?? [];
    let aliases: string[] = [];
    try {
      const parsed: unknown = JSON.parse(level.aliases);
      if (Array.isArray(parsed)) {
        aliases = parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      aliases = [];
    }
    list.push({
      name: level.name,
      rank: level.rank,
      aliases,
      note: level.note ?? "",
      subLevels: level.sub_levels ?? 1,
      power: level.power,
      subPattern: level.sub_pattern ?? "",
    });
    byCategory.set(level.category_id, list);
  }

  return categories.map((category) => ({
    name: category.name,
    color: category.color,
    kind: isSettingKind(category.kind) ? category.kind : "custom",
    sortOrder: category.sort_order,
    note: category.note ?? "",
    subLevels: category.sub_levels ?? 1,
    carryDir: isCarryDir(category.carry_dir) ? category.carry_dir : "asc",
    subPattern: category.sub_pattern ?? DEFAULT_SUB_PATTERN,
    levels: byCategory.get(category.id) ?? [],
  }));
}

/**
 * 读出一个域的全部分类快照（导出 / 存模板共用）。
 *
 * - `categoryIds` 给了就只取这些 id（`IN (…)` 占位符由调用方数量决定，
 *   收口条件仍是**字面量 SQL**，不是拼接 WHERE）；
 * - 不给时：本书域按 `work_id` 收口，全局域按 `WHERE id IS NOT NULL`
 *   显式字面量收口（全局本无作用域，这条只是不裸查整表）。
 */
export function readSnapshots(
  domain: SettingDomain,
  scopeId: string,
  categoryIds?: string[],
): SettingCategorySnapshot[] {
  let categories: SettingCategoryRow[];
  if (categoryIds && categoryIds.length > 0) {
    const placeholders = categoryIds.map(() => "?").join(", ");
    const sql =
      domain === "book"
        ? `SELECT * FROM novel_setting_categories WHERE id IN (${placeholders}) ORDER BY sort_order`
        : `SELECT * FROM novel_global_setting_categories WHERE id IN (${placeholders}) ORDER BY sort_order`;
    categories = dbAll(sql, categoryIds) as SettingCategoryRow[];
  } else if (domain === "book") {
    categories = dbAll(
      "SELECT * FROM novel_setting_categories WHERE work_id = ? ORDER BY sort_order",
      [scopeId],
    ) as SettingCategoryRow[];
  } else {
    categories = dbAll(
      "SELECT * FROM novel_global_setting_categories WHERE id IS NOT NULL ORDER BY sort_order",
    ) as SettingCategoryRow[];
  }
  if (categories.length === 0) return [];

  const placeholders = categories.map(() => "?").join(", ");
  const sql =
    domain === "book"
      ? `SELECT * FROM novel_setting_levels
          WHERE category_id IN (${placeholders})
          ORDER BY category_id, rank`
      : `SELECT * FROM novel_global_setting_levels
          WHERE category_id IN (${placeholders})
          ORDER BY category_id, rank`;
  const levels = dbAll(
    sql,
    categories.map((category) => category.id),
  ) as Array<{
    category_id: string;
    name: string;
    rank: number;
    aliases: string;
    note: string;
    sub_levels: number;
    power: number | null;
    sub_pattern: string;
  }>;

  return assembleSnapshots(categories, levels);
}

// ── 引用项只读守卫（D2 权威边界，主进程强制） ───────────────────────

/**
 * 本书分类是否是「镜像自全局」的引用项。
 *
 * 引用项在本书侧**只读**：它的等级由全局同步独占改写，作者在本书侧的改名 /
 * 排序 / 拆分都会被下一次同步覆盖。UI 隐藏入口只是第二层，这里才是权威 ——
 * 绕过 UI（键盘 / 并发 / 脚本）也无效。
 */
export function isReferencedCategory(categoryId: string): boolean {
  const row = dbGet(
    "SELECT source_global_id AS sid FROM novel_setting_categories WHERE id = ?",
    [categoryId],
  ) as { sid: string | null } | undefined;
  return !!row && row.sid !== null;
}

/** 某等级行是否落在「引用分类」内（引用分类整条只读，等级自然也写不得） */
export function isLevelInReferencedCategory(levelId: string): boolean {
  const row = dbGet(
    `SELECT c.source_global_id AS sid
       FROM novel_setting_levels l
       JOIN novel_setting_categories c ON c.id = l.category_id
      WHERE l.id = ?`,
    [levelId],
  ) as { sid: string | null } | undefined;
  return !!row && row.sid !== null;
}

// ── 引用模型：计数 / 上架 / 建立引用 / 同步 / 固化 ───────────────────

/**
 * 单个全局分类的「N 部书引用」。
 *
 * 口径用 `COUNT(DISTINCT work_id)`：同一本书内若重复引用同一全局分类（不应发生，
 * 建立引用时按 source_global_id 幂等去重）也不会重复计数。**已脱离的书不计入**
 * （source_global_id 已置 NULL，U4）。
 */
export function countGlobalRefs(globalCategoryId: string): number {
  const row = dbGet(
    `SELECT COUNT(DISTINCT c.work_id) AS n
       FROM novel_setting_categories c
      WHERE c.source_global_id = ?`,
    [globalCategoryId],
  ) as { n: number };
  return row.n;
}

/** 列表页一次性批量取引用计数（避免 N+1；一次分组统计） */
export function countGlobalRefsBatch(): Map<string, number> {
  const rows = dbAll(
    `SELECT c.source_global_id AS gid, COUNT(DISTINCT c.work_id) AS n
       FROM novel_setting_categories c
      WHERE c.source_global_id IS NOT NULL
      GROUP BY c.source_global_id`,
  ) as Array<{ gid: string; n: number }>;
  return new Map(rows.map((row) => [row.gid, row.n]));
}

/** D3 上架的返回载荷 */
export interface PublishToGlobalResult {
  ok: boolean;
  globalCategoryId?: string;
  /** 命中同名全局分类：渲染层据此弹「新建副本 / 取消」 */
  conflict?: boolean;
}

/**
 * 建立引用（D2）：把全局分类 C「镜像」成本书分类 Bc + 全部等级镜像行。
 *
 * 单事务。镜像行 id 恒定、`source_global_id` 是对外身份 —— 这是「实时同步不丢
 * novel_links」的全部依据（H2）。已引用（同 workId + 同 source_global_id）幂等返回 true。
 */
export function referenceGlobal(workId: string, globalCategoryId: string): boolean {
  if (!workId || !globalCategoryId) return false;
  const globalCategory = dbGet(
    "SELECT * FROM novel_global_setting_categories WHERE id = ?",
    [globalCategoryId],
  ) as SettingCategoryRow | undefined;
  if (!globalCategory) return false;

  const existing = dbGet(
    "SELECT id FROM novel_setting_categories WHERE work_id = ? AND source_global_id = ?",
    [workId, globalCategoryId],
  ) as { id: string } | undefined;
  if (existing) return true; // 已引用：幂等成功，不重复建镜像

  const levels = dbAll(
    "SELECT * FROM novel_global_setting_levels WHERE category_id = ? ORDER BY rank",
    [globalCategoryId],
  ) as SettingLevelRow[];

  const db = getDb();
  const apply = db.transaction(() => {
    const hasRealm =
      (dbGet(
        "SELECT COUNT(*) AS count FROM novel_setting_categories WHERE work_id = ? AND kind = 'realm'",
        [workId],
      ) as { count: number }).count > 0;
    // U6：全局 realm 引入本书时，若本书已有 realm 则降级 custom，保住「每书至多一个 realm」
    const kind: "realm" | "custom" =
      globalCategory.kind === "realm" && !hasRealm ? "realm" : "custom";
    const categoryId = createSettingId("sc");
    dbRun(
      `INSERT INTO novel_setting_categories
         (id, work_id, name, color, kind, sort_order, note, sub_levels, carry_dir,
          sub_pattern, source_global_id, detached_from_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        categoryId,
        workId,
        globalCategory.name,
        globalCategory.color,
        kind,
        maxSortOrder("book", workId) + 1,
        globalCategory.note ?? "",
        globalCategory.sub_levels ?? 1,
        globalCategory.carry_dir,
        globalCategory.sub_pattern,
        globalCategoryId,
      ],
    );
    // 两趟写入：先建全部镜像行，再回填 parent_id（全局的层级关系照着搬）
    const idMap = new Map<string, string>();
    for (const level of levels) {
      const levelId = createSettingId("sl");
      idMap.set(level.id, levelId);
      dbRun(
        `INSERT INTO novel_setting_levels
           (id, category_id, name, rank, aliases, note, sub_levels, power,
            parent_id, seg_from, seg_to, sub_pattern, source_global_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [
          levelId,
          categoryId,
          level.name,
          level.rank,
          level.aliases,
          level.note ?? "",
          level.sub_levels ?? 1,
          level.power,
          level.seg_from,
          level.seg_to,
          level.sub_pattern ?? "",
          level.id,
        ],
      );
    }
    for (const level of levels) {
      if (!level.parent_id) continue;
      const mappedParent = idMap.get(level.parent_id);
      const mappedSelf = idMap.get(level.id);
      if (!mappedParent || !mappedSelf) continue;
      dbRun("UPDATE novel_setting_levels SET parent_id = ? WHERE id = ?", [
        mappedParent,
        mappedSelf,
      ]);
    }
  });
  apply();
  return true;
}

/**
 * 上架（D3）：把本书的一个分类**复制一份快照**到全局库，本书保持不变。
 *
 * 同名冲突：`conflict==='cancel'` 返回 `{ok:false, conflict:true}` 交渲染层三选；
 * `'duplicate'` 新建「XXX（副本）」。realm 上架时若全局已有 realm，自动降级为 custom
 * （与全局 realm 部分唯一索引口径一致，见 novel-db）。
 */
export function publishGlobal(
  workId: string,
  categoryId: string,
  conflict: "duplicate" | "cancel",
): PublishToGlobalResult {
  if (!workId || !categoryId) return { ok: false };
  const book = dbGet(
    "SELECT * FROM novel_setting_categories WHERE id = ? AND work_id = ?",
    [categoryId, workId],
  ) as SettingCategoryRow | undefined;
  if (!book) return { ok: false };

  const sameName = dbGet(
    "SELECT id FROM novel_global_setting_categories WHERE name = ?",
    [book.name],
  ) as { id: string } | undefined;
  if (sameName && conflict === "cancel") return { ok: false, conflict: true };

  const name = sameName ? `${book.name}（副本）` : book.name;
  const levels = dbAll(
    "SELECT * FROM novel_setting_levels WHERE category_id = ? ORDER BY rank",
    [categoryId],
  ) as SettingLevelRow[];

  const db = getDb();
  const apply = db.transaction(() => {
    const hasRealm =
      (dbGet(
        "SELECT COUNT(*) AS count FROM novel_global_setting_categories WHERE kind = 'realm'",
      ) as { count: number }).count > 0;
    const kind: "realm" | "custom" =
      book.kind === "realm" && !hasRealm ? "realm" : "custom";
    const globalId = createSettingId("gsc");
    dbRun(
      `INSERT INTO novel_global_setting_categories
         (id, name, color, kind, sort_order, note, sub_levels, carry_dir, sub_pattern)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        globalId,
        name,
        book.color,
        kind,
        maxSortOrder("global", "") + 1,
        book.note ?? "",
        book.sub_levels ?? 1,
        book.carry_dir,
        book.sub_pattern,
      ],
    );
    const idMap = new Map<string, string>();
    for (const level of levels) {
      const levelId = createSettingId("gsl");
      idMap.set(level.id, levelId);
      dbRun(
        `INSERT INTO novel_global_setting_levels
           (id, category_id, name, rank, aliases, note, sub_levels, power,
            parent_id, seg_from, seg_to, sub_pattern)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          levelId,
          globalId,
          level.name,
          level.rank,
          level.aliases,
          level.note ?? "",
          level.sub_levels ?? 1,
          level.power,
          level.seg_from,
          level.seg_to,
          level.sub_pattern ?? "",
        ],
      );
    }
    for (const level of levels) {
      if (!level.parent_id) continue;
      const mappedParent = idMap.get(level.parent_id);
      const mappedSelf = idMap.get(level.id);
      if (!mappedParent || !mappedSelf) continue;
      dbRun("UPDATE novel_setting_levels SET parent_id = ? WHERE id = ?", [
        mappedParent,
        mappedSelf,
      ]);
    }
    return globalId;
  });
  const globalCategoryId = apply();
  return { ok: true, globalCategoryId };
}

/**
 * 实时同步（§3.3.2）：全局分类被改后，把它所有本书镜像**按 source_global_id upsert**。
 *
 * - 分类可变字段同步（name / color / note / sub_levels / carry_dir / sub_pattern）——
 *   刻意**不**同步 kind（kind 在建立引用时按「每书至多一个 realm」定下，不随后续摆动）；
 * - 每个全局等级：命中同 source_global_id 的镜像 ⇒ UPDATE；未命中 ⇒ INSERT 新镜像；
 * - 全局已删的镜像行 ⇒ 先摘指向它的 `novel_links`，再删行；
 * - **全程镜像行 id 不变**（H2 不变量）⇒ 角色卡「当前境界」永不悬空。
 *
 * 单事务；无引用方时直接返回（不动任何表）。
 */
export function syncReferences(globalCategoryId: string): void {
  const mirrors = dbAll(
    "SELECT id FROM novel_setting_categories WHERE source_global_id = ?",
    [globalCategoryId],
  ) as Array<{ id: string }>;
  if (mirrors.length === 0) return;

  const globalCategory = dbGet(
    "SELECT * FROM novel_global_setting_categories WHERE id = ?",
    [globalCategoryId],
  ) as SettingCategoryRow | undefined;
  if (!globalCategory) return;

  const globalLevels = dbAll(
    "SELECT * FROM novel_global_setting_levels WHERE category_id = ? ORDER BY rank",
    [globalCategoryId],
  ) as SettingLevelRow[];

  const db = getDb();
  const apply = db.transaction(() => {
    for (const mirror of mirrors) {
      dbRun(
        `UPDATE novel_setting_categories
            SET name = ?, color = ?, note = ?, sub_levels = ?, carry_dir = ?, sub_pattern = ?
          WHERE id = ?`,
        [
          globalCategory.name,
          globalCategory.color,
          globalCategory.note ?? "",
          globalCategory.sub_levels ?? 1,
          globalCategory.carry_dir,
          globalCategory.sub_pattern,
          mirror.id,
        ],
      );

      const rows = dbAll(
        "SELECT id, source_global_id FROM novel_setting_levels WHERE category_id = ?",
        [mirror.id],
      ) as Array<{ id: string; source_global_id: string | null }>;
      const bySource = new Map<string, string>();
      for (const row of rows) {
        if (row.source_global_id) bySource.set(row.source_global_id, row.id);
      }

      const keep = new Set<string>();
      const idMap = new Map<string, string>();
      for (const level of globalLevels) {
        keep.add(level.id);
        const existingId = bySource.get(level.id);
        if (existingId) {
          idMap.set(level.id, existingId);
          dbRun(
            `UPDATE novel_setting_levels
                SET name = ?, rank = ?, aliases = ?, note = ?, sub_levels = ?, power = ?,
                    seg_from = ?, seg_to = ?, sub_pattern = ?
              WHERE id = ?`,
            [
              level.name,
              level.rank,
              level.aliases,
              level.note ?? "",
              level.sub_levels ?? 1,
              level.power,
              level.seg_from,
              level.seg_to,
              level.sub_pattern ?? "",
              existingId,
            ],
          );
        } else {
          const newId = createSettingId("sl");
          idMap.set(level.id, newId);
          dbRun(
            `INSERT INTO novel_setting_levels
               (id, category_id, name, rank, aliases, note, sub_levels, power,
                parent_id, seg_from, seg_to, sub_pattern, source_global_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
            [
              newId,
              mirror.id,
              level.name,
              level.rank,
              level.aliases,
              level.note ?? "",
              level.sub_levels ?? 1,
              level.power,
              level.seg_from,
              level.seg_to,
              level.sub_pattern ?? "",
              level.id,
            ],
          );
        }
      }

      // 第二趟：回填 parent_id（新行也能挂上正确的父）
      for (const level of globalLevels) {
        const targetId = idMap.get(level.id);
        if (!targetId) continue;
        const parentId = level.parent_id ? idMap.get(level.parent_id) ?? null : null;
        dbRun("UPDATE novel_setting_levels SET parent_id = ? WHERE id = ?", [
          parentId,
          targetId,
        ]);
      }

      // 全局已无的镜像行：先摘 novel_links，再删行（顺序反了会留悬空引用）
      for (const row of rows) {
        if (!row.source_global_id || keep.has(row.source_global_id)) continue;
        dbRun("DELETE FROM novel_links WHERE to_type = 'level' AND to_id = ?", [row.id]);
        dbRun("DELETE FROM novel_setting_levels WHERE id = ?", [row.id]);
      }
    }
  });
  apply();
}

/**
 * 固化（D4）：全局分类被删除前，把它所有本书镜像**就地固化为本书副本**。
 *
 * 只把 `source_global_id` 置 NULL（分类 + 全部镜像行）并写 `detached_from_name`，
 * 行内容原样保留；`novel_links` **完全不动**（id 未变 ⇒ 作者已有的「当前境界」不失效）。
 * 固化后该分类自动获得全部写权限（只读守卫按 source_global_id 判定，天然放行）。
 *
 * 返回被固化的本书分类数（引用计数）。
 */
export function solidifyReferencesForCategory(
  globalCategoryId: string,
  globalName: string,
): number {
  const mirrors = dbAll(
    "SELECT id FROM novel_setting_categories WHERE source_global_id = ?",
    [globalCategoryId],
  ) as Array<{ id: string }>;
  if (mirrors.length === 0) return 0;

  const db = getDb();
  const apply = db.transaction(() => {
    for (const mirror of mirrors) {
      dbRun("UPDATE novel_setting_levels SET source_global_id = NULL WHERE category_id = ?", [
        mirror.id,
      ]);
      dbRun(
        `UPDATE novel_setting_categories
            SET source_global_id = NULL, detached_from_name = ?
          WHERE id = ?`,
        [globalName, mirror.id],
      );
    }
  });
  apply();
  return mirrors.length;
}
