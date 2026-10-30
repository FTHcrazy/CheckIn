/**
 * 跨窗口导航频道（UI-03）。
 *
 * 场景：行囊窗口（独立 PackWindow）的空态引导里「去设定中心创建等级体系」需要
 * 把用户带到**小说窗口的设定中心**并定位到等级分类。行囊窗口自己打不开设定中心
 * ——它是 NovelWindow 的组件。
 *
 * 与 `pack-*` 事件的区别（为什么单独一个模块而不是塞进 pack-config）：
 * - `pack-*` 系列是**数据变更通知**（改了哪一格，两边各自刷新）；
 * - 本频道是**导航意图**（请另一个窗口打开某个面板），负载里没有可写数据，
 *   接收方也不回写任何东西。语义不同，硬凑一起会让「事件」这个词失焦。
 *
 * 投递路径沿用既有范式（与 pack-window-open 同款）：
 * 渲染层 `send("novel-open-setting-center", payload)` → 主进程 focus / 拉起
 * NovelWindow 并把 payload 原样 broadcast 回来 → NovelWindow 侧的订阅消费。
 *
 * ⚠️ 主进程只负责「把窗口弄到前面并转发」，**不做分类定位** —— 定位要读
 * 作品数据（哪个分类是等级序列），那是渲染层的知识。分开后主进程不必懂 novel 域。
 */

/** IPC 频道名（渲染层 send / preload 白名单 / main.ts 监听三处共用） */
export const NOVEL_OPEN_SETTING_CENTER_CHANNEL = "novel-open-setting-center";

/** 请求负载 */
export interface OpenSettingCenterRequest {
  /** 目标作品（接收方据此过滤别的书；行囊窗口可能开的是另一本） */
  workId: string;
  /**
   * 要定位到的分类 id。
   *
   * `null` = 不指定，由接收方落在设定中心默认态（通常是第一类）；
   * 收到但该书不存在该分类时同样回落默认态，不报错 —— 导航失败不该
   * 把作者卡在错误上。
   */
  categoryId: string | null;
}

/**
 * 发起「打开设定中心」请求（行囊窗口侧调用）。
 *
 * 返回是否成功**发出** IPC（不等待对方真的打开）：当前实现是 fire-and-forget
 * 的 `send`，没有回执。调用方据此只知道「请求已发出」，故 UI 上不据此
 * 宣告成功 —— 按钮点击后立刻收起 loading，由接收窗口是否浮起来回答成败。
 */
export function requestOpenSettingCenter(workId: string, categoryId: string | null): void {
  if (!workId) return;
  const payload: OpenSettingCenterRequest = { workId, categoryId };
  window.electronAPI?.send(NOVEL_OPEN_SETTING_CENTER_CHANNEL, payload);
}

/**
 * 解析导航负载（接收方用）。
 *
 * 与 `readEventDetail` 同一套归一化理由：同窗口路径收到 `CustomEvent`（负载在
 * `.detail`），跨窗口路径收到裸对象。这里做一次形状校验，脏负载一律返回 null
 * （宁可不开面板，也不要打开一个 workId 是 undefined 的错书设定中心）。
 */
export function parseOpenSettingCenterRequest(args: unknown[]): OpenSettingCenterRequest | null {
  const first = args[0];
  const detail =
    typeof Event !== "undefined" && first instanceof Event
      ? (first as CustomEvent).detail
      : first;
  if (!detail || typeof detail !== "object") return null;
  const record = detail as { workId?: unknown; categoryId?: unknown };
  if (typeof record.workId !== "string" || !record.workId) return null;
  const categoryId =
    typeof record.categoryId === "string" && record.categoryId ? record.categoryId : null;
  return { workId: record.workId, categoryId };
}
