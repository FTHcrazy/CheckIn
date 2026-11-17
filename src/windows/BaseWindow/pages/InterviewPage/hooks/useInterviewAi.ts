/**
 * 面试题库的 AI 出口：划词解释 + 出题 / 出词 / 出图。
 *
 * 【三条边界】
 * 1. **prompt 不在这里拼**：system 一律来自 `buildPromptSpec("interviewDraft", …)` /
 *    `buildPromptSpec("interviewExplain", …)`（AGENTS §7：prompt 唯一产地
 *    `src/shared/ai/context/prompt/`）；
 * 2. **产出不自动入库**：AI 给的只是一批候选，`adopt()` 才写库。题库是用户资产，
 *    「模型直接往库里塞 10 道题」比「多一次点击」代价大得多；
 * 3. **落库前过结构校验**（`src/shared/interview/payload-shape.ts`）：模型会把
 *    字段名写成中文、把 tags 写成逗号串、把 detail 写成一段话 —— 这里统一归一，
 *    归不动的记 `errors` 交给界面红字，不静默丢。
 *
 * 【为什么上下文从 Provider 取】
 * 采集要的是「这个题库现在长什么样」（分类 / 已有标题 / 已有词条 / 库规模），
 * 这些在合并视图里已经全有了（`useInterviewBank`），再拉一次 IPC 只会得到
 * 两份可能不一致的快照。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §9 / §10.5
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiGenerateStructured, logAiEvent } from "@/shared/ai/ai-client";
import { buildPromptSpec, collectInterviewContext } from "@/shared/ai/context";
import { useAiAvailability } from "@/shared/ai/hooks/useAiAvailability";
import { stripCodeFence } from "@/shared/ai/context/output-spec";
import {
  isValidDiagramShape,
  isValidGlossaryShape,
  isValidQuestionShape,
  type DiagramShape,
  type GlossaryShape,
  type InterviewKind,
  type QuestionShape,
} from "@/shared/interview/payload-shape";
import type { ElectronAPI } from "@/shared/types/electron";
import type { GlossaryDomain, GlossaryTerm } from "../data/interview-glossary";
import { draftSubIntent } from "@/shared/ai/context/prompt";
import type { Difficulty, InterviewCategoryId, InterviewQuestion, QuestionTrack } from "../data/interview-types";

/** 出题 / 出词的默认条数（图恒 1 张，由 prompt 层夹取） */
export const DRAFT_DEFAULT_COUNT = 3;

/** 一轮候选 */
export interface DraftCandidate {
  /** 本地唯一 key（React `key` 与「丢弃某条」的标识，与入库 id 分开） */
  key: string;
  kind: InterviewKind;
  title: string;
  /** 已补全字段的产物，可直接 `itemSave` */
  payload: QuestionShape | GlossaryShape | DiagramShape;
  /** 结构校验的失败原因（非空则「采纳」按钮禁用，只允许丢弃） */
  errors: string[];
}

export interface DraftRequest {
  kind: InterviewKind;
  /** 目标分类 id（22 基线或 `u-c-*`） */
  categoryId: string;
  track?: QuestionTrack;
  difficulty?: Difficulty;
  diagramKind?: "flow" | "timeline" | "compare" | "layers";
  count?: number;
  /** 种子：题干片段 / 原词 */
  seed?: string;
}

export interface UseInterviewAiOptions {
  /** 合并视图的分类（含自定义）：既是 prompt 的封闭词表，也是候选的落点 */
  categories: readonly { id: string; label: string }[];
  /** 已有题目标题（避重） */
  questionTitles: readonly string[];
  /** 已有词条键（避重） */
  glossaryTerms: readonly string[];
  /** 题库规模 */
  stats: { questions: number; glossaries: number; diagrams: number };
  /** 写完之后重算合并视图（页面那一份 `useInterviewBank().reload`） */
  reload: () => void;
}

export interface UseInterviewAiResult {
  /** AI 是否可用 / 是否应当整块不渲染（M8 口径） */
  available: boolean;
  hidden: boolean;
  loading: boolean;
  unavailableText: string;

  /** 正在生成候选 */
  generating: boolean;
  /** 生成失败的原话 */
  error: string | null;
  candidates: DraftCandidate[];
  /** 模型走了兜底解析（结果质量可能下降，界面要如实说） */
  usedFallback: boolean;

  generate: (request: DraftRequest) => Promise<void>;
  /** 采纳一条（`draft` = 只存草稿箱；`adopted` = 直接进题库） */
  adopt: (candidate: DraftCandidate, status: "draft" | "adopted") => Promise<boolean>;
  /** 正在写入的那条候选 key */
  adoptingKey: string | null;
  /** 丢弃一条候选（只从本轮列表移除，不写库） */
  discard: (key: string) => void;
  reset: () => void;

  /** 划词解释：一段给人读的话（text 契约，不落库） */
  explain: { loading: boolean; text: string | null; error: string | null };
  askExplain: (term: string, sentence?: string, stem?: string) => Promise<void>;
  clearExplain: () => void;
}

type InterviewBridge = ElectronAPI["interview"];

/** 渲染层通道；没有 preload（jsdom / 浏览器）时为 `null` */
function bridge(): InterviewBridge | null {
  return window.electronAPI?.interview ?? null;
}

/** 今天（本地日，`YYYY-MM-DD`） */
function todayStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** 校对月份（`YYYY-MM`，与基线题库同口径） */
function monthStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** 标题 / 词 → id 片段：只留 ASCII 字母数字，中文标题一律回落到前缀 */
function slugOf(text: string, fallback: string): string {
  const ascii = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return ascii || fallback;
}

/** `u-q-…` 这类前缀 + 随机后缀：同一批里也不会撞 id */
function newId(prefix: "u-q" | "u-g" | "u-d", text: string): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${slugOf(text, "draft")}-${suffix}`;
}

/** 「、」「，」「,」分隔的标签串 → 数组（模型两种都会写） */
function splitTags(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[、,，;；|]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** 换行分隔的细节 → 数组（prompt 要求 `\n`，模型偶尔会写成一整段） */
function splitDetail(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/\r?\n+/)
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter((item) => item.length > 0);
}

/** 模型给的难度 → 合法枚举（中文档位也认，认不出就 medium） */
function normalizeDifficulty(raw: string | undefined): Difficulty {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "basic" || value === "easy" || value === "初级" || value === "简单") return "basic";
  if (value === "hard" || value === "difficult" || value === "高级" || value === "困难") return "hard";
  return "medium";
}

/** 词条领域：优先认模型给的中文标签，其次按分类猜，最后回落 javascript */
const DOMAIN_BY_LABEL: Record<string, GlossaryDomain> = {
  javascript: "javascript",
  js: "javascript",
  react: "react",
  vue: "vue",
  "浏览器": "browser",
  browser: "browser",
  "网络": "network",
  network: "network",
  "安全": "security",
  security: "security",
  "工程化": "engineering",
  engineering: "engineering",
  electron: "electron",
  node: "node",
  "node.js": "node",
  "算法": "algorithm",
  algorithm: "algorithm",
  "数据库": "database",
  database: "database",
  "操作系统": "os",
  os: "os",
  ai: "ai",
};

/** 分类 id → 默认领域（模型没写 domain 时用它，比一律 javascript 准） */
const DOMAIN_BY_CATEGORY: Record<string, GlossaryDomain> = {
  "foundation-js": "javascript",
  "foundation-ts": "javascript",
  "foundation-react": "react",
  "foundation-vue": "vue",
  "foundation-browser": "browser",
  "foundation-network": "network",
  "foundation-security": "security",
  "foundation-perf": "browser",
  "foundation-engineering": "engineering",
  "foundation-electron": "electron",
  "foundation-node": "node",
  "foundation-os": "os",
  "foundation-database": "database",
  "foundation-ai": "ai",
  "written-algorithm": "algorithm",
};

function normalizeDomain(raw: string | undefined, categoryId: string): GlossaryDomain {
  const key = (raw ?? "").trim().toLowerCase();
  return DOMAIN_BY_LABEL[key] ?? DOMAIN_BY_CATEGORY[categoryId] ?? "javascript";
}

/** 从 text 契约的返回里抠出第一个 JSON 对象（图解走 text，见 draft.ts 的注释） */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const body = stripCodeFence(text);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(body.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 一条候选的展示标题（图解没有 title 字段就叫「图解」） */
function titleOfPayload(payload: DraftCandidate["payload"]): string {
  if ("term" in payload) return payload.term;
  return payload.title;
}

/**
 * 把模型的一条 entry 归一成可入库的产物。
 *
 * `structuralErrors` 只收结构层的失败原因：字段缺失 / 超长 / 混入 JSON 残片。
 * 领域层（分类白名单）不在这里查 —— 落点分类是调用方给的，不来自模型。
 */
export function buildDraftCandidate(params: {
  kind: InterviewKind;
  entry: Record<string, unknown>;
  categoryId: string;
  track: QuestionTrack;
  difficulty: Difficulty;
}): DraftCandidate | null {
  const { kind, entry, categoryId, track, difficulty } = params;

  if (kind === "question") {
    const title = String(entry.title ?? "").trim();
    const stem = String(entry.stem ?? "").trim();
    const answer = String(entry.answer ?? "").trim();
    if (!title || !stem || !answer) return null;

    const stemCode = String(entry.stemCode ?? "").trim();
    const question: InterviewQuestion = {
      id: newId("u-q", title),
      title,
      stem,
      answer,
      track,
      categoryId: categoryId as InterviewCategoryId,
      difficulty: normalizeDifficulty(String(entry.difficulty ?? difficulty)),
      tags: splitTags(String(entry.tags ?? "")),
      topic: String(entry.topic ?? "AI 拓展").trim() || "AI 拓展",
      reviewedAt: monthStamp(),
      heat: 50,
      updatedAt: todayStamp(),
      ...(stemCode ? { stemCode, stemCodeLang: "js" } : {}),
    };
    const checked = isValidQuestionShape(question);
    return {
      key: question.id,
      kind,
      title: question.title,
      payload: checked.ok ? checked.value : question,
      errors: checked.ok ? [] : checked.errors,
    };
  }

  if (kind === "glossary") {
    const term = String(entry.term ?? "").trim();
    if (!term) return null;
    const detail = splitDetail(String(entry.detail ?? ""));
    const aliases = splitTags(String(entry.aliases ?? ""));
    const en = String(entry.en ?? "").trim();
    const glossary: GlossaryTerm = {
      id: newId("u-g", term),
      term,
      domain: normalizeDomain(String(entry.domain ?? ""), categoryId),
      short: String(entry.short ?? "").trim(),
      detail: detail.length > 0 ? detail : ["（AI 未给出展开细节）"],
      categoryId: categoryId as InterviewCategoryId,
      ...(en ? { en } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
    };
    const checked = isValidGlossaryShape(glossary);
    const fallback: GlossaryShape = {
      id: glossary.id,
      term: glossary.term,
      domain: glossary.domain,
      short: glossary.short,
      detail: [...glossary.detail],
      categoryId: glossary.categoryId,
      ...(glossary.en ? { en: glossary.en } : {}),
      ...(glossary.aliases ? { aliases: [...glossary.aliases] } : {}),
    };
    return {
      key: glossary.id,
      kind,
      title: glossary.term,
      payload: checked.ok ? checked.value : fallback,
      errors: checked.ok ? [] : checked.errors,
    };
  }

  // 图解：键名必须与 DiagramShape 逐字一致（flow→nodes / timeline→events / …）
  const title = String(entry.title ?? "").trim();
  const caption = String(entry.caption ?? "").trim();
  if (!title) return null;
  const diagram = {
    ...entry,
    id: newId("u-d", title),
    kind: entry.kind ?? "flow",
    title,
    caption: caption || title,
  } as unknown as DiagramShape;
  const checked = isValidDiagramShape(diagram);
  return {
    key: String(diagram.id),
    kind: "diagram",
    title,
    payload: checked.ok ? checked.value : diagram,
    errors: checked.ok ? [] : checked.errors,
  };
}

/**
 * AI 拓展 + 划词解释。
 *
 * `reload` 由页面注入（`useInterviewBank().reload`）：采纳后必须重算合并视图，
 * 否则新词条不会立刻变成正文里的可点划线，用户会以为没生效。
 */
export function useInterviewAi(options: UseInterviewAiOptions): UseInterviewAiResult {
  const { categories, questionTitles, glossaryTerms, stats, reload } = options;
  const availability = useAiAvailability();

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DraftCandidate[]>([]);
  const [usedFallback, setUsedFallback] = useState(false);
  const [adoptingKey, setAdoptingKey] = useState<string | null>(null);
  const [explain, setExplain] = useState<UseInterviewAiResult["explain"]>({
    loading: false,
    text: null,
    error: null,
  });

  /** 卸载标记：卸载后回来的响应一律不落地（与其余 AI 入口同款） */
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  /** 采集器要的快照：分类是合并后的白名单（含 `u-c-*`），标题 / 词条做避重 */
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

  const generate = useCallback(
    async (request: DraftRequest): Promise<void> => {
      if (!availability.available) {
        setError(availability.reasonText || "AI 当前不可用");
        return;
      }
      setGenerating(true);
      setError(null);
      setUsedFallback(false);

      const spec = buildPromptSpec("interviewDraft", context, {
        kind: request.kind,
        count: request.count ?? DRAFT_DEFAULT_COUNT,
        categoryId: request.categoryId,
        ...(request.track ? { track: request.track } : {}),
        ...(request.difficulty ? { difficulty: request.difficulty } : {}),
        ...(request.diagramKind ? { diagramKind: request.diagramKind } : {}),
        ...(request.seed?.trim() ? { seed: request.seed.trim() } : {}),
      });

      const result = await aiGenerateStructured({
        system: spec.system,
        prompt: spec.prompt,
        intent: "interviewDraft",
        scope: "L1",
        count: request.kind === "diagram" ? 1 : (request.count ?? DRAFT_DEFAULT_COUNT),
        outputFormat: spec.outputFormat,
      }).catch((failure: unknown) => ({
        ok: false as const,
        code: "internal" as const,
        message: failure instanceof Error ? failure.message : String(failure),
      }));

      if (cancelledRef.current) return;
      if (!result.ok) {
        setGenerating(false);
        setError(result.message || "AI 生成失败，请稍后重试");
        return;
      }

      const track: QuestionTrack = request.track ?? "foundation";
      const difficulty: Difficulty = request.difficulty ?? "medium";
      const rawEntries: Record<string, unknown>[] =
        request.kind === "diagram"
          ? (() => {
              const object = extractJsonObject(result.data.text);
              return object ? [object] : [];
            })()
          : result.data.entries.map((entry) => ({ ...entry }));

      const built: DraftCandidate[] = [];
      const failed: string[] = [];
      for (const entry of rawEntries) {
        const candidate = buildDraftCandidate({
          kind: request.kind,
          entry,
          categoryId: request.categoryId,
          track,
          difficulty,
        });
        if (candidate) built.push(candidate);
        else failed.push(String(entry.title ?? entry.term ?? "未命名的产物"));
      }

      setGenerating(false);
      setUsedFallback(result.data.usedFallback);
      setCandidates(built);

      if (built.length === 0) {
        setError(
          request.kind === "diagram"
            ? "模型这次没有给出可解析的图解 JSON，换个图型或补一句种子再试"
            : "模型这次没有给出可用的内容，换个分类或补一句种子再试",
        );
        return;
      }
      if (failed.length > 0) {
        setError(`${failed.length} 条内容缺少必填字段（${failed.slice(0, 3).join(" / ")}），已跳过`);
      }
    },
    [availability.available, availability.reasonText, context],
  );

  const adopt = useCallback(
    async (candidate: DraftCandidate, status: "draft" | "adopted"): Promise<boolean> => {
      const api = bridge();
      if (!api) {
        setError("当前环境没有本地题库通道");
        return false;
      }
      if (candidate.errors.length > 0) {
        setError(candidate.errors[0]);
        return false;
      }

      setAdoptingKey(candidate.key);
      setError(null);
      try {
        const payload = candidate.payload;
        const saved = await api.itemSave({
          id: payload.id,
          kind: candidate.kind,
          action: "new",
          baseId: null,
          status,
          payload,
          categoryId: "categoryId" in payload ? (payload.categoryId ?? null) : null,
          track: "track" in payload ? payload.track : null,
          title: titleOfPayload(payload),
          errors: [],
          sourceIntent: draftSubIntent(candidate.kind),
        });
        if (cancelledRef.current) return false;
        if (!saved.ok) {
          setError(saved.errors.join("；") || "写入失败");
          return false;
        }
        // 先存草稿再转采纳：`itemSetStatus` 是唯一会 bump 词表版本号的通道
        if (status === "adopted") {
          const promoted = await api.itemSetStatus(payload.id, "adopted");
          if (!promoted.ok) {
            setError(promoted.errors.join("；") || "采纳失败，内容已存为草稿");
            reload();
            return false;
          }
        }
        setCandidates((previous) => previous.filter((item) => item.key !== candidate.key));
        reload();
        void logAiEvent({
          intent: "interviewDraft",
          step: "adopt",
          itemCount: 1,
          scope: "L1",
        }).catch(() => undefined);
        return true;
      } catch (failure) {
        if (cancelledRef.current) return false;
        setError(
          `写入失败（${failure instanceof Error ? failure.message : String(failure)}）`,
        );
        return false;
      } finally {
        if (!cancelledRef.current) setAdoptingKey(null);
      }
    },
    [reload],
  );

  const discard = useCallback((key: string): void => {
    setCandidates((previous) => previous.filter((item) => item.key !== key));
  }, []);

  const reset = useCallback((): void => {
    setCandidates([]);
    setError(null);
    setUsedFallback(false);
  }, []);

  const askExplain = useCallback(
    async (term: string, sentence?: string, stem?: string): Promise<void> => {
      if (!availability.available) {
        setExplain({ loading: false, text: null, error: availability.reasonText || "AI 不可用" });
        return;
      }
      setExplain({ loading: true, text: null, error: null });
      const spec = buildPromptSpec("interviewExplain", context, {
        term,
        ...(sentence?.trim() ? { sentence: sentence.trim() } : {}),
        ...(stem?.trim() ? { stem: stem.trim() } : {}),
      });
      const result = await aiGenerateStructured({
        system: spec.system,
        prompt: spec.prompt,
        intent: "interviewExplain",
        scope: "L1",
        outputFormat: spec.outputFormat,
      }).catch((failure: unknown) => ({
        ok: false as const,
        code: "internal" as const,
        message: failure instanceof Error ? failure.message : String(failure),
      }));
      if (cancelledRef.current) return;
      if (!result.ok) {
        setExplain({ loading: false, text: null, error: result.message || "AI 调用失败" });
        return;
      }
      setExplain({ loading: false, text: result.data.text.trim(), error: null });
    },
    [availability.available, availability.reasonText, context],
  );

  const clearExplain = useCallback((): void => {
    setExplain({ loading: false, text: null, error: null });
  }, []);

  return {
    available: availability.available,
    hidden: availability.hidden,
    loading: availability.loading,
    unavailableText: availability.reasonText,
    generating,
    error,
    candidates,
    usedFallback,
    generate,
    adopt,
    adoptingKey,
    discard,
    reset,
    explain,
    askExplain,
    clearExplain,
  };
}
