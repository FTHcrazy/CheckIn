// Electron API 类型声明
export interface ElectronAPI {
  httpRequest: (options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
  }) => Promise<{ status: number; data: unknown }>
  send: (channel: string, data: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
