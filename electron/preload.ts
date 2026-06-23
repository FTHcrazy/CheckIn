import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 示例：暴露 ipcRenderer 方法
  send: (channel: string, data: unknown) => {
    const validChannels = ['toMain']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = ['fromMain']
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => func(...args))
    }
  },
})
