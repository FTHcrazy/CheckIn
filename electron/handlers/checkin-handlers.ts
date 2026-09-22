/**
 * 每日打卡 IPC handlers
 *
 * 打卡落库 userDb.checkins：一个「业务日」一条记录（UNIQUE 约束 + INSERT OR IGNORE
 * 保证幂等，重复点击不产生脏数据）。凌晨 0-5 点的打卡归属前一个自然日，
 * 「次日五点重置」由业务日切分自然实现（见 checkin-utils.ts）。
 *
 * 全部时间计算在主进程完成并随结果下发 resetAt，渲染层不重复实现切日逻辑。
 */
import { ipcMain } from "electron";
import { dbAll, dbGet, dbRun } from "../db";
import {
  nextResetTime,
  resolveCheckinDate,
} from "../checkin-utils";

/** 当前业务日打卡状态（渲染层据此渲染按钮态与重置倒计时） */
export interface CheckinStatus {
  /** 当前业务日（YYYY-MM-DD） */
  date: string;
  /** 当前业务日是否已打卡 */
  checkedIn: boolean;
  /** 下一次重置时刻（本地 ISO 字符串，恒为将来某个 5:00 整） */
  resetAt: string;
}

/** 查询当前业务日打卡状态 */
function queryStatus(): CheckinStatus {
  const now = new Date();
  const date = resolveCheckinDate(now);
  const row = dbGet("SELECT id FROM checkins WHERE checkin_date = ?", [date]);
  return {
    date,
    checkedIn: row !== undefined,
    resetAt: nextResetTime(now).toISOString(),
  };
}

export function registerCheckinHandlers(): void {
  // 查询状态（不写库）：挂载时拉取 + 跨过 resetAt 后重新拉取
  ipcMain.handle("checkin-status", (): CheckinStatus => queryStatus());

  // 打卡：为当前业务日写入一条记录；已打卡时幂等返回 created: false
  ipcMain.handle("checkin-today", (): { date: string; created: boolean } => {
    const date = resolveCheckinDate(new Date());
    const result = dbRun(
      "INSERT OR IGNORE INTO checkins (checkin_date) VALUES (?)",
      [date],
    );
    return { date, created: result.changes > 0 };
  });

  // 区间内已打卡的业务日列表（闭区间，YYYY-MM-DD 升序）：日历绿点 / 首页统计共用
  ipcMain.handle(
    "checkin-dates",
    (_event, start: unknown, end: unknown): string[] => {
      if (typeof start !== "string" || typeof end !== "string") return [];
      const rows = dbAll(
        "SELECT checkin_date FROM checkins WHERE checkin_date >= ? AND checkin_date <= ? ORDER BY checkin_date ASC",
        [start, end],
      ) as Array<{ checkin_date: string }>;
      return rows.map((row) => row.checkin_date);
    },
  );
}
