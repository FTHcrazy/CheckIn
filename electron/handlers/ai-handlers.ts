/**
 * AI 模型调用 IPC handlers（AI 域，独立 ai.db）
 *
 * 这是 AI 请求在**主进程**发起的唯一通道，对 AGENTS.md §8.7「主进程不代理
 * HTTP」契约是**刻意豁免**（理由见 R-AI-03 架构决策第五节·A：凭据安全 + 端点
 * 无法枚举）。豁免的边界也在这里守住：
 *
 * - 只新增 `electronAPI.ai` 这一个语义化入口，**不是**通用 HTTP 转发通道；
 * - `api_key` 经 `safeStorage` 加密存 ai.db，解密只在主进程内部，Key 不下放；
 * - 发请求复用 `net.fetch`（Chromium 网络栈，自动跟随系统代理，无 CORS），
 *   与 `novel-font-handlers.ts` 同范式。
 *
 * 通道清单（首版）：
 * - `ai-config-get`  ：读当前用户 AI 配置（Key 解密后随内存返回，只供主进程用）
 * - `ai-config-save` ：保存 AI 配置（Key 加密落库）
 * - `ai-config-test` ：测试连接（Key 是否有效 / 地址是否可达 / 模型是否存在）
 * - `ai-generate`    ：非流式生成（起名增强用；流式留到润色/续写立项时再开）
 *
 * 边界：SQL 只出现在本文件与 ai-db.ts；不导入 novel 任何模块。
 */
import { BrowserWindow, dialog, ipcMain, net, safeStorage, shell } from "electron";
import fsp from "node:fs/promises";
import { aiAll, aiGet, aiRun, logAiEvent } from "../ai-db";
import { logAlways } from "../logger";
import { resolveWindowName } from "./log-handlers";
import { keyPageOf } from "../../src/shared/ai/ai-providers";
import { promptVersionOf } from "../../src/shared/ai/context/prompt/registry";

// ── 配置项 key 约定（ai_config.key）──
const KEY_PROVIDER = "provider"; // "openai" | "ollama"
const KEY_ENDPOINT = "endpoint"; // OpenAI 兼容地址（含 /v1）或 Ollama 地址
const KEY_MODEL = "model"; // 模型名
const KEY_API_KEY_ENC = "api_key_enc"; // safeStorage 加密串，无 Key（Ollama）时为空
const KEY_CONTEXT_LEN = "context_len"; // 上下文长度（用于截断策略）
const KEY_L3_ENABLED = "l3_enabled"; // L3 总开关（允许 AI 读取整章内容，M5）

// ── DTO（与 preload / electron.d.ts 保持一致）──

export type AiProvider = "openai" | "ollama";

export interface AiConfig {
  /** 是否已启用 AI（总开关，存 ai_config.enabled） */
  enabled: boolean;
  provider: AiProvider;
  endpoint: string;
  model: string;
  /** 是否已填 API Key（不返回明文；Ollama 无需 Key 恒为 false） */
  hasApiKey: boolean;
  contextLen: number;
  /** L3 总开关（允许 AI 读取整章内容，M5；默认关，首次触发 L3 功能时引导开启） */
  l3Enabled: boolean;
}

/** 统一调用结果：ok=true 带结果；ok=false 带归一化错误 */
export type AiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: AiErrorCode; message: string };

/** 错误码（R-AI-01 FR-10 错误归一的机器可读形态，渲染层按 code 定文案/交互） */
export type AiErrorCode =
  | "not_configured" // 未配置 AI / 未启用
  | "missing_key" // OpenAI 模式缺 Key
  | "invalid_endpoint" // 地址非法
  | "auth_invalid" // 401 Key 无效
  | "quota_exceeded" // 402 额度不足
  | "rate_limited" // 429 限流
  | "model_not_found" // 404 模型不存在
  | "timeout" // 超时
  | "network" // 网络不可达
  | "ollama_unavailable" // 本地 Ollama 未启动
  | "internal"; // 其它

/** 生成请求（首版非流式；起名增强走这条） */
export interface AiGenerateRequest {
  /** 系统提示词（可空，由调用方拼装，主进程不解释业务语义） */
  system?: string;
  /** 用户提示词（必填，描述/上下文） */
  prompt: string;
  /** 期望返回条数（起名用；模型不保证恰好返回该数量，客户端需过滤补齐） */
  count?: number;
  /** 采样温度（可空，用默认） */
  temperature?: number;
  /** 功能意图（naming / polish / test …），仅用于调用日志归类 */
  intent?: string;
}

export interface AiGenerateData {
  /** 模型原始返回文本 */
  text: string;
  /** 起名场景：解析出的名字列表；非起名场景为空数组 */
  items: string[];
}

/** 一条 AI 调用日志（ai_log 表行，见 ai-context-and-output-spec.md 第八节） */
export interface AiLogRow {
  id: number;
  intent: string;
  provider: string;
  model: string;
  system_prompt: string | null;
  user_prompt: string | null;
  raw_output: string | null;
  parsed_output: string | null;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number;
  prompt_version: string | null;
  created_at: string;
}

// ── 内部：配置读写（Key 加密/解密）──

function getConfig(key: string): string | null {
  const row = aiGet("SELECT value FROM ai_config WHERE key = ?", [key]) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setConfig(key: string, value: string): void {
  aiRun(
    "INSERT OR REPLACE INTO ai_config (key, value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))",
    [key, value],
  );
}

/** 读完整 AI 配置；Key 解密为内存明文（仅主进程内部持有，绝不返回渲染层） */
function readConfigInternal(): {
  enabled: boolean;
  provider: AiProvider;
  endpoint: string;
  model: string;
  apiKey: string;
  contextLen: number;
  l3Enabled: boolean;
} {
  const provider = (getConfig(KEY_PROVIDER) ?? "openai") as AiProvider;
  const endpoint = getConfig(KEY_ENDPOINT) ?? "";
  const model = getConfig(KEY_MODEL) ?? "";
  const apiKeyEnc = getConfig(KEY_API_KEY_ENC) ?? "";
  const contextLen = Number(getConfig(KEY_CONTEXT_LEN) ?? "32000");
  const enabled = getConfig("enabled") === "1";
  const l3Enabled = getConfig(KEY_L3_ENABLED) === "1";
  let apiKey = "";
  if (apiKeyEnc) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(apiKeyEnc, "base64"));
    } catch {
      // 解密失败（如系统换密钥 / 损坏）：视为无 Key，由上层归一为「密钥已失效」
      apiKey = "";
    }
  }
    return { enabled, provider, endpoint, model, apiKey, contextLen, l3Enabled };
}

/** 把 API Key 加密后落库（空串表示清空 Key） */
function persistApiKey(apiKey: string): void {
  if (!apiKey) {
    setConfig(KEY_API_KEY_ENC, "");
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // 加密不可用：拒绝保存 Key，绝不明文落盘（R-AI-04 预研点 3 的硬边界）
    throw new Error("系统不支持安全存储，无法保存 API Key");
  }
  const enc = safeStorage.encryptString(apiKey).toString("base64");
  setConfig(KEY_API_KEY_ENC, enc);
}

// ── 内部：请求路由 ──

/**
 * OpenAI 兼容地址规范化：**只做必要清理，不替用户补路径**。
 *
 * - 去尾部斜杠；
 * - 若用户直接粘贴了完整请求地址（结尾带 `/chat/completions`），剥掉该尾部
 *   保留 base（否则后续拼 `/chat/completions` 会双重路径）；
 * - **不再自动补 `/v1`**：各家版本路径不一（/v1、/v2、/v4、/compatible-mode/v1），
 *   自动补会篡改用户意图（如讯飞 /v2 被拼成 /v2/v1）。缺版本段时由服务端
 *   报错 + 提示文案引导用户自己补全。
 */
function normalizeOpenAiEndpoint(endpoint: string): string {
  let url = endpoint.trim().replace(/\/+$/, "");
  if (!url) return "";
  url = url.replace(/\/chat\/completions$/i, "");
  return url;
}

/** 构造 OpenAI 兼容的 /chat/completions 请求 */
function buildOpenAiRequest(cfg: ReturnType<typeof readConfigInternal>, req: AiGenerateRequest) {
  const endpoint = normalizeOpenAiEndpoint(cfg.endpoint);
  const messages: Array<{ role: string; content: string }> = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: req.prompt });
  return {
    url: `${endpoint}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      "User-Agent": "CheckIn",
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: req.temperature,
      // 起名要一批：让模型尽量多返回；具体数量由客户端解析后过滤
      n: 1,
      stream: false,
    }),
  };
}

/** 构造 Ollama /api/generate 请求（本地模型，无 Key） */
function buildOllamaRequest(cfg: ReturnType<typeof readConfigInternal>, req: AiGenerateRequest) {
  const base = cfg.endpoint.trim().replace(/\/+$/, "");
  const prompt = req.system ? `${req.system}\n\n${req.prompt}` : req.prompt;
  return {
    url: `${base}/api/generate`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      prompt,
      stream: false,
      options: req.temperature != null ? { temperature: req.temperature } : undefined,
    }),
  };
}

/** 从 HTTP 状态码归一错误 */
function httpStatusToError(status: number): AiErrorCode {
  if (status === 401) return "auth_invalid";
  if (status === 402) return "quota_exceeded";
  if (status === 429) return "rate_limited";
  if (status === 404) return "model_not_found";
  return "internal";
}

/** 从网络异常信息归一错误 */
function networkErrorToCode(raw: string): AiErrorCode {
  if (/timed?\s?out|timeout/i.test(raw)) return "timeout";
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|ERR_|network/i.test(raw)) return "network";
  return "internal";
}

/** 错误码 → 可读文案（渲染层可直接展示；也按 code 走专属交互） */
export function aiErrorMessage(code: AiErrorCode): string {
  switch (code) {
    case "not_configured":
      return "尚未配置 AI，请先在设置里启用并填写模型";
    case "missing_key":
      return "未填写 API Key，请先在设置里配置";
    case "invalid_endpoint":
      return "模型接口地址无效，请检查";
    case "auth_invalid":
      return "API Key 无效（401），请重新填写";
    case "quota_exceeded":
      return "模型额度不足（402），请充值或更换 Key";
    case "rate_limited":
      return "请求过于频繁（429），请稍后再试";
    case "model_not_found":
      return "接口返回 404：请检查模型名是否正确，或接口地址是否为 OpenAI 兼容的 base 地址（如 https://xxx/v1）";
    case "timeout":
      return "请求超时，请检查网络后重试";
    case "network":
      return "网络连接失败，请检查网络或代理设置";
    case "ollama_unavailable":
      return "本地 Ollama 未启动，请先启动 Ollama";
    case "internal":
      return "AI 调用失败，请稍后重试";
  }
}

// ── 内部：调用日志（调优支撑，见 ai-context-and-output-spec.md 第八节）──

/** 日志字段长度上限：避免长章节/长输出撑爆日志表 */
const LOG_TEXT_LIMIT = 4000;

function truncateForLog(text: string | undefined): string {
  if (!text) return "";
  return text.length > LOG_TEXT_LIMIT ? `${text.slice(0, LOG_TEXT_LIMIT)}…` : text;
}

/** 本地日志里的 prompt/output 预览长度（DEBUG 级，够复盘又不至于把文件撑爆） */
const LOG_PREVIEW_CHARS = 600;

function preview(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.length > LOG_PREVIEW_CHARS ? `${text.slice(0, LOG_PREVIEW_CHARS)}…` : text;
}

/**
 * 落一条 AI 调用日志（成功/失败都记）。
 *
 * 双通道：
 * - `ai_log` 表：结构化、可查询（设置页「调用日志」用）；
 * - **本地日志（DEBUG 级）**：并入所属窗口当天的 `YYYY-MM-DD.log`，
 *   与业务日志同一时间轴，排查「AI 慢 / 失败」时不必再对两个文件。
 *
 * ⚠️ 脱敏铁律：日志绝不含明文 API Key——Key 在请求 header 里，不在 body，
 * 这里的 system/prompt/output 天然不含 Key；只做长度截断。
 */
function appendAiLog(entry: {
  /** 发起调用的窗口名（由 IPC 事件反查，渲染层不自报） */
  window: string;
  intent: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  userPrompt?: string;
  rawOutput?: string;
  parsedOutput?: string;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
}): void {
  const ok = !entry.errorCode;
  const promptVersion = promptVersionOf(entry.intent) || null;

  // 本地 DEBUG 日志：与窗口业务日志同一时间轴。
  // 用 logAlways 而不是 log：默认 info 级别下，AI 调用的提示词与输出会全部消失，
  // 而那正是「模型为什么答歪了」的唯一线索（与 §6.3.1 的 IPC 记录同一口径）。
  logAlways(
    "debug",
    entry.window,
    "ai",
    `${ok ? "ok" : "fail"} ${entry.intent} ${entry.provider}/${entry.model} ${entry.durationMs}ms`,
    {
      ...(ok ? {} : { code: entry.errorCode, message: entry.errorMessage }),
      system: preview(entry.systemPrompt),
      prompt: preview(entry.userPrompt),
      output: preview(entry.rawOutput),
      ...(entry.parsedOutput ? { parsed: preview(entry.parsedOutput) } : {}),
    },
  );
  // 失败额外提一级：调 prompt 时最常看的就是「哪几次挂了、挂在哪」
  if (!ok) {
    logAlways("warn", entry.window, "ai", `调用失败 ${entry.intent}：${entry.errorMessage ?? ""}`, {
      code: entry.errorCode,
    });
  }

  try {
    aiRun(
      `INSERT INTO ai_log
        (intent, provider, model, system_prompt, user_prompt, raw_output,
         parsed_output, error_code, error_message, duration_ms, prompt_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.intent,
        entry.provider,
        entry.model,
        truncateForLog(entry.systemPrompt),
        truncateForLog(entry.userPrompt),
        truncateForLog(entry.rawOutput),
        truncateForLog(entry.parsedOutput),
        entry.errorCode ?? null,
        entry.errorMessage ?? null,
        entry.durationMs,
        promptVersion,
      ],
    );
  } catch (error) {
    // 日志写入失败不应影响主调用结果，静默忽略（但留一行 console 便于排查）
    const raw = error instanceof Error ? error.message : String(error);
    console.warn(`[ai-log] 写入失败: ${raw}`);
  }
}

// ── 内部：核心调用（非流式）──

async function generateInternal(
  req: AiGenerateRequest,
  windowName: string,
): Promise<AiResult<AiGenerateData>> {
  const startedAt = Date.now();
  const intent = req.intent?.trim() || "generate";
  const cfg = readConfigInternal();

  /** 统一的落日志入口：成功/失败都记，字段按需覆盖 */
  const writeLog = (fields: {
    rawOutput?: string;
    parsedOutput?: string;
    errorCode?: AiErrorCode;
    errorMessage?: string;
  }): void =>
    appendAiLog({
      window: windowName,
      intent,
      provider: cfg.provider,
      model: cfg.model || "(未设置)",
      systemPrompt: req.system,
      userPrompt: req.prompt,
      durationMs: Date.now() - startedAt,
      ...fields,
    });

  /** 统一的落产品事件入口（M1a）：trigger 一次 + 终态一次，均只记元数据 */
  const writeEvent = (step: "trigger" | "success" | "fallback", fields?: {
    durationMs?: number;
    errorCode?: string;
    itemCount?: number;
    charCount?: number;
    scope?: string;
  }): void =>
    logAiEvent({
      intent,
      step,
      provider: cfg.provider || undefined,
      model: cfg.model?.trim() || undefined,
      promptVer: promptVersionOf(intent) || undefined,
      durationMs: fields?.durationMs,
      errorCode: fields?.errorCode,
      itemCount: fields?.itemCount,
      charCount: fields?.charCount,
      scope: fields?.scope,
    });

  writeEvent("trigger", {
    // 只记字数不记正文（合规白名单，见 ai-domain-guard.test.ts）
    charCount: req.prompt.length,
  });

  if (!cfg.enabled) {
    const code: AiErrorCode = "not_configured";
    writeLog({ errorCode: code, errorMessage: aiErrorMessage(code) });
    writeEvent("fallback", { durationMs: Date.now() - startedAt, errorCode: code });
    return { ok: false, code, message: aiErrorMessage(code) };
  }
  if (!cfg.endpoint.trim()) {
    const code: AiErrorCode = "invalid_endpoint";
    writeLog({ errorCode: code, errorMessage: aiErrorMessage(code) });
    writeEvent("fallback", { durationMs: Date.now() - startedAt, errorCode: code });
    return { ok: false, code, message: aiErrorMessage(code) };
  }
  if (cfg.provider === "openai" && !cfg.apiKey) {
    const code: AiErrorCode = "missing_key";
    writeLog({ errorCode: code, errorMessage: aiErrorMessage(code) });
    writeEvent("fallback", { durationMs: Date.now() - startedAt, errorCode: code });
    return { ok: false, code, message: aiErrorMessage(code) };
  }
  if (!cfg.model.trim()) {
    const code: AiErrorCode = "model_not_found";
    const message = "未指定模型名，请先在设置里配置";
    writeLog({ errorCode: code, errorMessage: message });
    writeEvent("fallback", { durationMs: Date.now() - startedAt, errorCode: code });
    return { ok: false, code, message };
  }

  const reqSpec =
    cfg.provider === "ollama"
      ? buildOllamaRequest(cfg, req)
      : buildOpenAiRequest(cfg, req);

  try {
    const response = await net.fetch(reqSpec.url, {
      method: "POST",
      headers: reqSpec.headers,
      body: reqSpec.body,
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const code = httpStatusToError(response.status);
      writeLog({ errorCode: code, errorMessage: aiErrorMessage(code) });
      writeEvent("fallback", { durationMs: Date.now() - startedAt, errorCode: code });
      return { ok: false, code, message: aiErrorMessage(code) };
    }

    const raw = await response.text();
    const text = cfg.provider === "ollama" ? parseOllamaResponse(raw) : parseOpenAiResponse(raw);
    const items = splitNameItems(text);
    writeLog({ rawOutput: text, parsedOutput: JSON.stringify(items) });
    writeEvent("success", {
      durationMs: Date.now() - startedAt,
      itemCount: items.length,
    });
    return { ok: true, data: { text, items } };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const code: AiErrorCode =
      cfg.provider === "ollama" && /ECONNREFUSED|fetch failed/i.test(rawMsg)
        ? "ollama_unavailable"
        : networkErrorToCode(rawMsg);
    writeLog({ errorCode: code, errorMessage: aiErrorMessage(code) });
    writeEvent("fallback", { durationMs: Date.now() - startedAt, errorCode: code });
    return { ok: false, code, message: aiErrorMessage(code) };
  }
}

/** OpenAI 兼容响应：choices[0].message.content */
function parseOpenAiResponse(raw: string): string {
  try {
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? "";
  } catch {
    return "";
  }
}

/** Ollama 响应：response 字段 */
function parseOllamaResponse(raw: string): string {
  try {
    const json = JSON.parse(raw) as { response?: string };
    return json.response ?? "";
  } catch {
    return "";
  }
}

/** 把模型返回的文本拆成名字列表（按换行 / 顿号 / 逗号 / 序号前缀切） */
function splitNameItems(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(\d+[.、)）]|[-*·•])\s*/, "").trim())
    .filter(Boolean);
  // 若模型返回单行多个名字（顿号/逗号分隔），再切一次
  const out: string[] = [];
  for (const line of cleaned) {
    for (const part of line.split(/[、,，;；]/)) {
      const p = part.trim();
      if (p) out.push(p);
    }
  }
  return out;
}

// ── 内部：测试连接 ──

async function testConnectionInternal(windowName: string): Promise<AiResult<{ message: string }>> {
  const startedAt = Date.now();
  const cfg = readConfigInternal();
  const model = cfg.model || "(未设置)";

  /** 测试连接同样落日志（intent=test），便于排查「配置看着对却连不上」 */
  const writeLog = (fields: { errorCode?: AiErrorCode; errorMessage?: string }): void =>
    appendAiLog({
      window: windowName,
      intent: "test",
      provider: cfg.provider,
      model,
      durationMs: Date.now() - startedAt,
      ...fields,
    });

  if (!cfg.endpoint.trim()) {
    const code: AiErrorCode = "invalid_endpoint";
    writeLog({ errorCode: code, errorMessage: aiErrorMessage(code) });
    return { ok: false, code, message: aiErrorMessage(code) };
  }
  if (cfg.provider === "openai" && !cfg.apiKey) {
    const code: AiErrorCode = "missing_key";
    writeLog({ errorCode: code, errorMessage: aiErrorMessage(code) });
    return { ok: false, code, message: aiErrorMessage(code) };
  }

  try {
    if (cfg.provider === "ollama") {
      // Ollama：探测 /api/tags（列出已装模型，2s 短超时）
      const base = cfg.endpoint.trim().replace(/\/+$/, "");
      const response = await net.fetch(`${base}/api/tags`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) {
        writeLog({
          errorCode: "ollama_unavailable",
          errorMessage: aiErrorMessage("ollama_unavailable"),
        });
        return { ok: false, code: "ollama_unavailable", message: aiErrorMessage("ollama_unavailable") };
      }
      writeLog({});
      return { ok: true, data: { message: "已连接到本地 Ollama" } };
    }

    // OpenAI 兼容：发一个最小 chat 请求验证 Key + 模型（1 token 探活）
    const endpoint = normalizeOpenAiEndpoint(cfg.endpoint);
    const response = await net.fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const code = httpStatusToError(response.status);
      writeLog({ errorCode: code, errorMessage: aiErrorMessage(code) });
      return { ok: false, code, message: aiErrorMessage(code) };
    }
    writeLog({});
    return { ok: true, data: { message: "连接成功" } };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const code: AiErrorCode =
      cfg.provider === "ollama" && /ECONNREFUSED|fetch failed/i.test(rawMsg)
        ? "ollama_unavailable"
        : networkErrorToCode(rawMsg);
    writeLog({ errorCode: code, errorMessage: aiErrorMessage(code) });
    return { ok: false, code, message: aiErrorMessage(code) };
  }
}

// ── 注册 ──

export function registerAiHandlers(): void {
  // 读配置（Key 永不返回：只回 hasApiKey 布尔）
  ipcMain.handle("ai-config-get", async (): Promise<AiConfig> => {
    const cfg = readConfigInternal();
    return {
      enabled: cfg.enabled,
      provider: cfg.provider,
      endpoint: cfg.endpoint,
      model: cfg.model,
      hasApiKey: cfg.apiKey.length > 0,
      contextLen: cfg.contextLen,
      l3Enabled: cfg.l3Enabled,
    };
  });

  // 保存配置；apiKey 传空串 = 清空，传非空 = 覆盖
  ipcMain.handle(
    "ai-config-save",
    async (
      _event,
      payload: {
        enabled?: boolean;
        provider?: AiProvider;
        endpoint?: string;
        model?: string;
        apiKey?: string;
        contextLen?: number;
        l3Enabled?: boolean;
      } | undefined,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!payload || typeof payload !== "object") {
        return { ok: false, error: "参数无效" };
      }
      try {
        if (typeof payload.enabled === "boolean") {
          setConfig("enabled", payload.enabled ? "1" : "0");
        }
        if (typeof payload.provider === "string") {
          if (payload.provider !== "openai" && payload.provider !== "ollama") {
            return { ok: false, error: "未知模型服务类型" };
          }
          setConfig(KEY_PROVIDER, payload.provider);
        }
        if (typeof payload.endpoint === "string") {
          setConfig(KEY_ENDPOINT, payload.endpoint.trim());
        }
        if (typeof payload.model === "string") {
          setConfig(KEY_MODEL, payload.model.trim());
        }
        if (typeof payload.apiKey === "string") {
          persistApiKey(payload.apiKey.trim());
        }
        if (typeof payload.contextLen === "number" && payload.contextLen > 0) {
          setConfig(KEY_CONTEXT_LEN, String(Math.floor(payload.contextLen)));
        }
        if (typeof payload.l3Enabled === "boolean") {
          setConfig(KEY_L3_ENABLED, payload.l3Enabled ? "1" : "0");
        }
        return { ok: true };
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        return { ok: false, error: raw || "保存失败" };
      }
    },
  );

  // 测试连接
  ipcMain.handle(
    "ai-config-test",
    async (event): Promise<AiResult<{ message: string }>> =>
      testConnectionInternal(resolveWindowName(event.sender)),
  );

  // 非流式生成（起名增强）
  ipcMain.handle(
    "ai-generate",
    async (event, payload: AiGenerateRequest | undefined): Promise<AiResult<AiGenerateData>> => {
      const windowName = resolveWindowName(event.sender);
      if (!payload || typeof payload.prompt !== "string" || payload.prompt.trim().length === 0) {
        return { ok: false, code: "internal", message: "生成描述不能为空" };
      }
      return generateInternal(
        {
          system: typeof payload.system === "string" ? payload.system : undefined,
          prompt: payload.prompt,
          count: typeof payload.count === "number" ? payload.count : undefined,
          temperature: typeof payload.temperature === "number" ? payload.temperature : undefined,
          intent: typeof payload.intent === "string" ? payload.intent : undefined,
        },
        windowName,
      );
    },
  );

  // 调用日志：分页查询（倒序），供调优复盘
  ipcMain.handle(
    "ai-log-list",
    async (
      _event,
      payload: { limit?: number; offset?: number; intent?: string } | undefined,
    ): Promise<{ items: AiLogRow[]; total: number }> => {
      const limit = Math.min(Math.max(Number(payload?.limit) || 50, 1), 200);
      const offset = Math.max(Number(payload?.offset) || 0, 0);
      /*
       * 按 intent 过滤在 SQL 里做而不是取回前端再筛：日志是分页的，
       * 前端筛选只能筛「当前这一页」，会得到「筛完只剩 2 条」的假空态。
       */
      const intent = typeof payload?.intent === "string" ? payload.intent.trim() : "";
      const where = intent ? "WHERE intent = ?" : "";
      const filterArgs: unknown[] = intent ? [intent] : [];
      const totalRow = aiGet(`SELECT COUNT(*) AS c FROM ai_log ${where}`, filterArgs) as
        | { c: number }
        | undefined;
      const total = totalRow?.c ?? 0;
      const items = aiAll(
        `SELECT id, intent, provider, model, system_prompt, user_prompt, raw_output, parsed_output, error_code, error_message, duration_ms, prompt_version, created_at FROM ai_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...filterArgs, limit, offset],
      ) as AiLogRow[];
      return { items, total };
    },
  );

  // 调用日志：清空
  ipcMain.handle("ai-log-clear", async (): Promise<{ ok: boolean }> => {
    try {
      aiRun("DELETE FROM ai_log");
      return { ok: true };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      console.warn(`[ai-log] 清空失败: ${raw}`);
      return { ok: false };
    }
  });

  /**
   * 列出本地 Ollama 已下载的模型（R-AI-01 FR-06）。
   *
   * 走 Ollama 原生 `/api/tags`（不是 OpenAI 兼容端点，返回结构不同）。
   * 让用户从列表里选而不是手打模型名：手打错一个字符，要到「测试连接」
   * 才报「模型不存在」，而且很难看出错在哪。
   *
   * 只读探测，不读配置里的 Key、不写 ai_log（它不属于「AI 调用」，
   * 进了日志会污染耗时统计）。
   */
  ipcMain.handle(
    "ai-ollama-models",
    async (
      event,
      payload?: { endpoint?: string },
    ): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> => {
      const endpoint =
        (payload?.endpoint ?? "").trim() ||
        readConfigInternal().endpoint ||
        "http://localhost:11434";
      const url = `${endpoint.replace(/\/+$/, "")}/api/tags`;
      try {
        const response = await net.fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) {
          return { ok: false, error: `本地服务返回 ${response.status}` };
        }
        const json = (await response.json()) as {
          models?: Array<{ name?: string; model?: string }>;
        };
        const models = (json.models ?? [])
          .map((item) => (item.name ?? item.model ?? "").trim())
          .filter((name) => name.length > 0);
        return { ok: true, models };
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        logAlways("debug", resolveWindowName(event.sender), "ai", `[ollama] 列模型失败: ${raw}`);
        return {
          ok: false,
          error: /ECONNREFUSED|fetch failed/i.test(raw)
            ? "未检测到本地 Ollama 服务，请先启动 Ollama"
            : "读取模型列表超时，请检查服务地址",
        };
      }
    },
  );

  /**
   * 打开服务商的「申请 API Key」页面（R-AI-01 FR-05）。
   *
   * 渲染层只传 endpoint，URL 由主进程用 `keyPageOf` 查表得到 ——
   * `shell.openExternal` 的入参永远来自受控常量，不是调用方给的任意地址。
   * 未收录的服务商返回 `ok:false`，界面据此不显示入口。
   */
  ipcMain.handle(
    "ai-open-key-page",
    async (event, payload?: { endpoint?: string }): Promise<{ ok: boolean }> => {
      const endpoint = (payload?.endpoint ?? "").trim() || readConfigInternal().endpoint;
      const url = keyPageOf(endpoint);
      if (!url) return { ok: false };
      try {
        await shell.openExternal(url);
        return { ok: true };
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        logAlways("warn", resolveWindowName(event.sender), "ai", `[key-page] 打开失败: ${raw}`);
        return { ok: false };
      }
    },
  );

  // ── M1a / M1b：产品事件落库与看板聚合 ────────────────────────────────

  /**
   * 写一条 AI 产品事件（M1a）。
   *
   * 供渲染层上报**主进程请求出口看不到的事后动作**：`adopt`（采纳）/ `edit`
   * （采纳后编辑）/ `cancel`（放弃）。这些发生在请求返回之后数秒到数分钟，
   * 只能由渲染层主动回传；主进程侧只做白名单校验 + 落库，不信任任意字段。
   */
  ipcMain.handle(
    "ai-event-log",
    async (
      _event,
      payload:
        | {
            intent?: unknown;
            step?: unknown;
            provider?: unknown;
            model?: unknown;
            promptVer?: unknown;
            durationMs?: unknown;
            errorCode?: unknown;
            itemCount?: unknown;
            charCount?: unknown;
            scope?: unknown;
          }
        | undefined,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!payload || typeof payload !== "object") {
        return { ok: false, error: "参数无效" };
      }
      const intent = typeof payload.intent === "string" ? payload.intent.trim() : "";
      const step = typeof payload.step === "string" ? payload.step.trim() : "";
      if (!intent || !step) return { ok: false, error: "事件意图或步骤缺失" };

      // 只白名单 step，防止渲染层塞入任意枚举值污染聚合
      const STEPS = new Set(["trigger", "success", "fallback", "adopt", "edit", "cancel"]);
      if (!STEPS.has(step)) return { ok: false, error: "未知事件步骤" };

      const asOptionalString = (value: unknown): string | undefined =>
        typeof value === "string" && value.trim() ? value.trim() : undefined;
      const asOptionalNumber = (value: unknown): number | undefined =>
        typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;

      logAiEvent({
        intent,
        step: step as "trigger" | "success" | "fallback" | "adopt" | "edit" | "cancel",
        provider: asOptionalString(payload.provider),
        model: asOptionalString(payload.model),
        promptVer: asOptionalString(payload.promptVer),
        durationMs: asOptionalNumber(payload.durationMs),
        errorCode: asOptionalString(payload.errorCode),
        itemCount: asOptionalNumber(payload.itemCount),
        charCount: asOptionalNumber(payload.charCount),
        scope: asOptionalString(payload.scope),
      });
      return { ok: true };
    },
  );

  /**
   * 看板聚合查询（M1b）。
   *
   * 回答看板四个问题：本月调用次数、各 intent 分布、采纳率、平均耗时。
   * 全部下推到 SQL（不整表捞回前端算）；时间窗只取 `ai_event`，`trigger`
   * 算「一次调用」，`adopt` 算「一次采纳」。
   */
  ipcMain.handle(
    "ai-event-stats",
    async (
      _event,
      payload?: { since?: string },
    ): Promise<{
      totalCalls: number;
      adoptCount: number;
      adoptRate: number;
      avgDurationMs: number;
      byIntent: Array<{ intent: string; calls: number; adopts: number }>;
    }> => {
      // 默认最近 30 天；`since` 由看板传时间下界（`datetime('now','-30 days','localtime')`）
      const since = typeof payload?.since === "string" && payload.since.trim()
        ? payload.since.trim()
        : null;
      // 参数绑定（防 SQL 注入）：时间下界一律走 `?`，绝不拼接用户输入
      const sinceArgs = since ? [since] : [];
      const sinceCond = since ? "AND created_at >= ?" : "";

      const callRow = aiGet(
        `SELECT COUNT(*) AS c, COALESCE(AVG(duration_ms), 0) AS avg_dur
         FROM ai_event WHERE step = 'trigger' ${sinceCond}`,
        sinceArgs,
      ) as { c: number; avg_dur: number } | undefined;

      const adoptRow = aiGet(
        `SELECT COUNT(*) AS c FROM ai_event WHERE step = 'adopt' ${sinceCond}`,
        sinceArgs,
      ) as { c: number } | undefined;

      const totalCalls = callRow?.c ?? 0;
      const adoptCount = adoptRow?.c ?? 0;

      const byIntent = aiAll(
        `SELECT intent,
                SUM(CASE WHEN step = 'trigger' THEN 1 ELSE 0 END) AS calls,
                SUM(CASE WHEN step = 'adopt' THEN 1 ELSE 0 END) AS adopts
         FROM ai_event
         WHERE step IN ('trigger', 'adopt') ${sinceCond}
         GROUP BY intent
         ORDER BY calls DESC`,
        sinceArgs,
      ) as Array<{ intent: string; calls: number; adopts: number }>;

      return {
        totalCalls,
        adoptCount,
        adoptRate: totalCalls > 0 ? adoptCount / totalCalls : 0,
        avgDurationMs: Math.round(callRow?.avg_dur ?? 0),
        byIntent: byIntent.map((row) => ({
          intent: row.intent,
          calls: Number(row.calls) || 0,
          adopts: Number(row.adopts) || 0,
        })),
      };
    },
  );

  /**
   * 导出 AI 诊断包（M1b）。
   *
   * 只出 `ai_event` + 脱敏的 `ai_log` 元数据（intent / model / duration_ms /
   * error_code），**绝不含正文截断、作品名、邮箱、Key**（字段白名单，见
   * `ai-domain-guard.test.ts`）。这是语义化单通道（只导出 AI 诊断包），不享有
   * §8.7 的网络豁免，也不复用 novel 域的保存通道（域边界）。
   */
  ipcMain.handle(
    "ai-export-diagnostics",
    async (event): Promise<{ path: string } | null> => {
      const events = aiAll(
        `SELECT intent, step, provider, model, prompt_ver, duration_ms,
                error_code, item_count, char_count, scope, created_at
         FROM ai_event ORDER BY id DESC LIMIT 5000`,
      );
      const logs = aiAll(
        `SELECT intent, provider, model, duration_ms, error_code, prompt_version, created_at
         FROM ai_log ORDER BY id DESC LIMIT 2000`,
      );

      const payload = JSON.stringify(
        {
          exported_at: new Date().toISOString(),
          schema: "checkin-ai-diagnostics-v1",
          ai_event: events,
          ai_log: logs,
        },
        null,
        2,
      );

      const options = {
        title: "导出 AI 诊断包",
        defaultPath: `ai-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON 文件", extensions: ["json"] }],
      };
      const win = BrowserWindow.fromWebContents(event.sender);
      const result =
        win && !win.isDestroyed()
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;

      await fsp.writeFile(result.filePath, payload, "utf8");
      return { path: result.filePath };
    },
  );
}
