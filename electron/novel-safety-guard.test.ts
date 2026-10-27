/**
 * 数据安全（P0）源码守卫
 *
 * 这几条约束都属于「写错了不会报错、只会静默丢数据」的类型，只能在源码级钉死：
 *   1. 装载必须过滤回收站 —— 漏了就是「删掉的书还在书架」
 *   2. 日常删除必须是软删除 —— 退回物理删除就等于取消删除兜底
 *   3. 整库恢复必须先关库再写文件 —— 顺序错了 SQLite 会 malformed
 *   4. 恢复失败必须回滚留底 —— 否则「恢复失败」=「数据没了」
 *   5. 备份必须先 checkpoint 再读文件 —— 否则包里少最后几章
 *
 * 同先例：`novel-write-guard.test.ts`（源码断言，因为 better-sqlite3 的 native
 * 在 vitest 下 require 就抛）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-handlers.ts"),
  "utf8",
);
const SAFETY = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-safety-handlers.ts"),
  "utf8",
);
const DB = readFileSync(resolve(process.cwd(), "electron/novel-db.ts"), "utf8");

/** 截取某个 ipcMain.handle 通道的回调体（到下一个 `ipcMain.handle` 为止） */
function channelBody(source: string, channel: string): string {
  const start = source.indexOf(`"${channel}"`);
  if (start < 0) throw new Error(`未找到通道 ${channel}`);
  const next = source.indexOf("ipcMain.handle(", start);
  return source.slice(start, next < 0 ? source.length : next);
}

describe("删除兜底：回收站是软删除（守卫）", () => {
  const body = channelBody(SAFETY, "novel-work-trash");

  it("只打 deleted_at 标记，不删任何行", () => {
    expect(body).toContain("UPDATE novel_works SET deleted_at = ?");
    expect(body).toContain("AND deleted_at IS NULL");
    expect(body).not.toContain("DELETE FROM");
  });

  it("恢复只清标记（子数据从未被删，所以恢复不需要重建任何东西）", () => {
    const restore = channelBody(SAFETY, "novel-trash-restore");
    expect(restore).toContain("UPDATE novel_works SET deleted_at = NULL");
    expect(restore).not.toContain("DELETE FROM");
  });

  it("装载层过滤回收站：否则已删作品会照旧出现在书架并参与统计", () => {
    const body = channelBody(HANDLERS, "novel-editor-load");
    expect(body).toContain("FROM novel_works WHERE deleted_at IS NULL");
    expect(body).not.toContain('dbAll("SELECT * FROM novel_works ORDER BY created_at")');
  });

  it("彻底删除仍走既有级联通道（回收站不另写第二份删除顺序）", () => {
    const body = channelBody(HANDLERS, "novel-work-delete");
    expect(body).toContain("DELETE FROM novel_works WHERE id = ?");
    // 安全 handler 里不得出现任何级联 SQL：清除动作一律复用上面那条通道
    expect(SAFETY).not.toContain("DELETE FROM novel_chapters");
    expect(SAFETY).not.toContain("DELETE FROM novel_pack_characters");
  });

  it("老库补 deleted_at 列（增量迁移，可空即「全部在架」）", () => {
    expect(DB).toContain('ALTER TABLE novel_works ADD COLUMN deleted_at INTEGER');
    expect(DB).toContain("idx_novel_works_deleted");
  });
});

describe("卷 / 章的删除兜底（守卫）", () => {
  it("日常删章节是软删除：只打标记，快照也不动（恢复后历史版本要还在）", () => {
    const body = channelBody(HANDLERS, "novel-chapter-delete");
    expect(body).toContain(
      "UPDATE novel_chapters SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
    );
    expect(body).not.toContain("DELETE FROM");
  });

  it("日常删卷是软删除，且卷与其章节写**同一个**时间戳（这是「同批」的判据）", () => {
    const body = channelBody(HANDLERS, "novel-volume-delete");
    expect(body).not.toContain("DELETE FROM");
    expect(body).toContain(
      "UPDATE novel_chapters SET deleted_at = ? WHERE volume_id = ? AND deleted_at IS NULL",
    );
    expect(body).toContain(
      "UPDATE novel_volumes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
    );
    // 时间戳只能取一次：两处各写一次 Date.now() 会差几毫秒，批号就对不上了，
    // 恢复卷时那批章节会被当成「删卷前单独删的」而留在回收站里
    expect(body.match(/Date\.now\(\)/g)?.length).toBe(1);
    expect(body).toContain("const now = Date.now();");
  });

  it("彻底删除仍在自己的通道里做级联（软删除不接管物理销毁）", () => {
    expect(channelBody(HANDLERS, "novel-chapter-purge")).toContain(
      "DELETE FROM novel_chapters WHERE id = ?",
    );
    const volumePurge = channelBody(HANDLERS, "novel-volume-purge");
    expect(volumePurge).toContain("DELETE FROM novel_volumes WHERE id = ?");
    expect(volumePurge).toContain("DELETE FROM novel_outline_entries");
  });

  it("装载层过滤已删卷 / 章，漏一条就是「删掉的章节还在目录里」", () => {
    const body = channelBody(HANDLERS, "novel-editor-load");
    expect(body).toContain(
      "SELECT * FROM novel_volumes WHERE deleted_at IS NULL ORDER BY sort",
    );
    expect(body).toContain("FROM novel_chapters WHERE deleted_at IS NULL");
    // 大纲条目：指向已删卷章的不许出装载层
    expect(body).toContain("liveVolumeIds.has(row.volume_id)");
    expect(body).toContain(
      "row.chapter_id == null || liveChapterIds.has(row.chapter_id)",
    );
  });

  it("回收站的单章分支排除「随卷一起删」的那批，否则同一个东西列两次", () => {
    const body = channelBody(SAFETY, "novel-trash-list");
    expect(body).toContain("NOT EXISTS");
    // 判据必须是批号相等，不能只判「父卷已删」——那会把删卷前单独删的章节也吞掉
    expect(body).toContain("pv.deleted_at = c.deleted_at");
  });

  it("恢复按 kind 分派（三类共用一个通道）", () => {
    const body = channelBody(SAFETY, "novel-trash-restore");
    expect(body).toContain('kind === "work"');
    expect(body).toContain('kind === "volume"');
    expect(body).toContain('kind === "chapter"');
    expect(body).not.toContain("DELETE FROM");
  });

  it("恢复卷只带回同批章节（删卷前单独删的留在回收站）", () => {
    const start = SAFETY.indexOf("function restoreVolume");
    const body = SAFETY.slice(start, SAFETY.indexOf("function restoreChapter"));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("WHERE volume_id = ? AND deleted_at = ?");
    expect(body).toContain("const batch = Number(volume.deleted_at);");
    expect(body).toContain("[id, batch]");
  });

  it("恢复时原位置被占就落末位：否则两章同号，目录顺序变得不确定", () => {
    const start = SAFETY.indexOf("function pickRestoreSort");
    const body = SAFETY.slice(start, SAFETY.indexOf("function restoreVolume"));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("AND sort = ? AND deleted_at IS NULL");
    expect(body).toContain("COALESCE(MAX(sort), 0) + 1");
  });

  it("老库补卷 / 章的 deleted_at（逐表 pragma 探测后 ALTER）", () => {
    expect(DB).toContain("for (const table of [\"novel_volumes\", \"novel_chapters\"])");
    expect(DB).toContain("ALTER TABLE ${table} ADD COLUMN deleted_at INTEGER");
  });
});

describe("整库备份 / 恢复的顺序约束（守卫）", () => {
  it("备份前先 checkpoint：WAL 里未合并的写入否则会缺席", () => {
    const body = channelBody(SAFETY, "novel-backup-export");
    const checkpoint = body.indexOf("wal_checkpoint");
    const read = body.indexOf("readFileSync(dbPath)");
    expect(checkpoint).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(checkpoint);
  });

  it("恢复必须先关库再动文件（better-sqlite3 持着句柄，边写边换会 malformed）", () => {
    const body = channelBody(SAFETY, "novel-backup-restore");
    const close = body.indexOf("closeNovelDb()");
    const write = body.indexOf("writeFileSync(dbPath, bytes)");
    expect(close).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(close);
  });

  it("覆盖前留底 + 失败回滚：留底要早于删除旧文件", () => {
    const body = channelBody(SAFETY, "novel-backup-restore");
    const copy = body.indexOf("copyFileSync(dbPath, safetyCopy)");
    const remove = body.indexOf("fs.rmSync(target)");
    const rollback = body.indexOf("copyFileSync(safetyCopy, dbPath)");
    expect(copy).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(copy);
    // 回滚那一次拷贝必须存在，且是把留底写回库路径
    expect(rollback).toBeGreaterThan(-1);
  });

  it("恢复后必须重开库（老备份缺的新列由 initializeNovelDb 补齐）", () => {
    const body = channelBody(SAFETY, "novel-backup-restore");
    expect(body).toContain("switchNovelDb(email)");
    expect(body).toContain("finally");
  });

  it("写入前校验 SQLite 文件头：坏包不能落进真实库路径", () => {
    const body = channelBody(SAFETY, "novel-backup-restore");
    const guard = body.indexOf("isLikelySqliteFile(bytes)");
    const write = body.indexOf("writeFileSync(dbPath, bytes)");
    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(guard);
  });
});

/**
 * 作品题材（2.7.1）
 *
 * 题材是可选的 AI 风格锚点，最容易出的错不是「界面没有输入框」，而是
 * **选了却没落库 / 落库了却没读回**（AI 拿到 undefined，界面看着又是选过的）。
 * 这两处都没有任何报错，只能在源码级钉住。
 */
describe("作品题材：可空字段的全链路（守卫）", () => {
  it("老库补 genre 列，且建表语句本身也带这一列", () => {
    expect(DB).toContain("ALTER TABLE novel_works ADD COLUMN genre TEXT");
    expect(DB).toMatch(/CREATE TABLE IF NOT EXISTS novel_works[\s\S]*?\bgenre TEXT/);
  });

  it("新建作品落 genre、装载读回 genre（中间断一环 = 选了也白选）", () => {
    const add = channelBody(HANDLERS, "novel-work-add");
    expect(add).toContain("INSERT INTO novel_works");
    expect(add).toMatch(/normalizeGenre\(work\.genre\)/);

    const load = channelBody(HANDLERS, "novel-editor-load");
    expect(load).toMatch(/genre:\s*row\.genre/);
  });

  it("空题材归一为 NULL：'' 与「未设置」不能是两种状态", () => {
    expect(HANDLERS).toMatch(/function normalizeGenre\(/);
    expect(channelBody(HANDLERS, "novel-work-set-genre")).toContain(
      "normalizeGenre(genre)",
    );
  });
});
