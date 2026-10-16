/**
 * dev 主进程热重启脚本的源码守卫（1.45.1）
 *
 * `scripts/start-electron.js` 不是 Electron 主进程的一部分，它是 `pnpm dev` 下跑在
 * node 里的编排脚本。vitest 能加载它，但**跑不起来**：真要走到重启那条路必须
 * spawn electron.exe，而本环境无法初始化 Electron GUI（同 `window-load-guard.test.ts`）。
 * 所以照本仓「源码路径断言型守卫」的先例，钉住那条**只有真按 Ctrl+C 才复现、
 * 事后完全无痕**的关机竞态。
 *
 * 竞态回放：
 * 1. 产物变更 → 防抖定时器触发 → `restartPending = true` → `child.kill('SIGTERM')`
 * 2. close 事件还没到，用户按了 Ctrl+C → `shutdown()`
 * 3. close 事件到达：重启分支若只看 `restartPending`，就会**在用户已经要求退出之后
 *    又把 Electron 拉起来** —— 终端表现为「Ctrl+C 之后窗口又冒出来」，还得再杀一次。
 *
 * ⚠️ 本文件放在 `electron/` 下只是因为 vitest 的 include 覆盖 `src/**` 与 `electron/**`
 * 两棵目录，别误以为它测的是主进程代码。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = readFileSync(
  path.resolve(process.cwd(), "scripts/start-electron.js"),
  "utf8",
).replace(/\r\n/g, "\n");

/** 截取一个顶层函数的体（到下一个顶层 `function` 或 `process.on(` 为止） */
function bodyOf(declaration: string): string {
  const start = SCRIPT.indexOf(declaration);
  expect(start, `脚本里找不到 ${declaration}`).toBeGreaterThan(-1);
  const tail = SCRIPT.slice(start + 1);
  const end = tail.search(/\n(?=function |process\.on\()/);
  return end < 0 ? tail : tail.slice(0, end);
}

describe("dev 热重启脚本：关机竞态（源码守卫）", () => {
  it("子进程 close 时的重启分支必须排除「正在关机」", () => {
    const body = bodyOf("function onChildClose(");
    expect(body).toMatch(/if \(restartPending && !shuttingDown\)/);
  });

  it("shutdown() 复位 restartPending（否则 close 回调仍会把 Electron 拉起来）", () => {
    const body = bodyOf("function shutdown(");
    expect(body).toContain("shuttingDown = true");
    expect(body).toContain("restartPending = false");
    // 已排定的防抖定时器同样要作废
    expect(body).toContain("clearTimeout(restartTimer)");
  });

  it("只对主进程 / preload 产物触发重启（.js 才管，.map 忽略）", () => {
    const watch = bodyOf("function watchArtifacts(");
    expect(watch).toContain("fileName.endsWith('.js')");
    expect(watch).toContain("fs.watch(ARTIFACT_DIR");

    const schedule = bodyOf("function scheduleRestart(");
    // 关机中不再排定；同一轮构建的多次写盘合并成一次重启
    expect(schedule).toContain("if (shuttingDown) return");
    expect(schedule).toContain("RESTART_DEBOUNCE_MS");
  });
});
