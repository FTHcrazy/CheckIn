/**
 * dev-doctor.mjs —— pnpm dev 卡死诊断工具
 *
 * 只做只读诊断，不修改任何文件、不安装依赖：
 *   1. 体检 node_modules 关键产物（electron 二进制 / better-sqlite3 原生模块 / 工具链）
 *   2. 单独拉起 vite，记录它是否真的在 5173 提供服务
 *   3. 单独跑 wait-on tcp:5173，记录它能否判定服务就绪
 *
 * 用法：pnpm dev:doctor [--no-vite]
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NM = path.join(ROOT, 'node_modules')
const t0 = Date.now()
const log = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${m}`)
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p))

function tcpProbe(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    let done = false
    const end = (r) => {
      if (done) return
      done = true
      sock.destroy()
      resolve(r)
    }
    sock.setTimeout(timeout)
    sock.once('connect', () => end('OPEN'))
    sock.once('timeout', () => end('TIMEOUT'))
    sock.once('error', (e) => end('ERR:' + e.code))
    sock.connect(port, host)
  })
}

function httpProbe(port, timeout = 3000) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      res.resume()
      resolve('HTTP ' + res.statusCode)
    })
    req.on('error', (e) => resolve('ERR:' + e.code))
    req.setTimeout(timeout, () => {
      req.destroy()
      resolve('TIMEOUT')
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 1. 环境体检 ----------
log('=== 1/4 环境体检 ===')
const critical = [
  ['electron/dist/electron.exe', 'electron 运行时二进制', 'pnpm ensure:electron'],
  ['electron/path.txt', 'electron 二进制路径标记', 'pnpm ensure:electron'],
  // 下面两项是「exe 还在但 Chromium 必炸」的部件：解压被打断时 path.txt 往往已经写好，
  // install.js 据此认定已安装、不再自愈 —— 只能靠这里点破
  ['electron/dist/locales', 'dist/locales(ICU语言包)', 'pnpm ensure:electron'],
  ['electron/dist/resources/default_app.asar', 'dist/resources/default_app.asar', 'pnpm ensure:electron'],
  ['better-sqlite3/build/Release/better_sqlite3.node', 'better-sqlite3 原生模块', 'pnpm electron:rebuild'],
  ['vite/package.json', 'vite', 'pnpm install'],
  ['wait-on/package.json', 'wait-on', 'pnpm install'],
  ['concurrently/package.json', 'concurrently', 'pnpm install'],
]
let broken = false
for (const [rel, label, fix] of critical) {
  const ok = exists('node_modules', ...rel.split('/'))
  if (!ok) broken = true
  log(`${ok ? '[OK]  ' : '[缺失]'} ${label.padEnd(28)} -> node_modules/${rel}${ok ? '' : `   修复: ${fix}`}`)
}

// electron require 是否会炸
const requireProbe = spawnSync(
  process.execPath,
  ['-e', "try{console.log(require('electron'))}catch(e){console.log('THROW: '+e.message)}"],
  { cwd: ROOT, encoding: 'utf8', timeout: 10000 },
)
{
  const out = (requireProbe.stdout || '').trim() || (requireProbe.stderr || '').trim()
  log(`electron require -> ${out || '(超时/被杀 —— 说明 electron 内部 IO 卡死)'}`)
}

// 端口占用
const occupied = await tcpProbe('127.0.0.1', 5173, 1200)
log(`端口 5173 当前状态 -> ${occupied}${occupied === 'OPEN' ? '（被占用！可能是上次 dev 残留的进程）' : ''}`)
if (occupied === 'OPEN') {
  log('   !!! 端口已被占用，vite 配置了 strictPort，会因 EADDRINUSE 直接退出；')
  log('   !!! concurrently -k 会把整条命令一起带走，终端看起来像"卡住后闪退"。')
}

if (process.argv.includes('--no-vite')) {
  log('\n（--no-vite：跳过 vite 实测）')
  process.exit(broken ? 1 : 0)
}

// ---------- 2. 单独拉起 vite ----------
log('\n=== 2/4 单独拉起 vite ===')
const viteBin = path.join(NM, 'vite', 'bin', 'vite.js')
if (!fs.existsSync(viteBin)) {
  log('vite 入口不存在，跳过')
  process.exit(1)
}
const vite = spawn(process.execPath, [viteBin], { cwd: ROOT, env: { ...process.env, CI: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
const drain = (tag, s) => s.toString().trim().split(/\r?\n/).forEach((l) => l && log(`[${tag}] ${l}`))
vite.stdout.on('data', (d) => drain('vite', d))
vite.stderr.on('data', (d) => drain('vite:err', d))
vite.on('exit', (c, s) => log(`vite 进程退出 code=${c} signal=${s}`))

let ready = false
for (const wait of [3000, 5000, 7000, 10000, 15000, 20000]) {
  await sleep(wait)
  if (vite.exitCode !== null) break
  const tcp = await tcpProbe('127.0.0.1', 5173)
  const httpR = await tcpProbe('::1', 5173, 1200)
  log(`探测: 127.0.0.1:5173=${tcp}  ::1:5173=${httpR}`)
  if (tcp === 'OPEN') {
    const status = await httpProbe(5173)
    log(`HTTP GET http://127.0.0.1:5173/ -> ${status}`)
    ready = true
    break
  }
}

if (vite.exitCode !== null) {
  log('vite 已退出 —— 这是 dev "起不来"的直接原因，不是 wait-on 的问题。')
} else if (!ready) {
  log('vite 进程活着但 5173 迟迟不开放 —— 卡在 electron 主进程编译或依赖预构建上。')
}

// ---------- 3. 单独跑 wait-on ----------
if (ready) {
  log('\n=== 3/4 单独跑 wait-on tcp:5173 ===')
  const wo = spawn('node', [path.join(NM, 'wait-on', 'bin', 'wait-on'), 'tcp:5173', '--timeout', '20000'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })
  wo.stdout.on('data', (d) => drain('wait-on', d))
  wo.stderr.on('data', (d) => drain('wait-on:err', d))
  const code = await new Promise((r) => wo.on('exit', r))
  log(`wait-on 退出码 = ${code}${code === 0 ? '（能正常判定就绪）' : '（判定失败 —— 这就是永久卡住的点）'}`)
}

// ---------- 4. Electron GUI 冒烟测试 ----------
// 这一步专门回答「pnpm dev 里那行 exited with code 1 到底为什么」。
// Windows 上 electron.exe 是 GUI 子系统程序、不挂控制台，连崩溃栈都看不到；
// 于是用一个「只要能起来就写一个标记文件」的最小 app 做判据，
// 把「本项目代码有问题」和「环境压根不让 Electron 起」彻底分开。
log('\n=== 4/4 Electron GUI 冒烟测试 ===')
const smoke = await runGuiSmoke()
console.log(smoke.text)

try { vite.kill('SIGTERM') } catch {}
await sleep(1500)
try { vite.kill('SIGKILL') } catch {}
log('\n诊断结束。')
process.exit(broken || !smoke.ok ? 1 : 0)

async function runGuiSmoke() {
  const rel = (() => {
    try { return fs.readFileSync(path.join(NM, 'electron', 'path.txt'), 'utf8').trim() } catch { return null }
  })()
  if (!rel) {
    return { ok: false, text: '[FAIL] 缺少 path.txt，先跑 pnpm ensure:electron' }
  }
  const exe = path.join(NM, 'electron', 'dist', rel)
  if (!fs.existsSync(exe)) {
    return { ok: false, text: '[FAIL] 缺少 dist 二进制，先跑 pnpm ensure:electron' }
  }

  const tmp = path.join(ROOT, '.doctor-smoke-app')
  const marker = path.join(tmp, 'marker.txt')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'doctor-smoke', version: '1.0.0', main: 'main.js' }),
  )
  fs.writeFileSync(
    path.join(tmp, 'main.js'),
    `require("fs").writeFileSync(${JSON.stringify(marker)}, "OK " + process.type + " electron=" + process.versions.electron + "\\n");\n` +
      `const { app } = require("electron");\napp.whenReady().then(() => app.quit());\n`,
  )

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE

  const t = Date.now()
  const proc = spawn(exe, [tmp], { cwd: ROOT, env, stdio: 'ignore' })
  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => { try { proc.kill() } catch {} resolve('timeout') }, 20000)
    proc.on('exit', (c) => { clearTimeout(timer); resolve(c) })
  })
  const booted = fs.existsSync(marker)
  // 先读内容再清临时目录 —— 顺序反了会在删完后读空
  const detail = booted ? fs.readFileSync(marker, 'utf8').trim() : ''
  fs.rmSync(tmp, { recursive: true, force: true })

  if (booted) {
    return { ok: true, text: `[PASS] Electron GUI 进程可正常启动并加载 app -> ${detail}` }
  }

  return {
    ok: false,
    text:
      `[FAIL] Electron 无法在本环境启动（exit=${exitCode}，${Date.now() - t}ms，主进程未执行）\n` +
      '       这不是项目代码的问题 —— 上面这个最小 app 只有两行代码，同样秒退。\n' +
      '       Windows 上 electron.exe 是 GUI 子系统程序，不挂控制台，所以连报错都看不到。\n' +
      '       按概率排查：\n' +
      '         1. 当前终端由 Electron 宿主（WorkBuddy / VS Code 等）派生，其 Job Object\n' +
      '            带 UI 限制导致 Chromium 无法初始化\n' +
      '            → 换系统自带终端：Win+R → cmd → cd 项目目录 → pnpm dev\n' +
      '         2. 安全软件 / Defender 静默拦截了 electron.exe\n' +
      '         3. rm -rf node_modules/electron && pnpm install 重新拉取运行时',
  }
}
