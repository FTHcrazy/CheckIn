import { Button } from "antd";
import "./index.scss";

interface LedgerEmptyProps {
  /** 是否有筛选条件：有筛选时的空态文案与 CTA 不同 */
  filtered: boolean;
  onCreate: () => void;
}

/** 空状态：无记录 / 无筛选结果 */
export default function LedgerEmpty({ filtered, onCreate }: LedgerEmptyProps) {
  return (
    <div className="ld-empty">
      <svg className="ld-empty__art" viewBox="0 0 120 96" role="img" aria-label="暂无账目">
        <rect x="18" y="26" width="84" height="54" rx="10" fill="var(--app-surface-alt)" />
        <rect x="18" y="26" width="84" height="14" rx="10" fill="var(--app-primary-weak)" />
        <rect x="34" y="52" width="34" height="6" rx="3" fill="var(--app-border-strong)" />
        <rect x="34" y="64" width="52" height="6" rx="3" fill="var(--app-border)" />
        <circle cx="92" cy="20" r="12" fill="var(--app-accent-amber-weak)" />
        <path
          d="M92 14v12M86 20h12"
          stroke="var(--app-accent-amber)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <p className="ld-empty__title">{filtered ? "没有匹配的账目" : "还没有记账记录"}</p>
      <p className="ld-empty__hint">
        {filtered ? "试试调整关键词或筛选条件" : "3 步记第一笔：金额 → 分类 → 保存"}
      </p>
      {filtered ? null : (
        <Button type="primary" onClick={onCreate}>
          记第一笔
        </Button>
      )}
    </div>
  );
}
