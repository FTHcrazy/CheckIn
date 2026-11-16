/**
 * 渲染进程网络会话配置（主进程一次性 setup）
 *
 * ## 为什么还要主进程参与？
 * 请求本身已完全下沉到渲染进程，主进程**不再代理任何 HTTP**。
 * 但有两件事只有主进程能做（session 级 API 不暴露给渲染进程）：
 *
 * 1. **CORS 响应头注入**：渲染进程直连第三方接口会被同源策略拦截。
 *    这里在响应阶段补 `Access-Control-Allow-Origin` 等头，属于一次性注册，
 *    之后每个请求只是改几个响应头，不再搬运响应体。
 * 2. **Cookie 写入 jar**：`Cookie` 是浏览器 forbidden header，fetch 无法手动设置；
 *    渲染进程通过一次性 IPC 把凭据写进 session jar，之后用
 *    `credentials: "include"` 自动携带。
 *
 * 两者都在启动时或首次请求前完成，主进程不参与后续请求链路，
 * 因此多窗口高频请求不会再拖累主进程。
 */

import { ipcMain, session } from "electron";

/** 请求 id → 该请求的 Origin，用于响应阶段精确回显（凭证请求不能用 "*"） */
const originById = new Map<number, string>();

const ALLOW_ORIGIN = "Access-Control-Allow-Origin";
const ALLOW_CREDENTIALS = "Access-Control-Allow-Credentials";
const ALLOW_HEADERS = "Access-Control-Allow-Headers";
const ALLOW_METHODS = "Access-Control-Allow-Methods";

/** 请求头大小写不敏感读取 */
function readHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/**
 * 注册 session 级 CORS 放行。
 * 仅在响应头层面放行，不改动请求体与响应体。
 */
export function setupRendererHttpSession(): void {
  const ses = session.defaultSession;

  // 记录 Origin：带凭证的请求回显 Origin 后必须配 Allow-Credentials，
  // 而 "*" 与凭证互斥，故不能用通配符统一处理。
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const origin = readHeader(details.requestHeaders, "Origin");
    if (origin) originById.set(details.id, origin);
    callback({ requestHeaders: details.requestHeaders });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const origin = originById.get(details.id);
    originById.delete(details.id);

    // 丢弃服务端原有的 CORS 头，避免与注入值重复导致浏览器报错
    const responseHeaders: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(details.responseHeaders ?? {})) {
      if (key.toLowerCase().startsWith("access-control-")) continue;
      responseHeaders[key] = Array.isArray(value) ? value : [String(value)];
    }

    responseHeaders[ALLOW_ORIGIN] = [origin ?? "*"];
    if (origin) responseHeaders[ALLOW_CREDENTIALS] = ["true"];
    responseHeaders[ALLOW_HEADERS] = ["Content-Type, X-Requested-With"];
    responseHeaders[ALLOW_METHODS] = ["GET, POST, PUT, DELETE, OPTIONS"];

    callback({ responseHeaders });
  });

  // 请求异常时清理，避免 Map 残留
  ses.webRequest.onErrorOccurred((details) => {
    originById.delete(details.id);
  });
}

/**
 * 注册 Cookie 播种通道（每个窗口首次请求前调用一次）。
 */
export function registerHttpSessionHandlers(): void {
  ipcMain.handle(
    "http-session-set-cookie",
    async (
      _event,
      payload: { url: string; cookie: string } | undefined,
    ): Promise<boolean> => {
      const url = payload?.url;
      const cookie = payload?.cookie;
      if (typeof url !== "string" || typeof cookie !== "string") return false;

      const ses = session.defaultSession;
      const pairs = cookie
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean);

      await Promise.all(
        pairs.map((pair) => {
          const eq = pair.indexOf("=");
          if (eq <= 0) return Promise.resolve();
          const name = pair.slice(0, eq).trim();
          const value = pair.slice(eq + 1).trim();
          return ses.cookies.set({
            url,
            name,
            value,
            // 跨站请求带凭证需要 SameSite=None；https 下同时标记 Secure
            sameSite: "no_restriction",
            secure: url.startsWith("https://"),
          });
        }),
      );

      return true;
    },
  );
}
