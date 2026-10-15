/**
 * 新手引导状态机与持久化（PRD FR-04）
 *
 * 为什么放在 shared/novel：guideState 要被书架页（第 1 步）与编辑器页（第 2-5 步）
 * 两个页面读写，还要被行囊窗口的帮助入口读「有没有看完引导」来显隐红点。
 * 跨页共享只能落在这一层，窗口之间禁止互相导入。
 *
 * 存储：复用 `novel_config` 的纯 KV 通道（与 work-numbering 同范式），
 * **不新增数据表**——PRD §4 明确「不改任何数据表结构，引导状态仅新增 1 个 config 键」。
 * 该键不绑定 workId，是安装实例级的一次性标记。
 *
 * 本文件不含 React，纯函数 + 异步读写，供 store 层调用。
 */

import { STORAGE_KEYS } from "./constants";
import { GUIDE_TOTAL_STEPS } from "./guide-copy";

/** config 键：引导状态（不绑作品，全实例一份），与其余 novel 键同登记在 STORAGE_KEYS */
const GUIDE_STORAGE_KEY = STORAGE_KEYS.guideState;

/** 引导状态（PRD §7.4） */
export type GuideState =
  | "not_started"
  | "in_progress"
  | "done"
  | "skipped"
  | "deferred";

/** 持久化记录；结构升级靠 version 判定，旧版本一律按 not_started 兜底 */
export interface GuideRecord {
  version: number;
  state: GuideState;
  /** 当前步 1-5（in_progress 时有效） */
  currentStep: number;
  /** 已看过的步骤，用于埋点 viewedSteps 与续播 */
  stepsViewed: number[];
  /** 已出现过的弱提示 id，出现即记入，重装前不重复（PRD FR-02 R3） */
  tooltipSeen: string[];
  /** 是否打开过帮助中心：B-01 角标消失条件之一 */
  helpOpened: boolean;
  updatedAt: number;
}

const CURRENT_VERSION = 1;

/** 全新安装的初始记录 */
export function createDefaultRecord(): GuideRecord {
  return {
    version: CURRENT_VERSION,
    state: "not_started",
    currentStep: 1,
    stepsViewed: [],
    tooltipSeen: [],
    helpOpened: false,
    updatedAt: 0,
  };
}

/**
 * 解析持久化字符串。
 *
 * 引导配置损坏（JSON 解析失败 / 版本不符 / 字段缺失）一律按 not_started 兜底，
 * 不抛、不弹迁移提示（PRD §11）。这是「引导」而非「业务数据」，宁可重放一遍
 * 也不能让作者卡在打不开的窗口上。
 */
export function parseGuideRecord(raw: string | null): GuideRecord {
  if (!raw) return createDefaultRecord();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createDefaultRecord();
  }
  if (typeof parsed !== "object" || parsed === null) return createDefaultRecord();
  const input = parsed as Partial<GuideRecord>;
  if (input.version !== CURRENT_VERSION) return createDefaultRecord();
  const state = input.state;
  if (
    state !== "not_started" &&
    state !== "in_progress" &&
    state !== "done" &&
    state !== "skipped" &&
    state !== "deferred"
  ) {
    return createDefaultRecord();
  }
  return {
    version: CURRENT_VERSION,
    state,
    currentStep: clampStep(input.currentStep),
    stepsViewed: normalizeNumberList(input.stepsViewed),
    tooltipSeen: normalizeStringList(input.tooltipSeen),
    helpOpened: input.helpOpened === true,
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : 0,
  };
}

export function serializeGuideRecord(record: GuideRecord): string {
  return JSON.stringify(record);
}

function clampStep(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > GUIDE_TOTAL_STEPS) return GUIDE_TOTAL_STEPS;
  return rounded;
}

function normalizeNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const item of value) {
    if (typeof item === "number" && Number.isFinite(item)) {
      const rounded = Math.round(item);
      if (rounded >= 1 && rounded <= GUIDE_TOTAL_STEPS) seen.add(rounded);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) seen.add(item);
  }
  return [...seen];
}

/** 是否应该自动播放引导：仅 not_started 触发，deferred 留给下次启动（调用方判定） */
export function shouldAutoStart(record: GuideRecord): boolean {
  return record.state === "not_started";
}

/** 展示某一步：写入 stepsViewed 并把 currentStep 推进 */
export function recordStepViewed(record: GuideRecord, step: number): GuideRecord {
  const safeStep = clampStep(step);
  const stepsViewed = record.stepsViewed.includes(safeStep)
    ? record.stepsViewed
    : [...record.stepsViewed, safeStep].sort((a, b) => a - b);
  return {
    ...record,
    state: "in_progress",
    currentStep: safeStep,
    stepsViewed,
    updatedAt: Date.now(),
  };
}

/** 走完最后一步 */
export function markDone(record: GuideRecord): GuideRecord {
  return {
    ...record,
    state: "done",
    currentStep: GUIDE_TOTAL_STEPS,
    updatedAt: Date.now(),
  };
}

/** 任一步点「跳过」即终止全程（PRD §7.2 编排规则） */
export function markSkipped(record: GuideRecord): GuideRecord {
  return { ...record, state: "skipped", updatedAt: Date.now() };
}

/** 延后到下次启动，同一会话内不再弹 */
export function markDeferred(record: GuideRecord): GuideRecord {
  return { ...record, state: "deferred", updatedAt: Date.now() };
}

/** 帮助中心「重看新手引导」：重置为 not_started 由调用方立即播放（不写自动弹） */
export function resetForReplay(record: GuideRecord): GuideRecord {
  return {
    ...createDefaultRecord(),
    // 已看过的弱提示保留：重看引导不该把长尾提示再骚扰一遍
    tooltipSeen: record.tooltipSeen,
    helpOpened: true,
    updatedAt: Date.now(),
  };
}

/** 记录弱提示已出现；返回新记录（未变化则返回原对象，便于调用方跳过写库） */
export function markTooltipSeen(record: GuideRecord, id: string): GuideRecord {
  if (!id || record.tooltipSeen.includes(id)) return record;
  return {
    ...record,
    tooltipSeen: [...record.tooltipSeen, id],
    updatedAt: Date.now(),
  };
}

/** 弱提示是否还没出现过 */
export function isTooltipUnseen(record: GuideRecord, id: string): boolean {
  return !record.tooltipSeen.includes(id);
}

export function markHelpOpened(record: GuideRecord): GuideRecord {
  if (record.helpOpened) return record;
  return { ...record, helpOpened: true, updatedAt: Date.now() };
}

/**
 * B-01 角标规则：`record.state !== "done"` 时显示（**done 时红点必消失**，
 * 与 PRD B-01 一致）；此外打开过一次帮助中心后也消失。
 * 注意 **skipped 等非 done 状态**（not_started / in_progress / skipped /
 * deferred）之后若从未打开过帮助中心，红点仍保留——这正是 PRD 想要的
 * 「跳过的作者某天点开帮助中心」引导路径。
 */
export function shouldShowHelpBadge(record: GuideRecord): boolean {
  if (record.helpOpened) return false;
  return record.state !== "done";
}

// ── 持久化读写 ──

/** 读取引导状态；库未就绪 / 无值时返回默认记录，不抛 */
export async function fetchGuideState(): Promise<GuideRecord> {
  const api = window.electronAPI?.novel;
  if (!api) return createDefaultRecord();
  try {
    const raw = await api.configGet(GUIDE_STORAGE_KEY);
    return parseGuideRecord(raw);
  } catch {
    return createDefaultRecord();
  }
}

/** 写入引导状态；失败不阻塞引导（引导状态丢了最多重放一次，不该弹错误） */
export async function saveGuideState(record: GuideRecord): Promise<boolean> {
  const api = window.electronAPI?.novel;
  if (!api) return false;
  try {
    return await api.configSet(GUIDE_STORAGE_KEY, serializeGuideRecord(record));
  } catch {
    return false;
  }
}
