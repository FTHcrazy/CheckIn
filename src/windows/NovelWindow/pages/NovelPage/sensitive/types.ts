/**
 * 敏感词检测领域类型
 *
 * 与要素标注层（EntityTerm）刻意分开：标注层的词条带实体 id / 类型色，
 * 敏感词只需要「词 + 来源」，两者的命中结果也不该混在同一个装饰层里。
 */

/** 扫描模式：用户自己选，持久化到 config */
export type SensitiveScanMode = "off" | "auto" | "manual";

/** 页面上的模式选项文案 */
export const SENSITIVE_MODE_META: Record<
  SensitiveScanMode,
  { label: string; hint: string }
> = {
  off: {
    label: "关闭",
    hint: "不做任何检测，正文也不高亮",
  },
  auto: {
    label: "自动",
    hint: "边写边扫当前章（停笔 500ms 触发），正文实时标出",
  },
  manual: {
    label: "手动",
    hint: "只在点「扫描」时统计，命中处照样在正文标出",
  },
};

/**
 * 正文高亮的数据源。
 *
 * 三种模式对应三种**语义不同**的标注，不能混：
 *   - `live` 自动模式：按词库实时扫可视区。词库一变标注就变，与输入同步。
 *   - `scan` 手动模式：只标**最近一次扫描的结果**。没点过扫描就一个字都不标 ——
 *     「我没执行，怎么全标红了」正是把两种数据源混用造成的。
 *   - `none` 关闭：整层摘掉。
 *
 * 历史教训（两次都是同一个根因：「标什么」与「何时统计」被绑在一起）：
 *   1. 早先手动模式整层不挂 → 扫出 15 处、正文一个字不标，看着像功能没生效；
 *   2. 后来改成「手动也按词库实时标」→ 从关闭切到手动的瞬间，全文凭空红了，
 *      而面板与状态条仍显示 0，用户完全无法理解这些红色从哪来。
 *
 * 正确的拆法是三件事各归各位：**什么时候扫**（按钮 / 防抖）、
 * **标什么**（词库 / 扫描结果）、**标不标**（关闭）。
 */
export type HighlightSource = "live" | "scan" | "none";

export function resolveHighlightSource(mode: SensitiveScanMode): HighlightSource {
  if (mode === "off") return "none";
  return mode === "auto" ? "live" : "scan";
}

/** 正文层是否挂载（`none` 之外都挂，但手动模式挂的是「扫描结果」而非词库） */
export function isHighlightEnabled(mode: SensitiveScanMode): boolean {
  return resolveHighlightSource(mode) !== "none";
}

/** 词条来源：内置库只读（可屏蔽），用户库可增删改 */
export type SensitiveWordOrigin = "builtin" | "user";

export interface SensitiveWord {
  term: string;
  origin: SensitiveWordOrigin;
}

/**
 * 正文里**一处**命中的原文坐标。
 *
 * 与 `SensitiveHit` 的分工：`SensitiveHit` 是「词 × 章」的聚合（面板列表用，
 * 只留首个命中位置），标红需要每一处，所以扫描时要另存一份区间表。
 * 手动模式的高亮就是以这份区间为数据源的 —— 没扫过 = 空表 = 一个字不标。
 */
export interface SensitiveRange {
  word: string;
  from: number;
  to: number;
}

/** 单条检测结果：按「词 × 章」聚合，点开可跳到首个命中处 */
export interface SensitiveHit {
  word: string;
  chapterId: string;
  chapterTitle: string;
  /** 该词在本章的命中次数 */
  count: number;
  /** 首个命中的文档内偏移（跳转定位用） */
  from: number;
  /** 首个命中的上下文片段 */
  snippet: string;
}

/** 一次扫描的汇总 */
export interface SensitiveScanResult {
  hits: SensitiveHit[];
  /** 命中的词条数（去重） */
  wordCount: number;
  /** 总命中次数 */
  total: number;
  /** 涉及章节数 */
  chapterCount: number;
  scannedAt: number;
  /** 扫描范围：本章 / 全书 */
  scope: "chapter" | "book";
}

/** config 持久化载荷（整读整写） */
export interface SensitiveConfig {
  /** 用户自维护词条 */
  words: string[];
  /** 被屏蔽的内置词条（内置库只读，删除 = 加入本列表） */
  muted: string[];
  /** 扫描模式 */
  mode: SensitiveScanMode;
}

export const DEFAULT_SENSITIVE_CONFIG: SensitiveConfig = {
  words: [],
  muted: [],
  mode: "manual",
};

/** 单条词条最大长度：再长就不像词条了，多半是误粘贴整段文本 */
export const SENSITIVE_TERM_MAX_LENGTH = 40;
