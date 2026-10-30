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
 *
 * 【主进程产物热重启】（1.45.1）
 * vite.config.ts 里两处 `onstart` 都是空函数（不自动启动 Electron / 不 reload），
 * 而 vite-plugin-electron 仍会以 watch 模式把 `electron/*.ts` 编译进 dist-electron/。
 * 结果是：**渲染层靠 HMR 已经是新代码，运行中的主进程却还是旧的**。
 * 表现与「功能坏了」完全一样 —— 新增的 IPC 通道 / 新窗口点了没反应，终端却一行日志
 * 都没有（1.45.0「全局设定中心打不开」就有这一路）。
 *
 * 所以这里自己盯 dist-electron/*.js：产物一变就带防抖重启子进程。
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const DEV_URL = 'http://127.0.0.1:5173'
const ELECTRON_DIR = path.join(__dirname, '..', 'node_modules', 'electron')
const ARTIFACT_DIR = path.join(__dirname, '..', 'dist-electron')

/** 热重启防抖：main.js 与 preload.js 是两次独立构建，会连着各写一次 */
const RESTART_DEBOUNCE_MS = 400
/** 「静默秒退」判定的时间窗 */
const SILENT_EXIT_WINDOW_MS = 5000
/** dist-electron 尚未产出时的监视重试（vite 与插件仍在写盘） */
const WATCH_RETRY_MS = 500
const WATCH_RETRY_MAX = 20

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

// 我们自己发出 SIGINT/SIGTERM 时（concurrently -k 联动关闭、用户 Ctrl+C）
// 不要把退出算作「环境层失败」，否则每次正常关窗都会甩一段误导性的排查清单。
let shuttingDown = false
let startedAt = 0
/** 当前子进程 */
let child = null
/** 已排定的热重启定时器 */
let restartTimer = null
/** 子进程退出是因为「产物变了要重启」，而不是失败 */
let restartPending = false

function launch(isHotRestart) {
  startedAt = Date.now()
  child = spawn(electronPath, ['.'], {
    env: {
      ...cleanEnv,
      VITE_DEV_SERVER_URL: DEV_URL,
    },
    stdio: 'inherit',
  })
  child.on('close', (code) => onChildClose(code, isHotRestart))
}

function onChildClose(code, isHotRestart) {
  // ⚠️ 关机竞态（1.45.1 修）：防抖定时器已经触发过（restartPending = true、
  // 已经 kill 了子进程），此时用户按 Ctrl+C 或 concurrently -k 发来 SIGTERM ——
  // 子进程的 close 事件还是会走到这里。不复位这个标记的话会把 Electron **又拉起来**，
  // 终端表现为「Ctrl+C 之后窗口又冒出来」，还得再杀一次。
  if (restartPending && !shuttingDown) {
    restartPending = false
    console.log('[dev] 按新的主进程产物重新启动 Electron …')
    launch(true)
    return
  }

  // ≤5s 内失败 + 非 0 退出码 + 不是我们自己关的：几乎可以断定没走到 main.js
  if (!shuttingDown && code !== 0 && Date.now() - startedAt < SILENT_EXIT_WINDOW_MS) {
    if (isHotRestart) {
      console.error('\n[dev] 这次是**热重启后的第一次启动**就退出：')
      console.error('      优先看上面 vite 打印的主进程编译 / 语法报错，再看下面这份环境排查清单。')
    }
    printSilentExitHint(code)
  }
  process.exit(code)
}

/**
 * 排定一次热重启。
 *
 * 只对主进程 / preload 的产物（`dist-electron/*.js`）生效；`.map` 与临时文件忽略
 * （写成一次产物会连发多条 fs 事件，防抖把同一轮构建合并成一次重启）。
 */
function scheduleRestart(fileName) {
  if (shuttingDown) return
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (shuttingDown || !child || child.killed) return
    restartPending = true
    console.log(`\n[dev] 主进程产物已更新（dist-electron/${fileName}），重启 Electron …`)
    child.kill('SIGTERM')
  }, RESTART_DEBOUNCE_MS)
}

function watchArtifacts(attempt = 1) {
  try {
    fs.watch(ARTIFACT_DIR, (_eventType, fileName) => {
      if (typeof fileName !== 'string' || !fileName.endsWith('.js')) return
      scheduleRestart(fileName)
    })
    console.log('[dev] 已监视 dist-electron/：主进程 / preload 变更后自动重启')
  } catch (error) {
    // 冷启动时插件可能还没写完 dist-electron，等一会儿再试（否则这项保护会静默失效）
    if (error.code === 'ENOENT' && attempt <= WATCH_RETRY_MAX) {
      setTimeout(() => watchArtifacts(attempt + 1), WATCH_RETRY_MS)
      return
    }
    console.warn(`[dev] 无法监视 dist-electron/：${error.message}`)
    console.warn('      主进程 / preload 变更后请手动重启：Ctrl+C → pnpm dev')
  }
}

function shutdown() {
  shuttingDown = true
  // 作废「已经排定/已经触发」的热重启：否则子进程的 close 回调会走重启分支，
  // 在用户明确要求退出之后再把 Electron 拉起来（见 onChildClose 的注释）
  restartPending = false
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (child) child.kill('SIGTERM')
}

launch(false)
watchArtifacts()

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
