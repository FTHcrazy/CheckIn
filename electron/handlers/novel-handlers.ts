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
 */
import { ipcMain, dialog } from "electron";
import { promises as fsp } from "node:fs";
import { dbAll, dbGet, dbRun, getDb } from "../db";
import { buildNovelTemplateBook } from "../novel-template";

// ── 行类型（snake_case，对应表结构） ──

interface NovelWorkRow {
  id: string;
  name: string;
  created_at: number;
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

interface NovelLevelSystemRow {
  id: string;
  work_id: string;
  name: string;
}

interface NovelLevelRow {
  id: string;
  system_id: string;
  name: string;
  rank: number;
  note: string | null;
}

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

export interface NovelLevelSystemDto {
  id: string;
  workId: string;
  name: string;
  rungs: Array<{ id: string; name: string; rank: number; note?: string }>;
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
  levelSystems: NovelLevelSystemDto[];
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
const SESSION_KEY = "novel_editor_session";

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

function setConfig(key: string, value: string): void {
  dbRun(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now', 'localtime')`,
    [key, value],
  );
}

/** 写入 usage_log 埋点（R14）：payload 序列化失败不影响主流程 */
function logUsage(event: string, payload: Record<string, unknown>): void {
  try {
    dbRun("INSERT INTO usage_log (event, payload, created_at) VALUES (?, ?, ?)", [
      event,
      JSON.stringify(payload),
      Date.now(),
    ]);
  } catch {
    // 埋点失败静默：绝不能影响编辑器主链路
  }
}

function toChapterDto(row: NovelChapterRow): NovelChapterDto {
  return {
    id: row.id,
    workId: row.work_id,
    volumeId: row.volume_id,
    title: row.title,
    content: row.content,
    wordCount: row.word_count,
    status: isChapterStatus(row.status) ? row.status : "draft",
    sort: row.sort,
    updatedAt: row.updated_at,
    ...(row.outline_note !== null ? { outlineNote: row.outline_note } : {}),
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
function buildRecovery(): NovelRecoveryDto | null {
  const session = dbGet("SELECT value FROM config WHERE key = ?", [SESSION_KEY]) as
    | { value?: string }
    | undefined;
  if (session?.value !== "running") return null;

  const snapshot = dbGet(
    "SELECT * FROM novel_snapshots ORDER BY created_at DESC LIMIT 1",
  ) as NovelSnapshotRow | undefined;
  if (!snapshot) return null;

  const chapter = dbGet("SELECT * FROM novel_chapters WHERE id = ?", [
    snapshot.chapter_id,
  ]) as NovelChapterRow | undefined;
  if (!chapter || chapter.content === snapshot.content) return null;

  return {
    snapshotTime: snapshot.created_at,
    deltaWords: Math.max(0, chapter.word_count - snapshot.word_count),
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
  ipcMain.handle("novel-config-get", (_event, key: string) => {
    const row = dbGet("SELECT value FROM config WHERE key = ?", [key]) as
      | { value?: string }
      | undefined;
    return row?.value ?? null;
  });

  ipcMain.handle("novel-config-set", (_event, key: string, value: string) => {
    setConfig(key, value);
    return true;
  });

  // ── 作品管理（R29） ──

  // 新建作品（id 由渲染层生成，与卷 / 章一致）
  ipcMain.handle("novel-work-add", (_event, work: NovelWorkDto) => {
    const name = work.name.trim();
    if (!name) return false;
    dbRun("INSERT INTO novel_works (id, name, created_at) VALUES (?, ?, ?)", [
      work.id,
      name,
      work.createdAt,
    ]);
    return true;
  });

  // 作品重命名（空名不落）
  ipcMain.handle("novel-work-rename", (_event, id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    dbRun("UPDATE novel_works SET name = ? WHERE id = ?", [trimmed, id]);
    return true;
  });

  // 删除作品：卷章快照 / 要素关联 / 灵感伏笔 / 等级体系级联清理，单事务
  ipcMain.handle("novel-work-delete", (_event, id: string) => {
    const db = getDb();
    const apply = db.transaction(() => {
      for (const chapter of dbAll(
        "SELECT id FROM novel_chapters WHERE work_id = ?",
        [id],
      ) as Array<{ id: string }>) {
        dbRun("DELETE FROM novel_snapshots WHERE chapter_id = ?", [chapter.id]);
      }
      dbRun("DELETE FROM novel_chapters WHERE work_id = ?", [id]);
      dbRun("DELETE FROM novel_volumes WHERE work_id = ?", [id]);
      dbRun("DELETE FROM novel_notes WHERE work_id = ?", [id]);
      dbRun("DELETE FROM novel_outline_entries WHERE work_id = ?", [id]);

      const entities = dbAll(
        "SELECT id FROM novel_entities WHERE work_id = ?",
        [id],
      ) as Array<{ id: string }>;
      dbRun("DELETE FROM novel_entities WHERE work_id = ?", [id]);
      for (const entity of entities) {
        dbRun("DELETE FROM novel_links WHERE from_id = ? OR to_id = ?", [
          entity.id,
          entity.id,
        ]);
      }

      for (const system of dbAll(
        "SELECT id FROM novel_level_systems WHERE work_id = ?",
        [id],
      ) as Array<{ id: string }>) {
        for (const level of dbAll(
          "SELECT id FROM novel_levels WHERE system_id = ?",
          [system.id],
        ) as Array<{ id: string }>) {
          dbRun(
            "DELETE FROM novel_level_conversions WHERE from_level_id = ? OR to_level_id = ?",
            [level.id, level.id],
          );
        }
        dbRun("DELETE FROM novel_levels WHERE system_id = ?", [system.id]);
      }
      dbRun("DELETE FROM novel_level_systems WHERE work_id = ?", [id]);
      // 作品行本身也要删：漏掉会导致「删光后 reload 复活全部作品名」
      dbRun("DELETE FROM novel_works WHERE id = ?", [id]);
    });
    apply();
    return true;
  });

  // 删除章节：历史快照同事务清理
  ipcMain.handle("novel-chapter-delete", (_event, id: string) => {
    const db = getDb();
    const apply = db.transaction(() => {
      dbRun("DELETE FROM novel_snapshots WHERE chapter_id = ?", [id]);
      dbRun("DELETE FROM novel_chapters WHERE id = ?", [id]);
    });
    apply();
    return true;
  });

  // ── 一键重置为模板书籍（调试功能） ──────────────────────────────────
  //
  // 单事务清空全部 novel_* 表后重新播种模板数据（electron/novel-template.ts
  // 每次实时构建，改模板定义后重置即生效）。排版设置（novel_editor_settings）
  // 保留，续写位置（novel_editor_position）一并清除，避免指向已不存在的章节。
  ipcMain.handle("novel-editor-reset-template", () => {
    const db = getDb();
    const template = buildNovelTemplateBook();
    const now = Date.now();

    const apply = db.transaction(() => {
      // 清库：快照先行（与章节删除同一顺序），其余表无外键约束可任意序
      dbRun("DELETE FROM novel_snapshots");
      dbRun("DELETE FROM novel_chapters");
      dbRun("DELETE FROM novel_volumes");
      dbRun("DELETE FROM novel_works");
      dbRun("DELETE FROM novel_notes");
      dbRun("DELETE FROM novel_outline_entries");
      dbRun("DELETE FROM novel_links");
      dbRun("DELETE FROM novel_entities");
      dbRun("DELETE FROM novel_level_conversions");
      dbRun("DELETE FROM novel_levels");
      dbRun("DELETE FROM novel_level_systems");
      // 位置记忆指向的章节即将不存在，直接清除
      dbRun("DELETE FROM config WHERE key = 'novel_editor_position'");

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
      for (const system of template.levelSystems) {
        dbRun("INSERT INTO novel_level_systems (id, work_id, name) VALUES (?, ?, ?)", [
          system.id,
          template.workId,
          system.name,
        ]);
        for (const rung of system.rungs) {
          dbRun("INSERT INTO novel_levels (id, system_id, name, rank, note) VALUES (?, ?, ?, ?, ?)", [
            rung.id,
            system.id,
            rung.name,
            rung.rank,
            rung.note ?? null,
          ]);
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
    });
    apply();

    return {
      volumes: template.volumes.length,
      chapters: template.chapters.length,
      words: template.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
      entities: template.entities.length,
    };
  });

  // 全量装载：编辑器启动一次拉取所有 novel_* 表 + 崩溃恢复信息
  ipcMain.handle("novel-editor-load", () => {
    let works = dbAll("SELECT * FROM novel_works ORDER BY created_at") as NovelWorkRow[];
    if (works.length === 0) {
      // 首次使用：零配置开写（PRD R1），播种默认作品
      const seeded: NovelWorkRow = {
        id: createId("w"),
        name: "未命名作品",
        created_at: Date.now(),
      };
      dbRun("INSERT INTO novel_works (id, name, created_at) VALUES (?, ?, ?)", [
        seeded.id,
        seeded.name,
        seeded.created_at,
      ]);
      works = [seeded];
    }

    const volumes = (dbAll("SELECT * FROM novel_volumes ORDER BY sort") as NovelVolumeRow[]).map(
      (row) => ({ id: row.id, workId: row.work_id, name: row.name, sort: row.sort }),
    );
    const chapters = (dbAll("SELECT * FROM novel_chapters") as NovelChapterRow[]).map(toChapterDto);
    const entities = (dbAll("SELECT * FROM novel_entities ORDER BY sort") as NovelEntityRow[]).map(
      toEntityDto,
    );
    const links = (dbAll("SELECT * FROM novel_links") as NovelLinkRow[]).map(toLinkDto);

    const levelSystems = (dbAll(
      "SELECT * FROM novel_level_systems",
    ) as NovelLevelSystemRow[]).map((system) => ({
      id: system.id,
      workId: system.work_id,
      name: system.name,
      rungs: (dbAll(
        "SELECT * FROM novel_levels WHERE system_id = ? ORDER BY rank",
        [system.id],
      ) as NovelLevelRow[]).map((level) => ({
        id: level.id,
        name: level.name,
        rank: level.rank,
        ...(level.note !== null ? { note: level.note } : {}),
      })),
    }));

    const notes = (dbAll("SELECT * FROM novel_notes") as NovelNoteRow[]).map((row) => ({
      id: row.id,
      workId: row.work_id,
      content: row.content,
      createdAt: row.created_at,
      pinned: row.pinned === 1,
      ...(row.foreshadow_id !== null ? { foreshadowId: row.foreshadow_id } : {}),
    }));

    const outlineEntries = (dbAll(
      "SELECT * FROM novel_outline_entries",
    ) as NovelOutlineEntryRow[]).map((row) => ({
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

    const recovery = buildRecovery();
    setConfig(SESSION_KEY, "running");
    // R14：编辑器唤起埋点（北极星「打开→开始输入」漏斗的起点）
    logUsage("editor_open", {});

    const bundle: NovelBundleDto = {
      works: works.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at })),
      volumes,
      chapters,
      entities,
      links,
      levelSystems,
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
        const chapter = dbGet("SELECT word_count FROM novel_chapters WHERE id = ?", [
          id,
        ]) as { word_count?: number | null } | undefined;
        const delta = chapter ? wordCount - (chapter.word_count ?? 0) : 0;
        const last = dbGet(
          "SELECT * FROM novel_snapshots WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1",
          [id],
        ) as NovelSnapshotRow | undefined;
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
      });
      save();
      return true;
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
    dbRun("UPDATE novel_chapters SET title = ? WHERE id = ?", [title, id]);
    return true;
  });

  // 章节状态切换（草稿 / 完稿）
  ipcMain.handle("novel-chapter-status", (_event, id: string, status: string) => {
    if (!isChapterStatus(status)) return false;
    dbRun("UPDATE novel_chapters SET status = ? WHERE id = ?", [status, id]);
    return true;
  });

  // 章节大纲梗概保存（空串清除 → NULL）
  ipcMain.handle("novel-chapter-outline", (_event, id: string, note: string) => {
    dbRun("UPDATE novel_chapters SET outline_note = ? WHERE id = ?", [
      note.trim() ? note : null,
      id,
    ]);
    return true;
  });

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
    dbRun("UPDATE novel_volumes SET name = ? WHERE id = ?", [name, id]);
    return true;
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
  ipcMain.handle("novel-link-add", (_event, link: NovelLinkDto) => {
    dbRun(
      `INSERT INTO novel_links (id, from_type, from_id, to_type, to_id, relation, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [link.id, link.fromType, link.fromId, link.toType, link.toId, link.relation, link.note ?? null],
    );
    return true;
  });

  // 解除要素关联
  ipcMain.handle("novel-link-remove", (_event, id: string) => {
    dbRun("DELETE FROM novel_links WHERE id = ?", [id]);
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
    dbRun("UPDATE novel_notes SET work_id = ? WHERE id = ?", [workId, id]);
    return true;
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

  // ── 等级体系管理（R25 落地：此前只有读，无 CRUD） ────────────────────

  // 新建体系（渲染层生成 id）
  ipcMain.handle("novel-level-system-add", (_event, system: NovelLevelSystemDto) => {
    const name = system.name.trim();
    if (!name) return false;
    dbRun("INSERT INTO novel_level_systems (id, work_id, name) VALUES (?, ?, ?)", [
      system.id,
      system.workId,
      name,
    ]);
    return true;
  });

  // 体系重命名
  ipcMain.handle("novel-level-system-rename", (_event, id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    dbRun("UPDATE novel_level_systems SET name = ? WHERE id = ?", [trimmed, id]);
    return true;
  });

  // 删除体系：等级项 / 转换关系 / 指向等级项的关联（当前境界）同事务级联
  ipcMain.handle("novel-level-system-delete", (_event, id: string) => {
    const db = getDb();
    const apply = db.transaction(() => {
      const levels = dbAll("SELECT id FROM novel_levels WHERE system_id = ?", [
        id,
      ]) as Array<{ id: string }>;
      for (const level of levels) {
        dbRun(
          "DELETE FROM novel_level_conversions WHERE from_level_id = ? OR to_level_id = ?",
          [level.id, level.id],
        );
        dbRun("DELETE FROM novel_links WHERE to_type = 'level' AND to_id = ?", [level.id]);
      }
      dbRun("DELETE FROM novel_levels WHERE system_id = ?", [id]);
      dbRun("DELETE FROM novel_level_systems WHERE id = ?", [id]);
    });
    apply();
    return true;
  });

  // 新建等级项：rank 取体系内最大值 + 1（追加到阶梯末尾）
  ipcMain.handle(
    "novel-level-add",
    (_event, systemId: string, id: string, name: string): NovelLevelSystemDto["rungs"][number] | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const max = dbGet("SELECT COALESCE(MAX(rank), 0) AS max FROM novel_levels WHERE system_id = ?", [
        systemId,
      ]) as { max: number };
      const rank = max.max + 1;
      dbRun("INSERT INTO novel_levels (id, system_id, name, rank) VALUES (?, ?, ?, ?)", [
        id,
        systemId,
        trimmed,
        rank,
      ]);
      return { id, name: trimmed, rank };
    },
  );

  // 等级项重命名
  ipcMain.handle("novel-level-rename", (_event, id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    dbRun("UPDATE novel_levels SET name = ? WHERE id = ?", [trimmed, id]);
    return true;
  });

  // 删除等级项：转换关系与指向它的「当前境界」关联同事务清理
  ipcMain.handle("novel-level-delete", (_event, id: string) => {
    const db = getDb();
    const apply = db.transaction(() => {
      dbRun(
        "DELETE FROM novel_level_conversions WHERE from_level_id = ? OR to_level_id = ?",
        [id, id],
      );
      dbRun("DELETE FROM novel_links WHERE to_type = 'level' AND to_id = ?", [id]);
      dbRun("DELETE FROM novel_levels WHERE id = ?", [id]);
    });
    apply();
    return true;
  });

  // 等级项排序（rank 重排，单事务）
  ipcMain.handle(
    "novel-level-order",
    (_event, updates: Array<{ id: string; rank: number }>) => {
      const db = getDb();
      const apply = db.transaction(() => {
        const stmt = db.prepare("UPDATE novel_levels SET rank = ? WHERE id = ?");
        for (const update of updates) stmt.run(update.rank, update.id);
      });
      apply();
      return true;
    },
  );

  // ── TXT 导出（R13）：文本组装在渲染层完成，这里只负责弹保存框 + 落盘 ──

  ipcMain.handle(
    "novel-export-txt",
    async (_event, defaultName: string, content: string): Promise<{ path: string } | null> => {
      const safeName = defaultName.replace(/[\\/:*?"<>|]/g, "_").trim() || "导出";
      const result = await dialog.showSaveDialog({
        title: "导出 TXT",
        defaultPath: `${safeName}.txt`,
        filters: [{ name: "文本文件", extensions: ["txt"] }],
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
       FROM usage_log
       WHERE event = 'chapter_save' AND created_at >= ?`,
      [start.getTime()],
    ) as { today_words: number; save_count: number };
    const activeDays = new Set(
      (dbAll(
        `SELECT DISTINCT date(created_at / 1000, 'unixepoch', 'localtime') AS day
         FROM usage_log
         WHERE event = 'chapter_save'
         ORDER BY day DESC
         LIMIT 400`,
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
 * 由主进程在 WorkerWindow closed 事件与应用退出前调用；
 * 用户库未初始化（未登录）时静默忽略。
 */
export function markNovelSessionClosed(): void {
  try {
    setConfig(SESSION_KEY, "closed");
  } catch {
    // db 未初始化时 getDb 抛错：从未进入编辑器会话，无需标记
  }
}
