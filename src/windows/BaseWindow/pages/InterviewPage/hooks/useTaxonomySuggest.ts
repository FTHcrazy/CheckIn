/**
 * AI 建议分类（`interviewTaxonomySuggest`）。
 *
 * 【为什么单独一个 hook 而不塞进 `useInterviewAi`】
 * 两个的产物性质不同：AI 拓展产出的是**内容**（题 / 词 / 图），落 `interview_item`；
 * 这里的产物是**结构**（分类），落 `interview_taxonomy`，而且必须停在 `draft`
 * 等用户确认（规范 §9 三层闸门）。塞在一起会让「这次生成到底动了什么」变模糊。
 *
 * 【示例题名不是附赠】
 * 建议里带 3 条 `sampleTitles`：采纳后立刻拿它们当种子去出题，新分类才不会以
 * 「0 道题」的状态进侧栏 —— 那是用户判断「功能坏了」的最快方式。
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { aiGenerateStructured, logAiEvent } from "@/shared/ai/ai-client";
import { buildPromptSpec, collectInterviewContext } from "@/shared/ai/context";
import { useAiAvailability } from "@/shared/ai/hooks/useAiAvailability";
import { TAXONOMY_LABEL_MAX, clampTaxonomyCount } from "@/shared/ai/context/prompt";
import type { CategoryNode } from "../data/interview-taxonomy";
import type { QuestionTrack } from "../data/interview-types";

/** 一条分类建议（候选阶段：还没写库） */
export interface TaxonomySuggestion {
  /** 本地唯一 key（React `key` 与「丢弃某条」的标识） */
  key: string;
  label: string;
  track: QuestionTrack;
  note: string;
  /** 3 条示例题名（采纳后当种子出题） */
  samples: string[];
  /** 校验失败原因（非空则采纳按钮禁用） */
  errors: string[];
}

export interface UseTaxonomySuggestOptions {
  /** 合并后的分类表：既进 prompt（封闭词表），也用来判重名 */
  categories: readonly CategoryNode[];
  /**
   * 额外参与「重名」判定的名字（草稿分类）。
   *
   * 草稿分类不在侧栏、也不在 `categories` 里，但它已经占了 `interview_taxonomy`
   * 这张表 —— 建议出同名分类的话，采纳时会被 `create` 拒掉，白点一次。
   */
  takenLabels?: readonly string[];
  /** 已有题目标题（建议里的示例题不该与它们重复） */
  questionTitles: readonly string[];
  stats: { questions: number; glossaries: number; diagrams: number };
  /** 当前侧栏轨道：建议默认落这一侧 */
  track: QuestionTrack;
}

export interface UseTaxonomySuggestResult {
  hidden: boolean;
  suggesting: boolean;
  error: string | null;
  suggestions: TaxonomySuggestion[];
  suggest: (seed?: string) => Promise<void>;
  discard: (key: string) => void;
  reset: () => void;
}

/** 中文轨道名 / 英文枚举都认；认不出按调用方给的默认轨道 */
function normalizeTrack(raw: string | undefined, fallback: QuestionTrack): QuestionTrack {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "written" || value === "手写" || value === "手写题" || value === "笔试") return "written";
  if (value === "foundation" || value === "基础" || value === "基础题") return "foundation";
  return fallback;
}

/** 顿号 / 逗号 / 分号 / 竖线 / 换行分隔的题名串 → 数组（模型几种写法都有） */
function splitSamples(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[、,，;；|\n]+/)
    .map((item) => item.replace(/^\d+[.、)]\s*/, "").trim())
    .filter((item) => item.length > 0)
    .slice(0, 3);
}

/**
 * 一条 entry → 可展示的建议。
 *
 * 缺 `label` 直接丢（没有名字的分类无处可落）；重名 / 超长只记 `errors`，
 * 让用户看见「模型建议了一个已有的分类」这件事本身 —— 它说明分类表已经饱和，
 * 是有用的信息，不该静默吞掉。
 */
export function buildTaxonomySuggestion(params: {
  entry: Record<string, unknown>;
  track: QuestionTrack;
  takenLabels: readonly string[];
  keySeed: string;
}): TaxonomySuggestion | null {
  const { entry, track, takenLabels, keySeed } = params;
  const label = String(entry.label ?? "").trim();
  if (!label) return null;

  const errors: string[] = [];
  if (label.length > TAXONOMY_LABEL_MAX) {
    errors.push(`分类名超过 ${TAXONOMY_LABEL_MAX} 字（侧栏一行放不下）`);
  }
  const normalized = label.toLowerCase();
  if (takenLabels.some((taken) => taken.trim().toLowerCase() === normalized)) {
    errors.push(`已经有叫「${label}」的分类了`);
  }

  return {
    key: `${keySeed}-${label}`,
    label,
    track: normalizeTrack(String(entry.track ?? ""), track),
    note: String(entry.note ?? "").trim(),
    samples: splitSamples(String(entry.sampleTitles ?? "")),
    errors,
  };
}

export function useTaxonomySuggest(
  options: UseTaxonomySuggestOptions,
): UseTaxonomySuggestResult {
  const { categories, takenLabels: extraLabels, questionTitles, stats, track } = options;
  const availability = useAiAvailability();
  const seedPrefix = useId();

  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TaxonomySuggestion[]>([]);

  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  /** 分类名也算「已有条目」：prompt 里要知道哪些方向已经有人占了 */
  const context = useMemo(
    () =>
      collectInterviewContext({
        categories: categories.map((node) => ({ id: node.id, label: node.label })),
        stats,
        questionTitles: [...questionTitles],
      }),
    [categories, stats, questionTitles],
  );

  const suggest = useCallback(
    async (seed?: string): Promise<void> => {
      if (!availability.available) {
        setError(availability.reasonText || "AI 当前不可用");
        return;
      }
      setSuggesting(true);
      setError(null);

      const spec = buildPromptSpec("interviewTaxonomySuggest", context, {
        count: 2,
        track,
        ...(seed?.trim() ? { seed: seed.trim() } : {}),
      });
      const result = await aiGenerateStructured({
        system: spec.system,
        prompt: spec.prompt,
        intent: "interviewTaxonomySuggest",
        scope: "L1",
        count: clampTaxonomyCount(2),
        outputFormat: spec.outputFormat,
      }).catch((failure: unknown) => ({
        ok: false as const,
        code: "internal" as const,
        message: failure instanceof Error ? failure.message : String(failure),
      }));

      if (cancelledRef.current) return;
      if (!result.ok) {
        setSuggesting(false);
        setError(result.message || "AI 生成失败，请稍后重试");
        return;
      }

      const taken = [...categories.map((node) => node.label), ...(extraLabels ?? [])];
      const built: TaxonomySuggestion[] = [];
      result.data.entries.forEach((entry, index) => {
        const suggestion = buildTaxonomySuggestion({
          entry: { ...entry },
          track,
          takenLabels: taken,
          // key 带下标：同一批里模型偶尔会给两条同名建议，纯 label 做 key 会撞
          keySeed: `${seedPrefix}-${index}`,
        });
        if (!suggestion) return;
        // 同一批里两条同名建议只留第一条：重复的那条采纳时必然被 create 拒掉
        if (built.some((item) => item.label.toLowerCase() === suggestion.label.toLowerCase())) return;
        built.push(suggestion);
      });

      setSuggesting(false);
      setSuggestions(built);
      if (built.length === 0) {
        setError("模型这次没有给出可用的分类建议，换个方向再试");
        return;
      }
      void logAiEvent({
        intent: "interviewTaxonomySuggest",
        step: "generate",
        itemCount: built.length,
        scope: "L1",
      }).catch(() => undefined);
    },
    [availability.available, availability.reasonText, context, categories, extraLabels, track, seedPrefix],
  );

  const discard = useCallback((key: string): void => {
    setSuggestions((previous) => previous.filter((item) => item.key !== key));
  }, []);

  const reset = useCallback((): void => {
    setSuggestions([]);
    setError(null);
  }, []);

  return {
    hidden: availability.hidden,
    suggesting,
    error,
    suggestions,
    suggest,
    discard,
    reset,
  };
}
