/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 跨窗口订阅注销的回归测试。
 *
 * 真实缺陷：`windowAPI.on` 注册的是包了一层的 wrapper ——
 *   ipcRenderer.on(event, (_event, ...args) => handler(...args))
 * 而 `off` 用的是 `ipcRenderer.removeListener(event, handler)`。
 * removeListener 按**引用**比对，传进去的原始 handler 永远匹配不到那个匿名 wrapper，
 * 于是监听器连同它捕获的整条闭包链一直存活：每开关一次行囊面板泄漏两个监听，
 * 开合 N 次后一次主角 / 境界变更就会触发 N 次全表重载（越用越卡）。
 *
 * preload 依赖 electron，vitest 下无法 require，所以把「必须按 wrapper 注销」
 * 这条不变量钉在源码上。
 */
const PRELOAD = readFileSync(
  path.resolve(process.cwd(), "electron/preload.ts"),
  "utf8",
);

function windowApiBody(): string {
  const start = PRELOAD.indexOf("windowAPI: {");
  expect(start).toBeGreaterThan(-1);
  return PRELOAD.slice(start, start + 1600);
}

describe("windowAPI 监听注销", () => {
  it("维护 handler → wrapper 映射，且用 WeakMap（不制造新泄漏）", () => {
    expect(PRELOAD).toContain("const listenerWrappers = new WeakMap<");
  });

  it("on 注册前把 wrapper 记进映射表", () => {
    const body = windowApiBody();
    const onIdx = body.indexOf("on: (event: string, handler");
    const rememberIdx = body.indexOf("byChannel.set(event, wrapper)", onIdx);
    const registerIdx = body.indexOf("ipcRenderer.on(event, wrapper)", onIdx);
    expect(rememberIdx).toBeGreaterThan(-1);
    expect(registerIdx).toBeGreaterThan(-1);
    // 必须先记住再注册，否则并发时序下可能漏登记
    expect(rememberIdx).toBeLessThan(registerIdx);
  });

  it("off 删的是映射表里那个 wrapper，而不是原始 handler", () => {
    const body = windowApiBody();
    const offIdx = body.indexOf("off: (event: string, handler");
    expect(offIdx).toBeGreaterThan(-1);
    const offBody = body.slice(offIdx);
    expect(offBody).toContain("listenerWrappers.get(handler)");
    expect(offBody).toContain("ipcRenderer.removeListener(event, wrapper)");
    // 直接对原始 handler 调 removeListener 是无效操作（引用不匹配）
    expect(offBody.indexOf("ipcRenderer.removeListener(event, wrapper)")).toBeLessThan(
      offBody.indexOf("ipcRenderer.removeListener(event, handler)"),
    );
  });

  it("同一 handler 重复注册同一频道不会叠加两条监听", () => {
    const body = windowApiBody();
    expect(body).toContain("if (previous) ipcRenderer.removeListener(event, previous)");
  });
});
