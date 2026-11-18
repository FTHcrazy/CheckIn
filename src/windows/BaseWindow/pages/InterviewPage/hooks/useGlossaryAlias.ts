/**
 * 「把划中的词记为某个已有词条的别名」的写通道。
 *
 * 【它解决的是什么】
 * 词表按整词命中，模型出词条时若把 `loader` 写成 `Webpack Loader`，那条词条
 * 在正文里永远点不开（库里明明有）。补别名是唯一能把它救回来的动作 ——
 * 既修历史数据，也覆盖「同一个东西的两种写法」这种真实需求。
 *
 * 【为什么基线词条写 override、自建词条写 new】
 * 主进程校验 `existing.action` 不能改：基线 id 第一次被改就是 `override` 行，
 * 用户自建的本来就是 `new` 行。判据用 `glossaryById` 编译期常量，而不是合并视图
 * 的 `originById` —— 后者可能因为一次还没刷新的 reload 而过时。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §10.2 / §10.3
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SHAPE_LIMITS } from "@/shared/interview/payload-shape";
import type { ElectronAPI } from "@/shared/types/electron";
import { glossaryById, type GlossaryTerm } from "../data/interview-glossary";
import { hashPayload } from "../persistence/interview-hash";
import { hasAlias } from "../persistence/glossary-alias";

type InterviewBridge = ElectronAPI["interview"];

export interface UseGlossaryAliasResult {
  /** 正在写的那条词条 id（按钮 loading）；`null` = 空闲 */
  pendingId: string | null;
  /** 最近一次失败的原因（给用户看的中文原话） */
  error: string | null;
  clearError: () => void;
  /** 把 `raw` 追加成 `term` 的别名；成功返回 `true`（调用方据此关浮层） */
  append: (term: GlossaryTerm, raw: string) => Promise<boolean>;
  /**
   * 删掉 `term` 上的某条别名（全库都不再认这个说法）。
   *
   * 与「这里不是这个词」（`useTermHints`）的分工：
   *   - 别名写错了（AI 把划词原文记成了错的叫法）→ 删别名；
   *   - 别名没问题、只是这一处的文字凑巧构成它 → 只解除这一处。
   */
  remove: (term: GlossaryTerm, alias: string) => Promise<boolean>;
}

const MESSAGE_NO_CHANNEL = "当前环境没有本地题库通道";

function bridge(): InterviewBridge | null {
  return window.electronAPI?.interview ?? null;
}

export function useGlossaryAlias(reload: () => void): UseGlossaryAliasResult {
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

  /**
   * 把词条的别名整体写成 `nextAliases`。
   *
   * 词条 payload 只能整体覆盖（没有「只改 aliases」的通道），所以增删都走这里：
   * 两处各写一份的话，迟早有一处忘了带 `categoryId` —— 主进程会把缺失字段清空，
   * 词条就悄悄掉出原分类。
   *
   * 基线词条第一次被改是 `override` 行（`baseId === id`），自建词条本来就是
   * `new` 行；判据用编译期常量 `glossaryById`，不用合并视图的 `originById`
   * （后者可能因一次还没刷新的 reload 而过时）。
   */
  const persist = useCallback(
    async (term: GlossaryTerm, nextAliases: string[]): Promise<boolean> => {
      const api = bridge();
      if (!api) {
        setError(MESSAGE_NO_CHANNEL);
        return false;
      }

      const payload = {
        id: term.id,
        term: term.term,
        domain: term.domain,
        short: term.short,
        detail: [...term.detail],
        ...(term.en ? { en: term.en } : {}),
        aliases: nextAliases,
        ...(term.related ? { related: [...term.related] } : {}),
        ...(term.categoryId ? { categoryId: term.categoryId } : {}),
      };

      const base = glossaryById(term.id);
      setPendingId(term.id);
      setError(null);
      try {
        const saved = await api.itemSave(
          base
            ? {
                id: term.id,
                kind: "glossary",
                action: "override",
                // handler 校验 `baseId === id`：覆盖行的主键就是基线 id
                baseId: term.id,
                status: "adopted",
                payload,
                // 指纹算的是**基线原文**：拿改过的版本算，这条会永远顶着「基线已更新」
                baseHash: hashPayload(base),
                // base_stamp 走 COALESCE，传 null 不会抹掉已有值
                baseStamp: null,
              }
            : {
                id: term.id,
                kind: "glossary",
                action: "new",
                baseId: null,
                status: "adopted",
                payload,
                baseStamp: null,
                baseHash: null,
              },
        );
        if (cancelledRef.current) return false;
        if (!saved.ok) {
          setError(saved.errors.join("；") || "写入词条失败");
          return false;
        }
        reload();
        return true;
      } catch (failure) {
        if (cancelledRef.current) return false;
        setError(`写入词条失败（${failure instanceof Error ? failure.message : String(failure)}）`);
        return false;
      } finally {
        if (!cancelledRef.current) setPendingId(null);
      }
    },
    [reload],
  );

  const append = useCallback(
    async (term: GlossaryTerm, raw: string): Promise<boolean> => {
      const alias = raw.trim();
      if (!alias) {
        setError("要记成别名的内容不能为空");
        return false;
      }
      if (hasAlias(term, alias)) {
        setError(`「${alias}」已经在「${term.term}」的匹配键里了`);
        return false;
      }
      const limit = SHAPE_LIMITS.glossary.aliases;
      if ((term.aliases?.length ?? 0) >= limit) {
        setError(`「${term.term}」的别名已经有 ${limit} 条了，先清掉一条再补`);
        return false;
      }
      return persist(term, [...(term.aliases ?? []), alias]);
    },
    [persist],
  );

  const remove = useCallback(
    async (term: GlossaryTerm, alias: string): Promise<boolean> => {
      const target = alias.trim().toLowerCase();
      if (!target) {
        setError("要删除的别名不能为空");
        return false;
      }
      const current = term.aliases ?? [];
      const next = current.filter((item) => item.trim().toLowerCase() !== target);
      if (next.length === current.length) {
        setError(`「${term.term}」上没有这条别名（可能刚被删过）`);
        return false;
      }
      // 别名删空时传空数组：`readStringList` 允许空列表，词条本身不受影响
      return persist(term, next);
    },
    [persist],
  );

  return { pendingId, error, clearError, append, remove };
}
