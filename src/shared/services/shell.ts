/**
 * 外部链接打开（渲染进程侧封装）。
 *
 * 渲染层永远不自己导航：URL 交给主进程校验协议后由系统浏览器打开。
 * 非 Electron 环境（jsdom 测试、浏览器预览）没有这个 API，返回 false，
 * 调用方据此提示「复制链接」而不是静默失败。
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const shellApi = window.electronAPI?.shell;
  if (!shellApi) return false;
  try {
    return await shellApi.openExternal(url);
  } catch {
    return false;
  }
}
