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

  // ── 活动管理（语义化 IPC） ──
  activity: {
    list: () => ipcRenderer.invoke('activity-list'),
    listByDate: (date: string) => ipcRenderer.invoke('activity-list-by-date', date),
    activeDates: (start: string, end: string) => ipcRenderer.invoke('activity-active-dates', start, end),
    add: (params: { id: string; date: string; startTime: string; endTime: string; name: string; color: string }) =>
      ipcRenderer.invoke('activity-add', params),
    update: (params: { id: string; updates: Partial<{ date: string; startTime: string; endTime: string; name: string; color: string }> }) =>
      ipcRenderer.invoke('activity-update', params),
    delete: (id: string) => ipcRenderer.invoke('activity-delete', id),
  },

  // ── Todo 管理（语义化 IPC） ──
  todo: {
    list: () => ipcRenderer.invoke('todo-list'),
    add: (content: string, workHour: number | null) =>
      ipcRenderer.invoke('todo-add', { content, workHour }),
    addChild: (parentId: number, content: string, workHour: number | null) =>
      ipcRenderer.invoke('todo-add-child', { parentId, content, workHour }),
    delete: (id: number) => ipcRenderer.invoke('todo-delete', id),
    updateContent: (id: number, content: string, workHour: number | null) =>
      ipcRenderer.invoke('todo-update-content', { id, content, workHour }),
    updateNote: (id: number, note: string | null) =>
      ipcRenderer.invoke('todo-update-note', id, note),
    deleteNote: (id: number) => ipcRenderer.invoke('todo-delete-note', id),
    updateWorkHour: (id: number, workHour: number | null) =>
      ipcRenderer.invoke('todo-update-work-hour', id, workHour),
    deleteWorkHour: (id: number) => ipcRenderer.invoke('todo-delete-work-hour', id),
    toggleImportant: (id: number, important: number) =>
      ipcRenderer.invoke('todo-toggle-important', id, important),
    toggle: (id: number, checked: boolean) =>
      ipcRenderer.invoke('todo-toggle', id, checked),
    toggleChild: (id: number, checked: boolean) =>
      ipcRenderer.invoke('todo-toggle-child', id, checked),
    toggleParent: (id: number, checked: boolean) =>
      ipcRenderer.invoke('todo-toggle-parent', id, checked),
  },

  // ── 用户管理 ──
  user: {
    get: () => ipcRenderer.invoke('user-get'),
    login: (email: string) => ipcRenderer.invoke('user-login', email),
    update: (email: string) => ipcRenderer.invoke('user-update', email),
  },

  send: (channel: string, data: unknown) => {
    const validChannels = ['login-confirm', 'worker-window-open', 'worker-window-close']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = ['activity-notify', 'worker-window-close']
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => func(...args))
    }
  },

  // ── 跨窗口通信 ──
  windowAPI: {
    broadcast: (event: string, data?: unknown) =>
      ipcRenderer.invoke('window-broadcast', event, data),
    sendTo: (target: string, event: string, data?: unknown) =>
      ipcRenderer.invoke('window-send-to', target, event, data),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      ipcRenderer.on(event, (_event, ...args) => handler(...args))
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      ipcRenderer.removeListener(event, handler)
    },
  },

  // ── 备忘文件操作 ──
  memo: {
    list: () => ipcRenderer.invoke('memo-list') as Promise<{ name: string; updatedAt: string }[]>,
    read: (filename: string) => ipcRenderer.invoke('memo-read', filename) as Promise<string>,
    write: (filename: string, content: string) => ipcRenderer.invoke('memo-write', filename, content) as Promise<boolean>,
    rename: (oldFilename: string, newFilename: string) => ipcRenderer.invoke('memo-rename', oldFilename, newFilename) as Promise<boolean>,
    delete: (filename: string) => ipcRenderer.invoke('memo-delete', filename) as Promise<boolean>,
    openInExplorer: (filename: string) => ipcRenderer.invoke('memo-open-in-explorer', filename) as Promise<boolean>,
    import: () => ipcRenderer.invoke('memo-import') as Promise<string[]>,
  },

  findInPage: (value?: string) =>
    ipcRenderer.invoke('find-in-page', value) as Promise<boolean>,
})
