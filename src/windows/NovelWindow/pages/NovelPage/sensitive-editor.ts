/**
 * 敏感词高亮层（CodeMirror 扩展）
 *
 * 与 `novel-editor.ts` 的要素标注层同构，但**完全独立**：
 *   - 独立 facet / compartment / StateEffect，互不干扰
 *     （关掉要素标注不该顺手关掉敏感词高亮，反之亦然）
 *   - 独立装饰类名 `nv-sm` 与 `data-sensitive-word` 属性，
 *     要素层的 `[data-entity-type]` 选择器不会选中它
 *
 * 生命周期沿用标注层那套已经踩平的经验：
 *   1. `compositionstart` 冻结全部计算（中文候选期零抖动）
 *   2. `compositionend` 后 300ms 防抖、文档变化 300ms 防抖再重算
 *   3. 只扫 `view.visibleRanges`，不做全文档扫描
 *   4. 强制刷新用 `addToHistory(false)` 的空事务，不污染撤销栈
 *
 * 匹配算法换成 AC 自动机（`sensitive/ac-automaton.ts`）：词库上千后
 * 首字分桶的每位置比对会让滚动掉帧，AC 自动机与词库规模无关。
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
import { scanText } from "./sensitive";

/** 词库：由 React 侧在词库变化时 reconfigure */
export const sensitiveWordsFacet = Facet.define<readonly string[], readonly string[]>({
  combine: (values) => values.flat(),
});

export const sensitiveWordsCompartment = new Compartment();

/** 高亮总开关：关闭即整层降级为空 decoration */
export const sensitiveEnabledFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.length > 0 && values[0],
});

export const sensitiveEnabledCompartment = new Compartment();

/** 防抖结束后的强制刷新信号 */
export const refreshSensitive = StateEffect.define<null>();

/**
 * 高亮装饰：底纹 + inset 波浪线，**不改字宽、不改行高**。
 *
 * 词条挂在 `data-sensitive-word` 上而不是塞进 class：
 * 词条是用户可编辑的任意中文，拼进 class 会生成非法选择器；
 * 放进 dataset 后也方便将来做「悬停显示命中词」的原生 tooltip。
 */
const sensitiveDecoration = (word: string): Decoration =>
  Decoration.mark({
    class: "nv-sm",
    attributes: { "data-sensitive-word": word, title: `敏感词：${word}` },
  });

class SensitivePlugin {
  decorations: DecorationSet = Decoration.none;

  /** 组合输入期间冻结（IME） */
  private suspended = false;
  private timer: number | null = null;
  private readonly handleStart: () => void;
  private readonly handleEnd: () => void;
  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
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
    const forced = update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(refreshSensitive)),
    );

    if (this.suspended && !forced) return;

    if (update.docChanged) {
      // 外部整篇替换（切章 / 回滚）会同时携带强制刷新信号：
      // 立即重建，避免上一章的高亮残留一个防抖周期
      if (forced) {
        this.decorations = this.build();
        return;
      }
      this.schedule(300);
      return;
    }

    if (forced || update.viewportChanged) {
      this.decorations = this.build();
    }
  }

  destroy(): void {
    this.clearTimer();
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

  private requestRefresh(): void {
    if (!this.view.dom.isConnected) return;
    this.view.dispatch({
      effects: refreshSensitive.of(null),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  private build(): DecorationSet {
    const view = this.view;
    if (!view.state.facet(sensitiveEnabledFacet)) return Decoration.none;

    const words = view.state.facet(sensitiveWordsFacet);
    if (words.length === 0) return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      // scanText 返回的是「这一段文本内」的偏移，加回段起点即文档坐标
      for (const hit of scanText(view.state.sliceDoc(from, to), words)) {
        builder.add(from + hit.from, from + hit.to, sensitiveDecoration(hit.word));
      }
    }
    return builder.finish();
  }
}

/** 敏感词高亮扩展：词库与开关都走 compartment，运行期可热更新 */
export function sensitiveLayer(
  words: readonly string[],
  enabled: boolean,
): Extension[] {
  return [
    sensitiveWordsCompartment.of(sensitiveWordsFacet.of(words)),
    sensitiveEnabledCompartment.of(sensitiveEnabledFacet.of(enabled)),
    ViewPlugin.fromClass(SensitivePlugin, {
      decorations: (plugin) => plugin.decorations,
    }),
  ];
}
