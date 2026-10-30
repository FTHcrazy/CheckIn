/**
 * 跨窗口的展示格式化纯函数
 *
 * 放这里的判据是「两个以上使用方」：这几个函数此前在 novel 窗口里各存了
 * 2~3 份实现（书架页一份、编辑器一份、行囊一份），改文案口径时要连改三处，
 * 漏一处就是「同一个时间戳在三个面板显示成三种样子」。
 *
 * 相对时间的**分支口径**三家确实不同（超过一天后：编辑器显示「10月8日」、
 * 书架显示「今天 14:20 / 昨天 …」、行囊显示「3 天前」），所以抽的是
 * 「分钟 / 小时」这段公共阶梯，超过一天的部分由各自传入 `beyondDay` 决定。
 */

export interface RelativeTimeOptions {
  /** 时间戳为空（0 / undefined）时的占位文案，不给则按普通时间计算 */
  empty?: string;
  /** 超过 24 小时后的格式化（默认 `M月D日`） */
  beyondDay?: (timestamp: number, now: number) => string;
}

/** 千分位：1234567 → "1,234,567"（负数与小数取整到 0） */
export function formatThousands(value: number): string {
  return String(Math.max(0, Math.round(value))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 交给 beyondDay */
export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now(),
  options: RelativeTimeOptions = {},
): string {
  if (!timestamp && options.empty) return options.empty;
  const diff = now - timestamp;
  // 时钟回拨、未来时间戳都当「刚刚」，不显示负数
  if (diff < 60_000) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  if (options.beyondDay) return options.beyondDay(timestamp, now);
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
