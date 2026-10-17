/**
 * 全局设定中心（Global Setting Center）语义化 IPC handlers —— **全局域**
 *
 * 全局库是跨书共享的设定库（D1），与任一作品无关（REQ-040 ③「删光作品后仍在」）：
 * 数据落在 `novel_global_setting_categories` / `novel_global_setting_levels`。
 *
 * 每次全局写成功后做两件事（§3.3.2 / H7）：
 * 1. `syncReferences`：把这次改动**实时同步**到全部本书镜像（按 source_global_id upsert，
 *    镜像行 id 不变）——「无需重开书」看见新值（REQ-041 ③）；
 * 2. `windowManager.broadcast("global-setting-changed", { kinds })`：通知正在打开的窗口重载。
 *
 * 删除（D4）：`confirm !== true` 只回传引用计数交渲染层二次确认；确认后才「先固化、后删除」。
 *
 * 边界：SQL 只出现在本文件、`novel-setting-shared.ts` 与 `novel-db.ts`；不导入 `main.ts`；
 * 写通道一律取 `novel-db.ts` 的 `novelRun` 等别名，不得 import `../db`。
 */
import { ipcMain } from "electron";
import { windowManager } from "../windowManager";
import {
  novelAll as dbAll,
  novelGet as dbGet,
  novelRun as dbRun,
  getNovelDb as getDb,
} from "../novel-db";
import { DEFAULT_CATEGORY_COLOR, DEFAULT_SUB_PATTERN } from "./novel-handlers";
import {
  countGlobalRefs,
  countGlobalRefsBatch,
  createSettingId,
  isCarryDir,
  isSettingKind,
  levelCount,
  listGlobalRefs,
  maxRank,
  maxSortOrder,
  normalizeAliases,
  normalizeSubPattern,
  rankAt,
  readSnapshots,
  solidifyReferencesForCategory,
  syncReferences,
  type GlobalRefDto,
  type SettingCategoryRow,
  type SettingExportPayload,
  type SettingLevelRow,
} from "./novel-setting-shared";

// ── DTO（camelCase，IPC 线格式；库表列 snake_case 见 novel-db） ────────

/** 全局设定等级项（结构对齐本书的 NovelSettingLevelDTO） */
interface GlobalSettingLevelDto {
  id: string;
  categoryId: string;
  name: string;
  rank: number;
  aliases: string[];
  note: string;
  subLevels: number;
  power: number | null;
  parentId: string | null;
  segFrom: number | null;
  segTo: number | null;
  subPattern: string;
}

/** 全局设定分类：无 workId；带引用计数（列表徽标用） */
interface GlobalSettingCategoryDto {
  id: string;
  name: string;
  color: string;
  kind: "realm" | "custom";
  sortOrder: number;
  note: string;
  subLevels: number;
  carryDir: "asc" | "desc";
  subPattern: string;
  levels: GlobalSettingLevelDto[];
  /** 有多少部书正在引用它（0 = 暂无引用） */
  refCount: number;
}

/** D4 删除的返回载荷 */
interface GlobalCategoryDeleteResult {
  ok: boolean;
  /** confirm=false 时回传，供渲染层弹二次确认 */
  refCount: number;
}

/** 渲染层传入的分类补丁 */
interface GlobalCategoryPatch {
  name?: string;
  color?: string;
  note?: string;
  subLevels?: number;
  carryDir?: "asc" | "desc";
  subPattern?: string;
  kind?: "realm" | "custom";
}

/** 渲染层传入的等级项补丁 */
interface GlobalLevelPatch {
  name?: string;
  aliases?: string[];
  note?: string;
  subLevels?: number;
  power?: number | null;
  subPattern?: string;
}

// ── 工具 ────────────────────────────────────────────────────────────

/** JSON 列安全解析：string[] */
function parseAliases(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** 全局 realm 是否已存在（全库至多一个，应用层校验；部分唯一索引兜底） */
function hasGlobalRealm(): boolean {
  return (
    dbGet(
      "SELECT COUNT(*) AS count FROM novel_global_setting_categories WHERE kind = 'realm'",
    ) as { count: number }
  ).count > 0;
}

/** 通知各窗口全局设定已变（书窗口订阅后重载设定） */
function notifyChanged(kinds: Array<"category" | "level">): void {
  windowManager.broadcast("global-setting-changed", { kinds });
}

/** 取某全局等级所属的分类 id（同步 / 广播要用） */
function categoryIdOfLevel(levelId: string): string | null {
  const row = dbGet(
    "SELECT category_id FROM novel_global_setting_levels WHERE id = ?",
    [levelId],
  ) as { category_id: string } | undefined;
  return row ? row.category_id : null;
}

/** 读出全部全局分类（含等级 + 引用计数）——列表页 / 导出共用 */
function readGlobalCategories(): GlobalSettingCategoryDto[] {
  const categories = dbAll(
    "SELECT * FROM novel_global_setting_categories WHERE id IS NOT NULL ORDER BY sort_order",
  ) as SettingCategoryRow[];
  if (categories.length === 0) return [];

  const refCounts = countGlobalRefsBatch();
  const levelsByCategory = new Map<string, GlobalSettingLevelDto[]>();
  const placeholders = categories.map(() => "?").join(", ");
  const levels = dbAll(
    `SELECT * FROM novel_global_setting_levels
      WHERE category_id IN (${placeholders})
      ORDER BY category_id, rank`,
    categories.map((category) => category.id),
  ) as SettingLevelRow[];
  for (const level of levels) {
    const list = levelsByCategory.get(level.category_id) ?? [];
    list.push({
      id: level.id,
      categoryId: level.category_id,
      name: level.name,
      rank: level.rank,
      aliases: parseAliases(level.aliases),
      note: level.note ?? "",
      subLevels: level.sub_levels ?? 1,
      power: level.power,
      parentId: level.parent_id,
      segFrom: level.seg_from,
      segTo: level.seg_to,
      subPattern: level.sub_pattern ?? "",
    });
    levelsByCategory.set(level.category_id, list);
  }

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    color: category.color,
    kind: isSettingKind(category.kind) ? category.kind : "custom",
    sortOrder: category.sort_order,
    note: category.note ?? "",
    subLevels: category.sub_levels ?? 1,
    carryDir: isCarryDir(category.carry_dir) ? category.carry_dir : "asc",
    subPattern: category.sub_pattern ?? DEFAULT_SUB_PATTERN,
    levels: levelsByCategory.get(category.id) ?? [],
    refCount: refCounts.get(category.id) ?? 0,
  }));
}

export function registerNovelGlobalSettingHandlers(): void {
  // ── 加载 ─────────────────────────────────────────────────────────

  // 失败不抛：UI 落空态（REQ-040 打开即整体列表）
  ipcMain.handle(
    "novel-global-setting-load",
    (): { categories: GlobalSettingCategoryDto[] } => {
      try {
        return { categories: readGlobalCategories() };
      } catch (error) {
        console.warn("[novel-global-setting] 加载全局设定失败：", error);
        return { categories: [] };
      }
    },
  );

  // ── 分类 ─────────────────────────────────────────────────────────

  // 新建全局分类。kind='realm' 全库至多一个，重复自动降级为 custom（与本书域同口径）
  ipcMain.handle(
    "novel-global-setting-category-add",
    (
      _event,
      id: string,
      name: string,
      kind: "realm" | "custom",
      color?: string,
    ): { id: string; kind: "realm" | "custom" } | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const wanted = isSettingKind(kind) ? kind : "custom";
      const finalKind = wanted === "realm" && !hasGlobalRealm() ? "realm" : "custom";
      const safeColor =
        typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color.trim())
          ? color.trim()
          : DEFAULT_CATEGORY_COLOR;
      dbRun(
        `INSERT INTO novel_global_setting_categories
           (id, name, color, kind, sort_order, note, sub_levels, carry_dir, sub_pattern)
         VALUES (?, ?, ?, ?, ?, '', 1, 'asc', ?)`,
        [
          id,
          trimmed,
          safeColor,
          finalKind,
          maxSortOrder("global", "") + 1,
          DEFAULT_SUB_PATTERN,
        ],
      );
      notifyChanged(["category"]);
      return { id, kind: finalKind };
    },
  );

  // 分类改名与进位规则；kind 切换走事务保证全局 realm 唯一
  ipcMain.handle(
    "novel-global-setting-category-update",
    (_event, id: string, patch: GlobalCategoryPatch): boolean => {
      if (patch.kind !== undefined && isSettingKind(patch.kind)) {
        const db = getDb();
        const exists = dbGet(
          "SELECT id FROM novel_global_setting_categories WHERE id = ?",
          [id],
        ) as { id: string } | undefined;
        if (!exists) return false;
        const applyKind = db.transaction(() => {
          if (patch.kind === "realm") {
            dbRun(
              `UPDATE novel_global_setting_categories SET kind = 'custom'
                WHERE kind = 'realm' AND id != ?`,
              [id],
            );
          }
          return (
            dbRun(
              "UPDATE novel_global_setting_categories SET kind = ? WHERE id = ?",
              [patch.kind, id],
            ).changes > 0
          );
        });
        const changed = applyKind();
        if (Object.keys(patch).length === 1) {
          if (changed) notifyChanged(["category"]);
          return changed;
        }
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
      const changed =
        dbRun(
          `UPDATE novel_global_setting_categories SET ${sets.join(", ")} WHERE id = ?`,
          params,
        ).changes > 0;
      if (changed) {
        // 分类可变字段变了 ⇒ 实时同步到全部引用书（镜像 id 不变）
        syncReferences(id);
        notifyChanged(["category"]);
      }
      return changed;
    },
  );

  /**
   * 删除全局分类（D4）：二次确认 + 引用方就地固化。
   *
   * `confirm !== true` 只回传 `{ok:false, refCount}` 供渲染层弹确认，**不删**；
   * 确认后单事务执行「先固化（引用书转为本书副本）→ 再删全局分类与等级」。
   */
  ipcMain.handle(
    "novel-global-setting-category-delete",
    (_event, id: string, confirm?: boolean): GlobalCategoryDeleteResult => {
      const row = dbGet(
        "SELECT name FROM novel_global_setting_categories WHERE id = ?",
        [id],
      ) as { name: string } | undefined;
      if (!row) return { ok: false, refCount: 0 };
      const refCount = countGlobalRefs(id);
      if (confirm !== true) return { ok: false, refCount };

      const db = getDb();
      const apply = db.transaction(() => {
        // 先固化：把每个引用书的镜像分类 / 等级转成本书自有（source_global_id 置 NULL）
        solidifyReferencesForCategory(id, row.name);
        // 再删全局行：等级在前、分类在后
        dbRun("DELETE FROM novel_global_setting_levels WHERE category_id = ?", [id]);
        dbRun("DELETE FROM novel_global_setting_categories WHERE id = ?", [id]);
      });
      apply();
      notifyChanged(["category"]);
      return { ok: true, refCount };
    },
  );

  // 分类排序
  ipcMain.handle(
    "novel-global-setting-category-order",
    (_event, updates: Array<{ id: string; sortOrder: number }>): boolean => {
      const db = getDb();
      const apply = db.transaction(() => {
        const stmt = db.prepare(
          "UPDATE novel_global_setting_categories SET sort_order = ? WHERE id = ?",
        );
        for (const update of updates) stmt.run(update.sortOrder, update.id);
      });
      apply();
      notifyChanged(["category"]);
      return true;
    },
  );

  // ── 等级项 ────────────────────────────────────────────────────────

  // 新增等级项：`index` 是行序落点（-1 / 越界 = 末尾）；落点口径与本书域完全一致
  ipcMain.handle(
    "novel-global-setting-level-add",
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
        "SELECT sub_levels, sub_pattern FROM novel_global_setting_categories WHERE id = ?",
        [categoryId],
      ) as { sub_levels: number; sub_pattern: string } | undefined;
      if (!category) return null;
      const total = levelCount("global", categoryId);
      const at = index < 0 ? total : Math.min(index, total);
      const rank = at >= total ? maxRank("global", categoryId) + 1 : rankAt("global", categoryId, at);
      const db = getDb();
      const apply = db.transaction(() => {
        dbRun(
          "UPDATE novel_global_setting_levels SET rank = rank + 1 WHERE category_id = ? AND rank >= ?",
          [categoryId, rank],
        );
        dbRun(
          `INSERT INTO novel_global_setting_levels
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
      syncReferences(categoryId);
      notifyChanged(["level"]);
      return { id, rank };
    },
  );

  // 批量新增：全部追加到末尾，单事务
  ipcMain.handle(
    "novel-global-setting-level-batch-add",
    (
      _event,
      categoryId: string,
      items: Array<{ id: string; name: string; subLevels?: number; subPattern?: string }>,
    ): number => {
      if (!Array.isArray(items) || items.length === 0) return 0;
      const batch = items.slice(0, 99);
      const cleaned = batch
        .map((item) => ({
          id:
            typeof item?.id === "string" && item.id.trim()
              ? item.id.trim()
              : createSettingId("gsl"),
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
        "SELECT id FROM novel_global_setting_categories WHERE id = ?",
        [categoryId],
      ) as { id: string } | undefined;
      if (!category) return 0;

      const db = getDb();
      const apply = db.transaction(() => {
        let rank = maxRank("global", categoryId);
        const stmt = db.prepare(
          `INSERT INTO novel_global_setting_levels
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
      syncReferences(categoryId);
      notifyChanged(["level"]);
      return cleaned.length;
    },
  );

  // 等级项改名 / 别名 / 说明 / 小层数 / 战力当量
  ipcMain.handle(
    "novel-global-setting-level-update",
    (_event, id: string, patch: GlobalLevelPatch): boolean => {
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
      const changed =
        dbRun(
          `UPDATE novel_global_setting_levels SET ${sets.join(", ")} WHERE id = ?`,
          params,
        ).changes > 0;
      if (changed) {
        const categoryId = categoryIdOfLevel(id);
        if (categoryId) syncReferences(categoryId);
        notifyChanged(["level"]);
      }
      return changed;
    },
  );

  // 删除等级项：连同它的派生分段一起删
  ipcMain.handle("novel-global-setting-level-delete", (_event, id: string): boolean => {
    const categoryId = categoryIdOfLevel(id);
    if (!categoryId) return false;
    const db = getDb();
    const apply = db.transaction(() => {
      dbRun("DELETE FROM novel_global_setting_levels WHERE parent_id = ?", [id]);
      dbRun("DELETE FROM novel_global_setting_levels WHERE id = ?", [id]);
    });
    apply();
    syncReferences(categoryId);
    notifyChanged(["level"]);
    return true;
  });

  // 等级项排序（拖拽后整批 rank 重排，单事务）
  ipcMain.handle(
    "novel-global-setting-level-order",
    (_event, updates: Array<{ id: string; rank: number }>): boolean => {
      const db = getDb();
      const apply = db.transaction(() => {
        const stmt = db.prepare(
          "UPDATE novel_global_setting_levels SET rank = ? WHERE id = ?",
        );
        for (const update of updates) stmt.run(update.rank, update.id);
      });
      apply();
      // 一批排序都落在同一个分类上，取第一条的所属分类同步即可
      const categoryId = updates.length > 0 ? categoryIdOfLevel(updates[0].id) : null;
      if (categoryId) syncReferences(categoryId);
      notifyChanged(["level"]);
      return true;
    },
  );

  // 拆分层级：父阶降级为纯分组，各段新建并挂 parent_id（与本书域同口径）
  ipcMain.handle(
    "novel-global-setting-level-split",
    (
      _event,
      levelId: string,
      segments: Array<{ name: string; from: number; to: number }>,
    ): boolean => {
      if (segments.length < 2) return false;
      const row = dbGet(
        "SELECT category_id, rank, sub_pattern FROM novel_global_setting_levels WHERE id = ?",
        [levelId],
      ) as { category_id: string; rank: number; sub_pattern: string } | undefined;
      if (!row) return false;

      const db = getDb();
      const apply = db.transaction(() => {
        dbRun(
          "UPDATE novel_global_setting_levels SET rank = rank + ? WHERE category_id = ? AND rank > ?",
          [segments.length, row.category_id, row.rank],
        );
        const total = segments.reduce((sum, s) => Math.max(sum, s.to), 0);
        dbRun(
          "UPDATE novel_global_setting_levels SET seg_from = NULL, seg_to = NULL, sub_levels = ? WHERE id = ?",
          [total, levelId],
        );
        for (let i = 0; i < segments.length; i += 1) {
          const segment = segments[i];
          dbRun(
            `INSERT INTO novel_global_setting_levels
               (id, category_id, name, rank, aliases, note, sub_levels, power,
                parent_id, seg_from, seg_to, sub_pattern)
             VALUES (?, ?, ?, ?, '[]', '', ?, NULL, ?, ?, ?, ?)`,
            [
              createSettingId("gsl"),
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
      syncReferences(row.category_id);
      notifyChanged(["level"]);
      return true;
    },
  );

  // 合并：拆分的逆操作，删派生段并把层段还给本体
  ipcMain.handle("novel-global-setting-level-merge", (_event, levelId: string): boolean => {
    const row = dbGet(
      "SELECT id, category_id, rank, sub_levels FROM novel_global_setting_levels WHERE id = ?",
      [levelId],
    ) as Pick<SettingLevelRow, "id" | "category_id" | "rank" | "sub_levels"> | undefined;
    if (!row) return false;

    const db = getDb();
    const apply = db.transaction(() => {
      const children = dbAll(
        "SELECT id, rank, sub_levels, seg_to FROM novel_global_setting_levels WHERE parent_id = ? ORDER BY rank",
        [levelId],
      ) as Array<{ id: string; rank: number; sub_levels: number; seg_to: number | null }>;
      if (children.length === 0) return;
      dbRun("DELETE FROM novel_global_setting_levels WHERE parent_id = ?", [levelId]);
      dbRun(
        "UPDATE novel_global_setting_levels SET rank = rank - ? WHERE category_id = ? AND rank > ?",
        [children.length, row.category_id, row.rank],
      );
      const restored = Math.max(
        row.sub_levels ?? 1,
        ...children.map((child) => child.seg_to ?? 0),
        children.reduce((sum, child) => sum + (child.sub_levels ?? 0), 0),
      );
      dbRun(
        "UPDATE novel_global_setting_levels SET seg_from = NULL, seg_to = NULL, sub_levels = ? WHERE id = ?",
        [restored, levelId],
      );
    });
    apply();
    syncReferences(row.category_id);
    notifyChanged(["level"]);
    return true;
  });

  // ── 导出（仅导出 JSON；模板库 / 导入本期不做 —— U3） ─────────────────

  ipcMain.handle("novel-global-setting-export", (): SettingExportPayload => {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      categories: readSnapshots("global", ""),
    };
  });

  // ── 引用方名单（R12，只读） ──────────────────────────────────────

  // 某全局分类被**哪几部书**引用（「N 部书引用」的展开）。一条 SELECT，
  // 不开关事务、不写库；名单条数与 countGlobalRefs 的引用计数同口径。
  //
  // 失败不抛：这是个展示用的增强信息，读失败落到空名单，不该变成渲染层未处理的
  // IPC reject（与上面 `novel-global-setting-load` 同一做法）。
  ipcMain.handle(
    "novel-global-setting-refs",
    (_event, categoryId: string): GlobalRefDto[] => {
      if (!categoryId) return [];
      try {
        return listGlobalRefs(categoryId);
      } catch (error) {
        console.warn("[novel-global-setting] 读取引用方名单失败：", error);
        return [];
      }
    },
  );
}
