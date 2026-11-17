/**
 * 合并视图的**货源**：把「源码基线」与「库内增量」这两头喂给 `mergeInterviewBank`。
 *
 * 【为什么不把这两步写进合并函数】
 * `merge-interview-bank.ts` 是纯算法：它只认 `MergeBaseline` / `MergeRow` 两个已经
 * 归一好的形状，不 import 任何常量、不 import `@/shared/types`。这样它能被
 * 「手写小基线」的单测逐条钉住（红了能一眼看出差在哪）。
 * 而「基线是哪些常量」「DTO 怎么投影成 row」是**接线问题**，随通道形态变，
 * 所以单独放这个文件 —— 算法稳定、接线易变，两者不该住在同一个文件里。
 *
 * 【两个函数都是纯函数】
 * 不碰 `window`、不碰 IPC、不抛异常：IPC 的成败归 `useInterviewBank` 管，
 * 这一层只负责「形状转换」，因此可以直接在 vitest 里跑。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §5.2
 */
import type { InterviewItemDetailDTO } from "@/shared/types/electron";
import { QUESTION_BANK } from "../data/interview-bank";
import { DIAGRAMS } from "../data/interview-diagrams";
import { GLOSSARY_TERMS } from "../data/interview-glossary";
import { CATEGORIES } from "../data/interview-taxonomy";
import type { CategoryNode } from "../data/interview-taxonomy";
import type { MergeBaseline, MergeRow } from "./merge-interview-bank";

/** `toMergeRows` 的产物：能进合并的行 + 被丢掉的条数（丢了几条要能说出来） */
export interface MergeRowsResult {
  rows: MergeRow[];
  /** 形状不符合合并要求、被丢弃的条数（>0 时上层要提示「有 N 条没显示」） */
  skipped: number;
}

/**
 * 基线 = 源码常量。
 *
 * `categories` 用参数而不是直接把 `CATEGORIES` 写死：以后接自定义分类时，
 * 调用方传入「22 个基线分类 + 已采纳的 `u-c-*`」，合并函数才有完整的白名单可校。
 * 本轮调用方不传，等价于纯基线；**不要**在这里自己再去拉一次 taxonomy ——
 * 那会拼出第二份真相（合并函数拿不到 `interview_taxonomy`，见其类型注释）。
 */
export function buildMergeBaseline(
  categories: readonly CategoryNode[] = CATEGORIES,
): MergeBaseline {
  return {
    questions: QUESTION_BANK,
    glossary: GLOSSARY_TERMS,
    diagrams: DIAGRAMS,
    categories,
  };
}

/**
 * 库内行（`InterviewItemDetailDTO`）→ 合并行（`MergeRow`）。
 *
 * 【为什么要过滤 action】
 * 库里 `action` 是 TEXT 列：`full` 模式的导出文件里带着 `baseline` 值，
 * 导入后就会混进这张表。合并函数虽然自己也会挡一次（`buildIndex` 里对未知
 * action 记 warning），但那已经是「脏数据进来了」；这里挡在入口，
 * 能把「有几条被丢掉」这个数报给用户。
 *
 * 【payload 原样带过去】
 * 不在这里 `JSON.parse` 也不提前校验：合并函数统一走
 * `coercePayload` + 结构校验，两处各解一次会让「没解析干净的字符串」
 * 在不同路径上得到不同结论。
 */
export function toMergeRows(items: readonly InterviewItemDetailDTO[]): MergeRowsResult {
  const rows: MergeRow[] = [];
  let skipped = 0;

  for (const item of items) {
    const action: string = item.action;
    if (action !== "new" && action !== "override") {
      skipped += 1;
      continue;
    }

    // 空 id 无法做 React `key`、也无法与基线对齐（收藏也认不了），直接丢
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      skipped += 1;
      continue;
    }

    rows.push({
      id,
      kind: item.kind,
      action,
      baseId: item.baseId ?? null,
      status: item.status,
      title: item.title,
      payload: item.payload,
      baseStamp: item.baseStamp ?? null,
      baseHash: item.baseHash ?? null,
      ackBaseHash: item.ackBaseHash ?? null,
      updatedAt: item.updatedAt,
    });
  }

  return { rows, skipped };
}
