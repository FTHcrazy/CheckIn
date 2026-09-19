/**
 * ensure-electron.mjs —— Electron 运行时二进制守卫（`pnpm dev` 卡死的根治手段）
 *
 * 【根因，务必读懂后再改】
 * Electron ≥41（本项目 42.4.1）的 package.json **已经没有 postinstall 脚本了**
 * （实测 `pkg.scripts === undefined`，只有 bin.electron / bin.install-electron）。
 * 安装二进制的时机被推迟到了**首次 `require('electron')`**：
 *
 *   node_modules/electron/index.js:
 *     没有 path.txt → 在 require 的同步调用栈里 spawnSync(node, install.js)
 *     → @electron/get 下载 ~140MB → 默认走 github.com，**无超时、无进度条**
 *
 * 于是链条是这样的：
 *   1. 删 node_modules 重装 / dist 丢失
 *   2. `pnpm dev` → start-electron.js → `require('electron')`
 *   3. install.js 直连 GitHub（或没传镜像）→ **永久挂起，终端毫无动静**
 *   4. 用户 Ctrl+C 重来 → 还是同一个坑，且每次都从头下载
 *
 * 注意：`.npmrc` 里写的 `electron_mirror` **只有在包管理器自己执行安装脚本时**
 * 才会被转成环境变量 ELECTRON_MIRROR。手动跑 install.js、或被 index.js 内部
 * spawn 时，一个环境变量都没有 → 直连 github 卡死。这就是本脚本存在的理由。
 *
 * 【本脚本做什么】
 *   1. 校验 node_modules/electron/dist/<exe> 与 path.txt 是否齐全
 *   2. 齐全 → 立即退出 0（毫秒级，不影响正常 dev 启动速度）
 *   3. 缺失 → **自己把 .npmrc 的镜像读出来，显式注入 ELECTRON_MIRROR**，
 *      再跑 install.js，并强制加超时上限 + 人话错误指引（fail fast，不静默等待）
 *
 * 【为什么通常只要 2 秒】
 * @electron/get 会命中 `%LOCALAPPDATA%\electron\Cache`（Windows）里已缓存的 zip，
 * 命中时不走网络，直接解压即可。
 *
 * 用法：node scripts/ensure-electron.mjs [--timeout-ms=180000]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_DIR = path.join(ROOT, 'node_modules', 'electron')

const argTimeout = process.argv.find((a) => a.startsWith('--timeout-ms='))
const TIMEOUT_MS = Number(argTimeout ? argTimeout.split('=')[1] : 180000)

/** 兜底镜像：宁可走镜像，也不能直连无超时的 github */
const DEFAULT_MIRROR = 'https://npmmirror.com/mirrors/electron/'

/**
 * 读取 .npmrc 中的 electron_mirror。
 * 优先级：环境变量 ELECTRON_MIRROR > 项目 .npmrc > 用户级 ~/.npmrc > 内置兜底镜像。
 * 之所以必须显式读：这条配置只有在包管理器执行安装脚本时才会自动变成环境变量，
 * 任何直接调用 install.js 的路径（含 electron/index.js 内部的 spawnSync）都拿不到。
 */
function resolveMirror() {
  if (process.env.ELECTRON_MIRROR) return process.env.ELECTRON_MIRROR

  const candidates = [
    path.join(ROOT, '.npmrc'),
    path.join(os.homedir(), '.npmrc'),
  ]
  for (const file of candidates) {
    try {
      const line = fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => /^electron[_-]mirror\s*=/i.test(l))
      if (line) {
        const value = line.slice(line.indexOf('=') + 1).trim()
        if (value) return value.replace(/\/$/, '') + '/'
      }
    } catch {
      /* 文件不存在或不可读，继续下一个候选 */
    }
  }
  return DEFAULT_MIRROR
}

function readExeRelPath() {
  try {
    const txt = fs.readFileSync(path.join(ELECTRON_DIR, 'path.txt'), 'utf8').trim()
    return txt || null
  } catch {
    return null
  }
}

/**
 * 完整性检查 —— 这是本脚本最关键的一段，别删。
 *
 * 只校验 `dist/electron.exe` + `path.txt` 是**远远不够的**。真实事故：
 *   安装过程被打断 → install.js 已经写完 path.txt（它自己据此认为装好了），
 *   但 dist 只解压出一部分：**缺了 `locales/*.pak`（55 个 ICU 语言包）和
 *   `resources/default_app.asar`**。
 *   缺 locales 时 Chromium 浏览器进程会在 **几十毫秒内 exit(1)，且零输出**
 *   （electron.exe 是 GUI 子系统程序，不挂控制台），排查时极其误导。
 *
 * 所以这里必须显式校验这两个「exe 还在但缺它就必炸」的部件。
 *
 * @returns {{ ok: boolean, exeAbs?: string, problems: string[] }}
 */
function inspect() {
  const problems = []

  if (!fs.existsSync(path.join(ELECTRON_DIR, 'package.json'))) {
    return { ok: false, problems: ['node_modules/electron 不存在，请先执行 pnpm install'] }
  }

  const rel = readExeRelPath()
  if (!rel) {
    problems.push('缺少 node_modules/electron/path.txt（Electron 运行时未安装）')
  } else {
    const abs = path.join(ELECTRON_DIR, 'dist', rel)
    if (!fs.existsSync(abs)) problems.push(`缺少 ${path.relative(ROOT, abs)}（Electron 二进制未解压）`)
  }

  const distDir = path.join(ELECTRON_DIR, 'dist')
  if (fs.existsSync(distDir)) {
    let pakCount = 0
    try {
      pakCount = fs.readdirSync(path.join(distDir, 'locales')).filter((f) => f.endsWith('.pak')).length
    } catch {
      pakCount = 0
    }
    if (pakCount === 0) {
      problems.push('缺少 dist/locales/*.pak（ICU 语言包）—— 缺它时 Chromium 几十毫秒内 exit(1) 且零输出')
    }
    if (!fs.existsSync(path.join(distDir, 'resources', 'default_app.asar'))) {
      problems.push('缺少 dist/resources/default_app.asar')
    }
  }

  return {
    ok: problems.length === 0,
    exeAbs: rel ? path.join(ELECTRON_DIR, 'dist', rel) : undefined,
    problems,
  }
}

/** 清空已有产物后重新解压（解铃还须系铃人：仍走官方 install.js，不手工拼目录） */
function installElectron({ wipe }) {
  if (wipe) {
    fs.rmSync(path.join(ELECTRON_DIR, 'dist'), { recursive: true, force: true })
    try {
      fs.rmSync(path.join(ELECTRON_DIR, 'path.txt'), { force: true })
    } catch {
      /* 本来就不存在，忽略 */
    }
  }
  return spawnSync(process.execPath, [path.join(ELECTRON_DIR, 'install.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: TIMEOUT_MS,
    env: {
      ...process.env,
      // 关键：显式注入，避免 @electron/get 回落到直连 github 的无限等待
      ELECTRON_MIRROR: resolveMirror(),
    },
  })
}

let state = inspect()
if (state.ok) {
  console.log(`[ensure-electron] Electron 运行时完整：${path.relative(ROOT, state.exeAbs)}`)
  process.exit(0)
}

console.error('[ensure-electron] 检测到 Electron 运行时不完整：')
for (const p of state.problems) console.error(`  - ${p}`)

// 只有 locales / default_app.asar 残缺 ⇒ 解压被中途打断。
// 这种情况必须清干净重装：install.js 看到 path.txt 存在就认定「已安装」直接退出，永远不自愈。
const interruptedExtraction =
  state.problems.length > 0 && state.problems.every((p) => /locales|default_app\.asar/.test(p))

const started = Date.now()
let r
if (interruptedExtraction) {
  console.error('[ensure-electron] 判定为「解压中途被中断」，清空 dist 后重新解压...')
  r = installElectron({ wipe: true })
} else {
  console.error('[ensure-electron] 正在补装 Electron 运行时（优先命中本地缓存，通常几秒完成）...')
  r = installElectron({ wipe: false })
}

if (r.error && /ETIMEDOUT/.test(r.error.code || '')) {
  console.error(
    `\n[ensure-electron] 安装超过 ${Math.round(TIMEOUT_MS / 1000)}s 未完成。` +
      "\n  @electron/get 在 require('electron') 里同步下载且没有超时，这正是 pnpm dev \"卡住不动\"的根因。" +
      '\n  处理方式（按顺序）：' +
      `\n    1. 换镜像后重试：cross-env ELECTRON_MIRROR=${DEFAULT_MIRROR} node scripts/ensure-electron.mjs` +
      '\n    2. 确认代理可用，或手动预置缓存到 %LOCALAPPDATA%\\electron\\Cache' +
      '\n    3. 仍不行则删包重装：rm -rf node_modules/electron && pnpm install',
  )
  process.exit(1)
}
if (r.status !== 0) {
  console.error(
    `\n[ensure-electron] install.js 失败（exit=${r.status}）。` +
      '\n  请执行 rm -rf node_modules/electron && pnpm install 后重试。',
  )
  process.exit(r.status ?? 1)
}

const after = inspect()
if (!after.ok) {
  console.error('\n[ensure-electron] install.js 执行完毕但产物仍不完整：')
  for (const p of after.problems) console.error(`  - ${p}`)
  console.error('  请执行 rm -rf node_modules/electron && pnpm install 彻底重装。')
  process.exit(1)
}
console.log(
  `[ensure-electron] 修复完成：${path.relative(ROOT, after.exeAbs)}，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
)
process.exit(0)
