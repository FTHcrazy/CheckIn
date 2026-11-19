/**
 * Prompt 层统一出口（所有 AI 提示词的唯一入口）
 *
 * 本文件做两件事：
 * 1. 把 `DOMAINS` 折叠成全局表（`PROMPT_BUILDERS` / `PROMPT_INTENTS` /
 *    `AI_INTENT_LABELS` / `PROMPT_VERSIONS`）与 `intent → ctx` 类型映射；
 * 2. 把各域的模板与段落原样 re-export（调用方的历史 import 路径不变）。
 *
 * ⚠️ 新增 AI 功能 = 在**自己的域**里写 builder 并在域出口登记；
 * 加一个全新业务域 = 只改 `domains/index.ts` 两行，不碰本文件。
 */
import type { AiDataLevel } from "../../ai-consent";
import type {
  CtxOfIntent,
  IntentsOfDomains,
  PayloadOfIntent,
  PromptSpec,
} from "./types";
import { DOMAINS } from "./domains";

/** `DOMAINS` 的元组类型 —— 下面所有折叠的唯一输入 */
type Domains = typeof DOMAINS;

/** 全部已实现的意图名 */
export type PromptIntent = IntentsOfDomains<Domains>;

/** 意图 → 参数类型 */
export type PromptIntentMap = { [K in PromptIntent]: PayloadOfIntent<Domains, K> };

/** 意图 → 上下文类型（域自己定；跨域误传编译期报错） */
export type PromptContextOf<K extends PromptIntent> = CtxOfIntent<Domains, K>;

/** 意图 → 参数类型（§8.2 的对外别名） */
export type PromptPayloadOf<K extends PromptIntent> = PromptIntentMap[K];

/* ─────────────────── 运行期折叠（擦除发生在这一处） ─────────────────── */

/**
 * 域模块的**运行期视角**：把泛型 `build` 擦成统一签名，供本文件铺平三张表。
 *
 * 擦除只在折叠内部发生，泄漏不到任何调用方：对外暴露的 `PROMPT_BUILDERS`
 * 仍是精确映射类型，`buildPromptSpec` 的 ctx 仍由 intent 决定。
 *
 * `build` 用**方法简写**而不是箭头属性是必须的：方法在 `strictFunctionTypes`
 * 下是双变比较，`(intent: string, ctx: unknown, …)` 才收得下各域的泛型实现；
 * 写成属性箭头函数会立刻报「`string` 不能赋给 `NovelPromptIntent`」。
 */
interface ErasedDomain {
  readonly domain: string;
  readonly intents: readonly string[];
  build(intent: string, ctx: unknown, payload: unknown): PromptSpec;
  readonly labels: Record<string, string>;
  readonly versions: Record<string, string>;
  readonly allowedLevels: readonly AiDataLevel[];
}

const ERASED: readonly ErasedDomain[] = DOMAINS;

/** 模板清单：意图 → 组装函数（类型上保证参数与该意图匹配） */
type PromptBuilders = {
  [K in PromptIntent]: (context: PromptContextOf<K>, intent: PromptIntentMap[K]) => PromptSpec;
};

/** 擦除后的组装函数签名（只在折叠内部用） */
type ErasedBuild = (context: unknown, payload: unknown) => PromptSpec;

export const PROMPT_BUILDERS = Object.fromEntries(
  ERASED.flatMap((domain) =>
    // 显式标注二元组：`map` 默认推成 `(string | ErasedBuild)[]`，
    // 那样 `Object.fromEntries` 的 `Iterable<readonly [PropertyKey, T]>` 就过不去
    domain.intents.map((intent): [string, ErasedBuild] => [
      intent,
      (context, payload) => domain.build(intent, context, payload),
    ]),
  ),
) as PromptBuilders;
// ↑ 这次 `as` 是**唯一**一处绕过类型检查的地方，且不可消除：
//   Object.fromEntries 的返回类型是 Record<string, …>，TS 无法核对成映射类型。
//   它被三条守卫围住：DOMAINS_HAVE_UNIQUE_INTENTS（键唯一）、
//   PROMPT_INTENTS === Object.keys(PROMPT_BUILDERS)（键全量，见 prompt.test.ts）、
//   每个 builder 的入参类型由 PromptBuilders 精确约束（值不错位）。

/** 运行期遍历用（顺序 = DOMAINS 登记顺序） */
export const PROMPT_INTENTS = ERASED.flatMap((domain) => [
  ...domain.intents,
]) as readonly PromptIntent[];

/**
 * 意图 → 中文标签（看板 / 调用记录共用的单一产地，G7）。
 *
 * 语义仍是「**全量**意图」——包括非小说域。小说手册的守卫改由
 * `domains/index.ts` 的 `NOVEL_INTENT_LABELS` 限定范围，不要动这里的口径。
 */
export const AI_INTENT_LABELS = Object.assign(
  {} as Record<string, string>,
  ...ERASED.map((domain) => domain.labels),
) as Record<PromptIntent, string>;

/** 各意图的 prompt 模板版本（M7，落 `ai_log.prompt_version` / `ai_event.prompt_ver`） */
export const PROMPT_VERSIONS = Object.assign(
  {} as Record<string, string>,
  ...ERASED.map((domain) => domain.versions),
) as Record<PromptIntent, string>;

/** 按意图取 prompt 版本（未登记时返回空串，调用方按「版本未知」处理） */
export function promptVersionOf(intent: string): string {
  return (PROMPT_VERSIONS as Record<string, string>)[intent] ?? "";
}

/**
 * 按意图组装 Prompt。
 *
 * `ctx` 的类型由 `intent` 决定：小说 8 个意图 → `AiBookContext`。把别的域的上下文
 * 喂给小说意图是编译错误；`buildPromptSpec("notAnIntent", …)` 也过不去。
 */
export function buildPromptSpec<K extends PromptIntent>(
  intent: K,
  context: PromptContextOf<K>,
  payload: PromptIntentMap[K],
): PromptSpec {
  const builder = PROMPT_BUILDERS[intent];
  return builder(context, payload);
}

/* ─────────────────────────── 域与登记表 ─────────────────────────── */

export {
  DOMAINS,
  DOMAINS_HAVE_UNIQUE_INTENTS,
  NOVEL_INTENT_LABELS,
  type AnyPromptDomain,
} from "./domains";

/* ─────────────── 模板与段落（历史 import 路径保持不变） ─────────────── */

// ⚠️ 下面这段必须与改造前的 49 个导出（35 个值 + 14 个类型）逐一对齐：
//    `src/shared/ai/context/index.ts:29-79` 就是从这两个文件取符号的，
//    少一个 = context 桶编译失败 = 半个应用红。
export { assembleNamingSpec, type NamingIntent } from "./domains/novel/builders/naming";
export { assemblePolishSpec, type PolishIntent } from "./domains/novel/builders/polish";
export {
  assembleTransformSpec,
  TRANSFORM_KIND_LABELS,
  TRANSFORM_INTENT_SUB,
  type TransformIntent,
  type TransformKind,
} from "./domains/novel/builders/transform";
export {
  assembleContinuationStreamSpec,
  CONTINUATION_STREAM_OUTPUT_FORMAT,
  CONTINUATION_SUMMARY_MIN_BEFORE_CHARS,
  type ContinuationIntent,
} from "./domains/novel/builders/continuation";
export {
  assembleSummarySpec,
  parseSummaryReply,
  SUMMARY_BODY_HEAD,
  SUMMARY_ONE_LINER_HEAD,
  type SummaryIntent,
  type SummaryReply,
} from "./domains/novel/builders/summary";
export {
  assembleExtractSpec,
  EXTRACT_OUTPUT_FORMAT,
  EXTRACT_TYPE_LABELS,
  type ExtractIntent,
} from "./domains/novel/builders/extract";
export {
  assembleRelationSpec,
  RELATION_CONFIDENCE_VALUES,
  RELATION_OUTPUT_FORMAT,
  type RelationIntent,
} from "./domains/novel/builders/relation";
export {
  assembleLevelGenSpec,
  clampLevelCount,
  LEVEL_OUTPUT_FORMAT,
  type LevelGenIntent,
  type LevelGenMode,
} from "./domains/novel/builders/level-gen";
export {
  assembleBranchSpec,
  BRANCH_COUNT_RANGE,
  BRANCH_DEFAULT_COUNT,
  BRANCH_OUTPUT_FORMAT,
  clampBranchCount,
  isRescueStyle,
  RESCUE_STYLE_LABELS,
  RESCUE_STYLES,
  type BranchIntent,
  type BranchOutlineNode,
  type RescueStyle,
} from "./domains/novel/builders/branch";
export {
  assembleConsistencySpec,
  CONSISTENCY_MAX_SUSPECTS,
  CONSISTENCY_OUTPUT_FORMAT,
  CONSISTENCY_TYPO_VERDICT,
  CONSISTENCY_VERDICTS,
  isTypoVerdict,
  type ConsistencyIntent,
  type ConsistencySuspect,
  type ConsistencyVerdict,
} from "./domains/novel/builders/consistency";

// 小说域出口（域模块 + 三张域内表 + 语境类型）
export { novelPromptDomain, NOVEL_INTENTS, NOVEL_PROMPT_VERSIONS } from "./domains/novel";
export type {
  AiBookContext,
  NovelPromptIntent,
  NovelPromptPayloadMap,
} from "./domains/novel/types";

// 面试域出口（域模块 + 三张域内表 + 语境 / 参数类型）
export {
  INTERVIEW_INTENTS,
  INTERVIEW_INTENT_LABELS,
  INTERVIEW_PROMPT_VERSIONS,
  interviewPromptDomain,
} from "./domains/interview";
export { collectInterviewContext, INTERVIEW_LIMITS } from "./domains/interview/collector";
export type { InterviewSnapshot } from "./domains/interview/collector";
export {
  DRAFT_DIFFICULTY_LABELS,
  DRAFT_OUTPUT_FORMATS,
  DIAGRAM_KIND_SHAPE_HINT,
} from "./domains/interview/builders/draft";
export {
  TAXONOMY_LABEL_MAX,
  TAXONOMY_OUTPUT_FORMAT,
  TAXONOMY_SUGGEST_MAX,
  assembleTaxonomySpec,
  clampTaxonomyCount,
} from "./domains/interview/builders/taxonomy";
export {
  AUDIT_OUTPUT_FORMAT,
  AUDIT_SEVERITIES,
  AUDIT_SEVERITY_LABELS,
  assembleAuditSpec,
} from "./domains/interview/builders/audit";
export type { AuditSeverity } from "./domains/interview/builders/audit";
export { draftSubIntent } from "./domains/interview/types";
export type {
  InterviewAuditPayload,
  InterviewAuditTarget,
  InterviewCategoryRef,
  InterviewDraftPayload,
  InterviewExplainPayload,
  InterviewPromptContext,
  InterviewPromptIntent,
  InterviewPromptPayloadMap,
  InterviewTaxonomySuggestPayload,
} from "./domains/interview/types";

// 段落：kit（跨域通用）+ 小说域段落
export {
  chapterBlock,
  composePrompt,
  constraintBlock,
  jsonArrayFormat,
  kvBlock,
  outputBlock,
  requirementBlock,
  roleBlock,
} from "./kit";
export {
  characterBlock,
  entityBlock,
  realmBlock,
  workBlock,
} from "./domains/novel/sections";

export type { CharacterRef, PromptSpec } from "./types";
