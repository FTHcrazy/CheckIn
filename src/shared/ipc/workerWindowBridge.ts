/**
 * 窗口级 IPC 桥接：为“即关即销”类子窗口提供关闭能力。
 *
 * 子窗口（如 WorkerWindow）本身是 frame:false 的独立窗口，没有系统标题栏，
 * 需要在渲染层放一个关闭按钮。关闭动作必须由主进程执行（destroy），
 * 因此这里暴露一个显式的 close() 方法，由需要的窗口入口调用注册。
 *
 * 仅注册一次，避免模块副作用扩散到其他窗口。
 */

/** 子窗口关闭 IPC 通道名 */
const WORKER_CLOSE_CHANNEL = "worker-window-close";

let registered = false;

/**
 * 注册子窗口关闭桥接，返回关闭函数。
 * 未注册或非 Electron 环境下调用返回的关闭函数会静默失败。
 */
export function registerWorkerWindowBridge(): () => void {
  if (!registered && window.electronAPI) {
    registered = true;
    window.electronAPI.receive(WORKER_CLOSE_CHANNEL, () => {
      // 主进程侧完成后会直接销毁窗口，渲染层无需额外处理
    });
  }

  return () => {
    window.electronAPI?.send(WORKER_CLOSE_CHANNEL, { type: "close" });
  };
}
