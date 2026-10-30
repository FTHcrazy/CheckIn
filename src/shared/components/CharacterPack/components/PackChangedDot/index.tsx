import { formatRelativeTime } from "../../pack-utils";

interface PackChangedDotProps {
  /** 该条目最近一次改动时刻（0 / undefined = 从无改动记录） */
  updatedAt: number | undefined;
  /** 是否落在「刚改动」窗口内（调用方用 `api.isRecentlyChanged` 判定） */
  changed: boolean;
}

/**
 * 「刚改动」角标（REQ-028 / F-2）。
 *
 * 刻意做成**无文字的圆点**：属性 / 物品 / 技能三处行里都塞得下它，而
 * 「几时改的」交给 `title`（悬停才展开）—— 常驻一行「3 分钟前」会把本来就
 * 紧张的横向空间吃掉，而这是十几行里只该有少数几行出现的状态。
 *
 * `changed` 由调用方判定而不是组件自己算：时间窗与「已读底线」是面板级状态，
 * 组件自己去读会变成每个模块各存一份（24h 边界一到，有的亮有的不亮）。
 */
export default function PackChangedDot({ updatedAt, changed }: PackChangedDotProps) {
  if (!changed) return null;
  const at = updatedAt && updatedAt > 0 ? formatRelativeTime(updatedAt) : "";
  return (
    <span
      className="cpk-changed"
      role="img"
      aria-label="刚改动"
      title={at ? `${at}改动 · 24 小时后自动淡出` : "刚改动"}
    />
  );
}
