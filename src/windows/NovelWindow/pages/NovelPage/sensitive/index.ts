/**
 * 敏感词检测模块对外入口
 *
 * 目录划分：
 *   - `ac-automaton.ts`  AC 自动机（算法内核，零依赖）
 *   - `normalize.ts`     变体归一化 + 坐标回映（第二批替换实现）
 *   - `builtin-words.ts` 内置词库（只读）
 *   - `words.ts`         词库合并 / 清洗 / 导入解析
 *   - `scan.ts`          扫描与聚合
 *   - `types.ts`         领域类型
 */

export { AcAutomaton, automatonOf, type AcMatch } from "./ac-automaton";
export {
  BUILTIN_SENSITIVE_SET,
  BUILTIN_SENSITIVE_WORDS,
} from "./builtin-words";
export { mapMatchToRaw, normalizeForMatch, type NormalizedText } from "./normalize";
export {
  bucketMatches,
  buildHitSnippet,
  buildScanResult,
  scanChapter,
  scanChapterWithMatches,
  scanChapters,
  scanText,
  summarizeHits,
  type ChapterScan,
  type RawSensitiveMatch,
} from "./scan";
export {
  DEFAULT_SENSITIVE_CONFIG,
  isHighlightEnabled,
  resolveHighlightSource,
  SENSITIVE_MODE_META,
  SENSITIVE_TERM_MAX_LENGTH,
  type HighlightSource,
  type SensitiveConfig,
  type SensitiveHit,
  type SensitiveRange,
  type SensitiveScanMode,
  type SensitiveScanResult,
  type SensitiveWord,
  type SensitiveWordOrigin,
} from "./types";
export {
  buildActiveWords,
  buildWordList,
  normalizeTerm,
  parseImportedWords,
  parseSensitiveConfig,
  sanitizeSensitiveConfig,
  sanitizeTerms,
} from "./words";
