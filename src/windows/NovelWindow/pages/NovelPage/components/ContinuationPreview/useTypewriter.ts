import { useEffect, useState } from "react";

/**
 * 打字机上屏（REQ-058）
 *
 * ## 为什么需要
 *
 * 续写确实走的是 SSE 流式，但**「网络是一块一块到」不等于「眼睛看到逐字」**：
 * 模型服务商一次可能吐 30–80 个字符，一帧就把半段糊上屏，在作者看来就是
 * 「不是流式，一段一段地蹦」。更糟的是首块：等 `ai-stream://` 建连期间到达的
 * 数据会合并成一个大 delta，一开屏就是一大段。
 *
 * 这里把已到达的文本按固定节奏**逐个揭示**：落后少时一字一字走（有打字感），
 * 落后多时按比例追赶（不会让作者等一屏文字慢慢爬完）。已经到达的文字永远不会
 * 被丢掉，最坏情况只是「追上所需的时间」。
 */

/** 每帧间隔（ms）：24ms ≈ 40 字/秒，比正常阅读速度略慢，看得出在写 */
export const TYPEWRITER_TICK_MS = 24;
/** 落后不超过这个字数时，一字一字走（保持打字感） */
export const TYPEWRITER_SLOW_LAG = 8;
/** 落后超过阈值后按 `lag / 该值` 追赶 */
export const TYPEWRITER_CATCH_UP_DIVISOR = 5;

/**
 * 下一次揭示的字符数（纯函数，便于单测）。
 *
 * 渐近追赶：落后越多步长越大，因此无论模型一次吐多少字，追上时间都是同量级，
 * 不会出现「吐了一千字，进度条要走半分钟」。
 */
export function nextRevealCount(shown: number, total: number): number {
  if (shown >= total) return total;
  const lag = total - shown;
  const step =
    lag > TYPEWRITER_SLOW_LAG ? Math.ceil(lag / TYPEWRITER_CATCH_UP_DIVISOR) : 1;
  return Math.min(total, shown + Math.max(1, step));
}

/**
 * 返回「当前应该显示的前缀」。
 *
 * @param full 已经收到的完整文本（流式期间会不断变长）
 */
export function useTypewriter(full: string): { shown: string; revealing: boolean } {
  const [count, setCount] = useState(0);

  // 重试 / 换位置时文本会先清空再重新长出来：游标跟着收回去，
  // 否则新内容会从「上一轮的字数」开始显示，前半段永远看不到
  useEffect(() => {
    setCount((prev) => (full.length < prev ? full.length : prev));
  }, [full]);

  useEffect(() => {
    if (count >= full.length) return;
    const timer = window.setTimeout(() => {
      setCount((prev) => nextRevealCount(Math.min(prev, full.length), full.length));
    }, TYPEWRITER_TICK_MS);
    return () => window.clearTimeout(timer);
  }, [count, full.length]);

  const visible = Math.min(count, full.length);
  return { shown: full.slice(0, visible), revealing: visible < full.length };
}
