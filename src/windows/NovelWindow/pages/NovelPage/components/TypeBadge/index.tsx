import { useEntityTypeMeta } from "../../hooks/entity-types-context";
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
 * 自定义类型（ct-*）的 meta 由 EntityTypeContext 派生（R23）。
 */
export default function TypeBadge({ type, compact = false }: TypeBadgeProps) {
  const { metaOf } = useEntityTypeMeta();
  const meta = metaOf(type);

  return (
    <span
      className={`nv-badge${compact ? " nv-badge--compact" : ""}`}
      style={{ color: meta.color, background: meta.colorWeak }}
    >
      {meta.label}
    </span>
  );
}
