/**
 * 词条匹配器（按合并后的词条表重建）。
 *
 * 【为什么不能复用 `splitByGlossary`】
 * `data/interview-glossary.ts` 里的 `TERM_TRIE` 是模块加载时按**常量**词表建的
 * IIFE 单例：它只认基线那 100 个词条。合并视图里还有用户新增 / 覆盖 / 隐藏的词条，
 * 而模块单例没法在运行时重建。所以这里把「建索引」这一步抽成函数 ——
 * 输入词条表、输出一个可复用的匹配器，词表变了就整棵重建（几百节点，微秒级）。
 *
 * 【语义必须与基线一致】
 * 匹配键 = `term` + `en` + `aliases`，大小写不敏感，**最长优先**，同长度取先出现者；
 * 英文键两侧必须断开（`FiberNode` 里的 `Fiber` 不算命中）。测试里拿
 * `splitByGlossary` 在纯基线词表上做逐段回归比对 —— 两条实现一旦漂移就会红。
 *
 * 【新增偏移量】
 * `GlossarySegment` 加了 `start` / `end`（命中的原文区间）。划词功能要靠它反算
 * 选区位置：`TermText` 把文本切成多个 `<span>` / `<button>`，光靠
 * `getSelection().toString()` 在跨高亮词的选区上会错位（划 `weak map` 会把相邻词算进来）。
 * 基线那套 `splitByGlossary` 不填这两个字段，保持向后兼容。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §10.2 / §10.4
 */
import type { GlossarySegment, GlossaryTerm } from "../data/interview-glossary";

/** 一个匹配器：同一份词表只建一次，之后反复用于渲染 */
export interface GlossaryMatchIndex {
  /** 把一段纯文本切成「普通文字 / 名词」交替的片段（带原文偏移） */
  split(text: string): GlossarySegment[];
  /** 按 id 反查词条（`related` 引用、"已是词条" 定位都用它） */
  byId(id: string): GlossaryTerm | undefined;
  /** 整段精确匹配（行内代码里通常就是术语本身，不需要切段） */
  exact(text: string): GlossaryTerm | undefined;
  /** 文本里命中的**去重**词条，用于统计与自检 */
  termsIn(text: string): GlossaryTerm[];
}

/** ASCII 字母/数字/下划线：这类键两侧必须断开，否则 Fiber 会命中 FiberNode */
const ASCII_EDGE = /[A-Za-z0-9_$]/;

/**
 * Aho–Corasick 节点。
 *
 * 为什么不用「每个起点试所有键」：匹配发生在每次渲染的每一段文本上
 * （一屏 12 张卡片 × 标题 / 题干 / 答案），键一多就退化成
 * 「每个位置试几百个分支」。AC 把扫描压成一次线性遍历，与词表规模无关。
 */
interface TermTrieNode {
  next: Map<string, number>;
  fail: number;
  /** 以该节点结尾的匹配键（含通过 fail 链继承来的后缀键） */
  keys: string[];
}

/** 匹配键 → 词条。键统一小写；同键只留**先出现**的词条（数组顺序即优先级） */
type KeyLookup = Map<string, GlossaryTerm>;

function buildTrie(keys: Iterable<string>): TermTrieNode[] {
  const nodes: TermTrieNode[] = [{ next: new Map(), fail: 0, keys: [] }];
  for (const key of keys) {
    if (!key) continue;
    let cursor = 0;
    for (let index = 0; index < key.length; index += 1) {
      const ch = key[index];
      let child = nodes[cursor].next.get(ch);
      if (child === undefined) {
        nodes.push({ next: new Map(), fail: 0, keys: [] });
        child = nodes.length - 1;
        nodes[cursor].next.set(ch, child);
      }
      cursor = child;
    }
    nodes[cursor].keys.push(key);
  }

  // BFS 建失败指针，并把 fail 链上的键并进来 —— 否则「后缀本身也是词条」时会漏
  const queue: number[] = [];
  for (const child of nodes[0].next.values()) {
    nodes[child].fail = 0;
    queue.push(child);
  }
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const [ch, child] of nodes[current].next) {
      let fallback = nodes[current].fail;
      while (fallback !== 0 && !nodes[fallback].next.has(ch)) {
        fallback = nodes[fallback].fail;
      }
      const target = nodes[fallback].next.get(ch);
      nodes[child].fail = target !== undefined && target !== child ? target : 0;
      nodes[child].keys.push(...nodes[nodes[child].fail].keys);
      queue.push(child);
    }
  }
  return nodes;
}

interface RawTermMatch {
  start: number;
  /** 命中区间的右端点（不含） */
  end: number;
  key: string;
}

/**
 * 扫一遍文本收集所有命中（允许重叠，交给调用方挑最长）。
 *
 * 逐字符小写而不是整串 `toLowerCase()`：后者在极少数字符上会改变长度，
 * 让下标与原文错位；逐字符转换最多是「这个字符不匹配」，不会串位。
 */
function collectTermMatches(trie: TermTrieNode[], text: string): RawTermMatch[] {
  const matches: RawTermMatch[] = [];
  let node = 0;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index].toLowerCase();
    while (node !== 0 && !trie[node].next.has(ch)) node = trie[node].fail;
    node = trie[node].next.get(ch) ?? 0;
    if (node === 0) continue;

    for (const key of trie[node].keys) {
      const start = index - key.length + 1;
      if (start < 0) continue;
      // 英文键两侧必须断开：FiberNode 里的 Fiber 不算命中
      if (ASCII_EDGE.test(key[0]) && start > 0 && ASCII_EDGE.test(text[start - 1])) continue;
      const last = key[key.length - 1];
      if (ASCII_EDGE.test(last) && index + 1 < text.length && ASCII_EDGE.test(text[index + 1])) {
        continue;
      }
      matches.push({ start, end: index + 1, key });
    }
  }

  return matches;
}

/**
 * 建一个匹配器。
 *
 * 词表顺序即优先级（同长度、同起点的候选只可能来自同名键，实际不会发生）；
 * 空词表返回一个「永远不命中」的实例，调用方不用判空。
 */
export function buildGlossaryIndex(terms: readonly GlossaryTerm[]): GlossaryMatchIndex {
  const keyToTerm: KeyLookup = new Map();
  const termById = new Map<string, GlossaryTerm>();

  for (const term of terms) {
    // 同 id 覆盖在合并阶段已经替换成「一条词条」，这里再兜一次：后出现的同 id 覆盖前者
    termById.set(term.id, term);
    for (const raw of [term.term, term.en, ...(term.aliases ?? [])]) {
      if (!raw) continue;
      const key = raw.trim().toLowerCase();
      if (!key) continue;
      // 同键取先出现的词条：后出现的往往是同一概念的别名重复录入，
      // 让它悄悄顶掉前面的会让「点开看到谁」取决于数组顺序
      if (!keyToTerm.has(key)) keyToTerm.set(key, term);
    }
  }

  const trie = buildTrie(keyToTerm.keys());

  const split = (text: string): GlossarySegment[] => {
    if (text.length === 0) return [];
    const matches = collectTermMatches(trie, text).sort(
      (left, right) => left.start - right.start || right.key.length - left.key.length,
    );

    const segments: GlossarySegment[] = [];
    let cursor = 0;
    for (const match of matches) {
      // 最长优先 + 贪心跳过重叠：长键吃掉区间后，它内部的短键不再重复命中
      if (match.start < cursor) continue;
      const term = keyToTerm.get(match.key);
      if (!term) continue;
      if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start) });
      segments.push({ text: text.slice(match.start, match.end), term, start: match.start, end: match.end });
      cursor = match.end;
    }

    if (cursor < text.length) segments.push({ text: text.slice(cursor) });
    return segments;
  };

  return {
    split,
    byId: (id: string) => termById.get(id),
    exact: (text: string) => keyToTerm.get(text.trim().toLowerCase()),
    termsIn: (text: string) => {
      const seen = new Set<string>();
      const hits: GlossaryTerm[] = [];
      for (const segment of split(text)) {
        if (!segment.term || seen.has(segment.term.id)) continue;
        seen.add(segment.term.id);
        hits.push(segment.term);
      }
      return hits;
    },
  };
}
