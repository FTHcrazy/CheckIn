/**
 * 敏感词库的合并、清洗与导入解析（纯函数）
 *
 * 词库分两层：
 *   - 内置库（`builtin-words.ts`，随包发布，只读）—— 用户可「屏蔽」但不能改
 *   - 用户库（config 持久化）—— 可增删改
 *
 * 检测时两层合并去重成一份 `string[]`，再编译成 AC 自动机。
 * 合并结果由页面 useMemo 派生，数组身份稳定 → 自动机缓存才能命中。
 */

import { BUILTIN_SENSITIVE_SET, BUILTIN_SENSITIVE_WORDS } from "./builtin-words";
import {
  DEFAULT_SENSITIVE_CONFIG,
  SENSITIVE_TERM_MAX_LENGTH,
  type SensitiveConfig,
  type SensitiveScanMode,
  type SensitiveWord,
} from "./types";

/** 单个词条规范化：去首尾空白、压缩内部空白；不合法返回空串 */
export function normalizeTerm(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length > SENSITIVE_TERM_MAX_LENGTH) return "";
  return trimmed;
}

/**
 * 词条列表清洗：规范化 + 去重 + 丢弃空项。
 *
 * 与 `sanitizeCustomTypes` 同一范式——从 config 读出来的东西一律当成不可信，
 * 逐项过一遍再进内存（手改 JSON、跨版本残留都可能塞进脏数据）。
 */
export function sanitizeTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const term = normalizeTerm(item);
    if (term) seen.add(term);
  }
  return Array.from(seen);
}

function sanitizeMode(raw: unknown): SensitiveScanMode {
  return raw === "auto" || raw === "manual" || raw === "off"
    ? raw
    : DEFAULT_SENSITIVE_CONFIG.mode;
}

/** config 解析：任何字段非法都回退默认值，绝不抛出 */
export function sanitizeSensitiveConfig(raw: unknown): SensitiveConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SENSITIVE_CONFIG };
  const source = raw as Record<string, unknown>;
  return {
    words: sanitizeTerms(source.words),
    // 屏蔽列表只保留「确实是内置词」的项，避免用户库删词后残留脏数据
    muted: sanitizeTerms(source.muted).filter((term) => BUILTIN_SENSITIVE_SET.has(term)),
    mode: sanitizeMode(source.mode),
  };
}

/** 从 config JSON 文本解析；解析失败回退默认值 */
export function parseSensitiveConfig(text: string | null): SensitiveConfig {
  if (!text) return { ...DEFAULT_SENSITIVE_CONFIG };
  try {
    return sanitizeSensitiveConfig(JSON.parse(text));
  } catch {
    return { ...DEFAULT_SENSITIVE_CONFIG };
  }
}

/**
 * 合并出「实际参与检测」的词库。
 *
 * 顺序刻意是「用户词在前」：AC 自动机对同起点等长命中按插入顺序输出，
 * 用户自己加的词优先，统计归因更符合预期。
 * 返回新数组，作为自动机缓存的键。
 */
export function buildActiveWords(config: SensitiveConfig): string[] {
  const muted = new Set(config.muted);
  const merged = new Set<string>();
  for (const term of config.words) merged.add(term);
  for (const term of BUILTIN_SENSITIVE_WORDS) {
    if (!muted.has(term)) merged.add(term);
  }
  return Array.from(merged);
}

/** 词库管理列表用的展示模型：内置（含已屏蔽）+ 用户词，按字典序 */
export function buildWordList(config: SensitiveConfig): SensitiveWord[] {
  const muted = new Set(config.muted);
  const rows: SensitiveWord[] = [];
  for (const term of config.words) {
    rows.push({ term, origin: "user" });
  }
  for (const term of BUILTIN_SENSITIVE_WORDS) {
    // 用户词库与内置重名时只出一条（以用户词为准，删掉它也不会让内置词复活）
    if (config.words.includes(term) || muted.has(term)) continue;
    rows.push({ term, origin: "builtin" });
  }
  return rows.sort((a, b) => a.term.localeCompare(b.term, "zh-Hans-CN"));
}

/**
 * 解析导入文件内容。
 *
 * 兼容三种常见格式（用户从别处拷来的词库不外乎这几种）：
 *   1. JSON 数组 `["词1", "词2"]`
 *   2. JSON 对象 `{ "words": [...] }`
 *   3. 纯文本：每行一个词；`#` / `//` 开头为注释；行内可用逗号、顿号、分号、制表符分隔
 *
 * 返回去重后的候选词条（仍可能含非法项，交给 `sanitizeTerms` 兜底）。
 */
export function parseImportedWords(content: string): string[] {
  const text = content.replace(/^\uFEFF/, "").trim();
  if (!text) return [];

  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(text);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
          ? ((parsed as Record<string, unknown>).words ??
            (parsed as Record<string, unknown>).terms)
          : null;
      if (Array.isArray(list)) return sanitizeTerms(list);
    } catch {
      // JSON 解析失败：当作纯文本继续往下走，不直接判死
    }
  }

  const collected: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    for (const part of trimmed.split(/[,，、;；\t|]+/)) {
      const term = normalizeTerm(part);
      if (term) collected.push(term);
    }
  }
  return sanitizeTerms(collected);
}
