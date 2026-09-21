import type { ReactNode } from "react";
import { CheckOutlined } from "@ant-design/icons";
import "./index.scss";

interface MigrationScopeCardProps {
  icon: ReactNode;
  title: string;
  desc: string;
  /** 是否已勾选 */
  active: boolean;
  onToggle: () => void;
}

/** 可勾选的迁移范围卡：整卡点击切换选中态 */
export default function MigrationScopeCard({
  icon,
  title,
  desc,
  active,
  onToggle,
}: MigrationScopeCardProps) {
  return (
    <button
      type="button"
      className={active ? "migration-scope-card is-active" : "migration-scope-card"}
      onClick={onToggle}
      aria-pressed={active}
    >
      <span className="migration-scope-card__icon">{icon}</span>
      <span className="migration-scope-card__body">
        <span className="migration-scope-card__title">{title}</span>
        <span className="migration-scope-card__desc">{desc}</span>
      </span>
      <span className="migration-scope-card__check" aria-hidden="true">
        <CheckOutlined />
      </span>
    </button>
  );
}
