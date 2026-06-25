import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 通用 HTTP 请求（支持 Cookie 等禁止请求头）
  httpRequest: (options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
  }) => ipcRenderer.invoke('http-request', options),

  // 数据库操作
  db: {
    all: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db-all', sql, params),
    get: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db-get', sql, params),
    run: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db-run', sql, params),
    exec: (sql: string) => ipcRenderer.invoke('db-exec', sql),
  },

  send: (channel: string, data: unknown) => {
    const validChannels = ['toMain', 'notif-hide', 'notif-ready', 'notif-rendered']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = ['fromMain', 'notif-show']
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => func(...args))
    }
  },
})
