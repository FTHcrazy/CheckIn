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
    hint: "边写边扫当前章（停止输入 500ms 后触发），正文实时高亮",
  },
  manual: {
    label: "手动",
    hint: "只在点「扫描」时检测，正文不实时高亮",
  },
};

/** 词条来源：内置库只读（可屏蔽），用户库可增删改 */
export type SensitiveWordOrigin = "builtin" | "user";

export interface SensitiveWord {
  term: string;
  origin: SensitiveWordOrigin;
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
