/**
 * 自定义分类（`interview_taxonomy`）的写通道。
 *
 * 【为什么分类要单独一个 hook】
 * 分类不是条目：它没有 `action` / `status` 那套 COW 语义，也不能删（删了题会悬空），
 * 只有 `draft`（AI 建议 / 用户还没确认）与 `adopted`（进侧栏）两个状态。
 * 挂进 `useQuestionOverride` 会把「改题」与「改结构」两件事搅在一起。
 *
 * 【为什么保存要带全量字段】
 * 主进程的 `interview-taxonomy-save` 是 upsert，缺省字段会被写成 `null` /
 * 默认 order。所以「只改状态」也必须把 label / track / note / orderNo 一起发，
 * 否则一采纳就把分类名清空了。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §9（三层闸门）
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TAXONOMY_LABEL_MAX } from "@/shared/ai/context/prompt";
import type { InterviewTaxonomyDTO } from "@/shared/types/electron";
import { CATEGORIES } from "../data/interview-taxonomy";
import type { QuestionTrack } from "../data/interview-types";

/** 新建分类的输入 */
export interface TaxonomyDraft {
  label: string;
  track: QuestionTrack;
  note?: string;
}

export interface UseInterviewTaxonomyResult {
  /** 正在写的那条分类 id（按钮 loading）；`null` = 空闲 */
  pendingId: string | null;
  /** 最近一次失败的原因（给用户看的中文原话） */
  error: string | null;
  clearError: () => void;
  /**
   * 新建（默认 `draft`，用户点「采纳」后才进侧栏）。
   *
   * 成功返回**新分类的 id**（失败 `null`）：AI 建议采纳之后要立刻拿这个 id 去
   * 出示例题，只回一个 boolean 的话调用方还得回来把 id 再猜一遍。
   */
  create: (draft: TaxonomyDraft, status?: "draft" | "adopted") => Promise<string | null>;
  /** 改状态（采纳 / 退回草稿） */
  setStatus: (row: InterviewTaxonomyDTO, status: "draft" | "adopted") => Promise<boolean>;
  /** 删除（软删；基线分类不在库里，只有用户新增的会出现在面板上） */
  remove: (row: InterviewTaxonomyDTO) => Promise<boolean>;
}

/** 分类名 → id 片段：中文名拿不到 ASCII 就回落 `u-c-<时间戳>`，仍保证唯一前缀 */
function slugOf(label: string): string {
  const ascii = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return ascii || Math.random().toString(36).slice(2, 8);
}

/** 轨道 → 中文（报错文案用） */
const TRACK_TEXT: Record<QuestionTrack, string> = {
  written: "笔试题",
  foundation: "基础知识库",
};

export function useInterviewTaxonomy(
  taxonomy: readonly InterviewTaxonomyDTO[],
  reload: () => void,
): UseInterviewTaxonomyResult {
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

  const write = useCallback(
    async (payload: {
      id: string;
      label: string;
      track: string;
      orderNo: number;
      status: "draft" | "adopted";
      note: string | null;
    }): Promise<boolean> => {
      const api = window.electronAPI?.interview;
      if (!api) {
        setError("当前环境没有本地题库通道");
        return false;
      }
      setPendingId(payload.id);
      setError(null);
      try {
        const result = await api.taxonomySave(payload);
        if (cancelledRef.current) return false;
        if (!result.ok) {
          setError(result.errors.join("；") || "保存分类失败");
          return false;
        }
        reload();
        return true;
      } catch (failure) {
        if (cancelledRef.current) return false;
        setError(
          `保存分类失败（${failure instanceof Error ? failure.message : String(failure)}）`,
        );
        return false;
      } finally {
        if (!cancelledRef.current) setPendingId(null);
      }
    },
    [reload],
  );

  const create = useCallback(
    async (draft: TaxonomyDraft, status: "draft" | "adopted" = "draft"): Promise<string | null> => {
      const label = draft.label.trim();
      if (!label) {
        setError("分类名称不能为空");
        return null;
      }
      if (label.length > TAXONOMY_LABEL_MAX) {
        setError(`分类名称最多 ${TAXONOMY_LABEL_MAX} 字（侧栏一行放不下）`);
        return null;
      }
      // 同名分类会让侧栏出现两行一样的字，用户点哪个都像点错。
      // 22 个基线分类也要一起比：`CATEGORIES` 是源码常量、不在这张表里，
      // 只比 `taxonomy` 的话「React」这种名字能被新建出第二遍。
      const takenLabels = [
        ...CATEGORIES.map((node) => node.label),
        ...taxonomy.map((row) => row.label),
      ];
      const duplicated = takenLabels.some(
        (taken) => taken.trim().toLowerCase() === label.toLowerCase(),
      );
      if (duplicated) {
        setError(`已经有叫「${label}」的分类了`);
        return null;
      }

      // 续排在已有自定义分类之后（基线占 1-22，这里恒 >= 100）
      const maxOrder = taxonomy.reduce((max, row) => Math.max(max, row.orderNo), 99);
      const id = `u-c-${slugOf(label)}`;
      const done = await write({
        id,
        label,
        track: draft.track,
        orderNo: maxOrder + 1,
        status,
        note: draft.note?.trim() ? draft.note.trim() : null,
      });
      if (done && status === "adopted") {
        setError(null);
      }
      return done ? id : null;
    },
    [taxonomy, write],
  );

  const setStatus = useCallback(
    async (row: InterviewTaxonomyDTO, status: "draft" | "adopted"): Promise<boolean> =>
      write({
        id: row.id,
        label: row.label,
        track: row.track,
        orderNo: row.orderNo,
        status,
        note: row.note,
      }),
    [write],
  );

  const remove = useCallback(
    async (row: InterviewTaxonomyDTO): Promise<boolean> => {
      // 只收用户新增（u- 前缀）：基线分类根本不在库表里，这里是双保险
      if (!row.id.startsWith("u-")) {
        setError("基线分类不能删除");
        return false;
      }
      const api = window.electronAPI?.interview;
      if (!api) {
        setError("当前环境没有本地题库通道");
        return false;
      }
      const result = await api.taxonomyDelete(row.id);
      if (!result.ok) {
        setError(result.errors[0] ?? "没有删除成功");
        return false;
      }
      setError(null);
      await reload();
      return true;
    },
    [reload],
  );

  return { pendingId, error, clearError, create, setStatus, remove };
}

/** 轨道中文（面板与提示共用） */
export function trackText(track: string): string {
  return track === "written" || track === "foundation" ? TRACK_TEXT[track] : track;
}
