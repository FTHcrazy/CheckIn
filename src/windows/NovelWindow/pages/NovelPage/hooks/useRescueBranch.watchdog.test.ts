import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiGenerateStream, aiGenerateStructured, getAiConfig } from "@/shared/ai/ai-client";
import {
  RESCUE_FIRST_SEGMENT_TIMEOUT_MS,
  useRescueBranch,
  type UseRescueBranchOptions,
} from "./useRescueBranch";

/**
 * 卡文救援的**超时看门狗**回归（真机反馈：spark-x2.6 思考流超过旧 45s 首段时限）。
 *
 * 钉的是三条截止线的口径，全部用假计时器驱动真实 watchdog：
 * 1. 思考流（reasoning 帧）持续到达时**不算无进展** —— 旧实现从发起时算死
 *    45s，思考超过 45s 必失败；新口径下思考帧续期 stallDeadline，正文照常落卡；
 * 2. 连接彻底哑掉（readChunk 永不返回）—— 截止判定不能依赖循环自查，
 *    真实计时器必须能 abort 叫醒挂起的 read；
 * 3. 思考流一直来到首段硬上限（180s）→ 中断提示；已出正文后按总时长口径，
 *    超时**保留已落卡的走向**（phase 仍是 streaming，卡片可采纳）。
 */
vi.mock("@/shared/ai/ai-client", () => ({
  aiGenerateStream: vi.fn(),
  aiGenerateStructured: vi.fn(),
  getAiConfig: vi.fn(),
  logAiEvent: vi.fn(),
}));

// 累加器换成「原样透传」：本用例测的是看门狗口径，不是 SSE 切帧
vi.mock("@/shared/ai/ai-stream-parse", () => ({
  createOpenAiSseAccumulator: () => ({ push: (chunk: string) => chunk, flush: () => "" }),
  createOllamaAccumulator: () => ({ push: (chunk: string) => chunk, flush: () => "" }),
}));

function buildOptions(overrides: Partial<UseRescueBranchOptions> = {}): UseRescueBranchOptions {
  return {
    buildSpec: () => ({ system: "你是…", prompt: "请给几条走向" }),
    applyAdopt: vi.fn(async () => [] as import("../utils/rescue").RescueEdit[]),
    applyUndo: vi.fn(async () => {}),
    findStaleEdits: vi.fn(() => [] as import("../utils/rescue").RescueEdit[]),
    confirmStale: vi.fn(async () => true),
    notify: vi.fn(),
    ...overrides,
  };
}

/**
 * 「按脚本定时吐块」的流句柄：script 的 at 毫秒时刻吐出对应 chunk。
 * `hangAfter: true` 时读完脚本就挂起（模拟连接哑掉，只有 abort 能叫醒）；
 * 否则读完返回 null（流正常结束）。abort 立刻让挂起的 read 收到 null
 * （对齐 ai-client 真语义）。
 */
function makeTimedHandle(
  script: Array<{ at: number; chunk: string | null }>,
  hangAfter = false,
): { abort: () => void; done: boolean; readChunk: () => Promise<string | null> } {
  let cursor = 0;
  /** 上一个脚本的绝对时刻：readChunk 串行调用，延迟必须按相对差值排 */
  let lastAt = 0;
  let pendingResolve: ((value: string | null) => void) | null = null;
  const handle = {
    abort: vi.fn(() => {
      handle.done = true;
      // 挂起的 read 立即以 null 结束（ai-client abort 后 readChunk 返回 null）
      pendingResolve?.(null);
      pendingResolve = null;
    }),
    done: false,
    readChunk: (): Promise<string | null> => {
      if (cursor >= script.length) {
        if (hangAfter) {
          return new Promise<string | null>((resolve) => {
            pendingResolve = resolve;
          });
        }
        return Promise.resolve(null);
      }
      const step = script[cursor];
      cursor += 1;
      const delay = Math.max(0, step.at - lastAt);
      lastAt = step.at;
      return new Promise<string | null>((resolve) => {
        pendingResolve = resolve;
        setTimeout(() => {
          pendingResolve = null;
          resolve(step.chunk);
        }, delay);
      });
    },
  };
  return handle;
}

const REASONING_FRAME = "思考帧：用户要求基于《大道争锋》的卡点正文给出走向";
const ONE_BRANCH = '{"title":"当场翻脸","conflict":"对峙","consequence":"名分撕破"}';

/**
 * 逐秒推进假计时器直到谓词满足（上限 maxSeconds）。
 *
 * 为什么不一次 advance 整段：看门狗是 1s 周期计时器，流循环又挂在 await
 * readChunk 上，一次性跨 180s 的冲刷时序和真机逐帧到达对不齐；逐秒步进
 * 与看门狗同拍，每步都在 act 里让 React 状态落地，行为可复现。
 */
async function advanceUntil(check: () => boolean, maxSeconds: number): Promise<void> {
  for (let i = 0; i < maxSeconds; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    if (check()) return;
  }
}

describe("useRescueBranch：超时看门狗口径", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(aiGenerateStream).mockReset();
    vi.mocked(aiGenerateStructured).mockReset();
    vi.mocked(getAiConfig).mockReset();
  });

  it("思考流持续到达超过旧首段时限：不误杀，正文到达后照常落卡到 done", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
    vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai" } as never);
    // 思考帧每 10s 一帧，铺满 100s（远超旧 45s 固定时限）；正文 110s 才出现
    const script: Array<{ at: number; chunk: string | null }> = [];
    for (let t = 10_000; t <= 100_000; t += 10_000) {
      script.push({ at: t, chunk: REASONING_FRAME });
    }
    script.push({ at: 110_000, chunk: ONE_BRANCH });
    script.push({ at: 115_000, chunk: null });
    vi.mocked(aiGenerateStream).mockResolvedValue(makeTimedHandle(script) as never);

    const { result } = renderHook(() => useRescueBranch(buildOptions()));
    act(() => result.current.generate({ style: "default", count: 4 }));
    await advanceUntil(() => result.current.phase === "done", 130);

    expect(result.current.error).toBeNull();
    expect(result.current.phase).toBe("done");
    expect(result.current.segments.map((item) => item.title)).toEqual(["当场翻脸"]);
  });

  it("连接彻底哑掉：真实看门狗 abort 叫醒挂起的 read，按无数据文案中断", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
    vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai" } as never);
    // 第一帧之后再无任何数据，readChunk 永不 resolve（只有 abort 能叫醒）
    vi.mocked(aiGenerateStream).mockResolvedValue(
      makeTimedHandle([{ at: 1_000, chunk: REASONING_FRAME }], true) as never,
    );

    const { result } = renderHook(() => useRescueBranch(buildOptions()));
    act(() => result.current.generate({ style: "default", count: 4 }));
    await advanceUntil(() => result.current.phase === "error", 60);

    expect(result.current.error).toBe("模型连接长时间没有数据，已中断；可换一批或稍后重试");
    expect(result.current.phase).toBe("error");
  });

  it("思考流一直来到首段硬上限（180s）：中断并提示换风格", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
    vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai" } as never);
    // 思考帧每 10s 一帧一直来（stallDeadline 恒被续期），180s 硬上限兜底
    const script: Array<{ at: number; chunk: string | null }> = [];
    for (let t = 10_000; t <= RESCUE_FIRST_SEGMENT_TIMEOUT_MS; t += 10_000) {
      script.push({ at: t, chunk: REASONING_FRAME });
    }
    vi.mocked(aiGenerateStream).mockResolvedValue(makeTimedHandle(script, true) as never);

    const { result } = renderHook(() => useRescueBranch(buildOptions()));
    act(() => result.current.generate({ style: "default", count: 4 }));
    await advanceUntil(() => result.current.phase === "error", 200);

    expect(result.current.error).toBe("模型思考太久，还没开始写正文；已中断，可换个风格或稍后重试");
    expect(result.current.phase).toBe("error");
    expect(result.current.segments).toHaveLength(0);
  });

  it("已出正文后写超总时长（120s）：保留已落卡的走向，phase 仍是 streaming", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
    vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai" } as never);
    // 首段 1s 落卡，此后思考帧每 10s 一帧持续到达（stall 恒续期），
    // 但正文迟迟不闭合 → 从首段落卡起算的 120s 总时长到点
    const script: Array<{ at: number; chunk: string | null }> = [
      { at: 1_000, chunk: ONE_BRANCH },
    ];
    for (let t = 10_000; t <= 130_000; t += 10_000) {
      script.push({ at: t, chunk: REASONING_FRAME });
    }
    vi.mocked(aiGenerateStream).mockResolvedValue(makeTimedHandle(script, true) as never);

    const { result } = renderHook(() => useRescueBranch(buildOptions()));
    act(() => result.current.generate({ style: "default", count: 4 }));
    await advanceUntil(() => result.current.error !== null, 140);

    expect(result.current.error).toBe("生成超时，已保留已生成的走向");
    expect(result.current.phase).toBe("streaming");
    expect(result.current.segments.map((item) => item.title)).toEqual(["当场翻脸"]);
  });
});
