/**
 * AI 可用性门控 hook（M8）
 *
 * 把「AI 现在能不能用、为什么不能用」统一成一个可断言的口径，替代历史上
 * 每个 AI 入口各写一遍的散装判断。PRD §8.2「AI 入口可消失」原则的落地承载：
 * 未配置 / 未启用时，调用方据 `reason` 决定**隐藏、禁用并说明、或走本地兜底**，
 * 绝不出现「点了没反应」或空聊天框。
 *
 * 边界：本 hook 只 import `shared/ai`（配置读取 + 错误归一），不碰 novel、
 * 不碰具体面板；「不可用」的三个层次都来自主进程已经归一好的配置事实。
 */
import { useCallback, useEffect, useState } from "react";
import type { AiConfig } from "../ai-types";
import { getAiConfig } from "../ai-client";

/** 不可用原因（决定入口是隐藏 / 禁用并说明 / 本地兜底） */
export type AiUnavailableReason =
  /** AI 总开关未启用 */
  | "disabled"
  /** 未填模型名 */
  | "no_model"
  /** OpenAI 模式缺 Key */
  | "missing_key"
  /** 未填接口地址 */
  | "no_endpoint"
  /** 主进程通道未注册（lite 版 / 未登录） */
  | "unavailable";

export interface AiAvailability {
  /** AI 是否可用（enabled 且必要字段齐全） */
  available: boolean;
  /** 正在读取配置（首次加载中） */
  loading: boolean;
  /** 不可用原因；available 为 true 时恒为 null */
  reason: AiUnavailableReason | null;
  /** 不可用时给用户的一句话说明（可直接展示 / 挂 title） */
  reasonText: string;
  /** 已加载的配置（可用时非空） */
  config: AiConfig | null;
  /** 手动刷新（配置在设置窗口改过后回来重查） */
  refresh: () => void;
}

const REASON_TEXT: Record<AiUnavailableReason, string> = {
  disabled: "AI 助手未启用，请先在设置里开启",
  no_model: "尚未配置模型名，请先在设置里填写",
  missing_key: "尚未填写 API Key，请先在设置里配置",
  no_endpoint: "尚未填写接口地址，请先在设置里配置",
  unavailable: "AI 功能当前不可用",
};

/** 从配置推导可用性与原因（纯函数，便于单测） */
export function deriveAvailability(config: AiConfig | null): {
  available: boolean;
  reason: AiUnavailableReason | null;
} {
  if (!config) return { available: false, reason: "unavailable" };
  if (!config.enabled) return { available: false, reason: "disabled" };
  if (!config.endpoint.trim()) return { available: false, reason: "no_endpoint" };
  if (!config.model.trim()) return { available: false, reason: "no_model" };
  if (config.provider === "openai" && !config.hasApiKey) {
    return { available: false, reason: "missing_key" };
  }
  return { available: true, reason: null };
}

/**
 * 订阅 AI 可用性状态。
 *
 * 注意：配置在主进程 ai.db，本 hook 只在挂载时读一次 + 手动 `refresh`。
 * 「设置窗口里刚保存」这类跨窗口变更不会自动推到这里 —— 入口面板每次
 * 重新打开（组件重新挂载）时自然会重查，符合「就地操作」的交互节奏。
 */
export function useAiAvailability(): AiAvailability {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    void getAiConfig()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch(() => {
        // 通道未注册（lite 版 / 未登录）→ 视为不可用，入口据此隐藏
        if (!cancelled) setConfig(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const derived = deriveAvailability(config);

  return {
    available: derived.available,
    loading,
    reason: derived.reason,
    reasonText: derived.reason ? REASON_TEXT[derived.reason] : "",
    config,
    refresh: load,
  };
}
