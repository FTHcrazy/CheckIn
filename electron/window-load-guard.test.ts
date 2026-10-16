/**
 * 窗口装载守卫（源码断言，1.45.1）
 *
 * 钉住的是 1.45.0「全局设定中心窗口打不开」暴露出来的**同类隐患**：
 * 功能窗口一律 `show: false`，只在 `did-finish-load` 里 `show()` ——
 * 装载一旦失败（产物缺失 → `app://` 读盘 ENOENT、运行中的主进程是旧代码等），
 * `did-finish-load` 不会触发，窗口永远不出现且主进程零日志，用户只看到「点了没反应」。
 *
 * 这类失效没法用单测跑真实 BrowserWindow（vitest 是 node 进程，跑不了 Electron），
 * 所以照 `pack-window-guards.test.ts` / `novel-db-split.test.ts` 的先例做源码守卫：
 * 新增窗口若漏接 `attachWindowLoadGuard`（或又退回「只在 did-finish-load 里 show」），
 * 这里必须红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

/**
 * 截取一个**顶层**函数体（到下一个顶层的 `function` / 区块注释 / `app.` 为止）。
 * 函数内部的语句都有缩进，故「行首即 `function `」只可能是下一个顶层声明。
 */
function topLevelBody(declaration: string): string {
  const start = MAIN.indexOf(declaration);
  expect(start, `源码里找不到 ${declaration}`).toBeGreaterThan(-1);
  const tail = MAIN.slice(start + 1);
  const endMatch = tail.match(/\n(?=function |\/\/ ── |app\.)/);
  return endMatch?.index === undefined ? tail : tail.slice(0, endMatch.index);
}

describe("装载失败必须可见 + 必有窗口（守卫）", () => {
  it("attachWindowLoadGuard 覆盖三条失败链路与超时兜底显示", () => {
    const body = topLevelBody("function attachWindowLoadGuard(");
    // 可观测：主框架装载失败（打印 errorCode / errorDescription / validatedURL）
    expect(body).toContain('"did-fail-load"');
    expect(body).toContain("errorCode");
    expect(body).toContain("errorDescription");
    expect(body).toContain("validatedURL");
    expect(body).toContain("isMainFrame");
    // 可观测：渲染进程崩溃
    expect(body).toContain('"render-process-gone"');
    // 正常路径 + 兜底：did-finish-load 之外还必须有超时 show。
    // ⚠️ 这里**不能**只写 `toContain("setTimeout")`（QA 复核出的假阳性）：
    // 该词在清定时器等处也会出现，而「超时回调里其实什么都没做」照样过 ——
    // 等于这条兜底链路名义上有守卫、实际没人守。钉住完整链路：
    expect(body).toContain('"did-finish-load"');
    expect(body).toMatch(
      /timer = setTimeout\(\(\) => \{[\s\S]*?reveal\("装载超时兜底"\)/,
    );
    expect(body).toContain("}, timeoutMs);");
    // 定时器必须在「已显示」与「窗口已关闭」两条路径上都被清掉（否则幽灵 reveal）
    expect(body).toMatch(
      /if \(timer\) \{\s*clearTimeout\(timer\);[\s\S]*?timer = undefined;/,
    );
    expect(body).toMatch(/win\.once\("closed",[\s\S]*?clearTimeout\(timer\)/);
    // 缺省显示动作 = revealWindow（show + focus），由它统一做 isDestroyed 守卫
    expect(body).toContain("revealWindow(win, label, reason)");
    // 装载失败也要把窗口显示出来（错误页好过什么都不出现）
    expect(body).toContain('reveal("主框架装载失败")');

    const show = topLevelBody("function revealWindow(");
    expect(show).toContain("isDestroyed()");
    expect(show).toContain("win.show()");
    expect(show).toContain("win.focus()");
  });

  /**
   * `did-fail-load` 会在**导航被主动取代**时报 -3（ERR_ABORTED）：重定向、
   * 被新的 `loadURL` 顶掉、装载途中窗口被关闭…… 这些都不是「装载失败」。
   * 不过滤的话，dev 下正常的热重载就会打印一行「装载失败」并把错误页顶到用户
   * 面前 —— 与这条守卫要治的「静默」正好相反，是**误报噪音**。
   */
  it("did-fail-load 过滤 ERR_ABORTED(-3)，且过滤发生在日志与 reveal 之前", () => {
    const body = topLevelBody("function attachWindowLoadGuard(");
    const start = body.indexOf('"did-fail-load"');
    expect(start).toBeGreaterThan(-1);
    const failBody = body.slice(start, body.indexOf('"render-process-gone"'));
    expect(failBody).toContain("errorCode === -3");
    // 先过滤、再打日志、最后才 reveal
    expect(failBody.indexOf("errorCode === -3")).toBeLessThan(
      failBody.indexOf("console.error"),
    );
    expect(failBody.indexOf("errorCode === -3")).toBeLessThan(
      failBody.indexOf('reveal("主框架装载失败")'),
    );
  });

  /**
   * 每一个 `show: false` 的功能窗口都必须接入守卫。
   * 新增窗口时若只写「did-finish-load → show」就会漏在这里。
   */
  const WINDOWS: Array<[string, string]> = [
    ["createBaseWindow", '"Base"'],
    ["createNovelWindow", '"Novel"'],
    ["createSettingsWindow", '"Settings"'],
    ["createPackWindow", '"Pack"'],
    ["createGlobalSettingWindow", '"GlobalSetting"'],
    ["createLoginWindow", '"Login"'],
  ];

  for (const [fn, label] of WINDOWS) {
    it(`${fn} 以 ${label} 为标签接入 attachWindowLoadGuard`, () => {
      const body = topLevelBody(`function ${fn}(`);
      expect(body).toContain("show: false");
      expect(body).toContain("attachWindowLoadGuard");
      expect(body).toContain(label);
    });
  }

  it("主窗口形态的守卫传自定义 reveal（显示由登录闸门决定，不得无条件 show）", () => {
    // Base：装载完成 / 失败 / 超时都标记就绪，避免「登录后没有任何窗口可显示」
    const base = topLevelBody("function createBaseWindow(");
    expect(base).toMatch(/attachWindowLoadGuard\(win, "Base", \{/);
    expect(base).toContain("isPrimaryReady = true");
    expect(base).toContain("showPrimaryWindow()");

    // Novel：只有 novel 版主窗才走闸门，full 版的子窗照常自动显示
    const novel = topLevelBody("function createNovelWindow(");
    expect(novel).toContain("if (IS_NOVEL_PRIMARY) {");
    expect(novel).toMatch(/attachWindowLoadGuard\(novelWin, "Novel", \{/);
  });

  it("global-setting-window-open 有可分辨的到达日志（点击是否到主进程的第一分界线）", () => {
    const start = MAIN.indexOf('ipcMain.on("global-setting-window-open"');
    expect(start).toBeGreaterThan(-1);
    const body = MAIN.slice(start, start + 800);
    expect(body).toContain("收到 global-setting-window-open");
    expect(body).toMatch(/if \(EDITION === "lite"\)/);
    expect(body).toContain("createGlobalSettingWindow()");
  });

  it("行囊上下文仍在 did-finish-load 时下发，且在显示之前（先发上下文，再 reveal）", () => {
    const body = topLevelBody("function createPackWindow(");
    const sendAt = body.indexOf('"pack-window-context"');
    const guardAt = body.indexOf("attachWindowLoadGuard");
    expect(sendAt).toBeGreaterThan(-1);
    // 先注册「发上下文」，再接入守卫（守卫内部的 did-finish-load → show 后注册）：
    // 同一事件的监听按注册顺序执行，这样窗口出现时上下文已经发出，不闪空态
    expect(sendAt).toBeLessThan(guardAt);
  });
});
