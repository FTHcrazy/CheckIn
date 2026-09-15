// Electron API 类型声明

interface ActivityAddParams {
  id: string
  date: string
  startTime: string
  endTime: string
  name: string
  color: string
}

interface ActivityUpdateParams {
  date?: string
  startTime?: string
  endTime?: string
  name?: string
  color?: string
}

interface ActivityRow {
  id: string
  date: string
  start_time: string
  end_time: string
  name: string
  color: string
}

interface TodoRow {
  id: number
  parent_id: number | null
  content: string
  done: number
  note: string | null
  important: number
  work_hour: number | null
  created_at: string
  done_at: string | null
}

export interface ElectronAPI {
  httpRequest: (options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
  }) => Promise<{ status: number; data: unknown }>

  // ── 活动管理 ──
  activity: {
    list: () => Promise<ActivityRow[]>
    listByDate: (date: string) => Promise<ActivityRow[]>
    activeDates: (start: string, end: string) => Promise<string[]>
    add: (params: ActivityAddParams) => Promise<ActivityAddParams>
    update: (params: { id: string; updates: ActivityUpdateParams }) => Promise<void>
    delete: (id: string) => Promise<void>
  }

  // ── Todo 管理 ──
  todo: {
    list: () => Promise<TodoRow[]>
    add: (content: string, workHour: number | null) => Promise<{ lastInsertRowid: number }>
    addChild: (parentId: number, content: string, workHour: number | null) => Promise<void>
    delete: (id: number) => Promise<void>
    updateContent: (id: number, content: string, workHour: number | null) => Promise<void>
    updateNote: (id: number, note: string | null) => Promise<void>
    deleteNote: (id: number) => Promise<void>
    updateWorkHour: (id: number, workHour: number | null) => Promise<void>
    deleteWorkHour: (id: number) => Promise<void>
    toggleImportant: (id: number, important: number) => Promise<void>
    toggle: (id: number, checked: boolean) => Promise<void>
    toggleChild: (id: number, checked: boolean) => Promise<void>
    toggleParent: (id: number, checked: boolean) => Promise<void>
  }

  user: {
    get: () => Promise<{ id: number; email: string } | null>
    login: (email: string) => Promise<boolean>
    update: (email: string) => Promise<boolean>
  }

  send: (channel: string, data: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void

  // ── 跨窗口通信 ──
  windowAPI: {
    broadcast: (event: string, data?: unknown) => Promise<void>
    sendTo: (target: string, event: string, data?: unknown) => Promise<void>
    on: (event: string, handler: (...args: unknown[]) => void) => void
    off: (event: string, handler: (...args: unknown[]) => void) => void
  }

  memo: {
    list: () => Promise<{ name: string; updatedAt: string }[]>
    read: (filename: string) => Promise<string>
    write: (filename: string, content: string) => Promise<boolean>
    delete: (filename: string) => Promise<boolean>
    openInExplorer: (filename: string) => Promise<boolean>
    import: () => Promise<string[]>
  }

  findInPage: (value?: string) => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
