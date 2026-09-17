import type { ReactNode } from "react";
import { RightOutlined } from "@ant-design/icons";
import "./index.scss";

export type FeatureTone =
  | "blue"
  | "purple"
  | "amber"
  | "teal"
  | "rose"
  | "orange";

const TONE_VARS: Record<FeatureTone, { fg: string; bg: string }> = {
  blue: { fg: "var(--app-accent-blue)", bg: "var(--app-accent-blue-weak)" },
  purple: { fg: "var(--app-accent-purple)", bg: "var(--app-accent-purple-weak)" },
  amber: { fg: "var(--app-accent-amber)", bg: "var(--app-accent-amber-weak)" },
  teal: { fg: "var(--app-accent-teal)", bg: "var(--app-accent-teal-weak)" },
  rose: { fg: "var(--app-accent-rose)", bg: "var(--app-accent-rose-weak)" },
  orange: { fg: "var(--app-accent-orange)", bg: "var(--app-accent-orange-weak)" },
};

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  desc: string;
  tone: FeatureTone;
  onClick: () => void;
}

/** 功能入口卡：图标 + 标题 + 说明，整卡可点击进入对应模块 */
export default function FeatureCard({
  icon,
  title,
  desc,
  tone,
  onClick,
}: FeatureCardProps) {
  const vars = TONE_VARS[tone];

  return (
    <button type="button" className="feature-card" onClick={onClick}>
      <span
        className="feature-card__icon"
        style={{ color: vars.fg, background: vars.bg }}
      >
        {icon}
      </span>
      <span className="feature-card__body">
        <span className="feature-card__title">{title}</span>
        <span className="feature-card__desc">{desc}</span>
      </span>
      <span className="feature-card__enter">
        进入
        <RightOutlined />
      </span>
    </button>
  );
}
