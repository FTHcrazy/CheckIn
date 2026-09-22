import { useMemo, useState } from "react";
import type { LedgerTrendPoint } from "../../ledger-utils";
import { formatAmount } from "../../ledger-utils";
import "./index.scss";

interface LedgerTrendChartProps {
  points: readonly LedgerTrendPoint[];
}

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 96;
const PAD_Y = 8;

/**
 * 近 30 天支出趋势（纯 SVG，不引入图表库）
 * 横向用 preserveAspectRatio="none" 拉伸，线段用 vector-effect 保持线宽不被压扁
 */
export default function LedgerTrendChart({ points }: LedgerTrendChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const max = Math.max(1, ...points.map((point) => Math.max(point.expense, point.income)));
    const step = points.length > 1 ? VIEW_WIDTH / (points.length - 1) : VIEW_WIDTH;
    const coords = points.map((point, index) => ({
      x: index * step,
      y: VIEW_HEIGHT - PAD_Y - (point.expense / max) * (VIEW_HEIGHT - PAD_Y * 2),
    }));
    const line = coords.map((coord) => `${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" ");
    const area =
      coords.length > 0
        ? `M0,${VIEW_HEIGHT} L${line.split(" ").join(" L")} L${VIEW_WIDTH},${VIEW_HEIGHT} Z`
        : "";
    return { coords, line, area, max };
  }, [points]);

  if (points.length === 0) {
    return <div className="ld-trend ld-trend--empty">暂无趋势数据</div>;
  }

  const active = hover !== null ? points[hover] : null;
  const step = points.length > 1 ? VIEW_WIDTH / (points.length - 1) : VIEW_WIDTH;

  return (
    <div className="ld-trend">
      <svg
        className="ld-trend__svg"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="近 30 天支出趋势"
      >
        <defs>
          <linearGradient id="ld-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--app-primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--app-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geometry.area} fill="url(#ld-trend-fill)" />
        <polyline
          points={geometry.line}
          fill="none"
          stroke="var(--app-primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((point, index) => (
          <rect
            key={point.date}
            x={index * step - step / 2}
            y={0}
            width={step}
            height={VIEW_HEIGHT}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover((current) => (current === index ? null : current))}
          />
        ))}
      </svg>

      {active && hover !== null ? (
        <div
          className="ld-trend__tip"
          style={{ left: `${((hover * step) / VIEW_WIDTH) * 100}%` }}
        >
          <span className="ld-trend__tip-date">{active.date}</span>
          <span className="ld-trend__tip-row">支出 {formatAmount(active.expense)}</span>
          <span className="ld-trend__tip-row">收入 {formatAmount(active.income)}</span>
        </div>
      ) : null}
    </div>
  );
}
