import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  Tray,
  Menu,
  globalShortcut,
} from "electron";
import type { WebContents } from "electron";
import path from "path";
import fs from "fs";
import { initDb, closeDb, switchUserDb } from "./db";
import {
  askCloseGuards,
  attachCloseGuard,
  hasArmedCloseGuard,
  registerCloseGuardHandlers,
  standDownCloseGuards,
} from "./close-guard";
import { startActivityPolling, stopActivityPolling } from "./activitiesTask";
import { resolveAppProtocolCacheControl } from "./app-protocol-cache";
import { windowManager } from "./windowManager";
import {
  pushPendingMessage,
  takePendingMessages,
  type PendingWindowMessage,
} from "./window-pending";
import { readWindowSendOptions, type WindowSendOptions } from "./window-send-options";
import { registerActivityHandlers } from "./handlers/activity-handlers";
import { registerTodoHandlers } from "./handlers/todo-handlers";
import {
  markNovelSessionClosed,
  registerNovelHandlers,
} from "./handlers/novel-handlers";
import { registerNovelPackHandlers } from "./handlers/novel-pack-handlers";
import { registerNovelSettingHandlers } from "./handlers/novel-setting-handlers";
import { registerNovelGlobalSettingHandlers } from "./handlers/novel-global-setting-handlers";
import { registerNovelGraphHandlers } from "./handlers/novel-graph-handlers";
import { registerNovelExportHandlers } from "./handlers/novel-export-handlers";
import { registerNovelDbBridge } from "./novel-db";
import {
  getCachedUser,
  logoutUser,
  registerUserHandlers,
} from "./handlers/user-handlers";
import { registerShortcutHandlers } from "./handlers/shortcut-handlers";
import { registerMemoHandlers } from "./handlers/memo-handlers";
import { registerLedgerHandlers } from "./handlers/ledger-handlers";
import { registerCheckinHandlers } from "./handlers/checkin-handlers";
import { registerHttpSessionHandlers, setupRendererHttpSession } from "./httpSession";
import {
  registerLogHandlers,
  loadLogSettings,
} from "./handlers/log-handlers";
import {
  bootstrapLogger,
  closeLogger,
  log,
  resetLogRoot,
  windowLogger,
} from "./logger";
import {
  PRIMARY_WINDOW_ENTRY,
  RENDERER_ENTRY_PATHS,
  type WindowEntryKey,
} from "./edition";

// ── 构建版本（edition） ──
// 编译期常量，由 vite.config.ts 按 CHECKIN_EDITION 环境变量注入三处 define。
// 清单（入口路径 / 各版本窗口 / 主窗口归属）的唯一事实源在 electron/edition.ts。
const EDITION = __CHECKIN_EDITION__;
/** 主窗口入口：full/lite → base，novel → novel */
const PRIMARY_ENTRY = PRIMARY_WINDOW_ENTRY[EDITION];
/** 主窗口在 windowManager 中的注册名（base 窗口沿用历史注册名 "main"） */
const PRIMARY_WINDOW_NAME = PRIMARY_ENTRY === "base" ? "main" : "novel";
/** novel 版：小说窗口即主窗口（登录后唤起、close 进托盘） */
const IS_NOVEL_PRIMARY = PRIMARY_ENTRY === "novel";

// Windows 下通知必须设置 AppUserModelId
// 开发环境用 process.execPath（electron.exe 路径），生产环境用固定 ID
if (process.platform === "win32") {
  app.setAppUserModelId(
    process.env["VITE_DEV_SERVER_URL"] ? process.execPath : "com.checkin.app",
  );
}

// 只保留中英文 locale，减少内存占用
app.commandLine.appendSwitch("lang", "zh-CN,en-US");

// 关闭 Windows 的窗口管理器动画：透明窗口（transparent: true）在
// hide() → show() 切换时（如托盘点击恢复），Chromium 会重放窗口动画
// 导致可见的闪烁。这是 Electron/Chromium 的知名渲染问题，
// 禁用该动画后托盘恢复窗口不再闪白（必须在 app ready 之前设置）。
if (process.platform === "win32") {
  app.commandLine.appendSwitch("wm-window-animations-disabled");
}

// 处理打包后的路径
// __dirname 在 CJS 输出中可用 (vite-plugin-electron 默认输出 CJS)
const DIST_ELECTRON = __dirname;
const DIST = path.join(DIST_ELECTRON, "../dist");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const IS_DEV = Boolean(VITE_DEV_SERVER_URL);
const OPEN_DEVTOOLS = process.env["VITE_OPEN_DEVTOOLS"] === "1";
/** DevTools 打开方式：detach = 独立调试窗口，right/bottom/undocked = 停靠 */
const DEVTOOLS_MODE = (process.env["VITE_DEVTOOLS_MODE"] ?? "detach") as
  | "right"
  | "bottom"
  | "undocked"
  | "detach";

let tray: Tray | null = null;

/**
 * 进程级异常兜底（1.47.0 日志系统）。
 *
 * 取舍：**只记录、不主动退出**。Electron 默认对 `uncaughtException` 弹原生
 * 「A JavaScript error occurred」后退出 —— 建档期用户往往正停在编辑器里，
 * 一次 IPC 分支里的 `TypeError` 直接退掉会丢未保存正文。这里改为落盘 + 控制台，
 * 由渲染层的兜底与 `render-process-gone` 反映真实影响面。
 */
process.on("uncaughtException", (error) => {
  console.error("[main] 未捕获异常：", error);
  log("error", "main", "process", `未捕获异常：${error?.message ?? String(error)}`, {
    stack: error?.stack,
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("[main] 未处理的 Promise 拒绝：", reason);
  const message = reason instanceof Error ? reason.message : String(reason);
  log("error", "main", "process", `未处理的 Promise 拒绝：${message}`, {
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
const ICON_PATH = VITE_DEV_SERVER_URL
  ? path.join(DIST_ELECTRON, "../public/icon.ico")
  : path.join(DIST, "icon.ico");
// 托盘图标独立于应用图标：16px 下做了加粗简化，笔尖缝改为实心填色（详见 public/tray/）
const TRAY_ICON_PATH = VITE_DEV_SERVER_URL
  ? path.join(DIST_ELECTRON, "../public/tray/tray.png")
  : path.join(DIST, "tray/tray.png");

// 注册自定义协议用于加载本地文件 (必须在 app.whenReady 之前调用)
// codeCache：自定义 scheme 默认不写 V8 字节码缓存（Chromium 只对 http(s) 开启），
// 必须显式打开；但 Chromium 对「不够热」的脚本仍会跳过码缓存（启发式 heat check），
// 本应用窗口即关即销、antd chunk 每窗只跑一次 → 仅靠 codeCache 大概率空转。
// 因此渲染侧 createWebPreferences 同时设 v8CacheOptions:"bypassHeatCheck" 跳过热度
// 判断，两者配套才能让「编译一次」的成果跨渲染进程复用。
// 注：Cache-Control 的 immutable 能否让自定义协议响应进 Chromium 磁盘缓存、从而
// 跨窗口免主进程读盘，是未验证假设（自定义 scheme 可能不过 HttpCache），收益以实测为准。
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  },
]);

let isQuitting = false;
let canShowMainWindow = false;
let isPrimaryReady = false;
let hasStartedActivityPolling = false;
const LOGIN_WINDOW_MIN_DISPLAY_MS = 2000;
let loginWindowVisibleAt: number | null = null;
let loginWindowHasShown = false;

/**
 * 切换指定窗口的 DevTools。
 * 本地调试便捷入口：无需重启进程即可随时查看渲染层日志/性能面板。
 */
function toggleDevTools(win: BrowserWindow | null | undefined): void {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (wc.isDevToolsOpened()) {
    wc.closeDevTools();
    return;
  }
  wc.openDevTools({ mode: DEVTOOLS_MODE });
}

/** 为窗口注册 DevTools 快捷键（Ctrl+Shift+I / F12，与 Chrome 一致） */
function registerDevToolsShortcuts(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    const isToggleKey =
      input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i");
    if (!isToggleKey) return;

    event.preventDefault();
    toggleDevTools(win);
  });
}

// ── 圆角窗口公共配置 ──
// 各窗口统一为「无系统边框 + 透明底 + CSS 圆角」的实现方式：
// - frame: false 去掉系统方角边框
// - transparent: true 让圆角外的区域可以真正透明
// - backgroundColor 必须是全透明（#00000000），否则圆角外会残留方角底色
// - hasShadow: false 交给 CSS 画阴影，避免系统阴影沿方形边界绘制
// - roundedCorners 必须关掉：Windows 上它让 DWM 按【固定 8px】系统圆角裁剪窗口，
//   会把 CSS 画的 12px 圆角和描边的四角切掉，窗口四角只剩一段弧度很小、
//   接近直角的边缘 —— 表现为「圆角外还有一圈淡淡的直角底」。圆角全部交给 CSS。
const ROUNDED_WINDOW_OPTIONS = {
  frame: false,
  transparent: true,
  backgroundColor: "#00000000",
  hasShadow: false,
  roundedCorners: false,
} as const;

/** 统一的 webPreferences，各窗口保持一致的安全设置 */
function createWebPreferences() {
  return {
    preload: path.join(DIST_ELECTRON, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    // V8 字节码缓存（渲染侧）。app scheme 已在 registerSchemesAsPrivileged 开
    // codeCache:true，但 Chromium 默认只对「足够热」的脚本产码缓存（启发式
    // heat check）；本应用窗口即关即销、antd 等 chunk 每窗只执行一次，启发式
    // 大概率不满足 → codeCache 空转。bypassHeatCheck 跳过热度判断，让 app://
    // 脚本的码缓存（含 1.4MB antd chunk）真正跨渲染进程复用，与 scheme 侧配套才完整。
    v8CacheOptions: "bypassHeatCheck" as const,
  };
}

/**
 * 把窗口的 maximize / unmaximize 事件转发给渲染层，
 * 供 WindowHeader 切换最大化/还原图标并同步方角样式。
 * 所有使用 WindowHeader 的窗口都需要注册。
 */
function forwardMaximizeState(win: BrowserWindow): void {
  const send = () => {
    if (!win.isDestroyed()) {
      win.webContents.send("window-maximize-state", win.isMaximized());
    }
  };
  win.on("maximize", send);
  win.on("unmaximize", send);
}

/** 按入口 key 加载渲染层页面（dev 走 vite server，生产走 app:// 协议） */
function loadRendererEntry(win: BrowserWindow, entry: WindowEntryKey, query = ""): void {
  const relPath = RENDERER_ENTRY_PATHS[entry];
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}/${relPath}${query}`);
  } else {
    win.loadURL(`app://./${relPath}${query}`);
  }
}

/**
 * 装载兜底显示的时限（毫秒）：超过它窗口还没 `did-finish-load`，
 * 就先把窗口显示出来（错误页也好过什么都不出现）。
 */
const WINDOW_LOAD_FALLBACK_MS = 3000;

/**
 * 把窗口显示出来并**抬到最前**。
 *
 * 功能窗口一律 `transparent: true` + `frame: false`（圆角外壳）。这类窗口在
 * Windows 上「先 `show: false` 创建、随后再 show」时经常只拿到显示、拿不到前台
 * —— 表现是「点了行囊，窗口其实已经起来了，但被小说窗口压着看不见」，用户再点
 * 一次，第二次走 `createPackWindow` 的「已开」分支 `focus()` 才把它翻上来，
 * 于是就成了「要点两次才会弹出行囊窗口」。
 *
 * `moveTop()` 与焦点无关地抬 z 序（Windows/macOS 都支持），补上这一击：
 * `show()` 保证可见、`focus()` 争取焦点（可能被系统前台锁拒）、`moveTop()`
 * 保证在最上面 —— 三者缺一都有「窗口存在但看不见」的形态。
 */
function raiseWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.moveTop();
}

/** 显示窗口（已销毁时直接返回；已显示也会重新抬到最前，见 raiseWindow） */
function revealWindow(win: BrowserWindow, label: string, reason: string): void {
  if (win.isDestroyed()) return;
  raiseWindow(win);
  console.log(`[main] ${label} 窗口已显示（${reason}）`);
}

/**
 * 窗口装载「可观测化 + 兜底显示」。
 *
 * 为什么必须有：本文件的功能窗口一律 `show: false`，只在 `did-finish-load`
 * 里 `show()`。而装载失败时（产物缺失 / `app://` 读盘报错 / 渲染进程崩溃）
 * `did-finish-load` **永远不会触发** → 窗口永不显示、主进程一行日志都没有，
 * 用户侧只看到「点了没反应、窗口不出现」。这正是最难查的那种失效形态：
 * 静态链路（按钮 / 白名单 / ipcMain / 入口清单）全是通的，运行时却什么也不发生。
 *
 * 现在三条链路都可见：
 * - `did-fail-load`（仅主框架）：打印 errorCode / errorDescription / validatedURL，
 *   并兜底显示 —— 用户至少能看到一个错误页，而不是一片静默
 * - `render-process-gone`：打印 reason / exitCode
 * - 超时兜底：`did-finish-load` 迟迟不来（例如被协议层卡住）也把窗口显示出来
 *
 * @param options.timeoutMs 兜底时限，缺省 `WINDOW_LOAD_FALLBACK_MS`
 * @param options.reveal 显示动作；缺省 `show() + focus()`。主窗口形态必须传自己的
 *   显示闸门 —— 主窗口是否可见由登录流程（`canShowMainWindow`）决定，不能无条件 show
 */
function attachWindowLoadGuard(
  win: BrowserWindow,
  label: string,
  options: {
    timeoutMs?: number;
    reveal?: (reason: string) => void;
    /** 日志目录名（windowManager 的注册名）；缺省 main */
    windowName?: string;
  } = {},
): void {
  const { timeoutMs = WINDOW_LOAD_FALLBACK_MS, reveal: customReveal } = options;
  const winLog = windowLogger(options.windowName ?? "main");
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reveal = (reason: string): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (customReveal) {
      customReveal(reason);
    } else {
      revealWindow(win, label, reason);
    }
  };

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // 子资源（图片 / 字体 / 懒加载 chunk）失败不该把窗口顶出来，只处理主框架
      if (!isMainFrame) return;
      // -3 = ERR_ABORTED：导航被主动取代或取消（重定向、被新的 loadURL 顶掉、
      // 装载途中窗口被关闭）。它**不是**装载失败 —— 当成失败会打印一行「装载失败」
      // 并把错误页顶到用户面前，而 dev 下热重载窗口时这条路径会正常撞上，
      // 是本守卫最不想制造的误报噪音。
      if (errorCode === -3) return;
      console.error(
        `[main] ${label} 窗口装载失败：code=${errorCode} desc=${errorDescription} url=${validatedURL}`,
      );
      winLog.error("window", `${label} 窗口装载失败`, {
        code: errorCode,
        desc: errorDescription,
        url: validatedURL,
      });
      reveal("主框架装载失败");
    },
  );

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      `[main] ${label} 窗口渲染进程异常退出：reason=${details.reason} exitCode=${details.exitCode}`,
    );
    winLog.error("window", `${label} 窗口渲染进程异常退出`, {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  win.webContents.once("did-finish-load", () => reveal("did-finish-load"));

  timer = setTimeout(() => {
    console.warn(`[main] ${label} 窗口 ${timeoutMs}ms 内未完成装载，兜底显示`);
    winLog.warn("window", `${label} 窗口装载超时，已兜底显示`, { timeoutMs });
    reveal("装载超时兜底");
  }, timeoutMs);

  // 窗口已销毁就别再 show()（对已销毁窗口调用会抛）
  win.once("closed", () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  });
}

// ── BaseWindow（full/lite 版主窗口） ──

function createBaseWindow(): BrowserWindow {
  const t0 = Date.now();

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    icon: ICON_PATH,
    show: false,
    ...ROUNDED_WINDOW_OPTIONS,
    webPreferences: createWebPreferences(),
  });

  win.removeMenu();

  // 主窗口 close → 隐藏到托盘（退出走托盘菜单 / before-quit）
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    isPrimaryReady = false;
  });

  // 最大化状态变化时同步给渲染层，WindowHeader 据此切换最大化/还原图标
  forwardMaximizeState(win);

  // 主窗口的就绪判定收敛到一处：装载完成 / 装载失败 / 装载超时都算「就绪」——
  // 否则装载失败时 isPrimaryReady 永远为 false，showPrimaryWindow() 静默空转，
  // 用户登录后连错误页都看不到（整个应用像死了一样）。
  attachWindowLoadGuard(win, "Base", {
    windowName: "main",
    reveal: (reason) => {
      if (reason === "did-finish-load") {
        console.log(`[main] 页面加载完成: ${Date.now() - t0}ms`);
      } else {
        console.warn(`[main] Base 窗口未经 did-finish-load 就绪（${reason}），仍按就绪处理`);
      }
      isPrimaryReady = true;
      if (canShowMainWindow) {
        showPrimaryWindow();
      }
    },
  });

  if (IS_DEV) registerDevToolsShortcuts(win);

  // 注册到窗口管理池
  windowManager.register("main", win);

  loadRendererEntry(win, "base");

  return win;
}

// ── NovelWindow（小说窗口） ──

/**
 * NovelWindow —— CheckIn 小说窗口，形态随构建版本分叉（electron/edition.ts）：
 *
 * - novel 版：主窗口。启动时预创建（不显示），登录确认后唤起；
 *   close → 隐藏到托盘，与 full/lite 版主窗口行为一致。
 * - full 版：即关即销的子窗口。从主窗口侧边栏入口唤起，重新打开即全新实例
 *   —— 对编辑器反而是优点：无状态腐化，数据安全完全由持久化层兜底。
 *
 * 默认尺寸 1200×760（min 960×640）。
 *
 * ⚠️ 下限不是随手填的：书架页在 960 宽下「主列 640 + 灵感栏 320」才够摆下
 * 4 连统计卡与三列书卡；再窄（原 800×560）统计卡会被挤成两行、书卡只剩两列，
 * 顶栏五个控件也会挤成一串纯文字。640 高保证首屏能完整露出一排书卡。
 * 改这个下限前先看 `BookshelfPage/index.scss` 的窄窗媒体查询。
 * TODO(数据层里程碑)：bounds 记忆（尺寸/位置持久化）与 R12 全局快捷键 Alt+W 一起做
 */
function createNovelWindow(): BrowserWindow {
  const existing = windowManager.get("novel");
  if (existing) {
    // 已开：聚焦而不是重复创建（例如入口重复触发）
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }

  const novelWin = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    icon: ICON_PATH,
    show: false,
    ...ROUNDED_WINDOW_OPTIONS,
    titleBarStyle: "hidden",
    webPreferences: createWebPreferences(),
  });

  novelWin.removeMenu();

  if (IS_NOVEL_PRIMARY) {
    // 主窗形态：就绪标记 + 由登录流程 / 托盘驱动显示，不自动 show。
    // 装载失败 / 超时同样标记就绪，避免「登录后没有任何窗口可显示」
    attachWindowLoadGuard(novelWin, "Novel", {
      windowName: "novel",
      reveal: (reason) => {
        if (reason !== "did-finish-load") {
          console.warn(`[main] Novel 主窗口未经 did-finish-load 就绪（${reason}），仍按就绪处理`);
        }
        isPrimaryReady = true;
        if (canShowMainWindow) {
          showPrimaryWindow();
        }
      },
    });
  } else {
    // 子窗形态：装载完成即显示
    attachWindowLoadGuard(novelWin, "Novel", { windowName: "novel" });
  }

  if (IS_DEV) {
    registerDevToolsShortcuts(novelWin);
    if (OPEN_DEVTOOLS) novelWin.webContents.openDevTools({ mode: DEVTOOLS_MODE });
  }

  // 标题栏的最小化/最大化按钮需要最大化状态推送
  forwardMaximizeState(novelWin);

  // 注册到窗口管理池（自动处理 closed 事件清理）
  windowManager.register("novel", novelWin);

  if (IS_NOVEL_PRIMARY) {
    // 主窗形态：close → 隐藏到托盘；登出/退出时经 destroy() 真正销毁
    novelWin.on("close", (e) => {
      if (!isQuitting) {
        e.preventDefault();
        novelWin.hide();
      }
    });
    // 真销毁（退出应用）前先问一句：行囊里可能还有未保存的编辑。
    // 隐藏到托盘那一次不算 —— 窗口还活着，草稿安全，弹拦截反而打扰。
    attachCloseGuard(novelWin, () => isQuitting);
    novelWin.on("closed", () => {
      isPrimaryReady = false;
      // 编辑器会话结束：清除崩溃恢复标记（PRD R3 ③）
      markNovelSessionClosed();
    });
  } else {
    // 子窗形态：不拦截 close，正常关闭，窗口随实例销毁
    // 即关即销 → 有一次编辑就拦一次（关闭 = 渲染层连同草稿上下文一起消失）
    attachCloseGuard(novelWin);
    novelWin.on("closed", () => {
      console.log("[main] Novel 窗口已关闭");
      // 编辑器会话正常结束：清除崩溃恢复标记（PRD R3 ③）
      markNovelSessionClosed();
    });
  }

  loadRendererEntry(novelWin, "novel");

  return novelWin;
}

// ── SettingsWindow（全局设置，全版本开放入口） ──

/**
 * SettingsWindow —— 全局设置窗口（外观 / 账号 / 个人资料，后续扩展字体、快捷键等）。
 *
 * 即关即销、单实例唤起：设置项即时生效（主题经广播同步到各窗口，
 * 账号操作直接走 IPC），窗口本身不持有草稿状态。
 */
function createSettingsWindow(): BrowserWindow {
  const existing = windowManager.get("settings");
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }

  const settingsWin = new BrowserWindow({
    width: 560,
    height: 640,
    minWidth: 480,
    minHeight: 420,
    icon: ICON_PATH,
    show: false,
    ...ROUNDED_WINDOW_OPTIONS,
    titleBarStyle: "hidden",
    webPreferences: createWebPreferences(),
  });

  settingsWin.removeMenu();

  attachWindowLoadGuard(settingsWin, "Settings", { windowName: "settings" });

  if (IS_DEV) {
    registerDevToolsShortcuts(settingsWin);
    if (OPEN_DEVTOOLS) settingsWin.webContents.openDevTools({ mode: DEVTOOLS_MODE });
  }

  windowManager.register("settings", settingsWin);

  settingsWin.on("closed", () => {
    console.log("[main] Settings 窗口已关闭");
  });

  loadRendererEntry(settingsWin, "settings");

  return settingsWin;
}

// ── PackWindow（行囊独立窗口） ──

/**
 * 行囊窗口上下文：最近一次打开行囊时携带的作品 / 章节 / 代号。
 * 新窗口 did-finish-load 后经 `pack-window-context` 下发；
 * 后续切换由 NovelWindow 的 `novel-work-changed` 广播跟进。
 *
 * `nonce` 由 NovelWindow 生成（重置模板 = 同 workId 清库重播时 +1），
 * 原样转发：行囊宿主把它拼进 key，同 workId 也能重挂载重新装载。
 * 老负载没有这一格 →  undefined，行囊侧按 0 处理。
 */
let packWindowContext: {
  workId: string;
  chapterId: string;
  nonce?: number;
} | null = null;

/**
 * 回执「行囊窗口真的可见了」给发起方（顶栏那颗按钮据此退出 loading）。
 *
 * 只在窗口可见时发：首次创建要等整个 SPA 装载完成（dev 下 1–3s），提前发等于
 * 把「正在打开」提前收掉，作者又会以为没反应。
 */
function notifyPackShown(opener?: WebContents): void {
  if (!opener || opener.isDestroyed()) return;
  opener.send("pack-window-shown");
}

/**
 * 回执「全局设定中心窗口真的可见了」给发起方（书架那颗按钮据此退出 loading）。
 *
 * 与 `notifyPackShown` 同口径：只在窗口可见时发 —— 首次创建要等整个 SPA
 * 装载完成（dev 下 1–3s），提前发等于把「正在打开」提前收掉，作者又会以为
 * 没反应、再点一次（正是 REQ-054 在全局设定中心入口上的残留路径）。
 */
function notifyGlobalSettingShown(opener?: WebContents): void {
  if (!opener || opener.isDestroyed()) return;
  opener.send("global-setting-window-shown");
}

/**
 * PackWindow —— 行囊独立窗口（full / novel 版）。
 *
 * 即关即销、单实例唤起；数据全部经 novel-pack IPC（userDb 的 novel_* 表），
 * 窗口本身不持有需要迁移的状态 —— 草稿在主进程表里，跨窗口一致、崩溃不丢。
 * 有未保存改动时由 close-guard 拦截（渲染层武装，dirty>0 才拦）。
 *
 * @param opener 发起本次打开的渲染进程（顶栏「行囊」所属窗口）。窗口**真正可见**时
 *   会回一条 `pack-window-shown`，让那颗按钮从「正在打开」恢复常态 —— 首次创建要等
 *   整个 SPA 装载（dev 下 1–3s），没有这条回执，作者会觉得「点了没反应」而再点一次。
 */
function createPackWindow(opener?: WebContents): BrowserWindow {
  const existing = windowManager.get("pack");
  if (existing) {
    // 已开：补发一次上下文兜底（切书广播若在加载完成前发出会错过），再抬到最前
    if (packWindowContext) {
      windowManager.sendTo("pack", "pack-window-context", packWindowContext);
    }
    raiseWindow(existing);
    notifyPackShown(opener);
    return existing;
  }

  // 尺寸是「分区仪表盘」形态的：宽档默认 1080×872（顶部概览带 + 双栏九模块），
  // 下限保留 380×480 —— 低于 600 宽时面板降级为「核心三块常驻 + 其余折叠成标题行」，
  // 保证缩到最窄仍能边写边对记（见 CharacterPack 的三档响应式）。
  const packWin = new BrowserWindow({
    width: 1080,
    height: 872,
    minWidth: 380,
    minHeight: 480,
    icon: ICON_PATH,
    show: false,
    ...ROUNDED_WINDOW_OPTIONS,
    titleBarStyle: "hidden",
    webPreferences: createWebPreferences(),
  });

  packWin.removeMenu();

  // 上下文走待投递队列：装载完成那一拍 React 常还没订阅，直发会丢
  // （preload 在 load 后 drain，未订阅则暂存，监听注册时补投）
  if (packWindowContext) {
    pushPendingMessage("pack", { event: "pack-window-context", data: packWindowContext });
  }

  // 「真的可见」的回执：钉在 `show` 事件上而不是 reveal 里 —— 正常装载、
  // 装载失败兜底、超时兜底三条路径都会走 show，只有正常路径走 reveal
  packWin.once("show", () => notifyPackShown(opener));

  attachWindowLoadGuard(packWin, "Pack", { windowName: "pack" });

  if (IS_DEV) {
    registerDevToolsShortcuts(packWin);
    if (OPEN_DEVTOOLS) packWin.webContents.openDevTools({ mode: DEVTOOLS_MODE });
  }

  // 标题栏的最小化/最大化按钮需要最大化状态推送
  forwardMaximizeState(packWin);

  windowManager.register("pack", packWin);

  // 即关即销：有未保存改动时先问渲染层（草稿在主进程，但「保存并关闭」
  // 要在窗口活着时把内存文档写库）
  attachCloseGuard(packWin);
  packWin.on("closed", () => {
    console.log("[main] Pack 窗口已关闭");
  });

  loadRendererEntry(packWin, "pack");

  return packWin;
}

// ── GlobalSettingWindow（全局设定中心独立窗口） ──

/**
 * GlobalSettingWindow —— 全局设定中心独立窗口（full / novel 版）。
 *
 * 逐行对齐 `createPackWindow`：即关即销、单实例唤起（已开则 restore/show/focus）。
 * 数据全部经全局设定域 IPC（novel 库的 novel_global_setting_* 两表），窗口不持有
 * 需要迁移的状态 —— 写操作直接落库，无草稿。`attachCloseGuard` 照常挂上：本窗口
 * 无未保存改动，守卫在渲染层不武装即直接放行。
 *
 * lite 版不打包本窗口（novel 域整体缺席），`global-setting-window-open` 直接忽略。
 *
 * @param opener 发起本次打开的渲染进程（书架顶栏「全局设定中心」所属窗口）。
 *   窗口**真正可见**时回一条 `global-setting-window-shown`，让那颗按钮从
 *   「正在打开」恢复常态 —— 与 `createPackWindow` 的 REQ-054 修法对齐。
 */
function createGlobalSettingWindow(opener?: WebContents): BrowserWindow {
  const existing = windowManager.get("globalSetting");
  if (existing) {
    // 已开：抬到最前而不是重复创建（同一类「透明无边框窗口 show 后不到前台」，
    // 见 raiseWindow 的注释），并回执让按钮退出「正在打开」态
    raiseWindow(existing);
    notifyGlobalSettingShown(opener);
    return existing;
  }

  const globalWin = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 920,
    minHeight: 600,
    icon: ICON_PATH,
    show: false,
    ...ROUNDED_WINDOW_OPTIONS,
    titleBarStyle: "hidden",
    webPreferences: createWebPreferences(),
  });

  globalWin.removeMenu();

  // 「真的可见」的回执：钉在 `show` 事件上而不是 reveal 里 —— 正常装载、
  // 装载失败兜底、超时兜底三条路径都会走 show，只有正常路径走 reveal。
  // 与 `createPackWindow` 的 `packWin.once("show", ...)` 同一范式。
  globalWin.once("show", () => notifyGlobalSettingShown(opener));

  attachWindowLoadGuard(globalWin, "GlobalSetting", { windowName: "globalSetting" });

  if (IS_DEV) {
    registerDevToolsShortcuts(globalWin);
    if (OPEN_DEVTOOLS) globalWin.webContents.openDevTools({ mode: DEVTOOLS_MODE });
  }

  // 标题栏的最小化/最大化按钮需要最大化状态推送
  forwardMaximizeState(globalWin);

  windowManager.register("globalSetting", globalWin);

  // 即关即销：本窗口无草稿，守卫在渲染层不武装即放行（保持与行囊同范式）
  attachCloseGuard(globalWin);
  globalWin.on("closed", () => {
    console.log("[main] GlobalSetting 窗口已关闭");
  });

  loadRendererEntry(globalWin, "globalSetting");

  return globalWin;
}

// ── RelationWindow（人物关系网络独立窗口，R27） ──

/**
 * 关系图窗口上下文：最近一次打开时携带的作品 id。
 * 新窗口装载后经 `relation-window-context` 下发（走 `window-pending` 队列，
 * 见下方 `window-send-to`：窗口没起来时消息不会丢）；后续切换作品由
 * NovelWindow 的 `novel-work-changed` 广播跟进（与行囊同款）。
 */
let relationWindowContext: { workId: string } | null = null;

/**
 * RelationWindow —— 人物关系网络（可拖拽建模，全 / 小说版）。
 *
 * 与 GlobalSettingWindow 同范式：即关即销、单实例唤起。数据面读 `novel_*`
 * （要素 / 关联 / 设定），写回走 `novel-graph-commit` 单事务（新建关系 + 备注 +
 * 画布坐标，带 rev 乐观锁），**不要**改成 `novel-link-add`（无事务、无去重、无 rev）；
 * 窗口本身不持有需要跨会话迁移的状态（图状态落 `novel_config` 单键）。
 *
 * lite 版不打包本窗口，`relation-window-open` 直接忽略。
 */
function createRelationWindow(): BrowserWindow {
  const existing = windowManager.get("relation");
  if (existing) {
    if (relationWindowContext) {
      windowManager.sendTo("relation", "relation-window-context", relationWindowContext);
    }
    raiseWindow(existing);
    return existing;
  }

  const relationWin = new BrowserWindow({
    // 画布 + 左侧资料池 + 右侧详情卡：默认按 1320 宽给足横向空间
    width: 1320,
    height: 880,
    // 窄窗可到 720：三栏在 720px 下收窄（池子 / 详情卡 / 工具栏见各自 index.scss）
    minWidth: 720,
    minHeight: 600,
    icon: ICON_PATH,
    show: false,
    ...ROUNDED_WINDOW_OPTIONS,
    titleBarStyle: "hidden",
    webPreferences: createWebPreferences(),
  });

  relationWin.removeMenu();

  // 上下文走待投递队列（不是 did-finish-load 直发）：窗口刚装载时 React 还没订阅，
  // 直发会丢；preload 在 load 后 drain 一次，若监听仍未注册就先缓存，注册时补投。
  if (relationWindowContext) {
    pushPendingMessage("relation", {
      event: "relation-window-context",
      data: relationWindowContext,
    });
  }

  attachWindowLoadGuard(relationWin, "Relation", { windowName: "relation" });

  if (IS_DEV) {
    registerDevToolsShortcuts(relationWin);
    if (OPEN_DEVTOOLS) relationWin.webContents.openDevTools({ mode: DEVTOOLS_MODE });
  }

  forwardMaximizeState(relationWin);

  windowManager.register("relation", relationWin);

  // 即关即销：图状态由渲染层的去抖写库 + 关窗兜底刷新落库，主进程侧不拦
  // （有未确认连线时，渲染层会 setCloseGuard 武装守卫，见 useGraphDoc）
  attachCloseGuard(relationWin);
  relationWin.on("closed", () => {
    console.log("[main] Relation 窗口已关闭");
  });

  loadRendererEntry(relationWin, "relation");

  return relationWin;
}

/** 给渲染层的回执：送不到也拉不起来时 `delivered=false`，调用方必须说出来 */
interface WindowSendResult {
  delivered: boolean;
  queued: boolean;
}

/**
 * 能被「消息驱动拉起」的窗口白名单。
 *
 * 刻意不用 `Record<string, () => void>` 动态分发：窗口创建有副作用（单例、
 * 上下文、装载守卫），只允许这里点过名的窗口被一条跨进程消息拉起来。
 */
const WINDOW_CREATORS: Record<string, () => BrowserWindow> = {
  novel: createNovelWindow,
  relation: createRelationWindow,
};

/** 这个版本是否打包了该窗口（能被一条跨进程消息拉起来） */
function canCreateWindow(target: string): boolean {
  // lite 版不打包 NovelWindow / RelationWindow，拉起不存在的入口只会黑屏
  return Boolean(WINDOW_CREATORS[target]) && EDITION !== "lite";
}

/** 真正创建窗口；返回 false = 创建失败（已记日志） */
function createWindowFor(target: string): boolean {
  const create = WINDOW_CREATORS[target];
  if (!create) return false;
  try {
    create();
    return true;
  } catch (error) {
    log(
      "error",
      "main",
      "window",
      `拉起窗口 ${target} 失败：${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

// ── 登录窗口 ──

function getLoginWindowUrl(email?: string) {
  const params = new URLSearchParams();
  if (email) {
    params.set("email", email);
  }

  const query = params.toString();
  const suffix = query ? `?${query}` : "";

  const relPath = RENDERER_ENTRY_PATHS.login;
  if (VITE_DEV_SERVER_URL) {
    return `${VITE_DEV_SERVER_URL}/${relPath}${suffix}`;
  }
  return `app://./${relPath}${suffix}`;
}

function createLoginWindow(user?: { email: string } | null) {
  const loginWin = new BrowserWindow({
    width: 520,
    height: user ? 320 : 420,
    icon: ICON_PATH,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    ...ROUNDED_WINDOW_OPTIONS,
    // 圆角窗口不需要系统标题栏（frame 已为 false，这里保持无边框语义）
    titleBarStyle: "hidden",
    webPreferences: createWebPreferences(),
  });

  loginWin.removeMenu();

  attachWindowLoadGuard(loginWin, "Login", {
    windowName: "login",
    reveal: (reason) => {
      loginWindowHasShown = true;
      loginWindowVisibleAt = Date.now();
      revealWindow(loginWin, "Login", reason);
    },
  });

  // 登录窗口同样支持调试快捷键（frame:false 无菜单栏，更需要显式注册）
  if (IS_DEV) {
    registerDevToolsShortcuts(loginWin);
    if (OPEN_DEVTOOLS) loginWin.webContents.openDevTools({ mode: DEVTOOLS_MODE });
  }

  // 注册到窗口管理池（自动处理 closed 事件清理）
  windowManager.register("login", loginWin);

  loginWin.loadURL(getLoginWindowUrl(user?.email));
}

// ── 主窗口（primary window）语义 ──
// full/lite 版主窗口 = BaseWindow（注册名 "main"），novel 版主窗口 = NovelWindow
// （注册名 "novel"）。登录落点、托盘、second-instance、activate 全部指向 primary。

function createPrimaryWindow(): BrowserWindow {
  isPrimaryReady = false;
  return PRIMARY_ENTRY === "base" ? createBaseWindow() : createNovelWindow();
}

function ensurePrimaryWindow(): BrowserWindow {
  const existing = windowManager.get(PRIMARY_WINDOW_NAME);
  return existing ?? createPrimaryWindow();
}

function allowAndShowPrimaryWindow() {
  canShowMainWindow = true;
  ensurePrimaryWindow();

  const delay =
    loginWindowHasShown && loginWindowVisibleAt
      ? Math.max(
          0,
          LOGIN_WINDOW_MIN_DISPLAY_MS - (Date.now() - loginWindowVisibleAt),
        )
      : 0;

  const closeLoginWindow = () => {
    const loginWin = windowManager.get("login");
    if (loginWin && !loginWin.isDestroyed()) {
      loginWin.close();
    }
  };

  if (delay > 0) {
    setTimeout(() => {
      closeLoginWindow();
      showPrimaryWindow();
    }, delay);
  } else {
    closeLoginWindow();
    showPrimaryWindow();
  }
}

function showPrimaryWindow() {
  if (!canShowMainWindow) {
    const loginWin = windowManager.get("login");
    if (loginWin?.isMinimized()) loginWin.restore();
    loginWin?.show();
    loginWin?.focus();
    return;
  }

  const primaryWin = windowManager.get(PRIMARY_WINDOW_NAME);
  if (!primaryWin || !isPrimaryReady) return;

  if (primaryWin.isMinimized()) primaryWin.restore();
  primaryWin.show();
  primaryWin.focus();

  // 活动提醒轮询只在含 DailyPage 的版本启动（novel 版没有日程页）
  if (EDITION !== "novel" && !hasStartedActivityPolling) {
    hasStartedActivityPolling = true;
    startActivityPolling();
  }
}

// 单实例锁定：防止多个应用和托盘同时存在
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  // 第二个实例启动时，聚焦已有主窗口或登录窗口
  showPrimaryWindow();
});

app.whenReady().then(() => {
  // 初始化本地数据库（authDb 内含 user 表）
  initDb();
  // 日志 handler 要早注册：启动期的窗口装载 / 登录事件都希望落库。
  // 配置读取推迟到用户库就绪之后（见下方 loadLogSettings）。
  registerLogHandlers();
  const cachedUser = getCachedUser();
  if (cachedUser) switchUserDb(cachedUser.email, true);
  loadLogSettings();
  bootstrapLogger();

  // 注册语义化 IPC handlers。
  // 全版本注册：小说（novel 版的唯一业务域）与用户登录；
  // 仅 full/lite 注册：todo/memo/activity/checkin/ledger
  // （novel 版不打包对应窗口，省启动开销，也缩小可触达的 IPC 面）。
  // novel.db 挂在用户库的生命周期上：切用户 / 退出登录 / 退出应用时同步开关。
  // 必须早于 novel handler 注册 —— 注册时若已有当前用户（启动期走的是
  // switchUserDb → register 的顺序），它会立即补开一次
  registerNovelDbBridge();
  registerNovelHandlers();
  // 关系图提交（R27 / S3）：单事务写「新建关系 + 备注 + 画布文档」，
  // 成功后由本 handler 广播 novel-links-changed 回主窗口（W-15）。
  registerNovelGraphHandlers();
  // 导出 PNG（R27 / S5）：取景（capturePage + 判空重试）与二进制落盘分两条通道，
  // 后者只收字节 —— 复用 novel-export-file 的 utf8 写会「不报错但图坏了」。
  registerNovelExportHandlers();
  registerNovelPackHandlers();
  registerNovelSettingHandlers();
  // 全局设定中心（1.4x）：全局库 CRUD + 引用/上架；每次全局写成功后由 handler
  // 广播 `global-setting-changed`（书窗口订阅后重载设定，REQ-041 ③）。
  registerNovelGlobalSettingHandlers();
  registerUserHandlers();
  // 快捷键：配置持久化 + 应用级（globalShortcut）注册。
  // 动作注入避免 handler 反向 import 窗口创建函数（会形成循环依赖）。
  registerShortcutHandlers({
    onGlobalAction: (id) => {
      if (id !== "showNovelWindow") return;
      if (EDITION === "lite") return;
      log("info", "main", "shortcut", "唤出小说窗口（应用级快捷键）");
      if (IS_NOVEL_PRIMARY) {
        showPrimaryWindow();
        return;
      }
      const existing = windowManager.get("novel");
      if (existing) {
        raiseWindow(existing);
        return;
      }
      createNovelWindow();
    },
  });
  // 关闭守卫：窗口真销毁前先问渲染层「还有未保存的改动吗」
  registerCloseGuardHandlers();
  setupRendererHttpSession();
  registerHttpSessionHandlers();
  if (EDITION !== "novel") {
    registerActivityHandlers();
    registerTodoHandlers();
    registerMemoHandlers();
    registerCheckinHandlers();
    registerLedgerHandlers();
  }

  // 注册跨窗口通信 IPC handler
  ipcMain.handle("window-broadcast", (_event, event: string, data?: unknown) => {
    const sender = BrowserWindow.fromWebContents(_event.sender);
    // 广播时排除发送者自己（按窗口实例反查注册名，覆盖全部窗口）
    const senderName = sender ? windowManager.getNameOf(sender) : undefined;
    windowManager.broadcast(event, data, senderName);
  });

  // 跨窗口投递（R27 起唯一入口）
  //
  // 选项（第 5 参，向后兼容旧的布尔 `raise`）：
  // - `raise`：目标窗口在时抬到最前（「从别的窗口跳回主窗口某个位置」若只发
  //   消息不抬窗口，用户会觉得点了没反应）；
  // - `create`：目标窗口不在时先创建（目前只认 novel / relation）；
  // - `queue`：目标窗口不在时**入队**，等它起来后补投。
  //
  // 为什么把「入队 + 拉起」放进通用通道：以前每种跳转都要在主进程单独维护一对
  // IPC（如 `relation-entity-open` / `relation-entity-take`）+ 一份 pending 变量，
  // 只为回答「窗口没起来这条消息存哪」。现在这件事由 `window-pending` 统一承担，
  // 主进程只需要认识窗口名，不再认识消息类型。
  //
  // 返回值给渲染层一个判断依据：`delivered=false` 表示既送不到也拉不起来
  // （如 lite 版没有该窗口），调用方要据此给可见提示，不能假装成功。
  //
  // ⚠️ 第 4 / 第 5 个位置参数都接受：preload 现在把选项压成一个对象传在第 4 位，
  // 但旧产物是「第 4 位布尔 raise + 第 5 位 options」。两份产物在热重启窗口里
  // 可能错位共存，只认其中一个形状就等于让 `create` 静默失效（本次真机故障）。
  ipcMain.handle(
    "window-send-to",
    (
      _event,
      target: string,
      event: string,
      data?: unknown,
      optionsOrRaise?: boolean | WindowSendOptions,
      extraOptions?: WindowSendOptions,
    ): WindowSendResult => {
      const opts = readWindowSendOptions(optionsOrRaise, extraOptions);
      const existing = windowManager.get(target);
      if (existing) {
        if (opts.raise) raiseWindow(existing);
        windowManager.sendTo(target, event, data);
        return { delivered: true, queued: false };
      }

      // 这个版本根本没打包该窗口（lite）：别把一条永远送不到的消息塞进队列
      if (opts.create && !canCreateWindow(target)) {
        return { delivered: false, queued: false };
      }
      if (!opts.create && !opts.queue) return { delivered: false, queued: false };

      // 先入队、再创建：新窗口的 preload 会在装载后 drain，
      // 「创建完才发现没消息」与「消息先到、窗口还没起来」两种时序都覆盖
      pushPendingMessage(target, { event, data });
      const created = opts.create === true ? createWindowFor(target) : false;
      return { delivered: created, queued: true };
    },
  );

  // 新窗口装载后自取待投递消息（preload 调用；取走即清，重开窗口不会又弹上次的卡）
  // 返回 null = 主进程还不认识这个窗口（注册晚于 preload 执行），preload 会等 load 再试
  ipcMain.handle("window-pending-drain", (event): PendingWindowMessage[] | null => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    const name = sender ? windowManager.getNameOf(sender) : undefined;
    if (!name) return null;
    const list = takePendingMessages(name);
    if (list.length > 0) {
      log("info", "main", "window", `${name} 窗口补投 ${list.length} 条待处理消息`);
    }
    return list;
  });

  // 注册协议处理器，将 app:// 请求映射到本地文件
  // 必须异步：每个 bundle / CSS / 字体都是一次 1~5MB 的读盘，同步读会把
  // 冷启动的加载阶段整段堵在主进程上（protocol.handle 支持返回 Promise）
  //
  // Cache-Control 按「文件名是否内容寻址」分档（策略见 app-protocol-cache.ts）：
  // 哈希资产 immutable（内容寻址，跨版本字节不变）→ 若 Chromium 对自定义协议响应
  // 启用磁盘缓存，后续窗口可免主进程读盘；即便不生效也无害（最坏退回每次读盘）。
  // 真正的跨窗口收益锚点在 scheme 侧 codeCache + 渲染侧 v8CacheOptions（见上方）。
  // HTML 入口 no-store → 防止应用升级后仍被喂上一版 HTML（它引用的旧哈希资产已从磁盘删除）。
  protocol.handle("app", async (request) => {
    const url = request.url.replace("app://./", "");
    const cleanUrl = url.split("?")[0];
    // cleanUrl 直接用于分档判定，filePath 多做了一次 decodeURIComponent：
    // 哈希资产文件名均为 URL 安全字符（base64url），两者对真实请求永远等价，
    // 故此处不解码也不影响分档；若将来路径含非安全字符，需把解码后的值一并传入判定。
    const filePath = path.join(DIST, decodeURIComponent(cleanUrl));
    const content = await fs.promises.readFile(filePath);
    return new Response(content, {
      headers: {
        "Content-Type": getMimeType(filePath),
        "Cache-Control": resolveAppProtocolCacheControl(cleanUrl),
      },
    });
  });

  ipcMain.handle("find-in-page", (event, value?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;

    const query = value?.trim();
    if (!query) return false;
    win.webContents.findInPage(query, {
      findNext: false,
      forward: true,
      matchCase: false,
    });
    return true;
  });

  // ── NovelWindow 开关 IPC ──
  // 仅 full 版响应：lite 不打包 novel 窗口（入口已隐藏），novel 版小说窗口
  // 本身就是主窗口，打开请求无意义。
  ipcMain.on("novel-window-open", () => {
    if (EDITION !== "full") return;
    createNovelWindow();
  });

  // ── SettingsWindow 开关 IPC（全版本：入口分别在 base / novel 主窗标题栏） ──
  ipcMain.on("settings-window-open", () => {
    createSettingsWindow();
  });

  // ── PackWindow 开关 IPC（full / novel 版：入口在小说窗口顶栏） ──
  // payload 携带当前作品 / 章节，供新窗口装载与切书兜底；lite 版不打包
  // 行囊窗口（novel 域整体缺席），请求直接忽略。
  ipcMain.on("pack-window-open", (event, payload: unknown) => {
    if (EDITION === "lite") return;
    // 到达日志（与 global-setting-window-open 同口径）：「点了没反应」时第一件事
    // 是分清「点击没到主进程」与「窗口没起来」，没有这行就只剩猜
    console.log("[main] 收到 pack-window-open，开始唤起行囊窗口");
    if (payload && typeof payload === "object") {
      const workId =
        "workId" in payload && typeof (payload as { workId: unknown }).workId === "string"
          ? (payload as { workId: string }).workId
          : "";
      // 零作品拒绝开窗（P2-5 双保险，渲染层 openPackWindow 已有同款守卫）：
      // 空 workId 会让行囊装载通道播种 work_id='' 的垃圾角色行，且窗口
      // 只能显示一份永远空着的壳。同步广播（novel-work-changed）不受影响，
      // 那条通道靠空 workId 通知行囊窗口退回占位态，语义不同。
      if (!workId) return;
      const chapterId =
        "chapterId" in payload &&
        typeof (payload as { chapterId: unknown }).chapterId === "string"
          ? (payload as { chapterId: string }).chapterId
          : "";
      const nonce =
        "nonce" in payload && typeof (payload as { nonce: unknown }).nonce === "number"
          ? (payload as { nonce: number }).nonce
          : undefined;
      packWindowContext = { workId, chapterId, nonce };
    }
    createPackWindow(event.sender);
  });

  // ── 跨窗口导航：行囊窗口 → 小说窗口的设定中心（UI-03） ──
  // 行囊窗口（独立窗口）的空态引导「去设定中心创建等级体系」需要把用户带回
  // NovelWindow 的设定中心。主进程只做两件事：把 novel 窗口弄到前面、把负载
  // 原样转发回去（同窗口路径走 CustomEvent，跨窗口路径走这条 IPC）。
  //
  // 为什么不做分类定位：定位要读作品数据（哪个分类是等级序列），那是渲染层
  // 的知识；主进程介入只会把 novel 域逻辑漏进主进程。此处只搬运。
  //
  // 与 novel-window-open 的差别：那条是「开窗」语义（lite 版忽略），本条是
  // 「拉起到前面 + 定位」——novel 版小说窗口即主窗，本条同样成立，故不设
  // 版本门（lite 版不存在行囊窗口，也就没有发起方，天然到不了这里）。
  ipcMain.on("novel-open-setting-center", (_event, payload: unknown) => {
    const novelWin = windowManager.get("novel");
    if (!novelWin || novelWin.isDestroyed()) return;
    if (novelWin.isMinimized()) novelWin.restore();
    novelWin.show();
    novelWin.focus();
    // 转发给小说窗口自己消费（渲染层订阅后打开设定中心并定位到目标分类）。
    // 用 sendTo 而非 broadcast：这是点对点导航意图，其它窗口不该收到。
    windowManager.sendTo("novel", "novel-open-setting-center", payload);
  });

  // ── GlobalSettingWindow 开关 IPC（full / novel 版：入口在书架顶栏） ──
  // 单实例唤起（createGlobalSettingWindow 内部已开则聚焦）。lite 版不打包本
  // 窗口（novel 域整体缺席），请求直接忽略。
  //
  // 这条日志是排查「点了没反应」的第一分界线：终端里没有它 = 点击没到达主进程
  // （preload 白名单 / 运行中的主进程是旧代码）；有它但窗口没出现 = 窗口创建环节，
  // 后面的 did-fail-load / 超时兜底日志会接着说。
  ipcMain.on("global-setting-window-open", (event) => {
    if (EDITION === "lite") {
      console.log("[main] 收到 global-setting-window-open，但当前为 lite 版（不含全局设定中心），已忽略");
      return;
    }
    console.log("[main] 收到 global-setting-window-open，开始创建全局设定中心窗口");
    // 带上发起方：窗口真正可见时回执 global-setting-window-shown（REQ-054 修法）
    createGlobalSettingWindow(event.sender);
  });

  // ── RelationWindow 开关 IPC（full / novel 版：入口在右栏工具箱） ──
  // 与 global-setting-window-open 同口径：lite 版直接忽略；空 workId 拒绝开窗
  // （图窗口没有作品上下文只能显示空壳，且后续写回会落进错误作品）。
  ipcMain.on("relation-window-open", (_event, payload) => {
    if (EDITION === "lite") {
      console.log("[main] 收到 relation-window-open，但当前为 lite 版（不含小说域），已忽略");
      return;
    }
    const workId =
      payload && typeof payload === "object" && typeof (payload as { workId?: unknown }).workId === "string"
        ? (payload as { workId: string }).workId
        : "";
    if (!workId) {
      console.log("[main] 收到 relation-window-open 但缺少 workId，已忽略");
      return;
    }
    console.log("[main] 收到 relation-window-open，开始唤起人物关系网络窗口");
    relationWindowContext = { workId };
    createRelationWindow();
  });

  // ── 退出登录（SettingsWindow 账号区发起） ──
  // 主进程编排：清除缓存用户 → 关闭设置窗与主窗口（登录态下的数据随窗口
  // 销毁，防止切换账号后残留上一账号的渲染层状态）→ 回到登录窗。
  ipcMain.on("auth-logout", () => {
    // ⚠️ 登出**不会**触发 userDb 生命周期（logoutUser 只删 authDb 的用户行、
    // 不关库），所以日志目录必须在这里显式切到匿名目录，否则下一个账号的
    // 日志会继续写进上一个用户的目录（"按用户隔离"就破了）。
    log("info", "main", "auth", "用户登出");
    resetLogRoot("logout");
    logoutUser();
    canShowMainWindow = false;
    isPrimaryReady = false;

    windowManager.get("settings")?.destroy();
    // 行囊窗口**必须走 close() 而不是 destroy()**（P2-7）：destroy 不给
    // close-guard 三通道任何机会，dirty>0 时用户的未保存编辑会被连窗口
    // 一起销毁（渲染层 beforeunload flush 依赖页面生命周期，destroy 等不到
    // 它跑完）。close() 让守卫弹出「保存并关闭 / 放弃 / 取消」；用户选取消
    // 时行囊窗口留在原地，登出流程照常继续（logoutUser 只清 authDb 用户行，
    // 不关 novel.db，「保存并关闭」仍能正常落库）。
    windowManager.get("pack")?.close();
    // 全局设定中心同样属 novel 域（数据在用户级 novel.db）：登出后必须关掉，
    // 否则窗口会留着上一账号的全局库。同走 close()（守卫本窗口不武装，即放行）。
    windowManager.get("globalSetting")?.close();
    // 关系图窗口属 novel 域（读同一份 novel.db）：登出后必须关掉，
    // 否则窗口会留着上一账号的要素与关联。同走 close()（守卫未武装，即放行）。
    windowManager.get("relation")?.close();
    relationWindowContext = null;
    windowManager.get(PRIMARY_WINDOW_NAME)?.destroy();

    const loginWin = windowManager.get("login");
    if (loginWin) {
      loginWin.show();
      loginWin.focus();
    } else {
      createLoginWindow(null);
    }
  });

  // ── 窗口控制 IPC（WindowHeader 的最小化/最大化/关闭按钮） ──
  // 约定：payload 是动作字符串本身（"minimize" | "maximize-toggle" | "close"）。
  // close 走 win.close()：由各窗口自己的 close 语义决定行为
  // （主窗口隐藏到托盘、novel 主窗同样进托盘、其余子窗口直接关闭）
  ipcMain.on("window-control", (event, payload: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    // 兼容字符串与 { action } 对象两种形式，避免两端约定不一致时静默失效
    const action =
      typeof payload === "string"
        ? payload
        : payload && typeof payload === "object" && "action" in payload
          ? String((payload as { action: unknown }).action)
          : "";
    switch (action) {
      case "minimize":
        win.minimize();
        break;
      case "maximize-toggle":
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
        break;
      case "close":
        win.close();
        break;
    }
  });

  // 渲染层挂载时查询一次当前最大化状态（覆盖窗口在最大化状态下刷新的场景）
  ipcMain.on("window-maximize-query", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    event.sender.send("window-maximize-state", win.isMaximized());
  });

  ipcMain.on("login-confirm", (_event, data: unknown) => {
    if (
      data &&
      typeof data === "object" &&
      "type" in data &&
      data.type === "user-login-confirmed"
    ) {
      const email = "email" in data && typeof data.email === "string" ? data.email : "";
      if (email) {
        switchUserDb(email);
      }
      allowAndShowPrimaryWindow();
    }
  });

  createLoginWindow(cachedUser);
  // 有缓存用户才预创建主窗口：登出后的重启没有缓存用户（userDb 未初始化），
  // 此时预创建 BaseWindow 会让页面挂载即请求 todo/checkin/ledger 等数据，
  // 全部命中「尚未初始化当前用户数据」。无缓存时等 login-confirm 切换完
  // userDb 后经 allowAndShowPrimaryWindow → ensurePrimaryWindow 再创建。
  if (cachedUser) {
    ensurePrimaryWindow();
  }

  // 应用级 DevTools 快捷键：即使没有窗口焦点（例如无边框登录窗）也能唤出调试窗口。
  // before-input-event 处理有焦点时的按键，globalShortcut 作为兜底。
  if (IS_DEV) {
    const toggleFocused = () => {
      const focused = BrowserWindow.getFocusedWindow();
      toggleDevTools(focused ?? windowManager.get(PRIMARY_WINDOW_NAME) ?? windowManager.get("login"));
    };
    globalShortcut.register("CommandOrControl+Shift+I", toggleFocused);
    globalShortcut.register("F12", toggleFocused);
    console.log("[main] 调试快捷键已注册：Ctrl+Shift+I / F12 切换 DevTools");
  }

  // 系统托盘图标，点击可重新显示窗口
  tray = new Tray(TRAY_ICON_PATH);
  tray.setToolTip("CheckIn");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示窗口", click: () => showPrimaryWindow() },
      {
        label: "退出",
        click: () => {
          // ⚠️ 不在这里置 `isQuitting`：置了 `before-quit` 的询问分支
          // （`!isQuitting && hasArmedCloseGuard()`）就被整体跳过，直接走到
          // 清理 + 关库 —— 行囊的「保存并退出」会在库已关闭后落空。
          // 是否真的退出、退前要不要问，统一由 `before-quit` 裁决。
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => {
    const primaryWin = windowManager.get(PRIMARY_WINDOW_NAME);
    if (primaryWin?.isVisible()) {
      primaryWin.hide();
    } else {
      showPrimaryWindow();
    }
  });
  tray.on("right-click", () => {
    tray?.popUpContextMenu();
  });

  app.on("activate", () => {
    if (!windowManager.has(PRIMARY_WINDOW_NAME) && !windowManager.has("login")) {
      createLoginWindow(getCachedUser());
    }
    showPrimaryWindow();
  });
});

app.on("before-quit", (event) => {
  // ⚠️ 顺序是关键：清理一旦开始，窗口会陆续销毁、渲染层随时可能发起最后一次
  // 保存 —— 所以「问不问用户」必须在任何清理之前裁决；且询问期间**不能**置
  // `isQuitting`（置了主窗就会直接销毁，守卫也跟着失效）。
  if (!isQuitting && hasArmedCloseGuard()) {
    event.preventDefault();
    void askCloseGuards("退出应用").then((allow) => {
      // 取消：什么都不做，应用继续运行，`isQuitting` 仍为 false，下次退出会重新问
      if (!allow) return;
      isQuitting = true;
      app.quit();
    });
    return;
  }

  isQuitting = true;
  // 守卫就地缴械：此刻起窗口陆续销毁、数据层即将关闭，任何窗口都不许再
  // preventDefault + 弹「未保存」—— 用户点「保存」时库已关，必然失败
  //（「其余窗口都关了、行囊弹出来、保存报错」正是缺了这一步的样子）。
  standDownCloseGuards();
  globalShortcut.unregisterAll();
  stopActivityPolling();
  // 编辑器会话随应用退出正常结束（novel closed 未触发时兜底）。
  // 注意它要写库 —— 所以必须发生在 will-quit 关库之前，这里正好还开着。
  markNovelSessionClosed();
  tray?.destroy();
  tray = null;
  // 关库不在这里：before-quit 阶段窗口还活着，销毁过程中渲染层的
  // 最后一次保存（防抖兜底 / 退出前 flush）仍可能到达。关库挪到 will-quit
  // —— 那时所有窗口已销毁，不可能再有保存进来，也不会有「库已关却收到
  // 保存请求」的时间窗。
});

app.on("will-quit", () => {
  // 所有窗口已销毁、渲染层全部下线 —— 此时关库才是安全的最后一步。
  // 放在 before-quit 曾导致行囊「保存并退出」时库已关闭（保存必然失败）。
  log("info", "main", "app", "应用退出");
  // 先 flush 日志再关库：关库过程中的异常仍希望留在文件里
  closeLogger();
  closeDb();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
  };
  return mimeTypes[ext] || "application/octet-stream";
}
