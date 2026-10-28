/**
 * AI 服务层统一调用入口（渲染进程侧）
 *
 * 这是各功能面板（起名 / 未来润色续写）**唯一**该 import 的 AI 入口。
 * 它只做一件事：把「业务无关的生成请求」转交给主进程 `window.electronAPI.ai`。
 *
 * 关键边界（R-AI-03）：
 * - 本层**不碰 Key、不发 HTTP、不读 ai.db** —— 网络请求在主进程；
 * - 本层**不 import novel 任何模块** —— 上下文由调用方（最懂业务处）拼好传入；
 * - 错误归一在主进程已完成，本层只透传 `AiResult`。
 *
 * 页面与组件不直接触碰 `window.electronAPI.ai`，统一走这里。
 */
import type {
  AiConfig,
  AiConfigSavePayload,
  AiEventLogDTO,
  AiEventStatsDTO,
  AiGenerateData,
  AiGenerateRequest,
  AiResult,
  AiTestResult,
} from "./ai-types";
import { parseOutput, type AiEntry, type OutputFormat } from "./context/output-spec";
import {
  AI_STREAM_ORIGIN,
  AI_STREAM_PATH,
  AI_STREAM_TOKEN_HEADER,
} from "./ai-stream-protocol";

/** 读当前 AI 配置（不含明文 Key） */
export async function getAiConfig(): Promise<AiConfig> {
  return window.electronAPI!.ai.getConfig();
}

/** 保存 AI 配置；apiKey 传空串 = 清空 */
export async function saveAiConfig(payload: AiConfigSavePayload): Promise<{ ok: boolean; error?: string }> {
  return window.electronAPI!.ai.saveConfig(payload);
}

/** 测试连接（Key 有效性 / 地址可达性 / 模型存在性） */
export async function testAiConnection(): Promise<AiResult<AiTestResult>> {
  return window.electronAPI!.ai.test();
}

/**
 * 列出本地 Ollama 已下载的模型（R-AI-01 FR-06）。
 *
 * 只读探测：不读 Key、不写 `ai_log`（它不属于 AI 调用，进了日志会污染耗时统计）。
 * `endpoint` 省略时由主进程用已保存配置。
 */
export async function listOllamaModels(
  endpoint?: string,
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  return window.electronAPI!.ai.listOllamaModels(endpoint ? { endpoint } : undefined);
}

/**
 * 打开服务商的「申请 API Key」页面（R-AI-01 FR-05）。
 *
 * 传 endpoint 而不是 URL：真实链接由主进程按 host 查表（`ai-providers.ts`），
 * 这样 `shell.openExternal` 的入参永远来自受控常量。未收录的服务商返回 `ok:false`。
 */
export async function openAiKeyPage(endpoint?: string): Promise<{ ok: boolean }> {
  return window.electronAPI!.ai.openKeyPage(endpoint ? { endpoint } : undefined);
}

/**
 * 非流式生成（起名增强等）。
 * 调用方负责拼好 prompt（含必要上下文），本层原样转交。
 */
export async function aiGenerate(request: AiGenerateRequest): Promise<AiResult<AiGenerateData>> {
  return window.electronAPI!.ai.generate(request);
}

// ── 流式生成（M4 / B5）─────────────────────────────────────────────


/**
 * 流式生成（M4 / B5）。
 *
 * 主方案走「流派 3」：渲染层 fetch 内部端点 `ai-stream://local/api/chat`，
 * 主进程 protocol.handle 读配置 + 解密 Key + net.fetch 模型接口，把 SSE 流
 * 原样桥接回来。渲染层拿标准 `ReadableStream` 自己 parse SSE。
 *
 * 返回一个「可中断」的流式句柄：
 * - `readChunk`：读一段文本增量（内部维护 SSE 解码器）；
 * - `abort`：中断请求，主进程连接随之释放；
 * - `done`：流是否已结束（正常 or 异常）。
 *
 * 中断联动：调用方持有返回的 `abort`，取消时 `AbortController.abort()` 断开
 * fetch，主进程 net.fetch 的连接经 protocol.handle 生命周期释放。
 */
export interface AiStreamHandle {
  /** 读下一段文本增量；返回 null 表示流已结束（正常 or 出错） */
  readChunk: () => Promise<string | null>;
  /** 中断请求并释放连接 */
  abort: () => void;
  /** 流是否已结束 */
  readonly done: boolean;
}

/**
 * 流式请求失败（非 2xx）。带主进程归一的错误码，调用方可据此走专属交互
 * （如 `missing_key` 直接引导去设置页），文案已是中文、可直接展示。
 */
export class AiStreamRequestError extends Error {
  /** 主进程 `x-ai-error-code` 头（未归一时为 undefined） */
  readonly code?: string;
  /** HTTP 状态码 */
  readonly status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "AiStreamRequestError";
    this.code = code;
    this.status = status;
  }
}

/**
 * 发起流式生成，返回可逐段读的句柄。
 *
 * 注意：本层只负责「发起 + 返回标准 ReadableStream 的读取句柄」，
 * SSE 协议解析（OpenAI `data: {...}` / Ollama 逐行 JSON）在渲染层的
 * `parseStreamChunk` 纯函数里做，主进程原样桥接不解释。
 *
 * `intent` 只用于主进程的调用日志与度量归类（`ai_log` / `ai_event`）；
 * 不传时主进程按 `continuation` 记。
 *
 * 端点身份：每次发起前经 `electronAPI.ai.streamToken()` 领一张**一次性**令牌
 * 放进 `x-ai-stream-token` 头，主进程 `protocol.handle` 核销即失效。
 * 不复用 Origin（自定义 scheme 的 fetch 不带该头，详见 `ai-stream-token.ts`）。
 */
export async function aiGenerateStream(request: {
  system?: string;
  prompt: string;
  temperature?: number;
  intent?: string;
}): Promise<AiStreamHandle> {
  const controller = new AbortController();
  // 一次性令牌：**每次**现领（核销即失效，缓存复用会让第二次续写 403）
  const token = await window.electronAPI!.ai.streamToken();
  const response = await window.fetch(`${AI_STREAM_ORIGIN}${AI_STREAM_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [AI_STREAM_TOKEN_HEADER]: token,
    },
    body: JSON.stringify({
      system: request.system,
      prompt: request.prompt,
      temperature: request.temperature,
      intent: request.intent,
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AiStreamRequestError(
      text || `流式请求失败（${response.status}）`,
      response.headers.get("x-ai-error-code") ?? undefined,
      response.status,
    );
  }
  if (!response.body) {
    throw new Error("流式响应缺少 body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let done = false;

  return {
    abort: () => {
      done = true;
      controller.abort();
      void reader.cancel().catch(() => {});
    },
    get done() {
      return done;
    },
    readChunk: async (): Promise<string | null> => {
      if (done) return null;
      const { value, done: streamDone } = await reader.read();
      if (streamDone) {
        // 冲刷解码器里残留的半个多字节字符（否则末字可能丢），再置结束标记
        const tail = decoder.decode();
        done = true;
        return tail || null;
      }
      // 返回本次解码出的片段；SSE 事件跨块的残片由上层 accumulator 自己拼接
      return decoder.decode(value, { stream: true });
    },
  };
}

/** 结构化生成结果：保留原文，附带按契约解析出的条目 */
export interface StructuredGenerateResult {
  /** 模型原始返回文本（text 格式直接用它） */
  text: string;
  /** 解析出的结构化条目（text 格式为空数组） */
  entries: AiEntry[];
  /** 是否为启发式兜底（JSON 解析失败，质量可能下降） */
  usedFallback: boolean;
}

/**
 * 按输出契约生成：主进程只负责拿回原文，**解析在本层完成**
 * （AGENTS.md §2.2.2.1：主进程不感知业务结构）。
 *
 * 解析失败不会整体失败——`parseOutput` 内建三层保险，仍会返回兜底条目；
 * 只有模型调用本身失败（网络 / 鉴权 / 超时）才返回 ok:false。
 */
export async function aiGenerateStructured(
  request: AiGenerateRequest & { outputFormat: OutputFormat },
): Promise<AiResult<StructuredGenerateResult>> {
  const { outputFormat, ...rest } = request;
  const result = await aiGenerate(rest);
  if (!result.ok) return result;

  const parsed = parseOutput(result.data.text, outputFormat, { limit: request.count });
  return {
    ok: true,
    data: {
      text: result.data.text,
      entries: parsed.entries,
      usedFallback: parsed.usedFallback,
    },
  };
}

/**
 * 写一条 AI 产品事件（M1a）。
 *
 * 供渲染层上报主进程请求出口看不到的**事后动作**：`adopt`（采纳）/ `edit`
 * （采纳后编辑）/ `cancel`（放弃）。失败静默，绝不阻塞写作主链路。
 */
export async function logAiEvent(payload: AiEventLogDTO): Promise<{ ok: boolean; error?: string }> {
  return window.electronAPI!.ai.logEvent(payload);
}

/** 看板聚合（M1b）：本月调用次数 / 各 intent 分布 / 采纳率 / 平均耗时 */
export async function getAiEventStats(since?: string): Promise<AiEventStatsDTO> {
  return window.electronAPI!.ai.stats(since ? { since } : undefined);
}

/** 导出 AI 诊断包（M1b）；用户取消或失败返回 null */
export async function exportAiDiagnostics(): Promise<{ path: string } | null> {
  return window.electronAPI!.ai.exportDiagnostics();
}
