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
  /**
   * AI 是否应当**完全不渲染**（REQ-063）。
   *
   * 与 `available` 的区别是「不可用的两种性质」：
   * - 用户主动关掉了总开关 / 本版本根本没有 AI 通道 → `hidden`，入口直接不渲染，
   *   连灰按钮和说明文案都不出现（他要的是「这里没有 AI」）；
   * - 开关开着只是没配全（缺模型 / 缺 Key / 缺地址）→ **不隐藏**，仍以
   *   「禁用 + 说明原因」呈现 —— 这时用户需要看见入口，才知道去补哪一项配置。
   *
   * 首次加载中（`config === null`）也算 hidden：宁可晚一拍出现，
   * 也不要「先显示再消失」的闪动。
   */
  hidden: boolean;
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
 * 「该不该整块不渲染」的纯函数推导（REQ-063）。
 *
 * 为什么单独抽出来而不是在 hook 里写内联判断：这条口径要被**两个窗口**
 * （作品窗口的六个入口 + 设置窗口的导航）共用，还要被单测逐条钉住。
 * 散在 hook 里就只能靠组件测试间接验证，改一次口径要满仓找。
 *
 * 只有两种原因会 hide：
 * - `disabled`：用户主动关掉了总开关（他要的就是「看不见 AI」）；
 * - `unavailable`：主进程 AI 通道压根不在（lite 版 / 未登录 / 配置还没读到）——
 *   此时入口留着只会是死按钮。
 * 其余原因（`no_model` / `missing_key` / `no_endpoint`）说明开关是**开着**的，
 * 用户需要看见入口才能知道去补哪一项，故保持「禁用 + 说明」。
 */
export function isAiHidden(reason: AiUnavailableReason | null): boolean {
  return reason === "disabled" || reason === "unavailable";
}

/**
 * 订阅 AI 可用性状态。
 *
 * 数据来源是主进程 ai.db；这里除了挂载时读一次、以及对外暴露的 `refresh`
 * 之外，还**订阅 `ai-config-changed`** —— 因为 AI 总开关是一个跨窗口事实：
 * 用户在设置窗口关掉它之后，已经开着的作品窗口必须当场把入口收掉，
 * 否则要重启（或重开窗口）才生效，而用户看到的是「开关没作用」。
 * 事件由主进程 `ai-config-save` 成功后广播，本 hook 只负责「收到就重读」，
 * 不解释载荷（载荷里没有渲染层需要的派生值，重读才不会与主进程分叉）。
 * 通道缺失（lite 版 / 测试环境）时静默降级成「不订阅」。
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

  // 跨窗口配置变更 → 重读（见上方注释：这是「开关即时生效」的唯一通路）。
  // 刻意不在这里 setConfig(null) 做乐观收束：主进程才是配置的事实源，
  // 乐观值一旦与主进程不符，就会呈现「关掉了还显示 / 开着却消失」。
  //
  // ⚠️ 会收到「自己刚触发的那条」广播（设置窗口自己也挂了这个 hook），这是
  // 刻意为之、不要"顺手"改成按窗口名过滤：本 hook 的监听体只做一件事——重读
  // 配置，幂等且不写库不改草稿，回环不成立；反过来过滤掉发送方，设置窗口自己
  // 就会停在旧状态（导航收不掉、开关看着像没生效）。主进程侧 `notifyConfigChanged`
  // 的 doc 有同一段论证。
  useEffect(() => {
    const api = window.electronAPI?.windowAPI;
    if (!api) return;
    /** 上一次重读的取消器：连点两次开关时，先到的旧响应不许覆盖后到的新结果 */
    let cancelInFlight: (() => void) | null = null;
    const handler = (): void => {
      cancelInFlight?.();
      cancelInFlight = load();
    };
    api.on("ai-config-changed", handler);
    return () => {
      cancelInFlight?.();
      api.off("ai-config-changed", handler);
    };
  }, [load]);

  const derived = deriveAvailability(config);

  return {
    available: derived.available,
    hidden: isAiHidden(derived.reason),
    loading,
    reason: derived.reason,
    reasonText: derived.reason ? REASON_TEXT[derived.reason] : "",
    config,
    refresh: load,
  };
}

