/**
 * 开发模式 Electron 启动脚本
 * 在 Vite dev server 就绪后启动 Electron
 *
 * 【fail-fast 守卫】
 * 老版本直接 `require('electron')`，而 Electron ≥41 已经没有 postinstall，
 * 二进制缺失时 index.js 会在 require 的**同步调用栈里** spawnSync 跑 install.js
 * 去下载 140MB —— 无超时、无进度、默认直连 github。终端表现就是「pnpm dev 卡住不动」。
 *
 * 因此这里必须先校验二进制，缺失就给出明确指引并立刻退出，
 * **绝不**让 require 偷偷触发下载。二进制补装请走 scripts/ensure-electron.mjs
 * （它在 dev 前置钩子里自动执行）。
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const DEV_URL = 'http://127.0.0.1:5173'
const ELECTRON_DIR = path.join(__dirname, '..', 'node_modules', 'electron')

function resolveElectronExe() {
  let rel
  try {
    rel = fs.readFileSync(path.join(ELECTRON_DIR, 'path.txt'), 'utf8').trim()
  } catch {
    rel = null
  }
  if (!rel) return null
  const exeAbs = path.join(ELECTRON_DIR, 'dist', rel)
  return fs.existsSync(exeAbs) ? exeAbs : null
}

const electronPath = resolveElectronExe()
if (!electronPath) {
  console.error('\n[dev] Electron 运行时二进制缺失，已中止启动（避免陷入无超时的静默下载）。')
  console.error('      请执行： pnpm ensure:electron')
  console.error('      若仍失败： rm -rf node_modules/electron && pnpm install\n')
  process.exit(1)
}

// 从 IDE / Electron 宿主继承来的这几个变量会让 electron.exe 退化成普通 Node：
//   ELECTRON_RUN_AS_NODE=1 → require('electron') 不再返回 app / BrowserWindow，
//                            而是返回 electron.exe 的路径字符串
// 表现为主进程直接崩在 `Cannot read properties of undefined (reading 'app')`，
// 或窗口永远起不来。这里必须显式剔除，保证任何宿主终端下行为一致。
const {
  ELECTRON_RUN_AS_NODE,
  ELECTRON_NO_ATTACH_CONSOLE,
  ...cleanEnv
} = process.env

const startedAt = Date.now()
const child = spawn(electronPath, ['.'], {
  env: {
    ...cleanEnv,
    VITE_DEV_SERVER_URL: DEV_URL,
  },
  stdio: 'inherit',
})

/**
 * 「秒退且零输出」诊断。
 *
 * Windows 上的 electron.exe 是 GUI 子系统程序，不挂控制台，所以 Windows 上
 * 连崩溃栈都看不到——终端里只剩孤零零一行
 *     [1] wait-on tcp:5173 && node scripts/start-electron.js exited with code 1
 * 已实测确认：这种「几秒内 exit=1 且零输出」不是本项目代码的问题，
 * 连只有一个 console.log 的最小 Electron 应用都同样失败，说明进程还没执行到
 * main.js 就被环境掐掉了。常见成因按概率排列：
 */
function printSilentExitHint(code) {
  console.error(`\n[dev] Electron 在 ${Date.now() - startedAt}ms 内以 code=${code} 静默退出，且没有任何输出。`)
  console.error('      已实测排除本项目代码原因（连最小 Electron 应用都同样失败），')
  console.error('      属于 **Electron GUI 进程在当前环境无法初始化**，按概率排查：')
  console.error('')
  console.error('      1. 当前是被 Electron 宿主（WorkBuddy / VS Code 等）派生的集成终端，')
  console.error('         其 Job Object 带 UI 限制，Chromium 无法初始化。')
  console.error('         → 换系统自带终端重试：Win+R → cmd → cd 到项目目录 → pnpm dev')
  console.error('      2. 安全软件 / Windows Defender 拦截了 electron.exe（无提示的静默拦截）')
  console.error('         → 检查病毒防护的隔离区，或将 node_modules 加入排除项')
  console.error('      3. Electron 运行时依赖缺失')
  console.error('         → rm -rf node_modules/electron && pnpm install 重新拉取')
  console.error('')
  console.error('      快速自检：pnpm doctor\n')
}

// 我们自己:#发出 SIGINT/SIGTERM 时（concurrently -k 联动关闭、用户 Ctrl+C）
// 不要把退出算作「环境层失败」，否则每次正常关窗都会甩一段误导性的排查清单。
let shuttingDown = false
function shutdown() {
  shuttingDown = true
  child.kill('SIGTERM')
}

child.on('close', (code) => {
  // ≤5s 内失败 + 非 0 退出码 + 不是我们自己关的：几乎可以断定没走到 main.js
  if (!shuttingDown && code !== 0 && Date.now() - startedAt < 5000) printSilentExitHint(code)
  process.exit(code)
})
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
