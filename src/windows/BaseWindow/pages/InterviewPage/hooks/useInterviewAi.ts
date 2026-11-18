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
  SHAPE_LIMITS,
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
  /**
   * 划词原文（仅 glossary）：模型起的词名与原文不一致时，原文补成别名。
   *
   * 与 `seed` 分开是因为两者用途不同：`seed` 进 prompt 当"围绕它展开"，
   * `anchor` 落进词条让**正文里划中的那一段**能被匹配到。用户改 seed 想换主题时，
   * 两者会分叉，这时候仍然该保证"点进来的那个词"可点。
   */
  anchor?: string;
  /**
   * 「补充释义」（仅 glossary）：锚到已有的那条词条。
   *
   * 三个字段各有用途：`id` 写进新词条的 `related`（点开能互相跳）、`term` / `short`
   * 进 prompt（模型才知道「已经讲到哪，别复述」）；同时 `id` 会从键冲突判定里豁免 ——
   * 给同一条词条补充释义，本来就要用同一个词名。
   */
  supplementOf?: { id: string; term: string; short: string };
}

/** 一批采纳的结果：成功项 key（界面据此把候选从列表里摘掉）+ 失败明细 */
export interface AdoptBatchResult {
  ok: string[];
  failed: { key: string; title: string; reason: string }[];
}

export interface UseInterviewAiOptions {
  /** 合并视图的分类（含自定义）：既是 prompt 的封闭词表，也是候选的落点 */
  categories: readonly { id: string; label: string }[];
  /** 已有题目标题（避重） */
  questionTitles: readonly string[];
  /** 已有词条键（避重） */
  glossaryTerms: readonly string[];
  /**
   * 合并后的**完整**词表（不是上面那个给 prompt 的截断列表）。
   *
   * 两处用途：① 判词条键冲突（规范 §10.3）；② 「补充释义」要拿到原词条的定义。
   * 用完整表是因为「model 看不到第 61 个词」和「库里有没有这个词」是两件事。
   */
  glossary: readonly GlossaryTerm[];
  /** `status='draft'` 的词条键：与草稿撞键要报错，见 §10.3 第三行 */
  draftGlossary?: readonly GlossaryKeyOwner[];
  /** 题库规模 */
  stats: { questions: number; glossaries: number; diagrams: number };
  /** 写完之后重算合并视图（页面那一份 `useInterviewBank().reload`） */
  reload: () => void;
}

/** 一个已经占用词条键的条目（合并词表项或草稿词条，判冲突时只看这几个字段） */
export interface GlossaryKeyOwner {
  id: string;
  term: string;
  aliases?: readonly string[];
  /** 草稿条目没有 en 字段（AI 产物里 en 不参与键），保留可选以对齐两种来源 */
  en?: string;
  /**
   * 词条领域（`GlossaryDomain`）。
   *
   * 用来区分「真重复」与「同名不同义」：同一个词在浏览器性能与 RxJS 里不是
   * 一回事，两条都该留下（正文弹层里并列展示）。只有**同领域**再撞键才算重复。
   * 草稿条目取不到领域，留空按「一律算冲突」处理（宁可挡住也不要进一条隐形词条）。
   */
  domain?: string;
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
  /**
   * 一次采纳多条。
   *
   * 逐条**串行**写入：一条坏候选不该让整批回滚，前一条失败也不该丢掉后面的内容；
   * 并发落库还会撞同一本库的写锁与词表版本号刷新。失败的条目留在候选列表里，
   * 由调用方把原因摊给用户。
   */
  adoptMany: (
    candidates: readonly DraftCandidate[],
    status: "draft" | "adopted",
  ) => Promise<AdoptBatchResult>;
  /** 正在写入的那条候选 key（批量时逐条切换，行内 loading 靠它） */
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

/** 词条参与「键冲突」判定的全部键（大小写 / 首尾空白归一），规范 §10.3 */
export function glossaryKeysOf(source: {
  term?: string;
  en?: string;
  aliases?: readonly string[];
}): string[] {
  const raw = [source.term, source.en, ...(source.aliases ?? [])];
  const keys: string[] = [];
  for (const item of raw) {
    const key = item?.trim().toLowerCase();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** 建「已占用键 → 占用者」表：合并词表 + 草稿词条，同键先到先得 */
export function buildTakenKeys(
  owners: readonly GlossaryKeyOwner[],
): Map<string, GlossaryKeyOwner> {
  const map = new Map<string, GlossaryKeyOwner>();
  for (const owner of owners) {
    for (const key of glossaryKeysOf(owner)) {
      if (!map.has(key)) map.set(key, owner);
    }
  }
  return map;
}

/**
 * 把划词原文补进别名列表（`anchor` 的唯一落地方式）。
 *
 * 不动的三种情况：
 * - 空串；
 * - 与已有的名字（词名 / 英文名 / 别名）归一后相同 —— 加了也是白加；
 * - 超过词名长度上限：`isValidGlossaryShape` 会因此判整条不合法，为了一个
 *   别名让整条词条变成「不可采纳」，代价太大。
 *
 * 别名已满 8 条时挤掉最后一条：**能让划中的词点亮**比多留一个同义词重要。
 */
export function withAnchorAlias(
  aliases: readonly string[],
  anchor: string | undefined,
  known: readonly string[],
): string[] {
  const text = (anchor ?? "").trim();
  if (!text || text.length > SHAPE_LIMITS.glossary.term) return [...aliases];
  const key = text.toLowerCase();
  const seen = [...known, ...aliases];
  if (seen.some((item) => item.trim().toLowerCase() === key)) return [...aliases];
  const limit = SHAPE_LIMITS.glossary.aliases;
  if (aliases.length >= limit) return [...aliases.slice(0, limit - 1), text];
  return [...aliases, text];
}

export interface BuildDraftCandidateParams {
  kind: InterviewKind;
  entry: Record<string, unknown>;
  categoryId: string;
  track: QuestionTrack;
  difficulty: Difficulty;
  /** 已占用的词条键（`buildTakenKeys` 的产物）；只对 glossary 生效 */
  takenKeys?: ReadonlyMap<string, GlossaryKeyOwner>;
  /** 「补充释义」的目标词条 id：它自己的键不算冲突 */
  supplementId?: string;
  /**
   * 划词时用户选中的**原文**（只有 glossary 用）。
   *
   * 【为什么必须收成别名】
   * 模型起的词名与原文经常不一致：划中 `loader`，它交上来 `Webpack Loader` /
   * `模块 loader`。词表匹配是按整词命中的，于是「采纳成功」但正文里那个词
   * 依然点不动 —— 用户看到的就是「加进去了却没生效」。把原文补成别名之后，
   * 无论模型怎么命名，划中的那一段一定能点亮（别名本来就该承担这个职责）。
   */
  anchor?: string;
}

/**
 * 把模型的一条 entry 归一成可入库的产物。
 *
 * `structuralErrors` 只收结构层的失败原因：字段缺失 / 超长 / 混入 JSON 残片。
 * 领域层（分类白名单）不在这里查 —— 落点分类是调用方给的，不来自模型。
 *
 * 词条键冲突（§10.3）算领域校验，但放这里是因为它必须在**候选列表**阶段就可见：
 * 等到点「采纳」才报错，用户已经白点一次。冲突只写 `errors`（红字 + 禁用采纳），
 * 不丢候选 —— 改个词名还能用。
 */
export function buildDraftCandidate(params: BuildDraftCandidateParams): DraftCandidate | null {
  const { kind, entry, categoryId, track, difficulty, takenKeys, supplementId, anchor } = params;

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
    const en = String(entry.en ?? "").trim();
    // 词名与原文不一致时（模型爱把 `loader` 写成 `Webpack Loader`），
    // 把原文补成别名，否则采纳后正文里划中的那个词依然点不动
    const aliases = withAnchorAlias(splitTags(String(entry.aliases ?? "")), anchor, [term, en]);
    // 补充释义：新词条的 related 指回原词条，词条弹层里能互相跳
    const related = supplementId ? [supplementId] : [];
    const glossary: GlossaryTerm = {
      id: newId("u-g", term),
      term,
      domain: normalizeDomain(String(entry.domain ?? ""), categoryId),
      short: String(entry.short ?? "").trim(),
      detail: detail.length > 0 ? detail : ["（AI 未给出展开细节）"],
      categoryId: categoryId as InterviewCategoryId,
      ...(en ? { en } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
      ...(related.length > 0 ? { related } : {}),
    };
    const checked = isValidGlossaryShape(glossary);
    const conflicts: string[] = [];
    if (takenKeys) {
      for (const key of glossaryKeysOf(glossary)) {
        const owner = takenKeys.get(key);
        if (!owner) continue;
        if (owner.id === supplementId) {
          /**
           * 补充释义时**不能**沿用原词条的名字。
           *
           * 不是洁癖：matcher 里同键只认先出现的词条（基线优先），新词条会被
           * 完全遮蔽 —— 既点不开也搜不到，等于一份看不见的内容。所以这里挡住，
           * 并直接给出可照做的命名方式。
           */
          conflicts.push(
            `「${key}」就是原词条的名字：补充释义要换一个能独立检索的词名（如「${owner.term}的内存与 GC」）`,
          );
          continue;
        }
        /**
         * 同名但领域不同 = **允许共存**。
         *
         * 「节流」在浏览器性能里是「单位时间只跑一次」，在 RxJS 里是「丢弃窗口内
         * 后续的值」—— 两条都该留下，正文弹层里并列展示、按领域区分。只有同领域
         * 还撞键才是真重复（多半是重复出词条）。
         *
         * 领域取不到（草稿条目）时按冲突处理：宁可挡住，也不要进一条永远被
         * 先出现者遮蔽的隐形词条。
         */
        if (owner.domain && owner.domain !== glossary.domain) continue;
        conflicts.push(`「${key}」与${owner.id.startsWith("u-") ? "草稿" : "已有"}词条「${owner.term}」的键重复`);
      }
    }
    const fallback: GlossaryShape = {
      id: glossary.id,
      term: glossary.term,
      domain: glossary.domain,
      short: glossary.short,
      detail: [...glossary.detail],
      categoryId: glossary.categoryId,
      ...(glossary.en ? { en: glossary.en } : {}),
      ...(glossary.aliases ? { aliases: [...glossary.aliases] } : {}),
      ...(glossary.related ? { related: [...glossary.related] } : {}),
    };
    return {
      key: glossary.id,
      kind,
      title: glossary.term,
      payload: checked.ok ? checked.value : fallback,
      errors: checked.ok ? conflicts : [...checked.errors, ...conflicts],
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
  const { categories, questionTitles, glossaryTerms, glossary, draftGlossary, stats, reload } = options;
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

  /**
   * 已占用的词条键（合并词表 + 草稿词条）。
   *
   * 依赖 `glossary` 的引用而不是长度：合并结果是不可变的，换一批词条才需要重建。
   * 每次 `generate` 都从这里**复制**一份当批次表 —— 同一轮里出现两个同名词条时，
   * 第二条也该报冲突（模型经常把「事件循环」写两遍）。
   */
  const takenKeys = useMemo(
    () => buildTakenKeys([...glossary, ...(draftGlossary ?? [])]),
    [glossary, draftGlossary],
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
        ...(request.supplementOf
          ? {
              existingTerm: request.supplementOf.term,
              existingShort: request.supplementOf.short,
            }
          : {}),
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
      // 本轮内也做键去重：把已归一的新词条键并进这张表，后一条同名词条立刻报冲突
      const batchKeys = new Map(takenKeys);
      for (const entry of rawEntries) {
        const candidate = buildDraftCandidate({
          kind: request.kind,
          entry,
          categoryId: request.categoryId,
          track,
          difficulty,
          takenKeys: batchKeys,
          ...(request.supplementOf ? { supplementId: request.supplementOf.id } : {}),
          // 「补充释义」不补原文别名：它本来就要换个能独立检索的词名，
          // 沿用原文会被原词条按同键遮蔽（点不开也搜不到）
          ...(request.anchor && !request.supplementOf ? { anchor: request.anchor } : {}),
        });
        if (!candidate) {
          failed.push(String(entry.title ?? entry.term ?? "未命名的产物"));
          continue;
        }
        built.push(candidate);
        if (candidate.kind === "glossary" && "term" in candidate.payload) {
          const owner: GlossaryKeyOwner = {
            id: candidate.payload.id,
            term: candidate.payload.term,
            ...(candidate.payload.en ? { en: candidate.payload.en } : {}),
            ...(candidate.payload.aliases ? { aliases: candidate.payload.aliases } : {}),
          };
          for (const key of glossaryKeysOf(owner)) {
            if (!batchKeys.has(key)) batchKeys.set(key, owner);
          }
        }
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
    [availability.available, availability.reasonText, context, takenKeys],
  );

  /**
   * 写入一条候选。
   *
   * 抽出来是为了让批量采纳能**逐条**拿到成败 —— 一条结构坏掉的候选不该拖垮整批，
   * 也不该因为它在前面就丢掉后面本来能用的内容。
   *
   * `persisted` 与 `reason` 分开：`itemSave` 成功但 `itemSetStatus` 失败时，内容
   * 其实已经以草稿形态进库了。这种条目要报错（不算采纳），但也得留在视图刷新
   * 的范围里 —— 否则用户会在草稿箱里凭空看到一条「不存在」的题。
   */
  const saveCandidate = useCallback(
    async (
      candidate: DraftCandidate,
      status: "draft" | "adopted",
    ): Promise<{ reason: string | null; persisted: boolean }> => {
      const api = bridge();
      if (!api) return { reason: "当前环境没有本地题库通道", persisted: false };
      if (candidate.errors.length > 0) return { reason: candidate.errors[0], persisted: false };
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
        if (!saved.ok) {
          return { reason: saved.errors.join("；") || "写入失败", persisted: false };
        }
        // 先存草稿再转采纳：`itemSetStatus` 是唯一会 bump 词表版本号的通道
        if (status === "adopted") {
          const promoted = await api.itemSetStatus(payload.id, "adopted");
          if (!promoted.ok) {
            return {
              reason: promoted.errors.join("；") || "采纳失败，内容已存为草稿",
              persisted: true,
            };
          }
        }
        return { reason: null, persisted: true };
      } catch (failure) {
        return {
          reason: `写入失败（${failure instanceof Error ? failure.message : String(failure)}）`,
          persisted: false,
        };
      }
    },
    [],
  );

  const adoptMany = useCallback(
    async (
      list: readonly DraftCandidate[],
      status: "draft" | "adopted",
    ): Promise<AdoptBatchResult> => {
      const ok: string[] = [];
      const failed: AdoptBatchResult["failed"] = [];
      if (list.length === 0) return { ok, failed };

      setError(null);
      /** 有任何一条进了库（哪怕只落成草稿）就要重算合并视图 */
      let persistedAny = false;
      for (const candidate of list) {
        if (cancelledRef.current) break;
        setAdoptingKey(candidate.key);
        const outcome = await saveCandidate(candidate, status);
        if (outcome.persisted) persistedAny = true;
        if (outcome.reason === null) ok.push(candidate.key);
        else failed.push({ key: candidate.key, title: candidate.title, reason: outcome.reason });
      }
      if (cancelledRef.current) return { ok, failed };

      setAdoptingKey(null);
      // 只重算一次合并视图：逐条 reload 会让整页正文反复重渲染
      if (ok.length > 0) {
        const adopted = new Set(ok);
        setCandidates((previous) => previous.filter((item) => !adopted.has(item.key)));
      }
      if (persistedAny) reload();
      if (ok.length > 0) {
        void logAiEvent({
          intent: "interviewDraft",
          step: "adopt",
          itemCount: ok.length,
          scope: "L1",
        }).catch(() => undefined);
      }
      return { ok, failed };
    },
    [reload, saveCandidate],
  );

  const adopt = useCallback(
    async (candidate: DraftCandidate, status: "draft" | "adopted"): Promise<boolean> => {
      const result = await adoptMany([candidate], status);
      if (result.ok.length === 1) return true;
      // 单条采纳没有「汇总回执」这一层，失败原因直接落到页面上的错误条
      setError(result.failed[0]?.reason ?? "写入失败");
      return false;
    },
    [adoptMany],
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
    adoptMany,
    adoptingKey,
    discard,
    reset,
    explain,
    askExplain,
    clearExplain,
  };
}
