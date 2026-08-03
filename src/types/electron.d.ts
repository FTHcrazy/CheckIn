// Electron API 类型声明
export interface ElectronAPI {
  httpRequest: (options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
  }) => Promise<{ status: number; data: unknown }>

  db: {
    /** SELECT 查询，返回结果数组 */
    all: (sql: string, params?: unknown[]) => Promise<unknown[]>
    /** SELECT 查询，返回单条结果 */
    get: (sql: string, params?: unknown[]) => Promise<unknown>
    /** INSERT/UPDATE/DELETE，返回 { changes, lastInsertRowid } */
    run: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number }>
    /** 批量执行 SQL */
    exec: (sql: string) => Promise<boolean>
  }

  send: (channel: string, data: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void

  memo: {
    list: () => Promise<{ name: string; updatedAt: string }[]>
    read: (filename: string) => Promise<string>
    write: (filename: string, content: string) => Promise<boolean>
    delete: (filename: string) => Promise<boolean>
    openInExplorer: (filename: string) => Promise<boolean>
  }
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
