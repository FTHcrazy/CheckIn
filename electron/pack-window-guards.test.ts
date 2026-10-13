/**
 * 行囊窗口 P2 守卫（源码断言）
 *
 * 第二批修复（审查报告 2026-10-12）的三个主进程不变量：
 * - P2-5 空 workId 不得播种角色行（渲染层守卫之外的最后一道闸）
 * - P2-5 空 workId 不得发起开窗请求
 * - P2-7 登出必须走 close() 让关闭守卫有机会询问，禁止 destroy()
 *
 * 为什么用源码断言：这些行为挂在 Electron 主进程上（BrowserWindow / ipcMain），
 * vitest（node 进程）跑不了真实窗口；better-sqlite3 的 native 按 Electron ABI
 * 编译，node 下 require 直接抛，真实建库也跑不了。同先例 `novel-db-split.test.ts`。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
const PACK_HANDLERS = readFileSync(
  path.resolve(process.cwd(), "electron/handlers/novel-pack-handlers.ts"),
  "utf8",
);

/** 截取某个函数体（从声明到下一个顶层标记），断言守卫写在函数内部而非别处 */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start, `源码里找不到 ${declaration}`).toBeGreaterThan(-1);
  return source.slice(start, start + 2000);
}

describe("P2-5 空 workId 守卫（守卫）", () => {
  it("ensurePackCharacterRow 对空 workId 直接拒绝，不播种 work_id='' 的行", () => {
    const body = functionBody(PACK_HANDLERS, "function ensurePackCharacterRow");
    expect(body).toMatch(/if \(!workId\) throw/);
  });

  it("pack-window-open 对空 workId 不建窗（双保险）", () => {
    const start = MAIN.indexOf('ipcMain.on("pack-window-open"');
    expect(start).toBeGreaterThan(-1);
    const body = MAIN.slice(start, MAIN.indexOf("createPackWindow();", start));
    expect(body).toMatch(/if \(!workId\) return/);
  });
});

describe("P2-7 登出不绕过关闭守卫（守卫）", () => {
  it("auth-logout 对行囊窗口走 close()，不得 destroy()", () => {
    const start = MAIN.indexOf('ipcMain.on("auth-logout"');
    expect(start).toBeGreaterThan(-1);
    const body = MAIN.slice(
      start,
      MAIN.indexOf("window-control", start) > -1
        ? MAIN.indexOf("window-control", start)
        : start + 1500,
    );
    expect(body).toContain('windowManager.get("pack")?.close()');
    expect(body, "destroy() 会绕过 close-guard，未保存编辑会被静默丢掉").not.toContain(
      'windowManager.get("pack")?.destroy()',
    );
  });
});
