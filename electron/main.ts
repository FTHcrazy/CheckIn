import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  Tray,
  Menu,
  globalShortcut,
} from "electron";
import path from "path";
import fs from "fs";
import { initDb, closeDb, switchUserDb } from "./db";
import { startActivityPolling, stopActivityPolling } from "./activitiesTask";
import { windowManager } from "./windowManager";
import { registerActivityHandlers } from "./handlers/activity-handlers";
import { registerTodoHandlers } from "./handlers/todo-handlers";
import {
  markNovelSessionClosed,
  registerNovelHandlers,
} from "./handlers/novel-handlers";
import {
  logoutUser,
  registerUserHandlers,
  getCachedUser,
} from "./handlers/user-handlers";
import { registerMemoHandlers } from "./handlers/memo-handlers";
import { registerLedgerHandlers } from "./handlers/ledger-handlers";
import { registerCheckinHandlers } from "./handlers/checkin-handlers";
import {
  registerHttpSessionHandlers,
  setupRendererHttpSession,
} from "./httpSession";
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
const ICON_PATH = VITE_DEV_SERVER_URL
  ? path.join(DIST_ELECTRON, "../public/icon.ico")
  : path.join(DIST, "icon.ico");
// 托盘图标独立于应用图标：16px 下做了加粗简化，笔尖缝改为实心填色（详见 public/tray/）
const TRAY_ICON_PATH = VITE_DEV_SERVER_URL
  ? path.join(DIST_ELECTRON, "../public/tray/tray.png")
  : path.join(DIST, "tray/tray.png");

// 注册自定义协议用于加载本地文件 (必须在 app.whenReady 之前调用)
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
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

  win.webContents.once("did-finish-load", () => {
    console.log(`[main] 页面加载完成: ${Date.now() - t0}ms`);
    isPrimaryReady = true;
    if (canShowMainWindow) {
      showPrimaryWindow();
    }
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
 * 默认尺寸 1200×760（min 800×560）。
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
    minWidth: 800,
    minHeight: 560,
    icon: ICON_PATH,
    show: false,
    ...ROUNDED_WINDOW_OPTIONS,
    titleBarStyle: "hidden",
    webPreferences: createWebPreferences(),
  });

  novelWin.removeMenu();

  novelWin.webContents.once("did-finish-load", () => {
    if (!novelWin || novelWin.isDestroyed()) return;
    if (IS_NOVEL_PRIMARY) {
      // 主窗形态：就绪标记 + 由登录流程/托盘驱动显示，不自动 show
      isPrimaryReady = true;
      if (canShowMainWindow) {
        showPrimaryWindow();
      }
    } else {
      novelWin.show();
      novelWin.focus();
    }
  });

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
    novelWin.on("closed", () => {
      isPrimaryReady = false;
      // 编辑器会话结束：清除崩溃恢复标记（PRD R3 ③）
      markNovelSessionClosed();
    });
  } else {
    // 子窗形态：不拦截 close，正常关闭，窗口随实例销毁
    novelWin.on("closed", () => {
      console.log("[main] Novel 窗口已关闭");
      // 编辑器会话正常结束：清除崩溃恢复标记（PRD R3 ③）
      markNovelSessionClosed();
    });
  }

  loadRendererEntry(novelWin, "novel");

  return novelWin;
}

// ── SettingsWindow（全局设置，仅 novel 版开放入口） ──

/**
 * SettingsWindow —— 全局设置窗口（外观 / 账号，后续扩展字体、快捷键等）。
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
    height: 480,
    minWidth: 480,
    minHeight: 400,
    icon: ICON_PATH,
    resizable: false,
    maximizable: false,
    show: false,
    ...ROUNDED_WINDOW_OPTIONS,
    titleBarStyle: "hidden",
    webPreferences: createWebPreferences(),
  });

  settingsWin.removeMenu();

  settingsWin.webContents.once("did-finish-load", () => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.show();
      settingsWin.focus();
    }
  });

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
  loginWin.webContents.once("did-finish-load", () => {
    if (loginWin && !loginWin.isDestroyed()) {
      loginWindowHasShown = true;
      loginWindowVisibleAt = Date.now();
      loginWin.show();
      loginWin.focus();
    }
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
  const cachedUser = getCachedUser();
  if (cachedUser) switchUserDb(cachedUser.email, true);

  // 注册语义化 IPC handlers。
  // 全版本注册：小说（novel 版的唯一业务域）与用户登录；
  // 仅 full/lite 注册：todo/memo/activity/checkin/ledger
  // （novel 版不打包对应窗口，省启动开销，也缩小可触达的 IPC 面）。
  registerNovelHandlers();
  registerUserHandlers();
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

  ipcMain.handle("window-send-to", (_event, target: string, event: string, data?: unknown) => {
    windowManager.sendTo(target, event, data);
  });

  // 注册协议处理器，将 app:// 请求映射到本地文件
  protocol.handle("app", (request) => {
    const url = request.url.replace("app://./", "");
    const cleanUrl = url.split("?")[0];
    const filePath = path.join(DIST, decodeURIComponent(cleanUrl));
    const content = fs.readFileSync(filePath);
    return new Response(content, {
      headers: {
        "Content-Type": getMimeType(filePath),
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

  // ── SettingsWindow 开关 IPC（仅 novel 版：设置入口只存在于小说版主窗标题栏） ──
  ipcMain.on("settings-window-open", () => {
    if (EDITION !== "novel") return;
    createSettingsWindow();
  });

  // ── 退出登录（SettingsWindow 账号区发起） ──
  // 主进程编排：清除缓存用户 → 销毁设置窗与主窗口（登录态下的数据随窗口
  // 销毁，防止切换账号后残留上一账号的渲染层状态）→ 回到登录窗。
  ipcMain.on("auth-logout", () => {
    logoutUser();
    canShowMainWindow = false;
    isPrimaryReady = false;

    windowManager.get("settings")?.destroy();
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
  ensurePrimaryWindow();

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
          isQuitting = true;
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

app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  stopActivityPolling();
  // 编辑器会话随应用退出正常结束（novel closed 未触发时兜底）
  markNovelSessionClosed();
  tray?.destroy();
  tray = null;
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
