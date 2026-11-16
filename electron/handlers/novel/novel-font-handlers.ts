/**
 * 正文字体管理 IPC handlers（novel 域，跨用户共享的应用资源）
 *
 * 字体是「应用资源」而非「用户数据」：与具体账号无关，下载一次所有用户
 * 都能用，故放 `app.getPath('userData')/fonts/`（应用级目录），不走
 * `getUserDataDir(email)` 的用户隔离。
 *
 * 三条通道：
 * - `novel-font-download`：静默下载字体到 fonts/（font-face 挂载用）
 * - `novel-font-list`：列出已下载字体（family + 文件名 + 路径）
 * - `novel-font-delete`：删除某个已下载字体
 *
 * 只落文件、不装系统字体（用户选择「应用内加载」路线）。
 * 渲染进程用 file:// 协议经 @font-face 挂载这些文件。
 */
import { app, ipcMain, net, protocol, session } from "electron";
import fs from "fs";
import path from "path";

export interface NovelFontEntry {
  /** 字体 family（@font-face 的 font-family 值，与下载时一致） */
  family: string;
  /** 文件名（含扩展名，仅 basename，不暴露完整路径） */
  fileName: string;
  /** 文件大小（字节） */
  size: number;
  /** file:// URL，渲染层 @font-face 挂载用 */
  fileUrl: string;
}

/** 字体目录（应用级，跨用户共享） */
export function getFontsDir(): string {
  return path.join(app.getPath("userData"), "fonts");
}

/**
 * 字体文件 URL：专用 novel-font:// 协议（见 registerNovelFontProtocol）。
 *
 * ⚠️ 不能用 file://：生产渲染层跑在 app:// 自定义协议上，从 app:// 页面
 * 加载 file:// 子资源会被 webSecurity 拦截（Not allowed to load local
 * resource）→ @font-face 加载失败 → 所有本地字体静默回退系统字体，
 * 表现为「应用任何字体正文都不变」。
 */
export function fontFileUrl(fileName: string): string {
  return `novel-font://local/${encodeURIComponent(fileName)}`;
}

/** 字体文件 MIME（@font-face src format 匹配用） */
function fontMime(fileName: string): string {
  if (/\.woff2$/i.test(fileName)) return "font/woff2";
  if (/\.woff$/i.test(fileName)) return "font/woff";
  if (/\.ttf$/i.test(fileName)) return "font/ttf";
  return "font/otf";
}

function ensureFontsDir(): string {
  const dir = getFontsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 合法字体扩展名白名单 */
const FONT_EXT_RE = /\.(ttf|otf|woff|woff2)$/i;

/** webRequest CORS 补丁是否已挂（防热重载重复注册） */
let corsPatched = false;

/** family 只允许字母/数字/空格/连字符/中文，防止路径穿越与非法字符 */
function sanitizeFamily(family: string): string {
  return family.replace(/[^a-zA-Z0-9\u4e00-\u9fa5 _-]/g, "").slice(0, 64);
}

/**
 * 下载字体到 fonts/ 目录。
 *
 * @param url 字体直链（http/https）
 * @param family 字体 family 名（作为文件名基础，供 @font-face 引用）
 * @returns 成功返回字体条目；失败返回 { ok: false, error } 一句话错误
 *
 * 安全性：文件名由 sanitizeFamily 白名单化后拼接扩展名，绝不使用 URL 里的
 * 文件名（防 `../` 穿越）；下载走主进程 net.fetch（Chromium 网络栈，自动
 * 跟随系统代理——Node 原生 fetch 不走代理，直连 CDN 在代理环境下直接
 * "fetch failed"；也不暴露渲染层 CORS）。60s 超时防下载悬挂。
 */
async function downloadFont(
  url: string,
  family: string,
): Promise<{ ok: true; entry: NovelFontEntry } | { ok: false; error: string }> {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "字体下载地址无效" };
  }
  const cleanFamily = sanitizeFamily(family);
  if (!cleanFamily) return { ok: false, error: "字体名称无效" };

  // 扩展名只从 URL 推导，且必须在白名单内；缺失时默认 .ttf
  const urlPath = url.split(/[?#]/)[0];
  const extMatch = urlPath.match(FONT_EXT_RE);
  const ext = extMatch ? extMatch[0].toLowerCase() : ".ttf";

  try {
    const response = await net.fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "CheckIn" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      return { ok: false, error: `下载失败（HTTP ${response.status}）` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) return { ok: false, error: "下载内容为空" };

    const dir = ensureFontsDir();
    const fileName = `${cleanFamily}${ext}`;
    const target = path.join(dir, fileName);
    fs.writeFileSync(target, buffer);

    return {
      ok: true,
      entry: {
        family: cleanFamily,
        fileName,
        size: buffer.length,
        fileUrl: fontFileUrl(fileName),
      },
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    let friendly = "下载失败，请稍后重试";
    if (/timed?\s?out|timeout/i.test(raw)) {
      friendly = "下载超时（网络较慢或 CDN 不可达），请重试";
    } else if (
      /fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ERR_/i.test(raw)
    ) {
      friendly = "网络连接失败，请检查网络或系统代理设置";
    }
    return { ok: false, error: friendly };
  }
}

/** 列出 fonts/ 目录下所有已下载字体（按文件名升序） */
function listFonts(): NovelFontEntry[] {
  const dir = getFontsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => FONT_EXT_RE.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      // family = 去扩展名的文件名（下载时用 sanitizeFamily 生成，天然安全）
      const family = name.replace(FONT_EXT_RE, "");
      return {
        family,
        fileName: name,
        size: stat.size,
        fileUrl: fontFileUrl(name),
      };
    })
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/** 删除指定字体（按文件名，仅 basename 白名单，防路径穿越） */
function deleteFont(fileName: string): boolean {
  if (typeof fileName !== "string" || !FONT_EXT_RE.test(fileName)) return false;
  const base = path.basename(fileName);
  if (base !== fileName) return false;
  const target = path.join(getFontsDir(), base);
  if (!fs.existsSync(target)) return false;
  fs.unlinkSync(target);
  return true;
}

/**
 * 注册 novel-font:// 协议处理器：novel-font://local/<fileName> → fonts/ 目录。
 *
 * 渲染层 @font-face 经此加载字体文件（scheme 已在 main.ts
 * registerSchemesAsPrivileged 里声明 secure + supportFetchAPI）。
 * 文件名走 basename + 扩展名白名单双重校验，防路径穿越。
 */
export function registerNovelFontProtocol(): void {
  protocol.handle("novel-font", async (request) => {
    const fileName = decodeURIComponent(
      request.url.replace(/^novel-font:\/\/local\//, "").split("?")[0],
    );
    const base = path.basename(fileName);
    if (
      !FONT_EXT_RE.test(base) ||
      base !== fileName ||
      fileName.includes("/")
    ) {
      return new Response("Invalid font name", { status: 400 });
    }
    const target = path.join(getFontsDir(), base);
    if (!fs.existsSync(target)) {
      return new Response("Font not found", { status: 404 });
    }
    const content = await fs.promises.readFile(target);
    return new Response(content, {
      headers: {
        "Content-Type": fontMime(base),
        "Access-Control-Allow-Origin": "*",
      },
    });
  });

  // 开发模式（http://127.0.0.1:5173）渲染层跨协议加载 novel-font:// 会被
  // Chromium 拦（自定义 scheme 不在跨源白名单）。给字体响应补 CORS 头，
  // 让 http 源也能读取。协议 handler 里的 ACAO 头对协议级加载不生效，需在
  // 网络栈层额外注入。仅在打包/开发各注册一次，防止热重载重复挂载。
  const ses = session.defaultSession;
  if (!corsPatched) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      if (details.url.startsWith("novel-font://")) {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Access-Control-Allow-Origin": ["*"],
          },
        });
      } else {
        callback({});
      }
    });
    corsPatched = true;
  }
}

export function registerNovelFontHandlers(): void {
  ipcMain.handle(
    "novel-font-download",
    async (
      _event,
      payload: { url: string; family: string } | undefined,
    ): Promise<
      { ok: true; entry: NovelFontEntry } | { ok: false; error: string }
    > => {
      const url = payload?.url;
      const family = payload?.family;
      if (typeof url !== "string" || typeof family !== "string") {
        return { ok: false, error: "参数无效" };
      }
      return downloadFont(url, family);
    },
  );

  ipcMain.handle("novel-font-list", async (): Promise<NovelFontEntry[]> => {
    return listFonts();
  });

  ipcMain.handle(
    "novel-font-delete",
    async (_event, fileName: string): Promise<boolean> => {
      return deleteFont(fileName);
    },
  );
}
