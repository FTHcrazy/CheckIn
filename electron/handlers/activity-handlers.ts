/**
 * 活动管理语义化 IPC handlers
 * 将 daily.ts 中的原始 SQL 操作迁移到主进程
 */
import { ipcMain } from 'electron';
import { dbAll, dbRun } from '../db';

interface ActivityRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  name: string;
  color: string;
}

interface ActivityAddParams {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  name: string;
  color: string;
}

interface ActivityUpdateParams {
  id: string;
  updates: Partial<Omit<ActivityAddParams, 'id'>>;
}

export function registerActivityHandlers(): void {
  // 获取所有活动
  ipcMain.handle('activity-list', async () => {
    const rows = dbAll(
      'SELECT * FROM activities ORDER BY date DESC, start_time ASC'
    ) as ActivityRow[];
    return rows;
  });

  // 按日期获取活动
  ipcMain.handle('activity-list-by-date', async (_event, date: string) => {
    const rows = dbAll(
      'SELECT * FROM activities WHERE date = ? ORDER BY start_time ASC',
      [date]
    ) as ActivityRow[];
    return rows;
  });

  // 获取有活动的日期列表
  ipcMain.handle('activity-active-dates', async (_event, start: string, end: string) => {
    const rows = dbAll(
      'SELECT DISTINCT date FROM activities WHERE date >= ? AND date <= ?',
      [start, end]
    ) as { date: string }[];
    return rows.map((r) => r.date);
  });

  // 添加活动
  ipcMain.handle('activity-add', async (_event, params: ActivityAddParams) => {
    dbRun(
      'INSERT INTO activities (id, date, start_time, end_time, name, color) VALUES (?, ?, ?, ?, ?, ?)',
      [params.id, params.date, params.startTime, params.endTime, params.name, params.color]
    );
    return params;
  });

  // 更新活动
  ipcMain.handle('activity-update', async (_event, params: ActivityUpdateParams) => {
    const sets: string[] = [];
    const values: unknown[] = [];

    // 白名单列名，安全拼接
    if (params.updates.date !== undefined) {
      sets.push('date = ?');
      values.push(params.updates.date);
    }
    if (params.updates.startTime !== undefined) {
      sets.push('start_time = ?');
      values.push(params.updates.startTime);
    }
    if (params.updates.endTime !== undefined) {
      sets.push('end_time = ?');
      values.push(params.updates.endTime);
    }
    if (params.updates.name !== undefined) {
      sets.push('name = ?');
      values.push(params.updates.name);
    }
    if (params.updates.color !== undefined) {
      sets.push('color = ?');
      values.push(params.updates.color);
    }

    if (sets.length === 0) return;

    sets.push("updated_at = datetime('now', 'localtime')");
    values.push(params.id);

    dbRun(`UPDATE activities SET ${sets.join(', ')} WHERE id = ?`, values);
  });

  // 删除活动
  ipcMain.handle('activity-delete', async (_event, id: string) => {
    dbRun('DELETE FROM activities WHERE id = ?', [id]);
  });
}
