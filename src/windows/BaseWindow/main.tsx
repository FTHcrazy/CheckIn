import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerActivityNotifyBridge } from '@/shared/ipc/activityNotifyBridge'
import './index.scss'
import App from './App'

// 活动提醒 IPC 桥接：仅在本窗口入口注册一次，避免模块副作用扩散到其他窗口
registerActivityNotifyBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
