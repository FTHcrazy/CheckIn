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
  buildChapterScopePayload,
  collectBookContext,
  deriveExcludeNames,
  clipChapterForPrompt,
  clipText,
  entityTypeLabel,
  inputCharBudget,
  matchEntitiesInText,
  snippetBudget,
  type AiBookContext,
  type BookSnapshot,
  type ChapterScopePayload,
  type MatchedEntity,
  type ScopeChapterInput,
} from "./collector";

export {
  assembleExtractSpec,
  assembleLevelGenSpec,
  assembleNamingSpec,
  assemblePolishSpec,
  assembleRelationSpec,
  assembleTransformSpec,
  assembleContinuationStreamSpec,
  assembleSummarySpec,
  buildPromptSpec,
  chapterBlock,
  characterBlock,
  clampLevelCount,
  composePrompt,
  constraintBlock,
  CONTINUATION_STREAM_OUTPUT_FORMAT,
  entityBlock,
  EXTRACT_OUTPUT_FORMAT,
  EXTRACT_TYPE_LABELS,
  LEVEL_OUTPUT_FORMAT,
  outputBlock,
  parseSummaryReply,
  PROMPT_BUILDERS,
  PROMPT_INTENTS,
  PROMPT_VERSIONS,
  promptVersionOf,
  realmBlock,
  RELATION_CONFIDENCE_VALUES,
  RELATION_OUTPUT_FORMAT,
  requirementBlock,
  roleBlock,
  SUMMARY_BODY_HEAD,
  SUMMARY_ONE_LINER_HEAD,
  TRANSFORM_KIND_LABELS,
  TRANSFORM_INTENT_SUB,
  workBlock,
  type CharacterRef,
  type ContinuationIntent,
  type ExtractIntent,
  type LevelGenIntent,
  type LevelGenMode,
  type NamingIntent,
  type PolishIntent,
  type PromptIntent,
  type PromptIntentMap,
  type PromptSpec,
  type RelationIntent,
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
  normalizeContinuationText,
  parseOutput,
  stripCodeFence,
  type AiEntry,
  type OutputField,
  type OutputFormat,
  type ParsedOutput,
} from "./output-spec";
