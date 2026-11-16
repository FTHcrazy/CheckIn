/**
 * 跨窗口消息的「待投递队列」
 *
 * 背景：`window-send-to` 原先只在目标窗口存在时 `webContents.send`，窗口没开就
 * **静默丢消息**。各条链路只好各自造一套兜底：关系图跳主窗口曾经有
 * `relation-entity-open` + `relation-entity-take` 两条专属 IPC，只为回答一个
 * 通用问题——「窗口还没起来，这条消息先存哪」。于是每加一种跳转就要在主进程
 * 多维护一对通道 + 一份 pending 变量。
 *
 * 现在把这件事收到 `window-send-to` 本身：目标窗口不存在就把消息放这儿，
 * 窗口创建后由渲染层（preload）主动 drain 一次，再补投给已经挂上的监听。
 * 主进程因此只需要认识「窗口名」，不再认识「消息类型」。
 *
 * 队列是**有界**的：目标窗口长期不打开发的消息没有保留价值，无限攒只会让
 * 下一次打开突然收到一堆过期跳转。超出上限丢最旧的。
 */
export interface PendingWindowMessage {
  event: string;
  data?: unknown;
}

/** 每个窗口最多攒多少条（够覆盖「连点几次跳转」，又不至于回放一屏旧事件） */
export const MAX_PENDING_PER_WINDOW = 20;

const queues = new Map<string, PendingWindowMessage[]>();

/** 记一条待投递消息（目标窗口当前不存在时调用） */
export function pushPendingMessage(target: string, message: PendingWindowMessage): void {
  const queue = queues.get(target) ?? [];
  queue.push(message);
  if (queue.length > MAX_PENDING_PER_WINDOW) {
    queue.splice(0, queue.length - MAX_PENDING_PER_WINDOW);
  }
  queues.set(target, queue);
}

/**
 * 取走某窗口的全部待投递消息（取走即清）。
 *
 * 取空要返回新数组：调用方可能持有引用，返回内部数组会让后续 push 污染它。
 */
export function takePendingMessages(target: string): PendingWindowMessage[] {
  const queue = queues.get(target);
  if (!queue || queue.length === 0) return [];
  queues.delete(target);
  return [...queue];
}

/** 某窗口攒了几条（日志 / 诊断用） */
export function pendingCount(target: string): number {
  return queues.get(target)?.length ?? 0;
}

/** 仅测试用：清空所有队列，避免用例之间互相污染 */
export function resetPendingMessages(): void {
  queues.clear();
}
