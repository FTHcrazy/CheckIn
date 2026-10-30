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
 * ── 分批调度（1.32.0 长篇小说性能重构）─────────────────────────────
 *
 * 增量只解决了「已有一份索引后的后续保存」，**首次导入 3000 章**时缓存是全空的，
 * 冷扫要一次性把 3000 章全部扫完：实测约 9 秒，且是**同步**跑在页面根的 effect 里
 * —— 主线程被占满，进去就是假死，右侧边栏、左栏点击全无响应。
 *
 * 因此首扫（待扫章数超过 `BATCH_THRESHOLD`）改成分片：
 *   - 每个分片只扫 `BATCH_SIZE` 章，然后让出主线程（requestIdleCallback / setTimeout）
 *   - 分片间可被打断：新的 `syncAppearances` 调用会取消在途调度，从最新数据重排
 *   - 统计进行中 `pending` 为 true，UI 可据此显示占位而非空白角标
 *   - 小书（待扫 ≤ 阈值）仍走同步，保证既有单测与首屏行为不变
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
  /**
   * 是否仍在后台补扫。首次导入长篇时为 true，
   * 角标应在此时显示「统计中」而不是一个会跳动的小数字。
   */
  pending: boolean;
}

export const useAppearanceStore = create<AppearanceState>()(() => ({
  counts: new Map<string, number>(),
  pending: false,
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

/**
 * 单批扫描章数。
 *
 * 太小 → 调度开销与中间聚合次数上升；太大 → 单次分片占用主线程仍会掉帧。
 * 200 章 × 单章 ~0.1ms（首字索引后）≈ 20ms，正好在一帧预算内。
 */
const BATCH_SIZE = 200;

/** 低于这个待扫量就直接同步扫完：小书没必要拆片（也避免单测要等调度） */
const BATCH_THRESHOLD = 400;

/** 扫描一章正文，得到本章出场的要素 id（去重） */
function scanChapter(content: string, terms: EntityTerm[]): string[] {
  const ids = new Set<string>();
  for (const match of findTermMatches(content, terms)) {
    ids.add(match.entityId);
  }
  return Array.from(ids);
}

/** 倒排索引：要素 → 出场章节 id（按章节顺序，供详情卡的跳转列表用） */
let inverseIndex: Map<string, string[]> = new Map();

const EMPTY: string[] = [];

/** 聚合缓存成「要素 → 章数」+ 倒排索引 */
function aggregate(chapters: NovelChapter[]): Map<string, number> {
  const counts = new Map<string, number>();
  const inverse = new Map<string, string[]>();
  // 按传入的 chapters 顺序遍历，而不是遍历 cache：拖拽重排后 map 的插入顺序
  // 不会跟着变，那样跳转列表的顺序会停留在上次的章节顺序
  for (const chapter of chapters) {
    const entry = cache.get(chapter.id);
    if (!entry) continue;
    for (const id of entry.ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      const list = inverse.get(id);
      if (list) list.push(chapter.id);
      else inverse.set(id, [chapter.id]);
    }
  }
  inverseIndex = inverse;
  return counts;
}

/**
 * 出场章节 id（按书籍顺序）。
 *
 * 详情页之前是在渲染体里对全书每章跑 `findTermMatches`：详情卡一开，
 * 自动保存每 800ms 就触发一次全书正则扫描。这里直接读倒排索引，零扫描。
 */
export function appearancesOf(entityId: string): string[] {
  return inverseIndex.get(entityId) ?? EMPTY;
}

/** 在途分片调度的取消句柄（新同步 / reset 会打断它） */
let cancelScheduled: (() => void) | null = null;

/** 取「让出主线程」的调度器：优先空闲回调，退化到定时器 */
function scheduleIdle(task: () => void): () => void {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(task, { timeout: 300 });
    return () => w.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(task, 0);
  return () => clearTimeout(handle);
}

function cancelPending(): void {
  cancelScheduled?.();
  cancelScheduled = null;
}

/** 标记待扫队列并（在必要时）启动分片调度 */
function scheduleScan(chapters: NovelChapter[], terms: EntityTerm[]): void {
  cancelPending();

  const todos: NovelChapter[] = [];
  for (const chapter of chapters) {
    const hit = cache.get(chapter.id);
    if (hit && hit.content === chapter.content) continue;
    todos.push(chapter);
  }

  let cursor = 0;
  const hadAny = todos.length > 0;
  if (hadAny) {
    useAppearanceStore.setState({ pending: true });
  }

  const pump = (): void => {
    const end = Math.min(cursor + BATCH_SIZE, todos.length);
    for (; cursor < end; cursor += 1) {
      const chapter = todos[cursor];
      cache.set(chapter.id, {
        content: chapter.content,
        ids: scanChapter(chapter.content, terms),
      });
    }

    if (cursor < todos.length) {
      // 还有剩：先把已扫到的那部分聚合出去（角标渐进补齐），再让出主线程
      useAppearanceStore.setState({ counts: aggregate(chapters) });
      cancelScheduled = scheduleIdle(pump);
      return;
    }

    // 全部扫完：清掉被删章节的缓存、落最终索引、退出 pending
    pruneDead(chapters);
    cachedIds = chapters.map((chapter) => chapter.id);
    useAppearanceStore.setState({
      counts: aggregate(chapters),
      pending: false,
    });
    cancelScheduled = null;
  };

  pump();
}

/** 清掉已不存在章节的缓存条目 */
function pruneDead(chapters: NovelChapter[]): void {
  const alive = new Set<string>();
  for (const chapter of chapters) alive.add(chapter.id);
  for (const id of Array.from(cache.keys())) {
    if (!alive.has(id)) cache.delete(id);
  }
}

/**
 * 增量同步：只扫内容变了的章；没有任何变化时连 set 都不做。
 *
 * 待扫量大时转为分批调度（见文件头注释），调用方拿到的返回只是「已受理」；
 * 想要等到完整索引可用，观察 `useAppearanceStore` 的 `pending`。
 */
export function syncAppearances(
  chapters: NovelChapter[],
  terms: EntityTerm[],
): void {
  if (terms !== cachedTerms) {
    cache.clear();
    cachedTerms = terms;
  }

  // 待扫数量先行判断：决定同步扫完还是分片。
  // 注意这里**不**预筛「内容未变」的章，判断与实际扫描都在 scheduleScan 内统一做，
  // 避免两处各扫一遍 chapters 数组。
  const idsNow = chapters.map((chapter) => chapter.id);
  const idsChanged =
    idsNow.length !== cachedIds.length ||
    idsNow.some((id, index) => cachedIds[index] !== id);

  let contentChanged = false;
  for (const chapter of chapters) {
    const hit = cache.get(chapter.id);
    if (!hit || hit.content !== chapter.content) {
      contentChanged = true;
      break;
    }
  }

  // 内容与章节集合都没变：索引仍然有效，连 set 都不做（订阅者不会空重渲染）
  if (!contentChanged && !idsChanged) return;

  // 小改动（典型：自动保存写回当前章）同步扫完，保持「保存后角标立即正确」
  let todos = 0;
  for (const chapter of chapters) {
    const hit = cache.get(chapter.id);
    if (!hit || hit.content !== chapter.content) todos += 1;
  }

  if (todos <= BATCH_THRESHOLD) {
    cancelPending();
    for (const chapter of chapters) {
      const hit = cache.get(chapter.id);
      if (hit && hit.content === chapter.content) continue;
      cache.set(chapter.id, {
        content: chapter.content,
        ids: scanChapter(chapter.content, terms),
      });
    }
    pruneDead(chapters);
    cachedIds = idsNow;
    useAppearanceStore.setState({
      counts: aggregate(chapters),
      pending: false,
    });
    return;
  }

  cachedIds = idsNow;
  scheduleScan(chapters, terms);
}

/** 清空索引（切作品 / 重载 bundle 时调用） */
export function resetAppearances(): void {
  cancelPending();
  cache.clear();
  cachedTerms = null;
  cachedIds = [];
  inverseIndex = new Map();
  useAppearanceStore.setState({ counts: new Map<string, number>(), pending: false });
}
