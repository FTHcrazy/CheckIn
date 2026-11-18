import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  isTermCandidate,
  normalizeSelection,
  preciseSelectionText,
  useSelectionTerms,
} from "./useSelectionTerms";

/**
 * 划词的**判定口径**（纯函数部分）。
 *
 * 这两条规则决定「划一下会不会弹浮层」，是用户体感最直接的地方：
 * - 收得太松：选个标点、选半行代码都弹，浮层成了噪音；
 * - 收得太紧：正常的名词选不中，功能等于不存在。
 *
 * 拖选事件本身（pointerdown / pointerup / rAF 读取）在 jsdom 里拿不到真实的
 * 选区矩形，只能靠手工验证，所以这里把可单测的那一半钉死。
 */
describe("normalizeSelection", () => {
  it("合并连续空白并去首尾空白", () => {
    expect(normalizeSelection("  event   loop \n")).toBe("event loop");
  });

  it("去掉选中时顺手带上的标点", () => {
    expect(normalizeSelection("「事件循环」")).toBe("事件循环");
    expect(normalizeSelection("（闭包）")).toBe("闭包");
    expect(normalizeSelection("Fiber,")).toBe("Fiber");
  });

  it("只剥首尾：中间的连字符与斜杠要保留（如 JS/TS、micro-task）", () => {
    expect(normalizeSelection("micro-task")).toBe("micro-task");
    expect(normalizeSelection("JS/TS 区别")).toBe("JS/TS 区别");
  });
});

describe("isTermCandidate", () => {
  it("中文取 2–12 字", () => {
    expect(isTermCandidate("闭包")).toBe(true);
    expect(isTermCandidate("事")).toBe(false);
    expect(isTermCandidate("事件循环里的微任务队列与宏任务队列的区别")).toBe(false);
    expect(isTermCandidate("事件循环")).toBe(true);
  });

  it("ASCII 取 3–24 字符", () => {
    expect(isTermCandidate("map")).toBe(true);
    expect(isTermCandidate("js")).toBe(false);
    expect(isTermCandidate("structuredClone")).toBe(true);
  });

  it("含换行的选区一律不收（跨行选中的是段落，不是名词）", () => {
    expect(isTermCandidate("事件\n循环")).toBe(false);
  });

  it("空串与纯空白不收", () => {
    expect(isTermCandidate("")).toBe(false);
    expect(isTermCandidate("   ")).toBe(false);
  });
});

/**
 * 偏移反算（规范 §10.2 的「偏移定位」）。
 *
 * 只靠 `getSelection().toString()` 在跨高亮词的选区上会多带字。这里用真实的
 * DOM 造出 `TermText` 的结构（外层 `data-text-full` + 片段 `data-text-start/end`），
 * 验证「反算结果与浏览器给的一致才采信」这条闸门。
 */
describe("preciseSelectionText", () => {
  /** 造一段与 TermText 同构的 DOM：全文 + 两段（第二段是「命中词」按钮） */
  function makeHost(full: string, hitStart: number, hitEnd: number): HTMLElement {
    const host = document.createElement("span");
    host.dataset.textFull = full;
    const before = document.createElement("span");
    before.dataset.textStart = "0";
    before.dataset.textEnd = String(hitStart);
    before.textContent = full.slice(0, hitStart);
    const hit = document.createElement("button");
    hit.dataset.textStart = String(hitStart);
    hit.dataset.textEnd = String(hitEnd);
    hit.textContent = full.slice(hitStart, hitEnd);
    const after = document.createElement("span");
    after.dataset.textStart = String(hitEnd);
    after.dataset.textEnd = String(full.length);
    after.textContent = full.slice(hitEnd);
    host.append(before, hit, after);
    document.body.append(host);
    return host;
  }

  /** 取容器里第 index 个文本节点 */
  function textNodeOf(host: HTMLElement, index: number): Text {
    const nodes = Array.from(host.querySelectorAll("span, button")).map(
      (element) => element.firstChild,
    );
    return nodes[index] as Text;
  }

  it("同一片段内的选区按偏移切片（不把相邻的高亮词算进来）", () => {
    const full = "用 weak map 做缓存";
    const host = makeHost(full, 2, 10); // "weak map"
    const after = textNodeOf(host, 2); // " 做缓存"
    const range = document.createRange();
    range.setStart(after, 1);
    range.setEnd(after, 3);
    expect(preciseSelectionText(range, "做缓")).toBe("做缓");
    host.remove();
  });

  it("跨片段选区用原文区间拼回来", () => {
    const full = "用 weak map 做缓存";
    const host = makeHost(full, 2, 10);
    const before = textNodeOf(host, 0); // "用 "
    const hit = textNodeOf(host, 1); // "weak map"
    const range = document.createRange();
    range.setStart(before, 2); // 整段从命中词开始（起点压在片段边界上）
    range.setEnd(hit, 8); // 命中词末尾
    expect(preciseSelectionText(range, "weak map")).toBe("weak map");
    host.remove();
  });

  it("反算结果与浏览器给的文本不一致时返回 null（交给调用方回落）", () => {
    const full = "用 weak map 做缓存";
    const host = makeHost(full, 2, 10);
    const before = textNodeOf(host, 0);
    const range = document.createRange();
    range.setStart(before, 1);
    range.setEnd(before, 2);
    // 手写一个「浏览器说选到的是别的字」的输入
    expect(preciseSelectionText(range, "完全不同的一段文本")).toBeNull();
    host.remove();
  });

  it("没有锚点 / 没有原文的属性时返回 null", () => {
    const plain = document.createElement("p");
    plain.textContent = "普通段落";
    document.body.append(plain);
    const range = document.createRange();
    range.setStart(plain.firstChild as Text, 0);
    range.setEnd(plain.firstChild as Text, 2);
    expect(preciseSelectionText(range, "普通")).toBeNull();
    plain.remove();
  });
});

/**
 * 「点击浮层按钮后浮层仍然在」的回归守卫。
 *
 * 现场：划词 → 点「问 AI」→ 按钮转圈 → 浮层消失，模型返回的解释无处显示。
 * 根因是点浮层按钮会让浏览器折叠正文选区并派发 `selectionchange`，而浮层
 * 本身不在选区里。这里用真实事件把那条链路复现一遍。
 */
describe("浮层内交互不关闭浮层", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
  });

  /** jsdom 没有指针事件构造器：用 MouseEvent 带 type 派出同名事件即可 */
  function firePointer(
    target: EventTarget,
    type: "pointerdown" | "pointerup",
    x: number,
    y: number,
  ): void {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  }

  /** 造一个可划词的容器，并选中前 4 个字（jsdom 没有布局，矩形手工给） */
  function setupSelection(): { container: HTMLDivElement; ref: { current: HTMLDivElement } } {
    const container = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "事件循环里的微任务队列";
    container.append(span);
    document.body.append(container);

    const range = document.createRange();
    range.setStart(span.firstChild as Text, 0);
    range.setEnd(span.firstChild as Text, 4);
    // `anchorOf` 量不到矩形就不弹浮层，jsdom 的 range 恒为 0×0
    range.getClientRects = () =>
      [{ top: 10, bottom: 20, left: 10, width: 40, height: 10 } as DOMRect] as unknown as DOMRectList;

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    return { container, ref: { current: container } };
  }

  /** 等一帧：hook 在 `requestAnimationFrame` 里读选区 */
  async function nextFrame(): Promise<void> {
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  it("点在浮层里、随后选区被折叠 —— 选区状态仍然保留", async () => {
    const { container, ref } = setupSelection();
    const { result } = renderHook(() => useSelectionTerms(ref));

    firePointer(container, "pointerdown", 10, 10);
    firePointer(container, "pointerup", 40, 40);
    await nextFrame();
    expect(result.current.selection?.text).toBe("事件循环");

    // 点浮层里的按钮：真实浏览器在此时折叠选区并派发 selectionchange
    const popover = document.createElement("div");
    popover.className = "interview-selection";
    document.body.append(popover);
    await act(async () => {
      firePointer(popover, "pointerdown", 5, 5);
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(result.current.selection?.text).toBe("事件循环");
  });

  it("对照：没有点过浮层时，选区被折叠就关闭（说明上一条不是恒真）", async () => {
    const { container, ref } = setupSelection();
    const { result } = renderHook(() => useSelectionTerms(ref));

    firePointer(container, "pointerdown", 10, 10);
    firePointer(container, "pointerup", 40, 40);
    await nextFrame();
    expect(result.current.selection).not.toBeNull();

    await act(async () => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(result.current.selection).toBeNull();
  });

  it("点浮层外会松开 hold（否则浮层再也关不掉）", async () => {
    const { container, ref } = setupSelection();
    const { result } = renderHook(() => useSelectionTerms(ref));

    firePointer(container, "pointerdown", 10, 10);
    firePointer(container, "pointerup", 40, 40);
    await nextFrame();

    const popover = document.createElement("div");
    popover.className = "interview-selection";
    document.body.append(popover);
    await act(async () => {
      firePointer(popover, "pointerdown", 5, 5);
    });
    expect(result.current.selection).not.toBeNull();

    // 回到正文里按一下：这一次必须清掉
    await act(async () => {
      firePointer(container, "pointerdown", 10, 10);
    });
    expect(result.current.selection).toBeNull();
  });
});
