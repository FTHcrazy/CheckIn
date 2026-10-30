import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { annotationLayer, refreshAnnotation } from "./novel-editor";
import type { EntityTerm } from "./types";

/**
 * 标注层（要素高亮）的坐标跟随守卫。
 *
 * 事故现场：中文输入法还在候选框里时，人名高亮压在**相邻的字**上（拼音每打一个
 * 字母，偏移就多一格），中文上屏后才跳回正位。根因是 `docChanged` 里只排了一次
 * 300ms 后的重扫、**没有 `decorations.map`**，而组合期的候选文本是逐步写进文档的
 * —— 拼音打多久，高亮就在错的位置停多久。
 *
 * 跑真实 CodeMirror 实例（jsdom），断言 DOM 里标记的文本是什么，
 * 而不是断言源码里有没有某一行。
 */
const DOC = "嗯，沈长青走在路上，遇到相熟的人，彼此都会打个招呼。";
const TERMS: EntityTerm[] = [
  { term: "沈长青", entityId: "e1", type: "character" },
];

function mount(doc = DOC): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [annotationLayer(TERMS, true)],
    }),
    parent: document.body,
  });
}

const marks = (view: EditorView): Element[] =>
  Array.from(view.contentDOM.querySelectorAll("[data-entity-id]"));

const markedText = (view: EditorView): (string | null)[] =>
  marks(view).map((el) => el.textContent);

/** 重扫的唯一入口（facet 变化本身不触发重算） */
const forceRebuild = (view: EditorView): void => {
  view.dispatch({ effects: refreshAnnotation.of(null) });
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("novel-editor：标注跟着正文平移", () => {
  it("命中词被正确标出", () => {
    const view = mount();
    expect(markedText(view)).toEqual(["沈长青"]);
    view.destroy();
  });

  it("IME 组合期插入候选文本 → 高亮立刻跟着挪（不等上屏后的重扫）", () => {
    const view = mount();
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart"));

    // 候选文本逐步写进文档：先打拼音，再反复改写
    view.dispatch({ changes: { from: 0, insert: "ai" } });
    expect(markedText(view)).toEqual(["沈长青"]);
    view.dispatch({ changes: { from: 0, to: 2, insert: "爱上" } });
    expect(markedText(view)).toEqual(["沈长青"]);

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend"));
    forceRebuild(view);
    expect(markedText(view)).toEqual(["沈长青"]);
    view.destroy();
  });

  it("普通输入（非组合期）也是立即平移，不用等 300ms 防抖", () => {
    const view = mount();
    view.dispatch({ changes: { from: 0, insert: "前言：" } });
    expect(markedText(view)).toEqual(["沈长青"]);
    view.destroy();
  });

  it("删掉命中词本身 → 标记消失，不残留空壳", () => {
    const view = mount("沈长青走了。");
    expect(markedText(view)).toEqual(["沈长青"]);
    view.dispatch({ changes: { from: 0, to: 3 } });
    expect(marks(view)).toHaveLength(0);
    view.destroy();
  });
});
