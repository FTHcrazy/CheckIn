/**
 * 活动提醒轮询器
 * 每10秒检查当前时间是否落在某个活动的时间段内，弹出通知窗口
 * 通知窗口加载 /notif React 页面，通过 IPC 通信
 *
 * 握手流程：
 * 1. 创建窗口（隐藏），加载 /notif 页面
 * 2. React 挂载后发送 notif-ready
 * 3. 主进程收到 ready 后发送 notif-show 数据
 * 4. React 渲染完成后发送 notif-rendered
 * 5. 主进程收到 rendered 后 show 窗口
 */
import { BrowserWindow, screen, ipcMain } from 'electron'
import path from 'path'
import { dbAll } from './db'

interface ActivityRow {
  id: string
  name: string
  start_time: string
  end_time: string
  color: string
}

/** 已通知过且尚未结束的活动 ID */
const notified = new Set<string>()

/** 轮询定时器 */
let timer: ReturnType<typeof setInterval> | null = null

/** 主窗口引用 */
let mainWindow: BrowserWindow | null = null

/** 缓存的通知窗口 */
let notifWin: BrowserWindow | null = null
/** 通知窗口 React 是否就绪 */
let notifReady = false
/** 自动隐藏定时器 */
let hideTimer: ReturnType<typeof setTimeout> | null = null

/** 待发送的通知数据（等 React ready 后再发） */
let pendingNotif: { title: string; body: string; color: string } | null = null
/** 等待渲染完毕的 resolve */
let renderedResolve: (() => void) | null = null

// 环境变量（由 main.ts 传入）
let devServerUrl = ''
let distElectron = ''

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

/** 获取通知窗口位置（右下角） */
function getNotifBounds() {
  const display = screen.getPrimaryDisplay()
  const { x, y, width, height } = display.workArea
  return {
    x: x + width - 380,
    y: y + height - 150,
    width: 360,
    height: 130,
  }
}

/** 判断 IPC 事件是否来自通知窗口 */
function isFromNotifWin(senderId: number): boolean {
  return notifWin !== null && !notifWin.isDestroyed() && notifWin.webContents.id === senderId
}

/** 创建通知窗口（加载 /notif React 页面，隐藏状态） */
function createNotifWin(): void {
  const bounds = getNotifBounds()

  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    transparent: true,
    show: false,
    webPreferences: {
      preload: path.join(distElectron, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 关闭时隐藏而非销毁
  win.on('close', (e) => {
    e.preventDefault()
    win.hide()
  })

  notifWin = win
  notifReady = false

  // 加载 /notif 路由
  if (devServerUrl) {
    win.loadURL(`${devServerUrl}/#/notif`)
  } else {
    win.loadURL(`app://./index.html#/notif`)
  }

  console.log(`[activitiesTask] 通知窗口加载中: ${devServerUrl ? devServerUrl + '/#/notif' : 'app://./index.html#/notif'}`)
}

/** 发送通知并等待渲染完毕后显示窗口 */
async function showNotification(title: string, body: string, color: string): Promise<void> {
  try {
    // 清除旧的自动隐藏定时器
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }

    // 如果窗口不存在或未就绪，创建/等待
    if (!notifWin || notifWin.isDestroyed()) {
      createNotifWin()
    }
    if (!notifWin || notifWin.isDestroyed()) return

    if (!notifReady) {
      // React 还没挂载，暂存数据，等 notif-ready 后再发
      pendingNotif = { title, body, color }
      console.log('[activitiesTask] 等待 React 就绪后再发送数据')
      // 等待就绪（由 IPC handler 触发）
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (notifReady) {
            clearInterval(checkInterval)
            resolve()
          }
        }, 50)
        // 超时 10 秒
        setTimeout(() => { clearInterval(checkInterval); resolve() }, 10_000)
      })
    }

    if (!notifWin || notifWin.isDestroyed()) return
    pendingNotif = null

    // 发送通知数据到渲染进程
    notifWin.webContents.send('notif-show', { title, body, color })
    console.log('[activitiesTask] IPC notif-show 已发送')

    // 等待渲染完毕
    await new Promise<void>((resolve) => {
      renderedResolve = resolve
      // 超时 5 秒
      setTimeout(() => {
        if (renderedResolve) { renderedResolve(); renderedResolve = null }
      }, 5_000)
    })

    // 显示窗口
    const bounds = getNotifBounds()
    notifWin.setBounds(bounds)
    notifWin.show()
    notifWin.setAlwaysOnTop(true)

    // 30秒后自动隐藏
    hideTimer = setTimeout(() => {
      if (notifWin && !notifWin.isDestroyed() && notifWin.isVisible()) {
        notifWin.hide()
      }
    }, 30_000)

    // 通知主窗口回到前台
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }

    console.log(`[activitiesTask] 通知窗口已弹出, 位置: ${JSON.stringify(bounds)}`)
  } catch (err) {
    console.error('[activitiesTask] 通知窗口操作失败:', err)
  }
}

/** 检查活动并弹出通知 */
function check(): void {
  const today = todayStr()
  const now = nowHHmm()

  console.log(`[activitiesTask] 检查: date=${today}, now=${now}`)

  try {
    const allRows = dbAll(
      'SELECT id, name, start_time, end_time, color FROM activities WHERE date = ?',
      [today],
    ) as ActivityRow[]

    console.log(`[activitiesTask] 今日活动数: ${allRows.length}`)

    for (const row of allRows) {
      const start = normalizeTime(row.start_time)
      const end = normalizeTime(row.end_time)

      console.log(`[activitiesTask] 活动 "${row.name}": ${start} ~ ${end}, notified=${notified.has(row.id)}`)

      if (now >= start && now <= end) {
        if (notified.has(row.id)) continue

        notified.add(row.id)
        const title = '活动提醒'
        const body = `${row.name}\n${start} - ${end}`
        console.log(`[activitiesTask] 弹出通知: ${row.name}`)

        showNotification(title, body, row.color || '#1677ff')
      } else {
        if (notified.has(row.id)) {
          notified.delete(row.id)
          console.log(`[activitiesTask] 活动已过期，重置通知状态: ${row.name}`)
        }
      }
    }
  } catch (err) {
    console.error('[activitiesTask] check 执行出错:', err)
  }
}

/** 注册 IPC handlers */
function registerIpcHandlers(): void {
  // React 挂载完毕，通知主进程就绪
  ipcMain.on('notif-ready', (event) => {
    if (!isFromNotifWin(event.sender.id)) return
    console.log('[activitiesTask] 收到 notif-ready')
    notifReady = true

    // 如果有待发送的数据，立即发送
    if (pendingNotif && notifWin && !notifWin.isDestroyed()) {
      notifWin.webContents.send('notif-show', pendingNotif)
      console.log('[activitiesTask] 发送待处理的 notif-show 数据')
      pendingNotif = null
    }
  })

  // React 渲染完毕，通知主进程可以显示窗口了
  ipcMain.on('notif-rendered', (event) => {
    if (!isFromNotifWin(event.sender.id)) return
    console.log('[activitiesTask] 收到 notif-rendered')
    if (renderedResolve) {
      renderedResolve()
      renderedResolve = null
    }
  })

  // 渲染进程请求隐藏通知窗口
  ipcMain.on('notif-hide', (event) => {
    if (!isFromNotifWin(event.sender.id)) return
    if (notifWin && !notifWin.isDestroyed()) {
      notifWin.hide()
    }
  })
}

/** 注册通知 IPC handlers（应用启动时立即调用） */
export function registerNotifIpc(options: { devServerUrl: string; distElectron: string }): void {
  devServerUrl = options.devServerUrl
  distElectron = options.distElectron
  registerIpcHandlers()
  console.log('[activitiesTask] 通知 IPC handlers 已注册')
}

/** 启动轮询（每10秒检查一次，需要主窗口引用） */
export function startActivityPolling(window: BrowserWindow): void {
  if (timer) return
  mainWindow = window
  console.log('[activitiesTask] 启动活动轮询 (10s)')
  check()
  timer = setInterval(check, 10_000)
}

/** 停止轮询 */
export function stopActivityPolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    mainWindow = null
    console.log('[activitiesTask] 活动轮询已停止')
  }
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (notifWin && !notifWin.isDestroyed()) {
    notifWin.removeAllListeners('close')
    notifWin.destroy()
    notifWin = null
    notifReady = false
  }
  // 清理 IPC handlers
  ipcMain.removeAllListeners('notif-ready')
  ipcMain.removeAllListeners('notif-rendered')
  ipcMain.removeAllListeners('notif-hide')
}
