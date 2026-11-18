/**
 * 词条编辑 / 删除的写通道。
 *
 * 【为什么与 `useGlossaryAlias` 分开】
 * 那个 hook 只动 `aliases`（划词补别名 / 删错别名），语义是「修正匹配键」；
 * 这里动的是**词条本身**（词名、领域、分类、定义、细节），一次写整条 payload。
 * 两者共用同一条 `itemSave` 通道，但判据与文案完全不同，合在一起会变成
 * 一个既不管别名也不管词条的四不像。
 *
 * 【基线词条写 override、自建词条写 new】
 * 主进程要求 `existing.action` 不能变，所以判据用编译期常量 `glossaryById`
 * （合并视图的 `originById` 可能因为一次还没刷新的 reload 而过时）。
 *
 * 【删除只收自建词条】
 * 内置词条在基线里，删掉它在下次升级时会被重新合并回来 —— 那是「改不掉」的
 * 假象。内置词条的正确出路是「改内容」或「还原默认」。自建词条走
 * `itemDelete`（软删进回收站），合并视图只收 `adopted`，正文里立刻不再点亮。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §10.3 / §10.4
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ElectronAPI, InterviewWriteResultDTO } from "@/shared/types/electron";
import { glossaryById, type GlossaryTerm } from "../data/interview-glossary";
import { hashPayload } from "../persistence/interview-hash";
import { toGlossaryShape } from "../persistence/glossary-edit";

type InterviewBridge = ElectronAPI["interview"];

/** 一次写操作的结果：`errors` 是主进程 / 校验层的中文原话 */
export interface GlossaryWriteOutcome {
  ok: boolean;
  errors: string[];
}

export interface UseGlossaryEditResult {
  /** 正在写的那条词条 id（按钮 loading）；`null` = 空闲 */
  pendingId: string | null;
  /** 最近一次失败的原因（给用户看的中文原话） */
  error: string | null;
  clearError: () => void;
  /** 保存整条词条（词名 / 领域 / 分类 / 定义 / 细节 / 别名） */
  save: (term: GlossaryTerm) => Promise<GlossaryWriteOutcome>;
  /** 删除自建词条（软删进回收站）；内置词条直接返回失败原因，不发请求 */
  remove: (term: GlossaryTerm) => Promise<GlossaryWriteOutcome>;
}

const MESSAGE_NO_CHANNEL = "当前环境没有本地题库通道";

function bridge(): InterviewBridge | null {
  return window.electronAPI?.interview ?? null;
}

/** `unknown` 异常 → 人话（IPC reject 的原因可能是 Error / 字符串 / 裸对象） */
function describeFailure(label: string, failure: unknown): string {
  const detail =
    failure instanceof Error ? failure.message : typeof failure === "string" ? failure : "";
  const trimmed = detail.trim();
  return trimmed ? `${label}失败（${trimmed}）` : `${label}失败`;
}

export function useGlossaryEdit(reload: () => void): UseGlossaryEditResult {
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

  /** 统一流水线：置 loading → 调通道 → 判结果 → 成功 reload */
  const run = useCallback(
    async (
      id: string,
      label: string,
      action: (api: InterviewBridge) => Promise<InterviewWriteResultDTO>,
    ): Promise<GlossaryWriteOutcome> => {
      const api = bridge();
      if (!api) {
        setError(MESSAGE_NO_CHANNEL);
        return { ok: false, errors: [MESSAGE_NO_CHANNEL] };
      }

      setPendingId(id);
      setError(null);
      try {
        const result = await action(api);
        if (cancelledRef.current) return { ok: false, errors: [] };
        if (!result) {
          const message = `${label}失败：本地题库没有返回结果`;
          setError(message);
          return { ok: false, errors: [message] };
        }
        if (!result.ok) {
          const errors = result.errors.length > 0 ? [...result.errors] : [`${label}失败，请稍后重试`];
          setError(errors.join("；"));
          return { ok: false, errors };
        }
        reload();
        return { ok: true, errors: [] };
      } catch (failure) {
        if (cancelledRef.current) return { ok: false, errors: [] };
        const message = describeFailure(label, failure);
        setError(message);
        return { ok: false, errors: [message] };
      } finally {
        if (!cancelledRef.current) setPendingId(null);
      }
    },
    [reload],
  );

  const save = useCallback(
    async (term: GlossaryTerm): Promise<GlossaryWriteOutcome> => {
      const payload = toGlossaryShape(term);
      const base = glossaryById(term.id);
      if (base) {
        return run(term.id, "保存词条", (api) =>
          api.itemSave({
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
          }),
        );
      }
      if (!term.id.startsWith("u-")) {
        return { ok: false, errors: ["自建词条的 id 必须以 u- 开头"] };
      }
      return run(term.id, "保存词条", (api) =>
        api.itemSave({
          id: term.id,
          kind: "glossary",
          action: "new",
          baseId: null,
          status: "adopted",
          payload,
          baseStamp: null,
          baseHash: null,
        }),
      );
    },
    [run],
  );

  const remove = useCallback(
    async (term: GlossaryTerm): Promise<GlossaryWriteOutcome> => {
      if (glossaryById(term.id) || !term.id.startsWith("u-")) {
        const message = "内置词条不能删除，可以改内容或还原默认";
        setError(message);
        return { ok: false, errors: [message] };
      }
      return run(term.id, "删除词条", (api) => api.itemDelete(term.id));
    },
    [run],
  );

  return { pendingId, error, clearError, save, remove };
}
