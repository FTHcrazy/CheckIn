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
 * 【点击浮层按钮 ≠ 放弃划词】
 * 浮层是 portal 到 body 的另一个节点，点它的按钮会让浏览器折叠正文选区并派发
 * `selectionchange`。若照常按「选区折叠就关浮层」处理，「问 AI」刚点下去浮层就
 * 被卸载，模型返回的解释无处显示。所以浮层内按下 / 按键期间置一个 hold 标记，
 * 期间忽略 `selectionchange`。
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

/** 划词浮层的根类名（portal 到 body，与 `SelectionTermPopover` 的 className 同一字符串） */
const POPOVER_SELECTOR = ".interview-selection";

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

/**
 * 按 `data-text-*` 锚点反算选区原文（规范 §10.2 的「偏移定位」）。
 *
 * 单纯用 `getSelection().toString()` 在跨高亮词的选区上会多带字：`TermText` 把一句话
 * 切成多个 `<span>` / `<button>`，浏览器在这种结构上给出的字符串边界偶尔会扩散到
 * 整个节点（划 `weak map` 时把相邻的 `map` 一起带上）。
 *
 * 反算需要的两个前提都由 `TermText` 保证：
 * - 每个片段挂 `data-text-start` / `data-text-end`（本片段在原文里的 `[start, end)`）；
 * - 根节点挂 `data-text-full`（原文本身，`slice` 的来源）。
 *
 * 任何一步对不上（跨段落、多文本节点、锚点缺失、与浏览器结果不一致）都返回 `null`，
 * 由调用方回落 `toString()` —— 精确化只做增强，绝不因为反算失败就丢掉这次划词。
 */
export function preciseSelectionText(range: Range, raw: string): string | null {
  const { startContainer, endContainer } = range;
  // `startOffset` 在文本节点上是字符下标，在元素节点上是子节点下标 —— 后者无法反算
  if (startContainer.nodeType !== Node.TEXT_NODE) return null;
  if (endContainer.nodeType !== Node.TEXT_NODE) return null;

  const startElement = anchorElementOf(startContainer);
  const endElement = anchorElementOf(endContainer);
  if (!startElement || !endElement) return null;

  // 两个端点必须共享同一份原文（跨段落的选区没有可比对的单一 full）
  const host = startElement.closest<HTMLElement>("[data-text-full]");
  if (!host || !host.contains(endElement)) return null;
  const full = host.dataset.textFull ?? "";
  if (!full) return null;

  const startBase = Number(startElement.dataset.textStart);
  const endBase = Number(endElement.dataset.textEnd);
  if (!Number.isFinite(startBase) || !Number.isFinite(endBase)) return null;

  // 锚点元素里若不止一个文本节点，offset 就不再等价于「片段内第几个字符」
  if (!isSoleTextChild(startElement, startContainer)) return null;
  if (!isSoleTextChild(endElement, endContainer)) return null;

  const start = startBase + range.startOffset;
  const end = endBase - (endElement.textContent?.length ?? 0) + range.endOffset;
  if (start < 0 || end <= start || end > full.length) return null;

  const slice = full.slice(start, end);
  // 与浏览器给的选区不一致 ⇒ 锚点与 DOM 已经不同步，不采信
  return normalizeSelection(slice) === normalizeSelection(raw) ? slice : null;
}

/** 锚点元素的内容是否为「唯一文本节点」，且选区端点正好落在它身上 */
function isSoleTextChild(element: HTMLElement, node: Node): boolean {
  return element.childNodes.length === 1 && element.firstChild === node;
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
  /**
   * 「用户正在浮层里操作」——期间**不许**因为选区折叠而关闭浮层。
   *
   * 为什么必须单独记：点浮层里的按钮时，浏览器会把正文选区折叠掉并派发一次
   * `selectionchange`，而浮层是 `position: fixed` 的 portal 节点，它本身不在
   * 选区里。只看 `isCollapsed` 的话，「问 AI」刚转圈浮层就被卸载了 ——
   * 模型随后返回的解释再也没地方显示（实机复现过）。
   *
   * 复位时机只有两个：在浮层外按下（那时选区本来也该清），或显式 `clear()`。
   */
  const holdRef = useRef(false);

  const clear = useCallback((): void => {
    holdRef.current = false;
    setSelection(null);
    const active = window.getSelection();
    // 动作执行后必须把选区清掉，否则浮层会跟着旧选区重复触发
    active?.removeAllRanges();
  }, []);

  /**
   * 只在**真的换了选区**时才写 state。
   *
   * 代价必须讲清楚：`pointerup` 对同一个选区再读一次会造出一个内容相同的新对象，
   * 而浮层用 `selection` 的对象引用判断「换词了没」——新引用会让它在点击浮层
   * 按钮后立刻复位并清掉刚发起的 AI 解释，表现为「点问 AI，解释区一闪就没了，
   * 等模型回来才出现」。内容相同就不写，这条链路根本不会启动。
   */
  const commitSelection = useCallback((next: SelectionTerm | null): void => {
    setSelection((previous) => {
      if (previous === null || next === null) return previous === next ? previous : next;
      const sameAnchor =
        Math.abs(previous.anchor.top - next.anchor.top) < 0.5 &&
        Math.abs(previous.anchor.bottom - next.anchor.bottom) < 0.5 &&
        Math.abs(previous.anchor.left - next.anchor.left) < 0.5;
      if (sameAnchor && previous.text === next.text && previous.sentence === next.sentence) {
        return previous;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /** 读一次选区并决定要不要弹浮层 */
    const read = (): void => {
      // 正在浮层里操作（按下 / 键盘焦点在浮层）时，选区抖动不代表换词：
      // 照常读会把「问 AI」刚设好的 loading 与随后的解释一起冲掉
      if (holdRef.current) return;
      const active = window.getSelection();
      if (!active || active.isCollapsed || active.rangeCount === 0) {
        commitSelection(null);
        return;
      }
      const range = active.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        commitSelection(null);
        return;
      }
      if (insideCode(range.startContainer) || insideCode(range.endContainer)) {
        commitSelection(null);
        return;
      }
      const raw = active.toString();
      const precise = preciseSelectionText(range, raw);
      const text = normalizeSelection(precise ?? raw);
      if (!isTermCandidate(text)) {
        commitSelection(null);
        return;
      }
      const anchor = anchorOf(range);
      if (!anchor) {
        commitSelection(null);
        return;
      }
      commitSelection({
        text,
        sentence: sentenceAround(anchorElementOf(range.startContainer), text),
        anchor,
      });
    };

    const onPointerDown = (event: PointerEvent): void => {
      originRef.current = { x: event.clientX, y: event.clientY };
      // 点在浮层自己身上时不要清：否则按钮的 click 还没派发就被卸载了
      const target = event.target as HTMLElement | null;
      if (target?.closest(POPOVER_SELECTOR)) {
        holdRef.current = true;
        return;
      }
      holdRef.current = false;
      commitSelection(null);
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
      // 浮层内的按钮被点击 / Tab 聚焦都会让正文选区折叠，但那不代表用户
      // 放弃了这次划词 —— 见 `holdRef` 的注释
      if (holdRef.current) return;
      const active = window.getSelection();
      if (!active || active.isCollapsed) commitSelection(null);
    };

    /**
     * 键盘走到浮层里（Tab 到按钮、回车触发）时同样要 hold：
     * `keyup` 的读取逻辑只在 Shift 扩选时触发，这里只管「别把浮层关掉」。
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(POPOVER_SELECTOR)) holdRef.current = true;
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("selectionchange", onSelectionChange);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [containerRef, commitSelection]);

  return { selection, clear };
}
