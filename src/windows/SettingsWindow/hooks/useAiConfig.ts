import { useCallback, useEffect, useState } from "react";
import type { AiConfig } from "@/shared/ai/ai-types";
import { getAiConfig, saveAiConfig, testAiConnection } from "@/shared/ai/ai-client";
import type { AiErrorCode } from "@/shared/ai/ai-types";

/**
 * AI 设置分区的数据逻辑（R-AI-01）。
 *
 * 只负责「读 / 存 / 测」三件事，UI 状态（模式选择、折叠、测试结果展示）
 * 由 AISection 自己持有。配置经 `shared/ai/ai-client` 走主进程，Key 永不
 * 进渲染层内存的**可持久化副本**（只有用户刚输入的那一刻短暂存在，提交后
 * 即弃，`getConfig` 只返回 `hasApiKey` 布尔）。
 */
export function useAiConfig() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  /** 测试连接结果：ok 或错误码（null = 尚未测试 / 已重置） */
  const [testResult, setTestResult] = useState<
    { ok: boolean; code?: AiErrorCode; message: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void getAiConfig()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch(() => {
        // 主进程未注册（lite 版理论上不会走到这里，因为 AISection 已被门控）
        if (!cancelled) setConfig(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 保存配置（局部更新）；apiKey 传空串 = 清空 */
  const save = useCallback(
    async (patch: Parameters<typeof saveAiConfig>[0]): Promise<boolean> => {
      setSaving(true);
      try {
        const result = await saveAiConfig(patch);
        if (!result.ok) {
          setTestResult({
            ok: false,
            message: result.error ?? "保存失败",
          });
          return false;
        }
        // 保存成功后回读最新配置（hasApiKey 等派生值以主进程为准）
        const fresh = await getAiConfig();
        setConfig(fresh);
        return true;
      } catch {
        setTestResult({ ok: false, message: "保存失败，请稍后重试" });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  /** 测试连接 */
  const test = useCallback(async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAiConnection();
      if (result.ok) {
        setTestResult({ ok: true, message: result.data.message });
      } else {
        setTestResult({ ok: false, code: result.code, message: result.message });
      }
    } catch {
      setTestResult({ ok: false, message: "测试失败，请稍后重试" });
    } finally {
      setTesting(false);
    }
  }, []);

  return { config, loading, saving, testing, testResult, save, test };
}
