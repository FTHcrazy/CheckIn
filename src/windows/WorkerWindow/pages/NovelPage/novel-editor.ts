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
import type { EntityTerm } from "./types";

/**
 * 编辑器内核的非 UI 部分：标注层（highlight / hover 数据源）扩展。
 *
 * 这段是 PRD §2「正文标注层」与设计方案 §05「标注层生命周期」的落地实现：
 *   1. compositionstart 立即冻结全部 decoration 计算（中文候选期零抖动）
 *   2. compositionend 后 300ms 防抖 + 文档变化 300ms 防抖，再做一轮重算
 *   3. 只扫可视区 ± 一屏，不做全文档扫描
 *   4. 强制刷新用 addToHistory(false) 的空事务，不污染撤销栈
 *
 * 渲染相关行为（hover 出卡、选区标记）由 EditorPane 通过 DOM 事件接出。
 */

/** 词库：由 React 侧在要素变化时 reconfigure（compartment） */
export const termsFacet = Facet.define<EntityTerm[], EntityTerm[]>({
  combine: (values) => values.flat(),
});

export const termsCompartment = new Compartment();

/** 标注层总开关：关闭即整层降级为空 decoration */
export const annotationEnabledFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.length > 0 && values[0],
});

export const annotationEnabledCompartment = new Compartment();

/** 防抖结束后的强制刷新信号 */
export const refreshAnnotation = StateEffect.define<null>();

const highlightDecoration = (term: EntityTerm): Decoration =>
  Decoration.mark({
    class: `nv-hl nv-hl--${term.type}`,
    attributes: {
      "data-entity-id": term.entityId,
      "data-entity-type": term.type,
    },
  });

class AnnotationPlugin {
  decorations: DecorationSet = Decoration.none;

  /** 组合输入期间冻结（ime） */
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
      tr.effects.some((effect) => effect.is(refreshAnnotation)),
    );

    if (this.suspended && !forced) return;

    if (update.docChanged) {
      // 外部整篇替换（切章 / 回滚）会同时携带强制刷新信号：
      // 立即重建，避免上一章的 decoration 残留一个防抖周期（闪一下）
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

  /** 空事务刷新：不进撤销栈，避免污染 history（撤销/重做可靠性是 R2 硬指标） */
  private requestRefresh(): void {
    if (!this.view.dom.isConnected) return;
    this.view.dispatch({
      effects: refreshAnnotation.of(null),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  private build(): DecorationSet {
    const view = this.view;
    if (!view.state.facet(annotationEnabledFacet)) return Decoration.none;

    const terms = view.state.facet(termsFacet);
    if (terms.length === 0) return Decoration.none;

    const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
    const builder = new RangeSetBuilder<Decoration>();

    for (const { from, to } of view.visibleRanges) {
      const slice = view.state.sliceDoc(from, to);
      let offset = from;

      while (offset < to) {
        const rest = slice.slice(offset - from);
        const hit = sorted.find(
          (item) => item.term.length > 0 && rest.startsWith(item.term),
        );
        if (hit) {
          builder.add(
            offset,
            offset + hit.term.length,
            highlightDecoration(hit),
          );
          offset += hit.term.length;
        } else {
          offset += 1;
        }
      }
    }

    return builder.finish();
  }
}

/** 标注层扩展：词库与总开关都走 compartment，运行期可热更新 */
export function annotationLayer(
  terms: EntityTerm[],
  enabled: boolean,
): Extension[] {
  return [
    termsCompartment.of(termsFacet.of(terms)),
    annotationEnabledCompartment.of(annotationEnabledFacet.of(enabled)),
    ViewPlugin.fromClass(AnnotationPlugin, {
      decorations: (plugin) => plugin.decorations,
    }),
  ];
}
