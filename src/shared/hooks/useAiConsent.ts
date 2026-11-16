import { useCallback, useEffect, useState } from "react";
import { getAiConfig, saveAiConfig } from "../ai/ai-client";
import type { AiConfig } from "../ai/ai-types";
import { DEFAULT_L3_SCOPE, type L3Scope } from "../ai/ai-consent";

/**
 * L3 授权状态（M5）。
 *
 * 统一「L3 功能（章节摘要 / 实体抽取 / 一致性校对 …）能不能把正文发给模型」
 * 的判定口径，取代各功能面板各写一遍「未配置 / 未授权」判断。
 *
 * 两个维度：
 * - `l3Enabled`：全局总开关（存 `ai_config.l3_enabled`，设置页可关）；
 * - `scope`：本次调用的范围（默认「仅本章」，PRD §5.3 保守默认）。
 *
 * 消费方（如 `runChapterSummary`）在发起 L3 调用前先检查 `l3Enabled`，
 * 关闭时入口隐藏或禁用并说明原因，禁止「点了没反应」。
 */
export function useAiConsent() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  /** 本次授权范围（仅本 hook 内存态，不落库；PRD §5.2 按次可拒绝） */
  const [scope, setScope] = useState<L3Scope>(DEFAULT_L3_SCOPE);

  useEffect(() => {
    let cancelled = false;
    void getAiConfig()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 打开 L3 总开关（首次授权弹窗确认后调用） */
  const enableL3 = useCallback(async (): Promise<boolean> => {
    const result = await saveAiConfig({ l3Enabled: true });
    if (result.ok) {
      setConfig((prev) => (prev ? { ...prev, l3Enabled: true } : prev));
      return true;
    }
    return false;
  }, []);

  return {
    /** 配置是否仍在加载（首屏未读到配置前，L3 入口先隐藏避免闪跳） */
    loading,
    /** 全局 L3 总开关（false = 所有 L3 入口应隐藏或禁用） */
    l3Enabled: config?.l3Enabled ?? false,
    /** 模型服务类型（授权弹窗判断「本地模型不出本机」提示用） */
    provider: config?.provider ?? "openai",
    /** 本次调用范围 */
    scope,
    setScope,
    /** 打开总开关（授权弹窗确认后） */
    enableL3,
  };
}
