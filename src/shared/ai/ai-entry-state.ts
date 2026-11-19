/**
 * AI 入口三态（O-06）
 *
 * 历史上每个 AI 入口各写一套「能不能点」：续写按钮只看 `available`，
 * 摘要只在自己被点开之后才知道要走 L3 授权。于是同一个闪电在不同位置有
 * 三种长相：亮着、灰着、点了才弹授权。用户看不出「为什么这个能点那个不能」。
 *
 * 这里把「入口状态」收敛成一个纯函数与一份文案表：
 *
 * - `available`：能用且不会拦；
 * - `needs-consent`：能用，但这次会发送整章正文，点了先弹授权 —— 视觉上要
 *   **明显不同于可用、又绝不能灰掉**（灰掉会被读成「坏了」）；
 * - `unavailable`：缺配置 / 总开关关掉，禁用并说明原因（文案由
 *   `useAiAvailability().reasonText` 提供，不在这里再维护一份）。
 *
 * 边界：只做状态推导与类名/文案，不 import React、不读 IPC。
 */

/** 入口三态 */
export type AiEntryState = "available" | "needs-consent" | "unavailable";

export interface AiEntryContext {
  /** `useAiAvailability().available`：配置齐全、总开关开着 */
  available: boolean;
  /** `useAiConsent().l3Enabled`：允许把整章正文发出去了 */
  l3Enabled: boolean;
  /** 这次点击是否发送整章正文（摘要 / 续写 / 抽取 = true；起名 / 润色选段 = false） */
  requiresConsent: boolean;
}

/**
 * 推导入口三态。
 *
 * 顺序有意义：不可用优先于待授权 —— 配置都没齐时，先让用户去补配置，
 * 而不是让他点开授权弹窗、再发现没填 Key。
 */
export function deriveAiEntryState(context: AiEntryContext): AiEntryState {
  if (!context.available) return "unavailable";
  if (context.requiresConsent && !context.l3Enabled) return "needs-consent";
  return "available";
}

/** 「待授权」态的一句话说明（可挂 tooltip；不可用态的文案另有来源） */
export const AI_ENTRY_CONSENT_HINT =
  "首次使用需授权读取整章：点一下会让你确认发送范围";

/**
 * 状态 → CSS 修饰类（空串 = 不加类，保持入口默认外观）。
 *
 * 两个类名是跨组件的约定，样式各自定义在组件自己的 scss 里（样式就近），
 * 但**状态怎么来的**只认这里，避免每个入口再猜一遍。
 */
export function aiEntryStateClass(state: AiEntryState): string {
  if (state === "needs-consent") return "is-ai-needs-consent";
  if (state === "unavailable") return "is-ai-off";
  return "";
}
