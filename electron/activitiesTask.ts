/**
 * 活动提醒轮询器
 * 每 10 秒检查当前时间是否落在某个活动的时间段内
 * 匹配时通过 WindowManager 广播通知所有窗口
 *
 * 系统睡眠/锁屏时暂停轮询，激活后恢复
 */
import { powerMonitor } from 'electron'
import { dbAll } from './db'
import { windowManager } from './windowManager'

interface ActivityRow {
  id: string
  name: string
  start_time: string
  end_time: string
  color: string
  updated_at: string
}

/** 已通知过的活动 ID（本次运行期间不再重复） */
const notified = new Set<string>()

/** 轮询定时器 */
let timer: ReturnType<typeof setInterval> | null = null

/** 获取当前时间的 HH:mm 格式 */
function nowHHmm(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 获取今天的日期 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 标准化时间格式 */
function normalizeTime(t: string): string {
  const parts = t.split(':')
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
}

/** 开发模式下的调试日志开关（默认关闭，避免高频轮询刷屏拖慢终端） */
const DEBUG = process.env['CHECKIN_ACTIVITY_DEBUG'] === '1'

function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log(...args)
}

/** 检查活动并通知渲染进程 */
function check(): void {
  const today = todayStr()
  const now = nowHHmm()

  debugLog(`[activitiesTask] 检查: date=${today}, now=${now}`)

  try {
    const allRows = dbAll(
      'SELECT id, name, start_time, end_time, color, updated_at FROM activities WHERE date = ?',
      [today],
    ) as ActivityRow[]

    debugLog(`[activitiesTask] 今日活动数: ${allRows.length}`)

    // 找到最近更新的、尚未通知过的、当前时间匹配的活动
    let latest: ActivityRow | null = null

    for (const row of allRows) {
      const start = normalizeTime(row.start_time)
      const end = normalizeTime(row.end_time)

      debugLog(`[activitiesTask] 活动 "${row.name}": ${start} ~ ${end}, notified=${notified.has(row.id)}`)

      if (now >= start && now <= end && !notified.has(row.id)) {
        if (!latest || row.updated_at > latest.updated_at) {
          latest = row
        }
      }
    }

    // 通知最近更新的那一个
    if (latest) {
      notified.add(latest.id)
      const start = normalizeTime(latest.start_time)
      const end = normalizeTime(latest.end_time)
      const notifyData = {
        name: latest.name,
        start,
        end,
        color: latest.color || '#1677ff',
      }
      debugLog(`[activitiesTask] 触发通知: ${latest.name}`)

      // 通过 windowManager 广播通知所有窗口
      windowManager.broadcast('activity-notify', notifyData)

      // 唤醒主窗口
      const mainWin = windowManager.get('main')
      if (mainWin) {
        if (!mainWin.isVisible()) mainWin.show()
        if (mainWin.isMinimized()) mainWin.restore()
        mainWin.setAlwaysOnTop(true, 'screen-saver')
        mainWin.show()
        mainWin.focus()
        // 2秒后取消置顶，让用户可以正常切换窗口
        setTimeout(() => {
          if (!mainWin.isDestroyed()) {
            mainWin.setAlwaysOnTop(false)
          }
        }, 2000)
        // 任务栏闪烁作为保底
        mainWin.flashFrame(true)
      }
    }
  } catch (err) {
    console.error('[activitiesTask] check 执行出错:', err)
  }
}

/** 暂停轮询 */
function pausePolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    debugLog('[activitiesTask] 系统睡眠/锁屏，轮询已暂停')
  }
}

/** 恢复轮询 */
function resumePolling(): void {
  if (!timer) {
    debugLog('[activitiesTask] 系统激活，轮询已恢复')
    check()
    timer = setInterval(check, 10_000)
  }
}

/** 启动轮询（每30秒检查一次） */
export function startActivityPolling(): void {
  if (timer) return
  debugLog('[activitiesTask] 启动活动轮询 (30s)')
  check()
  timer = setInterval(check, 30_000)

  // 监听系统睡眠/锁屏，暂停轮询；激活后恢复
  powerMonitor.on('suspend', pausePolling)
  powerMonitor.on('lock-screen', pausePolling)
  powerMonitor.on('resume', resumePolling)
  powerMonitor.on('unlock-screen', resumePolling)
}

/** 停止轮询 */
export function stopActivityPolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    debugLog('[activitiesTask] 活动轮询已停止')
  }
  // 清理电源监听
  powerMonitor.removeListener('suspend', pausePolling)
  powerMonitor.removeListener('lock-screen', pausePolling)
  powerMonitor.removeListener('resume', resumePolling)
  powerMonitor.removeListener('unlock-screen', resumePolling)
}
