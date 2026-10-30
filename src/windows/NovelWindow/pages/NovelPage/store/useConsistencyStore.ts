/**
 * 一致性校对状态（模块级 Zustand store，R-AI-10a）
 *
 * 为什么抽到模块级：扫描是全书的、很可能是几千章的长期结果，面板切 Tab /
 * 收起右栏都不该把它丢掉；同时它是**纯本地**能力，不需要授权、不需要 AI 配置。
 *
 * 扫描线程：交给 `consistency-runner.ts` 在 Worker 里跑（Q1 裁决已改）。
 * 早先的「主线程按 8 章一批让出」只是把几千次卡顿摊薄，扫描期间敲字仍掉帧；
 * 校对是纯函数、不碰 DOM 与 IPC，没有任何必须留在主线程的理由。runner 保留
 * 主线程分片作为降级路径（无 Worker 支持 / 脚本加载失败），因此本文件对
 * 「扫描跑在哪」不做任何假设。
 */

import { create } from "zustand";
import type {
  ConsistencyChapterInput,
  ConsistencyEntityInput,
  ConsistencyIssue,
  ConsistencyLevelInput,
} from "@/shared/novel/consistency";
import { startConsistencyScan } from "./consistency-runner";

/** 面板点结果时的跳转意图，由页面侧消费后清空 */
export interface ConsistencyJumpTarget {
  chapterId: string;
  from: number;
}

export interface ConsistencyState {
  /** 扫描状态 */
  status: "idle" | "scanning" | "done";
  /** 进度 0–1（按已扫章数算） */
  progress: number;
  /** 结果（按「确定在前、命中次数降序」排好） */
  issues: ConsistencyIssue[];
  /** 结果所属作品：切书后旧结果对新书没有意义，靠它判断过期 */
  workId: string | null;
  /** 扫描完成时间（面板显示「上次扫描」） */
  scannedAt: number | null;
  /** 本次扫描的章数（空结果时告诉用户「扫了 N 章没发现问题」） */
  chapterCount: number;
  /** 结果里各类型的条数，供面板做筛选角标 */
  counts: { sure: number; suspect: number; name: number; realm: number };

  /**
   * 扫描全书。
   *
   * `entities` / `realmLevels` 由调用方（面板）传入而不是 store 自己取：
   * store 不 import service / hook（§6.2），数据源只有一个入口更不容易漂移。
   */
  scan: (params: {
    workId: string;
    chapters: ConsistencyChapterInput[];
    entities: ConsistencyEntityInput[];
    realmLevels: ConsistencyLevelInput[];
  }) => void;
  /** 中止在途扫描（保留已完成的部分？不保留：半本结果比没结果更误导） */
  cancel: () => void;
  /** 切作品：清结果与在途调度 */
  reset: () => void;

  /** 面板点结果 → 记录跳转意图 */
  requestJump: (target: ConsistencyJumpTarget) => void;
  consumeJump: () => void;
  jumpTarget: ConsistencyJumpTarget | null;
}

// ── 模块级调度句柄（不进 state：它们不该触发重渲染）────────────────────

let cancelScan: (() => void) | null = null;

function clearScan(): void {
  cancelScan?.();
  cancelScan = null;
}

const EMPTY_COUNTS = { sure: 0, suspect: 0, name: 0, realm: 0 };

/** 统计各维度条数（面板的筛选角标与摘要文案共用） */
function summarize(issues: ConsistencyIssue[]): ConsistencyState["counts"] {
  const counts = { ...EMPTY_COUNTS };
  for (const issue of issues) {
    if (issue.severity === "sure") counts.sure += 1;
    else counts.suspect += 1;
    if (issue.kind === "name-near-miss") counts.name += 1;
    else counts.realm += 1;
  }
  return counts;
}

export const useConsistencyStore = create<ConsistencyState>((set, get) => ({
  status: "idle",
  progress: 0,
  issues: [],
  workId: null,
  scannedAt: null,
  chapterCount: 0,
  counts: { ...EMPTY_COUNTS },
  jumpTarget: null,

  scan: ({ workId, chapters, entities, realmLevels }) => {
    if (get().status === "scanning") return;
    clearScan();

    const total = chapters.length;
    if (total === 0) {
      set({
        status: "done",
        progress: 1,
        issues: [],
        counts: { ...EMPTY_COUNTS },
        workId,
        scannedAt: Date.now(),
        chapterCount: 0,
      });
      return;
    }

    set({ status: "scanning", progress: 0, issues: [], chapterCount: total, workId });

    const handle = startConsistencyScan({
      chapters,
      entities,
      realmLevels,
      onProgress: (scanned) => {
        // 进度先落，面板据此显示「已扫 N/M 章」
        set({ progress: scanned / total });
      },
      onDone: (issues) => {
        cancelScan = null;
        set({
          status: "done",
          progress: 1,
          issues,
          counts: summarize(issues),
          scannedAt: Date.now(),
          chapterCount: total,
        });
      },
      onError: (error) => {
        cancelScan = null;
        // 校对失败不该留下「扫了一半」的假结论，直接回到未扫描态
        console.warn("[consistency] 校对中止", error);
        set({ status: "idle", progress: 0, issues: [], counts: { ...EMPTY_COUNTS } });
      },
    });
    cancelScan = handle.cancel;
  },

  cancel: () => {
    clearScan();
    // 半本结果比没结果更误导（作者会以为「别处都没问题」），直接回到未扫描态
    set({ status: "idle", progress: 0, issues: [], counts: { ...EMPTY_COUNTS } });
  },

  reset: () => {
    clearScan();
    set({
      status: "idle",
      progress: 0,
      issues: [],
      counts: { ...EMPTY_COUNTS },
      workId: null,
      scannedAt: null,
      chapterCount: 0,
      jumpTarget: null,
    });
  },

  requestJump: (target) => set({ jumpTarget: target }),
  consumeJump: () => set({ jumpTarget: null }),
}));
