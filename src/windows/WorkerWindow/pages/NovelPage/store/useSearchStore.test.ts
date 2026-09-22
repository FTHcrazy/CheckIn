import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSearchRunner, useSearchStore } from "./useSearchStore";
import type { SearchHit } from "../types";

/** 构造一条命中（只关心 id，能区分结果来源即可） */
function hit(id: string): SearchHit {
  return {
    id,
    chapterId: id,
    chapterTitle: `第${id}章`,
    count: 1,
    snippet: "片段",
  };
}

const state = () => useSearchStore.getState();

describe("useSearchStore（全书检索状态）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state().clear();
    state().setScope("book");
    registerSearchRunner(null);
  });

  afterEach(() => {
    registerSearchRunner(null);
    state().clear();
    vi.useRealTimers();
  });

  it("输入后防抖 300ms 才检索，结果回来后写入 hits 与最近搜索", async () => {
    registerSearchRunner(async () => [hit("a"), hit("b")]);

    state().setKeyword("灵潮");
    expect(state().loading).toBe(true);

    await vi.advanceTimersByTimeAsync(299);
    expect(state().hits).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2);
    expect(state().hits.map((h) => h.id)).toEqual(["a", "b"]);
    expect(state().loading).toBe(false);
    expect(state().recent).toEqual(["灵潮"]);
  });

  it("关键词被改写后，先前的过期响应不再写回结果", async () => {
    const pending: { resolve: ((value: SearchHit[]) => void) | null } = {
      resolve: null,
    };
    registerSearchRunner((keyword) =>
      keyword === "甲"
        ? new Promise<SearchHit[]>((resolve) => {
            pending.resolve = resolve;
          })
        : Promise.resolve([hit("乙")]),
    );

    state().setKeyword("甲");
    await vi.advanceTimersByTimeAsync(300);

    state().setKeyword("乙"); // 改写关键词 → 旧请求作废
    await vi.advanceTimersByTimeAsync(300);
    expect(state().hits.map((h) => h.id)).toEqual(["乙"]);

    pending.resolve?.([hit("过期")]);
    await Promise.resolve();

    expect(state().hits.map((h) => h.id)).toEqual(["乙"]);
    expect(state().loading).toBe(false);
  });

  it("关键词不变时切作用域不重查，结果复用缓存", async () => {
    let calls = 0;
    registerSearchRunner(async () => {
      calls += 1;
      return [hit("a")];
    });

    state().setKeyword("灵潮");
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toBe(1);

    state().setScope("chapter");
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toBe(1);
    expect(state().hits).toHaveLength(1);

    state().setScope("entity");
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toBe(1);
    expect(state().loading).toBe(false);

    state().setScope("book");
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toBe(1);
  });

  it("要素名作用域不发起正文检索", async () => {
    let calls = 0;
    registerSearchRunner(async () => {
      calls += 1;
      return [hit("a")];
    });

    state().setScope("entity");
    state().setKeyword("苏晚");
    await vi.advanceTimersByTimeAsync(600);

    expect(calls).toBe(0);
    expect(state().loading).toBe(false);
    expect(state().hits).toHaveLength(0);
  });

  it("清空关键词会清掉结果并作废在途请求", async () => {
    const pending: { resolve: ((value: SearchHit[]) => void) | null } = {
      resolve: null,
    };
    registerSearchRunner(
      () =>
        new Promise<SearchHit[]>((resolve) => {
          pending.resolve = resolve;
        }),
    );

    state().setKeyword("灵潮");
    await vi.advanceTimersByTimeAsync(300);
    state().clear();
    pending.resolve?.([hit("迟到")]);
    await Promise.resolve();

    expect(state().keyword).toBe("");
    expect(state().hits).toHaveLength(0);
    expect(state().loading).toBe(false);

    // 清空后再输同一关键词要能重新检索（缓存已失效）
    registerSearchRunner(async () => [hit("再来")]);
    state().setKeyword("灵潮");
    await vi.advanceTimersByTimeAsync(300);
    expect(state().hits.map((h) => h.id)).toEqual(["再来"]);
  });
});
