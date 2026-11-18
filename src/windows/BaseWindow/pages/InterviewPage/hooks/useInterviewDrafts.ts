/**
 * 草稿箱的写通道（`status='draft'` 的条目）。
 *
 * 【为什么单独一个 hook】
 * 草稿不是「我改过的基线题」，也不是「我新建的题」：它没有 `baseId`、没有
 * `staleBase` 那套指纹语义，只有「采纳 / 丢弃」两个出口。挂进
 * `useQuestionOverride` 会让那个 hook 的五种来源判断再长一截。
 *
 * 【为什么采纳要走 `itemSetStatus`】
 * 它是唯一会 bump 词表版本号的通道（`interview-item-save` 也会 bump，但那条路径
 * 要求带完整 payload；草稿箱里只有 id）。采纳后必须 `reload()`：合并视图只收
 * `adopted`，不重算的话用户会看到「点了采纳但题库没多一道题」。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §9 / §10.5
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewItemDetailDTO } from "@/shared/types/electron";

export interface UseInterviewDraftsResult {
  /** 正在写的那条草稿 id（按钮 loading）；`null` = 空闲 */
  pendingId: string | null;
  /** 最近一次失败的原因（人话） */
  error: string | null;
  clearError: () => void;
  /** 采纳进题库（草稿 → `adopted`） */
  adopt: (item: InterviewItemDetailDTO) => Promise<boolean>;
  /** 丢弃（彻底删除，不进回收站） */
  discard: (item: InterviewItemDetailDTO) => Promise<boolean>;
}

/** `unknown` 异常 → 人话 */
function describeFailure(failure: unknown): string {
  const detail = failure instanceof Error ? failure.message : String(failure);
  return detail.trim() || "未知错误";
}

export function useInterviewDrafts(reload: () => void): UseInterviewDraftsResult {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const clearError = useCallback((): void => setError(null), []);

  /** 采纳 / 丢弃共用的收尾：错误原样带回，成功后刷新合并视图 */
  const write = useCallback(
    async (
      item: InterviewItemDetailDTO,
      action: "adopt" | "discard",
    ): Promise<boolean> => {
      const api = window.electronAPI?.interview;
      if (!api) {
        setError("当前环境没有本地题库通道");
        return false;
      }
      setPendingId(item.id);
      setError(null);
      try {
        const result =
          action === "adopt" ? await api.itemSetStatus(item.id, "adopted") : await api.itemPurge(item.id);
        if (cancelledRef.current) return false;
        if (!result.ok) {
          setError(result.errors.join("；") || (action === "adopt" ? "采纳失败" : "丢弃失败"));
          return false;
        }
        reload();
        return true;
      } catch (failure) {
        if (cancelledRef.current) return false;
        setError(`${action === "adopt" ? "采纳" : "丢弃"}失败（${describeFailure(failure)}）`);
        return false;
      } finally {
        if (!cancelledRef.current) setPendingId(null);
      }
    },
    [reload],
  );

  const adopt = useCallback(
    (item: InterviewItemDetailDTO): Promise<boolean> => write(item, "adopt"),
    [write],
  );
  const discard = useCallback(
    (item: InterviewItemDetailDTO): Promise<boolean> => write(item, "discard"),
    [write],
  );

  return { pendingId, error, clearError, adopt, discard };
}
