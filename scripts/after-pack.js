/**
 * electron-builder afterPack 钩子
 * 在打包后清理不需要的文件，减小安装包体积
 */
const fs = require('fs')
const path = require('path')

// 保留的 locale 文件
const KEEP_LOCALES = new Set(['zh-CN.pak', 'en-US.pak'])

// 要删除的大文件（对桌面应用无用）
const DELETE_FILES = [
  'LICENSES.chromium.html',        // 19 MB
  'LICENSE.electron.txt',
  'version',
  'dxcompiler.dll',                // 24 MB - DirectX shader compiler (普通UI应用不需要)
  'vk_swiftshader.dll',            // 5 MB - Vulkan software renderer
  'vk_swiftshader_icd.json',
  'vulkan-1.dll',                  // Vulkan loader
  'd3dcompiler_47.dll',            // 4.5 MB - D3D shader compiler (Chromium 自带备用)
]

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
async function afterPack(context) {
  const appOutDir = context.appOutDir
  console.log(`[afterPack] 清理目录: ${appOutDir}`)

  let savedBytes = 0

  // 1. 清理 locale 文件
  const localesDir = path.join(appOutDir, 'locales')
  if (fs.existsSync(localesDir)) {
    const files = fs.readdirSync(localesDir)
    for (const file of files) {
      if (!KEEP_LOCALES.has(file)) {
        const filePath = path.join(localesDir, file)
        const stat = fs.statSync(filePath)
        savedBytes += stat.size
        fs.unlinkSync(filePath)
      }
    }
    console.log(`[afterPack] 清理了 ${files.length - KEEP_LOCALES.size} 个 locale 文件`)
  }

  // 2. 删除不需要的大文件
  for (const file of DELETE_FILES) {
    const filePath = path.join(appOutDir, file)
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath)
      savedBytes += stat.size
      fs.unlinkSync(filePath)
      console.log(`[afterPack] 删除: ${file} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
    }
  }

  console.log(`[afterPack] 共节省: ${(savedBytes / 1024 / 1024).toFixed(1)} MB`)

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

