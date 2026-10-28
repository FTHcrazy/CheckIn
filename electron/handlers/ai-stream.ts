/**
 * AI 流式生成通道（M4 / B5）
 *
 * 预研点 4 已定的「流派 3」落地：渲染进程像直连一样 `fetch` 内部端点
 * `ai-stream://local/api/chat`，主进程 `protocol.handle` 读配置 + 解密 Key +
 * `net.fetch` 模型接口（`stream: true`），再把模型的 SSE 流**原样**返回给渲染层。
 * 主进程不逐块搬运流 —— 它只做「发起请求 + 返回流」这一次。
 *
 * 为什么用独立 scheme 而不是塞进 `app` scheme：
 * - `app://` 的 `protocol.handle` 是「文件读取」语义，把流式端点混进去要
 *   在同一个 handler 里分支「文件 or 流」，污染最热路径；
 * - 独立 scheme 天然隔离 `initiatorOrigin` 校验与 `stream: true` privilege，
 *   回归面为零。
 *
 * 安全边界（守住 §8.7「豁免」的精神，与 ai-handlers.ts 同款）：
 * 1. **Key 绝不出主进程**：解密只在 `readConfigInternal` 内部，流式端点
 *    拿到的是 `net.fetch` 的响应流，不含 Key；
 * 2. **一次性令牌校验**：渲染层发起前经 IPC 领一张令牌、端点核销即失效
 *    （`electron/ai-stream-token.ts`）。**不要**退回按 `Origin` 判定 ——
 *    自定义 scheme 的 fetch 不带该头，一判就 403（真机事故）；
 * 3. **端点 URL 不含 Key**：Key 在请求 header，不在 URL —— 守卫断言钉死。
 *
 * 中断：渲染层 `AbortController.abort()` → fetch 断开 → `net.fetch` 的
 * `signal` 联动，主进程模型连接随之释放（守卫断言覆盖）。
 *
 * 观测（2.10.1 补）：流式请求此前完全不进 `ai_log` / `ai_event` —— 「AI 记录」
 * 页看不到续写、看板上只有渲染层的 adopt/cancel，采纳率的分母凭空消失。
 * 现在由本层负责**唯一知道的那件事**：流什么时候结束 / 被谁中断
 * （`onStreamEnd`），落库仍由注入方（ai-handlers）完成 —— 本文件不写表，
 * 避免与 ai-handlers 形成循环依赖。
 */
import { BrowserWindow, protocol } from "electron";
import { logAlways } from "../logger";
import { windowManager } from "../windowManager";
import { consumeAiStreamToken } from "../ai-stream-token";
import {
  AI_STREAM_HOST,
  AI_STREAM_PATH,
  AI_STREAM_SCHEME,
  AI_STREAM_TOKEN_HEADER,
} from "../../src/shared/ai/ai-stream-protocol";

/**
 * 由 ai-handlers.ts 注入配置读取函数：本文件不 import ai-handlers（避免
 * 循环依赖），readConfigInternal 与 request 构造在那边，这里只接一个
 * 「读配置 + 发流式请求」的回调。
 *
 * 回调返回 `{ response: Response, provider }`（Promise）：Response 是
 * `net.fetch` 的流式响应（body 为 SSE ReadableStream），本文件把它原样
 * 桥接给渲染层。
 */
/** 流式请求体（与渲染层 `aiGenerateStream` 的入参一对一） */
export interface AiStreamRequestBody {
  system?: string;
  prompt: string;
  temperature?: number;
  /** 功能意图（continuation / …），仅用于日志与度量归类；缺省由注入方兜底 */
  intent?: string;
}

/** 流结束的终态：正常读完 / 渲染层主动中断 */
export type AiStreamOutcome = "ok" | "cancelled";

/**
 * 注入方（ai-handlers）抛出的可归一错误：带错误码 + 中文文案。
 *
 * 为什么需要它：非流式路径有 `httpStatusToError` + `aiErrorMessage` 一套归一，
 * 而流式此前只会把 502 和一句技术错误甩给渲染层（用户看到「流式请求失败（401）」）。
 * 有了这个类型，ai-stream 能把 code 放进响应头、把中文文案放进响应体，
 * 渲染层两条路径的错误体验就此统一。
 */
export class AiStreamError extends Error {
  readonly code: string;
  /** 建议的 HTTP 状态码（默认 502：上游调用失败） */
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "AiStreamError";
    this.code = code;
    this.status = status;
  }
}

/**
 * 由 ai-handlers.ts 注入配置读取函数：本文件不 import ai-handlers（避免
 * 循环依赖），readConfigInternal 与 request 构造在那边，这里只接一个
 * 「读配置 + 发流式请求」的回调。
 *
 * 回调返回 `{ response, provider, onStreamEnd }`：
 * - `response`：`net.fetch` 的流式响应（body 为 SSE ReadableStream），本文件原样桥接；
 * - `onStreamEnd`：流正常读完 / 被中断时回调一次（本文件负责调用，注入方负责落库）。
 */
type StreamRequester = (body: AiStreamRequestBody & {
  /** 反查到的窗口名（日志按 `<userData>/logs/<窗口>/` 隔离；渲染层不自报，见 §6.3.1） */
  windowName: string;
}) => Promise<{
  response: Response;
  provider: "openai" | "ollama";
  /** 流终止回调；`output` 为已读到的正文（内部已截断，仅供日志预览） */
  onStreamEnd?: (outcome: AiStreamOutcome, output: string) => void;
}>;

let streamRequester: StreamRequester | null = null;

/** ai-handlers.ts 在 registerAiHandlers 里注入（模块级单例） */
export function setAiStreamRequester(requester: StreamRequester): void {
  streamRequester = requester;
}

/**
 * 反查发起流的窗口名（§6.3.1 硬性约束 1：渲染层不许自报）。
 *
 * 流式通道不是 IPC，拿不到 `event.sender`，只能按「当前焦点窗口」反查；
 * 都取不到时落到 `main`，日志目录不会因为这一条而散落。
 */
function resolveStreamWindowName(): string {
  const focused = BrowserWindow.getFocusedWindow();
  const target = focused ?? BrowserWindow.getAllWindows()[0];
  if (!target) return "main";
  return windowManager.getNameOf(target) ?? "main";
}

/** 日志里最多留多少字符（只是预览，不是正文归档） */
const STREAM_LOG_CHARS = 4000;

/**
 * 包装模型响应流：**边透传边攒一份**给 `onStreamEnd` 用。
 *
 * 不能先读完再返回（那就不是流式了），所以用 `TransformStream` 透传；
 * `flush` = 源流正常结束，`cancel` = 渲染层主动中断。两条路径都恰好命中一次。
 */
function tapStream(
  body: ReadableStream<Uint8Array>,
  onEnd: (outcome: AiStreamOutcome, output: string) => void,
): ReadableStream<Uint8Array> {
  let acc = "";
  const decoder = new TextDecoder();
  let settled = false;
  const settle = (outcome: AiStreamOutcome): void => {
    if (settled) return;
    settled = true;
    onEnd(outcome, acc);
  };

  const transformer = {
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      controller.enqueue(chunk);
      if (acc.length < STREAM_LOG_CHARS) {
        // stream: true 让跨块的多字节字符不被切坏（只影响日志文本，不影响透传）
        acc += decoder.decode(chunk, { stream: true });
      }
    },
    flush() {
      settle("ok");
    },
    cancel() {
      settle("cancelled");
    },
  };

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(transformer));
}

/**
 * 注册 `ai-stream://` 流式端点。
 *
 * 必须在 `app.whenReady` 之后调用（`protocol.handle` 的前置），且须与
 * `protocol.registerSchemesAsPrivileged` 里声明的 `ai-stream` scheme 配套。
 * 由 main.ts 在启动流程里调用一次。
 */
export function registerAiStreamEndpoint(): void {
  protocol.handle(AI_STREAM_SCHEME, async (request) => {
    const url = new URL(request.url);
    // 只服务约定的内部路径；其它一律 404
    if (url.hostname !== AI_STREAM_HOST || url.pathname !== AI_STREAM_PATH) {
      return new Response("Not Found", { status: 404 });
    }

    // 身份校验：一次性令牌核销（PRD 红线 C）。
    // ⚠️ 不要改回读 `Origin` **请求头**：自定义 scheme 的 fetch 根本不带这个头
    // （实测 protocol.handle 收到的只有 accept / content-type / user-agent），
    // `headers.get("origin")` 恒为 null → 会把本应用的合法请求拒成 403
    // （2.10.4 真机事故：每次续写都弹一句英文 Forbidden）。
    // Electron 原生字段是 `request.initiatorOrigin`（本版本实测有值，如
    // `app://checkin`），这里只把它写进拒绝日志当排障线索，**不参与放行**：
    // 放行只认令牌 —— 令牌不依赖页面 origin 的形态，不会再因换加载方式而失效。
    if (!consumeAiStreamToken(request.headers.get(AI_STREAM_TOKEN_HEADER))) {
      // 类型说明：本仓库装的 electron 类型把 protocol.handle 的入参标成 DOM
      // Request，少了 Electron 自己加的 `initiatorOrigin`；运行期这个字段是
      // 存在的（实测有值），故就地窄化取用，取不到不影响放行判断。
      const initiator =
        (request as Request & { initiatorOrigin?: string }).initiatorOrigin || "无";
      logAlways(
        "warn",
        "main",
        "ai-stream",
        `拒绝无有效令牌的流式请求（initiatorOrigin=${initiator}）`,
      );
      return new Response("AI 通道校验失败，请重启应用后重试", { status: 403 });
    }

    if (!streamRequester) {
      return new Response("AI 通道未就绪", { status: 503 });
    }

    let body: AiStreamRequestBody;
    try {
      body = (await request.json()) as AiStreamRequestBody;
    } catch {
      return new Response("请求体无效", { status: 400 });
    }
    if (typeof body?.prompt !== "string" || body.prompt.trim().length === 0) {
      return new Response("生成描述不能为空", { status: 400 });
    }

    try {
      const { response, onStreamEnd } = await streamRequester({
        system: typeof body.system === "string" ? body.system : undefined,
        prompt: body.prompt,
        temperature: typeof body.temperature === "number" ? body.temperature : undefined,
        intent: typeof body.intent === "string" ? body.intent : undefined,
        windowName: resolveStreamWindowName(),
      });

      // 把模型响应（SSE 流）原样桥接给渲染层。body 是 ReadableStream，
      // 渲染层拿标准 `res.body.getReader()` 读流、自己 parse SSE。
      // 关键：Content-Type 透传 text/event-stream，让渲染层按 SSE 解析。
      // 顺带挂一个旁路 tap：流读完 / 被中断时回传终态，供注入方落 ai_log + ai_event。
      const stream = response.body
        ? tapStream(response.body, (outcome, output) => onStreamEnd?.(outcome, output))
        : null;
      return new Response(stream, {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("content-type") ?? "text/event-stream",
        },
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // 归一错误：注入方给的中文文案 + 错误码放响应头（渲染层据此走专属交互）
      if (error instanceof AiStreamError) {
        logAlways("warn", "main", "ai-stream", `流式调用失败 ${error.code}: ${error.message}`);
        return new Response(error.message, {
          status: error.status,
          headers: { "Content-Type": "text/plain; charset=utf-8", "x-ai-error-code": error.code },
        });
      }
      logAlways("warn", "main", "ai-stream", `流式请求失败: ${raw}`);
      return new Response(`AI 调用失败：${raw}`, { status: 502 });
    }
  });
}
