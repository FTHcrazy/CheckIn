/**
 * 快捷键体系的跨进程一致性守卫（1.47.0）
 *
 * 主进程刻意**不** import 渲染层的注册表模块（怕把 DOM 依赖带进主进程构建），
 * 于是「允许设为应用级的动作」在两处各有一份清单。这份测试把两边钉在一起：
 * 任何一边新增 / 删除条目而另一边没跟上，立刻红灯。
 *
 * 全部为源码断言（不 import electron / better-sqlite3，jsdom 下可跑）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

/** 读源码并按 LF 归一（仓库里部分文件是 CRLF，跨行断言必须先归一） */
function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

describe("快捷键：主进程与渲染层的应用级清单一致", () => {
  const handlerSource = read("electron/handlers/shortcut-handlers.ts");
  const registrySource = read("src/shared/shortcuts/registry.ts");

  it("GLOBAL_ACTIONS 与 registry 的 globalEligible 条目一一对应", () => {
    const handlerIds = [...handlerSource.matchAll(/\{ id: "([^"]+)", defaultKeys:/g)].map(
      (match) => match[1],
    );
    expect(handlerIds).toEqual(["showNovelWindow"]);

    // 按对象块切分再判断：直接用「id 后 400 字内有 globalEligible」会跨到下一条
    const registryGlobalIds = registrySource
      .split(/\n {2}\{\n/)
      .slice(1)
      .filter((block) => block.includes("globalEligible: true"))
      .map((block) => /id: "([^"]+)"/.exec(block)?.[1])
      .filter((id): id is string => Boolean(id));
    expect(registryGlobalIds).toEqual(handlerIds);
  });

  it("主进程只注销自己注册的 accelerator，绝不 unregisterAll 误伤开发快捷键", () => {
    expect(handlerSource).not.toContain("globalShortcut.unregisterAll");
    expect(handlerSource).toContain("globalShortcut.unregister(accelerator)");
  });

  it("注册失败要回传（组合键被系统占用时 UI 才能提示）", () => {
    expect(handlerSource).toContain("globalFailures");
    expect(handlerSource).toContain("globalShortcut.register(");
  });

  it("持久化键名固定为 novel_shortcuts（改动等于丢掉用户配置）", () => {
    expect(handlerSource).toContain('const CONFIG_KEY = "novel_shortcuts"');
  });
});

describe("快捷键：只在 dev 与 novel 版开放", () => {
  it("主进程的应用级注册与设置窗口的展示用同一套判定", () => {
    const handlerSource = read("electron/handlers/shortcut-handlers.ts");
    expect(handlerSource).toContain('const SHORTCUTS_ENABLED = IS_DEV || EDITION === "novel"');

    const appSource = read("src/windows/SettingsWindow/App.tsx");
    expect(appSource).toContain(
      "const SHOW_SHORTCUTS = import.meta.env.DEV || IS_NOVEL_EDITION",
    );
    expect(appSource).toContain("SHOW_SHORTCUTS ? <ShortcutSection /> : null");
  });
});

describe("快捷键：IPC 链路完整", () => {
  const preload = read("electron/preload.ts");
  const handlerSource = read("electron/handlers/shortcut-handlers.ts");
  const mainSource = read("electron/main.ts");

  it("preload 暴露 shortcut.get / set，通道名与主进程一致", () => {
    expect(preload).toContain("shortcut: {");
    expect(preload).toContain("trackedInvoke('shortcut-config-get')");
    expect(preload).toContain("trackedInvoke('shortcut-config-set'");
    expect(handlerSource).toContain('ipcMain.handle("shortcut-config-get"');
    expect(handlerSource).toContain('ipcMain.handle(\n    "shortcut-config-set"');
  });

  it("main.ts 注册 handler 并注入「唤出小说窗口」动作", () => {
    expect(mainSource).toContain("registerShortcutHandlers({");
    expect(mainSource).toContain('if (id !== "showNovelWindow") return;');
  });

  it("改键后广播给其他窗口（否则设置窗口改了、编辑器不生效）", () => {
    expect(handlerSource).toContain('windowManager.broadcast("shortcut-changed", config)');
    expect(read("src/shared/shortcuts/store.ts")).toContain(
      'export const SHORTCUT_CHANGED_EVENT = "shortcut-changed"',
    );
  });
});

describe("快捷键：编辑器不再硬编码键位", () => {
  const hookSource = read(
    "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelShortcuts.ts",
  );

  it("useNovelShortcuts 走注册表匹配，不再出现写死的键名判断", () => {
    expect(hookSource).toContain("matchKeyEvent(event, spec)");
    expect(hookSource).toContain("useShortcutBindings()");
    expect(hookSource).not.toContain('event.key.toLowerCase() === "b"');
    expect(hookSource).not.toContain('event.key === "F11"');
  });

  it("保留 IME 与「下游已消费」两道放行（历史上都踩过）", () => {
    expect(hookSource).toContain("event.defaultPrevented || event.isComposing");
  });

  it("匹配顺序按具体度动态排序（Ctrl+Shift+S 必须先于 Ctrl+S）", () => {
    expect(hookSource).toContain("specificity(current[b.id] ?? b.defaultKeys)");
  });
});
