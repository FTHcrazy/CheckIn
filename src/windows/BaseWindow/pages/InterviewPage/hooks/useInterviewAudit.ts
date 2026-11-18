/**
 * 题目质检（`interviewAudit`）。
 *
 * 【产物性质：只读报告，不写库】
 * 模型只会带回「哪道题有什么问题、建议改成什么」，**不落库、不改题**。
 * 题库是用户资产，AI 直接改答案比「多一次点击」代价大得多；用户点「去改」
 * 走的是已有的题目编辑抽屉，改动与手动改题完全同一条路径。
 *
 * 【为什么要校验 id】
 * 质检模板要求逐字照抄【待检题目 xxx】里的 id，但模型偶尔会发明 id 或
 * 把 id 抄错。抄错的建议落在一道不存在 / 别的题上，比丢掉更糟 ——
 * 所以不在本次送检集合里的 id 一律丢弃，并把丢弃条数如实报出来。
 *
 * 【严重程度只认三档】
 * `AUDIT_SEVERITIES` 是唯一产地（prompt 里也用它），这里只做归一：
 * 中文档位、「高 / 中 / 低」都认，认不出按 medium —— 宁可轻报，也不要
 * 把一条措辞建议标成「必改」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiGenerateStructured, logAiEvent } from "@/shared/ai/ai-client";
import {
  INTERVIEW_LIMITS,
  buildPromptSpec,
  collectInterviewContext,
  type AuditSeverity,
  type InterviewAuditTarget,
} from "@/shared/ai/context/prompt";
import { useAiAvailability } from "@/shared/ai/hooks/useAiAvailability";
import type { InterviewQuestion } from "../data/interview-types";

/** 一道题的一条质检结论（同一道题的多个问题合并在 `issues` 里） */
export interface AuditIssue {
  /** 题目 id（与题库 id 同源，点「去改」靠它定位） */
  id: string;
  severity: AuditSeverity;
  /** 问题清单（模型用换行分隔；这里已拆成数组） */
  issues: string[];
  /** 一句话修改建议 */
  suggestion: string;
}

export interface UseInterviewAuditOptions {
  /** 合并后的分类表（进 prompt 的封闭词表） */
  categories: readonly { id: string; label: string }[];
  questionTitles: readonly string[];
  glossaryTerms: readonly string[];
  stats: { questions: number; glossaries: number; diagrams: number };
}

export interface UseInterviewAuditResult {
  /** AI 是否可用 / 是否整块不渲染（M8 口径） */
  available: boolean;
  hidden: boolean;
  unavailableText: string;

  running: boolean;
  error: string | null;
  issues: AuditIssue[];
  /** 模型走了兜底解析（结果质量可能下降，界面要如实说） */
  usedFallback: boolean;
  /** 上次送检的题数（结果面板要说清「审的是哪一批」） */
  auditedCount: number;

  /** 送检一批题（上限 `INTERVIEW_LIMITS.auditTargets`，多的部分自己截） */
  run: (targets: readonly InterviewQuestion[]) => Promise<void>;
  /** 忽略一条（只从报告里移除，不写库） */
  discard: (id: string) => void;
  reset: () => void;
}

/** 严重程度排序权重（展示顺序 = 必改 → 该改 → 可选） */
const SEVERITY_WEIGHT: Record<AuditSeverity, number> = { high: 0, medium: 1, low: 2 };

/** 中文 / 英文档位都认；认不出按 medium（不把措辞建议标成必改） */
export function normalizeSeverity(raw: string | undefined): AuditSeverity {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "high" || value === "高" || value === "必改") return "high";
  if (value === "low" || value === "低" || value === "可选") return "low";
  return "medium";
}

/** 问题清单：换行 / 分号分隔（模型两种都会写），去空行 */
export function splitIssues(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\r\n；;]+/)
    .map((line) => line.replace(/^\s*[-*\d.、)]+\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * 一条 entry → 质检结论。
 *
 * 只收「id 在本次送检集合里」的条目：模型发明 id 时宁可丢，也不要让建议
 * 落到别的题上（那会让用户去改一道本来没问题的题）。
 */
export function buildAuditIssue(params: {
  entry: Record<string, unknown>;
  targetIds: ReadonlySet<string>;
}): AuditIssue | null {
  const { entry, targetIds } = params;
  const id = String(entry.id ?? "").trim();
  if (!id || !targetIds.has(id)) return null;
  const issues = splitIssues(String(entry.issues ?? ""));
  const suggestion = String(entry.suggestion ?? "").trim();
  // 问题与建议都空 = 这条没有任何信息量（模型可能只回了 id）
  if (issues.length === 0 && !suggestion) return null;
  return {
    id,
    severity: normalizeSeverity(String(entry.severity ?? "")),
    issues,
    suggestion,
  };
}

/** 按严重程度排序（同档保持模型给的顺序，别把「同一个问题的两半」拆散） */
export function sortAuditIssues(issues: readonly AuditIssue[]): AuditIssue[] {
  return [...issues].sort((left, right) => SEVERITY_WEIGHT[left.severity] - SEVERITY_WEIGHT[right.severity]);
}

export function useInterviewAudit(options: UseInterviewAuditOptions): UseInterviewAuditResult {
  const { categories, questionTitles, glossaryTerms, stats } = options;
  const availability = useAiAvailability();

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [usedFallback, setUsedFallback] = useState(false);
  const [auditedCount, setAuditedCount] = useState(0);

  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const context = useMemo(
    () =>
      collectInterviewContext({
        categories: categories.map((node) => ({ id: node.id, label: node.label })),
        stats,
        questionTitles: [...questionTitles],
        glossaryTerms: [...glossaryTerms],
      }),
    [categories, stats, questionTitles, glossaryTerms],
  );

  const run = useCallback(
    async (targets: readonly InterviewQuestion[]): Promise<void> => {
      if (!availability.available) {
        setError(availability.reasonText || "AI 当前不可用");
        return;
      }
      const batch = targets.slice(0, INTERVIEW_LIMITS.auditTargets);
      if (batch.length === 0) {
        setError("当前筛选下没有题目可检");
        return;
      }

      setRunning(true);
      setError(null);
      setUsedFallback(false);

      const payload: InterviewAuditTarget[] = batch.map((question) => ({
        id: question.id,
        title: question.title,
        stem: question.stem,
        answer: question.answer,
        categoryId: question.categoryId,
        difficulty: question.difficulty,
        ...(question.tags.length > 0 ? { tags: [...question.tags] } : {}),
      }));
      const spec = buildPromptSpec("interviewAudit", context, { targets: payload });
      const result = await aiGenerateStructured({
        system: spec.system,
        prompt: spec.prompt,
        intent: "interviewAudit",
        scope: "L1",
        // 最多一题一条：limit 用送检题数，别让模型多出来的条目挤掉真问题
        count: batch.length,
        outputFormat: spec.outputFormat,
      }).catch((failure: unknown) => ({
        ok: false as const,
        code: "internal" as const,
        message: failure instanceof Error ? failure.message : String(failure),
      }));

      if (cancelledRef.current) return;
      if (!result.ok) {
        setRunning(false);
        setError(result.message || "AI 质检失败，请稍后重试");
        return;
      }

      const targetIds = new Set(batch.map((question) => question.id));
      const built: AuditIssue[] = [];
      for (const entry of result.data.entries) {
        const issue = buildAuditIssue({ entry: { ...entry }, targetIds });
        if (!issue) continue;
        // 同一题出现两条：合并问题清单（模板要求一题一条，模型偶尔拆开写）
        const existing = built.find((item) => item.id === issue.id);
        if (existing) {
          existing.issues.push(...issue.issues.filter((line) => !existing.issues.includes(line)));
          if (!existing.suggestion) existing.suggestion = issue.suggestion;
          continue;
        }
        built.push(issue);
      }

      setRunning(false);
      setUsedFallback(result.data.usedFallback);
      setIssues(sortAuditIssues(built));
      setAuditedCount(batch.length);

      if (built.length === 0) {
        // 「没发现问题」是正常结果，不是错误：面板会显示空态说明，
        // 不要用红字把用户吓回去（只有调用失败才走 `error`）
        return;
      }
      void logAiEvent({
        intent: "interviewAudit",
        step: "generate",
        itemCount: built.length,
        scope: "L1",
      }).catch(() => undefined);
    },
    [availability.available, availability.reasonText, context],
  );

  const discard = useCallback((id: string): void => {
    setIssues((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const reset = useCallback((): void => {
    setIssues([]);
    setError(null);
    setUsedFallback(false);
    setAuditedCount(0);
  }, []);

  return {
    available: availability.available,
    hidden: availability.hidden,
    unavailableText: availability.reasonText,
    running,
    error,
    issues,
    usedFallback,
    auditedCount,
    run,
    discard,
    reset,
  };
}

/** 三档的中文短标签（口径仍以 prompt 层的 `AUDIT_SEVERITY_LABELS` 为准，这里只求一行放得下） */
export const AUDIT_SEVERITY_SHORT: Record<AuditSeverity, string> = {
  high: "必改",
  medium: "该改",
  low: "可选",
};
