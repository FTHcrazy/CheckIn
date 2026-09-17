import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  Tray,
  Menu,
  shell,
  dialog,
  globalShortcut,
} from "electron";
import path from "path";
import fs from "fs";
import https from "https";
import {
  initDb,
  closeDb,
  getAuthDb,
  getUserDataDir,
  switchUserDb,
} from "./db";
import { startActivityPolling, stopActivityPolling } from "./activitiesTask";
import { windowManager } from "./windowManager";
import { registerActivityHandlers } from "./handlers/activity-handlers";
import { registerTodoHandlers } from "./handlers/todo-handlers";

type UserCache = {
  id: number;
  email: string;
};

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

function ensureUserTable() {
  getAuthDb().exec(`
    CREATE TABLE IF NOT EXISTS user (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
}

function getCachedUser(): UserCache | null {
  const user = getAuthDb().prepare("SELECT id, email FROM user WHERE id = 1 LIMIT 1").get() as
    | UserCache
    | undefined;
  return user?.email ? user : null;
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

function createLoginWindow(user?: UserCache | null) {
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
 * WorkerWindow —— 普通临时工作窗口。
 *
 * 特性：
 * - 标准窗口行为：出现在任务栏、可最小化/最大化/关闭（由通用 WindowHeader 提供）
 * - 不拦截 close 事件，关闭即随实例销毁；重新打开即全新实例
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
    width: 720,
    height: 520,
    minWidth: 420,
    minHeight: 320,
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
  // 初始化本地数据库
  initDb();
  ensureUserTable();
  const cachedUser = getCachedUser();
  if (cachedUser) switchUserDb(cachedUser.email, true);

  let currentUserEmail = cachedUser?.email ?? "";

  // 注册语义化 IPC handlers
  registerActivityHandlers();
  registerTodoHandlers();

  ipcMain.handle("user-get", () => getCachedUser());
  ipcMain.handle("user-login", (_event, email: string) => {
    const normalizedEmail = email.trim();
    getAuthDb()
      .prepare(
        "INSERT INTO user (id, email, updated_at) VALUES (1, ?, datetime('now', 'localtime')) ON CONFLICT(id) DO UPDATE SET email = excluded.email, updated_at = datetime('now', 'localtime')",
      )
      .run(normalizedEmail);
    switchUserDb(normalizedEmail);
    currentUserEmail = normalizedEmail;
    return true;
  });
  ipcMain.handle("user-update", (_event, email: string) => {
    const normalizedEmail = email.trim();
    getAuthDb()
      .prepare("UPDATE user SET email = ?, updated_at = datetime('now', 'localtime') WHERE id = 1")
      .run(normalizedEmail);
    switchUserDb(normalizedEmail);
    currentUserEmail = normalizedEmail;
    return true;
  });

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

  // 注册 HTTP 请求 IPC handler，支持设置 Cookie 等禁止请求头
  ipcMain.handle(
    "http-request",
    async (
      _event,
      options: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      },
    ) => {
      return new Promise((resolve, reject) => {
        const url = new URL(options.url);
        const req = https.request(
          {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: options.method || "GET",
            headers: options.headers || {},
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => {
              try {
                resolve({ status: res.statusCode, data: JSON.parse(data) });
              } catch {
                resolve({ status: res.statusCode, data });
              }
            });
          },
        );
        req.on("error", (err) => reject(err.message));
        if (options.body) req.write(options.body);
        req.end();
      });
    },
  );

  // ── 备忘文件 IPC handlers ──
  const getMemosDir = () => path.join(getUserDataDir(currentUserEmail), "memos");
  const ensureMemosDir = () => {
    const memosDir = getMemosDir();
    if (!fs.existsSync(memosDir)) fs.mkdirSync(memosDir, { recursive: true });
    return memosDir;
  };

  ipcMain.handle("memo-list", () => {
    const memosDir = ensureMemosDir();
    const files = fs.readdirSync(memosDir).filter((f) => f.endsWith(".md"));
    return files
      .map((name) => {
        const stat = fs.statSync(path.join(memosDir, name));
        return { name, updatedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  ipcMain.handle("memo-read", (_event, filename: string) => {
    const safe = path.basename(filename);
    const filePath = path.join(ensureMemosDir(), safe);
    if (!fs.existsSync(filePath)) throw new Error("文件不存在");
    return fs.readFileSync(filePath, "utf-8");
  });

  ipcMain.handle("memo-write", (_event, filename: string, content: string) => {
    const safe = path.basename(filename);
    const filePath = path.join(ensureMemosDir(), safe);
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  });

  ipcMain.handle(
    "memo-rename",
    (_event, oldFilename: string, newFilename: string) => {
      const oldSafe = path.basename(oldFilename);
      const newSafe = path.basename(newFilename);
      const memosDir = ensureMemosDir();
      const oldPath = path.join(memosDir, oldSafe);
      const newPath = path.join(memosDir, newSafe);

      if (!fs.existsSync(oldPath)) throw new Error("文件不存在");
      if (oldSafe !== newSafe && fs.existsSync(newPath)) {
        throw new Error("目标文件已存在");
      }

      fs.renameSync(oldPath, newPath);
      return true;
    },
  );

  ipcMain.handle("memo-delete", (_event, filename: string) => {
    const safe = path.basename(filename);
    const filePath = path.join(ensureMemosDir(), safe);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  });

  ipcMain.handle("memo-open-in-explorer", (_event, filename: string) => {
    const safe = path.basename(filename);
    const filePath = path.join(ensureMemosDir(), safe);
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("memo-import", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">,
      filters: [{ name: "Markdown 文件", extensions: ["md"] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return [];

    const importedFiles: string[] = [];
    for (const sourcePath of result.filePaths) {
      const filename = path.basename(sourcePath);
      const destinationPath = path.join(ensureMemosDir(), filename);
      fs.copyFileSync(sourcePath, destinationPath);
      importedFiles.push(filename);
    }
    return importedFiles;
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
  ipcMain.on("worker-window-open", () => {
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
        currentUserEmail = email;
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
