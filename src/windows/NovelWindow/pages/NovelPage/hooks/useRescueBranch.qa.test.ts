import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiGenerateStream, aiGenerateStructured, getAiConfig, logAiEvent } from "@/shared/ai/ai-client";
import { useRescueBranch, type UseRescueBranchOptions } from "./useRescueBranch";
import type { RescueEdit, RescueSegment } from "../utils/rescue";

/**
 * 卡文救援编排的**幂等与配额**边界（QA 独立补充，R-AI-11 §3.2 / §2.1-4）
 *
 * `useRescueBranch.test.ts` 钉了主链路（流式落卡、降级、换一批、空批次、撤销确认的
 * 取消分支）。这里补三条它没覆盖、但上线后一定会被用户踩到的：
 * 1. 同一批连点两次「撤销本批次」—— 第二次必须是空操作 + 一句提示，不能再删一遍正文；
 * 2. 二次编辑确认点「仍要撤销」—— 正向分支（原测试只覆盖了「保留」）；
 * 3. 模型多给（要求 2 条却吐 3 条）—— 编号不能越过 B2，界面不能多出第 3 张卡。
 */
vi.mock("@/shared/ai/ai-client", () => ({
  aiGenerateStream: vi.fn(),
  aiGenerateStructured: vi.fn(),
  getAiConfig: vi.fn(),
  logAiEvent: vi.fn(),
}));

vi.mock("@/shared/ai/ai-stream-parse", () => ({
  createOpenAiSseAccumulator: () => ({ push: (chunk: string) => chunk, flush: () => "" }),
  createOllamaAccumulator: () => ({ push: (chunk: string) => chunk, flush: () => "" }),
}));

const SEGMENT = (title: string): RescueSegment => ({
  title,
  conflict: `${title}-冲突`,
  consequence: `${title}-后果`,
});

function makeHandle(chunks: string[]) {
  let cursor = 0;
  const handle = {
    abort: vi.fn(() => {
      handle.done = true;
    }),
    done: false,
    readChunk: async (): Promise<string | null> => {
      if (cursor >= chunks.length) return null;
      const chunk = chunks[cursor];
      cursor += 1;
      return chunk;
    },
  };
  return handle;
}

const EDIT: RescueEdit = {
  batchId: "b1",
  chapterId: "c1",
  kind: "text",
  from: 10,
  to: 40,
  originalText: "一、当场翻脸",
};

function buildOptions(overrides: Partial<UseRescueBranchOptions> = {}): UseRescueBranchOptions {
  return {
    buildSpec: () => ({ system: "你是…", prompt: "请给几条走向" }),
    applyAdopt: vi.fn(async () => [] as RescueEdit[]),
    applyUndo: vi.fn(async () => {}),
    findStaleEdits: vi.fn(() => [] as RescueEdit[]),
    confirmStale: vi.fn(async () => true),
    notify: vi.fn(),
    ...overrides,
  };
}

describe("useRescueBranch：撤销幂等与配额（QA 补充）", () => {
  afterEach(() => {
    vi.mocked(aiGenerateStream).mockReset();
    vi.mocked(aiGenerateStructured).mockReset();
    vi.mocked(getAiConfig).mockReset();
    vi.mocked(logAiEvent).mockReset();
  });

  it("同一批连撤两次：第二次不再执行回滚，只提示已经撤过", async () => {
    const applyAdopt = vi.fn(async () => [EDIT]);
    const applyUndo = vi.fn(async () => {});
    const notify = vi.fn();
    const { result } = renderHook(() =>
      useRescueBranch(buildOptions({ applyAdopt, applyUndo, notify })),
    );

    await act(async () => {
      await result.current.adopt({ segments: [SEGMENT("A")], landing: "cursor" });
    });
    await act(async () => {
      await result.current.undo();
    });
    await act(async () => {
      await result.current.undo();
    });

    // 第二次是空操作：正文只回滚一次，否则会把作者自己的内容一并删掉
    expect(applyUndo).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("已经撤销过"), "info");
  });

  it("二次编辑确认点「仍要撤销」：整批回滚并清零可撤计数", async () => {
    const applyAdopt = vi.fn(async () => [EDIT]);
    const applyUndo = vi.fn(async () => {});
    const confirmStale = vi.fn(async () => true);
    const findStaleEdits = vi.fn(() => [EDIT]);
    const { result } = renderHook(() =>
      useRescueBranch(buildOptions({ applyAdopt, applyUndo, confirmStale, findStaleEdits })),
    );

    await act(async () => {
      await result.current.adopt({ segments: [SEGMENT("A")], landing: "cursor" });
    });
    await act(async () => {
      await result.current.undo();
    });

    expect(confirmStale).toHaveBeenCalledWith(1);
    expect(applyUndo).toHaveBeenCalledWith([EDIT]);
    expect(result.current.undoCount).toBe(0);
  });

  it("模型多给：要求 2 条时第 3 条被丢弃，编号不越过 B2", async () => {
    vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai" } as never);
    vi.mocked(aiGenerateStream).mockResolvedValue(
      makeHandle([
        '{"title":"A","conflict":"a","consequence":"a"}',
        ',{"title":"B","conflict":"b","consequence":"b"}',
        ',{"title":"C","conflict":"c","consequence":"c"}',
      ]) as never,
    );

    const { result } = renderHook(() => useRescueBranch(buildOptions()));
    act(() => result.current.generate({ style: "default", count: 2 }));

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.segments.map((item) => item.title)).toEqual(["A", "B"]);
  });

  it("落点执行者返回空记录（编辑器未就绪 / 切过章）：不留「已采纳」假象", async () => {
    const applyAdopt = vi.fn(async () => [] as RescueEdit[]);
    const { result } = renderHook(() => useRescueBranch(buildOptions({ applyAdopt })));

    await act(async () => {
      await result.current.adopt({ segments: [SEGMENT("A")], landing: "cursor" });
    });
    // 没有可撤记录 → 不显示「撤销本批次」，避免点下去报「没有可撤销的内容」
    expect(result.current.undoCount).toBe(0);
  });
});
