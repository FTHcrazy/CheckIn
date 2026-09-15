import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  Tray,
  Menu,
  shell,
  dialog,
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

// 处理打包后的路径
// __dirname 在 CJS 输出中可用 (vite-plugin-electron 默认输出 CJS)
const DIST_ELECTRON = __dirname;
const DIST = path.join(DIST_ELECTRON, "../dist");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
// 渲染层窗口入口清单，与 vite.config.ts 的 rollupOptions.input 对应
const RENDERER_ENTRIES = {
  base: "src/windows/BaseWindow/index.html",
  login: "src/windows/LoginWindow/index.html",
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
    webPreferences: {
      preload: path.join(DIST_ELECTRON, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
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

  win.webContents.once("did-finish-load", () => {
    console.log(`[main] 页面加载完成: ${Date.now() - t0}ms`);
    isMainWindowReady = true;
    if (canShowMainWindow) {
      showMainWindow();
    }
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}/${RENDERER_ENTRIES.base}`);
    win.webContents.openDevTools();
  } else {
    win.loadURL(`app://./${RENDERER_ENTRIES.base}`);
  }

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
    titleBarStyle: "hiddenInset",
    titleBarOverlay: false,
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(DIST_ELECTRON, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
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

  // 注册到窗口管理池（自动处理 closed 事件清理）
  windowManager.register("login", loginWin);

  loginWin.loadURL(getLoginWindowUrl(user?.email));
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
    const senderName = sender === windowManager.get("main") ? "main" : sender === windowManager.get("login") ? "login" : undefined;
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
