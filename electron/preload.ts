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
    const validChannels = ['toMain']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = ['fromMain', 'activity-notify']
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => func(...args))
    }
  },

  // 备忘文件操作
  memo: {
    list: () => ipcRenderer.invoke('memo-list') as Promise<{ name: string; updatedAt: string }[]>,
    read: (filename: string) => ipcRenderer.invoke('memo-read', filename) as Promise<string>,
    write: (filename: string, content: string) => ipcRenderer.invoke('memo-write', filename, content) as Promise<boolean>,
    delete: (filename: string) => ipcRenderer.invoke('memo-delete', filename) as Promise<boolean>,
    openInExplorer: (filename: string) => ipcRenderer.invoke('memo-open-in-explorer', filename) as Promise<boolean>,
  },
})
