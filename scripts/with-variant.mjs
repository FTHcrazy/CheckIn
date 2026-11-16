/**
 * with-variant.mjs —— 窗口变体参数的运行时解析入口
 *
 * 让构建 / 开发指令**不必写死**变体子指令（如 `dev:debug:nomap`），
 * 而是在控制台手动追加 `--nomap` 这类后缀参数，由本脚本统一剥离：
 *
 *     pnpm dev:debug --nomap
 *     pnpm electron:build:novel --nomap
 *
 * npm / pnpm 会把追加的参数放到**整条 script 命令的末尾**，而 `concurrently` /
 * `cross-env` / `&&` 链条让参数无法自然落到中间的 `vite` 上。所以本脚本：
 *   1. 从 argv 里剥离已知的变体旗标（`--nomap` 等），映射为环境变量
 *      `CHECKIN_WINDOW_VARIANT`；
 *   2. 把剩余内容交还 shell 原样执行（变量注入对整个命令链生效，vite 读得到）。
 *
 * 可扩展性：变体后缀的唯一事实源仍是 `electron/edition.ts` 的 `WINDOW_VARIANTS`
 * 与 `WINDOW_VARIANT_ENTRY_EXCLUSIONS`；本文件里的 `VARIANT_FLAGS` 只是
 * 「旗标 → 取值」的等价映射，新增后缀时两处各加一行即可。
 *
 * 执行约定（由 package.json 决定，两种形态都支持）：
 *   - 多参数形态（dev）：`with-variant.mjs concurrently -k "vite" "wait-on …"`
 *     → 各参数按需补引号、join 成一条 shell 命令执行；
 *   - 单参数形态（build）：`with-variant.mjs "tsc -b && … vite build && …"`
 *     → 单一参数即完整命令串，原样交给 shell（保留顶层 `&&`）。
 */
import { spawn } from 'node:child_process';

/** 变体旗标 → CHECKIN_WINDOW_VARIANT 取值（与 electron/edition.ts 的 WINDOW_VARIANTS 同步） */
const VARIANT_FLAGS = {
  '--nomap': 'nomap',
};

const argv = process.argv.slice(2);
let variant = '';
const rest = [];
for (const a of argv) {
  if (Object.prototype.hasOwnProperty.call(VARIANT_FLAGS, a)) {
    variant = VARIANT_FLAGS[a];
  } else {
    rest.push(a);
  }
}

const env = { ...process.env };
if (variant) {
  env.CHECKIN_WINDOW_VARIANT = variant;
  console.log(`[variant] 检测到 --${variant}：本次构建/开发将剔除对应功能窗口`);
}

// 单参数 = 完整命令串（含顶层 && 等），原样执行；
// 多参数 = 命令 + 参数，含空格的单个参数补引号后 join（等价于终端原样输入）。
const cmdStr =
  rest.length === 1
    ? rest[0]
    : rest
        .map((p) => (/\s/.test(p) && !/^["']/.test(p) ? JSON.stringify(p) : p))
        .join(' ');

if (!cmdStr) {
  console.error('[variant] 没有可执行的命令（用法：with-variant.mjs <command> [--nomap]）');
  process.exit(1);
}

const child = spawn(cmdStr, { shell: true, stdio: 'inherit', env });

child.on('error', (err) => {
  console.error(`[variant] 执行失败：${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    // 被信号终止（如 SIGINT/SIGTERM）：原样向上抛出，保持 Ctrl+C 语义
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
