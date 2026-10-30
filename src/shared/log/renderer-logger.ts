/**
 * 渲染层日志（1.47.0）
 *
 * 职责分两层：
 * 1. **主动记录**：`rendererLog.info(module, message, meta)`，经 IPC 交给主进程
 *    落盘。渲染进程没有文件系统权限，也不能自己决定目录 —— 窗口名由主进程
 *    用 `webContents` 反查，避免渲染层自报的名字与 `windowManager` 注册名漂移。
 * 2. **兜底捕获**：`installRendererLogger(windowName)` 在每个窗口入口装一次
 *    `error` / `unhandledrejection`。此前渲染层的未捕获错误 / 未处理拒绝
 *    **完全静默**（只在 DevTools 里），打包后等于没有线索。
 *
 * ⚠️ 所有上报失败都必须静默：日志系统不能反过来把业务搞崩（`electronAPI`
 * 在单元测试 / 早期引导阶段可能还不存在）。
 */
export type RendererLogLevel = "debug" | "info" | "warn" | "error";

interface LogBridge {
  write: (entry: {
    level: RendererLogLevel;
    module: string;
    message: string;
    meta?: unknown;
  }) => Promise<boolean>;
}

/** 取日志桥；不可用时返回 null（jsdom / 引导早期） */
function bridge(): LogBridge | null {
  const api = (window as { electronAPI?: { log?: LogBridge } }).electronAPI;
  return api?.log ?? null;
}

let installedFor: string | null = null;

/** 单条上报（不 await：日志不该阻塞调用方，失败也不抛出） */
export function writeRendererLog(
  level: RendererLogLevel,
  moduleName: string,
  message: string,
  meta?: unknown,
): void {
  const log = bridge();
  if (!log) return;
  try {
    void log.write({ level, module: moduleName, message, meta }).catch(() => undefined);
  } catch {
    // 桥本身异常（contextBridge 已销毁等）时忽略
  }
}

export const rendererLog = {
  debug: (moduleName: string, message: string, meta?: unknown) =>
    writeRendererLog("debug", moduleName, message, meta),
  info: (moduleName: string, message: string, meta?: unknown) =>
    writeRendererLog("info", moduleName, message, meta),
  warn: (moduleName: string, message: string, meta?: unknown) =>
    writeRendererLog("warn", moduleName, message, meta),
  error: (moduleName: string, message: string, meta?: unknown) =>
    writeRendererLog("error", moduleName, message, meta),
};

/** 把「不知道是什么」的东西转成可读文本（Error / 对象 / 字符串都吃） */
function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stackOf(value: unknown): string | undefined {
  if (value instanceof Error) return value.stack;
  if (value && typeof value === "object" && "stack" in value) {
    const stack = (value as { stack?: unknown }).stack;
    return typeof stack === "string" ? stack : undefined;
  }
  return undefined;
}

/**
 * 给一个窗口装全局错误捕获（每个窗口入口调用一次，重复调用无副作用）。
 *
 * @param windowName 仅用于启动日志的自我标识；落盘目录仍由主进程决定
 */
export function installRendererLogger(windowName: string): void {
  if (installedFor === windowName) return;
  installedFor = windowName;

  window.addEventListener("error", (event) => {
    // 资源加载失败（img / script）也会触发 error，但 target 不是 window，
    // 这类不属"代码错误"，且已由窗口装载守卫覆盖，避免噪音直接跳过。
    const target = event.target;
    if (target && target !== window) return;
    writeRendererLog(
      "error",
      "window",
      `未捕获错误：${event.message || describe(event.error)}`,
      {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: stackOf(event.error),
      },
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    writeRendererLog(
      "error",
      "window",
      `未处理的 Promise 拒绝：${describe(event.reason)}`,
      { stack: stackOf(event.reason) },
    );
  });

  writeRendererLog("info", "app", "渲染层启动", {
    window: windowName,
    href: window.location.href,
  });
}
