/**
 * 日常活动管理服务
 * 使用 localStorage 持久化活动数据
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

const STORAGE_KEY = 'checkin-activities'

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
export function getAllActivities(): Activity[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/** 获取指定日期的活动 */
export function getActivitiesByDate(date: string): Activity[] {
  return getAllActivities()
    .filter((a) => a.date === date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
}

/** 获取日期区间内有活动的日期列表 */
export function getActiveDates(start: string, end: string): Set<string> {
  const activities = getAllActivities()
  const dates = new Set<string>()
  activities.forEach((a) => {
    if (a.date >= start && a.date <= end) {
      dates.add(a.date)
    }
  })
  return dates
}

/** 添加活动 */
export function addActivity(
  date: string,
  startTime: string,
  endTime: string,
  name: string,
  color?: string,
): Activity {
  const activity: Activity = {
    id: genId(),
    date,
    startTime,
    endTime,
    name,
    color: color || ACTIVITY_COLORS[Math.floor(Math.random() * ACTIVITY_COLORS.length)],
  }
  const list = getAllActivities()
  list.push(activity)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  return activity
}

/** 更新活动 */
export function updateActivity(id: string, updates: Partial<Omit<Activity, 'id'>>): void {
  const list = getAllActivities()
  const idx = list.findIndex((a) => a.id === id)
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...updates }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  }
}

/** 删除活动 */
export function deleteActivity(id: string): void {
  const list = getAllActivities().filter((a) => a.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
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
