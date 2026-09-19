/**
 * 认证 Cookie 播种：写入 Electron session cookie jar
 *
 * 背景：`Cookie` 是浏览器的 forbidden request header，渲染进程 fetch 无法手动设置；
 * Electron 的 session API 又只能在主进程调用。因此由渲染进程在首次请求前，
 * 通过一次性 IPC 把 Cookie 写入 session jar，之后请求带
 * `credentials: "include"` 即可自动携带 —— 主进程不参与后续任何请求。
 */

type SetCookieFn = (url: string, cookie: string) => Promise<boolean>;

/** 已播种的 cookie 集合，避免每个窗口重复 IPC */
const seeded = new Set<string>();

/**
 * 确保 Cookie 已写入 session jar（幂等，失败不阻断业务）。
 */
export async function ensureSessionCookie(
  url: string,
  cookie: string,
): Promise<void> {
  const key = `${url}::${cookie}`;
  if (seeded.has(key)) return;

  const api = (
    globalThis as {
      electronAPI?: { httpSession?: { setCookie?: SetCookieFn } };
    }
  ).electronAPI;

  // 非 Electron 环境（单测 / 纯浏览器预览）直接跳过
  if (typeof api?.httpSession?.setCookie !== "function") return;

  try {
    await api.httpSession.setCookie(url, cookie);
    seeded.add(key);
  } catch {
    // 播种失败不阻断：请求照常发出，未认证时服务端会返回 401
  }
}
