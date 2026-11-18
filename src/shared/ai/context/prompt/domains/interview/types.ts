/**
 * 面试题库的 Prompt 上下文与意图参数（**唯一产地**）
 *
 * 与小说域的关键差异：题库**不发送任何「作品正文」**，送的是题目 / 词条 / 分类
 * 这些「用户自己的知识资产」。所以域模块的 `allowedLevels` 只有 L1/L2。
 *
 * 分界线与小说域完全对称：`AiBookContext` 装的是「这本书是什么」，具体要处理的
 * 文本一律走 payload（polish 的 `text`、summary 的 `chapter`）；这里装的是
 * 「这个题库是什么」，划中的词 / 待检的题都走 payload —— 否则一次性的解释气泡
 * 也要构造一整个库上下文。
 *
 * 枚举常量一律从 `src/shared/interview/payload-shape.ts` 取，不在这里抄字面量：
 * 那是产物类型的单一产地，抄一份必然漂移。
 */
import type {
  DiagramKindShape,
  InterviewKind,
  QuestionDifficultyShape,
  QuestionTrackShape,
} from "../../../../../interview/payload-shape";

/** 分类的一个只读视图（22 基线 + 已采纳的自定义分类） */
export interface InterviewCategoryRef {
  id: string;
  label: string;
  /** 分类说明（作者或 AI 写的一句约束；只对「当前分类」渲染，避免 prompt 膨胀） */
  note?: string;
}

/**
 * 面试域的上下文（**库级、跨次稳定**的那部分）。
 */
export interface InterviewPromptContext {
  /** 分类词表（已去重、已按 `INTERVIEW_LIMITS.categories` 截断） */
  categories: InterviewCategoryRef[];
  /** 题库规模（`coverageBlock` 的输入，也是「这个库多大」的锚点） */
  stats: {
    questions: number;
    glossaries: number;
    diagrams: number;
  };
  /** 已有题目标题（出题避重；已截断） */
  questionTitles: string[];
  /** 已有词条键（出词避重，含 aliases 归一后的键；已截断） */
  glossaryTerms: string[];
  /** 当前所在的分类（从分类页 / 详情页进入时才有） */
  activeCategoryId?: string;
}

/* ───────────────────────── 意图 1：划词解释 ───────────────────────── */

/** 划词解释的参数：一次划词的全部素材 */
export interface InterviewExplainPayload {
  /** 划中的词 / 短语（调用方已 trim、已按 2–12 中文 / 3–24 ASCII 过滤） */
  term: string;
  /** 词所在的上下文句（调用方按选区居中切片，建议 ≤120 字） */
  sentence?: string;
  /** 可选题干：从题目里划词时带上，解释才会贴题 */
  stem?: string;
  /** 词条库里已有同名词条的一句话定义（用于「补充释义」场景：不要复述它） */
  existingShort?: string;
}

/* ───────────────────────── 意图 2：AI 拓展 ───────────────────────── */

/**
 * AI 拓展的参数：出题 / 出词 / 出图共用。
 *
 * 为什么三合一而不是三个意图：三者的**上下文完全相同**（分类 / 已有标题 /
 * 库规模），差别只在输出契约。拆成三个意图会让 `AI_INTENT_LABELS` 多两行、
 * 让调用方多一个 switch，而落库口径本来就是 `interviewDraft:<kind>`。
 */
export interface InterviewDraftPayload {
  /** 产出类型，决定输出契约与角色定位 */
  kind: InterviewKind;
  /** 种子：题干片段 / 分类名 / 原词；空则由分类与难度自由发挥 */
  seed?: string;
  /** 目标分类（模型只能落在这张封闭词表里） */
  categoryId?: string;
  /** 目标轨道（仅 question） */
  track?: QuestionTrackShape;
  /** 目标难度（question / glossary 可给） */
  difficulty?: QuestionDifficultyShape;
  /** 图型（仅 diagram，必填：决定节点键名 label/note 还是 title/detail） */
  diagramKind?: DiagramKindShape;
  /** 期望条数（`clampDraftCount` 夹取；diagram 恒为 1） */
  count: number;
  /**
   * 词条库里已有同名 / 近义词条（「补充释义」场景）。给了就必须写得比它深，
   * 且 payload 的 `related` 会指回那条词条 —— 否则新词条只是旧词条的复读。
   */
  existingTerm?: string;
  /** 上一条已有词条的一句话定义（模型用来判断「哪里还没讲」） */
  existingShort?: string;
}

/* ───────────────────────── 意图 3：题目质检 ───────────────────────── */

/** 待检题目（调用方已按 payload-shape 校验通过） */
export interface InterviewAuditTarget {
  id: string;
  title: string;
  stem: string;
  answer: string;
  categoryId: string;
  difficulty: QuestionDifficultyShape;
  tags?: string[];
}

/** 质检参数 */
export interface InterviewAuditPayload {
  /** 待检题目（上限 `INTERVIEW_LIMITS.auditTargets`，调用方切） */
  targets: InterviewAuditTarget[];
}

/* ───────────────────────── 意图表（唯一产地） ───────────────────────── */

/** 分类建议的参数（规范 §9 三层闸门 ①：只产建议，不直接建分类） */
export interface InterviewTaxonomySuggestPayload {
  /** 想要的方向（一句话）；空则由模型按题库现状找空缺 */
  seed?: string;
  /** 期望条数（`clampTaxonomyCount` 夹取到 1~3） */
  count: number;
  /** 目标轨道（给了就只推荐这一侧的） */
  track?: QuestionTrackShape;
}

/** 面试域的意图 → 参数类型。加意图 = 在这里加一个键，其余四张表会被编译器逼着补齐 */
export interface InterviewPromptPayloadMap {
  interviewExplain: InterviewExplainPayload;
  interviewDraft: InterviewDraftPayload;
  interviewAudit: InterviewAuditPayload;
  interviewTaxonomySuggest: InterviewTaxonomySuggestPayload;
}

/** 面试域的意图名 */
export type InterviewPromptIntent = keyof InterviewPromptPayloadMap;

/**
 * 落库用的子意图串：`interviewDraft:question` / `:glossary` / `:diagram`。
 * 与 `interview_item.source_intent`、`ai_event.intent` 同口径。
 * **唯一产地**：调用方不许自己拼模板字符串。
 */
export function draftSubIntent(kind: InterviewKind): string {
  return `interviewDraft:${kind}`;
}
