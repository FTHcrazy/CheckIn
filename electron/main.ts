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
  dbAll,
  dbGet,
  dbRun,
  dbExec,
  getAuthDb,
  getUserDataDir,
  switchUserDb,
} from "./db";
import { startActivityPolling, stopActivityPolling } from "./activitiesTask";

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

function createWindow() {
  const t0 = Date.now();
  isMainWindowReady = false;

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
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

  win.webContents.once("did-finish-load", () => {
    console.log(`[main] 页面加载完成: ${Date.now() - t0}ms`);
    isMainWindowReady = true;
    if (canShowMainWindow) {
      showMainWindow();
    }
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadURL(`app://./index.html`);
  }

  return win;
}

let isQuitting = false;
let mainWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;
let canShowMainWindow = false;
let isMainWindowReady = false;
let hasStartedActivityPolling = false;
const LOGIN_WINDOW_MIN_DISPLAY_MS = 3000;
let loginWindowVisibleAt: number | null = null;
let loginWindowHasShown = false;

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

function ensureMainWindow() {
  if (!mainWindow) {
    mainWindow = createWindow();
  }
  return mainWindow;
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
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.close();
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
    if (loginWindow?.isMinimized()) loginWindow.restore();
    loginWindow?.show();
    loginWindow?.focus();
    return;
  }

  if (!mainWindow || !isMainWindowReady) return;

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();

  if (!hasStartedActivityPolling) {
    hasStartedActivityPolling = true;
    startActivityPolling(mainWindow);
  }
}

function createLoginWindow(user?: UserCache | null) {
  loginWindow = new BrowserWindow({
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

  loginWindow.removeMenu();
  loginWindow.webContents.once("did-finish-load", () => {
    const currentLoginWindow = loginWindow;
    if (currentLoginWindow && !currentLoginWindow.isDestroyed()) {
      loginWindowHasShown = true;
      loginWindowVisibleAt = Date.now();
      currentLoginWindow.show();
      currentLoginWindow.focus();
    }
  });
  loginWindow.on("closed", () => {
    loginWindow = null;
  });

  loginWindow.loadURL(getLoginWindowUrl(user?.email));
}

function getLoginWindowUrl(email?: string) {
  const params = new URLSearchParams();
  if (email) {
    params.set("email", email);
  }

  const query = params.toString();
  const suffix = query ? `?${query}` : "";

  if (VITE_DEV_SERVER_URL) {
    return `${VITE_DEV_SERVER_URL}/login.html${suffix}`;
  }

  return `app://./login.html${suffix}`;
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

  // 注册数据库 IPC handlers
  ipcMain.handle("db-all", (_event, sql: string, params?: unknown[]) =>
    dbAll(sql, params),
  );
  ipcMain.handle("db-get", (_event, sql: string, params?: unknown[]) =>
    dbGet(sql, params),
  );
  ipcMain.handle("db-run", (_event, sql: string, params?: unknown[]) =>
    dbRun(sql, params),
  );
  ipcMain.handle("db-exec", (_event, sql: string) => {
    dbExec(sql);
    return true;
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

  ipcMain.on("toMain", (_event, data: unknown) => {
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
  const tray = new Tray(ICON_PATH);
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
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      showMainWindow();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createLoginWindow(getCachedUser());
    }
    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopActivityPolling();
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
