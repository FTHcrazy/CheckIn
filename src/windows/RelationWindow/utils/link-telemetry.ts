/**
 * 连线写回埋点（S4 / W-18）
 *
 * 为什么要单独一层：埋点是**唯一**能回答「用户拖了线但没建成」的地方，而
 * 「没建成」有三种完全不同的原因，混在一起就失去意义：
 * - `cancelled`：用户自己关掉了确认弹层（不是问题，但能算出转化率）；
 * - `blocked`：校验没过（自身 / 跨作品 / 空名）—— 说明引导不到位；
 * - `stale` / `invalid-target` / `db`：写库失败（真问题，要能报警）。
 *
 * 两条硬约束：
 * ① **失败也记一条**（只记成功等于把噪声当信号）；
 * ② **埋点永远不影响主流程** —— 通道缺失、IPC 抛错一律静默吞掉。
 */
import type { NovelGraphCommitResult } from "@/shared/types/electron";

/** 一次连线没有落库的原因 */
export type LinkFailReason = "cancelled" | "blocked" | "stale" | "invalid-target" | "db";

export const LINK_CREATED_EVENT = "rel_graph_link_created";

export interface LinkCreatedEvent {
  fromType: string;
  toType: string;
  /** 关系名字数（按码点，中文一字算一） */
  relationLen: number;
  /** 是否并入已有边（同两端 + 同关系名） */
  merged: boolean;
  /** 从按下「创建关系」到拿到结果的毫秒数；取消 / 阻断记 0 */
  ms: number;
  /** 缺省 = 成功 */
  failReason?: LinkFailReason;
}

type CommitFailure = Extract<NovelGraphCommitResult, { ok: false }>;

/** 关系名字数：`length` 会按 UTF-16 算，emoji 记 2 个字，这里按码点 */
export function relationLenOf(relation: string): number {
  return Array.from(relation).length;
}

/** 主进程失败码 → 埋点口径（未知码归 `db`，不要造出第四类） */
export function failReasonOf(code: CommitFailure["code"]): LinkFailReason {
  switch (code) {
    case "stale":
      return "stale";
    case "invalid-target":
      return "invalid-target";
    default:
      return "db";
  }
}

/** 上报一条连线结果。fire-and-forget，任何异常都不外抛。 */
export function logLinkCreated(event: LinkCreatedEvent): void {
  try {
    const api = window.electronAPI?.novel;
    if (!api?.usageLog) return;
    const payload: Record<string, unknown> = {
      fromType: event.fromType,
      toType: event.toType,
      relationLen: event.relationLen,
      merged: event.merged,
      ms: Math.max(0, Math.round(event.ms)),
    };
    if (event.failReason) payload.failReason = event.failReason;
    const result = api.usageLog(LINK_CREATED_EVENT, payload);
    // 有些桩 / 早期版本返回的不是 Promise：只在真有 catch 时挂空处理器
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    // 埋点失败绝不影响建关系
  }
}
