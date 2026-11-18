/**
 * 词条匹配负例的写通道（「这里不是这个词」）。
 *
 * 【为什么需要它】
 * 词表匹配是纯文本的：「字节流」里的「节流」会命中词条「节流」，正文被切成
 * 「字 / 节流」两段。中文没有分词器就判不出对错，所以把判定权交给用户：
 * 在可点词上右键 →「这里不是「节流」」，把**这一处**的绑定解除。
 *
 * 【解除的是位置，不是词条】
 * 存的是 `词条 id + 匹配键 + 左右各 6 字的窗口`（`muteContextOf`）。
 * 同一段文字在别处出现时指纹不同，那条词条照常可点 —— 这与「删除别名」
 * （`useGlossaryAlias`）是两个动作：
 *   - 这里不是这个词  → 只影响这一处（可撤销）
 *   - 删除别名        → 全库都不再认这个说法（改词条）
 *
 * 规范：docs/spec/interview-db-ai-spec.md §10.2
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ElectronAPI } from "@/shared/types/electron";
import type { GlossaryTerm } from "../data/interview-glossary";
import { muteContextOf } from "../persistence/glossary-matcher";

type InterviewBridge = ElectronAPI["interview"];

export interface UnbindParams {
  /** 被误命中的词条 */
  term: GlossaryTerm;
  /** 命中的键（`GlossarySegment.key`）；缺省用词名 */
  key: string;
  /** 这一段完整原文（算左右窗口用） */
  text: string;
  /** 命中在原文里的起止 */
  start: number;
  end: number;
}

export interface UseTermHintsResult {
  /** 正在写（菜单 loading）；`null` = 空闲 */
  pendingId: string | null;
  /** 最近一次失败的原因（给用户看的中文原话） */
  error: string | null;
  clearError: () => void;
  /** 解除某一处的绑定；成功返回 `true`（调用方据此 toast） */
  unbind: (params: UnbindParams) => Promise<boolean>;
  /** 撤销一条负例（解除错了） */
  restore: (id: string) => Promise<boolean>;
}

const MESSAGE_NO_CHANNEL = "当前环境没有本地题库通道";

function bridge(): InterviewBridge | null {
  return window.electronAPI?.interview ?? null;
}

export function useTermHints(reload: () => void): UseTermHintsResult {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  const unbind = useCallback(
    async ({ term, key, text, start, end }: UnbindParams): Promise<boolean> => {
      const api = bridge();
      if (!api) {
        setError(MESSAGE_NO_CHANNEL);
        return false;
      }
      const { left, right } = muteContextOf(text, start, end);
      setPendingId(term.id);
      setError(null);
      try {
        const saved = await api.hintAdd({
          termId: term.id,
          key: (key || term.term).trim().toLowerCase(),
          left,
          right,
        });
        if (cancelledRef.current) return false;
        if (!saved.ok) {
          setError(saved.errors.join("；") || "解除绑定失败");
          return false;
        }
        reload();
        return true;
      } catch (failure) {
        if (cancelledRef.current) return false;
        setError(
          `解除绑定失败（${failure instanceof Error ? failure.message : String(failure)}）`,
        );
        return false;
      } finally {
        if (!cancelledRef.current) setPendingId(null);
      }
    },
    [reload],
  );

  const restore = useCallback(
    async (id: string): Promise<boolean> => {
      const api = bridge();
      if (!api) {
        setError(MESSAGE_NO_CHANNEL);
        return false;
      }
      setPendingId(id);
      setError(null);
      try {
        const removed = await api.hintRemove(id);
        if (cancelledRef.current) return false;
        if (!removed.ok) {
          setError(removed.errors.join("；") || "撤销失败");
          return false;
        }
        reload();
        return true;
      } catch (failure) {
        if (cancelledRef.current) return false;
        setError(`撤销失败（${failure instanceof Error ? failure.message : String(failure)}）`);
        return false;
      } finally {
        if (!cancelledRef.current) setPendingId(null);
      }
    },
    [reload],
  );

  return { pendingId, error, clearError, unbind, restore };
}
