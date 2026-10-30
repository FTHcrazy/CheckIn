#!/usr/bin/env node
/**
 * app.asar 体积审计工具（不解包，只读 header）
 *
 * 为什么需要它：asar 只有几十毫秒就能读出完整目录树与每个文件的逻辑体积，
 * 而「为什么安装包 100 MB」这类问题靠翻日志永远算不清。留下这个脚本，
 * 每次改动打包配置后跑一次，把「谁把体积吃掉了」变成可核对的数据而不是猜测。
 *
 * 用法：
 *   node scripts/analyze-asar.mjs                       # 默认分析 release/win-unpacked/resources/app.asar
 *   node scripts/analyze-asar.mjs <path-to-asar>        # 指定 asar
 *   node scripts/analyze-asar.mjs --json                # 输出 JSON（便于前后对比）
 *   node scripts/analyze-asar.mjs <asar> --json
 *
 * 输出约定（最后一行）：ASAR_BYTES=<asar 文件在磁盘上的真实字节数>
 * 该行固定格式，便于脚本 grep 取数。
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getRawHeader } from '@electron/asar'

/** 默认 asar 路径（相对仓库根目录） */
const DEFAULT_ASAR = 'release/win-unpacked/resources/app.asar'

/** node_modules 下按包统计时，小于该阈值的包不单独打印（避免刷屏） */
const PACKAGE_PRINT_THRESHOLD = 200 * 1024

/** 顶层分区固定展示顺序（其余顶层条目追加在后面） */
const TOP_LEVEL_ORDER = ['node_modules', 'dist', 'dist-electron', 'package.json']

/**
 * 解析命令行参数。
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ asarPath: string, json: boolean }}
 */
function parseArgs(argv) {
  let json = false
  let asarPath = ''
  for (const arg of argv) {
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`未知参数: ${arg}`)
    }
    if (asarPath) {
      throw new Error(`只能指定一个 asar 路径（多余参数: ${arg}）`)
    }
    asarPath = arg
  }
  return { asarPath: asarPath || DEFAULT_ASAR, json }
}

/**
 * asar 目录树里的一项是否为文件节点。
 * - 文件：带 size
 * - 目录：带 files
 * - 符号链接：带 link（逻辑体积记 0）
 * @param {any} node
 * @returns {boolean}
 */
function isFileNode(node) {
  return Boolean(node) && typeof node.size === 'number'
}

/**
 * 递归累加一个目录节点的逻辑体积。
 * @param {any} node asar header 节点
 * @returns {{ size: number, files: number, unpackedSize: number }}
 */
function measure(node) {
  const acc = { size: 0, files: 0, unpackedSize: 0 }
  if (!node) {
    return acc
  }
  if (isFileNode(node)) {
    acc.size += node.size
    acc.files += 1
    if (node.unpacked) {
      acc.unpackedSize += node.size
    }
    return acc
  }
  const children = node.files ?? {}
  for (const key of Object.keys(children)) {
    const child = measure(children[key])
    acc.size += child.size
    acc.files += child.files
    acc.unpackedSize += child.unpackedSize
  }
  return acc
}

/**
 * 把 node_modules 的扁平原语按「包」归组。
 * `@scope/name` 记作一个包，其余一级目录各算一个包。
 * @param {Record<string, any>} nodeModulesFiles asar header 里 node_modules.files
 * @returns {{ name: string, size: number, files: number, unpackedSize: number }[]}
 */
function groupByPackage(nodeModulesFiles) {
  const packages = new Map()

  const addToPackage = (name, node) => {
    const measured = measure(node)
    const current = packages.get(name) ?? { name, size: 0, files: 0, unpackedSize: 0 }
    current.size += measured.size
    current.files += measured.files
    current.unpackedSize += measured.unpackedSize
    packages.set(name, current)
  }

  for (const entry of Object.keys(nodeModulesFiles)) {
    const node = nodeModulesFiles[entry]
    if (entry.startsWith('@') && node?.files) {
      // scope 目录：其下每个子目录是一个独立包
      for (const child of Object.keys(node.files)) {
        addToPackage(`${entry}/${child}`, node.files[child])
      }
      continue
    }
    addToPackage(entry, node)
  }

  return [...packages.values()].sort((a, b) => b.size - a.size)
}

/**
 * 人类可读体积（MiB / KiB 自动切换）。
 * @param {number} bytes
 * @returns {string}
 */
function human(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`
  }
  return `${bytes} B`
}

/**
 * 左对齐补齐 + 右对齐体积的表格行。
 * @param {string} label
 * @param {string} sizeText
 * @param {string} [extra]
 * @returns {string}
 */
function row(label, sizeText, extra = '') {
  return `  ${label.padEnd(38)} ${sizeText.padStart(11)}${extra ? `  ${extra}` : ''}`
}

/**
 * 主流程。
 * @returns {Promise<void>}
 */
async function main() {
  const { asarPath, json } = parseArgs(process.argv.slice(2))
  const resolved = path.resolve(process.cwd(), asarPath)

  let diskBytes = 0
  try {
    diskBytes = statSync(resolved).size
  } catch (error) {
    console.error(`[analyze-asar] 找不到 asar: ${resolved}`)
    console.error(`[analyze-asar] 先跑一次 electron-builder --dir 生成产物。`)
    process.exitCode = 1
    return
  }

  const { header } = getRawHeader(resolved)
  const rootFiles = header.files ?? {}

  // 顶层分区（node_modules / dist / dist-electron / package.json …）
  const topLevelNames = Object.keys(rootFiles)
  const ordered = [
    ...TOP_LEVEL_ORDER.filter((name) => topLevelNames.includes(name)),
    ...topLevelNames.filter((name) => !TOP_LEVEL_ORDER.includes(name)),
  ]
  const sections = ordered.map((name) => {
    const measured = measure(rootFiles[name])
    return { name, ...measured }
  })

  const total = sections.reduce(
    (acc, section) => {
      acc.size += section.size
      acc.files += section.files
      acc.unpackedSize += section.unpackedSize
      return acc
    },
    { size: 0, files: 0, unpackedSize: 0 },
  )

  // node_modules 按包排序
  const nodeModulesNode = rootFiles.node_modules
  const packages = nodeModulesNode?.files
    ? groupByPackage(nodeModulesNode.files)
    : []
  const packageCount = packages.length
  const printedPackages = packages.filter((pkg) => pkg.size >= PACKAGE_PRINT_THRESHOLD)

  if (json) {
    const payload = {
      asar: resolved,
      diskBytes,
      totalLogicalBytes: total.size,
      totalFiles: total.files,
      unpackedBytesInsideAsar: total.unpackedSize,
      sections,
      nodeModulesPackages: {
        count: packageCount,
        thresholdBytes: PACKAGE_PRINT_THRESHOLD,
        items: printedPackages,
      },
    }
    console.log(JSON.stringify(payload, null, 2))
    console.log(`ASAR_BYTES=${diskBytes}`)
    return
  }

  console.log(`[analyze-asar] ${resolved}`)
  console.log(`[analyze-asar] asar 磁盘字节: ${diskBytes} B（${human(diskBytes)}）`)
  console.log('')
  console.log('顶层分区（逻辑体积）：')
  for (const section of sections) {
    const extra =
      section.unpackedSize > 0 ? `其中外置 ${human(section.unpackedSize)}` : ''
    console.log(row(section.name, human(section.size), extra))
  }
  console.log('')
  console.log(
    `node_modules 按包排序（仅列 ≥ ${human(PACKAGE_PRINT_THRESHOLD)} 的包，共 ${packageCount} 个包）：`,
  )
  if (printedPackages.length === 0) {
    console.log('  （无超过阈值的包）')
  }
  for (const pkg of printedPackages) {
    const extra = pkg.unpackedSize > 0 ? `外置 ${human(pkg.unpackedSize)}` : ''
    console.log(row(pkg.name, human(pkg.size), extra))
  }
  console.log('')
  console.log('分区小计：')
  console.log(row('总逻辑体积', human(total.size), `${total.files} 个文件`))
  console.log(row('asar 磁盘字节', `${diskBytes} B`, human(diskBytes)))
  console.log(row('其中外置（asar.unpacked）', human(total.unpackedSize)))
  // 逻辑体积算法会重复计算 unpacked 文件里的部分（它们在 header 与磁盘各记一次）
  console.log('')
  console.log(`ASAR_BYTES=${diskBytes}`)
}

main().catch((error) => {
  console.error(`[analyze-asar] 分析失败: ${error?.stack || error}`)
  process.exitCode = 1
})
