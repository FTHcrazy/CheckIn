import { ENTITY_TYPE_META } from "../../novel-config";
import type { EntityType } from "../../types";
import "./index.scss";

interface TypeBadgeProps {
  type: EntityType;
  /** 紧凑型只显示一个短标签，用于卡片标题行 */
  compact?: boolean;
}

/**
 * 要素类型标签（设计方案 §06 Badge）
 *
 * 类型色在正文高亮、卡片头像、筛选 chips 三处共用同一组令牌，用户只需学一次。
 */
export default function TypeBadge({ type, compact = false }: TypeBadgeProps) {
  const meta = ENTITY_TYPE_META[type];

  return (
    <span
      className={`nv-badge${compact ? " nv-badge--compact" : ""}`}
      style={{ color: meta.color, background: meta.colorWeak }}
    >
      {meta.label}
    </span>
  );
}
