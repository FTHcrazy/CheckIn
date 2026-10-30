/**
 * 双通道事件订阅收口（P3-2）。
 *
 * 行囊域 / 灵感域的跨页事件都是「同窗口 CustomEvent + 跨窗口 broadcast」
 * 两条投递路径（广播刻意排除发送者，所以两边各发一次）。过去每个订阅点
 * 都手写一遍 addEventListener + api.on / removeEventListener + api.off
 * 样板，重复 8 处 —— P1-1 那类「新事件忘了接双通道」的漏接就是这么来的。
 *
 * 本模块只收口**注册与注销**；负载归一化（`readEventDetail`）与 origin
 * 去重是各事件自己的约定，留在 handler 里。放在 `src/shared/novel/`：
 * 这些事件都是 novel 域数据，不依赖 React（hook 里的 effect 直接调用本函数）。
 */

/** 双通道 handler 签名：同窗口收到 CustomEvent，跨窗口收到裸负载（见 readEventDetail） */
export type DualChannelHandler = (...args: unknown[]) => void;

/**
 * 订阅一个双通道事件，返回**注销函数**（effect cleanup 直接 return 它）。
 *
 * electronAPI 缺失（测试 / 非 Electron 环境）时只挂 CustomEvent 通道，
 * 注销同样只摘这一条 —— 与手写样板的行为逐字对齐。
 */
export function subscribeDualChannel(
  event: string,
  handler: DualChannelHandler,
): () => void {
  window.addEventListener(event, handler as EventListener);
  const api = window.electronAPI?.windowAPI;
  api?.on(event, handler);
  return () => {
    window.removeEventListener(event, handler as EventListener);
    api?.off(event, handler);
  };
}
