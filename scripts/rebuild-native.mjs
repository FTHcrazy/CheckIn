/**
 * 重建原生依赖（better-sqlite3）以匹配当前 Electron 的 ABI。
 *
 * 背景：better-sqlite3 是原生模块，安装时默认下载的是系统 Node ABI 的预编译包，
 * 在 Electron 主进程里加载会报 NODE_MODULE_VERSION 不匹配
 * （例如 "compiled against NODE_MODULE_VERSION 127, requires 146"）。
 *
 * 策略：
 * 1. 优先用 prebuild-install 直接下载 Electron 对应 ABI 的预编译包（快，无需编译工具链）；
 * 2. 失败则回退到 @electron/rebuild 从源码编译（需要 MSVC 工具链）。
 *
 * 用法：pnpm electron:rebuild
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['better-sqlite3'];

function electronVersion() {
  const pkgPath = path.join(projectRoot, 'node_modules/electron/package.json');
  if (!existsSync(pkgPath)) {
    console.error('[rebuild-native] 未找到 node_modules/electron，请先 pnpm install');
    process.exit(1);
  }
  return process.env.ELECTRON_VERSION || JSON.parse(readFileSync(pkgPath, 'utf8')).version;
}

function tryPrebuilt(moduleDir, version) {
  try {
    execFileSync(
      process.execPath,
      [
        path.join(projectRoot, 'node_modules/prebuild-install/bin.js'),
        '-r', 'electron',
        '-t', version,
        '--verbose',
      ],
      { cwd: moduleDir, stdio: 'inherit' },
    );
    return true;
  } catch {
    return false;
  }
}

function trySourceBuild(projectRoot_, moduleDir, target, version) {
  try {
    execFileSync(
      process.execPath,
      [
        path.join(projectRoot_, 'node_modules/@electron/rebuild/lib/cli.js'),
        '-f', '-w', target, '-v', version,
      ],
      { cwd: projectRoot_, stdio: 'inherit' },
    );
    return true;
  } catch (err) {
    console.error(`[rebuild-native] ${target}: 源码编译失败：`, err.message);
    return false;
  }
}

function main() {
  const version = electronVersion();
  console.log(`[rebuild-native] 目标 Electron 版本: ${version}`);

  let failed = false;
  for (const target of TARGETS) {
    const moduleDir = path.join(projectRoot, 'node_modules', target);
    if (!existsSync(moduleDir)) {
      console.warn(`[rebuild-native] 跳过 ${target}（未安装）`);
      continue;
    }
    console.log(`[rebuild-native] ${target}: 尝试下载 electron 预编译包...`);
    if (tryPrebuilt(moduleDir, version)) {
      console.log(`[rebuild-native] ${target}: 预编译包安装成功`);
      continue;
    }
    console.warn(`[rebuild-native] ${target}: 无可用预编译包，回退到源码编译（需要 MSVC 工具链）...`);
    if (trySourceBuild(projectRoot, moduleDir, target, version)) {
      console.log(`[rebuild-native] ${target}: 源码编译成功`);
    } else {
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log('[rebuild-native] 完成');
}

main();
