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
 * 【纯文本匹配必然有误命中 —— 这一层怎么兜】
 * 中文没有空格，2 字词条被更长的词夹住时无法从字符层面判定（「字节流」里的
 * 「节流」= 真命中吗？只有分词器知道）。所以不做「猜」，而是给三个确定性的阀门：
 *   1. **单字 CJK 键不进索引** —— 单字词条几乎必然是误命中，且没有任何信息量；
 *   2. **位置级负例**（`muted`）—— 用户右键「这里不是这个词」后，这个位置
 *      永久不再点亮（同一个词在别处照常可点）；
 *   3. **同键多词条并列**（`variants`）—— 词同名但领域不同时，弹层里全部列出，
 *      并优先选与当前分类 / 轨道一致的那条。
 * 三个阀门都不改变「词表本身」：不动词条、不动别名，随时可撤销。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §10.2 / §10.4
 */
import type { GlossarySegment, GlossaryTerm } from "../data/interview-glossary";
import { categoryNodeOf } from "../data/interview-taxonomy";

/**
 * 负例窗口：命中位置左右各取多少个字符作为「位置指纹」。
 *
 * 取 6 而不是整句：整句做指纹会让「同一句话在题干与答案里各出现一次」只解锁
 * 一处；取 6 个字既能区分相邻出现的同一个词（上下文几乎一定不同），又不会
 * 因为段落拼接方式不同就失效。
 */
export const MUTE_CONTEXT = 6;

/** 用户「解除绑定」记下的一条负例（存 interview_match_hint 表） */
export interface GlossaryMuteRule {
  /** 被解除的词条 id（基线 id 或 `u-` 开头的自建 id） */
  termId: string;
  /** 当时命中的键（小写归一：term / en / alias 之一） */
  key: string;
  /** 命中位置左侧最多 {@link MUTE_CONTEXT} 个字符 */
  left: string;
  /** 命中位置右侧最多 {@link MUTE_CONTEXT} 个字符 */
  right: string;
}

/** 同键多词条时的偏好（当前侧栏分类 / 轨道） */
export interface GlossaryPrefer {
  /** 当前分类 id（22 基线或 `u-c-*`） */
  categoryId?: string;
  /** 当前轨道；分类查不到时按它兜底 */
  track?: string;
}

export interface GlossaryIndexOptions {
  /** 位置级负例：命中这几个字符窗口时跳过（用户右键解除的） */
  muted?: readonly GlossaryMuteRule[];
  /** 同键多词条的选优偏好 */
  prefer?: GlossaryPrefer;
}

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
  /** 某个键对应的全部词条（同名词条的领域区分用；第一条即主匹配） */
  variantsOf(key: string): GlossaryTerm[];
  /**
   * 同一份词表换一套选优偏好（**不重建 trie**）。
   *
   * 侧栏切分类时同名词条的主匹配要跟着换（「节流」在浏览器性能题里指向
   * 性能那条、在 RxJS 题里指向 RxJS 那条），但词表一个字都没变 —— 重建
   * 索引等于每秒重扫几百个键。这里只换 `pickTerm` 的入参，词表与负例共用。
   *
   * 传 `undefined` = 恢复默认顺序（基线在前）。
   */
  withPrefer(prefer?: GlossaryPrefer): GlossaryMatchIndex;
}

/** ASCII 字母/数字/下划线：这类键两侧必须断开，否则 Fiber 会命中 FiberNode */
const ASCII_EDGE = /[A-Za-z0-9_$]/;

/** 单个汉字：这类键不进索引（见文件头「三个阀门」） */
const SINGLE_CJK = /^[\u3400-\u9fff]$/;

/**
 * 算一段命中的位置指纹（左右各 {@link MUTE_CONTEXT} 字）。
 *
 * 导出给 UI 用：`TermChip` 右键时算出的窗口必须与匹配时**逐字相同**，
 * 否则写进去的负例永远不生效。
 */
export function muteContextOf(
  text: string,
  start: number,
  end: number,
): { left: string; right: string } {
  return {
    left: text.slice(Math.max(0, start - MUTE_CONTEXT), start),
    right: text.slice(end, end + MUTE_CONTEXT),
  };
}

/** 这条命中是否被用户解除过（同词条、同键、同左右窗口） */
function isMuted(
  rules: readonly GlossaryMuteRule[] | undefined,
  termId: string,
  key: string,
  text: string,
  start: number,
  end: number,
): boolean {
  if (!rules || rules.length === 0) return false;
  const { left, right } = muteContextOf(text, start, end);
  return rules.some(
    (rule) =>
      rule.termId === termId && rule.key === key && rule.left === left && rule.right === right,
  );
}

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

/** 匹配键 → 词条列表。键统一小写；同键按数组顺序（基线在前）即默认优先级 */
type KeyLookup = Map<string, GlossaryTerm[]>;

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
 * 同键多词条时选一条主匹配。
 *
 * 顺序：① 与当前分类完全相同 → ② 同一条轨道（分类表反查）→ ③ 数组第一条。
 * 只在**同键有多个词条**时才走到这里：绝大多数键只有一条，选优不产生任何开销。
 */
function pickTerm(list: readonly GlossaryTerm[], prefer?: GlossaryPrefer): GlossaryTerm {
  const first = list[0];
  if (list.length === 1 || !prefer) return first;
  if (prefer.categoryId) {
    const exact = list.find((term) => term.categoryId === prefer.categoryId);
    if (exact) return exact;
  }
  if (prefer.track) {
    const sameTrack = list.find((term) => {
      const node = term.categoryId ? categoryNodeOf(term.categoryId) : undefined;
      return node?.track === prefer.track;
    });
    if (sameTrack) return sameTrack;
  }
  return first;
}

/**
 * 建一个匹配器。
 *
 * 词表顺序即优先级（同键、同长度时取先出现的词条）；空词表返回一个
 * 「永远不命中」的实例，调用方不用判空。
 */
export function buildGlossaryIndex(
  terms: readonly GlossaryTerm[],
  options: GlossaryIndexOptions = {},
): GlossaryMatchIndex {
  const keyToTerm: KeyLookup = new Map();
  const termById = new Map<string, GlossaryTerm>();

  for (const term of terms) {
    // 同 id 覆盖在合并阶段已经替换成「一条词条」，这里再兜一次：后出现的同 id 覆盖前者
    termById.set(term.id, term);
    for (const raw of [term.term, term.en, ...(term.aliases ?? [])]) {
      if (!raw) continue;
      const key = raw.trim().toLowerCase();
      if (!key) continue;
      // 单字汉字词条只会在正文里到处误命中（「流」命中「字节流」），且解释不了
      // 任何东西 —— 直接不进索引，比事后让用户一个个右键解除更省事
      if (SINGLE_CJK.test(key)) continue;
      const bucket = keyToTerm.get(key);
      // 同键按数组顺序排列：基线在前、用户自建在后，默认选第一条（与旧行为一致）
      if (bucket) bucket.push(term);
      else keyToTerm.set(key, [term]);
    }
  }

  const { muted } = options;
  const trie = buildTrie(keyToTerm.keys());

  /**
   * 用给定的偏好造一组视图。
   *
   * `withPrefer` 只换这一层：词表（`keyToTerm`）、负例（`muted`）、trie 全部复用，
   * 所以侧栏来回切分类不会重扫词表 —— 只是换掉「同键选哪一条」这一个判断。
   */
  const views = (active?: GlossaryPrefer): GlossaryMatchIndex => {
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
        const bucket = keyToTerm.get(match.key);
        if (!bucket || bucket.length === 0) continue;
        const term = pickTerm(bucket, active);
        // 被解除过的位置：这段文字当普通文本处理，不推进 cursor
        // （后续更短的命中仍有机会，只是通常没有）
        if (isMuted(muted, term.id, match.key, text, match.start, match.end)) continue;
        if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start) });
        const variants = bucket.filter((item) => item.id !== term.id);
        segments.push({
          text: text.slice(match.start, match.end),
          term,
          start: match.start,
          end: match.end,
          key: match.key,
          ...(variants.length > 0 ? { variants } : {}),
        });
        cursor = match.end;
      }

      if (cursor < text.length) segments.push({ text: text.slice(cursor) });
      return segments;
    };

    return {
      split,
      withPrefer: (next) => views(next),
      byId: (id: string) => termById.get(id),
      exact: (text: string) => {
        const bucket = keyToTerm.get(text.trim().toLowerCase());
        return bucket && bucket.length > 0 ? pickTerm(bucket, active) : undefined;
      },
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
      variantsOf: (key: string) => keyToTerm.get(key.trim().toLowerCase()) ?? [],
    };
  };

  return views(options.prefer);
}
