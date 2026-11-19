import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiGenerateStream, aiGenerateStructured, getAiConfig, logAiEvent } from "@/shared/ai/ai-client";
import { useRescueBranch, type UseRescueBranchOptions } from "./useRescueBranch";
import type { RescueEdit, RescueSegment } from "../utils/rescue";

/**
 * 卡文救援编排（R-AI-11）
 *
 * 这一层不渲染，钉的是**状态机与并发**：流式逐条落卡、解析失败降级、
 * 换一批时旧流必须作废、空批次拒绝、撤销前的二次编辑确认。
 * 编辑器与数据层都被替换成注入的回调，所以这些用例不需要 IPC 也不需要 DOM 编辑器。
 */
vi.mock("@/shared/ai/ai-client", () => ({
  aiGenerateStream: vi.fn(),
  aiGenerateStructured: vi.fn(),
  getAiConfig: vi.fn(),
  logAiEvent: vi.fn(),
}));

// 累加器换成「原样透传」：本用例测的是状态机，不是 SSE 切帧
vi.mock("@/shared/ai/ai-stream-parse", () => ({
  createOpenAiSseAccumulator: () => ({ push: (chunk: string) => chunk, flush: () => "" }),
  createOllamaAccumulator: () => ({ push: (chunk: string) => chunk, flush: () => "" }),
}));

const SEGMENT = (title: string): RescueSegment => ({
  title,
  conflict: `${title}-冲突`,
  consequence: `${title}-后果`,
});

/** 造一个可控的流句柄：chunks 依次吐出，读完返回 null */
function makeHandle(chunks: string[]) {
  let cursor = 0;
  const handle: {
    abort: () => void;
    done: boolean;
    readChunk: () => Promise<string | null>;
  } = {
    abort: vi.fn(() => {
      handle.done = true;
    }),
    done: false,
    readChunk: async () => {
      if (cursor >= chunks.length) return null;
      const chunk = chunks[cursor];
      cursor += 1;
      return chunk;
    },
  };
  return handle;
}

/**
 * 造一个「吐完这些块就挂住」的流句柄：用于「换一批时旧流必须被中断」的用例。
 * 正常的 `makeHandle` 读完就返回 null（流已结束），那时没有可中断的连接。
 */
function makeHangingHandle(chunks: string[]) {
  let cursor = 0;
  const handle: {
    abort: () => void;
    done: boolean;
    readChunk: () => Promise<string | null>;
  } = {
    abort: vi.fn(() => {
      handle.done = true;
    }),
    done: false,
    readChunk: async () => {
      if (cursor < chunks.length) {
        const chunk = chunks[cursor];
        cursor += 1;
        return chunk;
      }
      // 永不 resolve：模拟「服务端还连着、还在生成」
      return new Promise<string | null>(() => {});
    },
  };
  return handle;
}

type Options = UseRescueBranchOptions;

function buildOptions(overrides: Partial<Options> = {}): Options {
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

const PARAMS = { style: "default" as const, count: 4 };

describe("useRescueBranch", () => {
  afterEach(() => {
    vi.mocked(aiGenerateStream).mockReset();
    vi.mocked(aiGenerateStructured).mockReset();
    vi.mocked(getAiConfig).mockReset();
    vi.mocked(logAiEvent).mockReset();
  });

  it("流式：每闭合一段就落一张卡，结束后进入 done", async () => {
    vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai" } as never);
    vi.mocked(aiGenerateStream).mockResolvedValue(
      makeHandle([
        '[{"title":"当场翻脸","conflict":"对峙","consequence":"名分撕破"}',
        ',{"title":"按下不表","conflict":"暗查","consequence":"错失先机"}]',
      ]) as never,
    );

    const { result } = renderHook(() => useRescueBranch(buildOptions()));
    act(() => result.current.generate(PARAMS));

    await waitFor(() => expect(result.current.segments).toHaveLength(2));
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.segments.map((item) => item.title)).toEqual([
      "当场翻脸",
      "按下不表",
    ]);
    expect(result.current.batchId).not.toBe("");
    expect(vi.mocked(aiGenerateStream).mock.calls[0][0].intent).toBe("branch");
  });

  it("buildSpec 返回 null（无正文）：不发请求，只提示", () => {
    const notify = vi.fn();
    const { result } = renderHook(() =>
      useRescueBranch(buildOptions({ buildSpec: () => null, notify })),
    );
    act(() => result.current.generate(PARAMS));
    expect(aiGenerateStream).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("没有正文"), "warning");
  });

  it("流式一段都没解开 → 结构化通道兜底（整块 loading，无骨架卡）", async () => {
    vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai" } as never);
    vi.mocked(aiGenerateStream).mockResolvedValue(
      makeHandle(["好的，我来给你几个走向："]) as never,
    );
    vi.mocked(aiGenerateStructured).mockResolvedValue({
      ok: true,
      data: {
        text: "",
        usedFallback: false,
        entries: [
          { title: "外援入场", conflict: "求助宿敌", consequence: "欠下人情" },
        ],
      },
    } as never);

    const { result } = renderHook(() => useRescueBranch(buildOptions()));
    act(() => result.current.generate(PARAMS));

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(vi.mocked(aiGenerateStructured)).toHaveBeenCalledTimes(1);
    expect(result.current.segments.map((item) => item.title)).toEqual(["外援入场"]);
  });

  it("换一批：中断在途流，旧流的后续写入整体作废", async () => {
    vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai" } as never);
    const first = makeHangingHandle(['[{"title":"旧A","conflict":"c","consequence":"s"}']);
    const second = makeHandle(['[{"title":"新A","conflict":"c","consequence":"s"}]']);
    vi.mocked(aiGenerateStream)
      .mockResolvedValueOnce(first as never)
      .mockResolvedValueOnce(second as never);

    const { result } = renderHook(() => useRescueBranch(buildOptions()));
    act(() => result.current.generate(PARAMS));
    await waitFor(() => expect(result.current.segments).toHaveLength(1));

    act(() => result.current.generate(PARAMS));
    expect(first.abort).toHaveBeenCalled();

    await waitFor(() =>
      expect(result.current.segments.map((item) => item.title)).toEqual(["新A"]),
    );
  });

  it("空批次拒绝：没勾选就不调用落点执行者", async () => {
    const applyAdopt = vi.fn(async () => [] as RescueEdit[]);
    const notify = vi.fn();
    const { result } = renderHook(() =>
      useRescueBranch(buildOptions({ applyAdopt, notify })),
    );

    await act(async () => {
      await result.current.adopt({ segments: [], landing: "cursor" });
    });
    expect(applyAdopt).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("先勾选"), "warning");
  });

  it("采纳后 undoCount > 0；撤销走 applyUndo 并清零", async () => {
    const edits: RescueEdit[] = [
      {
        batchId: "b1",
        chapterId: "c1",
        kind: "text",
        from: 10,
        to: 40,
        originalText: "一、当场翻脸",
      },
    ];
    const applyAdopt = vi.fn(async () => edits);
    const applyUndo = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useRescueBranch(buildOptions({ applyAdopt, applyUndo })),
    );

    await act(async () => {
      await result.current.adopt({ segments: [SEGMENT("A")], landing: "cursor" });
    });
    expect(result.current.undoCount).toBe(1);
    expect(vi.mocked(logAiEvent).mock.calls[0][0]).toMatchObject({
      intent: "branch",
      step: "adopt",
      itemCount: 1,
    });

    await act(async () => {
      await result.current.undo();
    });
    expect(applyUndo).toHaveBeenCalledWith(edits);
    expect(result.current.undoCount).toBe(0);
  });

  it("二次编辑过的段撤销前先问一句：取消则整批不撤", async () => {
    const edits: RescueEdit[] = [
      {
        batchId: "b1",
        chapterId: "c1",
        kind: "text",
        from: 10,
        to: 40,
        originalText: "一、当场翻脸",
      },
    ];
    const applyAdopt = vi.fn(async () => edits);
    const applyUndo = vi.fn(async () => {});
    const confirmStale = vi.fn(async () => false);
    const findStaleEdits = vi.fn(() => edits);
    const { result } = renderHook(() =>
      useRescueBranch(
        buildOptions({ applyAdopt, applyUndo, confirmStale, findStaleEdits }),
      ),
    );

    await act(async () => {
      await result.current.adopt({ segments: [SEGMENT("A")], landing: "cursor" });
    });
    await act(async () => {
      await result.current.undo();
    });

    expect(confirmStale).toHaveBeenCalledWith(1);
    expect(applyUndo).not.toHaveBeenCalled();
    expect(result.current.undoCount).toBe(1);
  });

  it("reset 清空结果与批次（切章 / 关闭浮层）", async () => {
    vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai" } as never);
    vi.mocked(aiGenerateStream).mockResolvedValue(
      makeHandle(['[{"title":"A","conflict":"c","consequence":"s"}]']) as never,
    );
    const { result } = renderHook(() => useRescueBranch(buildOptions()));
    act(() => result.current.generate(PARAMS));
    await waitFor(() => expect(result.current.segments).toHaveLength(1));

    act(() => result.current.reset());
    expect(result.current.segments).toEqual([]);
    expect(result.current.phase).toBe("idle");
    expect(result.current.batchId).toBe("");
  });
});
