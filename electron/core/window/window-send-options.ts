/**
 * `window-send-to` 的选项 —— 跨进程契约的**单一事实源**。
 *
 * 为什么要单独一个模块，而不是两边各写一遍 `value.create === true`：
 * 这条通道的参数在 1.4x 之后扩过一次（第 4 参 `raise` 之外又加了 `create` /
 * `queue`），两边一旦对不齐，坏法**极其安静** —— 主进程只按「第 4 参」读选项，
 * 渲染层却把 `{create:true}` 塞在第 5 个位置参数上，于是 `create` 从来没生效过：
 * 窗口没开时点「在主窗口打开资料卡」既不创建也不入队，只回来一个
 * `delivered:false`，用户看到的是一句「主窗口没能打开」。类型检查也帮不上忙，
 * 因为两边各自写的都是合法签名。
 *
 * 所以这里把「怎么把调用方给的东西读成三个布尔」抽成纯函数，主进程读、preload 写、
 * 单测直接钉住两边互逆 —— 位置参数多传一个、少传一个都会被用例抓出来。
 *
 * 本模块**不 import electron**：`electron/` 下的测试只在 jsdom 里跑纯函数。
 */

/** 调用方可以声明的选项（`raise` 也允许作为旧的布尔第 4 参单独传） */
export interface WindowSendOptions {
  /** 目标窗口在时抬到最前 */
  raise?: boolean;
  /** 目标窗口不在时先创建（只认白名单里的窗口） */
  create?: boolean;
  /** 目标窗口不在时入队，等它起来后由 preload 补投 */
  queue?: boolean;
}

/** 读完之后三个开关一定都有确定值，主进程不必再判 `undefined` */
export interface ResolvedWindowSendOptions {
  raise: boolean;
  create: boolean;
  queue: boolean;
}

/** 把一个参数源的选项并进结果（布尔 = 旧签名的 `raise`） */
function mergeOne(raw: unknown, into: ResolvedWindowSendOptions): void {
  if (typeof raw === "boolean") {
    // 旧签名 `sendTo(target, event, data, true)`：布尔位就是 raise，不能当成
    // 「没有任何选项」—— 否则调用方以为抬了窗口，实际什么也没发生
    if (raw) into.raise = true;
    return;
  }
  if (!raw || typeof raw !== "object") return;
  const value = raw as Record<string, unknown>;
  if (value.raise === true) into.raise = true;
  if (value.create === true) into.create = true;
  if (value.queue === true) into.queue = true;
}

/**
 * 把任意形状的入参读成三个开关。
 *
 * 接受**多个**参数源并按顺序合并，是为了让「新 preload + 旧主进程参数形状」
 * 与「旧 preload + 新主进程」两种错位都不至于全盘失效：位参怎么摆都能读到
 * `create` / `queue`，只有两边都写成布尔时才只剩 `raise`。
 */
export function readWindowSendOptions(...sources: unknown[]): ResolvedWindowSendOptions {
  const resolved: ResolvedWindowSendOptions = { raise: false, create: false, queue: false };
  for (const source of sources) mergeOne(source, resolved);
  return resolved;
}

/**
 * preload 侧：把「第 4 参布尔 raise + 第 5 参 options」压成**一个**对象再进 IPC。
 *
 * 主进程只该有「一个选项参数」这个概念，位置参数多一个就等于给下一次改动
 * 埋一颗雷（本次就是这么坏的）。typo 级别的一致性由单测
 * `window-send-options.test.ts` 的互逆用例保证。
 */
export function buildWindowSendOptions(
  raise?: boolean,
  options?: WindowSendOptions,
): WindowSendOptions {
  return {
    ...(options ?? {}),
    ...(typeof raise === "boolean" ? { raise } : {}),
  };
}
