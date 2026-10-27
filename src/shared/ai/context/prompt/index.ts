/**
 * Prompt 层统一出口（所有 AI 提示词的唯一入口）
 *
 * 调用方只 import 这里：
 *   - `assembleNamingSpec` / `assemblePolishSpec`：直接拿具体模板
 *   - `buildPromptSpec(intent, …)`：按意图组装（推荐，便于横向遍历与守卫）
 *   - `PROMPT_BUILDERS` / `PROMPT_INTENTS`：清单
 *
 * ⚠️ 新增 AI 功能只做两件事：写 `xxx.ts` 模板 + 在 `registry.ts` 登记。
 * 不要在业务组件里手拼 system prompt（历史教训：两套模板必然漂移）。
 */
export {
  buildPromptSpec,
  PROMPT_BUILDERS,
  PROMPT_INTENTS,
  PROMPT_VERSIONS,
  promptVersionOf,
  type PromptIntent,
  type PromptIntentMap,
} from "./registry";

export { assembleNamingSpec, type NamingIntent } from "./naming";
export { assemblePolishSpec, type PolishIntent } from "./polish";
export {
  assembleTransformSpec,
  TRANSFORM_KIND_LABELS,
  TRANSFORM_INTENT_SUB,
  type TransformIntent,
  type TransformKind,
} from "./transform";
export {
  assembleContinuationSpec,
  CONTINUATION_OUTPUT_FORMAT,
  type ContinuationIntent,
} from "./continuation";
export { assembleSummarySpec, type SummaryIntent } from "./summary";

export {
  chapterBlock,
  characterBlock,
  composePrompt,
  constraintBlock,
  entityBlock,
  outputBlock,
  realmBlock,
  requirementBlock,
  roleBlock,
  workBlock,
} from "./sections";

export type { CharacterRef, PromptSpec } from "./types";
