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
import { assembleContinuationStreamSpec, type ContinuationIntent } from "./continuation";
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
  continuation: assembleContinuationStreamSpec,
  summary: assembleSummarySpec,
};

/** 运行期遍历用（顺序 = 清单顺序，便于日志 / 调试图标） */
export const PROMPT_INTENTS: readonly PromptIntent[] = Object.keys(
  PROMPT_BUILDERS,
) as PromptIntent[];

/**
 * 意图 → 中文标签（看板 / 调用记录共用的单一产地，G7）。
 *
 * 为什么放这里而不是散在 UsagePanel / AILogSection：`PROMPT_BUILDERS` 有
 * 守卫强制登记，但消费侧的意图标签表没有——每加一个功能就漂移一次（review G7
 * 实证：2.10.0 的 summary 在 UsagePanel 上显示为原始英文）。
 * 与 `PROMPT_INTENTS` 同源，由 `prompt.test.ts` 断言覆盖全量。
 *
 * 注意：`transform` 在落库时带子类型（`transform:expand` 等），这里只给笼统
 * 标签；子类型的中文在 `TRANSFORM_KIND_LABELS`，消费侧自行展开。
 */
export const AI_INTENT_LABELS: Record<PromptIntent, string> = {
  naming: "起名",
  polish: "润色",
  transform: "文本变换",
  continuation: "续写",
  summary: "摘要",
};

/** 各意图的 prompt 模板版本（M7）。
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
  // v2（2.10.3）：前文够短时注入【上一章摘要】（R-AI-09 摘要的第二消费方）
  continuation: "v2",
  // v2（2.10.1）：摘要支持 L3 授权范围——新增【前情】块与「只看选中段落」约束
  // v3（2.10.2）：摘要同一次产出【一句话】+【摘要】两段，一句话回填大纲梗概（大纲回流）
  summary: "v3",
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
