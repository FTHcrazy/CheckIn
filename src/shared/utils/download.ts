/**
 * 浏览器侧文件落盘（object URL + `<a download>`）。
 *
 * 放 shared 是因为两个页面都要用（图片压缩的逐张 / 打包下载、色键抠图的 PNG 导出）。
 * 之所以不用主进程弹框保存：这两处产物都是内存里的 Blob，走 IPC 还得先序列化一遍
 * 字节再回来，收益只有「能选目录」，而 Electron 的默认下载行为已经落到「下载」文件夹。
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // 立刻回收会让部分环境的下载中断，推迟一拍（与项目里既有导出一致）
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
