import { memo, useMemo, useState } from "react";
import { Segmented } from "antd";
import type { LedgerCategorySlice } from "../../ledger-utils";
import { formatAmount } from "../../ledger-utils";
import "./index.scss";

interface LedgerCategoryPieProps {
  slices: readonly LedgerCategorySlice[];
  total: number;
  /** 当前统计口径：支出 / 收入 */
  pieType: "expense" | "income";
  onPieTypeChange: (type: "expense" | "income") => void;
}

const SIZE = 132;
const CENTER = SIZE / 2;
const RADIUS = 54;
const STROKE = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** 扇区间隙（px，沿周长） */
const GAP = 2;

/**
 * 分类占比环图（纯 SVG）+ 图例
 * hover 图例 → 对应扇区高亮，其余降到 28% 透明度
 */
function LedgerCategoryPie({
  slices,
  total,
  pieType,
  onPieTypeChange,
}: LedgerCategoryPieProps) {
  const [hover, setHover] = useState<string | null>(null);

  const segments = useMemo(() => {
    // 全函数式推导（切片数 ≤ 8，前缀和用 slice + reduce 不影响性能）
    const raws = slices.map((slice) => slice.ratio * CIRCUMFERENCE);
    const withGap = slices.length > 1 ? GAP : 0;
    return slices.map((slice, index) => ({
      slice,
      length: Math.max((raws[index] ?? 0) - withGap, 0.5),
      offset: raws.slice(0, index).reduce((sum, value) => sum + value, 0),
    }));
  }, [slices]);

  const active = hover ? slices.find((slice) => slice.id === hover) ?? null : null;
  const centerValue = active ? active.amount : total;
  const centerLabel = active ? active.name : pieType === "expense" ? "支出合计" : "收入合计";
  const centerRatio = active ? `${Math.round(active.ratio * 100)}%` : "";

  return (
    <div className="ld-pie">
      <div className="ld-pie__head">
        <span className="ld-pie__title">分类占比</span>
        <Segmented<"expense" | "income">
          size="small"
          value={pieType}
          options={[
            { label: "支出", value: "expense" },
            { label: "收入", value: "income" },
          ]}
          onChange={onPieTypeChange}
          aria-label="占比口径"
        />
      </div>

      <div className="ld-pie__body">
        <svg
          className="ld-pie__chart"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label="分类占比环图"
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="var(--app-surface-alt)"
            strokeWidth={STROKE}
          />
          <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
            {segments.map(({ slice, length, offset }) => (
              <circle
                key={slice.id}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={`var(${slice.color})`}
                strokeWidth={hover && hover !== slice.id ? STROKE - 4 : STROKE}
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={-offset}
                opacity={hover && hover !== slice.id ? 0.28 : 1}
              />
            ))}
          </g>
          <text className="ld-pie__center-value" x={CENTER} y={CENTER - 2} textAnchor="middle">
            {formatAmount(centerValue)}
          </text>
          <text className="ld-pie__center-label" x={CENTER} y={CENTER + 16} textAnchor="middle">
            {centerRatio ? `${centerLabel} ${centerRatio}` : centerLabel}
          </text>
        </svg>

        <ul className="ld-pie__legend">
          {slices.length === 0 ? (
            <li className="ld-pie__legend-empty">暂无数据</li>
          ) : (
            slices.map((slice) => (
              <li
                key={slice.id}
                className={`ld-pie__legend-item${hover === slice.id ? " is-active" : ""}`}
                onMouseEnter={() => setHover(slice.id)}
                onMouseLeave={() => setHover((current) => (current === slice.id ? null : current))}
              >
                <span className="ld-pie__dot" style={{ background: `var(${slice.color})` }} />
                <span className="ld-pie__name">{slice.name}</span>
                <span className="ld-pie__amount">{formatAmount(slice.amount)}</span>
                <span className="ld-pie__ratio">{Math.round(slice.ratio * 100)}%</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

// 环图与图例只随流水 / 口径变化，敲关键词不该让每段弧重算一遍
export default memo(LedgerCategoryPie);
