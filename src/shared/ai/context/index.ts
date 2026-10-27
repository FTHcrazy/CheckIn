/**
 * AI 上下文加工层统一出口
 *
 * 调用方只 import 这里，不要深入具体文件：
 *   - `collectBookContext` / `matchEntitiesInText`：快照 → 归一上下文
 *   - `assembleNamingSpec` / `assemblePolishSpec` / `buildPromptSpec`：上下文 + 意图 → PromptSpec
 *   - `parseOutput`：模型返回文本 → 结构化条目
 *
 * 加新 AI 功能时：新增一个 `assembleXxxSpec` 模板并在 `prompt/registry.ts` 登记，
 * 服务层零改动。
 */
export {
  collectBookContext,
  deriveExcludeNames,
  clipText,
  entityTypeLabel,
  matchEntitiesInText,
  type AiBookContext,
  type AiIntent,
  type BookSnapshot,
  type MatchedEntity,
} from "./collector";

export {
  assembleNamingSpec,
  assemblePolishSpec,
  assembleTransformSpec,
  assembleContinuationSpec,
  assembleSummarySpec,
  buildPromptSpec,
  chapterBlock,
  characterBlock,
  composePrompt,
  constraintBlock,
  CONTINUATION_OUTPUT_FORMAT,
  entityBlock,
  outputBlock,
  PROMPT_BUILDERS,
  PROMPT_INTENTS,
  PROMPT_VERSIONS,
  promptVersionOf,
  realmBlock,
  requirementBlock,
  roleBlock,
  TRANSFORM_KIND_LABELS,
  TRANSFORM_INTENT_SUB,
  workBlock,
  type CharacterRef,
  type ContinuationIntent,
  type NamingIntent,
  type PolishIntent,
  type PromptIntent,
  type PromptIntentMap,
  type PromptSpec,
  type SummaryIntent,
  type TransformIntent,
  type TransformKind,
} from "./prompt";

export {
  NAMING_OUTPUT_FORMAT,
  TEXT_OUTPUT_FORMAT,
  alignParagraphBreaks,
  buildOutputInstruction,
  extractJsonArray,
  parseOutput,
  stripCodeFence,
  type AiEntry,
  type OutputField,
  type OutputFormat,
  type ParsedOutput,
} from "./output-spec";
