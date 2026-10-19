/**
 * electron-builder afterPack 钩子
 * 在打包后清理不需要的文件，减小安装包体积
 *
 * 2.0.0 起 locale 裁减已由 `build.electronLanguages: ["zh-CN","en-US"]` 前置到
 * 打包阶段完成，本钩子的 locale 清理退化为兜底（配置被改回默认时仍能收口）。
 * 每一次删除都打印文件名 + 体积，结尾汇总节省量与剩余 locale 数，便于核对。
 *
 * ⚠️ 不得删除的条目（写在这里防止下次「顺手清理」）：
 * - `LICENSE.electron.txt`（Electron 的 MIT 许可证，1,096 B，与
 *   `node_modules/electron/dist/LICENSE` 逐字节一致）：electron-builder 打包时会把
 *   `electron/dist/LICENSE` 写成 `appOutDir/LICENSE.electron.txt`。删除即违反 MIT
 *   「随分发附带版权声明」的要求，故已从删除清单移除，**禁止再加回去**。
 * - `dxil.dll`（1.44 MB）：与已被删除的 `dxcompiler.dll` 配套。本次未升级
 *   Electron，无法实机验证 GPU 回退路径，1.44 MB 收益不值得引入白屏风险；
 *   待 Electron 44 实机回归后再评估是否一并删除。
 */
const fs = require('fs')
const path = require('path')

// 保留的 locale 文件（zh-CN / en-US 之外的一律删除）
const KEEP_LOCALES = new Set(['zh-CN.pak', 'en-US.pak'])

// 要删除的大文件（对桌面应用无用）。缺失时只记 debug，不抛错。
const DELETE_FILES = [
  'LICENSES.chromium.html',        // 19 MB
  'version',
  'dxcompiler.dll',                // 24 MB - DirectX shader compiler (普通UI应用不需要)
  'vk_swiftshader.dll',            // 5 MB - Vulkan software renderer
  'vk_swiftshader_icd.json',
  'vulkan-1.dll',                  // Vulkan loader
  'd3dcompiler_47.dll',            // 4.5 MB - D3D shader compiler (Chromium 自带备用)
]

/**
 * 统一的日志出口：info 打印到 stdout，debug 只在 CHECKIN_AFTERPACK_DEBUG=1 时输出。
 * 缺失文件属于正常情况（Electron 版本间文件名会变），只记 debug。
 * @param {'info'|'debug'} level
 * @param {string} message
 */
function log(level, message) {
  if (level === 'info') {
    console.log(`[afterPack] ${message}`)
    return
  }
  if (process.env.CHECKIN_AFTERPACK_DEBUG === '1') {
    console.log(`[afterPack][debug] ${message}`)
  }
}

/**
 * 删除单个文件并累加节省量。
 * @param {string} filePath 绝对路径
 * @param {string} displayName 日志里展示的名字
 * @param {{ bytes: number }} acc 累加器（可变）
 * @returns {boolean} 是否真的删除了
 */
function removeFile(filePath, displayName, acc) {
  if (!fs.existsSync(filePath)) {
    log('debug', `跳过（不存在）: ${displayName}`)
    return false
  }
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    log('debug', `跳过（不是文件）: ${displayName}`)
    return false
  }
  fs.unlinkSync(filePath)
  acc.bytes += stat.size
  log('info', `删除: ${displayName} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`)
  return true
}

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
async function afterPack(context) {
  const appOutDir = context.appOutDir
  console.log(`[afterPack] 清理目录: ${appOutDir}`)

  const acc = { bytes: 0 }

  // 1. 清理 locale 文件（兜底：正常应由 electronLanguages 前置裁掉）
  const localesDir = path.join(appOutDir, 'locales')
  let remainingLocales = 0
  if (fs.existsSync(localesDir)) {
    const files = fs.readdirSync(localesDir)
    for (const file of files) {
      if (KEEP_LOCALES.has(file)) {
        continue
      }
      const filePath = path.join(localesDir, file)
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) {
        continue
      }
      acc.bytes += stat.size
      fs.unlinkSync(filePath)
      log('debug', `删除 locale: ${file} (${(stat.size / 1024).toFixed(1)} KB)`)
    }
    remainingLocales = fs.readdirSync(localesDir).length
    const removedLocales = files.length - remainingLocales
    log(
      'info',
      removedLocales > 0
        ? `清理了 ${removedLocales} 个 locale 文件（兜底生效，检查 electronLanguages 配置）`
        : 'locale 已由 electronLanguages 前置裁减，无需兜底清理',
    )
  } else {
    log('debug', '未找到 locales 目录（已由 electronLanguages 裁掉或本版本无 locales）')
  }

  // 2. 删除不需要的大文件
  for (const file of DELETE_FILES) {
    removeFile(path.join(appOutDir, file), file, acc)
  }

  log(
    'info',
    `本次 afterPack 共节省: ${(acc.bytes / 1024 / 1024).toFixed(2)} MB / 剩余 locales 数量: ${remainingLocales}`,
  )

  // 3. 写入 exe 图标（唯一图标来源）。
  //    signAndEditExecutable 必须保持 false：开启会走 winCodeSign 工具链，
  //    非管理员环境因无法创建符号链接而构建失败（"客户端没有所需的特权"）。
  //    因此由本钩子用项目自带 rcedit 把 public/icon.ico 写入 exe —— exe 图标
  //    就是桌面快捷方式和任务栏图标的来源。失败直接抛错，绝不静默跳过。
  const exePath = path.join(appOutDir, 'CheckIn.exe')
  const icoPath = path.join(context.packager.projectDir, 'public', 'icon.ico')
  if (process.platform === 'win32' && fs.existsSync(exePath) && fs.existsSync(icoPath)) {
    try {
      // rcedit v5 是纯 ESM 包，且只有具名导出 rcedit
      const { rcedit } = await import('rcedit')
      await rcedit(exePath, { icon: icoPath })
      console.log('[afterPack] 已写入多尺寸 exe 图标')
    } catch (err) {
      // 图标写入失败会导致安装后仍是 Electron 默认图标
      throw new Error(`[afterPack] exe 图标写入失败: ${err.stack || err.message}`)
    }
  }
}

module.exports = afterPack
