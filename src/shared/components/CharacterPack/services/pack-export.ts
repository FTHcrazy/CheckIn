/**
 * 行囊的文本出口（REQ-030 导出 Markdown / REQ-045 草稿 JSON 逃生出口 / REQ-022 量纲 JSON）。
 *
 * 与包内其它 service 一样只吃 `window.electronAPI`、不 import 上层的页面服务 ——
 * 整个模块迁到独立窗口时这一层零改动（PRD §1 的迁移约束）。
 *
 * 「下载」刻意走主进程的原生保存框（`novel-export-file`），而不是渲染层
 * `Blob` + `<a download>`：后者不弹框、不回报路径，作者点了之后既不知道存到哪、
 * 也不知道成没成。扩展名与过滤器名都做成参数，Markdown 与 JSON 共用一条通道。
 */

/** 复制任意文本到剪贴板；非安全上下文 / 无权限时返回 false（调用方据此提示改走下载） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 弹保存框写盘；返回落盘路径，用户取消返回 null */
export async function downloadText(
  defaultName: string,
  text: string,
  ext = "md",
  filterName = "Markdown",
): Promise<string | null> {
  const result = await window.electronAPI!.novel.exportFile(defaultName, text, ext, filterName);
  return result?.path ?? null;
}
