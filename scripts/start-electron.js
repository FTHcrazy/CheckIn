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
const fs = require('fs')

// Fail-fast 守卫：electron 二进制缺失时给出可执行的修复指引，而非晦涩报错。
// 典型成因：pnpm ≥10 默认拦截依赖构建脚本，electron 的 postinstall（下载二进制）
// 未执行。本项目已在 package.json 的 pnpm.onlyBuiltDependencies 中放行。
let electronPath
try {
  electronPath = require('electron')
} catch {
  console.error('[checkin] Electron 二进制缺失（node_modules/electron 安装不完整）。')
  console.error('[checkin] 修复方式（任选其一）：')
  console.error('[checkin]   1. pnpm install   （已配置 onlyBuiltDependencies，会重新触发下载）')
  console.error('[checkin]   2. pnpm rebuild electron')
  process.exit(1)
}
if (typeof electronPath === 'string' && !fs.existsSync(electronPath)) {
  console.error('[checkin] Electron 可执行文件不存在：' + electronPath)
  console.error('[checkin] 修复方式：pnpm install 或 pnpm rebuild electron 后重试。')
  process.exit(1)
}

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
