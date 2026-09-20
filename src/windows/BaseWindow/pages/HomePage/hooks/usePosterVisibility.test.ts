import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyNewsPayload } from "@/shared/services/news";
import {
  POSTER_RESET_HOUR,
  __resetPosterStateForTest,
  currentCycleKey,
  usePosterVisibility,
} from "./usePosterVisibility";

vi.mock("@/shared/services/news", () => ({
  fetchDailyNews: vi.fn(),
}));

import { fetchDailyNews } from "@/shared/services/news";

const fetchMock = vi.mocked(fetchDailyNews);

/** 受控探测结果：手动逐个 resolve，模拟网络时序 */
const deferreds: Array<(payload: DailyNewsPayload) => void> = [];

function makePayload(live: boolean): DailyNewsPayload {
  return {
    items: [],
    live,
    quote: null,
    progress: null,
    workday: null,
    lunarText: null,
  };
}

function mockPendingFetch(): void {
  fetchMock.mockImplementation(
    () =>
      new Promise<DailyNewsPayload>((resolve) => {
        deferreds.push(resolve);
      }),
  );
}

beforeEach(() => {
  __resetPosterStateForTest();
  vi.useFakeTimers();
  vi.clearAllMocks(); // 清空 fetchMock 调用历史，各用例计数独立
  mockPendingFetch();
});

afterEach(() => {
  cleanup();
  deferreds.length = 0;
  vi.useRealTimers();
});

describe("currentCycleKey", () => {
  it("9 点前属于昨天的周期，9 点起属于今天", () => {
    vi.setSystemTime(new Date(2026, 8, 20, POSTER_RESET_HOUR - 1, 59));
    expect(currentCycleKey()).toBe("2026-09-19");
    vi.setSystemTime(new Date(2026, 8, 20, POSTER_RESET_HOUR, 0));
    expect(currentCycleKey()).toBe("2026-09-20");
  });
});

describe("usePosterVisibility 展示状态机", () => {
  it("启动后探测成功（live）展示一次", async () => {
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0));
    const { result } = renderHook(() => usePosterVisibility());
    expect(result.current.showPoster).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      deferreds[0](makePayload(true));
    });
    expect(result.current.showPoster).toBe(true);
  });

  it("探测返回非 live（接口失败回退样例）不展示", async () => {
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0));
    const { result } = renderHook(() => usePosterVisibility());
    await act(async () => {
      deferreds[0](makePayload(false));
    });
    expect(result.current.showPoster).toBe(false);
  });

  it("点击后本周期内不再展示（卸载重挂载也不出现、不再重复探测）", async () => {
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0));
    const first = renderHook(() => usePosterVisibility());
    await act(async () => {
      deferreds[0](makePayload(true));
    });
    expect(first.result.current.showPoster).toBe(true);

    act(() => {
      first.result.current.dismissPoster();
    });
    expect(first.result.current.showPoster).toBe(false);
    first.unmount();

    const callsAfterDismiss = fetchMock.mock.calls.length;
    const second = renderHook(() => usePosterVisibility());
    await act(async () => {});
    expect(second.result.current.showPoster).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(callsAfterDismiss);
  });

  it("已展示未点击：卸载重挂载后恢复展示且不再请求", async () => {
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0));
    const first = renderHook(() => usePosterVisibility());
    await act(async () => {
      deferreds[0](makePayload(true));
    });
    expect(first.result.current.showPoster).toBe(true);
    first.unmount();

    const second = renderHook(() => usePosterVisibility());
    await act(async () => {});
    expect(second.result.current.showPoster).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("StrictMode 双挂载：进行中探测去重且重挂载能收到结果", async () => {
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0));
    const first = renderHook(() => usePosterVisibility());
    first.unmount(); // 首挂载回调随 cleanup 判死
    const second = renderHook(() => usePosterVisibility());
    expect(fetchMock).toHaveBeenCalledTimes(1); // 复用进行中探测，未重复请求
    await act(async () => {
      deferreds[0](makePayload(true));
    });
    expect(second.result.current.showPoster).toBe(true); // 结果落地而非石沉大海
  });

  it("隔天 9 点周期翻转：状态重置并重新探测成功后再展示", async () => {
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0));
    const { result } = renderHook(() => usePosterVisibility());
    await act(async () => {
      deferreds[0](makePayload(true));
    });
    expect(result.current.showPoster).toBe(true);
    act(() => {
      result.current.dismissPoster();
    });
    expect(result.current.showPoster).toBe(false);

    // 次日 9 点前：周期未翻转，不重置
    vi.setSystemTime(new Date(2026, 8, 21, 8, 59));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.showPoster).toBe(false);

    // 次日 9 点过：周期翻转 → 先隐藏 → 重新探测 → 成功后再展示
    vi.setSystemTime(new Date(2026, 8, 21, 9, 1));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.showPoster).toBe(false);
    await act(async () => {
      deferreds[1](makePayload(true));
    });
    expect(result.current.showPoster).toBe(true);
  });
});
