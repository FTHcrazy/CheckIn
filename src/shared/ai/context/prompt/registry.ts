/**
 * Prompt 模板注册表 —— **所有 AI 功能的提示词统一从这里进出**
 *
 * 为什么要有注册表而不是直接 import 各模板：
 * 1. **一处总览**：调 prompt 时不用满仓找 `buildXxxPrompt`，`PROMPT_BUILDERS`
 *    就是全部 AI 功能的清单；
 * 2. **扩展点固定**：新增功能 = 写一个 `assembleXxxSpec` + 在这里登记一行，
 *    服务层、`ai-client`、主进程一行不改（AGENTS §2.2.2.1）；
 * 3. **可守卫**：`prompt.test.ts` 会遍历注册表校验每个模板的产出形状，
 *    新模板漏了 outputFormat 或 system 为空会直接红。
 *
 * 注意：这里只有「模板」，采集上下文仍走 `../collector`。
 */
import type { AiBookContext } from "../collector";
import { assembleNamingSpec, type NamingIntent } from "./naming";
import { assemblePolishSpec, type PolishIntent } from "./polish";
import { assembleTransformSpec, type TransformIntent } from "./transform";
import { assembleContinuationSpec, type ContinuationIntent } from "./continuation";
import { assembleSummarySpec, type SummaryIntent } from "./summary";
import type { PromptSpec } from "./types";

/** 各意图的参数类型（新功能在这里扩一行，`PromptIntent` 自动跟着变） */
export interface PromptIntentMap {
  naming: NamingIntent;
  polish: PolishIntent;
  transform: TransformIntent;
  continuation: ContinuationIntent;
  summary: SummaryIntent;
}

/** 已实现模板的意图名 */
export type PromptIntent = keyof PromptIntentMap;

/** 模板清单：意图 → 组装函数（类型上保证参数与该意图匹配） */
export const PROMPT_BUILDERS: {
  [K in PromptIntent]: (context: AiBookContext, intent: PromptIntentMap[K]) => PromptSpec;
} = {
  naming: assembleNamingSpec,
  polish: assemblePolishSpec,
  transform: assembleTransformSpec,
  continuation: assembleContinuationSpec,
  summary: assembleSummarySpec,
};

/** 运行期遍历用（顺序 = 清单顺序，便于日志 / 调试图标） */
export const PROMPT_INTENTS: readonly PromptIntent[] = Object.keys(
  PROMPT_BUILDERS,
) as PromptIntent[];

/**
 * 各意图的 prompt 模板版本（M7）。
 *
 * 落进 `ai_log.prompt_version` / `ai_event.prompt_ver`，让「改了 prompt 之后
 * 采纳率 / 效果变没变」可对照。**改任何一个模板时，必须同步 bump 对应版本号**，
 * 否则归因会把新旧 prompt 的效果混在一起。
 *
 * 版本规则：纯数字次版本，格式 `v<N>`；与 `package.json` 解耦（prompt 可以比
 * 应用更频繁地迭代）。新功能登记进 `PROMPT_BUILDERS` 时，同时在这里补一行。
 */
export const PROMPT_VERSIONS: Record<PromptIntent, string> = {
  naming: "v1",
  polish: "v1",
  transform: "v1",
  continuation: "v1",
  summary: "v1",
};

/** 按意图取 prompt 版本（未登记时返回空串，调用方按「版本未知」处理） */
export function promptVersionOf(intent: string): string {
  return (PROMPT_VERSIONS as Record<string, string>)[intent] ?? "";
}

/**
 * 按意图组装 Prompt。
 *
 * 泛型保证「意图与其参数」不会错配：`buildPromptSpec("naming", ctx, polishIntent)`
 * 在类型层面就过不去，比一串重载更容易维护。
 */
export function buildPromptSpec<K extends PromptIntent>(
  intent: K,
  context: AiBookContext,
  payload: PromptIntentMap[K],
): PromptSpec {
  const builder = PROMPT_BUILDERS[intent] as (
    context: AiBookContext,
    intent: PromptIntentMap[K],
  ) => PromptSpec;
  return builder(context, payload);
}
