/**
 * 关系推断（R-AI-15）：从正文读关系边 → 候选 → 作者勾选 → 单事务写入
 *
 * 与主窗口的抽取/摘要同一条纪律（M5）：
 * - 正文是 L3 数据，**先授权再发送**；授权弹窗里的字数估算与真正发出去的内容
 *   同源（都来自 `buildChapterScopePayload`），不做「承诺 3000 字实际发 8000」，
 * - AI 不可用时入口不隐藏而是「禁用并说明原因」（M8）：开关关着的人不用看见它，
 *   开关开着只是没配全的人必须看见它才知道去补哪一项。
 *
 * 三条不可越过的边界：
 * 1. **产出不落库**：`run()` 只产候选，写入只发生在 `apply()`（PRD 判据：人工勾选）；
 * 2. **写入只走 `novel-graph-commit`**：`commitLinks` 由 App 传入（内部是
 *    `useGraphCommit`），本 hook 不碰 IPC、不写 `novel_links`；
 * 3. **只建新边**：已有的关系边在构造候选时就被剔除（不会出现在列表里），
 *    所以 `apply()` 写进去的必然是新边。
 *
 * 章节正文**懒加载**：关系窗口平时只要元数据（`editorLoad(false)`），
 * 把全书正文拉过 IPC 会让「打开关系图」变成「打开一本书」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiGenerateStructured, logAiEvent } from "@/shared/ai/ai-client";
import {
  buildChapterScopePayload,
  buildPromptSpec,
  collectBookContext,
  inputCharBudget,
  type BookSnapshot,
} from "@/shared/ai/context";
import { estimateText } from "@/shared/ai/ai-estimate";
import { useAiAvailability } from "@/shared/ai/hooks/useAiAvailability";
import { useAiConsent } from "@/shared/hooks/useAiConsent";
import type { L3Scope } from "@/shared/ai/ai-consent";
import type { NovelEntity, NovelLink } from "@/shared/novel/entity-model";
import {
  buildRelationCandidates,
  countPicked,
  type RelationCandidate,
  type RelationSuggestDropped,
} from "@/shared/novel/relation-suggest";
import type { NovelBundleDTO } from "@/shared/types/electron";
import { buildDraftLink, type DraftEndpoint } from "../utils/relation-draft";

/** 单次推断的候选条数上限（与 prompt 的 `clampLimit` 同档） */
const LIMIT = 20;

/** 已有关系写进 prompt 的条数上限：只用来「别重复」，不必把整张图倒进去 */
const EXISTING_EDGE_LIMIT = 40;

/** 关系窗口里能选的章节（正文只在这一层用，不往上抛） */
export interface SuggestChapter {
  id: string;
  title: string;
  content: string;
}

/** 一次推断会话；null = 还没有点过「从正文推断」 */
export interface RelationSuggestSession {
  chapterId: string;
  chapterTitle: string;
  loading: boolean;
  error: string | null;
  candidates: RelationCandidate[];
  /** 模型没吐合法 JSON、走了兜底解析（结果质量可能下降，面板要如实说） */
  usedFallback: boolean;
  /** 丢弃统计：端点没建卡 / 自己连自己 / 关系名不像关系名 / 重复 */
  dropped: RelationSuggestDropped;
  /** 已写入条数：非 null 时面板显示「已写入 N 条」 */
  applied: number | null;
}

export interface UseRelationSuggestOptions {
  workId: string;
  workName: string;
  /** 本书题材（可空）：prompt 的作品背景用 */
  workGenre?: string;
  entities: readonly NovelEntity[];
  links: readonly NovelLink[];
  /**
   * 写入关系边（App 传入，内部是 `useGraphCommit` 的单事务提交）。
   * 返回 false = 没写进去，本 hook 据它决定「清候选」还是「留着让作者重按」。
   */
  commitLinks: (links: readonly NovelLink[]) => Promise<boolean>;
  onNotify: (type: "success" | "error", text: string) => void;
}

export interface UseRelationSuggestResult {
  /** 弹层是否打开 */
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;

  /** 章节列表（懒加载：首次打开弹层才取正文） */
  chapters: SuggestChapter[];
  chaptersLoading: boolean;
  chapterId: string | null;
  setChapterId: (id: string) => void;

  /** 本次会话 */
  session: RelationSuggestSession | null;
  /** 发起推断（内部会按需弹 L3 授权） */
  run: () => void;
  /** 勾选 / 取消勾选 */
  toggle: (key: string) => void;
  /** 写入勾选的关系边 */
  apply: () => Promise<void>;
  /** 收起重来（清会话） */
  reset: () => void;

  /** L3 授权弹窗 */
  consentOpen: boolean;
  consentEstimate: { chars: number; tokens: number };
  consentNotice: string | null;
  consentScope: L3Scope;
  setConsentScope: (scope: L3Scope) => void;
  consentProvider: "openai" | "ollama";
  confirmConsent: () => Promise<void>;
  cancelConsent: () => void;

  /** AI 不可用的原因（入口据此禁用并说明；空串 = 可用） */
  unavailableText: string;
  /** 是否应当整块不渲染（总开关关 / 通道不在） */
  hidden: boolean;

  /** 真正会写入的条数 */
  pickedCount: number;
}

export function useRelationSuggest(options: UseRelationSuggestOptions): UseRelationSuggestResult {
  const { workId, workName, workGenre, entities, links, commitLinks, onNotify } = options;

  const availability = useAiAvailability();
  const consent = useAiConsent();

  const [open, setOpen] = useState(false);
  const [chapters, setChapters] = useState<SuggestChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [session, setSession] = useState<RelationSuggestSession | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);

  /** 章节正文的装载只做一次（同一窗口内切书才需要重取） */
  const chaptersForRef = useRef<string | null>(null);

  const loadChapters = useCallback(async (): Promise<void> => {
    if (!workId) return;
    if (chaptersForRef.current === workId) return;
    const api = window.electronAPI?.novel;
    if (!api?.editorLoad) {
      onNotify("error", "数据通道不可用（预加载脚本未就绪）");
      return;
    }
    setChaptersLoading(true);
    try {
      const bundle = (await api.editorLoad(true)) as NovelBundleDTO;
      const volumeOrder = new Map(
        bundle.volumes
          .slice()
          .sort((a, b) => a.sort - b.sort)
          .map((volume, index) => [volume.id, index]),
      );
      const list = bundle.chapters
        .filter((item) => item.workId === workId)
        .slice()
        .sort((a, b) => {
          const byVolume = (volumeOrder.get(a.volumeId) ?? 0) - (volumeOrder.get(b.volumeId) ?? 0);
          return byVolume !== 0 ? byVolume : a.sort - b.sort;
        })
        .map((item) => ({ id: item.id, title: item.title, content: item.content }));
      setChapters(list);
      chaptersForRef.current = workId;
      // 默认选「最近在写」的那一章：作者刚写完就来建关系图，多半就是为了它
      setChapterId((current) => {
        if (current && list.some((item) => item.id === current)) return current;
        const latest = bundle.chapters
          .filter((item) => item.workId === workId)
          .reduce<{ id: string; updatedAt: number } | null>((best, item) => {
            if (!best || item.updatedAt > best.updatedAt) {
              return { id: item.id, updatedAt: item.updatedAt };
            }
            return best;
          }, null);
        return latest?.id ?? list[0]?.id ?? null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onNotify("error", `读取章节正文失败：${message}`);
    } finally {
      setChaptersLoading(false);
    }
  }, [workId, onNotify]);

  // 切书：会话与章节缓存都作废（上一本书的候选写进这一本是不可逆的污染）
  useEffect(() => {
    chaptersForRef.current = null;
    setChapters([]);
    setChapterId(null);
    setSession(null);
    setOpen(false);
  }, [workId]);

  const openDialog = useCallback((): void => {
    setOpen(true);
    void loadChapters();
  }, [loadChapters]);

  const closeDialog = useCallback((): void => {
    setOpen(false);
    setConsentOpen(false);
  }, []);

  /** 按授权范围裁出要发送的正文（与授权弹窗的估算同源） */
  const buildPayload = useCallback(
    (targetChapterId: string, scope: L3Scope) => {
      const index = chapters.findIndex((item) => item.id === targetChapterId);
      if (index < 0) return null;
      const chapter = chapters[index];
      const previous = chapters.slice(Math.max(0, index - 2), index);
      return buildChapterScopePayload({
        scope,
        chapter: { title: chapter.title, content: chapter.content },
        previousChapters: previous.map((item) => ({ title: item.title, content: item.content })),
        budget: inputCharBudget(availability.config?.contextLen),
      });
    },
    [chapters, availability.config?.contextLen],
  );

  const consentEstimate = useMemo(() => {
    if (!consentOpen || !chapterId) return { chars: 0, tokens: 0 };
    const payload = buildPayload(chapterId, consent.scope);
    if (!payload?.ok) return { chars: 0, tokens: 0 };
    return estimateText(`${payload.chapterText}\n${payload.contextText ?? ""}`);
  }, [consentOpen, chapterId, consent.scope, buildPayload]);

  const consentNotice = useMemo(() => {
    if (!consentOpen || !chapterId) return null;
    const payload = buildPayload(chapterId, consent.scope);
    return payload?.ok ? null : "关系推断要读正文，请把范围改成「仅本章」或「最近 3 章」";
  }, [consentOpen, chapterId, consent.scope, buildPayload]);

  /** 已有关系写成「A —关系— B」：模型据此避免重复输出 */
  const existingEdges = useMemo(() => {
    const nameOf = new Map(entities.map((entity) => [entity.id, entity.name]));
    const seen = new Set<string>();
    const edges: string[] = [];
    for (const link of links) {
      const from = nameOf.get(link.fromId);
      const to = nameOf.get(link.toId);
      if (!from || !to) continue;
      // 无向：同一对 + 同一关系名只列一次（正反向都算）
      const key = [from, to].sort().join("|") + link.relation;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(`${from} —${link.relation}— ${to}`);
      if (edges.length >= EXISTING_EDGE_LIMIT) break;
    }
    return edges;
  }, [entities, links]);

  const snapshot: BookSnapshot = useMemo(
    () => ({
      workName,
      ...(workGenre ? { workGenre } : {}),
      entities: entities.map((entity) => ({
        type: entity.type,
        name: entity.name,
        aliases: entity.aliases,
        summary: entity.summary,
      })),
    }),
    [workName, workGenre, entities],
  );

  /**
   * 真正发起推断（授权已通过后调用）。
   *
   * 只产候选、**不落库**：落库在 `apply()`。这是 PRD 判据的核心——
   * 「误判关系（仇人判成恋人）很尴尬」，所以必须逐条由人确认。
   */
  const doRun = useCallback(
    async (targetChapterId: string, scope: L3Scope): Promise<void> => {
      const payload = buildPayload(targetChapterId, scope);
      if (!payload || !payload.ok) {
        const message = "当前范围是「选中段落」，关系窗口里没有选区，请改成「仅本章」";
        setSession((prev) => (prev ? { ...prev, loading: false, error: message } : prev));
        onNotify("error", message);
        return;
      }

      const chapter = chapters.find((item) => item.id === targetChapterId);
      const context = collectBookContext(snapshot, "relation");
      const spec = buildPromptSpec("relation", context, {
        chapter: payload.chapterText,
        ...(chapter ? { chapterTitle: chapter.title } : {}),
        scope,
        limit: LIMIT,
        ...(payload.contextText ? { contextText: payload.contextText } : {}),
        ...(existingEdges.length ? { existingEdges } : {}),
      });

      const result = await aiGenerateStructured({
        system: spec.system,
        prompt: spec.prompt,
        intent: "relation",
        scope,
        count: LIMIT,
        outputFormat: spec.outputFormat,
      }).catch((error: unknown) => {
        // 与其余 AI 入口同一条纪律：IPC 侧异常不能留下永远转圈的弹层
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false as const,
          code: "internal" as const,
          message: message || "AI 调用失败，请重试",
        };
      });

      if (!result.ok) {
        setSession((prev) => (prev ? { ...prev, loading: false, error: result.message } : prev));
        return;
      }

      const { candidates, dropped } = buildRelationCandidates(result.data.entries, {
        entities,
        links,
        limit: LIMIT,
      });

      setSession((prev) => {
        const base: RelationSuggestSession = prev ?? {
          chapterId: targetChapterId,
          chapterTitle: chapter?.title ?? "",
          loading: false,
          error: null,
          candidates: [],
          usedFallback: false,
          dropped,
          applied: null,
        };
        if (candidates.length === 0 && result.data.entries.length > 0) {
          return {
            ...base,
            loading: false,
            candidates: [],
            usedFallback: result.data.usedFallback,
            dropped,
            error:
              dropped.unknown > 0
                ? `推断出的 ${dropped.unknown} 条关系里提到了还没建卡的人物，先在「布局 → 抽取设定」里把人物建成卡再来`
                : "推断出的关系都已经画在图上，或关系名无法辨认",
          };
        }
        return {
          ...base,
          chapterId: targetChapterId,
          chapterTitle: chapter?.title ?? "",
          loading: false,
          error:
            result.data.entries.length === 0
              ? "这一章读不出明确的人物关系，可能是出场人物都已建好关系，或正文里没有交代"
              : null,
          candidates,
          usedFallback: result.data.usedFallback,
          dropped,
        };
      });
    },
    [buildPayload, chapters, snapshot, existingEdges, entities, links, onNotify],
  );

  const run = useCallback((): void => {
    if (!chapterId) {
      onNotify("error", "这本书还没有章节，先写一章再来");
      return;
    }
    const chapter = chapters.find((item) => item.id === chapterId);
    if (!chapter || !chapter.content.trim()) {
      onNotify("error", "这一章还没有正文，写点内容再推断关系");
      return;
    }
    if (!availability.available) {
      onNotify("error", availability.reasonText || "AI 功能当前不可用");
      return;
    }
    if (entities.length < 2) {
      onNotify("error", "至少要有两张要素卡才能连出关系，先去工具箱「抽取设定」建卡");
      return;
    }

    setSession({
      chapterId,
      chapterTitle: chapter.title,
      loading: true,
      error: null,
      candidates: [],
      usedFallback: false,
      dropped: { unknown: 0, selfLoop: 0, invalid: 0, duplicate: 0 },
      applied: null,
    });

    if (!consent.l3Enabled) {
      setConsentOpen(true);
      return;
    }
    // 已授权：弹层里的「从正文推断关系」本身就是这一次的确认
    void doRun(chapterId, consent.scope);
  }, [chapterId, chapters, availability, entities.length, consent.l3Enabled, consent.scope, doRun, onNotify]);

  const confirmConsent = useCallback(async (): Promise<void> => {
    if (!chapterId) return;
    const scope = consent.scope;
    setConsentOpen(false);
    const ok = await consent.enableL3();
    if (!ok) {
      setSession((prev) =>
        prev ? { ...prev, loading: false, error: "授权开启失败，请稍后重试" } : prev,
      );
      return;
    }
    void doRun(chapterId, scope);
  }, [chapterId, consent, doRun]);

  const cancelConsent = useCallback((): void => {
    void logAiEvent({ intent: "relation", step: "cancel", scope: consent.scope });
    setConsentOpen(false);
    setSession(null);
  }, [consent.scope]);

  const toggle = useCallback((key: string): void => {
    setSession((prev) =>
      prev
        ? {
            ...prev,
            candidates: prev.candidates.map((item) =>
              item.key === key ? { ...item, selected: !item.selected } : item,
            ),
          }
        : prev,
    );
  }, []);

  /** 写入勾选的关系边：只走 App 传入的单事务提交，绝不直接写库 */
  const apply = useCallback(async (): Promise<void> => {
    if (!session) return;
    const picked = session.candidates.filter((item) => item.selected);
    if (picked.length === 0) {
      onNotify("error", "先勾选要写入的关系");
      return;
    }
    const endpointOf = (id: string): DraftEndpoint | null => {
      const entity = entities.find((item) => item.id === id);
      if (!entity) return null;
      return { id: entity.id, name: entity.name, type: entity.type, typeLabel: "", workId };
    };
    const draftLinks: NovelLink[] = [];
    for (const item of picked) {
      const from = endpointOf(item.fromId);
      const to = endpointOf(item.toId);
      if (!from || !to) continue;
      draftLinks.push(buildDraftLink(from, to, item.relation));
    }
    if (draftLinks.length === 0) {
      onNotify("error", "两端要素已被删除，请刷新后重试");
      return;
    }

    const ok = await commitLinks(draftLinks);
    if (!ok) {
      // 失败不清候选：清掉会让作者以为写进去了（与连线弹层同一条纪律）
      return;
    }

    const removed = new Set(picked.map((item) => item.key));
    setSession((prev) =>
      prev
        ? {
            ...prev,
            applied: (prev.applied ?? 0) + draftLinks.length,
            candidates: prev.candidates.filter((item) => !removed.has(item.key)),
          }
        : prev,
    );
    void logAiEvent({
      intent: "relation",
      step: "adopt",
      itemCount: draftLinks.length,
      scope: consent.scope,
    });
    onNotify("success", `已写入 ${draftLinks.length} 条关系，主窗口右栏已同步`);
  }, [session, entities, workId, commitLinks, consent.scope, onNotify]);

  const reset = useCallback((): void => {
    setSession(null);
  }, []);

  const pickedCount = session ? countPicked(session.candidates) : 0;

  return {
    open,
    openDialog,
    closeDialog,
    chapters,
    chaptersLoading,
    chapterId,
    setChapterId,
    session,
    run,
    toggle,
    apply,
    reset,
    consentOpen,
    consentEstimate,
    consentNotice,
    consentScope: consent.scope,
    setConsentScope: consent.setScope,
    consentProvider: consent.provider,
    confirmConsent,
    cancelConsent,
    unavailableText: availability.available ? "" : availability.reasonText,
    hidden: availability.hidden,
    pickedCount,
  };
}

/** hook 里用到的常量（测试与面板共用，避免两处写死） */
export const RELATION_SUGGEST_LIMIT = LIMIT;
