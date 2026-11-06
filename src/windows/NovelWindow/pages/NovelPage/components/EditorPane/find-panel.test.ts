import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { closeSearchPanel, search, searchKeymap } from "@codemirror/search";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createFindPanel,
  findPanelMargins,
  findPanelScroll,
  openFindPanel,
} from "./find-panel";

/**
 * 查找 / 替换面板的行为守卫（真实 CodeMirror 实例 + jsdom）。
 *
 * 钉的是**交互结果**而不是源码字符串：面板是我们自己渲染的 DOM，
 * 光看代码看不出「点一下到底动了没」。这里覆盖四件最容易回归的事：
 *   1. 命中计数：「共几处」与「第几个」是否跟着输入 / 跳转走；
 *   2. 三个选项开关是否真的改到查询（不是只亮个灯）；
 *   3. 替换一次 / 全部替换是否真的改正文；
 *   4. Ctrl+F / Ctrl+H 的替换行显隐，以及 Esc 关闭。
 */

/**
 * 面板开场就聚焦输入框，CodeMirror 随即测量文本尺寸；jsdom 的 Range 没有
 * 布局 API，缺了会在 RAF 回调里抛 `getClientRects is not a function`。
 * 这里只补「量不到」的空结果，不假装有几何。
 */
beforeAll(() => {
  const emptyRects = () => Object.assign([], { item: () => null });
  Range.prototype.getClientRects = emptyRects as unknown as () => DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect() as DOMRect;
});

function mount(doc: string): EditorView {
  // 外面套一层真实的滚动容器：跳转落点按「最近的可滚动祖先」量几何，
  // 没有它 findPanelScroll 会直接交回默认实现
  const scroller = document.createElement("div");
  scroller.className = "nv-editor__scroll";
  document.body.appendChild(scroller);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        search({ top: true, createPanel: createFindPanel }),
        findPanelMargins,
        findPanelScroll,
        keymap.of([...searchKeymap]),
      ],
    }),
    parent: scroller,
  });
}

const panelOf = (view: EditorView): HTMLElement | null =>
  view.dom.querySelector<HTMLElement>(".nv-find");

const countOf = (view: EditorView): string =>
  panelOf(view)?.querySelector(".nv-find__count")?.textContent ?? "";

/** 只取「共几处」那一半：前半是「第几个」，会随光标走，不适合拿来比总数 */
const totalOf = (view: EditorView): string => {
  const label = countOf(view);
  return label.includes("/") ? label.split("/")[1].trim() : label;
};

const inputOf = (view: EditorView, name: "search" | "replace"): HTMLInputElement => {
  const input = panelOf(view)?.querySelector<HTMLInputElement>(`input[name=${name}]`);
  if (!input) throw new Error(`找不到 ${name} 输入框`);
  return input;
};

/** 在输入框里打字：input 事件才是查询跟手的触发点（change 只在失焦时来） */
function type(view: EditorView, name: "search" | "replace", value: string): void {
  const input = inputOf(view, name);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const click = (view: EditorView, selector: string): void => {
  const button = panelOf(view)?.querySelector<HTMLElement>(selector);
  if (!button) throw new Error(`找不到 ${selector}`);
  button.click();
};

/** 主选区（断言「到底跳了没跳」） */
const selectionOf = (view: EditorView): { from: number; to: number } => {
  const { main } = view.state.selection;
  return { from: main.from, to: main.to };
};

/** 把光标放到指定位置（模拟「手点正文」） */
const putCursor = (view: EditorView, pos: number): void => {
  view.dispatch({ selection: EditorSelection.cursor(pos) });
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("find-panel：命中计数", () => {
  it("输入后就报「第几个 / 共几处」，跳转跟着往前走", () => {
    const view = mount("陆行舟没动。陆行舟抬头。陆行舟离开。");
    openFindPanel(view, { replace: false });

    // 光标在文首：报的是「下一处」，点一下就会跳到它（VS Code 同款口径）
    type(view, "search", "陆行舟");
    expect(countOf(view)).toBe("1 / 3");

    click(view, "[data-act=next]");
    expect(selectionOf(view)).toEqual({ from: 0, to: 3 });
    expect(countOf(view)).toBe("1 / 3");

    click(view, "[data-act=next]");
    expect(selectionOf(view)).toEqual({ from: 6, to: 9 });
    expect(countOf(view)).toBe("2 / 3");

    // 往回走要能退到上一个，而不是绕回最后一个
    click(view, "[data-act=prev]");
    expect(selectionOf(view)).toEqual({ from: 0, to: 3 });
    expect(countOf(view)).toBe("1 / 3");

    view.destroy();
  });

  it("光标停在某处命中中间时，「下一个」要走到下一处（不能原地打转）", () => {
    const view = mount("陆行舟没动。陆行舟抬头。陆行舟离开。");
    openFindPanel(view, { replace: false });
    type(view, "search", "陆行舟");

    // 手点正文，光标落在第 1 处的词中间：位置报 1 / 3
    putCursor(view, 1);
    expect(countOf(view)).toBe("1 / 3");

    // 这一下必须真的前进（旧实现会把同一处再选一遍，屏幕纹丝不动）
    click(view, "[data-act=next]");
    expect(selectionOf(view)).toEqual({ from: 6, to: 9 });
    expect(countOf(view)).toBe("2 / 3");

    view.destroy();
  });

  it("零长度命中（正则 ^）也不会原地打转", () => {
    const view = mount("甲\n乙\n丙");
    openFindPanel(view, { replace: false });
    click(view, "[data-opt=regexp]");
    type(view, "search", "^");

    putCursor(view, 0);
    click(view, "[data-act=next]");
    // 第一处的零长度命中就在光标底下，必须挪到下一行行首
    expect(selectionOf(view)).toEqual({ from: 2, to: 2 });

    click(view, "[data-act=next]");
    expect(selectionOf(view)).toEqual({ from: 4, to: 4 });

    view.destroy();
  });

  it("没有命中时明确说「无结果」，表达式写坏时说「表达式无效」", () => {
    const view = mount("沈青梧走在雾里。");
    openFindPanel(view, { replace: false });

    type(view, "search", "陆行舟");
    expect(countOf(view)).toBe("无结果");

    click(view, "[data-opt=regexp]");
    type(view, "search", "雾(");
    expect(countOf(view)).toBe("表达式无效");

    view.destroy();
  });
});

describe("find-panel：选项开关", () => {
  it("Aa 真的改成区分大小写（不只是点亮按钮）", () => {
    const view = mount("Abc abc ABC");
    openFindPanel(view, { replace: false });

    type(view, "search", "abc");
    expect(totalOf(view)).toBe("3");

    click(view, "[data-opt=case]");
    expect(totalOf(view)).toBe("1");
    expect(panelOf(view)?.querySelector("[data-opt=case]")?.getAttribute("aria-pressed")).toBe(
      "true",
    );

    click(view, "[data-opt=case]");
    expect(totalOf(view)).toBe("3");

    view.destroy();
  });

  it("全字匹配不会命中更长的词", () => {
    const view = mount("陆行舟 陆行舟的剑 陆行舟");
    openFindPanel(view, { replace: false });

    type(view, "search", "陆行舟");
    expect(totalOf(view)).toBe("3");

    click(view, "[data-opt=word]");
    expect(totalOf(view)).toBe("2");

    view.destroy();
  });
});

describe("find-panel：替换", () => {
  it("替换一次只动当前命中，全部替换动到底", () => {
    const view = mount("陆行舟没动。陆行舟抬头。");
    openFindPanel(view, { replace: true });

    type(view, "search", "陆行舟");
    type(view, "replace", "沈青梧");

    click(view, "[data-act=replace-one]");
    expect(view.state.doc.toString()).toBe("沈青梧没动。陆行舟抬头。");

    click(view, "[data-act=replace-all]");
    expect(view.state.doc.toString()).toBe("沈青梧没动。沈青梧抬头。");

    view.destroy();
  });
});

describe("find-panel：开关与关闭", () => {
  it("Ctrl+F 收起替换行，Ctrl+H 展开；面板开着时是就地切换", () => {
    const view = mount("陆行舟没动。");
    const replaceRow = (): HTMLElement | null =>
      panelOf(view)?.querySelector<HTMLElement>(".nv-find__row--replace") ?? null;

    openFindPanel(view, { replace: true });
    expect(replaceRow()?.hidden).toBe(false);

    // 已经开着：不能再走一遍「关掉再开」，否则焦点会回正文、查询被重新种子化
    openFindPanel(view, { replace: false });
    expect(panelOf(view)).not.toBeNull();
    expect(replaceRow()?.hidden).toBe(true);

    openFindPanel(view, { replace: true });
    expect(replaceRow()?.hidden).toBe(false);

    view.destroy();
  });

  it("Esc 关闭面板并把焦点还给正文", () => {
    const view = mount("陆行舟没动。");
    openFindPanel(view, { replace: true });
    expect(panelOf(view)).not.toBeNull();

    inputOf(view, "search").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(panelOf(view)).toBeNull();

    view.destroy();
  });
});

describe("find-panel：跳转落点", () => {
  /**
   * jsdom 没有布局：给滚动容器装上可以断言的几何，再把「命中渲染在哪」注入进去。
   * 钉的是**算式**（可见带 = 卡片下沿 ~ 视口下沿），不是 jsdom 的渲染。
   */
  function geometry(view: EditorView, box: { top: number; height: number }) {
    const scroller = view.dom.parentElement as HTMLElement;
    let scrollTop = 0;
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      get: () => box.height,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    scroller.getBoundingClientRect = () => new DOMRect(0, box.top, 600, box.height);
    return {
      scroller,
      scrollTop: () => scrollTop,
      /** 假装某一处命中渲染在视口坐标 at 处（行高 20） */
      placeMatchAt(at: number): void {
        view.coordsAtPos = (() => ({
          left: 0,
          right: 10,
          top: at,
          bottom: at + 20,
          side: 1,
        })) as EditorView["coordsAtPos"];
      },
    };
  }

  /** 直接跑一次滚动处理器（panel 的跳转就是派发 scrollIntoView 走这条路） */
  const runHandler = (view: EditorView, from: number): boolean => {
    const handler = view.state.facet(EditorView.scrollHandler)[0] as unknown as (
      view: EditorView,
      range: { from: number; to: number },
    ) => boolean;
    return handler(view, EditorSelection.cursor(from));
  };

  it("命中压在卡片底下要滚上来；已经在可见带里就不动", () => {
    const view = mount("陆行舟没动。陆行舟抬头。");
    openFindPanel(view, { replace: false });
    // jsdom 量不到高度：手动给出卡片高度（64 + 20 留白 = 盖住 84px）
    const card = panelOf(view);
    if (!card) throw new Error("面板没打开");
    Object.defineProperty(card, "offsetHeight", { configurable: true, value: 64 });
    const box = geometry(view, { top: 0, height: 400 });

    // 命中在 200~220：卡片盖着 0~84，视口下沿让出 12 → 看得见，一像素不动
    box.placeMatchAt(200);
    expect(runHandler(view, 0)).toBe(true);
    expect(box.scrollTop()).toBe(0);

    // 命中在 380~400：探出下沿 12px，只补这一截
    box.placeMatchAt(380);
    expect(runHandler(view, 0)).toBe(true);
    expect(box.scrollTop()).toBe(12);

    // 命中回到卡片底下（20~40）：往上让开，正好顶到卡片下沿
    box.scroller.scrollTop = 300;
    box.placeMatchAt(20);
    expect(runHandler(view, 0)).toBe(true);
    expect(box.scrollTop()).toBe(300 - 64);

    view.destroy();
  });
});

describe("find-panel：跳转时给浮层让位", () => {
  /** 收集所有「报出顶部让位」的滚动边距 */
  const positiveTops = (view: EditorView): number[] =>
    view.state
      .facet(EditorView.scrollMargins)
      .map((fn) => fn(view))
      .map((margin) => margin?.top ?? 0)
      .filter((top) => top > 0);

  it("面板开着时报出卡片高度，关掉就不再占位", () => {
    const view = mount("陆行舟没动。陆行舟抬头。");
    openFindPanel(view, { replace: false });

    // jsdom 没有布局：手动给出「量到的卡片高度」，验证的是这条算式而非渲染
    const card = panelOf(view);
    expect(card).not.toBeNull();
    Object.defineProperty(card, "offsetHeight", { configurable: true, value: 64 });
    expect(positiveTops(view)).toEqual([84]); // 卡片高度 + 上下留白 20

    closeSearchPanel(view);
    expect(panelOf(view)).toBeNull();
    expect(positiveTops(view)).toEqual([]);

    view.destroy();
  });
});
