/**
 * 面试题库上下文采集器（纯函数）
 *
 * 职责：把页面层取好的题库快照归一成 `InterviewPromptContext`，并按上限截断。
 * 与小说 `collectBookContext` 同款边界：不 import 页面 / store / IPC。
 */
import type { InterviewCategoryRef, InterviewPromptContext } from "./types";

/** 采集上限：数字按「塞进 prompt 后不失控」倒推 */
export const INTERVIEW_LIMITS = {
  /** 分类：22 基线 + 8 个自定义分类。超了说明用户该先收敛侧栏，而不是把整条塞进 prompt */
  categories: 30,
  /** 已有标题 / 词条键：60 条 × ~10 字 ≈ 600 字，避重够用且不撑爆 */
  questionTitles: 60,
  glossaryTerms: 60,
  /** 单批质检的题目数：再多模型会开始复制粘贴前一条的建议 */
  auditTargets: 20,
} as const;

/** 页面层组装好的题库快照（允许字段缺失） */
export interface InterviewSnapshot {
  categories?: InterviewCategoryRef[];
  stats?: { questions: number; glossaries: number; diagrams: number };
  questionTitles?: string[];
  glossaryTerms?: string[];
  activeCategoryId?: string;
}

/** 去空白 + 去重 + 截断 */
function clipList(list: string[] | undefined, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/** 采集面试题库上下文 */
export function collectInterviewContext(snapshot: InterviewSnapshot): InterviewPromptContext {
  const stats = snapshot.stats ?? { questions: 0, glossaries: 0, diagrams: 0 };
  return {
    categories: (snapshot.categories ?? []).slice(0, INTERVIEW_LIMITS.categories).map((c) => ({
      id: c.id,
      label: c.label,
      ...(c.note ? { note: c.note } : {}),
    })),
    stats: {
      questions: Math.max(0, stats.questions),
      glossaries: Math.max(0, stats.glossaries),
      diagrams: Math.max(0, stats.diagrams),
    },
    questionTitles: clipList(snapshot.questionTitles, INTERVIEW_LIMITS.questionTitles),
    glossaryTerms: clipList(snapshot.glossaryTerms, INTERVIEW_LIMITS.glossaryTerms),
    ...(snapshot.activeCategoryId ? { activeCategoryId: snapshot.activeCategoryId } : {}),
  };
}
