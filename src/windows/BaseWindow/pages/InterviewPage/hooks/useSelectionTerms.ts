/**
 * 划词检测：把「用户在题目正文里拖选了一段词」变成一份可直接消费的状态。
 *
 * 【为什么不能只用 `selectionchange`】
 * 拖选期间它每移动几像素就触发一次，用它弹浮层会不停闪；而 `click` 的默认行为
 * 会清空选区，同步读 `getSelection()` 拿到的是空串。所以：
 * - `pointerup`（覆盖鼠标与触屏）+ `keyup`（Shift + 方向键）才是**弹浮层的时机**；
 * - 读选区放在下一帧（`requestAnimationFrame`），等浏览器把选区的默认处理做完；
 * - `selectionchange` 只用来**关闭**浮层（选区被清掉时才收）。
 *
 * 【过滤口径】
 * 只有「需要解释的名词」才值得转词条：代码块里的片段（`pre` / `code`）、
 * 跨行的选区、超长句子一律不弹。中文 2–12 字、ASCII 3–24 字，
 * 与 `interview-glossary.ts` 收词口径一致（2 个字符的通用词会在正文里到处误命中）。
 *
 * 【与名词按钮的冲突】
 * 拖选的终点常常落在某个名词按钮上，`pointerup` 之后浏览器照样会派发一次
 * `click`，于是「划词」会顺带打开名词弹层。判据不能是「选区是否为空」——
 * 程序清掉选区后就误判成单击了。这里用「位移 < 4px 且选区折叠」判单击，
 * 否则置一个 300ms 的抑制窗口，由 `TermChip` 的 `onOpenChange` 读它。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §10.2
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** 浮层锚点：选区最后一行（多行选区取最后一个 rect）的视口坐标 */
export interface SelectionAnchor {
  top: number;
  /** 左边界（未夹取，夹取在渲染层按浮层宽度做） */
  left: number;
  bottom: number;
}

export interface SelectionTerm {
  /** 归一后的词（已 trim、去首尾标点） */
  text: string;
  /** 命中词所在的那一句（居中切片，给 AI 当语境） */
  sentence: string;
  anchor: SelectionAnchor;
}

/** 中文按字符数、ASCII 按字符数分别设上下限 */
const CJK_MIN = 2;
const CJK_MAX = 12;
const ASCII_MIN = 3;
const ASCII_MAX = 24;

/** 位移小于这个值判「单击」，交给名词按钮 */
const CLICK_SLOP = 4;

/** 拖选后抑制名词按钮弹出的时长（够一次 click 派发完即可） */
const CHIP_SUPPRESS_MS = 300;

/** 模块级抑制时间戳：TermChip 与 hook 都在同一窗口内，不需要跨进程或 context */
let chipSuppressUntil = 0;

/** 名词按钮弹层前问一句「刚才是不是在拖选」 */
export function isChipClickSuppressed(): boolean {
  return Date.now() < chipSuppressUntil;
}

/** 选区首尾要剥掉的标点（中文引号 / 括号、英文引号、半角标点） */
const EDGE_PUNCT =
  /^[\s,.;:!?、，。；：！？"'“”‘’()（）[\]【】「」『』<>《》{}｛｝]+|[\s,.;:!?、，。；：！？"'“”‘’()（）[\]【】「」『』<>《》{}｛｝]+$/gu;

/** 选区文本归一：合并空白、去首尾空白与顺手带上的标点 */
export function normalizeSelection(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(EDGE_PUNCT, "").trim();
}

/** 长度闸门：中文按字数、纯 ASCII 按字母数（混排只要有 CJK 就按中文口径） */
export function isTermCandidate(text: string): boolean {
  if (!text || !text.trim()) return false;
  if (/[\r\n]/.test(text)) return false;
  const hasCjk = /[\u4e00-\u9fa5]/.test(text);
  const length = text.length;
  if (hasCjk) return length >= CJK_MIN && length <= CJK_MAX;
  return length >= ASCII_MIN && length <= ASCII_MAX;
}

/** 选区是否落在代码块里（`pre` / `code` 里的片段不能变词条） */
function insideCode(node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const tag = (current as Element).tagName;
      if (tag === "PRE" || tag === "CODE") return true;
    }
    current = current.parentNode;
  }
  return false;
}

/** 从选区端点向上找最近的偏移锚点（`TermText` 挂的 `data-text-start`） */
function anchorElementOf(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement;
      if (element.dataset.textStart !== undefined) return element;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * 取语境句：拿锚点所在段落的完整文本，在命中位置前后各取一段。
 *
 * 不追求精确分句（中文标点 + 行内标记会让分句变成一场正则噩梦），
 * 只要「让模型知道这个词出现在什么话里」—— 前后各 60 字足够。
 */
function sentenceAround(anchor: HTMLElement | null, term: string): string {
  const host = anchor?.parentElement ?? anchor;
  const full = host?.textContent ?? "";
  if (!full) return "";
  const index = full.indexOf(term);
  if (index < 0) return full.slice(0, 120);
  const start = Math.max(0, index - 60);
  const end = Math.min(full.length, index + term.length + 60);
  return full.slice(start, end);
}

/** 多行选区取**最后一个** rect 的下沿：浮层跟着光标的落点走更符合直觉 */
function anchorOf(range: Range): SelectionAnchor | null {
  const rects = range.getClientRects();
  const last = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!last || (last.width === 0 && last.height === 0)) return null;
  return { top: last.top, bottom: last.bottom, left: last.left };
}

export interface UseSelectionTermsResult {
  /** 当前可用的选区（`null` = 没有 / 不合法 / 已消费） */
  selection: SelectionTerm | null;
  /** 用户点了浮层里的动作或点了别处：清掉选区与浮层 */
  clear: () => void;
}

/**
 * 监听容器内的划词。
 *
 * `containerRef` 是「哪些区域参与划词」的边界：只监听页面正文区，
 * 顶栏输入框、侧栏分类、抽屉里的表单都不该触发。
 */
export function useSelectionTerms(
  containerRef: RefObject<HTMLElement | null>,
): UseSelectionTermsResult {
  const [selection, setSelection] = useState<SelectionTerm | null>(null);
  /** 按下位置：用来判「单击 vs 拖选」 */
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback((): void => {
    setSelection(null);
    const active = window.getSelection();
    // 动作执行后必须把选区清掉，否则浮层会跟着旧选区重复触发
    active?.removeAllRanges();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /** 读一次选区并决定要不要弹浮层 */
    const read = (): void => {
      const active = window.getSelection();
      if (!active || active.isCollapsed || active.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const range = active.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      if (insideCode(range.startContainer) || insideCode(range.endContainer)) {
        setSelection(null);
        return;
      }
      const text = normalizeSelection(active.toString());
      if (!isTermCandidate(text)) {
        setSelection(null);
        return;
      }
      const anchor = anchorOf(range);
      if (!anchor) {
        setSelection(null);
        return;
      }
      setSelection({
        text,
        sentence: sentenceAround(anchorElementOf(range.startContainer), text),
        anchor,
      });
    };

    const onPointerDown = (event: PointerEvent): void => {
      originRef.current = { x: event.clientX, y: event.clientY };
      // 点在浮层自己身上时不要清：否则按钮的 click 还没派发就被卸载了
      const target = event.target as HTMLElement | null;
      if (target?.closest(".interview-selection")) return;
      setSelection(null);
    };

    const onPointerUp = (event: PointerEvent): void => {
      const origin = originRef.current;
      originRef.current = null;
      const moved = origin
        ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y)
        : Number.POSITIVE_INFINITY;
      const active = window.getSelection();
      const collapsed = !active || active.isCollapsed;

      // 单击（没拖动、选区还是折叠的）→ 这不是划词，交给名词按钮
      if (moved < CLICK_SLOP && collapsed) return;
      // 拖过了就是划词：抑制紧随其后的 click 打开名词弹层
      if (moved >= CLICK_SLOP) chipSuppressUntil = Date.now() + CHIP_SUPPRESS_MS;

      // 等浏览器把本次 pointerup 的默认处理（更新选区）做完再读
      window.requestAnimationFrame(read);
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      // 只认「按住 Shift 扩选」：普通打字不该弹浮层
      if (!event.shiftKey) return;
      window.requestAnimationFrame(read);
    };

    const onSelectionChange = (): void => {
      const active = window.getSelection();
      if (!active || active.isCollapsed) setSelection(null);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [containerRef]);

  return { selection, clear };
}
