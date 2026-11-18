import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Tooltip } from "antd";
import { BulbOutlined, FileAddOutlined, PlusCircleOutlined, TagsOutlined } from "@ant-design/icons";
import type { GlossaryTerm } from "../../data/interview-glossary";
import type { SelectionTerm } from "../../hooks/useSelectionTerms";
import "./index.scss";

interface SelectionTermPopoverProps {
  selection: SelectionTerm | null;
  /**
   * 划中的词是否已在词表里（基线 ∪ 增量）。命中时「加为词条」变成
   * 「已是词条」并只展示定义 —— 重复入库会让 matcher 的两个键抢同一段文本。
   */
  existing: GlossaryTerm | null;
  /** 加为词条：页面打开 AI 拓展抽屉（预填 glossary + 种子） */
  onAddTerm: (selection: SelectionTerm) => void;
  /** 补充释义：给已有词条再写一条更深的（仅命中已有词条时可用） */
  onSupplement: (selection: SelectionTerm) => void;
  /**
   * 划中的词被某个已有词条"包着"（`loader` ⊂ `Webpack Loader`）。
   *
   * 这是「库里明明有、正文里却点不开」的补救入口：模型出词条时换了叫法，
   * 那个词就匹配不到。点一下把原文记成它的别名，正文里立刻能点。
   */
  aliasOwner?: GlossaryTerm | null;
  /** 正在写别名（按钮 loading） */
  aliasPending?: boolean;
  /** 补别名失败的原因（红字；成功不会有这条） */
  aliasError?: string | null;
  onAddAlias?: (owner: GlossaryTerm, text: string) => void;
  /** 问 AI：弹层里就地给一段解释 */
  onAskAi: (selection: SelectionTerm) => void;
  onClose: () => void;
  /** AI 解释的正文（`null` = 还没问 / 已清） */
  answer: { loading: boolean; text: string | null; error: string | null };
  /** 关闭时顺手清掉 AI 解释 */
  onClearAnswer: () => void;
}

/**
 * 浮层尺寸（与 scss 里的 `width` / `min-height` 必须一致）。
 *
 * 用常量而不是 `getBoundingClientRect()` 量：浮层刚挂载那一帧还没布局完，
 * 量出来是 0×0，翻转判断必然误判成「下方放得下」。
 */
const POPOVER_WIDTH = 268;
const POPOVER_ESTIMATED_HEIGHT = 96;
const GAP = 8;
const EDGE = 8;

/** 解释正文的估算行高（翻转到上方的判定要把答案高度算进去，否则会盖住选区）
 *  14px × 1.6 ≈ 22.4，向上取整：宁可提前判成「下方放不下」，也别盖住选区 */
const ANSWER_LINE_HEIGHT = 23;
const ANSWER_CHARS_PER_LINE = 18;

/** 估算答案区高度：按字数折算行数，最多算 8 行（超出由浮层内部滚动） */
function estimateAnswerHeight(text: string): number {
  const lines = Math.min(8, Math.ceil(text.length / ANSWER_CHARS_PER_LINE));
  return lines * ANSWER_LINE_HEIGHT + 16;
}

/** prompt 里约定的两段标记（`builders/explain.ts` 的 `EXPLAIN_*_HEAD`） */
const ONE_LINER_HEAD = "【一句话】";
const BODY_HEAD = "【解释】";

/**
 * 解释正文渲染。
 *
 * 模型按 prompt 的要求输出「【一句话】…／【解释】…」两段，直接原样铺开会把
 * 标记行一起显示出来，读起来像调试信息。这里把标记摘掉、把一句话做成首行加粗。
 */
function ExplainText({ text }: { text: string }): ReactNode {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <>
      {lines.map((line) => {
        if (line.startsWith(ONE_LINER_HEAD)) {
          return (
            <strong className="interview-selection__one-liner" key={line.slice(0, 16)}>
              {line.slice(ONE_LINER_HEAD.length).trim()}
            </strong>
          );
        }
        const body = line.startsWith(BODY_HEAD) ? line.slice(BODY_HEAD.length).trim() : line;
        return (
          <p className="interview-selection__text" key={body.slice(0, 16)}>
            {body}
          </p>
        );
      })}
    </>
  );
}

/**
 * 划词浮层（portal 到 body，`position: fixed`）。
 *
 * 【为什么必须 portal】题干与答案在 `overflow: auto` 的列表容器里，
 * 不 portal 会被裁掉一半；`fixed` 定位则免掉滚动补偿。
 *
 * 【为什么不用 Popover / Dropdown】它们的定位锚点是元素，而这里锚点是
 * 「选区矩形」—— 选区不是元素，只能自己算坐标。
 */
export default function SelectionTermPopover({
  selection,
  existing,
  onAddTerm,
  onSupplement,
  onAskAi,
  onClose,
  answer,
  onClearAnswer,
  aliasOwner = null,
  aliasPending = false,
  aliasError = null,
  onAddAlias,
}: SelectionTermPopoverProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  /**
   * 选区身份（词 + 锚点），不是对象引用。
   *
   * 划词 hook 在每次 `pointerup` 后都会重新读一次选区，即使内容一模一样也可能
   * 造出新对象；拿对象当依赖会让「点问 AI → 复位 → 清解释」在点击瞬间空跑一遍，
   * 用户看到的是解释区一闪就没了、等模型回来才出现。
   */
  const identity = selection
    ? `${selection.text}|${selection.anchor.top}|${selection.anchor.left}`
    : null;
  const lastIdentity = useRef<string | null>(null);

  // 换了选区才复位：否则上一次的解释会挂在新的词下面
  useEffect(() => {
    if (lastIdentity.current === identity) return;
    lastIdentity.current = identity;
    setReady(false);
    onClearAnswer();
    if (identity === null) return;
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
    // `onClearAnswer` 是 useCallback 稳定的；只在选区身份变化时重跑
  }, [identity, onClearAnswer]);

  /**
   * 收起浮层的两个自然手势：Esc、以及「选区不再原位」。
   *
   * 浮层是 `position: fixed` + 一次性算好的坐标：列表一滚它就悬在原地，
   * 既能挡住别的段落，点的又是「已经不在这儿的那个词」。滚动即收起是
   * 系统划词菜单的通行做法。
   *
   * 两个细节：
   * 1. `scroll` 必须 capture —— 列表容器的滚动不冒泡到 window；
   * 2. 浮层**自己内部**的滚动（AI 解释区）不能算，否则读答案时浮层自己没了。
   */
  useEffect(() => {
    if (!selection) return;
    const dismiss = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [selection, onClose]);

  const position = useMemo(() => {
    if (!selection) return null;
    const { anchor } = selection;
    const extra = answer.text
      ? estimateAnswerHeight(answer.text)
      : answer.loading
        ? ANSWER_LINE_HEIGHT + 8
        : 0;
    const height = POPOVER_ESTIMATED_HEIGHT + extra;
    const below = anchor.bottom + GAP;
    const flip = below + height > window.innerHeight - EDGE;
    const top = flip ? Math.max(EDGE, anchor.top - GAP - height) : below;
    const left = Math.min(
      Math.max(EDGE, anchor.left),
      Math.max(EDGE, window.innerWidth - POPOVER_WIDTH - EDGE),
    );
    return { top, left };
  }, [selection, answer.text, answer.loading]);

  if (!selection || !position || !ready) return null;

  const isExisting = Boolean(existing);

  return createPortal(
    <div
      className="interview-selection"
      ref={ref}
      role="dialog"
      aria-label={`划词操作：${selection.text}`}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      <div className="interview-selection__head">
        <span className="interview-selection__term">{selection.text}</span>
        {isExisting ? (
          <span className="interview-selection__badge">已是词条</span>
        ) : null}
      </div>

      {answer.loading || answer.text || answer.error ? (
        <div className="interview-selection__answer">
          {answer.loading ? (
            <span className="interview-selection__loading">AI 正在解释…</span>
          ) : null}
          {answer.error ? (
            <span className="interview-selection__error">{answer.error}</span>
          ) : null}
          {answer.text ? <ExplainText text={answer.text} /> : null}
        </div>
      ) : isExisting ? (
        <p className="interview-selection__text">{existing?.short}</p>
      ) : null}

      {aliasError ? (
        <span className="interview-selection__error">{aliasError}</span>
      ) : null}

      <div className="interview-selection__ops">
        <Button
          className="interview-selection__add"
          type="primary"
          size="small"
          icon={<PlusCircleOutlined />}
          disabled={isExisting}
          onClick={() => {
            onAddTerm(selection);
            onClose();
          }}
        >
          {isExisting ? "已是词条" : "加为词条"}
        </Button>
        {/* 命中已有词条时，「加为词条」没有意义（会撞键），但「写得比它更深」
            是有意义的动作 —— 入口就在这里，走 AI 再生成一条 related 指回来 */}
        {isExisting ? (
          <Button
            className="interview-selection__supplement"
            size="small"
            icon={<FileAddOutlined />}
            onClick={() => {
              onSupplement(selection);
              onClose();
            }}
          >
            补充释义
          </Button>
        ) : null}
        {/* 库里那条词条的名字比划中的词长（模型换了叫法）：直接记成它的别名，
            比再生成一条同义词条更快，也不会在词表里留下两条几乎一样的词 */}
        {!isExisting && aliasOwner ? (
          <Tooltip
            title={`把「${selection.text}」记为词条「${aliasOwner.term}」的别名，正文里立刻能点开`}
          >
            <Button
              className="interview-selection__alias"
              size="small"
              icon={<TagsOutlined />}
              loading={aliasPending}
              onClick={() => onAddAlias?.(aliasOwner, selection.text)}
            >
              记为「{aliasOwner.term}」的别名
            </Button>
          </Tooltip>
        ) : null}
        <Button
          className="interview-selection__ask"
          size="small"
          icon={<BulbOutlined />}
          loading={answer.loading}
          onClick={() => onAskAi(selection)}
        >
          问 AI
        </Button>
        <Button
          className="interview-selection__close"
          type="text"
          size="small"
          onClick={onClose}
        >
          关闭
        </Button>
      </div>
    </div>,
    document.body,
  );
}
