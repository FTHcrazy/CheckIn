/**
 * 打卡纯函数（业务日切分 / 下次重置时间）
 *
 * 不依赖 electron / Node API，可在 vitest 中直接测试；
 * 实际读写 checkins 表在 handlers/checkin-handlers.ts 中。
 *
 * 业务日定义：以凌晨 5:00 为切日点——
 *   - 05:00 ~ 23:59 的打卡归属当天；
 *   - 00:00 ~ 04:59 的打卡归属前一天（熬夜场景不算新的一天）。
 * 「次日五点重置」即业务日切换：跨过 5:00 后按钮恢复可打卡。
 */

/** 业务日切日点（小时） */
export const CHECKIN_BOUNDARY_HOUR = 5;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 计算给定时刻归属的业务日（YYYY-MM-DD，本地时区）。
 * 时刻落在 [0:00, 5:00) 时归属前一个自然日。
 */
export function resolveCheckinDate(
  now: Date,
  boundaryHour: number = CHECKIN_BOUNDARY_HOUR,
): string {
  const business = new Date(now);
  if (business.getHours() < boundaryHour) {
    business.setDate(business.getDate() - 1);
  }
  return `${business.getFullYear()}-${pad(business.getMonth() + 1)}-${pad(business.getDate())}`;
}

/**
 * 计算下一次业务日切换时刻（本地时间的小时整点）。
 * 已过当日切日点则顺延一天，返回值恒大于 now。
 */
export function nextResetTime(
  now: Date,
  boundaryHour: number = CHECKIN_BOUNDARY_HOUR,
): Date {
  const next = new Date(now);
  next.setHours(boundaryHour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}
