/**
 * 外部链接 IPC handler。
 *
 * 渲染层不允许自己导航（会把整个窗口带走），也不该拿到 shell 权限。
 * 这里只放行 http/https，其余协议（file: / javascript: / app:）一律拒绝 ——
 * 链接当前全部来自静态知识库常量，但校验不依赖「调用方一定可信」这个前提。
 */
import { ipcMain, shell } from "electron";

/** 允许交给系统浏览器打开的协议白名单 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** URL 长度上限：正常文档链接远小于它，超长一律视为异常输入 */
const MAX_URL_LENGTH = 2048;

export function registerShellHandlers(): void {
  ipcMain.handle(
    "shell-open-external",
    async (_event, url: unknown): Promise<boolean> => {
      if (typeof url !== "string" || url.length > MAX_URL_LENGTH) return false;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return false;
      }
      if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
      await shell.openExternal(parsed.toString());
      return true;
    },
  );
}
