/**
 * AC 自动机（Aho-Corasick）—— 一次扫描命中全部词条
 *
 * 为什么不用现成的首字分桶（novel-utils 的 findTermMatches）：
 * 那套是按「位置 × 首字桶」比对，词库上千后每个位置仍可能撞上一串同首字候选；
 * 全书扫描（几千章 × 几千字）时差距明显。AC 自动机把词库编译成状态机，
 * 扫描复杂度 O(正文长度 + 命中数)，与词库规模无关。
 *
 * 结构（都是数组，节点用整数下标而非对象，构建期好 GC）：
 *   - `next[node]`：字符 → 子节点，Map 而非数组（中文词首字分布极散，
 *     每个节点分支只有几个，用 26 位数组或全量哈希表都会浪费）
 *   - `fail[node]`：失配指针（BFS 构建）
 *   - `output[node]`：以该节点结尾的模式下标（含 fail 链继承来的）
 *
 * 唯一对外入口是 `AcAutomaton`，纯 JS、不依赖 React / CodeMirror，可直接单测。
 */

export interface AcMatch {
  /** 命中起点（含），指向被扫描文本的下标 */
  from: number;
  /** 命中终点（不含） */
  to: number;
  /** 命中的模式在 `patterns` 数组里的下标 */
  pattern: number;
}

export class AcAutomaton {
  private readonly next: Array<Map<string, number>> = [];
  private readonly fail: number[] = [];
  private readonly output: number[][] = [];
  private readonly lengths: number[] = [];
  private readonly patterns: string[];

  constructor(patterns: readonly string[]) {
    this.patterns = patterns.filter((pattern) => pattern.length > 0);
    this.createNode();
    for (let index = 0; index < this.patterns.length; index += 1) {
      this.insert(this.patterns[index], index);
    }
    this.buildFail();
  }

  /** 词条数量（空串已被过滤） */
  get size(): number {
    return this.patterns.length;
  }

  /** 词条原文（下标与 `AcMatch.pattern` 对应） */
  patternAt(index: number): string {
    return this.patterns[index] ?? "";
  }

  /**
   * 扫描文本，返回**互不重叠**的命中区间。
   *
   * 重叠处理：同一起点上长词优先，被前一条覆盖的短命中直接丢弃
   * （「色情小说」与「色情」命中同一处时只留前者），
   * 这样调用方可以直接拿去建 CodeMirror 的 RangeSet，不必再排序去重。
   */
  match(text: string): AcMatch[] {
    if (!text || this.patterns.length === 0) return [];

    const raw: AcMatch[] = [];
    let state = 0;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      while (state !== 0 && !this.next[state].has(char)) {
        state = this.fail[state];
      }
      state = this.next[state].get(char) ?? 0;

      const outs = this.output[state];
      if (outs.length === 0) continue;
      const end = index + 1;
      for (const pattern of outs) {
        raw.push({ from: end - this.lengths[pattern], to: end, pattern });
      }
    }

    return dedupe(raw);
  }

  /** 只取命中的词（去重），供「本次扫到了哪些词」这类统计用 */
  matchWords(text: string): string[] {
    const seen = new Set<string>();
    for (const hit of this.match(text)) {
      seen.add(this.patterns[hit.pattern]);
    }
    return Array.from(seen);
  }

  private createNode(): number {
    const id = this.next.length;
    this.next.push(new Map());
    this.fail.push(0);
    this.output.push([]);
    return id;
  }

  private insert(pattern: string, patternIndex: number): void {
    let node = 0;
    for (const char of pattern) {
      let child = this.next[node].get(char);
      if (child === undefined) {
        child = this.createNode();
        this.next[node].set(char, child);
      }
      node = child;
    }
    this.output[node].push(patternIndex);
    // 同一节点可能挂多个等长同义词：lengths 按模式下标存，不按节点存
    this.lengths[patternIndex] = pattern.length;
  }

  private buildFail(): void {
    const queue: number[] = [];
    for (const child of this.next[0].values()) {
      this.fail[child] = 0;
      queue.push(child);
    }

    let head = 0;
    while (head < queue.length) {
      const node = queue[head];
      head += 1;
      for (const [char, child] of this.next[node]) {
        let fallback = this.fail[node];
        while (fallback !== 0 && !this.next[fallback].has(char)) {
          fallback = this.fail[fallback];
        }
        const candidate = this.next[fallback].get(char);
        this.fail[child] =
          candidate !== undefined && candidate !== child ? candidate : 0;
        // 继承失配链上的命中：BFS 保证 fail[child] 的 output 已最终化
        if (this.output[this.fail[child]].length > 0) {
          this.output[child].push(...this.output[this.fail[child]]);
        }
        queue.push(child);
      }
    }
  }
}

/** 按起点升序、同起点长词优先，丢弃与前一条重叠的命中 */
function dedupe(hits: AcMatch[]): AcMatch[] {
  if (hits.length <= 1) return hits;
  hits.sort((a, b) => a.from - b.from || b.to - a.to);
  const result: AcMatch[] = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (hit.from < lastEnd) continue;
    result.push(hit);
    lastEnd = hit.to;
  }
  return result;
}

/**
 * 词库编译缓存：以词库数组的**引用身份**为键。
 *
 * 词库由页面 useMemo 派生，变化即换新数组，旧状态机随数组一起被 GC，
 * 不需要手动清理，也不会把上一本书的词库串过来。
 * 全书扫描分批调度期间会反复取同一个数组，缓存命中后零构建成本。
 */
const cache = new WeakMap<readonly string[], AcAutomaton>();

export function automatonOf(words: readonly string[]): AcAutomaton {
  const cached = cache.get(words);
  if (cached) return cached;
  const built = new AcAutomaton(words);
  cache.set(words, built);
  return built;
}
