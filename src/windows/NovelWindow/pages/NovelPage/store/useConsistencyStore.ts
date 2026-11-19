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
import type { ConsistencyVerdict } from "@/shared/ai/context";
import { startConsistencyScan } from "./consistency-runner";

/** 面板点结果时的跳转意图，由页面侧消费后清空 */
export interface ConsistencyJumpTarget {
  chapterId: string;
  from: number;
}

/**
 * 一条 AI 判定（R-AI-10b）。
 *
 * 只对 10a 标 `suspect` 的条目产生：`sure` 级已由本地判据定罪，AI 不参与。
 * 保留 `expected` / `candidate` 是为了「AI 判的那一条」能与列表行对上——
 * 模型只会回文字，不会回我们的 issue id。
 */
export interface ConsistencyAiVerdict {
  issueId: string;
  expected: string;
  candidate: string;
  verdict: ConsistencyVerdict;
  reason: string;
}

/** AI 复核状态 */
export type ConsistencyAiStatus = "idle" | "running" | "done" | "error";

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

  // ── AI 复核（R-AI-10b）：只补一列**建议**，不改 10a 的任何判据 ──────────
  /** 复核进度态 */
  aiStatus: ConsistencyAiStatus;
  /** 判定结果（issue id → 判定） */
  aiVerdicts: Record<string, ConsistencyAiVerdict>;
  /** 被丢弃的「编造名字」条数（如实计数，给作者一个交代） */
  aiDropped: number;
  aiError: string | null;
  /** 作者勾选采纳的 issue id（采纳 = 认可判定，不自动改正文） */
  aiAdopted: string[];
  setAiRunning: () => void;
  setAiDone: (payload: {
    verdicts: ConsistencyAiVerdict[];
    dropped: number;
  }) => void;
  setAiError: (message: string) => void;
  /** 勾选 / 取消采纳（只有判定为「错字」的条目可勾） */
  toggleAiAdopt: (issueId: string) => void;
  clearAi: () => void;
}

// ── 模块级调度句柄（不进 state：它们不该触发重渲染）────────────────────

let cancelScan: (() => void) | null = null;

function clearScan(): void {
  cancelScan?.();
  cancelScan = null;
}

const EMPTY_COUNTS = { sure: 0, suspect: 0, name: 0, realm: 0 };

/**
 * AI 复核的空态。
 *
 * 每次重扫都要一起清：旧判定绑在旧 issue id 上，留着只会把「上一轮的建议」
 * 挂到「这一轮的条目」上 —— 作者会照着一条对不上的理由去改正文。
 */
const EMPTY_AI = {
  aiStatus: "idle" as ConsistencyAiStatus,
  aiVerdicts: {} as Record<string, ConsistencyAiVerdict>,
  aiDropped: 0,
  aiError: null,
  aiAdopted: [] as string[],
};

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

  // AI 复核初值：没有任何判定，也没有采纳
  aiStatus: "idle",
  aiVerdicts: {},
  aiDropped: 0,
  aiError: null,
  aiAdopted: [],

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
        ...EMPTY_AI,
      });
      return;
    }

    set({
      status: "scanning",
      progress: 0,
      issues: [],
      chapterCount: total,
      workId,
      ...EMPTY_AI,
    });

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
          ...EMPTY_AI,
        });
      },
      onError: (error) => {
        cancelScan = null;
        // 校对失败不该留下「扫了一半」的假结论，直接回到未扫描态
        console.warn("[consistency] 校对中止", error);
        set({
          status: "idle",
          progress: 0,
          issues: [],
          counts: { ...EMPTY_COUNTS },
          ...EMPTY_AI,
        });
      },
    });
    cancelScan = handle.cancel;
  },

  cancel: () => {
    clearScan();
    // 半本结果比没结果更误导（作者会以为「别处都没问题」），直接回到未扫描态
    set({
      status: "idle",
      progress: 0,
      issues: [],
      counts: { ...EMPTY_COUNTS },
      ...EMPTY_AI,
    });
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
      ...EMPTY_AI,
    });
  },

  requestJump: (target) => set({ jumpTarget: target }),
  consumeJump: () => set({ jumpTarget: null }),

  // ── AI 复核 ────────────────────────────────────────────────
  setAiRunning: () => set({ aiStatus: "running", aiError: null }),

  setAiDone: ({ verdicts, dropped }) =>
    set({
      aiStatus: "done",
      aiDropped: dropped,
      aiError: null,
      // 覆盖式写入：重跑一次复核就该整批换新，不做「新旧混排」
      aiVerdicts: Object.fromEntries(verdicts.map((item) => [item.issueId, item])),
      // 新判定落地后旧采纳作废（可能这一轮判的不是同一批条目）
      aiAdopted: [],
    }),

  setAiError: (message) => set({ aiStatus: "error", aiError: message }),

  toggleAiAdopt: (issueId) =>
    set((state) => ({
      aiAdopted: state.aiAdopted.includes(issueId)
        ? state.aiAdopted.filter((item) => item !== issueId)
        : [...state.aiAdopted, issueId],
    })),

  clearAi: () => set({ ...EMPTY_AI }),
}));
