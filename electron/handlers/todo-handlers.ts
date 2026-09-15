/**
 * Todo 管理语义化 IPC handlers
 * 将 useTodoPage.ts 中的原始 SQL 操作迁移到主进程
 * 含父子级联切换逻辑，修复 done_at SQL 注入风险
 */
import { ipcMain } from 'electron';
import { dbAll, dbRun } from '../db';

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
}
