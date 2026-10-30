/**
 * 快捷键配置 IPC handlers（1.47.0）
 *
 * 主进程在这里承担两件事：
 * 1. **持久化**：配置存 userDb 的 `config` 表（键 `novel_shortcuts`），跨重启稳定；
 * 2. **应用级快捷键**：把用户勾选了「应用外也生效」的绑定注册成 `globalShortcut`。
 *
 * ⚠️ 只注册**唤起窗口**类动作（`GLOBAL_ACTIONS`）。把 Ctrl+S 这类编辑键注册成
 * 系统级会把整个操作系统的保存快捷键劫持掉，属于设计事故 —— 注册表里的
 * `globalEligible` 已经限定了范围，这里再兜一道。
 *
 * ⚠️ 展示门控与 SettingsWindow 一致：只有 dev 与 novel 版才注册全局键
 * （用户明确要求快捷键管理只在这两种构建里出现）。full 正式版里这些键仍然
 * 是应用内快捷键，只是不抢占系统。
 */
import { globalShortcut, ipcMain } from "electron";
import { dbGet, dbRun } from "../db";
import { log } from "../logger";
import { windowManager } from "../windowManager";
import { resolveEditionFromEnv } from "../edition";
import { parseShortcut, toAccelerator } from "../../src/shared/shortcuts/keys-core";

const CONFIG_KEY = "novel_shortcuts";
const EDITION = resolveEditionFromEnv();
const IS_DEV = Boolean(process.env["VITE_DEV_SERVER_URL"]);
/** 与 SettingsWindow 的展示门控保持一致 */
const SHORTCUTS_ENABLED = IS_DEV || EDITION === "novel";

/**
 * 允许注册成应用级快捷键的动作白名单。
 *
 * 与 `src/shared/shortcuts/registry.ts` 里 `globalEligible: true` 的条目必须一致，
 * 由 `shortcut-guard.test.ts` 做源码断言守卫（两边刻意不共享代码：主进程不该
 * 依赖渲染层的注册表模块）。
 */
const GLOBAL_ACTIONS: ReadonlyArray<{ id: string; defaultKeys: string }> = [
  { id: "showNovelWindow", defaultKeys: "Alt+W" },
];

interface ShortcutConfigShape {
  bindings: Record<string, string>;
  globals: string[];
}

/** 已注册的 accelerator（用于增量重注册时精确注销，不能 unregisterAll 误伤 F12） */
const registered = new Set<string>();

let actionHandler: ((id: string) => void) | null = null;

function readConfig(): ShortcutConfigShape {
  const fallback: ShortcutConfigShape = {
    bindings: Object.fromEntries(
      GLOBAL_ACTIONS.map((item) => [item.id, item.defaultKeys]),
    ),
    globals: GLOBAL_ACTIONS.map((item) => item.id),
  };
  try {
    const row = dbGet("SELECT value FROM config WHERE key = ?", [CONFIG_KEY]) as
      | { value?: string }
      | undefined;
    if (!row?.value) return fallback;
    const parsed = JSON.parse(row.value) as Partial<ShortcutConfigShape>;
    return {
      bindings:
        parsed.bindings && typeof parsed.bindings === "object"
          ? { ...fallback.bindings, ...parsed.bindings }
          : fallback.bindings,
      globals: Array.isArray(parsed.globals)
        ? parsed.globals.filter((id): id is string => typeof id === "string")
        : fallback.globals,
    };
  } catch {
    return fallback;
  }
}

function writeConfig(config: ShortcutConfigShape): void {
  try {
    dbRun("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [
      CONFIG_KEY,
      JSON.stringify(config),
    ]);
  } catch (error) {
    log("error", "main", "shortcut", "快捷键配置落库失败", {
      error: String(error),
    });
  }
}

/**
 * 重新注册全部应用级快捷键，返回注册失败的 id 列表。
 * 失败通常是「组合键已被系统或其他应用占用」，要回传给 UI 让用户换一个。
 */
function applyGlobalShortcuts(config: ShortcutConfigShape): string[] {
  for (const accelerator of registered) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      // 注销失败不阻断后续注册
    }
  }
  registered.clear();

  if (!SHORTCUTS_ENABLED) return [];

  const failures: string[] = [];
  for (const action of GLOBAL_ACTIONS) {
    if (!config.globals.includes(action.id)) continue;
    const keys = config.bindings[action.id] ?? action.defaultKeys;
    const accelerator = toAccelerator(keys);
    if (!accelerator || !parseShortcut(keys)) {
      failures.push(action.id);
      continue;
    }
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, () => {
        log("info", "main", "shortcut", `应用级快捷键触发：${action.id}`);
        actionHandler?.(action.id);
      });
    } catch (error) {
      log("warn", "main", "shortcut", "注册应用级快捷键异常", {
        id: action.id,
        accelerator,
        error: String(error),
      });
    }
    if (ok) {
      registered.add(accelerator);
    } else {
      failures.push(action.id);
      log("warn", "main", "shortcut", "应用级快捷键注册失败（可能被占用）", {
        id: action.id,
        accelerator,
      });
    }
  }
  return failures;
}

/** 广播配置变更：其他窗口（含设置窗口自己以外的所有窗口）立即生效 */
function broadcastConfig(config: ShortcutConfigShape): void {
  windowManager.broadcast("shortcut-changed", config);
}

export interface RegisterShortcutHandlersOptions {
  /** 应用级快捷键触发时的动作（由 main.ts 注入，避免 handler 反向依赖窗口创建） */
  onGlobalAction: (id: string) => void;
}

export function registerShortcutHandlers(
  options: RegisterShortcutHandlersOptions,
): void {
  actionHandler = options.onGlobalAction;

  // 启动即按已存配置注册（此时窗口还没创建，但 globalShortcut 不依赖窗口）
  const initial = readConfig();
  const initialFailures = applyGlobalShortcuts(initial);
  log("info", "main", "shortcut", "快捷键配置已加载", {
    enabled: SHORTCUTS_ENABLED,
    globals: initial.globals,
    failures: initialFailures,
  });

  ipcMain.handle("shortcut-config-get", () => readConfig());

  ipcMain.handle(
    "shortcut-config-set",
    (_event, patch: Partial<ShortcutConfigShape> | undefined) => {
      const current = readConfig();
      const next: ShortcutConfigShape = {
        bindings:
          patch?.bindings && typeof patch.bindings === "object"
            ? { ...current.bindings, ...patch.bindings }
            : current.bindings,
        globals: Array.isArray(patch?.globals) ? patch.globals : current.globals,
      };
      writeConfig(next);
      const globalFailures = applyGlobalShortcuts(next);
      broadcastConfig(next);
      return { config: next, globalFailures };
    },
  );
}
