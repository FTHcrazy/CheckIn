/**
 * 日常活动管理服务
 * 通过语义化 IPC 与主进程通信
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
  const rows = await window.electronAPI!.activity.list()
  return rows.map(rowToActivity)
}

/** 获取指定日期的活动 */
export async function getActivitiesByDate(date: string): Promise<Activity[]> {
  const rows = await window.electronAPI!.activity.listByDate(date)
  return rows.map(rowToActivity)
}

/** 获取日期区间内有活动的日期列表 */
export async function getActiveDates(start: string, end: string): Promise<Set<string>> {
  const dates = await window.electronAPI!.activity.activeDates(start, end)
  return new Set(dates)
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
  await window.electronAPI!.activity.add({
    id: activity.id,
    date: activity.date,
    startTime: activity.startTime,
    endTime: activity.endTime,
    name: activity.name,
    color: activity.color!,
  })
  return activity
}

/** 更新活动 */
export async function updateActivity(id: string, updates: Partial<Omit<Activity, 'id'>>): Promise<void> {
  const mappedUpdates: Record<string, unknown> = {}

  if (updates.date !== undefined) mappedUpdates.date = updates.date
  if (updates.startTime !== undefined) mappedUpdates.startTime = updates.startTime
  if (updates.endTime !== undefined) mappedUpdates.endTime = updates.endTime
  if (updates.name !== undefined) mappedUpdates.name = updates.name
  if (updates.color !== undefined) mappedUpdates.color = updates.color

  if (Object.keys(mappedUpdates).length === 0) return

  await window.electronAPI!.activity.update({
    id,
    updates: mappedUpdates as { date?: string; startTime?: string; endTime?: string; name?: string; color?: string },
  })
}

/** 删除活动 */
export async function deleteActivity(id: string): Promise<void> {
  await window.electronAPI!.activity.delete(id)
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
