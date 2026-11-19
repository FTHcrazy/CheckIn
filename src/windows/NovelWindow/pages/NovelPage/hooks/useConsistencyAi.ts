/**
 * 一致性校对 · AI 复核编排（R-AI-10b）
 *
 * 定位（team-lead 裁定⑤）：**只把 10a 标 `suspect` 的残余送 AI**。
 * `sure` 级已由本地判据定罪（整组碎片、数字替换等），AI 不参与、也不许改
 * ——`src/shared/novel/consistency.ts` 一行不动是本项最重要的回归边界。
 *
 * AI 的产物只是**一列建议**：
 * - 只判白名单里的名字，编造的名字丢弃并如实计数（裁定⑥）；
 * - 判为「错字」的条目才出现「采纳」勾选框；
 * - **采纳也不改正文**（沿用 2.13.0 风险应对①）：作者勾选 = 认可这个判定，
 *   改字仍然由他自己按「跳到正文」去改。
 *
 * 授权：送出去的 `snippet` 是正文片段，属 L3 —— 未授权时先弹 `AiConsentDialog`，
 * 估算口径 = 所有片段字数之和（与实发同一份 `suspects` 算出来）。
 */
import { useCallback, useMemo, useState } from "react";
import type { ToastTone } from "@/shared/novel/use-auto-toast";
import { aiGenerateStructured, logAiEvent } from "@/shared/ai/ai-client";
import { estimateText } from "@/shared/ai/ai-estimate";
import { useAiConsent } from "@/shared/hooks/useAiConsent";
import {
  buildPromptSpec,
  collectBookContext,
  CONSISTENCY_MAX_SUSPECTS,
  CONSISTENCY_OUTPUT_FORMAT,
  CONSISTENCY_VERDICTS,
  isTypoVerdict,
  type BookSnapshot,
  type ConsistencyIntent,
  type ConsistencySuspect,
  type ConsistencyVerdict,
} from "@/shared/ai/context";
import type { ConsistencyIssue } from "@/shared/novel/consistency";
import { useConsistencyStore, type ConsistencyAiVerdict } from "../store/useConsistencyStore";

export interface UseConsistencyAiOptions {
  /** 10a 的全量结果（本 hook 只挑 `suspect` 级） */
  issues: readonly ConsistencyIssue[];
  /** 本书已有的名字（要素名 / 别名 / 境界档位名）：AI 只允许判这些 */
  knownNames: readonly string[];
  /** 上下文快照（要素表作实体白名单，`LIMITS.consistency` 只取名字） */
  snapshot: BookSnapshot;
  notify: (text: string, tone?: ToastTone) => void;
}

export interface UseConsistencyAiResult {
  status: ReturnType<typeof useConsistencyStore.getState>["aiStatus"];
  verdicts: Record<string, ConsistencyAiVerdict>;
  /** 被丢弃的编造名字条数（如实计数） */
  dropped: number;
  error: string | null;
  adopted: readonly string[];
  /** 本次要送出去的疑似条目（面板据此显示条数） */
  suspects: readonly ConsistencySuspect[];
  /** 「本次将发送约 N 字」：按片段字数算，与实发同一份数据 */
  estimate: { chars: number; tokens: number; notice: string | null };
  /** 有可复核的条目（按钮启用条件） */
  canRun: boolean;
  /** 待授权（面板据此渲染 AiConsentDialog） */
  consentPending: boolean;
  scope: ReturnType<typeof useAiConsent>["scope"];
  setScope: ReturnType<typeof useAiConsent>["setScope"];
  provider: ReturnType<typeof useAiConsent>["provider"];
  /** 点按钮：未授权先弹窗，已授权直接跑 */
  requestRun: () => void;
  /** 授权弹窗确认后真正跑 */
  confirmConsent: () => Promise<void>;
  cancelConsent: () => void;
  /** 勾选 / 取消采纳 */
  toggleAdopt: (issueId: string) => void;
  /** 取某条 issue 的判定（无则 undefined） */
  verdictOf: (issueId: string) => ConsistencyAiVerdict | undefined;
}

/** 归一：去掉首尾空白，用于把模型回的文字对回我们的条目 */
const normalize = (value: string): string => value.trim();

/**
 * 一致性 AI 复核。
 *
 * 状态放在 `useConsistencyStore`（模块级）：面板切走再切回来，判定还在。
 */
export function useConsistencyAi(options: UseConsistencyAiOptions): UseConsistencyAiResult {
  const { issues, knownNames, snapshot, notify } = options;
  const consent = useAiConsent();

  const status = useConsistencyStore((state) => state.aiStatus);
  const verdicts = useConsistencyStore((state) => state.aiVerdicts);
  const dropped = useConsistencyStore((state) => state.aiDropped);
  const error = useConsistencyStore((state) => state.aiError);
  const adopted = useConsistencyStore((state) => state.aiAdopted);
  const setAiRunning = useConsistencyStore((state) => state.setAiRunning);
  const setAiDone = useConsistencyStore((state) => state.setAiDone);
  const setAiError = useConsistencyStore((state) => state.setAiError);
  const toggleAiAdopt = useConsistencyStore((state) => state.toggleAiAdopt);

  const [consentPending, setConsentPending] = useState(false);

  /**
   * 送 AI 的条目：只有 `suspect`。
   *
   * `sure` 级在这里就被挡掉了 —— 这是本项最硬的边界，AI 一个字节都不该看到
   * 已经被本地判据定死的条目（也就无从「推翻」它们）。
   */
  const suspectIssues = useMemo(
    () => issues.filter((issue) => issue.severity === "suspect").slice(0, CONSISTENCY_MAX_SUSPECTS),
    [issues],
  );

  const suspects = useMemo<ConsistencySuspect[]>(
    () =>
      suspectIssues.map((issue) => ({
        expected: issue.expected,
        candidate: issue.found,
        occurrences: issue.count,
        snippet: issue.evidence,
      })),
    [suspectIssues],
  );

  /** 待授权时的「将发送约 N 字」：只算片段（名字不算正文） */
  const estimate = useMemo(() => {
    const text = suspects.map((item) => item.snippet).join("\n");
    const counted = estimateText(text);
    return {
      chars: counted.chars,
      tokens: counted.tokens,
      notice:
        suspects.length === 0
          ? "没有「疑似」级条目，AI 复核无从下手"
          : null,
    };
  }, [suspects]);

  const canRun = suspects.length > 0 && status !== "running";

  const run = useCallback(async (): Promise<void> => {
    if (suspects.length === 0) {
      notify("没有「疑似」级条目可复核", "info");
      return;
    }
    const intent: ConsistencyIntent = {
      suspects,
      knownNames: Array.from(new Set(knownNames.map(normalize).filter(Boolean))),
    };
    const context = collectBookContext(snapshot, "consistency");
    const spec = buildPromptSpec("consistency", context, intent);

    // 把「模型回的两栏」对回我们的条目：模型不会回 issue id
    const byPair = new Map<string, ConsistencyIssue>();
    for (const issue of suspectIssues) {
      byPair.set(`${normalize(issue.expected)}|${normalize(issue.found)}`, issue);
    }
    const allowed = new Set(intent.knownNames);

    setAiRunning();
    try {
      const result = await aiGenerateStructured({
        system: spec.system,
        prompt: spec.prompt,
        intent: "consistency",
        outputFormat: CONSISTENCY_OUTPUT_FORMAT,
        count: suspects.length,
      });
      if (!result.ok) {
        setAiError(result.message || "AI 复核失败，请重试");
        return;
      }

      const collected: ConsistencyAiVerdict[] = [];
      let discarded = 0;
      const seen = new Set<string>();

      for (const entry of result.data.entries) {
        const expected = normalize(entry.expected ?? "");
        const candidate = normalize(entry.candidate ?? "");
        const rawVerdict = normalize(entry.verdict ?? "");
        const issue = byPair.get(`${expected}|${candidate}`);
        // 三种丢弃都要计数：对不上条目、判定不是三态之一、expected 不在白名单
        if (!issue || seen.has(issue.id)) {
          discarded += 1;
          continue;
        }
        if (!(CONSISTENCY_VERDICTS as readonly string[]).includes(rawVerdict)) {
          discarded += 1;
          continue;
        }
        if (!allowed.has(expected)) {
          // 裁定⑥：AI 只能判白名单内的名字，编造的名字丢弃并如实计数
          discarded += 1;
          continue;
        }
        seen.add(issue.id);
        collected.push({
          issueId: issue.id,
          expected,
          candidate,
          verdict: rawVerdict as ConsistencyVerdict,
          reason: normalize(entry.reason ?? ""),
        });
      }

      if (collected.length === 0) {
        setAiError("AI 没有给出可用的判定，重试一次");
        return;
      }
      setAiDone({ verdicts: collected, dropped: discarded });
      void logAiEvent({
        intent: "consistency",
        step: "adopt",
        itemCount: collected.length,
      });
      if (discarded > 0) {
        notify(`已复核 ${collected.length} 条，另有 ${discarded} 条判定被丢弃`, "info");
      }
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      setAiError(message || "AI 复核失败，请重试");
    }
  }, [
    suspects,
    suspectIssues,
    knownNames,
    snapshot,
    notify,
    setAiRunning,
    setAiDone,
    setAiError,
  ]);

  const requestRun = useCallback((): void => {
    // 未开 L3 → 先弹授权（片段是正文，属 L3）；已开直接跑
    if (!consent.l3Enabled) {
      setConsentPending(true);
      return;
    }
    void run();
  }, [consent.l3Enabled, run]);

  const confirmConsent = useCallback(async (): Promise<void> => {
    setConsentPending(false);
    const ok = await consent.enableL3();
    if (!ok) {
      notify("授权开启失败，请稍后重试", "warning");
      return;
    }
    void run();
  }, [consent, notify, run]);

  const cancelConsent = useCallback((): void => {
    void logAiEvent({ intent: "consistency", step: "cancel", scope: consent.scope });
    setConsentPending(false);
  }, [consent.scope]);

  const verdictOf = useCallback(
    (issueId: string): ConsistencyAiVerdict | undefined => verdicts[issueId],
    [verdicts],
  );

  const toggleAdopt = useCallback(
    (issueId: string): void => {
      const verdict = verdicts[issueId];
      // 只有「错字」可采纳：另两态的意思是「别动」
      if (!verdict || !isTypoVerdict(verdict.verdict)) return;
      toggleAiAdopt(issueId);
    },
    [verdicts, toggleAiAdopt],
  );

  return {
    status,
    verdicts,
    dropped,
    error,
    adopted,
    suspects,
    estimate,
    canRun,
    consentPending,
    scope: consent.scope,
    setScope: consent.setScope,
    provider: consent.provider,
    requestRun,
    confirmConsent,
    cancelConsent,
    toggleAdopt,
    verdictOf,
  };
}
