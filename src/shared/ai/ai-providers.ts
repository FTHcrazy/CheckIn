/**
 * 模型服务商预设与 Key 申请页（R-AI-01 FR-03 / FR-05）
 *
 * 放在 `shared/` 而不是设置页内部，是因为**同一个事实有两个消费者**：
 * 设置页要用预设填「地址 + 默认模型」，主进程要用它反查「Key 申请页」。
 * 各存一份必然漂移（改了预设忘了改主进程），而这类漂移不会报错，
 * 只会表现为「点获取 Key 没反应」。
 *
 * ⚠️ 主进程按 **endpoint 的 host** 查表，渲染层传不了任意 URL ——
 * `shell.openExternal` 的入参永远来自本文件的常量，不来自调用方。
 */

export interface AiProviderPreset {
  label: string;
  /** OpenAI 兼容 base 地址（含 /v1） */
  endpoint: string;
  /** 官方推荐模型名（用户可改） */
  model: string;
  /** 申请 API Key 的官方页面 */
  keyUrl: string;
}

/**
 * 预置服务商。端点、默认模型与 Key 页以 2026-10 官方文档为准。
 * 用户可随时改地址/模型，故无需热更新；收录新服务商时三处（地址/模型/Key 页）一起补。
 */
export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    label: "通义千问",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    keyUrl: "https://bailian.console.aliyun.com/",
  },
  {
    label: "智谱 GLM",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
  },
];

/**
 * 按 endpoint 反查 Key 申请页。
 *
 * 只比 host（忽略路径与端口写法差异）：用户常把 `/v1` 删掉或补上，
 * 按完整字符串匹配会漏。未收录（自定义接口 / 本地 Ollama）返回 `null`，
 * 此时界面不显示「获取 Key」入口 —— 与其给一个猜的链接，不如不给。
 */
export function keyPageOf(endpoint: string): string | null {
  const host = hostOf(endpoint);
  if (!host) return null;
  const hit = AI_PROVIDER_PRESETS.find((preset) => hostOf(preset.endpoint) === host);
  return hit?.keyUrl ?? null;
}

/** 取 host（小写，去端口）；解析失败返回 null（该 endpoint 是草稿态半截输入） */
function hostOf(endpoint: string): string | null {
  const raw = endpoint.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}
