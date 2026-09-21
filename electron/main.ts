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
import { registerUserHandlers, getCachedUser } from "./handlers/user-handlers";
import { registerMemoHandlers } from "./handlers/memo-handlers";
import { registerMigrationHandlers } from "./handlers/migration-handlers";
import {
  registerHttpSessionHandlers,
  setupRendererHttpSession,
} from "./httpSession";

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
// 渲染层窗口入口清单，与 vite.config.ts 的 rollupOptions.input 对应
const RENDERER_ENTRIES = {
  base: "src/windows/BaseWindow/index.html",
  login: "src/windows/LoginWindow/index.html",
  worker: "src/windows/WorkerWindow/index.html",
} as const;
let tray: Tray | null = null;
const ICON_PATH = VITE_DEV_SERVER_URL
  ? path.join(DIST_ELECTRON, "../public/icon.ico")
  : path.join(DIST, "icon.ico");

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
let isMainWindowReady = false;
let hasStartedActivityPolling = false;
const LOGIN_WINDOW_MIN_DISPLAY_MS = 3000;
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
// 三个窗口统一为「无系统边框 + 透明底 + CSS 圆角」的实现方式：
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

/** 统一的 webPreferences，三个窗口保持一致的安全设置 */
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
 * 所有使用 WindowHeader 的窗口（main / worker）都需要注册。
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

function createWindow(): BrowserWindow {
  const t0 = Date.now();
  isMainWindowReady = false;

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

  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    isMainWindowReady = false;
  });

  // 最大化状态变化时同步给渲染层，WindowHeader 据此切换最大化/还原图标
  forwardMaximizeState(win);

  win.webContents.once("did-finish-load", () => {
    console.log(`[main] 页面加载完成: ${Date.now() - t0}ms`);
    isMainWindowReady = true;
    if (canShowMainWindow) {
      showMainWindow();
    }
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}/${RENDERER_ENTRIES.base}`);
    if (OPEN_DEVTOOLS) win.webContents.openDevTools({ mode: DEVTOOLS_MODE });
  } else {
    win.loadURL(`app://./${RENDERER_ENTRIES.base}`);
  }

  // 开发模式下随时可用 Ctrl+Shift+I / F12 开关调试窗口
  if (IS_DEV) registerDevToolsShortcuts(win);

  // 注册到窗口管理池
  windowManager.register("main", win);

  return win;
}

function ensureMainWindow(): BrowserWindow {
  let win = windowManager.get("main");
  if (!win) {
    win = createWindow();
  }
  return win;
}

function allowAndShowMainWindow() {
  canShowMainWindow = true;
  ensureMainWindow();

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
      showMainWindow();
    }, delay);
  } else {
    closeLoginWindow();
    showMainWindow();
  }
}

function showMainWindow() {
  if (!canShowMainWindow) {
    const loginWin = windowManager.get("login");
    if (loginWin?.isMinimized()) loginWin.restore();
    loginWin?.show();
    loginWin?.focus();
    return;
  }

  const mainWin = windowManager.get("main");
  if (!mainWin || !isMainWindowReady) return;

  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();

  if (!hasStartedActivityPolling) {
    hasStartedActivityPolling = true;
    startActivityPolling();
  }
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

/**
 * WorkerWindow —— CheckIn 小说编辑器窗口（PRD v0.4 §7 窗口级改造）。
 *
 * 特性：
 * - 标准窗口行为：出现在任务栏、可最小化/最大化/关闭（由通用 WindowHeader 提供）
 * - 不拦截 close 事件，关闭即随实例销毁；重新打开即全新实例
 *   —— 对编辑器反而是优点：无状态腐化，数据安全完全由持久化层兜底
 * - 默认尺寸 1200×760（min 800×560）
 * - TODO(数据层里程碑)：bounds 记忆（尺寸/位置持久化）与 R12 全局快捷键 Alt+W 一起做
 * - 若窗口已存在（例如快捷键重复触发），先聚焦而不是重复创建
 */
function createWorkerWindow(): BrowserWindow {
  const existing = windowManager.get("worker");
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }

  const workerWin = new BrowserWindow({
    // PRD v0.4 §7：编辑器窗口默认 1200×760，最小 800×560（三栏布局的可用下限）
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

  workerWin.removeMenu();

  workerWin.webContents.once("did-finish-load", () => {
    if (workerWin && !workerWin.isDestroyed()) {
      workerWin.show();
      workerWin.focus();
    }
  });

  if (IS_DEV) {
    registerDevToolsShortcuts(workerWin);
    if (OPEN_DEVTOOLS) workerWin.webContents.openDevTools({ mode: DEVTOOLS_MODE });
  }

  // 标题栏的最小化/最大化按钮需要最大化状态推送
  forwardMaximizeState(workerWin);

  // 注册到窗口管理池（自动处理 closed 事件清理）
  windowManager.register("worker", workerWin);

  // 不拦截 close 事件：正常关闭，窗口随实例销毁
  workerWin.on("closed", () => {
    console.log("[main] Worker 窗口已关闭");
    // 编辑器会话正常结束：清除崩溃恢复标记（PRD R3 ③）
    markNovelSessionClosed();
  });

  const url = IS_DEV
    ? `${VITE_DEV_SERVER_URL}/${RENDERER_ENTRIES.worker}`
    : `app://./${RENDERER_ENTRIES.worker}`;
  workerWin.loadURL(url);

  return workerWin;
}

function getLoginWindowUrl(email?: string) {
  const params = new URLSearchParams();
  if (email) {
    params.set("email", email);
  }

  const query = params.toString();
  const suffix = query ? `?${query}` : "";

  if (VITE_DEV_SERVER_URL) {
    return `${VITE_DEV_SERVER_URL}/${RENDERER_ENTRIES.login}${suffix}`;
  }

  return `app://./${RENDERER_ENTRIES.login}${suffix}`;
}

// 单实例锁定：防止多个应用和托盘同时存在
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  // 第二个实例启动时，聚焦已有窗口或登录窗口
  showMainWindow();
});

app.whenReady().then(() => {
  // 初始化本地数据库（authDb 内含 user 表）
  initDb();
  const cachedUser = getCachedUser();
  if (cachedUser) switchUserDb(cachedUser.email, true);

  // 注册语义化 IPC handlers
  registerActivityHandlers();
  registerTodoHandlers();
  registerNovelHandlers();
  registerUserHandlers();
  registerMemoHandlers();
  registerMigrationHandlers();

  // 渲染进程网络会话：一次性配置 CORS 放行 + Cookie 播种通道。
  // 请求本身全部在渲染进程发起，主进程不再代理 HTTP。
  setupRendererHttpSession();
  registerHttpSessionHandlers();

  // 注册跨窗口通信 IPC handler
  ipcMain.handle("window-broadcast", (_event, event: string, data?: unknown) => {
    const sender = BrowserWindow.fromWebContents(_event.sender);
    // 广播时排除发送者自己（按窗口实例反查注册名，覆盖 main/login/worker 全部窗口）
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

  // ── WorkerWindow 开关 IPC ──
  // 精简构建（CHECKIN_LITE=1）不含 WorkerWindow：入口已隐藏，打开请求直接忽略
  ipcMain.on("worker-window-open", () => {
    if (__CHECKIN_LITE__) return;
    createWorkerWindow();
  });

  // ── 窗口控制 IPC（WindowHeader 的最小化/最大化/关闭按钮） ──
  // 约定：payload 是动作字符串本身（"minimize" | "maximize-toggle" | "close"）。
  // close 走 win.close()：由各窗口自己的 close 语义决定行为
  // （主窗口隐藏到托盘、worker/login 直接关闭）
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
      allowAndShowMainWindow();
    }
  });

  createLoginWindow(cachedUser);
  ensureMainWindow();

  // 应用级 DevTools 快捷键：即使没有窗口焦点（例如无边框登录窗）也能唤出调试窗口。
  // before-input-event 处理有焦点时的按键，globalShortcut 作为兜底。
  if (IS_DEV) {
    const toggleFocused = () => {
      const focused = BrowserWindow.getFocusedWindow();
      toggleDevTools(focused ?? windowManager.get("main") ?? windowManager.get("login"));
    };
    globalShortcut.register("CommandOrControl+Shift+I", toggleFocused);
    globalShortcut.register("F12", toggleFocused);
    console.log("[main] 调试快捷键已注册：Ctrl+Shift+I / F12 切换 DevTools");
  }

  // 系统托盘图标，点击可重新显示窗口
  tray = new Tray(ICON_PATH);
  tray.setToolTip("CheckIn");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示窗口", click: () => showMainWindow() },
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
    const mainWin = windowManager.get("main");
    if (mainWin?.isVisible()) {
      mainWin.hide();
    } else {
      showMainWindow();
    }
  });
  tray.on("right-click", () => {
    tray?.popUpContextMenu();
  });

  app.on("activate", () => {
    if (!windowManager.has("main") && !windowManager.has("login")) {
      createLoginWindow(getCachedUser());
    }
    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  stopActivityPolling();
  // 编辑器会话随应用退出正常结束（worker closed 未触发时兜底）
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
