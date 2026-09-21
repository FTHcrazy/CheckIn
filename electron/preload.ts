import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 网络会话配置（一次性）：把认证 Cookie 写入 session jar，
  // 之后渲染进程 fetch 带 credentials:'include' 自动携带。
  // 请求本身不再经由主进程转发。
  httpSession: {
    setCookie: (url: string, cookie: string) =>
      ipcRenderer.invoke('http-session-set-cookie', { url, cookie }) as Promise<boolean>,
  },

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

  // ── 小说编辑器（语义化 IPC，数据存 userDb 的 novel_* 表） ──
  novel: {
    editorLoad: () => ipcRenderer.invoke('novel-editor-load'),
    configGet: (key: string) =>
      ipcRenderer.invoke('novel-config-get', key) as Promise<string | null>,
    configSet: (key: string, value: string) =>
      ipcRenderer.invoke('novel-config-set', key, value) as Promise<boolean>,
    addWork: (work: unknown) =>
      ipcRenderer.invoke('novel-work-add', work) as Promise<boolean>,
    renameWork: (id: string, name: string) =>
      ipcRenderer.invoke('novel-work-rename', id, name) as Promise<boolean>,
    deleteWork: (id: string) =>
      ipcRenderer.invoke('novel-work-delete', id) as Promise<boolean>,
    // 一键重置为模板书籍（调试）：清空全部 novel_* 表并重新播种模板数据
    resetTemplate: () =>
      ipcRenderer.invoke('novel-editor-reset-template') as Promise<{ volumes: number; chapters: number; words: number; entities: number }>,
    saveChapter: (id: string, content: string, wordCount: number) =>
      ipcRenderer.invoke('novel-chapter-save', id, content, wordCount) as Promise<boolean>,
    listSnapshots: (chapterId: string) =>
      ipcRenderer.invoke('novel-snapshot-list', chapterId),
    addChapter: (chapter: unknown) =>
      ipcRenderer.invoke('novel-chapter-add', chapter) as Promise<boolean>,
    renameChapter: (id: string, title: string) =>
      ipcRenderer.invoke('novel-chapter-rename', id, title) as Promise<boolean>,
    deleteChapter: (id: string) =>
      ipcRenderer.invoke('novel-chapter-delete', id) as Promise<boolean>,
    setChapterStatus: (id: string, status: string) =>
      ipcRenderer.invoke('novel-chapter-status', id, status) as Promise<boolean>,
    saveChapterOutline: (id: string, note: string) =>
      ipcRenderer.invoke('novel-chapter-outline', id, note) as Promise<boolean>,
    saveChapterOrder: (updates: Array<{ id: string; sort: number; volumeId: string }>) =>
      ipcRenderer.invoke('novel-chapter-order', updates) as Promise<boolean>,
    addVolume: (volume: unknown) =>
      ipcRenderer.invoke('novel-volume-add', volume) as Promise<boolean>,
    renameVolume: (id: string, name: string) =>
      ipcRenderer.invoke('novel-volume-rename', id, name) as Promise<boolean>,
    saveVolumeOrder: (updates: Array<{ id: string; sort: number }>) =>
      ipcRenderer.invoke('novel-volume-order', updates) as Promise<boolean>,
    saveEntity: (entity: unknown) =>
      ipcRenderer.invoke('novel-entity-save', entity) as Promise<boolean>,
    addLink: (link: unknown) => ipcRenderer.invoke('novel-link-add', link) as Promise<boolean>,
    removeLink: (id: string) => ipcRenderer.invoke('novel-link-remove', id) as Promise<boolean>,
    saveNote: (note: unknown) => ipcRenderer.invoke('novel-note-save', note) as Promise<boolean>,
    removeNote: (id: string) => ipcRenderer.invoke('novel-note-remove', id) as Promise<boolean>,
    saveOutlineEntry: (entry: unknown) =>
      ipcRenderer.invoke('novel-outline-entry-save', entry) as Promise<boolean>,
    removeOutlineEntry: (id: string) =>
      ipcRenderer.invoke('novel-outline-entry-remove', id) as Promise<boolean>,
  },

  send: (channel: string, data: unknown) => {
    const validChannels = [
      'login-confirm',
      'worker-window-open',
      // WindowHeader 窗口控制（最小化/最大化/关闭）与最大化状态查询
      'window-control',
      'window-maximize-query',
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  // 返回取消订阅函数，组件卸载时可移除监听，避免重复注册
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = ['activity-notify', 'window-maximize-state']
    if (validChannels.includes(channel)) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => func(...args)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
    return () => {}
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
    exportFile: (filename: string, format: 'txt' | 'docx') =>
      ipcRenderer.invoke('memo-export', filename, format) as Promise<boolean>,
  },

  findInPage: (value?: string) =>
    ipcRenderer.invoke('find-in-page', value) as Promise<boolean>,
})
