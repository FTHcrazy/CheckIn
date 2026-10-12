/**
 * 小说设定模块（Setting）语义化 IPC handlers
 *
 * 一部作品的**全部**等级序列统一在 `novel_setting_categories` / `novel_setting_levels`：
 * 境界体系只是 `kind='realm'` 的一个分类，功法等级 / 丹药稀有度 / 法宝品阶是
 * `kind='custom'` 的其它分类。1.36.0 重构把 R25 的 `novel_level_systems` /
 * `novel_levels` / `novel_level_conversions` 三张表收进了这里（§6.7 `refactor`）。
 *
 * 边界：SQL 只出现在本文件与 `novel-db.ts`；不导入 `main.ts`；
 * 写通道一律取 `novel-db.ts` 的 `novelRun` 等别名，不得 import `../db`。
 *
 * 与行囊的关系：`novel-pack-handlers` 只读 realm 分类投影出境界阶梯，本模块
 * 不感知行囊；两侧通过 `novel_setting_levels.id` 与 `novel_links.to_type='level'`
 * 保持引用一致即可。
 */
import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
  novelAll as dbAll,
  novelGet as dbGet,
  novelRun as dbRun,
  getNovelDb as getDb,
} from "../novel-db";
import { DEFAULT_CATEGORY_COLOR, DEFAULT_SUB_PATTERN } from "./novel-handlers";

// ── 行类型（snake_case，对应表结构） ──

interface SettingLevelRow {
  id: string;
  category_id: string;
  name: string;
  rank: number;
  sub_levels: number;
  parent_id: string | null;
  /** 本阶专属小层命名模板；空串 = 沿用分类 */
  sub_pattern: string;
}

interface SettingCategoryRow {
  id: string;
  name: string;
  color: string;
  kind: string;
  sort_order: number;
  note: string;
  sub_levels: number;
  carry_dir: string;
  sub_pattern: string;
}

interface SettingTemplateRow {
  id: string;
  name: string;
  payload: string;
  created_at: number;
}

// ── 渲染层传入的补丁类型 ──

interface CategoryPatch {
  name?: string;
  color?: string;
  note?: string;
  /** 进位规则 */
  subLevels?: number;
  carryDir?: "asc" | "desc";
  subPattern?: string;
  /** 切换分类种类：设为 realm 时同作品原境界体系降级为 custom（唯一落点约束，1.38.1） */
  kind?: "realm" | "custom";
}

interface LevelPatch {
  name?: string;
  aliases?: string[];
  note?: string;
  subLevels?: number;
  power?: number | null;
  /** 本阶专属小层命名模板；空串 = 沿用分类（1.37.0） */
  subPattern?: string;
}

/** 导入导出用的分类快照（与 DTO 同构，去掉 workId 以便跨作品搬运） */
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

interface SettingTemplateDto {
  id: string;
  name: string;
  createdAt: number;
  categories: SettingCategorySnapshot[];
}

// ── 工具 ──

/** 取分类内当前最大 rank（没有等级项时为 0） */
function maxRank(categoryId: string): number {
  const row = dbGet(
    "SELECT COALESCE(MAX(rank), 0) AS max FROM novel_setting_levels WHERE category_id = ?",
    [categoryId],
  ) as { max: number };
  return row.max;
}

/** 取作品内当前最大 sortOrder（没有分类时为 0） */
function maxSortOrder(workId: string): number {
  const row = dbGet(
    "SELECT COALESCE(MAX(sort_order), 0) AS max FROM novel_setting_categories WHERE work_id = ?",
    [workId],
  ) as { max: number };
  return row.max;
}

function isCarryDir(value: unknown): value is "asc" | "desc" {
  return value === "asc" || value === "desc";
}

function isSettingKind(value: unknown): value is "realm" | "custom" {
  return value === "realm" || value === "custom";
}

/** 别名数组落库前统一清洗：去空白、去重、去空串 */
function normalizeAliases(input: unknown): string[] {
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
function normalizeSubPattern(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, 60);
}

/**
 * 把「外部传入的分类快照」解析成可落库的形式。
 *
 * 返回值带 `null` 表示这份快照不可用（连名字都没有）——导入时静默跳过它，
 * 而不是整批失败：一份文件里有一条脏数据不该让作者白选一次文件。
 */
function parseSnapshot(input: unknown): SettingCategorySnapshot | null {
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
        rank: typeof level.rank === "number" && Number.isFinite(level.rank) ? level.rank : levels.length + 1,
        aliases: normalizeAliases(level.aliases),
        note: typeof level.note === "string" ? level.note : "",
        subLevels: typeof level.subLevels === "number" && level.subLevels >= 1
          ? Math.floor(level.subLevels)
          : 1,
        power: typeof level.power === "number" && Number.isFinite(level.power) ? level.power : null,
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
    subLevels: typeof raw.subLevels === "number" && raw.subLevels >= 1
      ? Math.floor(raw.subLevels)
      : 1,
    carryDir: isCarryDir(raw.carryDir) ? raw.carryDir : "asc",
    subPattern: typeof raw.subPattern === "string" && raw.subPattern
      ? raw.subPattern
      : DEFAULT_SUB_PATTERN,
    levels,
  };
}

/** 读出一个作品的全部分类快照（导出 / 存模板共用） */
function readSnapshots(workId: string, categoryIds?: string[]): SettingCategorySnapshot[] {
  // 两条 SQL 都把收口条件写成字面量：模板拼接的 WHERE 会绕过
  // novel-setting-guard 的「不裸查整表」源码断言
  const categories = categoryIds?.length
    ? (dbAll(
        `SELECT * FROM novel_setting_categories
          WHERE id IN (${categoryIds.map(() => "?").join(", ")})
          ORDER BY sort_order`,
        categoryIds,
      ) as SettingCategoryRow[])
    : (dbAll(
        "SELECT * FROM novel_setting_categories WHERE work_id = ? ORDER BY sort_order",
        [workId],
      ) as SettingCategoryRow[]);
  if (categories.length === 0) return [];

  const levels = dbAll(
    `SELECT * FROM novel_setting_levels
      WHERE category_id IN (${categories.map(() => "?").join(", ")})
      ORDER BY category_id, rank`,
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

/** 把一批快照追加到一个作品下；realm 唯一：作品已有境界体系时，进来的 realm 降级为 custom */
function appendSnapshots(
  workId: string,
  snapshots: SettingCategorySnapshot[],
): number {
  const hasRealm =
    (dbGet(
      "SELECT COUNT(*) AS count FROM novel_setting_categories WHERE work_id = ? AND kind = 'realm'",
      [workId],
    ) as { count: number }).count > 0;
  let sort = maxSortOrder(workId);
  let count = 0;
  for (const snapshot of snapshots) {
    sort += 1;
    const kind = snapshot.kind === "realm" && !hasRealm ? "realm" : "custom";
    const categoryId = randomUUID();
    dbRun(
      `INSERT INTO novel_setting_categories
         (id, work_id, name, color, kind, sort_order, note, sub_levels, carry_dir, sub_pattern)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        categoryId,
        workId,
        snapshot.name,
        snapshot.color,
        kind,
        sort,
        snapshot.note,
        snapshot.subLevels,
        snapshot.carryDir,
        snapshot.subPattern,
      ],
    );
    for (const level of snapshot.levels) {
      dbRun(
        `INSERT INTO novel_setting_levels
           (id, category_id, name, rank, aliases, note, sub_levels, power,
            parent_id, seg_from, seg_to, sub_pattern)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
        [
          randomUUID(),
          categoryId,
          level.name,
          level.rank,
          JSON.stringify(level.aliases),
          level.note,
          level.subLevels,
          level.power,
          level.subPattern ?? "",
        ],
      );
    }
    count += 1;
  }
  return count;
}

/**
 * 取分类内当前的等级行数（不是 max(rank)）
 *
 * ⚠️ `max(rank)` 只用来算「追加到末尾」的落点，**不能**当行数用（1.38.0 修）：
 * 删除 / 拆分 / 旧数据裁剪都会让 rank 出现空洞，此时 `max(rank) > count`，
 * 拿 max 当行数会让「在末尾插入」算出一个越界的落点；而 rank 是倒序残留
 * （最大的 rank 在行首）时更糟——新行会被插到错误的行前面。
 */
function levelCount(categoryId: string): number {
  const row = dbGet(
    "SELECT COUNT(*) AS n FROM novel_setting_levels WHERE category_id = ?",
    [categoryId],
  ) as { n: number };
  return row.n;
}

/** 按行序取第 index 行的 rank；index >= 行数时返回 max(rank) + 1（即末尾之后） */
function rankAt(categoryId: string, index: number): number {
  const rows = dbAll(
    "SELECT rank FROM novel_setting_levels WHERE category_id = ? ORDER BY rank LIMIT 1 OFFSET ?",
    [categoryId, Math.max(0, index)],
  ) as Array<{ rank: number }>;
  if (rows.length > 0) return rows[0].rank;
  return maxRank(categoryId) + 1;
}

export function registerNovelSettingHandlers(): void {
  // ── 分类 ─────────────────────────────────────────────────────────

  // 新建分类。kind='realm' 每部作品至多一个：第二个境界体系会让「当前境界」
  // 绑定与行囊境界换算失去唯一落点，直接降级成普通分类而不是报错。
  ipcMain.handle(
    "novel-setting-category-add",
    (
      _event,
      workId: string,
      id: string,
      name: string,
      kind: "realm" | "custom",
      // 色点是渲染层给的：新建时按未占用色取一个，全部同色的分类列表没法扫读
      color?: string,
    ): { id: string; kind: "realm" | "custom" } | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const wanted = isSettingKind(kind) ? kind : "custom";
      const hasRealm =
        (dbGet(
          "SELECT COUNT(*) AS count FROM novel_setting_categories WHERE work_id = ? AND kind = 'realm'",
          [workId],
        ) as { count: number }).count > 0;
      const finalKind = wanted === "realm" && !hasRealm ? "realm" : "custom";
      const safeColor =
        typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color.trim())
          ? color.trim()
          : DEFAULT_CATEGORY_COLOR;
      dbRun(
        `INSERT INTO novel_setting_categories
           (id, work_id, name, color, kind, sort_order, note, sub_levels, carry_dir, sub_pattern)
         VALUES (?, ?, ?, ?, ?, ?, '', 1, 'asc', ?)`,
        [
          id,
          workId,
          trimmed,
          safeColor,
          finalKind,
          maxSortOrder(workId) + 1,
          DEFAULT_SUB_PATTERN,
        ],
      );
      return { id, kind: finalKind };
    },
  );

  // 分类改名与进位规则（命中 0 行不再谎报成功 —— 见 novel-write-guard 守卫）
  ipcMain.handle(
    "novel-setting-category-update",
    (_event, id: string, patch: CategoryPatch): boolean => {
      // kind 切换单独走事务：升级为境界体系前先把同作品原 realm 降级，
      // 与 addSettingCategory / appendSnapshots 的「每书至多一个 realm」口径一致
      if (patch.kind !== undefined && isSettingKind(patch.kind)) {
        const db = getDb();
        const row = dbGet(
          "SELECT work_id FROM novel_setting_categories WHERE id = ?",
          [id],
        ) as { work_id: string } | undefined;
        if (!row) return false;
        const applyKind = db.transaction(() => {
          if (patch.kind === "realm") {
            dbRun(
              `UPDATE novel_setting_categories SET kind = 'custom'
                WHERE work_id = ? AND kind = 'realm' AND id != ?`,
              [row.work_id, id],
            );
          }
          return dbRun(
            "UPDATE novel_setting_categories SET kind = ? WHERE id = ?",
            [patch.kind, id],
          ).changes > 0;
        });
        const changed = applyKind();
        if (Object.keys(patch).length === 1) return changed;
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (!trimmed) return false;
        sets.push("name = ?");
        params.push(trimmed);
      }
      if (patch.color !== undefined) {
        sets.push("color = ?");
        params.push(patch.color);
      }
      if (patch.note !== undefined) {
        sets.push("note = ?");
        params.push(patch.note);
      }
      if (patch.subLevels !== undefined) {
        sets.push("sub_levels = ?");
        params.push(Math.max(1, Math.floor(patch.subLevels) || 1));
      }
      if (patch.carryDir !== undefined && isCarryDir(patch.carryDir)) {
        sets.push("carry_dir = ?");
        params.push(patch.carryDir);
      }
      if (patch.subPattern !== undefined) {
        sets.push("sub_pattern = ?");
        params.push(patch.subPattern);
      }
      if (sets.length === 0) return false;
      params.push(id);
      return dbRun(
        `UPDATE novel_setting_categories SET ${sets.join(", ")} WHERE id = ?`,
        params,
      ).changes > 0;
    },
  );

  // 删除分类：先摘「当前境界」关联，再删等级项，最后删分类（顺序反了会留悬空引用）
  ipcMain.handle("novel-setting-category-delete", (_event, id: string): boolean => {
    const db = getDb();
    const apply = db.transaction(() => {
      dbRun(
        `DELETE FROM novel_links
          WHERE to_type = 'level'
            AND to_id IN (SELECT id FROM novel_setting_levels WHERE category_id = ?)`,
        [id],
      );
      dbRun("DELETE FROM novel_setting_levels WHERE category_id = ? OR parent_id IN (SELECT id FROM novel_setting_levels WHERE category_id = ?)", [
        id,
        id,
      ]);
      dbRun("DELETE FROM novel_setting_categories WHERE id = ?", [id]);
    });
    apply();
    return true;
  });

  // 分类排序
  ipcMain.handle(
    "novel-setting-category-order",
    (_event, updates: Array<{ id: string; sortOrder: number }>): boolean => {
      const db = getDb();
      const apply = db.transaction(() => {
        const stmt = db.prepare(
          "UPDATE novel_setting_categories SET sort_order = ? WHERE id = ?",
        );
        for (const update of updates) stmt.run(update.sortOrder, update.id);
      });
      apply();
      return true;
    },
  );

  // ── 等级项 ────────────────────────────────────────────────────────

  /**
   * 新增等级项。
   *
   * `index` 是**行序落点**（0-based；第 index 行之前），-1 或越界 = 追加到末尾。
   * 落点一律换算成**该行的 rank**，再把它及之后的 rank 全部 +1 —— 用行序而不是
   * max(rank) 是为了兼容 rank 有空洞的旧数据（见 `rankAt`）。不重排的话表里会
   * 出现两条同 rank 的行，UI 上的「第 N 阶」从此与实际顺序脱钩。
   *
   * 小层数取分类默认值（与本地乐观更新同一口径）：新阶立刻带上该体系的常规
   * 小层，而不是硬编码 1，否则「练气九层」的体系里新加的阶会缺小境界。
   */
  ipcMain.handle(
    "novel-setting-level-add",
    (
      _event,
      categoryId: string,
      id: string,
      name: string,
      index: number,
    ): { id: string; rank: number } | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const category = dbGet(
        "SELECT sub_levels, sub_pattern FROM novel_setting_categories WHERE id = ?",
        [categoryId],
      ) as { sub_levels: number; sub_pattern: string } | undefined;
      if (!category) return null;
      const total = levelCount(categoryId);
      const at = index < 0 ? total : Math.min(index, total);
      // 末尾追加时用 max(rank)+1，中间插入时用该行的 rank —— 两种落点都要能
      // 让「新 rank 起后面全部 +1」正确执行
      const rank = at >= total ? maxRank(categoryId) + 1 : rankAt(categoryId, at);
      const db = getDb();
      const apply = db.transaction(() => {
        dbRun(
          "UPDATE novel_setting_levels SET rank = rank + 1 WHERE category_id = ? AND rank >= ?",
          [categoryId, rank],
        );
        dbRun(
          `INSERT INTO novel_setting_levels
             (id, category_id, name, rank, aliases, note, sub_levels, power,
              parent_id, seg_from, seg_to, sub_pattern)
           VALUES (?, ?, ?, ?, '[]', '', ?, NULL, NULL, NULL, NULL, ?)`,
          [
            id,
            categoryId,
            trimmed,
            rank,
            Math.max(1, Math.floor(Number(category.sub_levels)) || 1),
            category.sub_pattern ?? "",
          ],
        );
      });
      apply();
      return { id, rank };
    },
  );

  /**
   * 批量新增等级项（1.37.0）：模板生成 / 逐行粘贴 / 预设套用共用这一个通道。
   *
   * 全部**追加到末尾**——批量生成的语义是「一次造出一段阶梯」，行间精确
   * 插入走单条的 novel-setting-level-add。单事务写入：中途一条脏数据让
   * 整批回滚，而不是留下半截阶梯。
   */
  ipcMain.handle(
    "novel-setting-level-batch-add",
    (
      _event,
      categoryId: string,
      items: Array<{ id: string; name: string; subLevels?: number; subPattern?: string }>,
    ): number => {
      if (!Array.isArray(items) || items.length === 0) return 0;
      // 上限 99：批量生成是「造一阶阶梯」，不是灌整本书的名词表
      const batch = items.slice(0, 99);
      const cleaned = batch
        .map((item) => ({
          id: typeof item?.id === "string" && item.id.trim() ? item.id.trim() : randomUUID(),
          name: typeof item?.name === "string" ? item.name.trim().slice(0, 60) : "",
          subLevels:
            typeof item?.subLevels === "number" && item.subLevels >= 1
              ? Math.min(999, Math.floor(item.subLevels))
              : 1,
          subPattern: normalizeSubPattern(item?.subPattern),
        }))
        .filter((item) => item.name);
      if (cleaned.length === 0) return 0;

      const category = dbGet(
        "SELECT id FROM novel_setting_categories WHERE id = ?",
        [categoryId],
      ) as { id: string } | undefined;
      if (!category) return 0;

      const db = getDb();
      const apply = db.transaction(() => {
        let rank = maxRank(categoryId);
        const stmt = db.prepare(
          `INSERT INTO novel_setting_levels
             (id, category_id, name, rank, aliases, note, sub_levels, power,
              parent_id, seg_from, seg_to, sub_pattern)
           VALUES (?, ?, ?, ?, '[]', '', ?, NULL, NULL, NULL, NULL, ?)`,
        );
        for (const item of cleaned) {
          rank += 1;
          stmt.run(item.id, categoryId, item.name, rank, item.subLevels, item.subPattern);
        }
      });
      apply();
      return cleaned.length;
    },
  );

  // 等级项改名 / 别名 / 说明 / 小层数 / 战力当量
  ipcMain.handle(
    "novel-setting-level-update",
    (_event, id: string, patch: LevelPatch): boolean => {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (!trimmed) return false;
        sets.push("name = ?");
        params.push(trimmed);
      }
      if (patch.aliases !== undefined) {
        sets.push("aliases = ?");
        params.push(JSON.stringify(normalizeAliases(patch.aliases)));
      }
      if (patch.note !== undefined) {
        sets.push("note = ?");
        params.push(patch.note);
      }
      if (patch.subLevels !== undefined) {
        sets.push("sub_levels = ?");
        params.push(Math.max(1, Math.floor(patch.subLevels) || 1));
      }
      if (patch.subPattern !== undefined) {
        sets.push("sub_pattern = ?");
        params.push(normalizeSubPattern(patch.subPattern));
      }
      if (patch.power !== undefined) {
        sets.push("power = ?");
        params.push(patch.power);
      }
      if (sets.length === 0) return false;
      params.push(id);
      return (
        dbRun(
          `UPDATE novel_setting_levels SET ${sets.join(", ")} WHERE id = ?`,
          params,
        ).changes > 0
      );
    },
  );

  // 删除等级项：连带删掉它的派生分段（拆分出来的后续段），并摘「当前境界」关联
  ipcMain.handle("novel-setting-level-delete", (_event, id: string): boolean => {
    const db = getDb();
    const apply = db.transaction(() => {
      dbRun(
        `DELETE FROM novel_links
          WHERE to_type = 'level'
            AND to_id IN (SELECT id FROM novel_setting_levels WHERE id = ? OR parent_id = ?)`,
        [id, id],
      );
      dbRun("DELETE FROM novel_setting_levels WHERE parent_id = ?", [id]);
      dbRun("DELETE FROM novel_setting_levels WHERE id = ?", [id]);
    });
    apply();
    return true;
  });

  // 等级项排序（拖拽后整批 rank 重排，单事务）
  ipcMain.handle(
    "novel-setting-level-order",
    (_event, updates: Array<{ id: string; rank: number }>): boolean => {
      const db = getDb();
      const apply = db.transaction(() => {
        const stmt = db.prepare(
          "UPDATE novel_setting_levels SET rank = ? WHERE id = ?",
        );
        for (const update of updates) stmt.run(update.rank, update.id);
      });
      apply();
      return true;
    },
  );

  /**
   * 拆分层级：一阶拆成多段（如「金丹·前期 小层 1–9 / 金丹·后期 小层 10–18」）。
   *
   * 1.38.1 起父阶是**纯分组**：不占用任何小层段（seg 置 NULL、保留整阶小层
   * 总数），全部段都是新建的子行、挂 `parent_id`，段号从第 1 段起。绑在原阶
   * 上的「当前境界」落到分组上仍然有效（分组即整阶）。拆分后总位置变多，
   * 原位置之后的 rank 要整体后移 `segments.length` 位。
   */
  ipcMain.handle(
    "novel-setting-level-split",
    (
      _event,
      levelId: string,
      segments: Array<{ name: string; from: number; to: number }>,
    ): boolean => {
      if (segments.length < 2) return false;
      const row = dbGet(
        "SELECT category_id, rank, sub_pattern FROM novel_setting_levels WHERE id = ?",
        [levelId],
      ) as { category_id: string; rank: number; sub_pattern: string } | undefined;
      if (!row) return false;

      const db = getDb();
      const apply = db.transaction(() => {
        dbRun(
          "UPDATE novel_setting_levels SET rank = rank + ? WHERE category_id = ? AND rank > ?",
          [segments.length, row.category_id, row.rank],
        );
        // 原阶降级为分组：不占段，小层数 = 整阶总数（与渲染层 applySplit 同口径
        // —— 不落总数，重载后行囊换算会把整阶算小）
        const total = segments.reduce((sum, s) => Math.max(sum, s.to), 0);
        dbRun(
          "UPDATE novel_setting_levels SET seg_from = NULL, seg_to = NULL, sub_levels = ? WHERE id = ?",
          [total, levelId],
        );
        // 各段各占一个新 rank。每段的小层数 = 段长；段名模板沿用本阶自己的 sub_pattern
        for (let i = 0; i < segments.length; i += 1) {
          const segment = segments[i];
          dbRun(
            `INSERT INTO novel_setting_levels
               (id, category_id, name, rank, aliases, note, sub_levels, power,
                parent_id, seg_from, seg_to, sub_pattern)
             VALUES (?, ?, ?, ?, '[]', '', ?, NULL, ?, ?, ?, ?)`,
            [
              randomUUID(),
              row.category_id,
              segment.name.trim(),
              row.rank + i + 1,
              Math.max(1, segment.to - segment.from + 1),
              levelId,
              segment.from,
              segment.to,
              row.sub_pattern ?? "",
            ],
          );
        }
      });
      apply();
      return true;
    },
  );

  /**
   * 合并：拆分的逆操作 —— 删掉全部派生段，把层段还给本体。
   * 本体 id 不变，因此「当前境界」绑定始终有效。
   * 还原小层总数：新模型本体已持有整阶总数；旧模型（父阶占第一段）总数散在
   * 段里，取「本体 + 段的最大层号 / 段长之和」兜底 —— 兼容两代数据。
   */
  ipcMain.handle("novel-setting-level-merge", (_event, levelId: string): boolean => {
    const row = dbGet(
      "SELECT id, category_id, rank, sub_levels FROM novel_setting_levels WHERE id = ?",
      [levelId],
    ) as SettingLevelRow | undefined;
    if (!row) return false;

    const db = getDb();
    const apply = db.transaction(() => {
      const children = dbAll(
        "SELECT id, rank, sub_levels, seg_to FROM novel_setting_levels WHERE parent_id = ? ORDER BY rank",
        [levelId],
      ) as Array<{ id: string; rank: number; sub_levels: number; seg_to: number | null }>;
      if (children.length === 0) return;
      const childRanks = children.map((child) => child.rank);
      dbRun(
        `DELETE FROM novel_links
          WHERE to_type = 'level' AND to_id IN (${childRanks.map(() => "?").join(", ")})`,
        childRanks.map((_rank, i) => children[i].id),
      );
      dbRun("DELETE FROM novel_setting_levels WHERE parent_id = ?", [levelId]);
      // 层段还给本体后，把它后面所有行的 rank 前移，补上删掉的位置
      dbRun(
        "UPDATE novel_setting_levels SET rank = rank - ? WHERE category_id = ? AND rank > ?",
        [children.length, row.category_id, row.rank],
      );
      const restored = Math.max(
        row.sub_levels ?? 1,
        ...children.map((child) => child.seg_to ?? 0),
        children.reduce((sum, child) => sum + (child.sub_levels ?? 0), 0),
      );
      dbRun(
        "UPDATE novel_setting_levels SET seg_from = NULL, seg_to = NULL, sub_levels = ? WHERE id = ?",
        [restored, levelId],
      );
    });
    apply();
    return true;
  });

  // ── 导入导出 ──────────────────────────────────────────────────────

  // 导出：只组装载荷，落盘复用 novel-export-file（文本由渲染层生成）
  ipcMain.handle("novel-setting-export", (_event, workId: string): SettingExportPayload => {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      categories: readSnapshots(workId),
    };
  });

  /**
   * 导入：`mode='merge'` 追加（同名分类不合并，各自独立成条，由作者在 UI 里
   * 自行取舍）；`mode='replace'` 先清空该作品的全部设定再写入。
   *
   * 刻意不做「同名自动合并」：等级按名称去重要猜作者意图（是要覆盖还是并存），
   * 猜错就丢了已写好的说明与别名。交给 UI 逐条列差异更符合「不静默覆盖」。
   */
  ipcMain.handle(
    "novel-setting-import",
    (
      _event,
      workId: string,
      raw: unknown,
      mode: "merge" | "replace",
    ): { imported: number; skipped: number } => {
      const source = raw as { categories?: unknown } | null;
      if (!source || !Array.isArray(source.categories)) {
        return { imported: 0, skipped: 0 };
      }
      const parsed = source.categories.map(parseSnapshot);
      const snapshots = parsed.filter(
        (item): item is SettingCategorySnapshot => item !== null,
      );
      const skipped = parsed.length - snapshots.length;
      if (snapshots.length === 0) return { imported: 0, skipped };

      const db = getDb();
      const apply = db.transaction(() => {
        if (mode === "replace") {
          dbRun(
            `DELETE FROM novel_links
              WHERE to_type = 'level'
                AND to_id IN (
                  SELECT id FROM novel_setting_levels
                   WHERE category_id IN (SELECT id FROM novel_setting_categories WHERE work_id = ?)
                )`,
            [workId],
          );
          dbRun(
            `DELETE FROM novel_setting_levels
              WHERE category_id IN (SELECT id FROM novel_setting_categories WHERE work_id = ?)`,
            [workId],
          );
          dbRun("DELETE FROM novel_setting_categories WHERE work_id = ?", [workId]);
        }
        appendSnapshots(workId, snapshots);
      });
      apply();
      return { imported: snapshots.length, skipped };
    },
  );

  // ── 模板（跨作品复用） ─────────────────────────────────────────────

  ipcMain.handle("novel-setting-template-list", (): SettingTemplateDto[] => {
    const rows = dbAll(
      "SELECT * FROM novel_setting_templates ORDER BY created_at DESC",
    ) as SettingTemplateRow[];
    return rows.map((row) => {
      let categories: SettingCategorySnapshot[] = [];
      try {
        const parsed: unknown = JSON.parse(row.payload);
        if (Array.isArray(parsed)) {
          categories = parsed
            .map(parseSnapshot)
            .filter((item): item is SettingCategorySnapshot => item !== null);
        }
      } catch {
        categories = [];
      }
      return { id: row.id, name: row.name, createdAt: row.created_at, categories };
    });
  });

  // 存为模板：把指定分类（缺省全部）打包一份快照
  ipcMain.handle(
    "novel-setting-template-save",
    (
      _event,
      id: string,
      name: string,
      workId: string,
      categoryIds: string[],
    ): boolean => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      const snapshots = readSnapshots(
        workId,
        categoryIds.length > 0 ? categoryIds : undefined,
      );
      if (snapshots.length === 0) return false;
      dbRun(
        "INSERT INTO novel_setting_templates (id, name, payload, created_at) VALUES (?, ?, ?, ?)",
        [id, trimmed, JSON.stringify(snapshots), Date.now()],
      );
      return true;
    },
  );

  // 应用模板：把模板里的分类追加到当前作品（realm 唯一性由 appendSnapshots 兜住）
  ipcMain.handle(
    "novel-setting-template-apply",
    (_event, templateId: string, workId: string): number => {
      const row = dbGet(
        "SELECT payload FROM novel_setting_templates WHERE id = ?",
        [templateId],
      ) as { payload: string } | undefined;
      if (!row) return 0;
      let raw: unknown;
      try {
        raw = JSON.parse(row.payload);
      } catch {
        return 0;
      }
      if (!Array.isArray(raw)) return 0;
      const snapshots = raw
        .map(parseSnapshot)
        .filter((item): item is SettingCategorySnapshot => item !== null);
      if (snapshots.length === 0) return 0;
      const db = getDb();
      const apply = db.transaction(() => appendSnapshots(workId, snapshots));
      apply();
      return snapshots.length;
    },
  );

  ipcMain.handle("novel-setting-template-delete", (_event, id: string): boolean => {
    return dbRun("DELETE FROM novel_setting_templates WHERE id = ?", [id]).changes > 0;
  });
}
