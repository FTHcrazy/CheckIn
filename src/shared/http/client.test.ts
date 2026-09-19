import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpClient, HttpError } from "./client";

/** 构造假响应：client 只依赖 ok / status / headers.get / text */
function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://example.test/api",
    headers: {
      get: (key: string) =>
        key.toLowerCase() === "content-type" ? "application/json" : null,
    },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input), init),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** 永不主动返回的请求，但会响应 signal 中断（模拟真实 fetch 行为） */
function pendingResponse(init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fakeResponse({})), 5_000);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("统一 HTTP 客户端", () => {
  it("GET 成功：返回状态、数据与响应头", async () => {
    stubFetch(() => Promise.resolve(fakeResponse({ code: 200, data: { a: 1 } })));
    const http = createHttpClient({ unwrap: (b) => (b as { data: unknown }).data });

    const res = await http.get<{ a: number }>("https://example.test/api");
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ a: 1 });
  });

  it("query 参数会拼接，空值被忽略", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(fakeResponse({ ok: true })));
    const http = createHttpClient();

    await http.get("https://example.test/api", {
      params: { page: 1, q: "abc", empty: "", none: undefined },
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("page=1");
    expect(url).toContain("q=abc");
    expect(url).not.toContain("empty");
    expect(url).not.toContain("none");
  });

  it("非 2xx 抛 HttpError，并带上状态码与响应体", async () => {
    stubFetch(() => Promise.resolve(fakeResponse({ msg: "nope" }, 401)));
    const http = createHttpClient();

    await expect(http.get("https://example.test/api")).rejects.toMatchObject({
      name: "HttpError",
      status: 401,
    });
  });

  it("网络错误归一为 status 0，并按 retry 次数重试后失败", async () => {
    const fetchMock = stubFetch(() => Promise.reject(new Error("offline")));
    const http = createHttpClient({ retry: 2, retryDelay: 1 });

    await expect(http.get("https://example.test/api")).rejects.toBeInstanceOf(
      HttpError,
    );
    // 首次 + 2 次重试
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("4xx 不重试", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(fakeResponse({ msg: "bad request" }, 400)),
    );
    const http = createHttpClient({ retry: 3 });

    await expect(http.get("https://example.test/api")).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("abortAll 中断该实例全部在途请求", async () => {
    stubFetch((_url, init) => pendingResponse(init));
    const http = createHttpClient({ retry: 0 });

    const p = http.get("https://example.test/api");
    http.abortAll();
    await expect(p).rejects.toBeInstanceOf(HttpError);
    expect(http.pending).toBe(0);
  });

  it("超时自动中断：超时时间到达后请求被取消", async () => {
    vi.useFakeTimers();
    stubFetch((_url, init) => pendingResponse(init));
    const http = createHttpClient({ timeout: 100, retry: 0 });

    const p = http.get("https://example.test/api");
    // 先挂上处理函数再推进定时器，避免拒绝发生在无 handler 的窗口期
    const settled = p.then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(150);
    const err = await settled;
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).isAbort).toBe(true);
  });

  it("POST 对象体自动 JSON 序列化并设置 Content-Type", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(fakeResponse({ ok: 1 })));
    const http = createHttpClient();

    await http.post("https://example.test/api", { name: "checkin" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toContain(
      "application/json",
    );
    expect(init.body).toBe(JSON.stringify({ name: "checkin" }));
  });

  it("baseURL 与相对路径拼接", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(fakeResponse({ ok: 1 })));
    const http = createHttpClient({ baseURL: "https://elf.smart.cn/rest/r" });

    await http.get("/gitwebhooklog");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://elf.smart.cn/rest/r/gitwebhooklog",
    );
  });
});
