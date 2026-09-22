/**
 * Todo 管理语义化 IPC handlers
 * 将 useTodoPage.ts 中的原始 SQL 操作迁移到主进程
 * 含父子级联切换逻辑，修复 done_at SQL 注入风险
 *
 * 备份包（原「数据迁移」模块并入本页）：todo-backup-export 打包
 * manifest.json + todos.json 弹保存框写盘；todo-backup-import 弹打开框
 * 校验清单后「追加合并」——重新分配自增 id 并修复 parent_id 指向。
 */
import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import JSZip from 'jszip';
import { dbAll, dbExec, dbRun, getCurrentUserEmail } from '../db';
import {
  BACKUP_MANIFEST_FILE,
  BACKUP_TODOS_FILE,
  buildExportFilename,
  buildManifest,
  parseManifest,
  parseTodoRows,
  planTodoInserts,
  type TodoBackupRow,
} from '../backup-utils';

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

interface TodoAddParams {
  content: string;
  workHour: number | null;
}

interface TodoAddChildParams {
  parentId: number;
  content: string;
  workHour: number | null;
}

interface TodoUpdateContentParams {
  id: number;
  content: string;
  workHour: number | null;
}

export interface TodoBackupExportResult {
  canceled: boolean;
  /** 取消时为 null */
  filePath: string | null;
  count: number;
}

export interface TodoBackupImportResult {
  canceled: boolean;
  count: number;
  /** 包内存在但未能解析的条目（当前 todo 解析为静默跳过，恒为空数组，保留字段与 memo 备份对齐） */
  skipped: string[];
}

/** 表行 → 包内行（驼峰命名，与表结构解耦） */
function toBackupRow(row: TodoRow): TodoBackupRow {
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

/** 按计划写入 todo：先父后子，建立旧 id → 新 id 映射后修复 parent_id */
function insertTodos(rows: TodoBackupRow[]): number {
  const plan = planTodoInserts(rows);
  if (plan.length === 0) return 0;

  const sourceIdToNewId = new Map<number, number>();
  dbExec('BEGIN');
  try {
    for (const item of plan) {
      // 父项尚未写入（包内父子成环）时退化为顶层项
      const parentId =
        item.parentSourceId === null ? null : (sourceIdToNewId.get(item.parentSourceId) ?? null);
      const result = dbRun(
        'INSERT INTO todos (parent_id, content, done, note, important, work_hour, created_at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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
    dbExec('COMMIT');
  } catch (error) {
    dbExec('ROLLBACK');
    throw error;
  }
  return plan.length;
}

function pickWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

const ZIP_FILTERS = [{ name: '数据备份包', extensions: ['zip'] }];

// 获取当前本地时间的 ISO 字符串（SQLite datetime 格式）
function nowLocalISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 子项切换 + 检查兄弟 + 联动父项
 * 从 useTodoPage.ts handleToggleChild 迁移
 */
async function handleToggleChildLogic(id: number, checked: boolean): Promise<void> {
  const doneVal = checked ? 1 : 0;
  const doneAt = checked ? nowLocalISO() : null;

  // 切换自身
  dbRun('UPDATE todos SET done = ?, done_at = ? WHERE id = ?', [doneVal, doneAt, id]);

  // 查询父项
  const child = dbAll('SELECT parent_id FROM todos WHERE id = ?', [id]) as TodoRow[];
  if (child.length > 0 && child[0].parent_id !== null) {
    const parentId = child[0].parent_id;

    // 检查所有兄弟项是否全部完成
    const siblings = dbAll('SELECT done FROM todos WHERE parent_id = ?', [parentId]) as TodoRow[];
    const allDone = siblings.length > 0 && siblings.every((s) => s.done === 1);

    if (allDone) {
      // 全部完成 → 父项也完成
      dbRun('UPDATE todos SET done = 1, done_at = ? WHERE id = ?', [nowLocalISO(), parentId]);
    } else if (!checked) {
      // 取消勾选 → 父项也取消
      dbRun('UPDATE todos SET done = 0, done_at = NULL WHERE id = ?', [parentId]);
    }
  }
}

/**
 * 父项切换 + 级联所有子项
 * 从 useTodoPage.ts handleToggleParent 迁移
 */
async function handleToggleParentLogic(id: number, checked: boolean): Promise<void> {
  const doneVal = checked ? 1 : 0;
  const doneAt = checked ? nowLocalISO() : null;

  // 切换自身
  dbRun('UPDATE todos SET done = ?, done_at = ? WHERE id = ?', [doneVal, doneAt, id]);

  if (checked) {
    // 勾选父项 → 所有未完成子项也完成
    dbRun('UPDATE todos SET done = 1, done_at = ? WHERE parent_id = ? AND done = 0', [nowLocalISO(), id]);
  } else {
    // 取消父项 → 所有子项取消
    dbRun('UPDATE todos SET done = 0, done_at = NULL WHERE parent_id = ?', [id]);
  }
}

export function registerTodoHandlers(): void {
  // 获取所有 todo
  ipcMain.handle('todo-list', async () => {
    const rows = dbAll('SELECT * FROM todos ORDER BY created_at DESC') as TodoRow[];
    return rows;
  });

  // 添加 todo
  ipcMain.handle('todo-add', async (_event, params: TodoAddParams) => {
    const result = dbRun('INSERT INTO todos (content, work_hour) VALUES (?, ?)', [
      params.content,
      params.workHour,
    ]);
    return { lastInsertRowid: result.lastInsertRowid };
  });

  // 添加子项
  ipcMain.handle('todo-add-child', async (_event, params: TodoAddChildParams) => {
    dbRun('INSERT INTO todos (parent_id, content, work_hour) VALUES (?, ?, ?)', [
      params.parentId,
      params.content,
      params.workHour,
    ]);
  });

  // 删除 todo（含子项）
  ipcMain.handle('todo-delete', async (_event, id: number) => {
    dbRun('DELETE FROM todos WHERE id = ? OR parent_id = ?', [id, id]);
  });

  // 更新内容
  ipcMain.handle('todo-update-content', async (_event, params: TodoUpdateContentParams) => {
    // 只更新标题和工时，备注、完成状态等字段由各自的语义化接口维护。
    dbRun('UPDATE todos SET content = ?, work_hour = COALESCE(?, work_hour) WHERE id = ?', [
      params.content,
      params.workHour,
      params.id,
    ]);
  });

  // 更新备注
  ipcMain.handle('todo-update-note', async (_event, id: number, note: string | null) => {
    dbRun('UPDATE todos SET note = ? WHERE id = ?', [note, id]);
  });

  // 删除备注
  ipcMain.handle('todo-delete-note', async (_event, id: number) => {
    dbRun('UPDATE todos SET note = NULL WHERE id = ?', [id]);
  });

  // 更新工时
  ipcMain.handle('todo-update-work-hour', async (_event, id: number, workHour: number | null) => {
    dbRun('UPDATE todos SET work_hour = ? WHERE id = ?', [workHour, id]);
  });

  // 删除工时
  ipcMain.handle('todo-delete-work-hour', async (_event, id: number) => {
    dbRun('UPDATE todos SET work_hour = NULL WHERE id = ?', [id]);
  });

  // 切换重要标记
  ipcMain.handle('todo-toggle-important', async (_event, id: number, important: number) => {
    dbRun('UPDATE todos SET important = ? WHERE id = ?', [important, id]);
  });

  // 切换完成状态（顶层项，无级联）
  ipcMain.handle('todo-toggle', async (_event, id: number, checked: boolean) => {
    const doneVal = checked ? 1 : 0;
    const doneAt = checked ? nowLocalISO() : null;
    dbRun('UPDATE todos SET done = ?, done_at = ? WHERE id = ?', [doneVal, doneAt, id]);
  });

  // 切换子项完成状态（含父项级联）
  ipcMain.handle('todo-toggle-child', async (_event, id: number, checked: boolean) => {
    await handleToggleChildLogic(id, checked);
  });

  // 切换父项完成状态（含子项级联）
  ipcMain.handle('todo-toggle-parent', async (_event, id: number, checked: boolean) => {
    await handleToggleParentLogic(id, checked);
  });

  // 备份导出：全量 todo 打包 manifest + todos.json，弹保存框写盘
  ipcMain.handle(
    'todo-backup-export',
    async (event): Promise<TodoBackupExportResult> => {
      const rows = (dbAll('SELECT * FROM todos ORDER BY id ASC') as TodoRow[]).map(toBackupRow);
      const zip = new JSZip();
      zip.file(BACKUP_TODOS_FILE, JSON.stringify(rows, null, 2));
      zip.file(
        BACKUP_MANIFEST_FILE,
        JSON.stringify(
          buildManifest({
            scope: 'todo',
            count: rows.length,
            exportedAt: new Date().toISOString(),
            email: getCurrentUserEmail() || undefined,
          }),
          null,
          2,
        ),
      );

      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const win = pickWindow(event);
      const options = {
        defaultPath: buildExportFilename(new Date(), 'todo'),
        filters: ZIP_FILTERS,
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) {
        return { canceled: true, filePath: null, count: rows.length };
      }

      const target = result.filePath.toLowerCase().endsWith('.zip')
        ? result.filePath
        : `${result.filePath}.zip`;
      fs.writeFileSync(target, buffer);
      return { canceled: false, filePath: target, count: rows.length };
    },
  );

  // 备份导入：选 zip → 校验清单 → 追加合并（重新分配 id 并修复父子指向）
  ipcMain.handle(
    'todo-backup-import',
    async (event): Promise<TodoBackupImportResult> => {
      const win = pickWindow(event);
      const openOptions = {
        properties: ['openFile'] as Array<'openFile'>,
        filters: ZIP_FILTERS,
      };
      const picked = win
        ? await dialog.showOpenDialog(win, openOptions)
        : await dialog.showOpenDialog(openOptions);
      if (picked.canceled || picked.filePaths.length === 0) {
        return { canceled: true, count: 0, skipped: [] };
      }

      const zip = await JSZip.loadAsync(fs.readFileSync(picked.filePaths[0]));
      const manifestFile = zip.file(BACKUP_MANIFEST_FILE);
      if (!manifestFile) throw new Error('压缩包内缺少清单文件 manifest.json');
      const parsed = parseManifest(await manifestFile.async('string'));
      if (!parsed.ok) throw new Error(parsed.error);
      if (!parsed.manifest.scopes.includes('todo')) {
        throw new Error('该备份包不包含待办数据');
      }

      const todosFile = zip.file(BACKUP_TODOS_FILE);
      if (!todosFile) throw new Error('压缩包内缺少待办数据文件 todos.json');
      const count = insertTodos(parseTodoRows(await todosFile.async('string')));
      return { canceled: false, count, skipped: [] };
    },
  );
}
