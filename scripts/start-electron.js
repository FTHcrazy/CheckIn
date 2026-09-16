/**
 * 开发模式 Electron 启动脚本
 * 在 Vite dev server 就绪后启动 Electron
 *
 * 支持的调试开关（由 npm script 透传，也可手动设置环境变量）：
 *   VITE_OPEN_DEVTOOLS=1        启动时自动打开 DevTools
 *   VITE_DEVTOOLS_MODE=detach   以独立窗口(detach)方式打开 DevTools
 *   CHECKIN_ACTIVITY_DEBUG=1    打开主进程活动轮询的调试日志
 *
 * 运行期随时可用 Ctrl+Shift+I / F12 切换 DevTools（见 electron/main.ts）。
 */
const { spawn } = require('child_process')
const electronPath = require('electron')

const DEV_URL = 'http://127.0.0.1:5173'

// 默认不开 DevTools，避免开发模式下影响渲染性能；需要时设置 VITE_OPEN_DEVTOOLS=1。
// 这里显式透传，保证 `cross-env VITE_OPEN_DEVTOOLS=1 node scripts/start-electron.js` 只影响当前进程树。
const child = spawn(electronPath, ['.'], {
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: DEV_URL,
    VITE_OPEN_DEVTOOLS: process.env.VITE_OPEN_DEVTOOLS ?? '0',
    VITE_DEVTOOLS_MODE: process.env.VITE_DEVTOOLS_MODE ?? 'detach',
  },
  stdio: 'inherit',
})

child.on('close', (code) => process.exit(code))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
