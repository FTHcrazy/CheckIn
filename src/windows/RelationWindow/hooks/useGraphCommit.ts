/**
 * 关系提交（S3）：新建关系 / 改备注的唯一写入口
 *
 * 三条硬约束都落在这里：
 * ① **提交前先把坐标刷掉**（`flush`）：提交载荷里带 rev，rev 必须是库里的值，
 *    否则本地刚拖的一下会让主进程误判 stale；
 * ② **连点只写一次**：`submittingRef` 是同步锁 —— 用 state 判断会漏掉同一帧里的
 *    第二次点击（setState 还没生效），那正是「连点产生两条关系」的真实成因；
 * ③ **失败不清空、不关框**：错误留在这里给弹层显示，用户重按即可。写成功才
 *    回调 `onCommitted`，让上层合并增量并推进 rev。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NovelLink } from "@/shared/novel/entity-model";
import type {
  NovelGraphCommitLink,
  NovelGraphCommitNote,
  NovelGraphCommitResult,
} from "@/shared/types/electron";
import { commitGraph } from "../services/relation-service";
import type { RelGraphDoc } from "../utils/graph-doc";

/** 一次提交的结果（成功分支） */
export type GraphCommitOk = Extract<NovelGraphCommitResult, { ok: true }>;

export interface CommitInput {
  addLinks?: NovelGraphCommitLink[];
  noteUpdates?: NovelGraphCommitNote[];
}

export interface UseGraphCommitOptions {
  workId: string;
  /** 取当前画布文档（成员 + 坐标 + rev） */
  snapshot: () => RelGraphDoc | null;
  /** 提交前把未落库的坐标写掉 */
  flush: () => Promise<boolean>;
  /** 提交成功后合并增量、推进 rev */
  onCommitted: (result: GraphCommitOk) => void;
  /**
   * 提交失败（失败码原样给出去）。埋点要区分 `stale` / `invalid-target` / `db`，
   * 而失败时 `commit()` 的返回值只有 `null` —— 让上层再读一次 state 拿码会晚一帧，
   * 所以在返回前同步回调。
   */
  onFailed?: (code: CommitFailureCode) => void;
}

/** 失败码（与主进程 `NovelGraphCommitResult` 的失败分支同源） */
export type CommitFailureCode = Extract<NovelGraphCommitResult, { ok: false }>["code"];

export interface UseGraphCommitResult {
  submitting: boolean;
  /** 失败原因（弹层内展示，成功后清空） */
  error: string | null;
  /** 非 null = 这本书的画布在别处改过，需要「重新载入」 */
  staleRev: number | null;
  clearError: () => void;
  commit: (input: CommitInput) => Promise<GraphCommitOk | null>;
}

/** 失败码 → 给用户看的一句话（不含技术细节） */
function failureMessage(result: Extract<NovelGraphCommitResult, { ok: false }>): string {
  switch (result.code) {
    case "stale":
      return "这本书的图已在别处改过，需要重新载入后再提交";
    case "invalid-target":
      return "有要素已被删除或不属于这本书，请刷新后重试";
    case "invalid-link":
      return result.message ?? "这条关系不合法，请检查后重试";
    default:
      return `创建失败：${result.message ?? "数据库写入失败"}`;
  }
}

export function useGraphCommit(options: UseGraphCommitOptions): UseGraphCommitResult {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleRev, setStaleRev] = useState<number | null>(null);
  const submittingRef = useRef(false);

  const optionsRef = useRef(options);
  // 同理 ref 赋值放 effect：commit 只在事件回调里跑，提交发出时这一帧早已提交完
  useEffect(() => {
    optionsRef.current = options;
  });

  const clearError = useCallback(() => {
    setError(null);
    setStaleRev(null);
  }, []);

  const commit = useCallback(async (input: CommitInput): Promise<GraphCommitOk | null> => {
    // 同步锁：同一帧里的第二次点击必须直接被挡掉（state 此时还没更新）
    if (submittingRef.current) return null;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setStaleRev(null);

    const onFailed = optionsRef.current.onFailed;
    try {
      const { workId, snapshot, flush, onCommitted } = optionsRef.current;
      if (!workId) {
        setError("当前没有作品上下文，无法写入");
        onFailed?.("db");
        return null;
      }
      // 坐标先落库：rev 以库里的值为准，否则这次提交会被判成 stale。
      // flush 失败必须中止 —— 否则会拿本地旧 rev 去提交，库里更旧 → 用户
      // 看到「这本书的图已在别处改过」，与真实原因（坐标没写进去）完全不符。
      const flushed = await flush();
      if (!flushed) {
        setError("坐标没能保存，本次提交已取消，请稍后重试");
        onFailed?.("db");
        return null;
      }
      const doc = snapshot();
      const result = await commitGraph({
        workId,
        expectedRev: doc?.rev ?? 0,
        doc: doc ? JSON.stringify(doc) : null,
        addLinks: input.addLinks ?? [],
        noteUpdates: input.noteUpdates ?? [],
      });

      if (!result.ok) {
        if (result.code === "stale") setStaleRev(result.rev ?? -1);
        setError(failureMessage(result));
        onFailed?.(result.code);
        return null;
      }
      onCommitted(result);
      return result;
    } catch (cause) {
      setError(`创建失败：${cause instanceof Error ? cause.message : String(cause)}`);
      onFailed?.("db");
      return null;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, []);

  return useMemo(
    () => ({ submitting, error, staleRev, clearError, commit }),
    [submitting, error, staleRev, clearError, commit],
  );
}

/** 把主进程返回的 created（DTO）映射成窗口内的 NovelLink（类型窄化只在边界做一次） */
export function toNovelLinks(created: GraphCommitOk["created"]): NovelLink[] {
  return created.map((link) => ({
    id: link.id,
    fromType: link.fromType as NovelLink["fromType"],
    fromId: link.fromId,
    toType: link.toType as NovelLink["toType"],
    toId: link.toId,
    relation: link.relation,
    note: link.note,
  }));
}
