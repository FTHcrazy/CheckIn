/**
 * 关闭守卫通道（渲染层 ↔ 主进程，见 `electron/close-guard.ts`）
 *
 * 行囊的编辑只落内存 + 草稿，「写库」是显式动作。窗口被销毁 / 应用退出时，
 * 渲染层的 cleanup 不保证跑完 —— 所以退出前由主进程回问一句，把
 * 「保存并退出 / 丢弃 / 取消」的机会交给作者（PRD REQ-043）。
 *
 * 这一层单独存在的理由：它是**窗口级**契约（谁开的守卫、谁答复），
 * 不是 novel-pack 的数据通道；`pack-service.ts` 只管数据，不该混进退出流程。
 * 未来把行囊迁到独立窗口时，这份契约随模块一起搬，调用方零改动。
 */
import type { PackGuardReason } from "../pack-config";

/** 主进程询问关闭 + 渲染层答复用的频道名（与主进程侧一一对应） */
const REQUEST_EVENT = "window-close-request";

/**
 * 武装 / 解除武装本窗口。
 *
 * **只在「有未保存改动」时打开**：常态退出是零往返的，不能因为一个守护
 * 让每次关窗都等渲染层回话；也让渲染层意外无响应时不影响正常退出。
 */
export function setCloseGuardEnabled(enabled: boolean): void {
  window.electronAPI?.windowAPI?.setCloseGuard(enabled);
}

/** 答复主进程：true = 放行（可以关闭 / 退出） */
export function respondCloseRequest(allow: boolean): void {
  window.electronAPI?.windowAPI?.respondClose(allow);
}

/** 主进程可请求的原因集是闭集：不在其中一律按「退出应用」兜底，别把裸字符串透进 UI */
const REASONS: PackGuardReason[] = ["退出应用", "关闭窗口"];

/**
 * 订阅主进程的关闭询问，返回取消订阅函数。
 *
 * 通道缺失时（浏览器 / 测试环境）返回空操作 —— 守卫是增强，不是必需路径，
 * 缺了它也要能正常渲染。
 */
export function onCloseRequest(handler: (reason: PackGuardReason) => void): () => void {
  const api = window.electronAPI?.windowAPI;
  if (!api?.on || !api?.off) return () => {};

  const listener = (...args: unknown[]): void => {
    const first = args[0];
    const raw =
      first && typeof first === "object" && "reason" in first
        ? String((first as { reason: unknown }).reason)
        : "";
    const matched = REASONS.find((reason) => reason === raw);
    handler(matched ?? "退出应用");
  };

  api.on(REQUEST_EVENT, listener);
  return () => api.off(REQUEST_EVENT, listener);
}
