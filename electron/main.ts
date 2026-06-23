import { app, BrowserWindow, protocol } from 'electron'
import path from 'path'
import fs from 'fs'

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

  // 页面加载完成后再显示窗口，避免空白窗口
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
}

app.whenReady().then(() => {
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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
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
