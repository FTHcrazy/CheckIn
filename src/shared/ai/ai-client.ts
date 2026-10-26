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
 * 非流式生成（起名增强等）。
 * 调用方负责拼好 prompt（含必要上下文），本层原样转交。
 */
export function aiGenerate(request: AiGenerateRequest): Promise<AiResult<AiGenerateData>> {
  return window.electronAPI!.ai.generate(request);
}
