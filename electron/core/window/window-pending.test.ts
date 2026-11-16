/**
 * 待投递队列（`window-send-to` 的兜底存储）
 *
 * 这三条不变量任何一条破了，表现都是「点了没反应」或「一开窗收到一堆旧跳转」：
 * ① 取走即清（重开窗口不该再弹上次的资料卡）；
 * ② 有界（长期不打开的窗口不能无限攒）；
 * ③ 按窗口名隔离（给 pack 的消息不能被 novel 取走）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PENDING_PER_WINDOW,
  pendingCount,
  pushPendingMessage,
  resetPendingMessages,
  takePendingMessages,
} from "./window-pending";

beforeEach(() => resetPendingMessages());

describe("window-pending", () => {
  it("取走即清：第二次 drain 拿不到旧消息", () => {
    pushPendingMessage("novel", { event: "rel-open-entity", data: { workId: "w1" } });
    expect(takePendingMessages("novel")).toHaveLength(1);
    expect(takePendingMessages("novel")).toEqual([]);
    expect(pendingCount("novel")).toBe(0);
  });

  it("按窗口隔离：给 pack 的消息不会被 novel 取走", () => {
    pushPendingMessage("pack", { event: "pack-window-context", data: { workId: "w1" } });
    expect(takePendingMessages("novel")).toEqual([]);
    expect(takePendingMessages("pack")).toHaveLength(1);
  });

  it("有界：超出上限丢最旧的，保留最近几条", () => {
    for (let index = 0; index < MAX_PENDING_PER_WINDOW + 5; index += 1) {
      pushPendingMessage("novel", { event: "rel-open-entity", data: index });
    }
    const list = takePendingMessages("novel");
    expect(list).toHaveLength(MAX_PENDING_PER_WINDOW);
    // 最旧的 5 条被丢掉，队首是第 5 条
    expect(list[0].data).toBe(5);
    expect(list[list.length - 1].data).toBe(MAX_PENDING_PER_WINDOW + 4);
  });

  it("返回副本：调用方改数组不会污染队列内部状态", () => {
    pushPendingMessage("novel", { event: "x", data: 1 });
    const first = takePendingMessages("novel");
    first.push({ event: "bogus" });
    expect(takePendingMessages("novel")).toEqual([]);
  });
});
