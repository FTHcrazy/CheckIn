import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "antd";
import { BulbOutlined, PlusCircleOutlined } from "@ant-design/icons";
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
  onAskAi,
  onClose,
  answer,
  onClearAnswer,
}: SelectionTermPopoverProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  // 换了一个选区就复位：否则上一次的解释会挂在新的词下面
  useEffect(() => {
    setReady(false);
    onClearAnswer();
    if (!selection) return;
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
    // `onClearAnswer` 是 useCallback 稳定的，selection 换对象才需要重跑
  }, [selection, onClearAnswer]);

  const position = useMemo(() => {
    if (!selection) return null;
    const { anchor } = selection;
    const height = answer.text ? POPOVER_ESTIMATED_HEIGHT + 120 : POPOVER_ESTIMATED_HEIGHT;
    const below = anchor.bottom + GAP;
    const flip = below + height > window.innerHeight - EDGE;
    const top = flip ? Math.max(EDGE, anchor.top - GAP - height) : below;
    const left = Math.min(
      Math.max(EDGE, anchor.left),
      Math.max(EDGE, window.innerWidth - POPOVER_WIDTH - EDGE),
    );
    return { top, left };
  }, [selection, answer.text]);

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
          {answer.loading ? <span className="interview-selection__loading">AI 正在解释…</span> : null}
          {answer.error ? (
            <span className="interview-selection__error">{answer.error}</span>
          ) : null}
          {answer.text ? <p className="interview-selection__text">{answer.text}</p> : null}
        </div>
      ) : isExisting ? (
        <p className="interview-selection__text">{existing?.short}</p>
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
