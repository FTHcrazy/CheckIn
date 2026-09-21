import type { ReactNode } from "react";
import "./index.scss";

export interface ShelfStatItem {
  key: string;
  icon: ReactNode;
  /** 语义色：决定图标底色与字色（弱底 + 主色，随四主题切换） */
  tone: "blue" | "green" | "orange" | "purple";
  value: string;
  label: string;
}

interface ShelfStatsProps {
  items: ShelfStatItem[];
}

/** 统计条（R32）：累计作品 / 累计字数 / 今日新增 / 连续码字 */
export default function ShelfStats({ items }: ShelfStatsProps) {
  return (
    <div className="bs-stats">
      {items.map((item) => (
        <div className="bs-stats__card" key={item.key}>
          <span className={`bs-stats__icon bs-stats__icon--${item.tone}`}>{item.icon}</span>
          <div className="bs-stats__meta">
            <span className="bs-stats__value">{item.value}</span>
            <span className="bs-stats__label">{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
