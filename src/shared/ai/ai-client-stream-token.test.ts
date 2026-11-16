/**
 * 流式请求的端点凭证（PRD 红线 C）行为单测
 *
 * 真机事故（2.10.4）：端点靠 Origin 认身份，而自定义 scheme 的 fetch 不带
 * Origin → 每次续写都被自己拒成 403，浮层里显示一句英文 `Forbidden`。
 *
 * 这里钉两件行为：
 * 1. 每次发起都**现领**一张令牌并随请求头下发（不能缓存复用，令牌是一次性的）；
 * 2. 非 2xx 的响应体文案原样抛给调用方（主进程已给中文，渲染层不再二次解释）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_STREAM_TOKEN_HEADER } from "./ai-stream-protocol";
import { AiStreamRequestError, aiGenerateStream } from "./ai-client";

const originalElectronAPI = window.electronAPI;
const originalFetch = window.fetch;

function stubWindow(streamToken: ReturnType<typeof vi.fn>, fetchImpl: ReturnType<typeof vi.fn>): void {
  window.electronAPI = { ai: { streamToken } } as unknown as typeof window.electronAPI;
  window.fetch = fetchImpl as unknown as typeof window.fetch;
}

afterEach(() => {
  window.electronAPI = originalElectronAPI;
  window.fetch = originalFetch;
});

describe("aiGenerateStream 端点凭证", () => {
  it("每次发起都领取新令牌并放进请求头", async () => {
    const streamToken = vi
      .fn()
      .mockResolvedValueOnce("token-1")
      .mockResolvedValueOnce("token-2");
    // 每次调用都要造一份新的 Response：body 是流，复用同一个对象会「已锁」
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("data: {}\n\n", { status: 200 })));
    stubWindow(streamToken, fetchMock);

    await aiGenerateStream({ prompt: "写一段" });
    await aiGenerateStream({ prompt: "再写一段" });

    expect(streamToken).toHaveBeenCalledTimes(2);
    const headersOf = (call: number): Record<string, string> =>
      (fetchMock.mock.calls[call]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headersOf(0)[AI_STREAM_TOKEN_HEADER]).toBe("token-1");
    expect(headersOf(1)[AI_STREAM_TOKEN_HEADER]).toBe("token-2");
  });

  it("非 2xx 时把主进程的中文文案原样抛出（不再显示英文 Forbidden）", async () => {
    const streamToken = vi.fn().mockResolvedValue("token-1");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("AI 通道校验失败，请重启应用后重试", { status: 403 }),
    );
    stubWindow(streamToken, fetchMock);

    const error = await aiGenerateStream({ prompt: "写一段" }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AiStreamRequestError);
    expect((error as AiStreamRequestError).message).toBe("AI 通道校验失败，请重启应用后重试");
    expect((error as AiStreamRequestError).status).toBe(403);
    // 未归一的错误没有 code，调用方按 status / 文案兜底
    expect((error as AiStreamRequestError).code).toBeUndefined();
  });
});
