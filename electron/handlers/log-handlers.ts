/**
 * 日志 IPC handlers
 *
 * 渲染进程没有文件系统权限，所有日志经这里落盘。窗口名**不由渲染层传**
 * （渲染层自报的名字可以撒谎、也可能与注册名不一致），统一用
 * `BrowserWindow.fromWebContents(event.sender)` + `windowManager.getNameOf()`
 * 反查，保证目录名与 `windowManager` 的注册名一一对应。
 */
import { BrowserWindow, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import path from "node:path";
import { dbGet, dbRun } from "../db";
import {
  closeLogger,
  getLogRoot,
  getLogSettings,
  log,
  logIpc,
  resetLogRoot,
  setLogSettings,
  type LogLevel,
  type LogSettings,
} from "../logger";
import { windowManager } from "../windowManager";

const SETTINGS_KEY = "log_settings";

const VALID_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** 从 IPC 事件反查窗口注册名；未注册（或窗口已销毁）时回退到 webContents id */
export function resolveWindowName(sender: WebContents): string {
  const win = BrowserWindow.fromWebContents(sender);
  const name = win ? windowManager.getNameOf(win) : undefined;
  return name ?? `renderer-${sender.id}`;
}

function readSettings(): LogSettings {
  try {
    const row = dbGet("SELECT value FROM config WHERE key = ?", [
      SETTINGS_KEY,
    ]) as { value?: string } | undefined;
    if (!row?.value) return getLogSettings();
    const parsed = JSON.parse(row.value) as Partial<LogSettings>;
    return setLogSettings(parsed);
  } catch {
    return getLogSettings();
  }
}

/**
 * 用户库就绪后加载持久化配置（main.ts 在 `switchUserDb` 之后调用）。
 * 未登录 / 库未打开时静默回落默认值，不阻塞启动。
 */
export function loadLogSettings(): LogSettings {
  return readSettings();
}

function writeSettings(patch: Partial<LogSettings>): LogSettings {
  const next = setLogSettings(patch);
  try {
    dbRun(
      "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
      [SETTINGS_KEY, JSON.stringify(next)],
    );
  } catch (error) {
    log("error", "main", "logger", "日志配置落库失败", { error: String(error) });
  }
  return next;
}

export function registerLogHandlers(): void {
  // ⚠️ 这里**不读配置**：注册发生在 `switchUserDb` 之前，此时用户库还没打开，
  // 读 config 表只会拿到异常。配置由 main.ts 在切库之后调 `loadLogSettings()`。

  ipcMain.handle("log-write", (event: IpcMainInvokeEvent, entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const { level, module, message, meta } = entry as {
      level?: LogLevel;
      module?: string;
      message?: string;
      meta?: unknown;
    };
    if (!level || !VALID_LEVELS.includes(level)) return false;
    if (typeof message !== "string" || !message) return false;
    log(
      level,
      resolveWindowName(event.sender),
      typeof module === "string" && module ? module : "renderer",
      message,
      meta,
    );
    return true;
  });

  /**
   * IPC 通信 / 慢调用记录（fire-and-forget，渲染层不等待）。
   * 只由 preload 在「失败」「慢于阈值」时上报，避免全量通信把日志刷爆。
   */
  ipcMain.on(
    "log-ipc",
    (event, payload: { channel?: string; ok?: boolean; durationMs?: number; detail?: unknown }) => {
      if (!payload || typeof payload.channel !== "string") return;
      logIpc({
        window: resolveWindowName(event.sender),
        channel: payload.channel,
        direction: payload.ok === false ? "error" : "invoke",
        ok: payload.ok,
        durationMs: payload.durationMs,
        detail: payload.detail,
      });
    },
  );

  ipcMain.handle("log-config-get", () => getLogSettings());

  ipcMain.handle("log-config-set", (_event, patch: Partial<LogSettings>) =>
    writeSettings(patch ?? {}),
  );

  /** 打开日志根目录（排查入口，主进程 shell 打开系统文件管理器） */
  ipcMain.handle("log-open-dir", async (_event, windowName?: string) => {
    const root = getLogRoot();
    const target =
      typeof windowName === "string" && windowName
        ? path.join(root, windowName.replace(/[^a-zA-Z0-9._-]/g, "_"))
        : root;
    try {
      await shell.openPath(target);
      return true;
    } catch (error) {
      log("warn", "main", "logger", "打开日志目录失败", {
        target,
        error: String(error),
      });
      return false;
    }
  });

  /** 身份切换后重算目录（登录 / 改邮箱 / 登出都调一次，幂等） */
  ipcMain.handle("log-switch-user", (_event, reason: string) => {
    resetLogRoot(typeof reason === "string" ? reason : "ipc");
    return getLogRoot();
  });

  /** 退出前 flush（渲染层可在 beforeunload 调用） */
  ipcMain.handle("log-close", () => {
    closeLogger();
    return true;
  });
}
