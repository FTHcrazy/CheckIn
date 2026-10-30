/**
 * novel 域数据安全 IPC（P0：一键全量备份 / 恢复 + 删除兜底回收站）
 *
 * 对标 todo / memo 的备份包实现（`handlers/todo-handlers.ts` 的
 * `todo-backup-export/import`），差异在**载荷**：
 * - todo / memo 是「逐行 JSON」，因为结构简单且需要合并导入；
 * - novel 域有 30+ 张表、靠 work_id / chapter_id 字符串互指，逐表 JSON 化等于
 *   重写一遍导入器，任一张表漏字段就是静默丢数据 —— 所以整库字节打包，
 *   恢复后由 `switchNovelDb()` 重跑增量迁移把老库补齐到当前 schema。
 *
 * 通道清单：
 *   novel-backup-export   打包 novel.db + manifest，弹保存框写盘
 *   novel-backup-pick     选包 + 校验清单，返回规模摘要（恢复前让用户看清代价）
 *   novel-backup-restore  覆盖整库（先留底 .before-restore-*，失败自动回滚）
 *   novel-work-trash      删除兜底：作品移入回收站（软删除，只打 deleted_at）
 *   novel-trash-list      回收站列表（作品 / 卷 / 章三类，含规模与剩余天数）
 *   novel-trash-restore   从回收站恢复（按 kind 分派，子数据从未被删）
 *
 * ⚠️ 卷 / 章的「移入回收站」不在这两个通道里：它们的日常删除入口
 * （`novel-chapter-delete` / `novel-volume-delete`）本身就实现成了软删除，
 * 见 `novel-handlers.ts`。
 *
 * ⚠️ 「彻底删除」也不在这里：作品的清除复用既有 `novel-work-delete` 通道，
 * 卷 / 章走 `novel-volume-purge` / `novel-chapter-purge`（都在 novel-handlers，
 * 与各自的删除顺序放在一起）。本文件因此**不含任何 DELETE 级联 SQL**，
 * 这条约束由 `novel-safety-guard.test.ts` 钉住。
 */
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { getCurrentUserEmail } from "../db";
import {
  closeNovelDb,
  getNovelDb,
  getNovelDbPath,
  isNovelDbReady,
  novelAll,
  novelExec,
  novelGet,
  novelRun,
  switchNovelDb,
} from "../novel-db";
import { windowManager } from "../windowManager";
import {
  buildNovelBackupFilename,
  buildNovelBackupManifest,
  isLikelySqliteFile,
  isNovelTrashExpired,
  NOVEL_BACKUP_DB_FILE,
  NOVEL_BACKUP_MANIFEST_FILE,
  NOVEL_TRASH_RETENTION_DAYS,
  normalizeNovelCounts,
  parseNovelBackupManifest,
  novelTrashDaysLeft,
  type NovelBackupCounts,
  type NovelBackupManifest,
} from "../novel-safety-utils";

/** 恢复成功后广播：各 novel 域窗口据此丢弃内存态（正文 / 行囊 / 关系图） */
export const NOVEL_DATA_REPLACED_EVENT = "novel-data-replaced";

const ZIP_FILTERS = [{ name: "小说数据备份包", extensions: ["zip"] }];

function pickWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/**
 * 回收站条目类型（渲染层据此决定展示与恢复提示）。
 * - work：整部作品（软删只标作品行，卷章仍在库里）
 * - volume：整个卷（内含章节与卷同批打标，不单独成条）
 * - chapter：单章（含「删卷之前就单独删掉」的那部分）
 */
type NovelTrashKind = "work" | "volume" | "chapter";

/** 回收站列表行（渲染层直接消费，字段已转驼峰） */
interface NovelTrashItemDto {
  kind: NovelTrashKind;
  id: string;
  name: string;
  deletedAt: number;
  /** 所属作品名（卷 / 章用；作品本身为空串） */
  workName: string;
  /** 所属卷名（仅章用） */
  volumeName: string;
  volumes: number;
  chapters: number;
  words: number;
  /** 剩余可恢复天数（0 = 今天内到期） */
  daysLeft: number;
  /** 是否已过保留期（渲染层据此自动彻底删除） */
  expired: boolean;
}

interface NovelTrashListResult {
  items: NovelTrashItemDto[];
  retentionDays: number;
}

/**
 * 统计规模摘要：只数**在架**的作品 / 卷 / 章（回收站里的不算，用户看到的是
 * 「现在有多少」）。
 *
 * 全部走一条 SQL 的标量子查询：五张表各查一次会让备份前的这一下变成 5 次
 * prepare + 全表扫，长篇库上有可感知的卡顿。
 */
function collectCounts(): NovelBackupCounts {
  const liveWorks = "SELECT id FROM novel_works WHERE deleted_at IS NULL";
  const row = novelGet(
    `SELECT
       (SELECT COUNT(*) FROM novel_works WHERE deleted_at IS NULL) AS works,
       (SELECT COUNT(*) FROM novel_volumes WHERE deleted_at IS NULL AND work_id IN (${liveWorks})) AS volumes,
       (SELECT COUNT(*) FROM novel_chapters WHERE deleted_at IS NULL AND work_id IN (${liveWorks})) AS chapters,
       (SELECT COALESCE(SUM(word_count), 0) FROM novel_chapters WHERE deleted_at IS NULL AND work_id IN (${liveWorks})) AS words,
       (SELECT COUNT(*) FROM novel_entities WHERE work_id IN (${liveWorks})) AS entities,
       (SELECT COUNT(*) FROM novel_setting_categories WHERE work_id IN (${liveWorks})) AS settings,
       (SELECT COUNT(*) FROM novel_pack_characters WHERE work_id IN (${liveWorks})) AS packCharacters`,
  ) as Record<string, unknown> | undefined;
  return normalizeNovelCounts(row ?? {});
}

/**
 * 恢复时的落位：原位没被占就回原位，被占了就排到同级末尾。
 *
 * 软删除期间渲染层会把剩余卷章重排成紧凑序号（删一章，后面的章号整体前移），
 * 所以「原 sort」很可能已经被别的行占了。直接写回原值会出现两章同号，
 * 章节目录的先后顺序就变成不确定的（我们除 sort 之外没有别的顺序保证）。
 */
function pickRestoreSort(
  table: "novel_chapters" | "novel_volumes",
  scope: { column: "work_id" | "volume_id"; value: string },
  sort: number,
): number {
  const taken = novelGet(
    `SELECT 1 AS hit FROM ${table} WHERE ${scope.column} = ? AND sort = ? AND deleted_at IS NULL LIMIT 1`,
    [scope.value, sort],
  );
  if (!taken) return sort;
  const row = novelGet(
    `SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM ${table} WHERE ${scope.column} = ? AND deleted_at IS NULL`,
    [scope.value],
  ) as { next?: number } | undefined;
  return Number(row?.next) || 1;
}

/**
 * 恢复一个卷：卷本身 + **与它同批删掉**的章节。
 *
 * 判据是 deleted_at 相等（删卷时卷与其内章节写同一个时间戳，见 novel-db 注释）。
 * 删除这个卷之前用户单独删过的章节时间戳更早，不会被顺手复活 —— 它们仍以
 * 独立条目留在回收站里，恢复哪一个由用户决定。
 */
function restoreVolume(id: string): boolean {
  const db = getNovelDb();
  const apply = db.transaction((): boolean => {
    const volume = novelGet(
      "SELECT work_id, sort, deleted_at FROM novel_volumes WHERE id = ? AND deleted_at IS NOT NULL",
      [id],
    ) as { work_id: string; sort: number; deleted_at: number } | undefined;
    if (!volume) return false;
    const batch = Number(volume.deleted_at);
    novelRun("UPDATE novel_volumes SET deleted_at = NULL, sort = ? WHERE id = ?", [
      pickRestoreSort(
        "novel_volumes",
        { column: "work_id", value: volume.work_id },
        volume.sort,
      ),
      id,
    ]);
    const children = novelAll(
      "SELECT id, sort FROM novel_chapters WHERE volume_id = ? AND deleted_at = ? ORDER BY sort",
      [id, batch],
    ) as Array<{ id: string; sort: number }>;
    for (const chapter of children) {
      novelRun("UPDATE novel_chapters SET deleted_at = NULL, sort = ? WHERE id = ?", [
        pickRestoreSort(
          "novel_chapters",
          { column: "volume_id", value: id },
          chapter.sort,
        ),
        chapter.id,
      ]);
    }
    return true;
  });
  return apply() === true;
}

/** 恢复单个章节（父卷若也在回收站，先把卷本身放出来，见函数内注释） */
function restoreChapter(id: string): boolean {
  const db = getNovelDb();
  const apply = db.transaction((): boolean => {
    const chapter = novelGet(
      "SELECT volume_id, sort FROM novel_chapters WHERE id = ? AND deleted_at IS NOT NULL",
      [id],
    ) as { volume_id: string; sort: number } | undefined;
    if (!chapter) return false;

    /*
     * 父卷也在回收站：这是「先单独删了这一章、随后又删了整个卷」的场景。
     * 不先放出卷，恢复出来的章会挂在一个不存在的卷上 —— 章节目录按卷分组，
     * 找不到父卷的章节根本无处安放（等于「恢复了但看不见」）。
     *
     * 只放卷行本身，不动它同批删掉的章节：那些会以独立条目的形式出现在
     * 回收站里，用户能自己挑要哪一个。
     */
    const parent = novelGet(
      "SELECT work_id, sort FROM novel_volumes WHERE id = ? AND deleted_at IS NOT NULL",
      [chapter.volume_id],
    ) as { work_id: string; sort: number } | undefined;
    if (parent) {
      novelRun("UPDATE novel_volumes SET deleted_at = NULL, sort = ? WHERE id = ?", [
        pickRestoreSort(
          "novel_volumes",
          { column: "work_id", value: parent.work_id },
          parent.sort,
        ),
        chapter.volume_id,
      ]);
    }

    novelRun("UPDATE novel_chapters SET deleted_at = NULL, sort = ? WHERE id = ?", [
      pickRestoreSort(
        "novel_chapters",
        { column: "volume_id", value: chapter.volume_id },
        chapter.sort,
      ),
      id,
    ]);
    return true;
  });
  return apply() === true;
}

/** 读 zip 里的清单；缺文件 / 不是小说包时抛出可直接展示给用户的中文错误 */async function readManifestFromZip(zip: JSZip): Promise<NovelBackupManifest> {
  const manifestFile = zip.file(NOVEL_BACKUP_MANIFEST_FILE);
  if (!manifestFile) throw new Error("压缩包内缺少清单文件 manifest.json");
  const parsed = parseNovelBackupManifest(await manifestFile.async("string"));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.manifest;
}

function timestampSuffix(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function registerNovelSafetyHandlers(): void {
  // ── 一键全量备份 ──
  ipcMain.handle("novel-backup-export", async (event) => {
    if (!isNovelDbReady()) throw new Error("小说数据尚未就绪（未登录或正在退出）");
    const email = getCurrentUserEmail();
    if (!email) throw new Error("尚未登录，无法备份");

    // ⚠️ WAL 模式下最近的写入可能还在 -wal 文件里，直接读 novel.db 会拿到
    // 「少了最后几章」的旧镜像。TRUNCATE checkpoint 把它们合并回主文件并清空 WAL。
    novelExec("PRAGMA wal_checkpoint(TRUNCATE)");

    const dbPath = getNovelDbPath(email);
    const dbBytes = fs.readFileSync(dbPath);
    if (!isLikelySqliteFile(dbBytes)) {
      throw new Error("本机小说库读取异常，已中止备份（请先检查磁盘）");
    }

    const counts = collectCounts();
    const zip = new JSZip();
    zip.file(NOVEL_BACKUP_DB_FILE, dbBytes);
    zip.file(
      NOVEL_BACKUP_MANIFEST_FILE,
      JSON.stringify(
        buildNovelBackupManifest({
          counts,
          exportedAt: new Date().toISOString(),
          email,
          appVersion: app.getVersion(),
        }),
        null,
        2,
      ),
    );
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const win = pickWindow(event);
    const options = {
      defaultPath: buildNovelBackupFilename(new Date()),
      filters: ZIP_FILTERS,
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { canceled: true as const, filePath: null, counts };
    }

    const target = result.filePath.toLowerCase().endsWith(".zip")
      ? result.filePath
      : `${result.filePath}.zip`;
    fs.writeFileSync(target, buffer);
    return {
      canceled: false as const,
      filePath: target,
      counts,
      bytes: buffer.length,
    };
  });

  // ── 选包：只读清单做「恢复前预览」，不动任何数据 ──
  ipcMain.handle("novel-backup-pick", async (event) => {
    const win = pickWindow(event);
    const openOptions = {
      properties: ["openFile"] as Array<"openFile">,
      filters: ZIP_FILTERS,
    };
    const picked = win
      ? await dialog.showOpenDialog(win, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (picked.canceled || picked.filePaths.length === 0) {
      return { canceled: true as const, filePath: null, manifest: null };
    }

    const filePath = picked.filePaths[0];
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const manifest = await readManifestFromZip(zip);
    // 清单合法但缺库文件 / 库文件不是 SQLite，都在这里提前拦掉，
    // 不让用户点了「确认恢复」才发现包是坏的
    const dbEntry = zip.file(NOVEL_BACKUP_DB_FILE);
    if (!dbEntry) throw new Error("压缩包内缺少正文数据文件 novel.db");
    const bytes = await dbEntry.async("uint8array");
    if (!isLikelySqliteFile(bytes)) {
      throw new Error("备份包内的数据文件已损坏，无法恢复");
    }
    return { canceled: false as const, filePath, manifest, bytes: bytes.byteLength };
  });

  // ── 恢复：覆盖整库（先留底，失败回滚） ──
  ipcMain.handle("novel-backup-restore", async (_event, filePath: string) => {
    if (!isNovelDbReady()) throw new Error("小说数据尚未就绪（未登录或正在退出）");
    const email = getCurrentUserEmail();
    if (!email) throw new Error("尚未登录，无法恢复");

    const abs = path.resolve(String(filePath ?? ""));
    if (!abs || !fs.existsSync(abs)) throw new Error("备份包已不存在，请重新选择");

    const zip = await JSZip.loadAsync(fs.readFileSync(abs));
    const manifest = await readManifestFromZip(zip);
    const dbEntry = zip.file(NOVEL_BACKUP_DB_FILE);
    if (!dbEntry) throw new Error("压缩包内缺少正文数据文件 novel.db");
    const bytes = await dbEntry.async("nodebuffer");
    if (!isLikelySqliteFile(bytes)) throw new Error("备份包内的数据文件已损坏，无法恢复");

    const dbPath = getNovelDbPath(email);
    const safetyCopy = `${dbPath}.before-restore-${timestampSuffix(new Date())}`;

    // ⚠️ 顺序不可换：必须先关库再动文件。better-sqlite3 持有文件句柄与
    // WAL 映射，边写边替换会让 SQLite 在下次打开时报 malformed。
    closeNovelDb();
    try {
      // 覆盖前留一份底：恢复本身也是「删除现有数据」，
      // 用户如果选错包，还能从这一份把现场捞回来
      if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, safetyCopy);
      for (const suffix of ["", "-wal", "-shm"]) {
        const target = `${dbPath}${suffix}`;
        if (fs.existsSync(target)) fs.rmSync(target);
      }
      fs.writeFileSync(dbPath, bytes);
    } catch (error) {
      // 写失败：把留底拷回去，保证「恢复失败」不等于「数据没了」
      try {
        if (fs.existsSync(safetyCopy)) fs.copyFileSync(safetyCopy, dbPath);
      } catch (rollbackError) {
        console.error("[novel-backup] 回滚留底失败:", rollbackError);
      }
      throw error;
    } finally {
      // 无论成败都重新打开：switchNovelDb 会重跑 initializeNovelDb，
      // 老版本备份缺的新列 / 新表在这里补齐
      switchNovelDb(email);
    }

    windowManager.broadcast(NOVEL_DATA_REPLACED_EVENT, {
      restoredAt: Date.now(),
    });
    return {
      ok: true as const,
      counts: manifest.counts,
      exportedAt: manifest.exportedAt,
      safetyCopy,
    };
  });

  // ── 删除兜底：作品移入回收站 ──
  ipcMain.handle("novel-work-trash", (_event, id: string) =>
    novelRun(
      "UPDATE novel_works SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
      [Date.now(), id],
    ).changes > 0,
  );

  // ── 回收站列表（作品 / 卷 / 章三类合并，按删除时间倒序） ──
  ipcMain.handle("novel-trash-list", (): NovelTrashListResult => {
    if (!isNovelDbReady()) {
      return { items: [], retentionDays: NOVEL_TRASH_RETENTION_DAYS };
    }
    /*
     * 三条分支 UNION 成一张表：
     * - work：整部作品。软删只标作品行，卷章仍在架（deleted_at 为 NULL），
     *   所以这里的卷/章计数取「在架」那部分就是这部书的真实规模。
     * - volume：整卷。章数 / 字数只数**与本卷同批**删掉的那些（= 随卷一起走的）。
     * - chapter：单章。⚠️ 必须排除「随卷一起删」的那批 —— 它们已经由上面那条
     *   卷条目代表了，再列一遍就是同一个东西在回收站里出现两次，而且恢复其中
     *   一条时另一条会变得莫名其妙。
     */
    const rows = novelAll(
      `SELECT 'work' AS kind, w.id AS id, w.name AS name, w.deleted_at AS deleted_at,
              '' AS work_name, '' AS volume_name,
              (SELECT COUNT(*) FROM novel_volumes v WHERE v.work_id = w.id AND v.deleted_at IS NULL) AS volumes,
              (SELECT COUNT(*) FROM novel_chapters c WHERE c.work_id = w.id AND c.deleted_at IS NULL) AS chapters,
              (SELECT COALESCE(SUM(c.word_count), 0) FROM novel_chapters c WHERE c.work_id = w.id AND c.deleted_at IS NULL) AS words
         FROM novel_works w
        WHERE w.deleted_at IS NOT NULL
       UNION ALL
       SELECT 'volume', v.id, v.name, v.deleted_at,
              w.name, '',
              0,
              (SELECT COUNT(*) FROM novel_chapters c WHERE c.volume_id = v.id AND c.deleted_at = v.deleted_at),
              (SELECT COALESCE(SUM(c.word_count), 0) FROM novel_chapters c WHERE c.volume_id = v.id AND c.deleted_at = v.deleted_at)
         FROM novel_volumes v
         JOIN novel_works w ON w.id = v.work_id
        WHERE v.deleted_at IS NOT NULL
       UNION ALL
       SELECT 'chapter', c.id, c.title, c.deleted_at,
              w.name, COALESCE(v.name, ''),
              0, 0, c.word_count
         FROM novel_chapters c
         JOIN novel_works w ON w.id = c.work_id
         LEFT JOIN novel_volumes v ON v.id = c.volume_id
        WHERE c.deleted_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM novel_volumes pv
             WHERE pv.id = c.volume_id
               AND pv.deleted_at IS NOT NULL
               AND pv.deleted_at = c.deleted_at
          )
        ORDER BY deleted_at DESC`,
    ) as Array<{
      kind: string;
      id: string;
      name: string;
      deleted_at: number;
      work_name: string;
      volume_name: string;
      volumes: number;
      chapters: number;
      words: number;
    }>;
    const now = Date.now();
    const items: NovelTrashItemDto[] = rows.map((row) => {
      const deletedAt = Number(row.deleted_at) || 0;
      return {
        kind: (row.kind as NovelTrashKind) ?? "work",
        id: row.id,
        name: row.name,
        deletedAt,
        workName: row.work_name ?? "",
        volumeName: row.volume_name ?? "",
        volumes: Number(row.volumes) || 0,
        chapters: Number(row.chapters) || 0,
        words: Number(row.words) || 0,
        daysLeft: novelTrashDaysLeft(deletedAt, now),
        expired: isNovelTrashExpired(deletedAt, now),
      };
    });
    return { items, retentionDays: NOVEL_TRASH_RETENTION_DAYS };
  });

  /*
   * ── 从回收站恢复 ──
   *
   * 三类共用一个通道，按 kind 分派（`novel-trash-restore(kind, id)`）。
   * 作品只清标记；卷 / 章还要处理「原位是否被占」，见 pickRestoreSort。
   * 任何一类都**不重建数据**：正文、快照、大纲条目全都还在库里。
   */
  ipcMain.handle("novel-trash-restore", (_event, kind: string, id: string) => {
    if (kind === "work") {
      return (
        novelRun(
          "UPDATE novel_works SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL",
          [id],
        ).changes > 0
      );
    }
    if (kind === "volume") return restoreVolume(id);
    if (kind === "chapter") return restoreChapter(id);
    return false;
  });
}
