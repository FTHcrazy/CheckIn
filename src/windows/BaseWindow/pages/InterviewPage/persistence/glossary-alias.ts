/**
 * 划词原文归到哪个已有词条 —— 「记为别名」的判定。
 *
 * 【为什么需要这一步】
 * 词表匹配是**整词命中**：正文里划中 `loader`，库里那条叫 `Webpack Loader`
 * 的条目不会命中 `loader` 这一段，于是那个词仍然点不动（采纳时模型换了叫法，
 * 就会留下这种「库里明明有、正文里却点不开」的条目）。
 *
 * 判据只做一件保守的事：**划中的词是某个词条某个键的真子串**（`loader` ⊂
 * `webpack loader`）。反向（划中的词比词条键长）不做 —— 长选区多半是用户
 * 多划了半句，替他决定挂到哪个词条上属于猜。
 *
 * 命中多个时取**最短的那个键**：`react` 同时是 `React` / `React Fiber` /
 * `React 并发渲染` 的子串，最短的那个最贴近用户想说的东西。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §10.2
 */
import type { GlossaryTerm } from "../data/interview-glossary";

/** 太短的词（单字）挂到任何词条上都像误触 */
const MIN_ANCHOR_LENGTH = 2;

/** 一个词条的全部匹配键（与 `buildGlossaryIndex` 同口径：term / en / aliases） */
function keysOf(term: GlossaryTerm): string[] {
  return [term.term, term.en, ...(term.aliases ?? [])]
    .map((item) => item?.trim().toLowerCase() ?? "")
    .filter(Boolean);
}

/**
 * 找出「包着」这段原文的词条；没有就返回 `null`。
 *
 * 与原文**完全相等**的不返回：那种情况浮层已经走「已是词条」分支，
 * 再提示一遍「记为它自己的别名」只会让人困惑。
 */
export function findContainingTerm(
  terms: readonly GlossaryTerm[],
  raw: string,
): GlossaryTerm | null {
  const target = raw.trim().toLowerCase();
  if (target.length < MIN_ANCHOR_LENGTH) return null;

  let best: { term: GlossaryTerm; span: number } | null = null;
  for (const term of terms) {
    for (const key of keysOf(term)) {
      if (key === target || !key.includes(target)) continue;
      if (!best || key.length < best.span) best = { term, span: key.length };
    }
  }
  return best?.term ?? null;
}

/** 别名是否已经在词条上（归一后比较，避免大小写不同重复写一条） */
export function hasAlias(term: GlossaryTerm, raw: string): boolean {
  const target = raw.trim().toLowerCase();
  if (!target) return false;
  return keysOf(term).includes(target);
}
