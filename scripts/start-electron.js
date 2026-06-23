/**
 * 开发模式 Electron 启动脚本
 * 在 Vite dev server 就绪后启动 Electron
 */
const { spawn } = require('child_process')
const electronPath = require('electron')

const DEV_URL = 'http://127.0.0.1:5173'

const child = spawn(electronPath, ['.'], {
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: DEV_URL,
  },
  stdio: 'inherit',
})

child.on('close', (code) => process.exit(code))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
