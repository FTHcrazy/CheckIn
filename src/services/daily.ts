/**
 * 日常活动管理服务
 * 使用 SQLite 数据库持久化
 */

/** 活动定义 */
export interface Activity {
  id: string
  date: string      // YYYY-MM-DD
  startTime: string // HH:mm
  endTime: string   // HH:mm
  name: string
  color?: string
}

interface ActivityRow {
  id: string
  date: string
  start_time: string
  end_time: string
  name: string
  color: string
}

/** 数据库行 → Activity 对象 */
function rowToActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    name: row.name,
    color: row.color,
  }
}

/** 活动颜色池 */
export const ACTIVITY_COLORS = [
  '#1677ff', // 蓝
  '#52c41a', // 绿
  '#fa8c16', // 橙
  '#722ed1', // 紫
  '#eb2f96', // 粉
  '#13c2c2', // 青
  '#f5222d', // 红
]

/** 生成唯一 ID */
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** 获取所有活动 */
export async function getAllActivities(): Promise<Activity[]> {
  const rows = await window.electronAPI!.db.all(
    'SELECT * FROM activities ORDER BY date DESC, start_time ASC',
  ) as ActivityRow[]
  return rows.map(rowToActivity)
}

/** 获取指定日期的活动 */
export async function getActivitiesByDate(date: string): Promise<Activity[]> {
  const rows = await window.electronAPI!.db.all(
    'SELECT * FROM activities WHERE date = ? ORDER BY start_time ASC',
    [date],
  ) as ActivityRow[]
  return rows.map(rowToActivity)
}

/** 获取日期区间内有活动的日期列表 */
export async function getActiveDates(start: string, end: string): Promise<Set<string>> {
  const rows = await window.electronAPI!.db.all(
    'SELECT DISTINCT date FROM activities WHERE date >= ? AND date <= ?',
    [start, end],
  ) as { date: string }[]
  return new Set(rows.map((r) => r.date))
}

/** 添加活动 */
export async function addActivity(
  date: string,
  startTime: string,
  endTime: string,
  name: string,
  color?: string,
): Promise<Activity> {
  const activity: Activity = {
    id: genId(),
    date,
    startTime,
    endTime,
    name,
    color: color || ACTIVITY_COLORS[Math.floor(Math.random() * ACTIVITY_COLORS.length)],
  }
  await window.electronAPI!.db.run(
    'INSERT INTO activities (id, date, start_time, end_time, name, color) VALUES (?, ?, ?, ?, ?, ?)',
    [activity.id, activity.date, activity.startTime, activity.endTime, activity.name, activity.color],
  )
  return activity
}

/** 更新活动 */
export async function updateActivity(id: string, updates: Partial<Omit<Activity, 'id'>>): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []

  if (updates.date !== undefined) { sets.push('date = ?'); values.push(updates.date) }
  if (updates.startTime !== undefined) { sets.push('start_time = ?'); values.push(updates.startTime) }
  if (updates.endTime !== undefined) { sets.push('end_time = ?'); values.push(updates.endTime) }
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name) }
  if (updates.color !== undefined) { sets.push('color = ?'); values.push(updates.color) }

  if (sets.length === 0) return

  sets.push("updated_at = datetime('now', 'localtime')")
  values.push(id)

  await window.electronAPI!.db.run(
    `UPDATE activities SET ${sets.join(', ')} WHERE id = ?`,
    values,
  )
}

/** 删除活动 */
export async function deleteActivity(id: string): Promise<void> {
  await window.electronAPI!.db.run('DELETE FROM activities WHERE id = ?', [id])
}

/** 时间字符串转分钟数 "HH:mm" → number */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** 分钟数转时间字符串 */
export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
