/**
 * 要素出场章数索引（模块级 Zustand store）
 *
 * 为什么抽到全局：这个索引此前是页面里的 `useMemo`，依赖 `[chapters, terms]`。
 * 而自动保存每写一次就把 `chapters` 换成新数组 —— 于是每保存一次就要把
 * **全书每一章**拿去跑一遍 `findTermMatches`（章节数 × 章节字数 × 词条数的
 * 正则扫描）。上百章的长篇里，这就是「敲一段字卡一下」的来源。
 *
 * 放在 store 后：索引带按章缓存，只重扫 `content` 引用真的变了的那几章
 * （通常就是正在写的那 1 章），并把结果放在组件外——页面根不再持有它，
 * 也就不用为了一个角标数字把整棵树重渲染一遍。
 *
 * 边界：store 不认识业务，只认「章节数组 + 词库数组」；由页面在数据变化后
 * 显式调用 `syncAppearances()` 同步（渲染后调用，不在渲染期写状态）。
 */

import { create } from "zustand";
import { findTermMatches } from "../novel-utils";
import type { EntityTerm, NovelChapter } from "../types";

export interface AppearanceState {
  /** entityId → 出场章数 */
  counts: Map<string, number>;
}

export const useAppearanceStore = create<AppearanceState>()(() => ({
  counts: new Map<string, number>(),
}));

/** 按章缓存：内容引用未变的章直接复用上次的命中集合 */
interface CacheEntry {
  content: string;
  ids: string[];
}

const cache = new Map<string, CacheEntry>();

/** 上次同步用的词库引用：词库换了必须整表重扫（词库变化频率很低） */
let cachedTerms: EntityTerm[] | null = null;

/** 上次参与统计的章节 id 集合：用来判断有没有章节被删 */
let cachedIds: string[] = [];

/** 扫描一章正文，得到本章出场的要素 id（去重） */
function scanChapter(content: string, terms: EntityTerm[]): string[] {
  const ids = new Set<string>();
  for (const match of findTermMatches(content, terms)) {
    ids.add(match.entityId);
  }
  return Array.from(ids);
}

/** 聚合缓存成「要素 → 章数」 */
function aggregate(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of cache.values()) {
    for (const id of entry.ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** 增量同步：只扫内容变了的章；没有任何变化时连 set 都不做 */
export function syncAppearances(
  chapters: NovelChapter[],
  terms: EntityTerm[],
): void {
  if (terms !== cachedTerms) {
    cache.clear();
    cachedTerms = terms;
  }

  const alive = new Set<string>();
  for (const chapter of chapters) {
    alive.add(chapter.id);
  }

  for (const id of Array.from(cache.keys())) {
    if (!alive.has(id)) cache.delete(id);
  }

  let changed = false;
  for (const chapter of chapters) {
    const hit = cache.get(chapter.id);
    if (hit && hit.content === chapter.content) continue;
    cache.set(chapter.id, {
      content: chapter.content,
      ids: scanChapter(chapter.content, terms),
    });
    changed = true;
  }

  // 章节增删（内容没变但集合变了）也要重算
  let idsChanged = alive.size !== cachedIds.length;
  if (!idsChanged) {
    for (const id of cachedIds) {
      if (!alive.has(id)) {
        idsChanged = true;
        break;
      }
    }
  }
  cachedIds = Array.from(alive);

  if (!changed && !idsChanged) return;
  useAppearanceStore.setState({ counts: aggregate() });
}

/** 清空索引（切作品 / 重载 bundle 时调用） */
export function resetAppearances(): void {
  cache.clear();
  cachedTerms = null;
  cachedIds = [];
  useAppearanceStore.setState({ counts: new Map<string, number>() });
}
