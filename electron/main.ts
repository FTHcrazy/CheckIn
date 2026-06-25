import { app, BrowserWindow, ipcMain, protocol, Tray, Menu } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'https'
import { initDb, closeDb, dbAll, dbGet, dbRun, dbExec } from './db'

// 只保留中英文 locale，减少内存占用
app.commandLine.appendSwitch('lang', 'zh-CN,en-US')

// 处理打包后的路径
// __dirname 在 CJS 输出中可用 (vite-plugin-electron 默认输出 CJS)
const DIST_ELECTRON = __dirname
const DIST = path.join(DIST_ELECTRON, '../dist')
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const ICON_PATH = VITE_DEV_SERVER_URL
  ? path.join(DIST_ELECTRON, '../public/icon.ico')
  : path.join(DIST, 'icon.ico')

// 注册自定义协议用于加载本地文件 (必须在 app.whenReady 之前调用)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

function createWindow() {
  const t0 = Date.now()
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: ICON_PATH,
    show: false, // 先隐藏，等页面加载完成再显示
    webPreferences: {
      preload: path.join(DIST_ELECTRON, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 点击关闭按钮时隐藏窗口而非退出
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  win.once('ready-to-show', () => {
    console.log(`[main] 页面加载完成: ${Date.now() - t0}ms`)
    win.show()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    // 使用自定义协议加载本地文件，避免 file:// 安全限制
    win.loadURL(`app://./index.html`)
  }

  return win
}

let isQuitting = false
let mainWindow: BrowserWindow | null = null

// 单实例锁定：防止多个应用和托盘同时存在
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => {
  // 第二个实例启动时，聚焦已有窗口
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  // 初始化本地数据库
  initDb()

  // 注册数据库 IPC handlers
  ipcMain.handle('db-all', (_event, sql: string, params?: unknown[]) => dbAll(sql, params))
  ipcMain.handle('db-get', (_event, sql: string, params?: unknown[]) => dbGet(sql, params))
  ipcMain.handle('db-run', (_event, sql: string, params?: unknown[]) => dbRun(sql, params))
  ipcMain.handle('db-exec', (_event, sql: string) => { dbExec(sql); return true })

  // 注册协议处理器，将 app:// 请求映射到本地文件
  protocol.handle('app', (request) => {
    const url = request.url.replace('app://./', '')
    const filePath = path.join(DIST, decodeURIComponent(url))
    const content = fs.readFileSync(filePath)
    return new Response(content, {
      headers: {
        'Content-Type': getMimeType(filePath),
      },
    })
  })

  // 注册 HTTP 请求 IPC handler，支持设置 Cookie 等禁止请求头
  ipcMain.handle('http-request', async (_event, options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
  }) => {
    return new Promise((resolve, reject) => {
      const url = new URL(options.url)
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: options.method || 'GET',
          headers: options.headers || {},
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => { data += chunk })
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(data) })
            } catch {
              resolve({ status: res.statusCode, data })
            }
          })
        },
      )
      req.on('error', (err) => reject(err.message))
      if (options.body) req.write(options.body)
      req.end()
    })
  })

  const win = createWindow()
  mainWindow = win

  // 系统托盘图标，点击可重新显示窗口
  const tray = new Tray(ICON_PATH)
  tray.setToolTip('CheckIn')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: () => win?.show() },
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on('click', () => win?.show())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
  closeDb()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}
