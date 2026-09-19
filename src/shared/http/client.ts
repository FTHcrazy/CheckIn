/**
 * 渲染进程统一 HTTP 客户端
 *
 * ## 架构约定（1.5.0 起）
 * 所有网络请求在**渲染进程**内完成，主进程不再代理 HTTP：
 * - 一个窗口 = 一个渲染进程 = 一个（或多个）独立 client 实例，请求互不影响；
 * - 主进程只负责一次性会话配置（CORS 响应头注入 / Cookie 写入 jar），
 *   不再逐请求回调，避免多窗口高频请求拖垮主进程；
 * - 所有窗口共用本文件的同一套标准：超时、重试、中断、错误归一、响应剥壳。
 *
 * ## 依赖
 * 基于渲染进程原生 `fetch`（Chromium 网络栈），不引入第三方库。
 * Cookie 走 Electron session cookie jar + `credentials: "include"`，
 * 因为 `Cookie` 是浏览器 forbidden header，无法通过 fetch 手动设置。
 */

/** 请求配置（client 级默认） */
export interface HttpClientConfig {
  /** 相对路径拼接的基地址 */
  baseURL?: string;
  /** 单次请求超时（毫秒），默认 15000 */
  timeout?: number;
  /** 失败重试次数（不含首次），默认 1 */
  retry?: number;
  /** 重试基础退避时间（毫秒），默认 500 */
  retryDelay?: number;
  /** 默认请求头 */
  headers?: Record<string, string>;
  /** 凭证策略，需带 Cookie 的接口用 "include"，默认 "omit" */
  credentials?: RequestCredentials;
  /**
   * 响应体剥壳：很多接口用 `{ code, data }` 包裹，
   * 在此统一脱壳，业务层拿到的就是 payload。
   */
  unwrap?: (body: unknown) => unknown;
  /** 自定义重试判定（默认：网络错误 / 5xx 才重试） */
  shouldRetry?: (error: HttpError, attempt: number) => boolean;
}

/** 单次请求参数 */
export interface RequestOptions {
  url: string;
  method?: string;
  /** query 参数，undefined / null 会被忽略 */
  params?: Record<string, string | number | boolean | null | undefined>;
  /** 对象会自动 JSON 序列化并设置 Content-Type */
  body?: unknown;
  headers?: Record<string, string>;
  /** 覆盖 client 级超时 */
  timeout?: number;
  /** 覆盖 client 级重试次数 */
  retry?: number;
  /** 外部中断信号（页面卸载 / 用户取消） */
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  /** 强制响应解析方式，默认按 Content-Type 推断 */
  responseType?: "json" | "text";
}

/** 统一响应结构 */
export interface HttpResponse<T> {
  status: number;
  data: T;
  headers: Headers;
  ok: boolean;
}

/** 统一错误：无论网络错误、HTTP 错误、解析失败，业务层只需 catch 这一种 */
export class HttpError extends Error {
  /** HTTP 状态码；0 表示网络层失败（超时 / 断网 / DNS 等） */
  readonly status: number;
  readonly url: string;
  /** 服务端返回的错误响应体（若可解析） */
  readonly payload: unknown;
  /** 是否由中断（超时 / abort / 页面卸载）引起 */
  readonly aborted: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      url: string;
      payload?: unknown;
      aborted?: boolean;
    },
  ) {
    super(message);
    this.name = "HttpError";
    this.status = options.status;
    this.url = options.url;
    this.payload = options.payload;
    this.aborted = options.aborted ?? false;
  }

  /** 是否由中断（超时 / abort / 页面卸载）引起 */
  get isAbort(): boolean {
    return this.aborted;
  }

  /** 是否网络层失败（非服务端返回的状态码） */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export interface HttpClient {
  request<T = unknown>(options: RequestOptions): Promise<HttpResponse<T>>;
  get<T = unknown>(
    url: string,
    options?: Omit<RequestOptions, "url" | "method">,
  ): Promise<HttpResponse<T>>;
  post<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RequestOptions, "url" | "method" | "body">,
  ): Promise<HttpResponse<T>>;
  /** 中断该实例所有在途请求（页面卸载 / 窗口关闭时调用） */
  abortAll(reason?: string): void;
  /** 在途请求数（便于观测各窗口请求压力） */
  readonly pending: number;
}

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRY = 1;
const DEFAULT_RETRY_DELAY = 500;

/** 默认重试判定：仅网络错误与 5xx 重试，4xx 与中断不重试 */
function defaultShouldRetry(error: HttpError): boolean {
  return error.isNetwork || error.status >= 500;
}

function buildUrl(
  baseURL: string | undefined,
  url: string,
  params?: RequestOptions["params"],
): string {
  const absolute = /^https?:\/\//i.test(url);
  let full = absolute || !baseURL ? url : `${baseURL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;

  if (params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      search.append(key, String(value));
    }
    const qs = search.toString();
    if (qs) full += `${full.includes("?") ? "&" : "?"}${qs}`;
  }
  return full;
}

/** 判断是否需要 JSON 序列化：普通对象 / 数组 */
function shouldStringify(body: unknown): boolean {
  if (body === null || typeof body !== "object") return false;
  if (body instanceof FormData) return false;
  if (body instanceof URLSearchParams) return false;
  if (typeof Blob !== "undefined" && body instanceof Blob) return false;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return false;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 合并外部 signal：外部中断时同步中断内部 controller */
function linkSignal(
  controller: AbortController,
  external?: AbortSignal,
): () => void {
  if (!external) return () => {};
  if (external.aborted) {
    controller.abort(external.reason);
    return () => {};
  }
  const onAbort = () => controller.abort(external.reason);
  external.addEventListener("abort", onAbort, { once: true });
  return () => external.removeEventListener("abort", onAbort);
}

/**
 * 创建 HTTP client 实例。
 *
 * 每个窗口 / 每个页面可各建一个实例：实例间超时、重试、在途请求完全隔离，
 * 某个页面的请求风暴不会波及同窗口其他页面，更不会传导到主进程。
 */
export function createHttpClient(config: HttpClientConfig = {}): HttpClient {
  const {
    baseURL,
    timeout: defaultTimeout = DEFAULT_TIMEOUT,
    retry: defaultRetry = DEFAULT_RETRY,
    retryDelay = DEFAULT_RETRY_DELAY,
    headers: defaultHeaders,
    credentials = "omit",
    unwrap,
    shouldRetry = defaultShouldRetry,
  } = config;

  /** 在途请求的 controller，用于 abortAll 统一回收 */
  const inFlight = new Set<AbortController>();

  async function request<T>(options: RequestOptions): Promise<HttpResponse<T>> {
    const url = buildUrl(baseURL, options.url, options.params);
    const maxAttempts = (options.retry ?? defaultRetry) + 1;
    const timeout = options.timeout ?? defaultTimeout;

    let lastError: HttpError | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = new AbortController();
      inFlight.add(controller);
      const unlink = linkSignal(controller, options.signal);
      const timer = setTimeout(() => controller.abort("timeout"), timeout);

      try {
        const body = options.body;
        const headers: Record<string, string> = {
          ...defaultHeaders,
          ...options.headers,
        };
        if (shouldStringify(body) && !hasContentType(headers)) {
          headers["Content-Type"] = "application/json; charset=UTF-8";
        }

        const res = await fetch(url, {
          method: options.method ?? (body === undefined ? "GET" : "POST"),
          headers,
          body: shouldStringify(body) ? JSON.stringify(body) : (body as BodyInit),
          credentials: options.credentials ?? credentials,
          signal: controller.signal,
        });

        const data = (await parseResponse<T>(res, options.responseType)) as T;
        const payload = (unwrap ? unwrap(data) : data) as T;

        if (!res.ok) {
          throw new HttpError(`请求失败: ${res.status} ${url}`, {
            status: res.status,
            url,
            payload,
          });
        }

        return { status: res.status, data: payload, headers: res.headers, ok: true };
      } catch (err) {
        lastError = normalizeError(err, url);

        const canRetry =
          attempt + 1 < maxAttempts &&
          !lastError.isAbort &&
          shouldRetry(lastError, attempt);
        if (!canRetry) throw lastError;

        await sleep(retryDelay * 2 ** attempt);
      } finally {
        clearTimeout(timer);
        unlink();
        inFlight.delete(controller);
      }
    }

    throw lastError ?? new HttpError("请求失败", { status: 0, url });
  }

  return {
    request,
    get: <T>(url: string, options?: Omit<RequestOptions, "url" | "method">) =>
      request<T>({ ...options, url, method: "GET" }),
    post: <T>(
      url: string,
      body?: unknown,
      options?: Omit<RequestOptions, "url" | "method" | "body">,
    ) => request<T>({ ...options, url, body, method: "POST" }),
    abortAll: (reason = "aborted") => {
      for (const controller of inFlight) controller.abort(reason);
      inFlight.clear();
    },
    get pending() {
      return inFlight.size;
    },
  } as HttpClient;
}

function hasContentType(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
}

async function parseResponse<T>(
  res: Response,
  force?: "json" | "text",
): Promise<T> {
  const type = force ?? (isJson(res) ? "json" : "text");
  if (type === "json") {
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError("响应不是合法 JSON", {
        status: res.status,
        url: res.url,
        payload: text,
      });
    }
  }
  return (await res.text()) as T;
}

function isJson(res: Response): boolean {
  const contentType = res.headers.get("content-type") ?? "";
  return /application\/json|text\/json|\+json/i.test(contentType);
}

function isAbortError(err: unknown): boolean {
  if (err instanceof HttpError) return err.aborted;
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return err.name === "AbortError";
  }
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "AbortError"
  );
}

function normalizeError(err: unknown, url: string): HttpError {
  if (err instanceof HttpError) return err;
  if (isAbortError(err)) {
    return new HttpError("请求已取消", { status: 0, url, aborted: true });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new HttpError(message, { status: 0, url });
}
