/**
 * 小说编辑器语义化 IPC handlers（PRD v0.4 §7 数据层落点）
 *
 * 职责：novel_* 表的读写编排，包括：
 * - 编辑器全量数据装载（novel-editor-load）
 * - 章节保存 + 增量快照同事务写入（novel-chapter-save，环形保留 20 版）
 * - 卷 / 章 / 要素 / 关联 / 灵感 / 伏笔的增改删
 * - 崩溃恢复标记（session 标记法：编辑器会话未正常关闭时，下次装载提示恢复）
 *
 * 边界：SQL 只出现在本文件与 db.ts；不导入 main.ts；
 * 渲染层通过 preload 暴露的 novel 命名空间调用，禁止裸拼 SQL。
 *
 * 存储：全部落在 **novel.db**（`electron/novel-db.ts`），与 checkin.db 分离。
 * 本文件的 `dbAll / dbGet / dbRun / getDb` 都是 novel.db 的封装别名 ——
 * 改动时不要从 checkin 的 `../db` 导入写通道，那会把数据写回 checkin 库里去。
 */
import { ipcMain, dialog } from "electron";
import { promises as fsp } from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import {
  novelAll as dbAll,
  novelGet as dbGet,
  novelRun as dbRun,
  getNovelDb as getDb,
  isNovelDbReady,
  NOVEL_SESSION_KEY,
} from "../novel-db";
import { buildNovelTemplateBook } from "../novel-template";
import { broadcastLinksChanged, workIdOfEntity } from "../novel-links-events";

// ── 行类型（snake_case，对应表结构） ──

interface NovelWorkRow {
  id: string;
  name: string;
  created_at: number;
  /** 题材（2.7.1 起）：可空，作者建书时可选可跳过 */
  genre: string | null;
}

interface NovelVolumeRow {
  id: string;
  work_id: string;
  name: string;
  sort: number;
}

interface NovelChapterRow {
  id: string;
  work_id: string;
  volume_id: string;
  title: string;
  content: string;
  word_count: number;
  status: string;
  sort: number;
  outline_note: string | null;
  updated_at: number;
  ai_summary: string | null;
  ai_summary_at: number | null;
  ai_summary_model: string | null;
  ai_summary_batch: string | null;
}

interface NovelSnapshotRow {
  id: string;
  chapter_id: string;
  content: string;
  word_count: number;
  delta_words: number;
  created_at: number;
}

interface NovelNoteRow {
  id: string;
  work_id: string;
  content: string;
  created_at: number;
  pinned: number;
  foreshadow_id: string | null;
}

interface NovelOutlineEntryRow {
  id: string;
  work_id: string;
  kind: string;
  volume_id: string;
  chapter_id: string | null;
  title: string;
  note: string;
  status: string;
  created_at: number;
}

interface NovelEntityRow {
  id: string;
  work_id: string;
  type: string;
  name: string;
  aliases: string;
  summary: string;
  content: string;
  fields: string;
  sort: number;
  created_at: number;
  updated_at: number;
}

interface NovelLinkRow {
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  note: string | null;
}

interface NovelSettingCategoryRow {
  id: string;
  work_id: string;
  name: string;
  color: string;
  kind: string;
  sort_order: number;
  note: string;
  sub_levels: number;
  carry_dir: string;
  sub_pattern: string;
  /** 1.4x 增量迁移列：非空 = 本分类引用（镜像）自某个全局分类 */
  source_global_id: string | null;
  /** 1.4x 增量迁移列：非空 = 原全局项已删除，已固化为本书副本 */
  detached_from_name: string | null;
}

interface NovelSettingLevelRow {
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
  /** 1.37.0：本阶专属小层命名模板；空串 = 沿用分类 */
  sub_pattern: string;
}

/** 等级项 DTO：一次取回全部等级项后按体系分组时用得到（避免 N+1 查询） */
// ── DTO 类型（camelCase，IPC 线格式，与渲染层领域模型结构一致） ──

/** 要素类型（与渲染层 types.ts 的 EntityType 保持一致，用户自建类型归 custom） */
export type NovelEntityTypeDto =
  | "character"
  | "location"
  | "faction"
  | "item"
  | "level_system"
  | "custom";

export interface NovelWorkDto {
  id: string;
  name: string;
  createdAt: number;
  /** 题材（可选）：空 = 未设置，AI 层按书名 + 要素弱兜底 */
  genre?: string | null;
}

/**
 * 题材归一：压空格 + 截断 + 空串归一为 `NULL`。
 *
 * 为什么空串要变 NULL：`''` 与「未设置」在 SQL 里是两回事（`IS NULL` 查不到
 * 空串），AI 层判断「有没有题材」只想要一个判据。存 NULL，读出来就是 undefined。
 */
function normalizeGenre(value?: string | null): string | null {
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 30);
}

export interface NovelVolumeDto {
  id: string;
  workId: string;
  name: string;
  sort: number;
}

export interface NovelChapterDto {
  id: string;
  workId: string;
  volumeId: string;
  title: string;
  content: string;
  wordCount: number;
  status: "draft" | "done";
  sort: number;
  updatedAt: number;
  outlineNote?: string;
}

export interface NovelSnapshotDto {
  id: string;
  chapterId: string;
  content: string;
  deltaWords: number;
  createdAt: number;
}

export interface NovelNoteDto {
  id: string;
  workId: string;
  content: string;
  createdAt: number;
  pinned: boolean;
  foreshadowId?: string;
}

export interface NovelOutlineEntryDto {
  id: string;
  workId: string;
  kind: "foreshadow";
  volumeId: string;
  chapterId?: string;
  title: string;
  note: string;
  status: "open" | "resolved";
  createdAt: number;
}

export interface NovelEntityDto {
  id: string;
  workId: string;
  type: string;
  name: string;
  aliases: string[];
  summary: string;
  content: string;
  fields: Record<string, string>;
  sort: number;
}

export interface NovelLinkDto {
  id: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string;
  note?: string;
}

/** 设定分类下的一条等级项（DTO，渲染层直接用） */
export interface NovelSettingLevelDto {
  id: string;
  categoryId: string;
  name: string;
  rank: number;
  aliases: string[];
  note: string;
  /** 本阶小层数（行囊境界换算按它展开） */
  subLevels: number;
  power: number | null;
  /** 拆分层级：非空表示派生自 parentId，占据 [segFrom, segTo] 小层段 */
  parentId: string | null;
  segFrom: number | null;
  segTo: number | null;
  /** 本阶专属小层命名模板；空串 = 沿用分类的 subPattern（1.37.0） */
  subPattern: string;
}

/** 设定分类（DTO）：kind='realm' 的那一条即「境界体系」 */
export interface NovelSettingCategoryDto {
  id: string;
  workId: string;
  name: string;
  color: string;
  kind: "realm" | "custom";
  sortOrder: number;
  note: string;
  /** 进位规则 */
  subLevels: number;
  carryDir: "asc" | "desc";
  subPattern: string;
  levels: NovelSettingLevelDto[];
  /** 非空 = 引用自全局中心（只读镜像；实时同步） */
  sourceGlobalId: string | null;
  /** 非空 = 原全局项已删除，已固化为本书副本（徽标文案用） */
  detachedFromName: string | null;
}

export interface NovelRecoveryDto {
  snapshotTime: number;
  deltaWords: number;
}

export interface NovelBundleDto {
  works: NovelWorkDto[];
  volumes: NovelVolumeDto[];
  chapters: NovelChapterDto[];
  entities: NovelEntityDto[];
  links: NovelLinkDto[];
  /** 小说设定：分类 + 其下的等级序列（取代原 levelSystems） */
  settings: NovelSettingCategoryDto[];
  notes: NovelNoteDto[];
  outlineEntries: NovelOutlineEntryDto[];
  recovery: NovelRecoveryDto | null;
}

/** 渲染层传入的章节排序补丁（重排 / 跨卷移动后批量落库） */
interface ChapterOrderUpdate {
  id: string;
  sort: number;
  volumeId: string;
}

/** 渲染层传入的卷排序补丁 */
interface VolumeOrderUpdate {
  id: string;
  sort: number;
}

// ── 快照策略（与渲染层 novel-config.ts 的 SAVE 保持同步） ──

const SNAPSHOT_KEEP = 20;
const SNAPSHOT_DELTA_WORDS = 500;
const SNAPSHOT_INTERVAL_MS = 300_000;

/** 编辑器会话标记键：running = 会话进行中；非 running = 上次已正常关闭 */
const SESSION_KEY = NOVEL_SESSION_KEY;

/**
 * 模板书籍的自动播种已**整条移除**（连同 `novel_seeded` 标记）。
 *
 * 原判据「works 为空且从未播种过」有两个绕不开的毛病：
 * 1. `seedTemplateBook` 是**清库重播种** —— 判据一旦误触发，用户的灵感
 *    （`work_id = ''` 的全局池）与行囊草稿会被一起抹掉；
 * 2. 判据依赖 config 里的 `novel_seeded`，而**老版本升级的用户没有这个键**，
 *    删光作品后立刻触发一次清库，表现为「删掉的书全回来了，还多一本模板书」。
 *
 * 现在的口径：**新用户默认空书架**，模板书只能经「重置为模板书籍」显式获取
 * （见 `novel-editor-reset-template`）。旧的 `novel_seeded` 键留在 config 里
 * 无副作用（没人再读它），不必清理。
 */

/**
 * 行囊里按 `character_id` 挂载的子表（十张，不含宿主表 `novel_pack_characters`
 * 与多态表 `novel_pack_modifiers`）。
 *
 * ⚠️ 这张清单必须覆盖 `readCharacterSnapshot` 会读到的**每一张**按 character_id
 * 挂载的表：漏一张，删作品后那张表的行就永远查不到、也删不掉（没有 UI 入口，
 * 也没有级联），只能靠清库。`novel_pack_presets` 就漏过一次（1.33.0 修复）。
 *
 * 删作品级联时必须**先删 modifiers 再删这里的 items / skills**：modifiers
 * 的归属是从宿主表反查的，宿主先没了子查询就变成空集，一条都删不掉。
 */
const PACK_CHILD_TABLES = [
  // 载体分组（1.39.0 二期）：挂在 character_id 上
  "novel_pack_groups",
  // 物品分类管理（1.40.0）：挂在 character_id 上
  "novel_pack_categories",
  "novel_pack_items",
  "novel_pack_skills",
  "novel_pack_attributes",
  // 属性映射（1.35.0）：挂在 character_id 上（不是 owner_id），漏了它删作品后
  // 映射行会一直留在库里，下次同一部书重建时按固定 id 撞主键
  "novel_pack_mappings",
  "novel_pack_slots",
  "novel_pack_presets",
  "novel_pack_unit_systems",
  "novel_pack_layouts",
  "novel_pack_records",
  "novel_pack_drafts",
] as const;

/**
 * 作品级表：挂在 `work_id` 上而不是 character_id（1.39.0 属性字典）。
 *
 * ⚠️ 不能并入 `PACK_CHILD_TABLES`：那张清单的删除语句按 character_id 过滤，
 * 属性定义行上没有这一列，套同一句 SQL 一行都删不到。
 */
const PACK_WORK_TABLES = ["novel_pack_attr_defs"] as const;

/** 生成带随机后缀的行 ID，避免同毫秒并发创建时碰撞 */
function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** JSON 列安全解析：string[] */
function parseAliases(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** JSON 列安全解析：Record<string, string> */
function parseFields(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function isChapterStatus(value: string): value is "draft" | "done" {
  return value === "draft" || value === "done";
}

function isEntryStatus(value: string): value is "open" | "resolved" {
  return value === "open" || value === "resolved";
}

/** 设定分类的默认小层命名（{n} 为层号占位符） */
export const DEFAULT_SUB_PATTERN = "第{n}层";

/** 设定分类的默认色点 */
export const DEFAULT_CATEGORY_COLOR = "#5B8DEF";

function isSettingKind(value: string): value is "realm" | "custom" {
  return value === "realm" || value === "custom";
}

function isCarryDir(value: string): value is "asc" | "desc" {
  return value === "asc" || value === "desc";
}

function setConfig(key: string, value: string): void {
  dbRun(
    `INSERT INTO novel_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now', 'localtime')`,
    [key, value],
  );
}

/** 写入 usage_log 埋点（R14）：payload 序列化失败不影响主流程 */
function logUsage(event: string, payload: Record<string, unknown>): void {
  try {
    dbRun("INSERT INTO novel_usage_log (event, payload, created_at) VALUES (?, ?, ?)", [
      event,
      JSON.stringify(payload),
      Date.now(),
    ]);
  } catch {
    // 埋点失败静默：绝不能影响编辑器主链路
  }
}

/**
 * `includeContent = false` 用于只要元数据的调用方（书架）——
 * 那时 SQL 根本不取 content 列，这里填空串占位。
 */
function toChapterDto(row: NovelChapterRow, includeContent = true): NovelChapterDto {
  return {
    id: row.id,
    workId: row.work_id,
    volumeId: row.volume_id,
    title: row.title,
    content: includeContent ? row.content : "",
    wordCount: row.word_count,
    status: isChapterStatus(row.status) ? row.status : "draft",
    sort: row.sort,
    updatedAt: row.updated_at,
    ...(row.outline_note !== null ? { outlineNote: row.outline_note } : {}),
    ...(row.ai_summary !== null ? { aiSummary: row.ai_summary } : {}),
    ...(row.ai_summary_at !== null ? { aiSummaryAt: row.ai_summary_at } : {}),
    ...(row.ai_summary_model !== null ? { aiSummaryModel: row.ai_summary_model } : {}),
    ...(row.ai_summary_batch !== null ? { aiSummaryBatch: row.ai_summary_batch } : {}),
  };
}

function toEntityDto(row: NovelEntityRow): NovelEntityDto {
  return {
    id: row.id,
    workId: row.work_id,
    type: row.type,
    name: row.name,
    aliases: parseAliases(row.aliases),
    summary: row.summary,
    content: row.content,
    fields: parseFields(row.fields),
    sort: row.sort,
  };
}

function toLinkDto(row: NovelLinkRow): NovelLinkDto {
  return {
    id: row.id,
    fromType: row.from_type,
    fromId: row.from_id,
    toType: row.to_type,
    toId: row.to_id,
    relation: row.relation,
    ...(row.note !== null ? { note: row.note } : {}),
  };
}

/**
 * 崩溃恢复信息（PRD R3 ③）
 *
 * 会话标记法：编辑器每次装载时把 config.novel_editor_session 置为 running，
 * 正常关闭（窗口 closed / 应用退出）时置回 closed。若下次装载时仍是 running，
 * 说明上次会话未走正常关闭流程（崩溃 / 断电），从最近快照构建恢复提示。
 */
/** 崩溃恢复只回溯最近 7 天的快照：再往前对「上次会话写了什么」没有意义 */
const RECOVERY_SNAPSHOT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 连续码字天数最多回溯多少天（也是 novel-usage-today 的时间窗宽度） */
const USAGE_ACTIVE_DAY_LIMIT = 400;

function buildRecovery(): NovelRecoveryDto | null {
  const session = dbGet("SELECT value FROM novel_config WHERE key = ?", [SESSION_KEY]) as
    | { value?: string }
    | undefined;
  if (session?.value !== "running") return null;

  // 挑「快照与当前正文不一致」的最新一条：
  // - 只取全局最新快照会把结论钉死在「恰好最后写过快照的那一章」上 —— A 章写满
  //   500 字产生快照后切到 B 章写几十字就崩溃，B 的改动会被完全忽略；
  // - JOIN 章节表同时排除了 chapter_id 已悬空的孤儿快照（删章后残留），
  //   否则一条孤儿快照因为 created_at 最新会把恢复提示彻底屏蔽。
  // ⚠️ 必须带时间下界：崩溃恢复只在乎「上次会话」留下的快照，翻一年前的没有意义。
  // 没有下界时 SQLite 要对整张快照表逐行读出 content 与正文做整串比较
  // （快照是正文的整份拷贝，每章保留 20 版，2000 章就是 4 万条 × 3000 字），
  // 而这条查询挂在装载通道上 —— 每次打开书架都要跑一遍。
  // 配合 idx_novel_snapshots_created 从最新往回扫，命中第一条即停。
  const mismatch = dbGet(
    `SELECT s.created_at AS snapshot_time, s.word_count AS snapshot_words,
            c.word_count AS chapter_words
       FROM novel_snapshots s
       JOIN novel_chapters c ON c.id = s.chapter_id
      WHERE s.created_at >= ?
        AND c.content <> s.content
      ORDER BY s.created_at DESC LIMIT 1`,
    [Date.now() - RECOVERY_SNAPSHOT_WINDOW_MS],
  ) as
    | { snapshot_time: number; snapshot_words: number; chapter_words: number }
    | undefined;
  if (!mismatch) return null;

  return {
    snapshotTime: mismatch.snapshot_time,
    deltaWords: Math.max(0, mismatch.chapter_words - mismatch.snapshot_words),
  };
}

/** 本地日期键（YYYY-MM-DD）：连续码字天数按主进程本地时区计算 */
function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 连续码字天数（书架统计 R32）：从今天（或昨天）起逐日向过去回溯，
 * 统计有 chapter_save 事件的连续天数。今天还没写不判负——从昨天续算。
 */
function computeStreakDays(activeDays: ReadonlySet<string>, today: Date): number {
  const cursor = new Date(today);
  if (!activeDays.has(localDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!activeDays.has(localDayKey(cursor))) return 0;
  }
  let streak = 0;
  while (activeDays.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function registerNovelHandlers(): void {
  // ── 通用 config 读写（R5 设置持久化 / R6 位置记忆共用） ──
  // 库未就绪（未登录 / 正在退出）时优雅降级而不是抛错 —— 退出销毁窗口的
  // 过程中渲染层仍可能发来一次 config 写入，抛穿只会刷「尚未初始化 novel 数据」
  const requireReady = (): boolean => {
    if (isNovelDbReady()) return true;
    console.error("[novel-config] novel.db 未就绪（未登录或正在退出），本次读写跳过");
    return false;
  };

  ipcMain.handle("novel-config-get", (_event, key: string) => {
    if (!requireReady()) return null;
    const row = dbGet("SELECT value FROM novel_config WHERE key = ?", [key]) as
      | { value?: string }
      | undefined;
    return row?.value ?? null;
  });

  ipcMain.handle("novel-config-set", (_event, key: string, value: string) => {
    if (!requireReady()) return false;
    setConfig(key, value);
    return true;
  });

  /**
   * 开启编辑器会话（崩溃恢复标记的**唯一**写入口）。
   *
   * 标记必须与「真正进了编辑器」这件事绑定：装载数据是通用动作，开个行囊
   * 面板也会做，用它当判据会把没进过编辑器的会话也记成「进行中」。
   * 关闭侧见 `markNovelSessionClosed()`（NovelWindow closed / 应用退出）。
   */
  ipcMain.handle("novel-session-open", () => {
    setConfig(SESSION_KEY, "running");
    // R14：编辑器唤起埋点（北极星「打开→开始输入」漏斗的起点）
    logUsage("editor_open", {});
    return true;
  });

  // ── 作品管理（R29） ──

  // 新建作品（id 由渲染层生成，与卷 / 章一致）
  ipcMain.handle("novel-work-add", (_event, work: NovelWorkDto) => {
    const name = work.name.trim();
    if (!name) return false;
    dbRun(
      "INSERT INTO novel_works (id, name, created_at, genre) VALUES (?, ?, ?, ?)",
      [work.id, name, work.createdAt, normalizeGenre(work.genre)],
    );
    return true;
  });

  // 作品重命名（空名不落）
  ipcMain.handle("novel-work-rename", (_event, id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    return dbRun("UPDATE novel_works SET name = ? WHERE id = ?", [trimmed, id]).changes > 0;
  });

  // 设置作品题材（传空即清空）：建书时允许跳过，之后随时可补
  ipcMain.handle("novel-work-set-genre", (_event, id: string, genre: string | null) => {
    if (!id) return false;
    return (
      dbRun("UPDATE novel_works SET genre = ? WHERE id = ?", [
        normalizeGenre(genre),
        id,
      ]).changes > 0
    );
  });

  // 删除作品：卷章快照 / 要素关联 / 灵感伏笔 / 等级体系 / 行囊级联清理，单事务
  ipcMain.handle("novel-work-delete", (_event, id: string) => {
    const db = getDb();
    const apply = db.transaction(() => {
      // ⚠️ 全部走集合删除（子查询 IN），不要在 JS 里逐行循环：
      // 长篇上千章 / 上百要素时逐条 DELETE 要重新 prepare 上千次，
      // 实测是「删一部书卡几秒」的来源。级联顺序仍然是从叶到根。
      dbRun(
        `DELETE FROM novel_snapshots
          WHERE chapter_id IN (SELECT id FROM novel_chapters WHERE work_id = ?)`,
        [id],
      );
      dbRun("DELETE FROM novel_chapters WHERE work_id = ?", [id]);
      dbRun("DELETE FROM novel_volumes WHERE work_id = ?", [id]);
      dbRun("DELETE FROM novel_notes WHERE work_id = ?", [id]);
      dbRun("DELETE FROM novel_outline_entries WHERE work_id = ?", [id]);

      // links 的两端都可能指向要素：先删关联，再删要素本身
      dbRun(
        `DELETE FROM novel_links
          WHERE from_id IN (SELECT id FROM novel_entities WHERE work_id = ?)
             OR to_id IN (SELECT id FROM novel_entities WHERE work_id = ?)`,
        [id, id],
      );
      dbRun("DELETE FROM novel_entities WHERE work_id = ?", [id]);

      // 设定：先摘「当前境界」关联，再删等级项，最后删分类。
      // to_type='level' 现在指向 novel_setting_levels.id，级联口径与旧等级表一致。
      dbRun(
        `DELETE FROM novel_links
          WHERE to_type = 'level'
            AND to_id IN (
              SELECT id FROM novel_setting_levels
               WHERE category_id IN (SELECT id FROM novel_setting_categories WHERE work_id = ?)
            )`,
        [id],
      );
      dbRun(
        `DELETE FROM novel_setting_levels
          WHERE category_id IN (SELECT id FROM novel_setting_categories WHERE work_id = ?)`,
        [id],
      );
      dbRun("DELETE FROM novel_setting_categories WHERE work_id = ?", [id]);

      // 行囊（CharacterPack）：漏掉这一整棵会留下永远查不到也删不掉的孤儿 ——
      // pack 角色只按作品内部拖拽 narrative 访问，作品没了就再无任何入口。
      // 顺序同 pack-save：多态表 modifiers 靠子查询从宿主反查归属，
      // 必须先于 items / skills 删除，否则子查询变空集、一条都删不掉。
      // 多态加成表的三条删除（status 直挂角色、item / skill 反查宿主）
      // 必须整体先于 items / skills 删除：子查询一旦变空集就一条都删不掉
      dbRun(
        `DELETE FROM novel_pack_modifiers
          WHERE owner_type = 'status'
            AND owner_id IN (SELECT id FROM novel_pack_characters WHERE work_id = ?)`,
        [id],
      );
      dbRun(
        `DELETE FROM novel_pack_modifiers
          WHERE owner_type = 'item'
            AND owner_id IN (
              SELECT id FROM novel_pack_items
               WHERE character_id IN (SELECT id FROM novel_pack_characters WHERE work_id = ?)
            )`,
        [id],
      );
      dbRun(
        `DELETE FROM novel_pack_modifiers
          WHERE owner_type = 'skill'
            AND owner_id IN (
              SELECT id FROM novel_pack_skills
               WHERE character_id IN (SELECT id FROM novel_pack_characters WHERE work_id = ?)
            )`,
        [id],
      );
      for (const table of PACK_CHILD_TABLES) {
        dbRun(
          `DELETE FROM ${table}
            WHERE character_id IN (SELECT id FROM novel_pack_characters WHERE work_id = ?)`,
          [id],
        );
      }
      // 作品级表按 work_id 删（见 PACK_WORK_TABLES 的注释）
      for (const table of PACK_WORK_TABLES) {
        dbRun(`DELETE FROM ${table} WHERE work_id = ?`, [id]);
      }
      dbRun("DELETE FROM novel_pack_characters WHERE work_id = ?", [id]);

      // 关系图画布记忆（R27 / S2）：键 = `novel_rel_graph_v1:<workId>:<graphId>`。
      // 按前缀删，一本书一张图（将来多视图也不用改这里）。位置固定在行囊级联
      // 之后、作品行之前 —— 此时 work_id 仍可用，且不与 pack 的多态子查询抢顺序。
      dbRun("DELETE FROM novel_config WHERE key LIKE ?", [`novel_rel_graph_v1:${id}:%`]);

      // 作品行本身也要删：漏掉会导致「删光后 reload 复活全部作品名」
      dbRun("DELETE FROM novel_works WHERE id = ?", [id]);
    });
    apply();
    return true;
  });

  /*
   * 删除章节 = 移入回收站（软删除，2.4.0）。
   *
   * 只打 deleted_at 标记：正文 / 历史快照 / 大纲条目全都留在原处，恢复就是
   * 把这一列清空，不需要任何重建。物理销毁走 `novel-chapter-purge`。
   *
   * ⚠️ 快照这里**不删**（旧实现是 `DELETE FROM novel_snapshots`）：软删除期
   * 用户随时可能恢复，删了快照就等于「恢复回来的章节没有历史版本」。
   */
  ipcMain.handle(
    "novel-chapter-delete",
    (_event, id: string) =>
      dbRun(
        "UPDATE novel_chapters SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
        [Date.now(), id],
      ).changes > 0,
  );

  // 删除章节（彻底）：历史快照同事务清理，不可恢复
  ipcMain.handle("novel-chapter-purge", (_event, id: string) => {
    const db = getDb();
    const apply = db.transaction(() => {
      dbRun("DELETE FROM novel_snapshots WHERE chapter_id = ?", [id]);
      dbRun("DELETE FROM novel_chapters WHERE id = ?", [id]);
    });
    apply();
    return true;
  });

/**
 * 模板书籍播种（单事务）：清空 novel_* 业务表后写入模板数据。
 *
 * **唯一的调用方**是「一键重置为模板书籍」入口（UI 层已有二次确认）。
 * 它曾经还被「确凿的首次使用」自动调用，但那让「删光作品」与「升级用户」
 * 都可能撞上这次清库 —— 现已整条移除（见上方 SEEDED 段注释）。
 *
 * 注意：即便只有手动一条路径，它依然是**破坏性操作** —— 会清空当前用户的
 * 全部作品 / 灵感 / 行囊。唯一的例外是灵感：只清 `work_id <> ''` 的行，
 * 未归属的全局灵感池保留。
 *
 * 模板由 electron/novel-template.ts 实时构建，改模板定义后重置即生效。
 * 排版设置（novel_editor_settings）保留，续写位置（novel_editor_position）
 * 一并清除，避免指向已不存在的章节。
 */
function seedTemplateBook(): {
  volumes: number;
  chapters: number;
  words: number;
  entities: number;
} {
  const db = getDb();
  const template = buildNovelTemplateBook();
  const now = Date.now();

  const apply = db.transaction(() => {
    // 清库：快照先行（与章节删除同一顺序），其余表无外键约束可任意序
    dbRun("DELETE FROM novel_snapshots");
    dbRun("DELETE FROM novel_chapters");
    dbRun("DELETE FROM novel_volumes");
    dbRun("DELETE FROM novel_works");
    // ⚠️ 灵感只清归属作品的行：work_id = '' 是 novel-note-move(id, '') 的合法目标
    // （「退回未归属」的全局灵感池），与任何作品都无关，清库不该动它
    dbRun("DELETE FROM novel_notes WHERE work_id <> ''");
    dbRun("DELETE FROM novel_outline_entries");
    dbRun("DELETE FROM novel_links");
    dbRun("DELETE FROM novel_entities");
    dbRun("DELETE FROM novel_setting_levels");
    dbRun("DELETE FROM novel_setting_categories");
    // 设定模板刻意**不清**：它不按作品隔离，存在的意义就是换书复用
    // 行囊（CharacterPack）随作品一起清空：作品 id 会重建，行囊角色留着会成孤儿
    // 清单与 PACK_CHILD_TABLES 同源，避免「清库漏一张、级联漏一张」各自漂移
    dbRun("DELETE FROM novel_pack_modifiers");
    for (const table of PACK_CHILD_TABLES) dbRun(`DELETE FROM ${table}`);
    for (const table of PACK_WORK_TABLES) dbRun(`DELETE FROM ${table}`);
    dbRun("DELETE FROM novel_pack_characters");
    // 埋点与会话标记也一并清：它们是「这本小说的写作记录」，
    // 留着会让「今日新增字数 / 连续码字天数」在重置后仍算旧账
    dbRun("DELETE FROM novel_usage_log");
    dbRun("DELETE FROM novel_config WHERE key = ?", [SESSION_KEY]);
    // 位置记忆指向的章节即将不存在，直接清除
    dbRun("DELETE FROM novel_config WHERE key = 'novel_editor_position'");

    dbRun("INSERT INTO novel_works (id, name, created_at) VALUES (?, ?, ?)", [
      template.workId,
      template.workName,
      now,
    ]);
    for (const volume of template.volumes) {
      dbRun("INSERT INTO novel_volumes (id, work_id, name, sort) VALUES (?, ?, ?, ?)", [
        volume.id,
        template.workId,
        volume.name,
        volume.sort,
      ]);
    }
    for (const chapter of template.chapters) {
      dbRun(
        `INSERT INTO novel_chapters (id, work_id, volume_id, title, content, word_count, status, sort, outline_note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          chapter.id,
          template.workId,
          chapter.volumeId,
          chapter.title,
          chapter.content,
          chapter.wordCount,
          chapter.status,
          chapter.sort,
          chapter.outlineNote,
          now,
        ],
      );
    }
    for (const entity of template.entities) {
      dbRun(
        `INSERT INTO novel_entities (id, work_id, type, name, aliases, summary, content, fields, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entity.id,
          template.workId,
          entity.type,
          entity.name,
          JSON.stringify(entity.aliases),
          entity.summary,
          entity.content,
          JSON.stringify(entity.fields),
          entity.sort,
          now,
          now,
        ],
      );
    }
    for (const link of template.links) {
      dbRun(
        `INSERT INTO novel_links (id, from_type, from_id, to_type, to_id, relation, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [link.id, link.fromType, link.fromId, link.toType, link.toId, link.relation, null],
      );
    }
    for (const category of template.settings) {
      dbRun(
        `INSERT INTO novel_setting_categories
           (id, work_id, name, color, kind, sort_order, note, sub_levels, carry_dir, sub_pattern)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          category.id,
          template.workId,
          category.name,
          category.color ?? DEFAULT_CATEGORY_COLOR,
          category.kind ?? "custom",
          category.sortOrder ?? 1,
          category.note ?? "",
          category.subLevels ?? 1,
          category.carryDir ?? "asc",
          category.subPattern ?? DEFAULT_SUB_PATTERN,
        ],
      );
      for (const level of category.levels) {
        dbRun(
          `INSERT INTO novel_setting_levels
             (id, category_id, name, rank, aliases, note, sub_levels, power,
              parent_id, seg_from, seg_to, sub_pattern)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
          [
            level.id,
            category.id,
            level.name,
            level.rank,
            JSON.stringify(level.aliases ?? []),
            level.note ?? "",
            level.subLevels ?? 1,
            level.power ?? null,
            typeof level.subPattern === "string" ? level.subPattern : "",
          ],
        );
      }
    }
    for (const note of template.notes) {
      dbRun(
        `INSERT INTO novel_notes (id, work_id, content, created_at, pinned, foreshadow_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [note.id, template.workId, note.content, now, note.pinned ? 1 : 0, note.foreshadowId],
      );
    }
    for (const entry of template.outlineEntries) {
      dbRun(
        `INSERT INTO novel_outline_entries (id, work_id, kind, volume_id, chapter_id, title, note, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          template.workId,
          entry.kind,
          entry.volumeId,
          entry.chapterId,
          entry.title,
          entry.note,
          entry.status,
          now,
        ],
      );
    }

    // ── 模板行囊（CharacterPack）：一份填满的范例，而不是空壳 ──
    // 主角直接绑到模板里的沈青梧，而模板第 9 条关联已把她的「当前境界」落在凝丹，
    // 所以打开行囊就能看到「行囊 ↔ 实体面板同源」这条链路是通的（PRD §9.7）
    const pack = template.pack;
    dbRun(
      `INSERT INTO novel_pack_characters
         (id, work_id, name, avatar, is_protagonist, entity_id, realm_at, note, sort_order)
       VALUES (?, ?, ?, NULL, 1, ?, NULL, ?, 1)`,
      [pack.character.id, template.workId, pack.character.name, pack.character.entityId, pack.character.note],
    );
    for (const def of pack.attrDefs) {
      dbRun(
        `INSERT INTO novel_pack_attr_defs
           (id, work_id, key, name, group_name, unit, decimals, default_value, sort_order)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          def.id,
          template.workId,
          def.name,
          def.groupName,
          def.unit,
          def.decimals,
          def.defaultValue,
          def.sortOrder,
        ],
      );
    }
    for (const value of pack.attrValues) {
      dbRun(
        `INSERT INTO novel_pack_attributes
           (id, character_id, def_id, base_value)
         VALUES (?, ?, ?, ?)`,
        [value.id, pack.character.id, value.defId, value.baseValue],
      );
    }
    for (const mapping of pack.mappings) {
      dbRun(
        `INSERT INTO novel_pack_mappings
           (id, character_id, source_attr_id, target_attr_id, rate, note, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          mapping.id,
          pack.character.id,
          mapping.sourceAttrId,
          mapping.targetAttrId,
          mapping.rate,
          mapping.note,
          mapping.sortOrder,
        ],
      );
    }
    for (const slot of pack.slots) {
      dbRun(
        `INSERT INTO novel_pack_slots
           (id, character_id, name, capacity, accepts, enabled, note, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          slot.id,
          pack.character.id,
          slot.name,
          slot.capacity,
          JSON.stringify(slot.accepts),
          slot.enabled ? 1 : 0,
          slot.note,
          slot.sortOrder,
        ],
      );
    }
    for (const group of pack.groups) {
      dbRun(
        `INSERT INTO novel_pack_groups
           (id, character_id, name, icon, can_equip, can_enable, prof_scheme_id, enabled, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          group.id,
          pack.character.id,
          group.name,
          group.icon,
          group.canEquip ? 1 : 0,
          group.canEnable ? 1 : 0,
          group.profSchemeId || null,
          group.enabled ? 1 : 0,
          group.sortOrder,
        ],
      );
    }
    for (const item of pack.items) {
      dbRun(
        `INSERT INTO novel_pack_items
           (id, character_id, name, category, qty, rarity, icon, desc, tags,
            equipped_slot_id, slot_index, group_id, source_chapter_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, '[]', ?, ?, ?, NULL, ?)`,
        [
          item.id,
          pack.character.id,
          item.name,
          item.category,
          item.qty,
          item.rarity,
          item.desc,
          item.equippedSlotId || null,
          item.slotIndex,
          item.groupId || "",
          now,
        ],
      );
    }
    for (const skill of pack.skills) {
      dbRun(
        `INSERT INTO novel_pack_skills
           (id, character_id, name, desc, enabled, group_id, proficiency_raw, tags, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
        [
          skill.id,
          pack.character.id,
          skill.name,
          skill.desc,
          skill.enabled ? 1 : 0,
          skill.groupId || "",
          skill.proficiencyRaw,
          skill.sortOrder,
        ],
      );
    }
    for (const modifier of pack.modifiers) {
      dbRun(
        `INSERT INTO novel_pack_modifiers
           (id, owner_type, owner_id, nature, name, target_attr_id, op, value, value_unit,
            scale_by_proficiency, active, default_on, cost, cooldown, duration, target,
            trigger, condition, note, disabled, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          modifier.id,
          modifier.ownerType,
          modifier.ownerId,
          modifier.nature,
          modifier.name,
          modifier.targetAttrId || null,
          modifier.op,
          modifier.value,
          modifier.valueUnit || null,
          modifier.scaleByProficiency ? 1 : 0,
          modifier.active ? 1 : 0,
          modifier.defaultOn ? 1 : 0,
          modifier.cost || null,
          modifier.cooldown,
          modifier.duration || null,
          modifier.target || null,
          modifier.trigger || null,
          modifier.condition || null,
          modifier.note,
          modifier.disabled ? 1 : 0,
          modifier.sortOrder,
        ],
      );
    }
    for (const system of pack.unitSystems) {
      dbRun(
        `INSERT INTO novel_pack_unit_systems
           (id, character_id, name, kind, levels, config, is_default, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          system.id,
          pack.character.id,
          system.name,
          system.kind,
          JSON.stringify(system.levels),
          JSON.stringify(system.config),
          system.isDefault ? 1 : 0,
          system.sortOrder,
        ],
      );
    }
    for (const layout of pack.layouts) {
      dbRun(
        `INSERT INTO novel_pack_layouts (character_id, module_key, enabled, sort_order)
         VALUES (?, ?, ?, ?)`,
        [pack.character.id, layout.moduleKey, layout.enabled ? 1 : 0, layout.sortOrder],
      );
    }
  });
  apply();

  return {
    volumes: template.volumes.length,
    chapters: template.chapters.length,
    words: template.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    entities: template.entities.length,
  };
}

// ── 一键重置为模板书籍（调试功能）：清库重播种，返回重置摘要 ──────────
ipcMain.handle("novel-editor-reset-template", () => seedTemplateBook());

  // 全量装载：编辑器启动一次拉取所有 novel_* 表 + 崩溃恢复信息
  //
  // ⚠️ 这里**不做任何自动播种**：新用户打开小说窗口就是空书架（由 UI 引导
  // 「新建作品 / 导入书籍」），模板书只能经「重置为模板书籍」手动获取。
  //
  // 曾经的实现是「works 为空且 novel_seeded 未落过 → seedTemplateBook()」，
  // 它有两个绕不开的毛病，所以整条删除：
  // 1. seedTemplateBook 是**清库重播种**，只要判据被误触发就会连用户灵感
  //    （work_id = '' 的全局池）与行囊草稿一起抹掉；
  // 2. 判据依赖 config 里的 novel_seeded，而**老版本升级上来的用户没有这个键** ——
  //    他们删光自己的作品的下一刻就会触发一次清库，表现为「删掉的书全回来了，
  //    还多出一本模板书」。判据天生不可靠，不如不判。
  ipcMain.handle("novel-editor-load", (_event, includeContent: boolean = true) => {
    // ⚠️ 回收站（deleted_at）必须在装载层就过滤掉：卷章 / 要素 / 行囊都还在库里
    // （软删除只标记作品行），漏掉这条会让「已删除的作品」照旧出现在书架，
    // 并且它的章节还会参与续写位置与统计。彻底删除 see novel-work-delete。
    const works = dbAll(
      "SELECT * FROM novel_works WHERE deleted_at IS NULL ORDER BY created_at",
    ) as NovelWorkRow[];

    /*
     * ⚠️ 卷 / 章同样要在这里过滤回收站（2.4.0）。软删除只给卷章行打时间戳，
     * 正文与快照仍在库里 —— 漏掉这两条，删掉的章节会照旧出现在章节目录里，
     * 而且还会参与卷章计数与「续写位置」的定位。
     */
    const volumes = (
      dbAll(
        "SELECT * FROM novel_volumes WHERE deleted_at IS NULL ORDER BY sort",
      ) as NovelVolumeRow[]
    ).map((row) => ({ id: row.id, workId: row.work_id, name: row.name, sort: row.sort }));
    /*
     * ⚠️ 正文是这条通道里唯一的大字段，且**书架根本不用它**（只算章节数 / 字数 /
     * 状态）。原先无条件 `SELECT *`，打开一次书架要把全书正文拉过 IPC：
     * 2000 章 × 3000 字 ≈ 600 万字符，JS 侧 UTF-16 约 12MB，还要经
     * structured-clone 双份驻留并同步阻塞主进程与渲染进程。
     * 书架显式传 false，只取元数据列。
     */
    const chapters = (dbAll(
      includeContent
        ? "SELECT * FROM novel_chapters WHERE deleted_at IS NULL"
        : "SELECT id, work_id, volume_id, title, word_count, status, sort, updated_at, outline_note, ai_summary, ai_summary_at, ai_summary_model, ai_summary_batch FROM novel_chapters WHERE deleted_at IS NULL",
    ) as NovelChapterRow[]).map((row) => toChapterDto(row, includeContent));
    const entities = (dbAll("SELECT * FROM novel_entities ORDER BY sort") as NovelEntityRow[]).map(
      toEntityDto,
    );
    const links = (dbAll("SELECT * FROM novel_links") as NovelLinkRow[]).map(toLinkDto);

    // 设定：等级项一次取回后在 JS 分组（每个分类一条 SQL 会变成 N+1）
    const settingLevelRows = dbAll(
      "SELECT * FROM novel_setting_levels ORDER BY category_id, rank",
    ) as NovelSettingLevelRow[];
    const levelsByCategory = new Map<string, NovelSettingLevelDto[]>();
    for (const level of settingLevelRows) {
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
    const settings = (
      dbAll("SELECT * FROM novel_setting_categories ORDER BY sort_order") as NovelSettingCategoryRow[]
    ).map((category) => ({
      id: category.id,
      workId: category.work_id,
      name: category.name,
      color: category.color,
      kind: isSettingKind(category.kind) ? category.kind : "custom",
      sortOrder: category.sort_order,
      note: category.note ?? "",
      subLevels: category.sub_levels ?? 1,
      carryDir: isCarryDir(category.carry_dir) ? category.carry_dir : "asc",
      subPattern: category.sub_pattern ?? DEFAULT_SUB_PATTERN,
      levels: levelsByCategory.get(category.id) ?? [],
      // 1.4x：引用态透出（渲染层据此显示只读徽标 / 固化提示）
      sourceGlobalId: category.source_global_id ?? null,
      detachedFromName: category.detached_from_name ?? null,
    }));

    const notes = (dbAll("SELECT * FROM novel_notes") as NovelNoteRow[]).map((row) => ({
      id: row.id,
      workId: row.work_id,
      content: row.content,
      createdAt: row.created_at,
      pinned: row.pinned === 1,
      ...(row.foreshadow_id !== null ? { foreshadowId: row.foreshadow_id } : {}),
    }));

    /*
     * ⚠️ 指向已删卷 / 已删章节的大纲条目必须挡在装载层之外：伏笔挂在具体卷章上，
     * 卷章进了回收站却在面板里照旧列着，点进去就是一个不存在的目标。
     *
     * 数据本身**不删**（软删除时没动这张表）—— 卷章恢复后条目自动重现。
     * 这里用已装载的在架集合做内存过滤，而不是再写一条带子查询的 SQL：卷章两个
     * 集合本来就在手上，多打一遍库没有收益。
     */
    const liveVolumeIds = new Set(volumes.map((volume) => volume.id));
    const liveChapterIds = new Set(chapters.map((chapter) => chapter.id));
    const outlineEntries = (dbAll(
      "SELECT * FROM novel_outline_entries",
    ) as NovelOutlineEntryRow[])
      .filter(
        (row) =>
          liveVolumeIds.has(row.volume_id) &&
          (row.chapter_id == null || liveChapterIds.has(row.chapter_id)),
      )
      .map((row) => ({
        id: row.id,
        workId: row.work_id,
        kind: "foreshadow" as const,
        volumeId: row.volume_id,
        ...(row.chapter_id !== null ? { chapterId: row.chapter_id } : {}),
        title: row.title,
        note: row.note,
        status: isEntryStatus(row.status) ? row.status : "open",
        createdAt: row.created_at,
      }));

    /**
     * ⚠️ 这里**不再**置会话标记、也不再上报 `editor_open`。
     *
     * 本通道是通用数据装载，不止编辑器在用：书架（`bookshelf-service`）与
     * 行囊「绑定主角」下拉（`fetchPackBindableEntities`）都调它。把
     * `running` 写在这里，等于「打开过行囊」也会被记为「编辑器会话进行中」——
     * 而清除标记只发生在 NovelWindow 的 closed 与应用退出，PackWindow 关掉
     * 时没人清 → 下次启动凭空弹出「检测到未正常关闭」。
     * 标记改由 `novel-session-open` 显式开启（只有真正进入编辑器才会调）。
     */
    const recovery = buildRecovery();

    const bundle: NovelBundleDto = {
      works: works.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        // 题材：老库该列为 NULL → 归一成 undefined，渲染层只需判真值
        genre: row.genre ?? undefined,
      })),
      volumes,
      chapters,
      entities,
      links,
      settings,
      notes,
      outlineEntries,
      recovery,
    };
    return bundle;
  });

  // 章节正文保存：保存 + 增量快照 + 埋点同事务（PRD §7 / R14）
  ipcMain.handle(
    "novel-chapter-save",
    (_event, id: string, content: string, wordCount: number) => {
      const db = getDb();
      const now = Date.now();
      const save = db.transaction(() => {
        const chapter = dbGet(
          "SELECT word_count FROM novel_chapters WHERE id = ? AND deleted_at IS NULL",
          [id],
        ) as { word_count?: number | null } | undefined;
        // ⚠️ 章节不存在就中止：继续跑会写一条 chapter_id 悬空的孤儿快照，
        // 而崩溃恢复挑的是「最新一条快照」—— 孤儿快照时间戳最新，会把真正
        // 需要恢复的那次改动屏蔽掉。宁可报错也不能污染恢复链路。
        // 已进回收站的章节同样按「不存在」处理：删除瞬间压在队列里的自动保存
        // 不能把回收站里的正文改掉，否则恢复出来的就不是删除那一刻的样子了。
        if (!chapter) return false;
        const delta = wordCount - (chapter.word_count ?? 0);
        // 只取用到的两列：这里是每次自动保存都要跑的高频路径，
        // SELECT * 会白读一份完整正文（长章 20KB+）却一次都不用
        const last = dbGet(
          "SELECT word_count, created_at FROM novel_snapshots WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1",
          [id],
        ) as { word_count: number; created_at: number } | undefined;
        const shouldSnapshot =
          !last ||
          wordCount - last.word_count >= SNAPSHOT_DELTA_WORDS ||
          now - last.created_at >= SNAPSHOT_INTERVAL_MS;
        if (shouldSnapshot) {
          dbRun(
            "INSERT INTO novel_snapshots (id, chapter_id, content, word_count, delta_words, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [createId("s"), id, content, wordCount, wordCount - (last?.word_count ?? 0), now],
          );
          // 环形保留：只留最近 SNAPSHOT_KEEP 版
          dbRun(
            `DELETE FROM novel_snapshots WHERE chapter_id = ? AND id IN (
               SELECT id FROM novel_snapshots WHERE chapter_id = ?
               ORDER BY created_at DESC LIMIT -1 OFFSET ?
             )`,
            [id, id, SNAPSHOT_KEEP],
          );
          logUsage("snapshot", { chapterId: id, words: wordCount });
        }
        dbRun(
          "UPDATE novel_chapters SET content = ?, word_count = ?, updated_at = ? WHERE id = ?",
          [content, wordCount, now, id],
        );
        // R14：保存事件带净增字数（负值 = 删字回退），今日新增 = 当日 delta 求和
        logUsage("chapter_save", { chapterId: id, delta, words: wordCount });
        return true;
      });
      return save() === true;
    },
  );

  // 章节历史快照列表（快照抽屉按需加载）
  ipcMain.handle("novel-snapshot-list", (_event, chapterId: string) =>
    (dbAll(
      "SELECT * FROM novel_snapshots WHERE chapter_id = ? ORDER BY created_at DESC",
      [chapterId],
    ) as NovelSnapshotRow[]).map((row) => ({
      id: row.id,
      chapterId: row.chapter_id,
      content: row.content,
      deltaWords: row.delta_words,
      createdAt: row.created_at,
    })),
  );

  // 新建章节（渲染层已生成 id，主进程只负责落库）
  ipcMain.handle("novel-chapter-add", (_event, chapter: NovelChapterDto) => {
    dbRun(
      `INSERT INTO novel_chapters (id, work_id, volume_id, title, content, word_count, status, sort, outline_note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        chapter.id,
        chapter.workId,
        chapter.volumeId,
        chapter.title,
        chapter.content,
        chapter.wordCount,
        chapter.status,
        chapter.sort,
        chapter.updatedAt,
      ],
    );
    return true;
  });

  // 章节重命名
  ipcMain.handle("novel-chapter-rename", (_event, id: string, title: string) => {
    return dbRun("UPDATE novel_chapters SET title = ? WHERE id = ?", [title, id]).changes > 0;
  });

  // 章节状态切换（草稿 / 完稿）
  ipcMain.handle("novel-chapter-status", (_event, id: string, status: string) => {
    if (!isChapterStatus(status)) return false;
    return dbRun("UPDATE novel_chapters SET status = ? WHERE id = ?", [status, id]).changes > 0;
  });

  // 章节大纲梗概保存（空串清除 → NULL）
  ipcMain.handle("novel-chapter-outline", (_event, id: string, note: string) => {
    return (
      dbRun("UPDATE novel_chapters SET outline_note = ? WHERE id = ?", [
        note.trim() ? note : null,
        id,
      ]).changes > 0
    );
  });

  // R-AI-09：章节 AI 摘要落库。四列同写（正文 / 生成时间 / 来源模型 / 批次），
  // 来源标记（model + batch）是 M6 溯源的一部分——手工编辑摘要时上层传空 model
  // 以清空来源标记，区分「AI 生成」与「自己写的」。
  ipcMain.handle(
    "novel-chapter-summary-save",
    (
      _event,
      id: string,
      payload: {
        summary: string;
        /** 来源模型名；空串 = 手工编辑，清空来源标记 */
        model?: string;
        /** 来源批次 id（M6 溯源，供「按批次撤销」）；空串 = 手工编辑 */
        batch?: string;
      },
    ): boolean => {
      const summary = typeof payload?.summary === "string" ? payload.summary.trim() : "";
      const model = typeof payload?.model === "string" && payload.model.trim()
        ? payload.model.trim()
        : null;
      const batch = typeof payload?.batch === "string" && payload.batch.trim()
        ? payload.batch.trim()
        : null;
      // 清空摘要（summary 为空）时四列一并置空，不留半截来源标记
      if (!summary) {
        return (
          dbRun(
            "UPDATE novel_chapters SET ai_summary = NULL, ai_summary_at = NULL, ai_summary_model = NULL, ai_summary_batch = NULL WHERE id = ?",
            [id],
          ).changes > 0
        );
      }
      const now = Date.now();
      return (
        dbRun(
          "UPDATE novel_chapters SET ai_summary = ?, ai_summary_at = ?, ai_summary_model = ?, ai_summary_batch = ? WHERE id = ?",
          [summary, now, model, batch, id],
        ).changes > 0
      );
    },
  );

  // 章节批量重排 / 跨卷移动（单事务落库）
  ipcMain.handle("novel-chapter-order", (_event, updates: ChapterOrderUpdate[]) => {
    const db = getDb();
    const apply = db.transaction(() => {
      const stmt = db.prepare(
        "UPDATE novel_chapters SET sort = ?, volume_id = ? WHERE id = ?",
      );
      for (const update of updates) stmt.run(update.sort, update.volumeId, update.id);
    });
    apply();
    return true;
  });

  // 新建卷
  ipcMain.handle("novel-volume-add", (_event, volume: NovelVolumeDto) => {
    dbRun("INSERT INTO novel_volumes (id, work_id, name, sort) VALUES (?, ?, ?, ?)", [
      volume.id,
      volume.workId,
      volume.name,
      volume.sort,
    ]);
    return true;
  });

  // 卷命名
  ipcMain.handle("novel-volume-rename", (_event, id: string, name: string) => {
    return dbRun("UPDATE novel_volumes SET name = ? WHERE id = ?", [name, id]).changes > 0;
  });

  // 卷批量重排（单事务落库）
  ipcMain.handle("novel-volume-order", (_event, updates: VolumeOrderUpdate[]) => {
    const db = getDb();
    const apply = db.transaction(() => {
      const stmt = db.prepare("UPDATE novel_volumes SET sort = ? WHERE id = ?");
      for (const update of updates) stmt.run(update.sort, update.id);
    });
    apply();
    return true;
  });

  /*
   * 删除卷 = 移入回收站（软删除，2.4.0）。卷与其内章节打**同一个时间戳**，
   * 这个相同值就是「同一批」的判据：恢复卷时只带回这一批，删卷之前单独删掉的
   * 章节仍留在回收站里单独一条，不会被顺手复活。
   *
   * 大纲条目 / 快照一概不动 —— 恢复后它们还挂在原来的卷章上。
   */
  ipcMain.handle("novel-volume-delete", (_event, id: string) => {
    const db = getDb();
    const now = Date.now();
    const apply = db.transaction(() => {
      dbRun(
        "UPDATE novel_chapters SET deleted_at = ? WHERE volume_id = ? AND deleted_at IS NULL",
        [now, id],
      );
      return dbRun(
        "UPDATE novel_volumes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
        [now, id],
      ).changes;
    });
    return Number(apply()) > 0;
  });

  // 删除卷（彻底）：章节 / 快照 / 大纲条目级联清理，单事务（叶 → 根，仿 novel-work-delete）
  ipcMain.handle("novel-volume-purge", (_event, id: string) => {
    const db = getDb();
    const apply = db.transaction(() => {
      // 大纲条目必须先行：它的 chapter_id 子查询依赖 novel_chapters，
      // 等章删光了子查询就是空集，一条都删不掉（孤儿行会永远留在库里）
      dbRun(
        `DELETE FROM novel_outline_entries
          WHERE volume_id = ?
             OR chapter_id IN (SELECT id FROM novel_chapters WHERE volume_id = ?)`,
        [id, id],
      );
      dbRun(
        `DELETE FROM novel_snapshots
          WHERE chapter_id IN (SELECT id FROM novel_chapters WHERE volume_id = ?)`,
        [id],
      );
      dbRun("DELETE FROM novel_chapters WHERE volume_id = ?", [id]);
      dbRun("DELETE FROM novel_volumes WHERE id = ?", [id]);
    });
    apply();
    return true;
  });

  // 要素保存（upsert：新建 / 编辑 / 别名关联共用，保留 created_at）
  ipcMain.handle("novel-entity-save", (_event, entity: NovelEntityDto) => {
    const now = Date.now();
    dbRun(
      `INSERT INTO novel_entities (id, work_id, type, name, aliases, summary, content, fields, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type, name = excluded.name, aliases = excluded.aliases,
         summary = excluded.summary, content = excluded.content,
         fields = excluded.fields, sort = excluded.sort, updated_at = excluded.updated_at`,
      [
        entity.id,
        entity.workId,
        entity.type,
        entity.name,
        JSON.stringify(entity.aliases),
        entity.summary,
        entity.content,
        JSON.stringify(entity.fields),
        entity.sort,
        now,
        now,
      ],
    );
    return true;
  });

  // 新增要素关联（多态关联表）
  ipcMain.handle("novel-link-add", (event, link: NovelLinkDto) => {
    dbRun(
      `INSERT INTO novel_links (id, from_type, from_id, to_type, to_id, relation, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [link.id, link.fromType, link.fromId, link.toType, link.toId, link.relation, link.note ?? null],
    );
    // R27 / S4 反向同步：主窗口建的关系要让图窗口立刻看见（按 id 合并，不重载）
    broadcastLinksChanged(event.sender, {
      workId: link.fromType === "entity" ? workIdOfEntity(link.fromId) ?? undefined : undefined,
      created: [
        {
          id: link.id,
          fromType: link.fromType,
          fromId: link.fromId,
          toType: link.toType,
          toId: link.toId,
          relation: link.relation,
          note: link.note ?? null,
        },
      ],
    });
    return true;
  });

  // 解除要素关联
  ipcMain.handle("novel-link-remove", (event, id: string) => {
    // 先读端点：删完就查不到这本书了（novel_links 没有 work_id）
    const row = dbGet("SELECT from_type, from_id FROM novel_links WHERE id = ?", [id]) as
      | { from_type?: string; from_id?: string }
      | undefined;
    dbRun("DELETE FROM novel_links WHERE id = ?", [id]);
    broadcastLinksChanged(event.sender, {
      workId:
        row?.from_type === "entity" && row.from_id
          ? workIdOfEntity(row.from_id) ?? undefined
          : undefined,
      removed: [id],
    });
    return true;
  });

  // 灵感速记保存（upsert）
  ipcMain.handle("novel-note-save", (_event, note: NovelNoteDto) => {
    dbRun(
      `INSERT INTO novel_notes (id, work_id, content, created_at, pinned, foreshadow_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         content = excluded.content, pinned = excluded.pinned,
         foreshadow_id = excluded.foreshadow_id`,
      [
        note.id,
        note.workId,
        note.content,
        note.createdAt,
        note.pinned ? 1 : 0,
        note.foreshadowId ?? null,
      ],
    );
    return true;
  });

  // 删除灵感速记
  ipcMain.handle("novel-note-remove", (_event, id: string) => {
    dbRun("DELETE FROM novel_notes WHERE id = ?", [id]);
    return true;
  });

  // 灵感归属迁移（书架全局灵感库 R32）：归档到作品；workId 传 '' 退回未归属池
  ipcMain.handle("novel-note-move", (_event, id: string, workId: string) => {
    return dbRun("UPDATE novel_notes SET work_id = ? WHERE id = ?", [workId, id]).changes > 0;
  });

  // 伏笔条目保存（upsert）
  ipcMain.handle("novel-outline-entry-save", (_event, entry: NovelOutlineEntryDto) => {
    dbRun(
      `INSERT INTO novel_outline_entries (id, work_id, kind, volume_id, chapter_id, title, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         volume_id = excluded.volume_id, chapter_id = excluded.chapter_id,
         title = excluded.title, note = excluded.note, status = excluded.status`,
      [
        entry.id,
        entry.workId,
        entry.kind,
        entry.volumeId,
        entry.chapterId ?? null,
        entry.title,
        entry.note,
        entry.status,
        entry.createdAt,
      ],
    );
    return true;
  });

  // 删除伏笔条目
  ipcMain.handle("novel-outline-entry-remove", (_event, id: string) => {
    dbRun("DELETE FROM novel_outline_entries WHERE id = ?", [id]);
    return true;
  });

  // ── 书籍导入（TXT／DOCX）：选文件 + 读字节 / 解析结果单事务落库 ──────
  //
  // 分工：主进程只做「选文件 + 读盘成字节」与「批量入库」；
  // 编码探测与章节/卷拆分在渲染层 web worker 完成（不占主界面，也不占主进程）。
  // 阅读器（参考 Ftiehan）走的是「按需读盘 + 字节偏移」，这里是一次性全量入库，
  // 故把整份字节交给渲染层解析、再整份写回。

  ipcMain.handle("novel-import-pick-file", async (): Promise<
    { fileName: string; bytes: ArrayBuffer; size: number } | null
  > => {
    const result = await dialog.showOpenDialog({
      title: "导入书籍",
      properties: ["openFile"],
      filters: [
        { name: "文本书籍", extensions: ["txt", "docx"] },
        { name: "纯文本", extensions: ["txt"] },
        { name: "Word 文档", extensions: ["docx"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // DOCX：mammoth 抽取正文纯文本后，走与 TXT 完全相同的解析链路。
    // 抽取出的是字符串，转成 UTF-8 字节回传，保持渲染层「字节 → 解码 → 拆章」
    // 的单一路径（与其它格式一致，渲染层无需分支）。
    if (ext === ".docx") {
      const { value } = await mammoth.extractRawText({ path: filePath });
      const bytes = new TextEncoder().encode(value).buffer as ArrayBuffer;
      return { fileName, bytes, size: bytes.byteLength };
    }

    const buffer = await fsp.readFile(filePath);
    // 转成可结构化克隆的 ArrayBuffer：Buffer 底层常带 pool 偏移，
    // 直接 slice 出精确区段再交给渲染层（transfer 后原 buffer 会被 detach）
    const bytes = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    return { fileName, bytes, size: buffer.byteLength };
  });

  // 导入落库：作品 + 卷 + 章一次事务写入。任何一卷/一章失败整体回滚，
  // 不会在书架上留下半本书。
  ipcMain.handle(
    "novel-import-book",
    (
      _event,
      payload: {
        work: NovelWorkDto;
        volumes: Array<{ id: string; name: string; sort: number }>;
        chapters: Array<{
          id: string;
          volumeId: string;
          title: string;
          content: string;
          wordCount: number;
          sort: number;
        }>;
      },
    ): { ok: boolean; chapterCount: number; wordCount: number } | { ok: false; error: string } => {
      const name = payload?.work?.name?.trim();
      if (!payload?.work?.id || !name) {
        return { ok: false, error: "书名不能为空" };
      }
      if (!Array.isArray(payload.volumes) || !Array.isArray(payload.chapters)) {
        return { ok: false, error: "导入数据格式不正确" };
      }

      const db = getDb();
      const now = Date.now();
      const apply = db.transaction(() => {
        dbRun("INSERT INTO novel_works (id, name, created_at) VALUES (?, ?, ?)", [
          payload.work.id,
          name,
          payload.work.createdAt || now,
        ]);
        const volumeStmt = db.prepare(
          "INSERT INTO novel_volumes (id, work_id, name, sort) VALUES (?, ?, ?, ?)",
        );
        for (const volume of payload.volumes) {
          volumeStmt.run(
            volume.id,
            payload.work.id,
            volume.name || "未命名卷",
            volume.sort,
          );
        }
        const chapterStmt = db.prepare(
          `INSERT INTO novel_chapters
             (id, work_id, volume_id, title, content, word_count, status, sort, outline_note, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, NULL, ?)`,
        );
        for (const chapter of payload.chapters) {
          chapterStmt.run(
            chapter.id,
            payload.work.id,
            chapter.volumeId,
            chapter.title || "未命名",
            chapter.content ?? "",
            chapter.wordCount ?? 0,
            chapter.sort,
            now,
          );
        }
      });
      apply();

      const wordCount = payload.chapters.reduce(
        (sum, chapter) => sum + (chapter.wordCount ?? 0),
        0,
      );
      logUsage("book_import", {
        workId: payload.work.id,
        volumes: payload.volumes.length,
        chapters: payload.chapters.length,
        words: wordCount,
      });
      return { ok: true, chapterCount: payload.chapters.length, wordCount };
    },
  );

  // ── 文件导出：文本组装在渲染层完成，这里只负责弹保存框 + 落盘 ──
  //
  // 从「只导 TXT」泛化成任意文本格式（ext / filterName 可选，缺省即 TXT）：
  // 行囊的 Markdown 导出走同一条通道，避免为「换个扩展名」再抄一份 showSaveDialog。

  ipcMain.handle(
    "novel-export-file",
    async (
      _event,
      defaultName: string,
      content: string,
      ext = "txt",
      filterName = "文本文件",
    ): Promise<{ path: string } | null> => {
      const suffix = ext.replace(/^\./, "") || "txt";
      const safeName = defaultName.replace(/[\\/:*?"<>|]/g, "_").trim() || "导出";
      // 调用方可能已经把扩展名写进 defaultName（「设定卡.txt」），去掉再拼，
      // 否则会存成 `设定卡.txt.txt`
      const stem = safeName.toLowerCase().endsWith(`.${suffix.toLowerCase()}`)
        ? safeName.slice(0, -(suffix.length + 1))
        : safeName;
      const result = await dialog.showSaveDialog({
        title: `导出 ${suffix.toUpperCase()}`,
        defaultPath: `${stem}.${suffix}`,
        filters: [{ name: filterName, extensions: [suffix] }],
      });
      if (result.canceled || !result.filePath) return null;
      await fsp.writeFile(result.filePath, content, "utf8");
      return { path: result.filePath };
    },
  );

  // ── usage_log 埋点（R14）：查询今日聚合 + 通用事件上报 ──────────────

  // 今日写作聚合：今日净增 = 当日 chapter_save 事件 delta 求和（删除字数扣回）
  // streakDays = 连续码字天数（书架统计 R32），按 chapter_save 事件的本地日期回溯
  ipcMain.handle("novel-usage-today", () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const row = dbGet(
      `SELECT
         COALESCE(SUM(CAST(json_extract(payload, '$.delta') AS INTEGER)), 0) AS today_words,
         COUNT(*) AS save_count
       FROM novel_usage_log
       WHERE event = 'chapter_save' AND created_at >= ?`,
      [start.getTime()],
    ) as { today_words: number; save_count: number };
    /*
     * 必须给时间下界：LIMIT 是在 DISTINCT 之后才生效的，没有下界 SQLite 要
     * 扫完整个 chapter_save 历史再排序去重。而 novel_usage_log 只增不减，
     * 按每天 100 次自动保存算，一年就是 3 万多行 —— 这条查询挂在书架装载上。
     * 连续码字天数最多看 USAGE_ACTIVE_DAY_LIMIT 天，下界与之对齐即可。
     */
    const activeDays = new Set(
      (dbAll(
        `SELECT DISTINCT date(created_at / 1000, 'unixepoch', 'localtime') AS day
         FROM novel_usage_log
         WHERE event = 'chapter_save' AND created_at >= ?
         ORDER BY day DESC
         LIMIT ?`,
        [Date.now() - USAGE_ACTIVE_DAY_LIMIT * 86_400_000, USAGE_ACTIVE_DAY_LIMIT],
      ) as Array<{ day: string }>).map((item) => item.day),
    );
    return {
      todayWords: row.today_words,
      saveCount: row.save_count,
      streakDays: computeStreakDays(activeDays, new Date()),
    };
  });

  // 通用事件上报（goal_reach 等由渲染层显式触发）
  ipcMain.handle("novel-usage-log", (_event, event: string, payload: Record<string, unknown>) => {
    logUsage(event, payload);
    return true;
  });
}

/**
 * 标记编辑器会话正常关闭。
 * 由主进程在 NovelWindow closed 事件与应用退出前调用；
 * 用户库未初始化（未登录）时静默忽略。
 */
export function markNovelSessionClosed(): void {
  try {
    setConfig(SESSION_KEY, "closed");
  } catch {
    // db 未初始化时 getDb 抛错：从未进入编辑器会话，无需标记
  }
}
