import { useEffect, useRef, useState } from "react";

/**
 * 弱提示气泡的「出现一次」调度
 *
 * 从 `GuideTooltip` 里抽出来，是因为 T-03（首次选中文字）的气泡没有可包裹的
 * 真实元素——它的锚点是运行时算出来的选区坐标，只能自己渲染一个定位锚点。
 * 两处都要同一套规则（只出现一次、超时自动收、作者一操作就撤），所以下沉成 hook。
 *
 * 三条硬规则（PRD FR-02）：
 * 1. 只出现一次 —— 是否「已看过」由 `consume` 判定并落盘，本 hook 不重复判
 * 2. 不拦截点击 —— 浮层 `pointer-events: none`（样式层保证），作者可直接无视
 * 3. 超时自动收 —— 停留 DWELL_MS 后淡出，不等待作者响应
 */

/** 气泡停留时长（毫秒） */
export const DWELL_MS = 6000;
/** 出现前的延迟：让目标元素先完成布局，避免气泡闪在错误位置 */
export const ENTER_DELAY_MS = 400;

export interface UseGuideBubbleOptions {
  /** 触发条件是否满足（如「首次产生非空选区」「该按钮已渲染」） */
  enabled: boolean;
  /**
   * 消费判定：返回 true 才显示。同步（带打字保护）或异步（读持久化记录）均可；
   * 异步版本应在返回 true 前自行落盘「已看过」，保证出现即记、不重复打扰。
   * 不传表示调用方已在外部判定过，只走展示调度。
   */
  consume?: () => boolean | Promise<boolean>;
}

export interface GuideBubble {
  open: boolean;
  /** 立即收起（作者主动操作时调用） */
  dismiss: () => void;
}

export function useGuideBubble({
  enabled,
  consume,
}: UseGuideBubbleOptions): GuideBubble {
  const [open, setOpen] = useState(false);

  // consume 放 ref：调用方多半传内联箭头函数，进 deps 会让定时器每次渲染都重置，
  // 结果就是气泡永远等不到 ENTER_DELAY_MS（编辑器每敲一个字都会重渲染）。
  const consumeRef = useRef(consume);
  useEffect(() => {
    consumeRef.current = consume;
  }, [consume]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let hideTimer: number | undefined;

    const timer = window.setTimeout(() => {
      void (async () => {
        const fn = consumeRef.current;
        if (fn) {
          const allowed = await fn();
          if (cancelled || !allowed) return;
        }
        setOpen(true);
        hideTimer = window.setTimeout(() => setOpen(false), DWELL_MS);
      })();
    }, ENTER_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, [enabled]);

  // 作者一动就让位：气泡不拦截点击，但既然已经开始操作，就不该继续挂着
  useEffect(() => {
    if (!open) return;
    const dismiss = (): void => setOpen(false);
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", dismiss);
    };
  }, [open]);

  return { open, dismiss: () => setOpen(false) };
}
