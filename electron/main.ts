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
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(DIST_ELECTRON, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
