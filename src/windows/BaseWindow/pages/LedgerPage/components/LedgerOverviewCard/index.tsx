import { memo } from "react";
import type { LedgerSummary, LedgerTrendPoint } from "../../ledger-utils";
import { formatAmount } from "../../ledger-utils";
import LedgerTrendChart from "../LedgerTrendChart";
import "./index.scss";

interface LedgerOverviewCardProps {
  summary: LedgerSummary;
  points: readonly LedgerTrendPoint[];
  loading: boolean;
}

/** 总览卡：收入 / 支出 / 结余 三统计 + 近 30 天趋势 */
function LedgerOverviewCard({ summary, points, loading }: LedgerOverviewCardProps) {
  if (loading) {
    return (
      <div className="ld-overview">
        <div className="ld-overview__skeleton" />
        <div className="ld-overview__skeleton ld-overview__skeleton--chart" />
      </div>
    );
  }

  return (
    <div className="ld-overview">
      <div className="ld-overview__stats">
        <div className="ld-overview__stat">
          <span className="ld-overview__stat-label">收入</span>
          <span className="ld-overview__stat-value is-income">{formatAmount(summary.income)}</span>
        </div>
        <div className="ld-overview__stat">
          <span className="ld-overview__stat-label">支出</span>
          <span className="ld-overview__stat-value is-expense">
            {formatAmount(summary.expense)}
          </span>
        </div>
        <div className="ld-overview__stat">
          <span className="ld-overview__stat-label">{summary.balance >= 0 ? "结余" : "超支"}</span>
          <span
            className={`ld-overview__stat-value ${summary.balance >= 0 ? "is-income" : "is-expense"}`}
          >
            {formatAmount(summary.balance)}
          </span>
        </div>
      </div>
      <LedgerTrendChart points={points} />
    </div>
  );
}

// 三统计 + 趋势图只随流水变化，筛选关键词不该让它重画
export default memo(LedgerOverviewCard);
