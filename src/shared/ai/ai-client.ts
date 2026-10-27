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
  AiGenerateData,
  AiGenerateRequest,
  AiResult,
  AiTestResult,
} from "./ai-types";
import { parseOutput, type AiEntry, type OutputFormat } from "./context/output-spec";

/** 读当前 AI 配置（不含明文 Key） */
export function getAiConfig(): Promise<AiConfig> {
  return window.electronAPI!.ai.getConfig();
}

/** 保存 AI 配置；apiKey 传空串 = 清空 */
export function saveAiConfig(payload: AiConfigSavePayload): Promise<{ ok: boolean; error?: string }> {
  return window.electronAPI!.ai.saveConfig(payload);
}

/** 测试连接（Key 有效性 / 地址可达性 / 模型存在性） */
export function testAiConnection(): Promise<AiResult<AiTestResult>> {
  return window.electronAPI!.ai.test();
}

/**
 * 列出本地 Ollama 已下载的模型（R-AI-01 FR-06）。
 *
 * 只读探测：不读 Key、不写 `ai_log`（它不属于 AI 调用，进了日志会污染耗时统计）。
 * `endpoint` 省略时由主进程用已保存配置。
 */
export function listOllamaModels(
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
export function openAiKeyPage(endpoint?: string): Promise<{ ok: boolean }> {
  return window.electronAPI!.ai.openKeyPage(endpoint ? { endpoint } : undefined);
}

/**
 * 非流式生成（起名增强等）。
 * 调用方负责拼好 prompt（含必要上下文），本层原样转交。
 */
export function aiGenerate(request: AiGenerateRequest): Promise<AiResult<AiGenerateData>> {
  return window.electronAPI!.ai.generate(request);
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
