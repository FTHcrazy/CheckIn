/**
 * AI 服务层类型契约（渲染进程侧）
 *
 * 与主进程 `electron/handlers/ai-handlers.ts` 的 DTO 保持一对一：
 * 本文件定义「渲染进程通过 window.electronAPI.ai 能看到什么」，
 * 主进程定义「IPC 边界上实际传什么」。两边字段名必须一致。
 */

/** 模型服务类型：openai = 任意 OpenAI 兼容接口；ollama = 本地 Ollama */
export type AiProvider = "openai" | "ollama";

/** 归一化错误码（与主进程 aiErrorCode 一致，渲染层按 code 走专属交互） */
export type AiErrorCode =
  | "not_configured"
  | "missing_key"
  | "invalid_endpoint"
  | "auth_invalid"
  | "quota_exceeded"
  | "rate_limited"
  | "model_not_found"
  | "timeout"
  | "network"
  | "ollama_unavailable"
  | "internal";

/** AI 配置（渲染层可见；不含明文 Key） */
export interface AiConfig {
  enabled: boolean;
  provider: AiProvider;
  endpoint: string;
  model: string;
  /** 是否已填 API Key（不返回明文） */
  hasApiKey: boolean;
  contextLen: number;
  /** L3 总开关（允许 AI 读取整章内容，M5；默认关） */
  l3Enabled: boolean;
}

/** 保存配置的载荷；apiKey 传空串 = 清空，传非空 = 覆盖 */
export interface AiConfigSavePayload {
  enabled?: boolean;
  provider?: AiProvider;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  contextLen?: number;
  /** L3 总开关（M5） */
  l3Enabled?: boolean;
}

/** 统一结果：ok=true 带 data；ok=false 带归一化错误 */
export type AiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: AiErrorCode; message: string };

/** 生成请求（首版非流式） */
export interface AiGenerateRequest {
  /** 系统提示词（可空，调用方拼装，服务层不解释业务语义） */
  system?: string;
  /** 用户提示词（必填） */
  prompt: string;
  /** 期望返回条数（起名用） */
  count?: number;
  /** 采样温度 */
  temperature?: number;
  /**
   * 功能意图，仅用于调用日志归类（naming / polish / test …）。
   * 服务层原样透传，不解释其业务含义。
   */
  intent?: string;
  /**
   * L3 授权范围（chapter / selection / recent3），仅 L3 功能传。
   *
   * 服务层原样写进 `ai_event.scope`：范围决定「实际发了多少正文」，
   * 只有落进台账，授权拒绝率与范围选择才能统计（M5 / review G4）。
   */
  scope?: string;
}

/** 生成结果 */
export interface AiGenerateData {
  /** 模型原始返回文本 */
  text: string;
  /** 解析出的条目列表（起名场景为名字列表） */
  items: string[];
  /** 实际使用的模型名（随生成响应回带，供溯源/采纳上报，无需二次取配置） */
  model: string;
}

/** 测试连接结果 */
export interface AiTestResult {
  message: string;
}

/** AI 产品事件上报载荷（M1a；与主进程 ai-event-log 通道一致） */
export interface AiEventLogDTO {
  intent?: string;
  step?: string;
  provider?: string;
  model?: string;
  promptVer?: string;
  durationMs?: number;
  errorCode?: string;
  itemCount?: number;
  charCount?: number;
  scope?: string;
}

/** 看板聚合结果（M1b；与主进程 ai-event-stats 通道一致） */
export interface AiEventStatsDTO {
  totalCalls: number;
  adoptCount: number;
  adoptRate: number;
  avgDurationMs: number;
  byIntent: Array<{ intent: string; calls: number; adopts: number }>;
}
