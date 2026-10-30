/**
 * 敏感词扫描（纯函数）
 *
 * 链路：归一化 → AC 自动机扫描 → 坐标回映原文 → 按「词 × 章」聚合。
 * 归一化与坐标映射拆在 `normalize.ts`，第二批加变体匹配时只动那里。
 */

import { automatonOf } from "./ac-automaton";
import { mapMatchToRaw, normalizeForMatch } from "./normalize";
import type { SensitiveHit, SensitiveRange, SensitiveScanResult } from "./types";
import type { NovelChapter } from "../types";

/** 原文坐标的单次命中（与 `SensitiveRange` 同构，保留旧名字供调用方过渡） */
export type RawSensitiveMatch = SensitiveRange;

/**
 * 扫描一段文本。
 *
 * 不做防抖、不做分批——调度与让出主线程是 store 的职责，
 * 这里只保证「给定文本与词库，同步返回全部命中」。
 */
export function scanText(text: string, words: readonly string[]): RawSensitiveMatch[] {
  if (!text || words.length === 0) return [];

  const normalized = normalizeForMatch(text);
  const automaton = automatonOf(words);
  const matches: RawSensitiveMatch[] = [];

  for (const hit of automaton.match(normalized.text)) {
    const range = mapMatchToRaw(hit, normalized);
    if (range.to <= range.from) continue;
    matches.push({ word: automaton.patternAt(hit.pattern), from: range.from, to: range.to });
  }
  return matches;
}

/** 上下文片段：命中词前后各取 radius 个字符，换行压成空格 */
export function buildHitSnippet(
  text: string,
  from: number,
  to: number,
  radius = 16,
): string {
  const start = Math.max(0, from - radius);
  const end = Math.min(text.length, to + radius);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * 扫一章，同时给出**聚合结果**与**逐处区间**。
 *
 * 两者是同一次扫描的两个视图，不该各扫一遍：
 *   - `hits`    面板列表用（按词聚合、只留首个位置）
 *   - `matches` 正文标红用（每一处都要，手动模式的高亮就吃这份）
 *
 * 聚合而不是逐条罗列：一章里同一个词出现 20 次，面板上给 20 行没有意义——
 * 作者想知道的是「这章用了哪些风险词、各几次」，以及点一下能跳到第一处。
 */
export interface ChapterScan {
  hits: SensitiveHit[];
  matches: SensitiveRange[];
}

/**
 * 把逐处区间聚合成「词 × 章」的命中列表。
 *
 * 抽出来是为了让**两拨调用方共用一份聚合口径**：
 *   - 刚扫完的原始区间（`scanChapterWithMatches`）
 *   - 正文改字后跟着平移过的区间（编辑器上报，见 `syncChapterRanges`）
 *
 * 后者不跑 AC 自动机 —— 区间已经是扫描结论，只是坐标随编辑挪了。若各写一套
 * 聚合，面板的「N 处 · M 词」和正文的红字迟早对不上。
 *
 * 输入不保证有序（平移保持顺序，但调用方不该依赖），这里排一次。
 */
export function bucketMatches(
  matches: readonly SensitiveRange[],
  content: string,
  chapterId: string,
  chapterTitle: string,
): ChapterScan {
  const ordered = [...matches].sort((a, b) => a.from - b.from);
  const buckets = new Map<string, SensitiveHit>();
  for (const match of ordered) {
    const existing = buckets.get(match.word);
    if (existing) {
      existing.count += 1;
      continue;
    }
    buckets.set(match.word, {
      word: match.word,
      chapterId,
      chapterTitle,
      count: 1,
      from: match.from,
      snippet: buildHitSnippet(content, match.from, match.to),
    });
  }
  return {
    hits: Array.from(buckets.values()).sort((a, b) => b.count - a.count),
    matches: ordered,
  };
}

export function scanChapterWithMatches(
  chapterId: string,
  chapterTitle: string,
  content: string,
  words: readonly string[],
): ChapterScan {
  return bucketMatches(scanText(content, words), content, chapterId, chapterTitle);
}

/** 扫一章，按词聚合（面板列表用；需要逐处区间时用 `scanChapterWithMatches`） */
export function scanChapter(
  chapterId: string,
  chapterTitle: string,
  content: string,
  words: readonly string[],
): SensitiveHit[] {
  return scanChapterWithMatches(chapterId, chapterTitle, content, words).hits;
}

/** 全书扫描（同步）：分批由 store 负责，这里只做单章的累加 */
export function scanChapters(
  chapters: readonly NovelChapter[],
  words: readonly string[],
): SensitiveHit[] {
  const all: SensitiveHit[] = [];
  for (const chapter of chapters) {
    for (const hit of scanChapter(chapter.id, chapter.title, chapter.content, words)) {
      all.push(hit);
    }
  }
  return summarizeHits(all);
}

/**
 * 结果排序与汇总。
 *
 * 排序口径：命中次数降序 → 章节在书中的顺序（保持稳定，便于对照大纲）。
 * 面板分组展示时还会按词再归并一次，这里不做。
 */
export function summarizeHits(hits: SensitiveHit[]): SensitiveHit[] {
  return [...hits].sort((a, b) => b.count - a.count);
}

/** 由命中列表算出面板顶部要展示的三个数 */
export function buildScanResult(
  hits: SensitiveHit[],
  scope: "chapter" | "book",
  scannedAt: number,
): SensitiveScanResult {
  const words = new Set<string>();
  const chapters = new Set<string>();
  let total = 0;
  for (const hit of hits) {
    words.add(hit.word);
    chapters.add(hit.chapterId);
    total += hit.count;
  }
  return {
    hits,
    wordCount: words.size,
    total,
    chapterCount: chapters.size,
    scannedAt,
    scope,
  };
}
