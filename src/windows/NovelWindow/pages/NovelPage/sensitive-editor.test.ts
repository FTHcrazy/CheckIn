import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SensitiveRange } from "./sensitive";
import {
  refreshSensitive,
  sensitiveLayer,
  sensitiveRangesCompartment,
  sensitiveRangesFacet,
} from "./sensitive-editor";

/**
 * 编辑器层的行为守卫：**标注源是「扫描结果」还是「词库」**，以及
 * **扫描结果的坐标必须跟着编辑平移**。
 *
 * 事故现场一：从关闭切到手动，正文全文标红，而面板写着「尚未扫描」、角标 0。
 * 事故现场二：手动扫描完改了几个字（中文输入法），高亮停在旧位置、后面全偏，
 *   关掉再重扫也修不好。根因是组合期早退不平移 + 重建吃的是陈旧快照。
 *
 * 这些用例直接跑真实的 CodeMirror 实例（jsdom），断言 DOM 里标记究竟落在哪，
 * 而不是断言源码文本长什么样 —— 字段名、调用顺序都换了也不影响它们。
 */
function mount(
  doc: string,
  words: string[],
  enabled: boolean,
  ranges: SensitiveRange[] | null,
  onRangesMapped?: (ranges: SensitiveRange[]) => void,
): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [sensitiveLayer(words, enabled, ranges, onRangesMapped ?? null)],
    }),
    parent: document.body,
  });
  return view;
}

const marks = (view: EditorView): Element[] =>
  Array.from(view.contentDOM.querySelectorAll("[data-sensitive-word]"));

const markedText = (view: EditorView): (string | null)[] =>
  marks(view).map((el) => el.textContent);

/** 高亮层重建的唯一入口：强制刷新（facet 变化本身不触发重算） */
const forceRebuild = (view: EditorView): void => {
  view.dispatch({
    effects: refreshSensitive.of(null),
    annotations: [],
  });
};

const DOC =
  "跟镇魔司其他充满肃杀的地方不同，此处阁楼好像是鹤立鸡群一般，在满是血腥的镇魔司中，呈现出不一样的宁静。";
const HIT_AT = DOC.indexOf("血腥");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("sensitive-editor：标注源", () => {
  it("手动模式未扫描（空区间）→ 正文一个字都不标", () => {
    const view = mount("他说要斩首示众", ["斩首"], true, []);
    expect(marks(view)).toHaveLength(0);
    view.destroy();
  });

  it("手动模式有扫描结果 → 只标结果里的区间", () => {
    // 词库里有两个词，但扫描结果只命中「斩首」→ 正文只能有这一处标记
    const view = mount("他说要斩首，还要血屠", ["斩首", "血屠"], true, [
      { word: "斩首", from: 3, to: 5 },
    ]);
    const found = marks(view);
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toBe("斩首");
    view.destroy();
  });

  it("自动模式（ranges 为 null）→ 按词库实时标", () => {
    const view = mount("他说要斩首，还要血屠", ["斩首", "血屠"], true, null);
    expect(marks(view)).toHaveLength(2);
    view.destroy();
  });

  it("关闭（enabled 为 false）→ 词库再全也不标", () => {
    const view = mount("他说要斩首", ["斩首"], false, null);
    expect(marks(view)).toHaveLength(0);
    view.destroy();
  });
});

describe("sensitive-editor：手动模式的坐标平移", () => {
  it("在命中词之前插入文字 → 高亮跟着挪，仍覆盖同一个词", () => {
    const ranges: SensitiveRange[] = [{ word: "血腥", from: HIT_AT, to: HIT_AT + 2 }];
    const view = mount(DOC, ["血腥"], true, ranges);
    expect(markedText(view)).toEqual(["血腥"]);

    view.dispatch({ changes: { from: 0, insert: "前言：" } });
    expect(markedText(view)).toEqual(["血腥"]);

    // 关键：重建（强制刷新 / 滚动 / 组合结束都走它）后也不能跳回旧坐标
    forceRebuild(view);
    expect(markedText(view)).toEqual(["血腥"]);
    view.destroy();
  });

  it("IME 组合期改字（冻结期）也要平移，组合结束后重建不跑偏", () => {
    const ranges: SensitiveRange[] = [{ word: "血腥", from: HIT_AT, to: HIT_AT + 2 }];
    const view = mount(DOC, ["血腥"], true, ranges);

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart"));
    view.dispatch({ changes: { from: HIT_AT - 1, insert: "满是" } });
    expect(markedText(view)).toEqual(["血腥"]);

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend"));
    forceRebuild(view);
    expect(markedText(view)).toEqual(["血腥"]);
    view.destroy();
  });

  it("删掉命中词本身 → 该处标记消失，不留空壳", () => {
    const second = DOC.indexOf("阁楼");
    const ranges: SensitiveRange[] = [
      { word: "阁楼", from: second, to: second + 2 },
      { word: "血腥", from: HIT_AT, to: HIT_AT + 2 },
    ];
    const view = mount(DOC, ["血腥", "阁楼"], true, ranges);
    expect(markedText(view)).toEqual(["阁楼", "血腥"]);

    view.dispatch({ changes: { from: HIT_AT, to: HIT_AT + 2 } });
    expect(markedText(view)).toEqual(["阁楼"]);
    view.destroy();
  });

  it("重新扫描送来新快照（facet 换身份）→ 采纳新坐标", () => {
    const ranges: SensitiveRange[] = [{ word: "血腥", from: HIT_AT, to: HIT_AT + 2 }];
    const view = mount(DOC, ["血腥"], true, ranges);
    view.dispatch({ changes: { from: 0, insert: "前言：" } });

    // 重新扫描：坐标按当前正文算（新版前进 3）
    view.dispatch({
      effects: [
        sensitiveRangesCompartment.reconfigure(
          sensitiveRangesFacet.of([
            { word: "血腥", from: HIT_AT + 3, to: HIT_AT + 5 },
          ]),
        ),
        refreshSensitive.of(null),
      ],
    });
    expect(markedText(view)).toEqual(["血腥"]);
    expect(marks(view)[0].textContent).toBe("血腥");
    view.destroy();
  });

  it("平移后把区间上报给外部（防抖）", () => {
    vi.useFakeTimers();
    const ranges: SensitiveRange[] = [{ word: "血腥", from: HIT_AT, to: HIT_AT + 2 }];
    const reported: SensitiveRange[][] = [];
    const view = mount(DOC, ["血腥"], true, ranges, (next) => reported.push(next));

    view.dispatch({ changes: { from: 0, insert: "前言：" } });
    expect(reported).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual([
      { word: "血腥", from: HIT_AT + 3, to: HIT_AT + 5 },
    ]);
    vi.useRealTimers();
    view.destroy();
  });
});

/**
 * 平移只保位置、不保内容：坐标会跟着文字走，但「这块文字还是不是那个词」
 * 得单独判一次。事故现场：把「血腥」改成「血型」，红字原样压在「血型」上，
 * 用户看到的是「敏感词都改掉了，高亮还在」。
 */
describe("sensitive-editor：命中词被改写后标记必须消失", () => {
  it("整词替换成别的等长词 → 该处标记消失", () => {
    const ranges: SensitiveRange[] = [{ word: "血腥", from: HIT_AT, to: HIT_AT + 2 }];
    const view = mount(DOC, ["血腥"], true, ranges);
    expect(markedText(view)).toEqual(["血腥"]);

    view.dispatch({ changes: { from: HIT_AT, to: HIT_AT + 2, insert: "血型" } });
    expect(marks(view)).toHaveLength(0);

    // 重建也不能把标记复活（快照已经不可信）
    forceRebuild(view);
    expect(marks(view)).toHaveLength(0);
    view.destroy();
  });

  it("在命中词中间插字（词被拆开）→ 标记消失", () => {
    const ranges: SensitiveRange[] = [{ word: "血腥", from: HIT_AT, to: HIT_AT + 2 }];
    const view = mount(DOC, ["血腥"], true, ranges);

    // 「血」和「腥」之间插一个字：map 会把区间撑成三格，内容已经不是那个词
    view.dispatch({ changes: { from: HIT_AT + 1, insert: "啊" } });
    expect(marks(view)).toHaveLength(0);
    view.destroy();
  });

  it("只改写其中一处 → 另一处不受牵连", () => {
    const other = DOC.indexOf("阁楼");
    const ranges: SensitiveRange[] = [
      { word: "阁楼", from: other, to: other + 2 },
      { word: "血腥", from: HIT_AT, to: HIT_AT + 2 },
    ];
    const view = mount(DOC, ["阁楼", "血腥"], true, ranges);
    expect(markedText(view)).toEqual(["阁楼", "血腥"]);

    view.dispatch({ changes: { from: HIT_AT, to: HIT_AT + 2, insert: "血型" } });
    expect(markedText(view)).toEqual(["阁楼"]);
    view.destroy();
  });

  it("被丢弃的标记不再上报（面板计数与角标同步下降）", () => {
    vi.useFakeTimers();
    const ranges: SensitiveRange[] = [{ word: "血腥", from: HIT_AT, to: HIT_AT + 2 }];
    const reported: SensitiveRange[][] = [];
    const view = mount(DOC, ["血腥"], true, ranges, (next) => reported.push(next));

    view.dispatch({ changes: { from: HIT_AT, to: HIT_AT + 2, insert: "血型" } });
    vi.advanceTimersByTime(500);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual([]);
    vi.useRealTimers();
    view.destroy();
  });

  it("快照坐标与正文对不上（错位结果）→ 一个字都不标，宁可少标也不错标", () => {
    // 坐标指向「他说」，词却是「斩首」：这是切章/外部整段改写后的中间态
    const view = mount("他说要斩首", ["斩首"], true, [{ word: "斩首", from: 0, to: 2 }]);
    expect(marks(view)).toHaveLength(0);
    view.destroy();
  });
});
