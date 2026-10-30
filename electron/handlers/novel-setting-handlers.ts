/**
 * 小说设定模块（Setting）语义化 IPC handlers —— **本书域**
 *
 * 一部作品的**全部**等级序列统一在 `novel_setting_categories` / `novel_setting_levels`：
 * 境界体系只是 `kind='realm'` 的一个分类，功法等级 / 丹药稀有度 / 法宝品阶是
 * `kind='custom'` 的其它分类。1.36.0 重构把 R25 的 `novel_level_systems` /
 * `novel_levels` / `novel_level_conversions` 三张表收进了这里（§6.7 `refactor`）。
 *
 * 1.4x 全局设定中心（D1/D2）：本书可以**引用**全局库里的一个分类（实时同步），
 * 也可以把本书分类**上架**到全局库（复制快照）。引用项在本书侧只读，权威在主进程；
 * 跨域逻辑（建立引用 / 同步 / 上架 / 固化 / 引用计数 / 只读守卫）集中在
 * `novel-setting-shared.ts`，本文件只做本书域的通道注册与前置守卫。
 *
 * 边界：SQL 只出现在本文件、`novel-setting-shared.ts` 与 `novel-db.ts`；不导入 `main.ts`；
 * 写通道一律取 `novel-db.ts` 的 `novelRun` 等别名，不得 import `../db`。
 *
 * 与行囊的关系：`novel-pack-handlers` 只读 realm 分类投影出境界阶梯，本模块
 * 不感知行囊；两侧通过 `novel_setting_levels.id` 与 `novel_links.to_type='level'`
 * 保持引用一致即可。
 */
import { BrowserWindow, ipcMain } from "electron";
import { windowManager } from "../windowManager";
import {
  novelAll as dbAll,
  novelGet as dbGet,
  novelRun as dbRun,
  getNovelDb as getDb,
} from "../novel-db";
import { DEFAULT_CATEGORY_COLOR, DEFAULT_SUB_PATTERN } from "./novel-handlers";
import {
  createSettingId,
  isCarryDir,
  isLevelInReferencedCategory,
  isReferencedCategory,
  isSettingKind,
  levelCount,
  maxRank,
  maxSortOrder,
  minRank,
  normalizeAliases,
  normalizeSubPattern,
  parseSnapshot,
  publishGlobal,
  rankAt,
  readSnapshots,
  referenceGlobal,
  type PublishToGlobalResult,
  type SettingCategorySnapshot,
  type SettingExportPayload,
  type SettingLevelRow,
} from "./novel-setting-shared";
// 与渲染层共用同一套「显示行序 ↔ rank」换算：两端各算一套必然错位
import { toRankIndex } from "../../src/shared/novel/setting-utils";

// 既有的快照 / 载荷类型经 shared 落地，这里 re-export 保持既有 import 路径可用
export type { SettingCategorySnapshot, SettingExportPayload };

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

interface SettingTemplateRow {
  id: string;
  name: string;
  payload: string;
  created_at: number;
}

interface SettingTemplateDto {
  id: string;
  name: string;
  createdAt: number;
  categories: SettingCategorySnapshot[];
}

// ── 工具 ──

/**
 * 书侧触发的全局引用关系变化 ⇒ 通知其它窗口重载全局设定（H7 / REQ-041）。
 *
 * 与全局域 `notifyChanged` 同一事件名与载荷（`{ kinds }`），但**发出方是书窗口**：
 * 建立引用 / 上架会改变全局库的「N 部书引用」计数，正开着的全局窗口必须即时刷新。
 *
 * 防回声：广播按注册名排除**发送窗口**（`getNameOf`）。书窗口走 invoke 通道，
 * 主进程直接 `broadcast` 时没有「sender 事件」可依，故显式用 `event.sender`
 * 反查发送窗口名排掉它，避免书窗口收到自己的广播形成回环。
 */
function notifyGlobalRefsChanged(
  event: Electron.IpcMainInvokeEvent,
  kinds: Array<"category" | "level">,
): void {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  const exclude = senderWin ? windowManager.getNameOf(senderWin) : undefined;
  windowManager.broadcast("global-setting-changed", { kinds }, exclude);
}

/**
 * 把一批快照追加到一个作品下；realm 唯一：作品已有境界体系时，进来的 realm 降级为 custom。
 *
 * 仅本书域使用（全局域本期只做导出，不导入 —— U3）。
 */
function appendSnapshots(
  workId: string,
  snapshots: SettingCategorySnapshot[],
): number {
  const hasRealm =
    (dbGet(
      "SELECT COUNT(*) AS count FROM novel_setting_categories WHERE work_id = ? AND kind = 'realm'",
      [workId],
    ) as { count: number }).count > 0;
  let sort = maxSortOrder("book", workId);
  let count = 0;
  for (const snapshot of snapshots) {
    sort += 1;
    const kind = snapshot.kind === "realm" && !hasRealm ? "realm" : "custom";
    const categoryId = createSettingId("sc");
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
          createSettingId("sl"),
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
          maxSortOrder("book", workId) + 1,
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
      // 引用项只读（D2 权威边界）：镜像自全局的分类由全局同步独占改写，直接拒绝
      if (isReferencedCategory(id)) return false;
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
    // 引用项只读（D2）：删除要走全局库（或「脱离全局」，Q3 本期不做），本书侧直接拒绝
    if (isReferencedCategory(id)) return false;
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
      // 引用项只读（D2）：命中任一引用行即整批拒绝，不落任何写
      for (const update of updates) {
        if (isReferencedCategory(update.id)) return false;
      }
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
      // 引用项只读（D2）：引用分类的等级由全局同步独占改写
      if (isReferencedCategory(categoryId)) return null;
      const category = dbGet(
        "SELECT sub_levels, sub_pattern, carry_dir FROM novel_setting_categories WHERE id = ?",
        [categoryId],
      ) as { sub_levels: number; sub_pattern: string; carry_dir: string } | undefined;
      if (!category) return null;
      const total = levelCount("book", categoryId);
      // ⚠️ `index` 是**显示行序**（第几行之前），而 `rankAt` 按 rank 升序取。
      // desc（由高到低）下两者相反，必须换算 —— 否则「往末尾追加」会插到视觉顶部
      // （2.17.1 修）。换算与渲染层 `insertLevel` 共用 `toRankIndex`，两端不会错位。
      const at = toRankIndex(
        total,
        index < 0 ? total : Math.min(index, total),
        isCarryDir(category.carry_dir) ? category.carry_dir : "asc",
      );
      // 末尾追加时用 max(rank)+1，中间插入时用该行的 rank —— 两种落点都要能
      // 让「新 rank 起后面全部 +1」正确执行
      const rank = at >= total ? maxRank("book", categoryId) + 1 : rankAt("book", categoryId, at);
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
   * 批量新增等级项（1.37.0）：模板生成 / 逐行粘贴 / 预设套用 / AI 排阶梯共用这一个通道。
   *
   * 全部**追加到末尾** —— 批量生成的语义是「一次造出一段阶梯」，行间精确
   * 插入走单条的 novel-setting-level-add。单事务写入：中途一条脏数据让
   * 整批回滚，而不是留下半截阶梯。
   *
   * ⚠️ 两处字段与单条新增**必须同口径**（2.17.1 修）：
   * 1. `subLevels` / `subPattern` 未显式给出时回落到**分类默认**，不是 1 ——
   *    否则「每阶小三层」的体系里，批量加进来的阶会缺小层，与单条新增不一致；
   * 2. `note`（等级说明）随条目写入 —— AI 排阶梯会给出每级的说明，丢掉它
   *    等于白生成（用户在候选里看得见、落库后没了）。
   */
  ipcMain.handle(
    "novel-setting-level-batch-add",
    (
      _event,
      categoryId: string,
      items: Array<{ id: string; name: string; note?: string; subLevels?: number; subPattern?: string }>,
    ): number => {
      if (!Array.isArray(items) || items.length === 0) return 0;
      // 引用项只读（D2）
      if (isReferencedCategory(categoryId)) return 0;

      const category = dbGet(
        "SELECT id, sub_levels, sub_pattern, carry_dir FROM novel_setting_categories WHERE id = ?",
        [categoryId],
      ) as { id: string; sub_levels: number; sub_pattern: string; carry_dir: string } | undefined;
      if (!category) return 0;
      const categorySubLevels = Math.max(1, Math.floor(Number(category.sub_levels)) || 1);
      const categorySubPattern = category.sub_pattern ?? "";
      const isDesc = (isCarryDir(category.carry_dir) ? category.carry_dir : "asc") === "desc";

      // 上限 99：批量生成是「造一阶阶梯」，不是灌整本书的名词表
      const batch = items.slice(0, 99);
      const cleaned = batch
        .map((item) => ({
          id: typeof item?.id === "string" && item.id.trim() ? item.id.trim() : createSettingId("sl"),
          name: typeof item?.name === "string" ? item.name.trim().slice(0, 60) : "",
          // 等级说明：AI 产出的「这一级大致能做什么」，原样落进 note 列
          note: typeof item?.note === "string" ? item.note.trim().slice(0, 200) : "",
          subLevels:
            typeof item?.subLevels === "number" && item.subLevels >= 1
              ? Math.min(999, Math.floor(item.subLevels))
              : categorySubLevels,
          subPattern: normalizeSubPattern(item?.subPattern) || categorySubPattern,
        }))
        .filter((item) => item.name);
      if (cleaned.length === 0) return 0;

      const db = getDb();
      const apply = db.transaction(() => {
        /**
         * 追加落点随进位方向走（2.17.1）：
         * - `asc`：接在 max(rank) 之后 = 显示末尾；
         * - `desc`：显示末尾是 **rank 最小**的一端 —— 现有整体上移，新条目占住低端。
         *   不换算就会插到视觉顶部（「拓展后续」给的明明是更低的等级，却浮到最上面）。
         *
         * ⚠️ `base` 必须在上移**之前**取：上移后 min 会跟着 +k，再拿它当起点
         * 就会与刚被上移的行撞 rank。
         */
        const base = isDesc ? (minRank("book", categoryId) || 1) : maxRank("book", categoryId);
        const total = levelCount("book", categoryId);
        if (isDesc) {
          dbRun("UPDATE novel_setting_levels SET rank = rank + ? WHERE category_id = ?", [
            cleaned.length,
            categoryId,
          ]);
        }
        /**
         * 传入顺序 = 「从现有阶梯的末端往外」的显示顺序（第一条紧贴现有内容）。
         * `desc` 下显示末尾在 **rank 低端**，整块要反转：否则 AI 给的第一条
         * （最靠近现有末端的那一级）会被排到新块的最外侧。
         * 空阶梯不反转 —— 那时整块就是全部内容，rank 升序映射到 desc 显示
         * 之后正好是「强在上、弱在下」（2.17.1）。
         */
        const ordered = isDesc && total > 0 ? [...cleaned].reverse() : cleaned;
        let rank = isDesc ? base - 1 : base;
        const stmt = db.prepare(
          `INSERT INTO novel_setting_levels
             (id, category_id, name, rank, aliases, note, sub_levels, power,
              parent_id, seg_from, seg_to, sub_pattern)
           VALUES (?, ?, ?, ?, '[]', ?, ?, NULL, NULL, NULL, NULL, ?)`,
        );
        for (const item of ordered) {
          // asc：base = max，故先 +1 再写；desc：base = min，同样先 +1 再写
          rank += 1;
          stmt.run(item.id, categoryId, item.name, rank, item.note, item.subLevels, item.subPattern);
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
      // 引用项只读（D2）
      if (isLevelInReferencedCategory(id)) return false;
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
    // 引用项只读（D2）
    if (isLevelInReferencedCategory(id)) return false;
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
      // 引用项只读（D2）：命中任一引用行即整批拒绝
      for (const update of updates) {
        if (isLevelInReferencedCategory(update.id)) return false;
      }
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
      // 引用项只读（D2）
      if (isLevelInReferencedCategory(levelId)) return false;
      const row = dbGet(
        "SELECT category_id, rank, sub_pattern, parent_id FROM novel_setting_levels WHERE id = ?",
        [levelId],
      ) as {
        category_id: string;
        rank: number;
        sub_pattern: string;
        parent_id: string | null;
      } | undefined;
      if (!row) return false;
      // 权威边界（1.39.1）：等级序列只支持两层 —— 子层级（parent_id 非空）
      // 不能再拆，否则「初级·第1段·第1段」三层嵌套无法在境界 chip 里表达。
      // UI 隐藏入口只是第二层，这里才是绕过 UI 也无效的拒绝。
      if (row.parent_id !== null) return false;
      // 收口（1.4x）：已拆出子行的根阶（parent_id 仍为 NULL 但已有行挂在本行下）
      // 也不能再拆 —— 组阶继续拆只会再造出第二层而非第三层，是数据质量隐患。
      // UI 对能判断的情形已禁用入口，这里连同上一道 parent_id 校验构成权威拒绝。
      const childCount = dbGet(
        "SELECT COUNT(*) AS count FROM novel_setting_levels WHERE parent_id = ?",
        [levelId],
      ) as { count: number };
      if (childCount.count > 0) return false;

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
              createSettingId("sl"),
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
    // 引用项只读（D2）
    if (isLevelInReferencedCategory(levelId)) return false;
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
      categories: readSnapshots("book", workId),
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
        "book",
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

  // ── 全局设定中心：引用 / 上架（D2 / D3） ────────────────────────────

  /**
   * 本书「从全局库选择」⇒ 建立引用（D2）。
   *
   * 把全局分类镜像成本书分类 + 全部等级镜像行（实时同步的依据）。已引用幂等返回
   * `true`；workId 为空 / 全局分类不存在 ⇒ `false`。跨域逻辑见 shared.`referenceGlobal`。
   */
  ipcMain.handle(
    "novel-setting-reference-global",
    (event, workId: string, globalCategoryId: string): boolean => {
      const ok = referenceGlobal(workId, globalCategoryId);
      // 引用建立（含幂等）成功 ⇒ 让正开着的全局窗口刷新「N 部书引用」计数。
      // 排除发送窗口自身，不与之形成回环。
      if (ok) notifyGlobalRefsChanged(event, ["category"]);
      return ok;
    },
  );

  /**
   * 本书「放置到全局」⇒ 复制快照上架（D3）。
   *
   * 同名冲突由 `conflict` 表达：`'cancel'` 返回 `{ok:false, conflict:true}` 交渲染层三选，
   * `'duplicate'` 新建「XXX（副本）」。本书侧保持不变。跨域逻辑见 shared.`publishGlobal`。
   */
  ipcMain.handle(
    "novel-setting-publish-global",
    (
      event,
      workId: string,
      categoryId: string,
      conflict: "duplicate" | "cancel",
    ): PublishToGlobalResult => {
      const result = publishGlobal(workId, categoryId, conflict);
      // 上架成功 ⇒ 全局库多了一条分类，其它窗口（含正开着的全局窗口）刷新列表与计数。
      // 冲突 / 失败（ok=false）不广播，避免无意义的全局重载。同样排除发送窗口。
      if (result.ok) notifyGlobalRefsChanged(event, ["category"]);
      return result;
    },
  );
}
