/**
 * 面试域出口（域模块 + 三张域内表 + 意图清单）
 *
 * 这个文件是「加一个域 = 写一个实现 `PromptDomainModule` 的常量 + 在
 * `domains/index.ts` 里加一项」里的那个常量。域内新增意图只改本文件与
 * `types.ts` 的意图表，不碰任何跨域文件。
 */
import type { AiDataLevel } from "../../../../ai-consent";
import type { PromptDomainModule, PromptSpec } from "../../types";
import { assembleAuditSpec } from "./builders/audit";
import { assembleDraftSpec } from "./builders/draft";
import { assembleExplainSpec } from "./builders/explain";
import type {
  InterviewPromptContext,
  InterviewPromptIntent,
  InterviewPromptPayloadMap,
} from "./types";

/** 意图 → 组装函数（漏一个 = 编译错误） */
const INTERVIEW_BUILDERS: {
  [K in InterviewPromptIntent]: (
    ctx: InterviewPromptContext,
    payload: InterviewPromptPayloadMap[K],
  ) => PromptSpec;
} = {
  interviewExplain: assembleExplainSpec,
  interviewDraft: assembleDraftSpec,
  interviewAudit: assembleAuditSpec,
};

/**
 * 按意图分发。
 *
 * 刻意写成泛型函数而不是内联箭头：`INTERVIEW_BUILDERS[intent]` 在 `intent` 为
 * 联合类型时会退化成「三个函数签名的并集」，而并集不可调用（参数无法同时满足）。
 * 泛型 `K` 让索引访问保持精确，调用点也就保住了「payload 与 intent 不错配」。
 */
function buildInterviewSpec<K extends InterviewPromptIntent>(
  intent: K,
  ctx: InterviewPromptContext,
  payload: InterviewPromptPayloadMap[K],
): PromptSpec {
  return INTERVIEW_BUILDERS[intent](ctx, payload);
}

/** 本域实现的意图清单（顺序 = 登记顺序 = 日志 / 看板的展示顺序） */
export const INTERVIEW_INTENTS = Object.keys(
  INTERVIEW_BUILDERS,
) as readonly InterviewPromptIntent[];

/** 意图中文标签（漏一个 = 编译错误） */
export const INTERVIEW_INTENT_LABELS: Record<InterviewPromptIntent, string> = {
  interviewExplain: "划词解释",
  interviewDraft: "AI 拓展",
  interviewAudit: "题目质检",
};

/** 各意图的 prompt 模板版本（落 `ai_log.prompt_version`；改模板必须 bump） */
export const INTERVIEW_PROMPT_VERSIONS: Record<InterviewPromptIntent, string> = {
  // v1：划词解释首版（text 契约 + 两段标记行）
  interviewExplain: "v1",
  // v1：出题 / 出词 / 出图三合一（question·glossary 走 json-array，diagram 走 text）
  interviewDraft: "v1",
  // v1：题目质检首版（json-array，首字段 id 作去重键）
  interviewAudit: "v1",
};

/** 本域允许的数据分级：题库内容不是作品正文，任何面试意图都不该触发 L3 整章授权 */
const INTERVIEW_ALLOWED_LEVELS: readonly AiDataLevel[] = ["L1", "L2"];

/** 面试题库域模块（`DOMAINS` 的登记项） */
export const interviewPromptDomain: PromptDomainModule<
  InterviewPromptIntent,
  InterviewPromptContext,
  InterviewPromptPayloadMap
> = {
  domain: "interview",
  intents: INTERVIEW_INTENTS,
  build: buildInterviewSpec,
  labels: INTERVIEW_INTENT_LABELS,
  versions: INTERVIEW_PROMPT_VERSIONS,
  allowedLevels: INTERVIEW_ALLOWED_LEVELS,
};
