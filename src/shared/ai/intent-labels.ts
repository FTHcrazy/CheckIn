/**
 * AI 意图 → 中文的**单一产地**（REQ-064）。
 *
 * 为什么必须收口到这里：意图在落库时不止一个形态 ——「AI 记录」页读的是
 * `ai_log.intent`，「用量与效果」页读的是 `ai_event.intent`，两边都可能是
 * - 基础意图：`naming` / `polish` / `transform` / `continuation` / `summary`；
 * - 变换子类型：`transform:tone`、`transform:expand`、`transform:pov` …；
 * - 历史值：`test`（连接测试）、`generate`（2.7.0 之前没有意图概念时的旧值）。
 * 两页各写一份映射的结果是**必然漂移**：`AILogSection` 展开了子类型、而
 * `UsagePanel` 只展开了基础表，于是看板上赤裸裸地显示 `transform:tone`。
 *
 * 分工（不要在这里重抄一遍）：
 * - 基础意图的中文仍然只有 `prompt/registry.ts` 的 `AI_INTENT_LABELS` 一份
 *   （新增意图时它由 `Record<PromptIntent, string>` 强制登记，漏了是编译错误）；
 * - 变换子类型的中文仍然只有 `prompt/transform.ts` 的 `TRANSFORM_KIND_LABELS` 一份
 *   （子类型串本身来自 `TRANSFORM_INTENT_SUB`）。
 * 本文件只做「把这两份摊平成一张查表 + 补历史值」，**不另外维护文案**。
 *
 * ⚠️ 边界：本文件属于 AI 能力层，不 import novel、不含 React。
 */
import { AI_INTENT_LABELS } from "./context/prompt/registry";
import {
  TRANSFORM_INTENT_SUB,
  TRANSFORM_KIND_LABELS,
  type TransformKind,
} from "./context/prompt/transform";

/** 历史意图值的中文（当前代码已不再产生，但老日志 / 老事件要能读） */
const LEGACY_INTENT_LABELS: Record<string, string> = {
  /** 「测试连接」从来不进 ai_event，但会进 ai_log 的 intent 列 */
  test: "连接测试",
  /** 2.7.0 之前没有意图概念，`generateInternal` 的兜底值是 `generate` */
  generate: "生成（旧）",
};

/** 变换子类型 → 中文（`transform:tone` → 换语气） */
const TRANSFORM_SUB_LABELS: Record<string, string> = Object.fromEntries(
  (Object.keys(TRANSFORM_INTENT_SUB) as TransformKind[]).map((kind) => [
    `transform:${TRANSFORM_INTENT_SUB[kind]}`,
    TRANSFORM_KIND_LABELS[kind],
  ]),
);

/**
 * 完整意图 → 中文（基础意图 + 变换子类型 + 历史值）。
 *
 * 只用于「查表」；取文案请走 `intentLabel()`，它带未登记兜底。
 */
export const AI_EVENT_INTENT_LABELS: Record<string, string> = {
  ...AI_INTENT_LABELS,
  ...LEGACY_INTENT_LABELS,
  ...TRANSFORM_SUB_LABELS,
};

/**
 * 取某个意图的中文标签。
 *
 * 未登记时**回落原始值**而不是抛错 / 返回 undefined：这两个页面是只读看板，
 * 一条来自新版本或手改库的记录不该让整页崩掉；显示英文 key 至少还能看出
 * 「这条记录是什么意图」，而 `undefined` 会渲染成空白行。
 */
export function intentLabel(intent: string): string {
  return AI_EVENT_INTENT_LABELS[intent] ?? intent;
}
