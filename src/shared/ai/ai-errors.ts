/**
 * AI 错误归一（渲染进程侧）
 *
 * 主进程已经把网络/HTTP 异常归一为 `AiErrorCode` 并带上 `message`，本文件只做
 * 两件事：
 * 1. 提供「错误码 → 默认文案」的兜底映射（主进程 message 缺失时用）；
 * 2. 提供「错误码 → 交互建议」的归类，让调用方决定「要不要引导去设置页」。
 *
 * 原则：错误**不白屏、不转圈**，每条都落到可读文案（R-AI-01 FR-10）。
 */

import type { AiErrorCode } from "./ai-types";

/** 错误码 → 默认文案（主进程已带 message 时优先用 message） */
export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  not_configured: "尚未配置 AI，请先在设置里启用并填写模型",
  missing_key: "未填写 API Key，请先在设置里配置",
  invalid_endpoint: "模型接口地址无效，请检查",
  auth_invalid: "API Key 无效（401），请重新填写",
  quota_exceeded: "模型额度不足（402），请充值或更换 Key",
  rate_limited: "请求过于频繁（429），请稍后再试",
  model_not_found: "模型不存在（404），请检查模型名",
  timeout: "请求超时，请检查网络后重试",
  network: "网络连接失败，请检查网络或代理设置",
  ollama_unavailable: "本地 Ollama 未启动，请先启动 Ollama",
  internal: "AI 调用失败，请稍后重试",
};

/**
 * 是否需要引导用户去「AI 设置」页。
 * 配置类错误（未配置 / 缺 Key / Key 无效 / 地址错 / 模型错 / 额度）都属于
 * 「改了设置就能好」，调用方应提供一个「去设置」入口。
 */
export function isConfigError(code: AiErrorCode): boolean {
  return (
    code === "not_configured" ||
    code === "missing_key" ||
    code === "invalid_endpoint" ||
    code === "auth_invalid" ||
    code === "quota_exceeded" ||
    code === "model_not_found" ||
    code === "ollama_unavailable"
  );
}

/** 取可读文案：优先主进程 message，缺失时回落默认映射 */
export function aiMessage(code: AiErrorCode, message?: string): string {
  if (message && message.length > 0) return message;
  return AI_ERROR_MESSAGES[code] ?? AI_ERROR_MESSAGES.internal;
}
