/**
 * 数据迁移 IPC handlers（导出 zip / 导入 zip）
 *
 * 导出：按勾选范围打包 manifest.json + todos.json + memos/*.md，弹保存框写盘。
 * 导入：弹打开框选 zip，校验清单后「追加合并」到本地——
 *   todo 重新分配自增 id 并修复 parent_id 指向；备忘重名自动追加序号，不覆盖已有文件。
 * 全部文件 IO 与系统弹窗都在主进程，渲染层只传勾选范围、拿结果。
 */
import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { dbAll, dbExec, dbRun, getCurrentUserEmail } from "../db";
import { ensureMemosDir } from "../user-paths";
import {
  MIGRATION_MANIFEST_FILE,
  MIGRATION_MEMOS_DIR,
  MIGRATION_TODOS_FILE,
  buildExportFilename,
  buildManifest,
  dedupeMemoName,
  listMemoEntries,
  normalizeScopes,
  parseManifest,
  parseTodoRows,
  planTodoInserts,
  sanitizeMemoName,
  type MigrationScope,
  type MigrationTodoRow,
} from "../migration-utils";

interface TodoRow {
  id: number;
  parent_id: number | null;
  content: string;
  done: number;
  note: string | null;
  important: number;
  work_hour: number | null;
  created_at: string;
  done_at: string | null;
}

export interface MigrationCounts {
  todo: number;
  memo: number;
}

export interface MigrationExportResult {
  canceled: boolean;
  /** 取消时为 null */
  filePath: string | null;
  counts: MigrationCounts;
}

export interface MigrationImportResult {
  canceled: boolean;
  /** 实际导入的范围（取自清单，可能与勾选不一致） */
  scopes: MigrationScope[];
  counts: MigrationCounts;
  /** 包内存在但未能写入的备忘条目名 */
  skipped: string[];
}

/** 表行 → 包内行（驼峰命名，与表结构解耦） */
function toMigrationRow(row: TodoRow): MigrationTodoRow {
  return {
    id: row.id,
    parentId: row.parent_id,
    content: row.content,
    done: row.done,
    note: row.note,
    important: row.important,
    workHour: row.work_hour,
    createdAt: row.created_at,
    doneAt: row.done_at,
  };
}

function readTodoRows(): MigrationTodoRow[] {
  // 按 id 升序：父项通常先创建，导出顺序更贴近界面
  const rows = dbAll("SELECT * FROM todos ORDER BY id ASC") as TodoRow[];
  return rows.map(toMigrationRow);
}

/** 按计划写入 todo：先父后子，建立旧 id → 新 id 映射后修复 parent_id */
function insertTodos(rows: MigrationTodoRow[]): number {
  const plan = planTodoInserts(rows);
  if (plan.length === 0) return 0;

  const sourceIdToNewId = new Map<number, number>();
  dbExec("BEGIN");
  try {
    for (const item of plan) {
      // 父项尚未写入（包内父子成环）时退化为顶层项
      const parentId =
        item.parentSourceId === null ? null : (sourceIdToNewId.get(item.parentSourceId) ?? null);
      const result = dbRun(
        "INSERT INTO todos (parent_id, content, done, note, important, work_hour, created_at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          parentId,
          item.content,
          item.done,
          item.note,
          item.important,
          item.workHour,
          item.createdAt,
          item.doneAt,
        ],
      );
      sourceIdToNewId.set(item.sourceId, result.lastInsertRowid);
    }
    dbExec("COMMIT");
  } catch (error) {
    dbExec("ROLLBACK");
    throw error;
  }
  return plan.length;
}

function pickWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

const ZIP_FILTERS = [{ name: "数据迁移包", extensions: ["zip"] }];

async function handleExport(
  event: IpcMainInvokeEvent,
  scopesInput: unknown,
): Promise<MigrationExportResult> {
  const scopes = normalizeScopes(scopesInput);
  if (scopes.length === 0) throw new Error("请至少勾选一项要导出的数据");

  const zip = new JSZip();
  const counts: MigrationCounts = { todo: 0, memo: 0 };

  if (scopes.includes("todo")) {
    const rows = readTodoRows();
    counts.todo = rows.length;
    zip.file(MIGRATION_TODOS_FILE, JSON.stringify(rows, null, 2));
  }

  if (scopes.includes("memo")) {
    const memosDir = ensureMemosDir();
    const files = fs.readdirSync(memosDir).filter((name) => name.endsWith(".md"));
    counts.memo = files.length;
    for (const name of files) {
      zip.file(`${MIGRATION_MEMOS_DIR}/${name}`, fs.readFileSync(path.join(memosDir, name)));
    }
  }

  const email = getCurrentUserEmail();
  zip.file(
    MIGRATION_MANIFEST_FILE,
    JSON.stringify(
      buildManifest({
        scopes,
        counts,
        exportedAt: new Date().toISOString(),
        email: email || undefined,
      }),
      null,
      2,
    ),
  );

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const win = pickWindow(event);
  const options = { defaultPath: buildExportFilename(new Date()), filters: ZIP_FILTERS };
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return { canceled: true, filePath: null, counts };
  }

  const target = result.filePath.toLowerCase().endsWith(".zip")
    ? result.filePath
    : `${result.filePath}.zip`;
  fs.writeFileSync(target, buffer);
  return { canceled: false, filePath: target, counts };
}

async function handleImport(event: IpcMainInvokeEvent): Promise<MigrationImportResult> {
  const win = pickWindow(event);
  const openOptions = {
    properties: ["openFile"] as Array<"openFile">,
    filters: ZIP_FILTERS,
  };
  const picked = win
    ? await dialog.showOpenDialog(win, openOptions)
    : await dialog.showOpenDialog(openOptions);
  if (picked.canceled || picked.filePaths.length === 0) {
    return { canceled: true, scopes: [], counts: { todo: 0, memo: 0 }, skipped: [] };
  }

  const zip = await JSZip.loadAsync(fs.readFileSync(picked.filePaths[0]));
  const manifestFile = zip.file(MIGRATION_MANIFEST_FILE);
  if (!manifestFile) throw new Error("压缩包内缺少清单文件 manifest.json");
  const parsed = parseManifest(await manifestFile.async("string"));
  if (!parsed.ok) throw new Error(parsed.error);

  const { scopes } = parsed.manifest;
  const counts: MigrationCounts = { todo: 0, memo: 0 };
  const skipped: string[] = [];

  if (scopes.includes("todo")) {
    const todosFile = zip.file(MIGRATION_TODOS_FILE);
    if (todosFile) counts.todo = insertTodos(parseTodoRows(await todosFile.async("string")));
  }

  if (scopes.includes("memo")) {
    const memosDir = ensureMemosDir();
    // 已占用名集合：既有文件 + 本次已写入，保证同批重名也互不覆盖
    const taken = new Set(fs.readdirSync(memosDir));
    for (const entry of listMemoEntries(Object.keys(zip.files))) {
      const file = zip.file(entry);
      if (!file) {
        skipped.push(entry);
        continue;
      }
      const safeName = sanitizeMemoName(entry.slice(MIGRATION_MEMOS_DIR.length + 1));
      const finalName = dedupeMemoName(safeName, taken);
      taken.add(finalName);
      fs.writeFileSync(path.join(memosDir, finalName), await file.async("string"), "utf-8");
      counts.memo += 1;
    }
  }

  return { canceled: false, scopes, counts, skipped };
}

export function registerMigrationHandlers(): void {
  ipcMain.handle("migration-export", (event, scopes: unknown) => handleExport(event, scopes));
  ipcMain.handle("migration-import", (event) => handleImport(event));
}
