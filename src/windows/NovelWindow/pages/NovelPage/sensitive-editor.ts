/**
 * 敏感词高亮层（CodeMirror 扩展）
 *
 * 与 `novel-editor.ts` 的要素标注层同构，但**完全独立**：
 *   - 独立 facet / compartment / StateEffect，互不干扰
 *     （关掉要素标注不该顺手关掉敏感词高亮，反之亦然）
 *   - 独立装饰类名 `nv-sm-mark` 与 `data-sensitive-word` 属性，
 *     要素层的 `[data-entity-type]` 选择器不会选中它
 *
 * ⚠️ 装饰类名必须带 `-mark` 后缀，不能只写 `nv-sm`：`nv-sm` 是右栏面板的
 * BEM 块名，面板根节点那条 `display: flex` 会把行内标记撑成块级元素 ——
 * 表现是正文里命中的词被单独顶成一行、段落被截断。两个模块共用一个
 * 全局命名空间（都是普通 CSS，没有 CSS Module 隔离），块名撞车就是事故。
 *
 * 生命周期沿用标注层那套已经踩平的经验：
 *   1. `compositionstart` 冻结**重扫**（中文候选期零抖动）
 *   2. `compositionend` 后 300ms 防抖、文档变化 300ms 防抖再重算
 *   3. 只扫 `view.visibleRanges`，不做全文档扫描（仅自动模式）
 *   4. 强制刷新用 `addToHistory(false)` 的空事务，不污染撤销栈
 *
 * 两种数据源（见 `sensitiveRangesFacet`）：
 *   - 自动模式 → `null`，按词库实时扫可视区，标注跟着输入走
 *   - 手动模式 → 扫描结果的逐处区间，**没扫过就一个字不标**
 *
 * 匹配算法换成 AC 自动机（`sensitive/ac-automaton.ts`）：词库上千后
 * 首字分桶的每位置比对会让滚动掉帧，AC 自动机与词库规模无关。
 *
 * ── 手动模式的坐标平移（v1.46.2）────────────────────────────────────
 *
 * 手动模式的区间是「上一次扫描」的快照。作者接着改字，这些坐标必须跟着挪，
 * 否则高亮会停在旧位置、越改越偏。三条规则：
 *   1. **必须平移**：`update.docChanged` 时用 `decorations.map(update.changes)`
 *      平移装饰。这一步写在 IME 判断**之前** —— 组合期的每次改字都会走到这里，
 *      早退就等于让标注停在旧坐标（事故现场：中文输入法打几个字，后面的高亮
 *      全偏；组合结束后的强制重建又按旧坐标重建，怎么重扫都修不好）。
 *   2. **本地持有副本**：插件在 `update` 里不能 dispatch（会抛
 *      "update in progress"），改不了 facet，所以自己存一份平移后的区间；
 *      `build()` 用手上这份，而不是 facet 里那份陈旧快照。
 *   3. **facet 换身份 = 权威快照**：重新扫描 / 切章 / 切模式会送来一个新数组，
 *      按引用比较，一换就整个采纳（值可能与本地副本相同，那就是一次无害的覆盖）。
 *      上报把平移结果写回 store，面板计数、状态条角标、跳转位置因此始终与
 *      正文高亮同源 —— 但走的是防抖，不逐键惊动页面根。
 *   4. **平移之后必须校验内容**：`map` 只保证「区间跟着文本走」，不保证
 *      「区间里还是那个词」。把「血腥」改成「血型」，标记会原样盖住「血型」，
 *      看起来就是「敏感词都改掉了，高亮还不消失」。所以每次平移后拿区间原文
 *      跟词条比一次，对不上就当场丢掉（见 `pruneStale()`）。
 */

import {
  Compartment,
  Facet,
  RangeSetBuilder,
  StateEffect,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { normalizeForMatch, scanText } from "./sensitive";
import type { SensitiveRange } from "./sensitive";

/** 词库：由 React 侧在词库变化时 reconfigure */
export const sensitiveWordsFacet = Facet.define<readonly string[], readonly string[]>({
  combine: (values) => values.flat(),
});

export const sensitiveWordsCompartment = new Compartment();

/**
 * 标注源（手动模式）。
 *
 * `null`  = 按词库实时扫可视区（自动模式的「跟着输入走」）
 * `[...]` = 只标这些区间（手动模式的「只标扫描结果」，空数组即一个字不标）
 *
 * 用 `null` 而不是空数组表达「实时扫」是刻意的：两种模式的数据源语义不同，
 * 用一个哨兵值区分，就不必在插件里再读一次 mode —— 少一个可能对不上的状态源。
 */
export const sensitiveRangesFacet = Facet.define<
  readonly SensitiveRange[] | null,
  readonly SensitiveRange[] | null
>({
  combine: (values) => (values.length > 0 ? values[0] : null),
});

export const sensitiveRangesCompartment = new Compartment();

/**
 * 平移结果上报（手动模式）：正文改字后，把跟着挪过的区间交回 React 侧。
 *
 * 回调必须**引用稳定**（`useCallback`）：它只在初始化时被读一次，
 * 身份变了也不会重新挂载插件，换回调请走 reconfigure。
 */
export const sensitiveReportFacet = Facet.define<
  ((ranges: SensitiveRange[]) => void) | null,
  ((ranges: SensitiveRange[]) => void) | null
>({
  combine: (values) => values.find((value) => typeof value === "function") ?? null,
});

/** 高亮总开关：关闭即整层降级为空 decoration */
export const sensitiveEnabledFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.length > 0 && values[0],
});

export const sensitiveEnabledCompartment = new Compartment();

/** 防抖结束后的强制刷新信号 */
export const refreshSensitive = StateEffect.define<null>();

/** 上报防抖：一次编辑暂停后统一上报，不逐键触发 React 重渲染 */
const REPORT_DEBOUNCE_MS = 400;

/**
 * 高亮装饰：细描边 + 淡底，**不改字宽、不改行高**。
 *
 * 词条挂在 `data-sensitive-word` 上而不是塞进 class：
 * 词条是用户可编辑的任意中文，拼进 class 会生成非法选择器；
 * 放进 dataset 后也方便将来做「悬停显示命中词」的原生 tooltip。
 * 同时它是「从装饰反推区间」的唯一线索，见 `collectRanges()`。
 */
const sensitiveDecoration = (word: string): Decoration =>
  Decoration.mark({
    class: "nv-sm-mark",
    attributes: { "data-sensitive-word": word, title: `敏感词：${word}` },
  });

const wordOf = (decoration: Decoration): string | null => {
  const attributes = (decoration.spec as { attributes?: Record<string, string> })
    .attributes;
  return attributes?.["data-sensitive-word"] ?? null;
};

/**
 * 装饰盖住的这段原文，是否仍然是当初命中的那个词。
 *
 * 坐标平移能回答「挪了几个字」，回答不了「这几个字被换成了什么」。把
 * 「血腥」改成「血型」，`RangeSet.map` 会把区间原样搬过去 —— 位置分毫不差，
 * 内容却已经不是敏感词了。
 *
 * 比对走归一化而不是字符串直等：第二批启用变体匹配后，命中的原文可能带
 * 干扰字符（「血 腥」），直等会在每次编辑时把这类命中误删。
 */
const matchesWord = (slice: string, word: string): boolean =>
  slice === word || normalizeForMatch(slice).text === normalizeForMatch(word).text;

class SensitivePlugin {
  decorations: DecorationSet = Decoration.none;

  /**
   * 手动模式当前生效的区间（跟着编辑平移）。
   * `null` = 自动模式，插件不持有快照、每次按词库实时扫。
   */
  private ranges: readonly SensitiveRange[] | null = null;
  /** 上一次采纳的 facet 值，只用来按引用判断「外部给了新快照」 */
  private facetRanges: readonly SensitiveRange[] | null | undefined = undefined;

  /** 组合输入期间冻结**重扫**（平移不受影响） */
  private suspended = false;
  private timer: number | null = null;
  private reportTimer: number | null = null;
  private readonly handleStart: () => void;
  private readonly handleEnd: () => void;
  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    this.facetRanges = view.state.facet(sensitiveRangesFacet);
    this.ranges = this.facetRanges;
    this.decorations = this.build();
    this.handleStart = () => {
      this.suspended = true;
      this.clearTimer();
    };
    this.handleEnd = () => {
      this.suspended = false;
      this.schedule(300);
    };
    view.contentDOM.addEventListener("compositionstart", this.handleStart);
    view.contentDOM.addEventListener("compositionend", this.handleEnd);
  }

  update(update: ViewUpdate): void {
    // facet 换身份 = 外部给了权威快照（重新扫描 / 切章 / 切模式）：整个采纳。
    // 值可能与本地副本一模一样，那就是一次无害的覆盖，不必特判。
    const facetRanges = update.state.facet(sensitiveRangesFacet);
    if (facetRanges !== this.facetRanges) {
      this.facetRanges = facetRanges;
      this.ranges = facetRanges;
    }

    const forced = update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(refreshSensitive)),
    );

    if (update.docChanged) {
      // ⚠️ 平移必须在 IME 判断之前：组合期的每一次改字都会走进 `docChanged`，
      // 早退等于让标注停在旧坐标，而组合结束后的强制重建又会按旧坐标重建——
      // 表现就是「改了几个字，后面的高亮全偏了」，重扫也救不回来（重建的
      // 数据源还是旧快照）。平移只是 O(命中数) 的坐标运算，组合期做也无抖动。
      this.decorations = this.decorations.map(update.changes);
      // 平移只保位置、不保内容：命中词被改写成别的字时要当场丢掉，
      // 否则红字会一直盖在一个不再是敏感词的词上
      this.pruneStale();
      if (this.ranges !== null) {
        // 从刚平移完的装饰反推区间：两份数据天然对得上，不可能一格之差
        this.ranges = this.collectRanges();
        this.scheduleReport();
      }
      if (forced) {
        // 外部整篇替换（切章 / 回滚）会同时携带强制刷新信号：立即重建，
        // 避免上一章的高亮残留一个防抖周期
        this.decorations = this.build();
      } else if (this.ranges === null && !this.suspended) {
        // 自动模式继续按词库重算，防抖只是避免每个按键都重建一次；
        // 手动模式标的是「快照平移后的结果」，继续敲字不重扫（那正是手动的语义）
        this.schedule(300);
      }
      return;
    }

    if (this.suspended && !forced) return;

    // 显式区间与可视区无关（本章全部命中一次标完），只有实时扫需要跟滚动走
    if (forced || (update.viewportChanged && this.ranges === null)) {
      this.decorations = this.build();
    }
  }

  destroy(): void {
    this.clearTimer();
    this.clearReportTimer();
    this.view.contentDOM.removeEventListener("compositionstart", this.handleStart);
    this.view.contentDOM.removeEventListener("compositionend", this.handleEnd);
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.requestRefresh();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearReportTimer(): void {
    if (this.reportTimer !== null) {
      window.clearTimeout(this.reportTimer);
      this.reportTimer = null;
    }
  }

  private requestRefresh(): void {
    if (!this.view.dom.isConnected) return;
    this.view.dispatch({
      effects: refreshSensitive.of(null),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  /**
   * 把「跟着编辑挪过」的区间交回 React 侧（防抖）。
   *
   * 不逐键上报：那正是页面根想避开的「每敲一个字重渲染整棵树」。
   * 编辑器自己已经把装饰平移好了，面板迟 400ms 对齐完全无感。
   */
  private scheduleReport(): void {
    if (!this.view.state.facet(sensitiveReportFacet)) return;
    this.clearReportTimer();
    this.reportTimer = window.setTimeout(() => {
      this.reportTimer = null;
      if (!this.view.dom.isConnected) return;
      const ranges = this.ranges;
      if (!ranges) return;
      this.view.state.facet(sensitiveReportFacet)?.([...ranges]);
    }, REPORT_DEBOUNCE_MS);
  }

  /** 从当前装饰反推区间（手动模式的数据源，与屏幕上的高亮逐格一致） */
  private collectRanges(): SensitiveRange[] {
    const collected: SensitiveRange[] = [];
    this.decorations.between(0, this.view.state.doc.length, (from, to, decoration) => {
      const word = wordOf(decoration);
      if (word !== null && to > from) collected.push({ word, from, to });
    });
    return collected;
  }

  /**
   * 丢掉「区间里的原文已经不再等于命中词」的装饰。
   *
   * `RangeSet.map` 是纯坐标运算：在命中词内部插入或替换字符，区间会跟着
   * 变长/换字，标记仍然盖着那块文本。用户把「血腥」改成「血型」之后，
   * 红字还稳稳压在「血型」上 —— 位置没错，结论错了，看上去就是「高亮不消失」。
   *
   * 判据取「区间原文 == 命中词」而不是「词还在附近」：
   *   - 词被拆开（中间插字）后 AC 也不会再命中，丢弃才是对的；
   *   - 在词前后插字由 `map` 的 assoc 处理，区间仍是原词，不会误删。
   *
   * 丢掉的标记同时从 `ranges` 里消失（`collectRanges` 读的是装饰），
   * 400ms 后的上报会把面板计数与状态条角标一起降下来。
   */
  private pruneStale(): void {
    const doc = this.view.state.doc;
    let stale = false;
    this.decorations.between(0, doc.length, (from, to, decoration) => {
      if (stale) return;
      const word = wordOf(decoration);
      if (word !== null && !matchesWord(doc.sliceString(from, to), word)) stale = true;
    });
    if (!stale) return;

    const builder = new RangeSetBuilder<Decoration>();
    this.decorations.between(0, doc.length, (from, to, decoration) => {
      const word = wordOf(decoration);
      if (word === null || !matchesWord(doc.sliceString(from, to), word)) return;
      builder.add(from, to, decoration);
    });
    this.decorations = builder.finish();
  }

  private build(): DecorationSet {
    const view = this.view;
    if (!view.state.facet(sensitiveEnabledFacet)) return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();

    /*
     * 手动模式：只标「扫描结果（平移到当前位置）」。
     *
     * 空数组 = 还没扫过 = 一个字都不标 —— 从关闭切到手动的瞬间，正文必须保持
     * 干净。早先这里直接吃词库，于是「没点扫描却全文标红、角标还是 0」，
     * 用户根本无从判断这些红色是清是浊。
     *
     * 注意吃的是 `this.ranges`（本地平移副本）而不是 facet：facet 里是上次扫描
     * 的原始坐标，正文改过字之后拿它重建，高亮就会跳回旧位置。
     *
     * 坐标可能来自上一章（结果换了、正文还没换的中间态）→ 先 clamp 到文档内，
     * 越界的直接丢弃，宁可少标也不能让 RangeSet 抛 RangeError。
     *
     * 再加一道内容校验：快照坐标与当前正文对不上（正文被别的路径整段改写过、
     * 切章中间态）时不标 —— 错位的红字比没有红字更容易误导人。
     */
    if (this.ranges) {
      const doc = view.state.doc;
      const docLength = doc.length;
      for (const range of this.ranges) {
        const from = Math.min(range.from, docLength);
        const to = Math.min(range.to, docLength);
        if (to <= from) continue;
        if (!matchesWord(doc.sliceString(from, to), range.word)) continue;
        builder.add(from, to, sensitiveDecoration(range.word));
      }
      return builder.finish();
    }

    // 自动模式：按词库实时扫可视区（与大屏长文滚动性能的既有取舍一致）
    const words = view.state.facet(sensitiveWordsFacet);
    if (words.length === 0) return Decoration.none;

    for (const { from, to } of view.visibleRanges) {
      // scanText 返回的是「这一段文本内」的偏移，加回段起点即文档坐标
      for (const hit of scanText(view.state.sliceDoc(from, to), words)) {
        builder.add(from + hit.from, from + hit.to, sensitiveDecoration(hit.word));
      }
    }
    return builder.finish();
  }
}

/**
 * 敏感词高亮扩展：词库 / 开关 / 标注源都走 compartment，运行期可热更新。
 *
 * `onRangesMapped` 只在初始化时读一次（跟着 facet 走），所以必须引用稳定。
 */
export function sensitiveLayer(
  words: readonly string[],
  enabled: boolean,
  ranges: readonly SensitiveRange[] | null = null,
  onRangesMapped: ((ranges: SensitiveRange[]) => void) | null = null,
): Extension[] {
  return [
    sensitiveWordsCompartment.of(sensitiveWordsFacet.of(words)),
    sensitiveEnabledCompartment.of(sensitiveEnabledFacet.of(enabled)),
    sensitiveRangesCompartment.of(sensitiveRangesFacet.of(ranges)),
    sensitiveReportFacet.of(onRangesMapped),
    ViewPlugin.fromClass(SensitivePlugin, {
      decorations: (plugin) => plugin.decorations,
    }),
  ];
}
