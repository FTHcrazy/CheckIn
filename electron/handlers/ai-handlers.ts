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
import { ipcMain, net, safeStorage } from "electron";
import { aiAll, aiGet, aiRun } from "../ai-db";

// ── 配置项 key 约定（ai_config.key）──
const KEY_PROVIDER = "provider"; // "openai" | "ollama"
const KEY_ENDPOINT = "endpoint"; // OpenAI 兼容地址（含 /v1）或 Ollama 地址
const KEY_MODEL = "model"; // 模型名
const KEY_API_KEY_ENC = "api_key_enc"; // safeStorage 加密串，无 Key（Ollama）时为空
const KEY_CONTEXT_LEN = "context_len"; // 上下文长度（用于截断策略）

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
} {
  const provider = (getConfig(KEY_PROVIDER) ?? "openai") as AiProvider;
  const endpoint = getConfig(KEY_ENDPOINT) ?? "";
  const model = getConfig(KEY_MODEL) ?? "";
  const apiKeyEnc = getConfig(KEY_API_KEY_ENC) ?? "";
  const contextLen = Number(getConfig(KEY_CONTEXT_LEN) ?? "32000");
  const enabled = getConfig("enabled") === "1";
  let apiKey = "";
  if (apiKeyEnc) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(apiKeyEnc, "base64"));
    } catch {
      // 解密失败（如系统换密钥 / 损坏）：视为无 Key，由上层归一为「密钥已失效」
      apiKey = "";
    }
  }
  return { enabled, provider, endpoint, model, apiKey, contextLen };
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

/**
 * 落一条 AI 调用日志（成功/失败都记）。
 *
 * ⚠️ 脱敏铁律：日志绝不含明文 API Key——Key 在请求 header 里，不在 body，
 * 这里的 system/prompt/output 天然不含 Key；只做长度截断。
 */
function appendAiLog(entry: {
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
  try {
    aiRun(
      `INSERT INTO ai_log
        (intent, provider, model, system_prompt, user_prompt, raw_output,
         parsed_output, error_code, error_message, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
    );
  } catch (error) {
    // 日志写入失败不应影响主调用结果，静默忽略（但留一行 console 便于排查）
    const raw = error instanceof Error ? error.message : String(error);
    console.warn(`[ai-log] 写入失败: ${raw}`);
  }
}

// ── 内部：核心调用（非流式）──

async function generateInternal(req: AiGenerateRequest): Promise<AiResult<AiGenerateData>> {
  const startedAt = Date.now();
  const cfg = readConfigInternal();
  if (!cfg.enabled) return { ok: false, code: "not_configured", message: aiErrorMessage("not_configured") };
  if (!cfg.endpoint.trim()) {
    return { ok: false, code: "invalid_endpoint", message: aiErrorMessage("invalid_endpoint") };
  }
  if (cfg.provider === "openai" && !cfg.apiKey) {
    return { ok: false, code: "missing_key", message: aiErrorMessage("missing_key") };
  }
  if (!cfg.model.trim()) {
    return { ok: false, code: "model_not_found", message: "未指定模型名，请先在设置里配置" };
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
      appendAiLog({
        intent: "generate",
        provider: cfg.provider,
        model: cfg.model,
        systemPrompt: req.system,
        userPrompt: req.prompt,
        errorCode: code,
        errorMessage: aiErrorMessage(code),
        durationMs: Date.now() - startedAt,
      });
      return { ok: false, code, message: aiErrorMessage(code) };
    }

    const raw = await response.text();
    const text = cfg.provider === "ollama" ? parseOllamaResponse(raw) : parseOpenAiResponse(raw);
    const items = splitNameItems(text);
    appendAiLog({
      intent: "generate",
      provider: cfg.provider,
      model: cfg.model,
      systemPrompt: req.system,
      userPrompt: req.prompt,
      rawOutput: text,
      parsedOutput: JSON.stringify(items),
      durationMs: Date.now() - startedAt,
    });
    return { ok: true, data: { text, items } };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const code =
      cfg.provider === "ollama" && /ECONNREFUSED|fetch failed/i.test(rawMsg)
        ? "ollama_unavailable"
        : networkErrorToCode(rawMsg);
    appendAiLog({
      intent: "generate",
      provider: cfg.provider,
      model: cfg.model,
      systemPrompt: req.system,
      userPrompt: req.prompt,
      errorCode: code,
      errorMessage: aiErrorMessage(code),
      durationMs: Date.now() - startedAt,
    });
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

async function testConnectionInternal(): Promise<AiResult<{ message: string }>> {
  const startedAt = Date.now();
  const cfg = readConfigInternal();
  const model = cfg.model || "(未设置)";
  if (!cfg.endpoint.trim()) {
    return { ok: false, code: "invalid_endpoint", message: aiErrorMessage("invalid_endpoint") };
  }
  if (cfg.provider === "openai" && !cfg.apiKey) {
    return { ok: false, code: "missing_key", message: aiErrorMessage("missing_key") };
  }

  try {
    if (cfg.provider === "ollama") {
      // Ollama：探测 /api/tags（列出已装模型，2s 短超时）
      const base = cfg.endpoint.trim().replace(/\/+$/, "");
      const response = await net.fetch(`${base}/api/tags`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) {
        appendAiLog({
          intent: "test",
          provider: cfg.provider,
          model,
          errorCode: "ollama_unavailable",
          errorMessage: aiErrorMessage("ollama_unavailable"),
          durationMs: Date.now() - startedAt,
        });
        return { ok: false, code: "ollama_unavailable", message: aiErrorMessage("ollama_unavailable") };
      }
      appendAiLog({ intent: "test", provider: cfg.provider, model, durationMs: Date.now() - startedAt });
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
      appendAiLog({
        intent: "test",
        provider: cfg.provider,
        model,
        errorCode: code,
        errorMessage: aiErrorMessage(code),
        durationMs: Date.now() - startedAt,
      });
      return { ok: false, code, message: aiErrorMessage(code) };
    }
    appendAiLog({ intent: "test", provider: cfg.provider, model, durationMs: Date.now() - startedAt });
    return { ok: true, data: { message: "连接成功" } };
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const code =
      cfg.provider === "ollama" && /ECONNREFUSED|fetch failed/i.test(rawMsg)
        ? "ollama_unavailable"
        : networkErrorToCode(rawMsg);
    appendAiLog({
      intent: "test",
      provider: cfg.provider,
      model,
      errorCode: code,
      errorMessage: aiErrorMessage(code),
      durationMs: Date.now() - startedAt,
    });
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
        return { ok: true };
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        return { ok: false, error: raw || "保存失败" };
      }
    },
  );

  // 测试连接
  ipcMain.handle("ai-config-test", async (): Promise<AiResult<{ message: string }>> => {
    return testConnectionInternal();
  });

  // 非流式生成（起名增强）
  ipcMain.handle(
    "ai-generate",
    async (_event, payload: AiGenerateRequest | undefined): Promise<AiResult<AiGenerateData>> => {
      if (!payload || typeof payload.prompt !== "string" || payload.prompt.trim().length === 0) {
        return { ok: false, code: "internal", message: "生成描述不能为空" };
      }
      return generateInternal({
        system: typeof payload.system === "string" ? payload.system : undefined,
        prompt: payload.prompt,
        count: typeof payload.count === "number" ? payload.count : undefined,
        temperature: typeof payload.temperature === "number" ? payload.temperature : undefined,
      });
    },
  );

  // 调用日志：分页查询（倒序），供调优复盘
  ipcMain.handle(
    "ai-log-list",
    async (
      _event,
      payload: { limit?: number; offset?: number } | undefined,
    ): Promise<{ items: AiLogRow[]; total: number }> => {
      const limit = Math.min(Math.max(Number(payload?.limit) || 50, 1), 200);
      const offset = Math.max(Number(payload?.offset) || 0, 0);
      const totalRow = aiGet("SELECT COUNT(*) AS c FROM ai_log") as { c: number } | undefined;
      const total = totalRow?.c ?? 0;
      const items = aiAll(
        "SELECT id, intent, provider, model, system_prompt, user_prompt, raw_output, parsed_output, error_code, error_message, duration_ms, created_at FROM ai_log ORDER BY id DESC LIMIT ? OFFSET ?",
        [limit, offset],
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
}
