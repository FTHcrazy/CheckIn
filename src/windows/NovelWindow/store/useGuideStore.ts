/**
 * 新手引导状态（NovelWindow 窗口级 store）
 *
 * 为什么是 store 而不是页面内 state：引导横跨书架页（第 1 步）与编辑器页
 * （第 2-5 步）两个页面，且帮助入口在标题栏、行囊窗口也要读「红点该不该亮」。
 * 放在任一页面内，另一页都拿不到；靠 props 层层透传又会穿透 App 层。
 * 与 useSearchStore / useHoverStore 同一范式（模块级单例，跨路由保活）。
 *
 * 为什么不是 shared/novel：`shared/novel/*` 按规范不含 React（work-numbering
 * 守卫即此意），所以纯逻辑与持久化下沉到 `guide-state.ts`，这里只做状态容器。
 *
 * 边界：store 只管引导状态与调度，不认识作品 / 章节数据（能否播放由调用方
 * 传入 hasWork / hasChapter 判定），也不直接碰 DOM（目标可见性在 Tour 组件探测）。
 */

import { create } from "zustand";
import {
  fetchGuideState,
  markDeferred,
  markDone,
  markHelpOpened,
  markSkipped,
  markTooltipSeen,
  recordStepViewed,
  resetForReplay,
  saveGuideState,
  shouldShowHelpBadge,
  type GuideRecord,
} from "@/shared/novel/guide-state";
import {
  GUIDE_TOTAL_STEPS,
  viewOfStep,
} from "@/shared/novel/guide-copy";

/** 打字保护窗口：3 秒内有键入则不打扰（PRD FR-06） */
export const TYPING_GUARD_MS = 3000;

/** Tour 播放来源（埋点字段 source） */
export type GuidePlaySource = "auto" | "replay";

export interface GuideStore {
  record: GuideRecord;
  /** 已完成首次读取；未 hydrate 前不自动播放，避免竞态下误弹 */
  hydrated: boolean;
  /** 正在播放的步骤序号（1-5）；null 表示当前无 Tour */
  playingStep: number | null;
  playSource: GuidePlaySource | null;
  /** 帮助中心开合（单实例） */
  helpOpen: boolean;
  /** 最近一次键入时间戳（打字保护） */
  lastTypingAt: number;

  hydrate: () => Promise<void>;
  /** 编辑器键入时调用：刷新打字时间戳 */
  noteTyping: (now: number) => void;
  /** 是否处于打字保护窗口内（禁止触发任何引导） */
  isTypingBlocked: (now: number) => boolean;
  /** 打字保护触发：播放中的 Tour 让位并延后 */
  yieldToTyping: () => void;

  /**
   * 启动引导，从 `minStep` 与已记录的 currentStep 中取较大者。
   *
   * 传 minStep 是因为「第 1 步在书架页、第 2-5 步在编辑器页」：作者若直接
   * 双击已有作品进编辑器（没经过书架页），从第 2 步开始而不是回到第 1 步。
   *
   * 已在播时**不是一律 return**：若当前播放步与目标步不同视图（书架页握着
   * 编辑器步、或编辑器握着书架步），两个 Tour 实例会互相等对方，引导永远
   * 不再出现——这是「Tour 偶现不显示」的主因。此时允许改拍到目标步，
   * 由对应视图的实例接管；同视图才保持不动（避免重复触发）。
   */
  start: (minStep: number) => void;
  /**
   * 暂停（目标不可见 / 视图未到位）：只收 Tour，**不改 state**。
   *
   * 与 deferred 的区别：deferred 是「作者主动延后」，本次会话不再自动播；
   * pause 是「条件还没到」，等进入编辑器 / 建好章节后由 start() 续播。
   */
  pause: () => void;
  /**
   * 重看引导（帮助中心入口）：重置记录后从 `minStep` 开始播放。
   * 传 minStep 是因为重看时作者可能已在编辑器页，从书架的第 1 步开始会
   * 因目标不可见而直接暂停。
   */
  replay: (minStep: number) => void;
  viewStep: (step: number) => void;
  goNext: () => void;
  skip: () => void;
  complete: () => void;

  openHelp: () => void;
  closeHelp: () => void;

  /**
   * 弱提示消费：返回 true 表示「这次可以显示」，同时立即记入已看（出现即记）。
   * 打字保护期内一律返回 false，且不记入（保护期不算看过）。
   */
  consumeTooltip: (id: string, now: number) => boolean;
}

export const useGuideStore = create<GuideStore>((set, get) => {
  /** 写库：先更新内存再异步落盘，失败不回滚（引导状态丢了最多重放一次） */
  const commit = (next: GuideRecord): void => {
    set({ record: next });
    void saveGuideState(next);
  };

  return {
    record: {
      version: 1,
      state: "not_started",
      currentStep: 1,
      stepsViewed: [],
      tooltipSeen: [],
      helpOpened: false,
      updatedAt: 0,
    },
    hydrated: false,
    playingStep: null,
    playSource: null,
    helpOpen: false,
    lastTypingAt: 0,

    hydrate: async () => {
      const record = await fetchGuideState();
      set({ record, hydrated: true });
      // deferred 只在「下次启动」重新激活：本次会话读回来是 deferred 就转回可播
      if (record.state === "deferred") {
        commit({ ...record, state: "in_progress" });
      }
    },

    noteTyping: (now) => {
      const { playingStep, lastTypingAt } = get();
      // 每秒只更新一次，避免每键都触发 store 订阅者重渲染
      if (now - lastTypingAt < 1000) return;
      set({ lastTypingAt: now });
      // 写作不被打断：播放中的 Tour 一旦作者开始打字就整体让位
      if (playingStep !== null) get().yieldToTyping();
    },

    isTypingBlocked: (now) => now - get().lastTypingAt < TYPING_GUARD_MS,

    yieldToTyping: () => {
      const { record, playingStep } = get();
      if (playingStep === null) return;
      set({ playingStep: null, playSource: null });
      commit(markDeferred(record));
    },

    start: (minStep) => {
      const { record, playingStep, lastTypingAt } = get();
      // 只自动播 not_started 与 in_progress（暂停续播）；done / skipped / deferred 不自动弹
      if (record.state !== "not_started" && record.state !== "in_progress") return;
      // FR-06：作者正在打字时不弹任何引导
      if (Date.now() - lastTypingAt < TYPING_GUARD_MS) return;
      const step = Math.max(record.currentStep, minStep);
      if (step > GUIDE_TOTAL_STEPS) return;
      // 同视图已在播 → 不动。不同视图 → 允许改拍到目标步：否则 playingStep
      // 会一直握着一个本视图播不了的步骤，两个 Tour 实例互相等对方，
      // 引导再也不出现（「偶现不显示」的主因）
      if (
        playingStep !== null &&
        viewOfStep(playingStep) === viewOfStep(step)
      ) {
        return;
      }
      set({ playingStep: step, playSource: "auto" });
    },

    pause: () => {
      if (get().playingStep === null) return;
      set({ playingStep: null, playSource: null });
    },

    replay: (minStep) => {
      const { record } = get();
      const next = resetForReplay(record);
      commit(next);
      set({
        playingStep: Math.max(1, minStep),
        playSource: "replay",
        helpOpen: false,
      });
    },

    viewStep: (step) => {
      const { record } = get();
      commit(recordStepViewed(record, step));
    },

    goNext: () => {
      const { record, playingStep } = get();
      if (playingStep === null) return;
      if (playingStep >= GUIDE_TOTAL_STEPS) {
        set({ playingStep: null, playSource: null });
        commit(markDone(record));
        return;
      }
      const nextStep = playingStep + 1;
      set({ playingStep: nextStep });
      commit(recordStepViewed(record, nextStep));
    },

    skip: () => {
      const { record, playingStep } = get();
      if (playingStep === null) return;
      set({ playingStep: null, playSource: null });
      commit(markSkipped(record));
    },

    complete: () => {
      const { record } = get();
      set({ playingStep: null, playSource: null });
      commit(markDone(record));
    },

    openHelp: () => {
      const { record, helpOpen } = get();
      if (helpOpen) return;
      commit(markHelpOpened(record));
      set({ helpOpen: true });
    },

    closeHelp: () => set({ helpOpen: false }),

    consumeTooltip: (id, now) => {
      const { record, lastTypingAt } = get();
      if (now - lastTypingAt < TYPING_GUARD_MS) return false;
      const seen = record.tooltipSeen.includes(id);
      if (seen) return false;
      commit(markTooltipSeen(record, id));
      return true;
    },
  };
});

/** 帮助入口红点：未看完引导且没打开过帮助中心 */
export function selectHelpBadgeVisible(state: GuideStore): boolean {
  return shouldShowHelpBadge(state.record);
}
