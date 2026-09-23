import { memo, useState } from "react";
import { DatePicker, Dropdown, Popover, Segmented } from "antd";
import type { MenuProps } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, EllipsisOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { LedgerPeriod } from "../../ledger-utils";
import { formatAmount, formatMoney } from "../../ledger-utils";
import "./index.scss";

interface LedgerPeriodBarProps {
  period: LedgerPeriod;
  range: { start: string; end: string };
  /** 结余（正=结余，负=超支） */
  balance: number;
  /** 支出环比（0–1 小数）；null 表示基期无数据 */
  expenseGrowth: number | null;
  onPeriodChange: (period: LedgerPeriod) => void;
  onRangeChange: (range: { start: string; end: string }) => void;
}

const PERIOD_OPTIONS: { label: string; value: LedgerPeriod }[] = [
  { label: "本月", value: "month" },
  { label: "本季", value: "quarter" },
  { label: "本年", value: "year" },
  { label: "自选", value: "custom" },
];

/** 更多菜单：M3 的导入 / 导出入口，先占位禁用 */
const MORE_ITEMS: MenuProps["items"] = [
  { key: "export", label: "导出账目", disabled: true },
  { key: "import", label: "导入账目", disabled: true },
];

/**
 * 顶部周期条：周期切换 + 结余大数字 + 支出环比
 * 「自选」走 Popover 弹层（RangePicker），「更多」走 Dropdown 弹层
 */
function LedgerPeriodBar({
  period,
  range,
  balance,
  expenseGrowth,
  onPeriodChange,
  onRangeChange,
}: LedgerPeriodBarProps) {
  const [customOpen, setCustomOpen] = useState(false);

  const rangeText =
    period === "custom"
      ? `${range.start} 至 ${range.end}`
      : `${dayjs(range.start).format("YYYY年M月")}`;

  const handlePeriod = (value: LedgerPeriod): void => {
    if (value === "custom") {
      setCustomOpen(true);
      return;
    }
    onPeriodChange(value);
  };

  const handleRangePick = (dates: (Dayjs | null)[] | null): void => {
    const [start, end] = dates ?? [];
    if (!start || !end) return;
    onRangeChange({ start: start.format("YYYY-MM-DD"), end: end.format("YYYY-MM-DD") });
    setCustomOpen(false);
  };

  const rising = expenseGrowth !== null && expenseGrowth > 0;
  const growthText =
    expenseGrowth === null
      ? "暂无对比"
      : `较上期 ${Math.abs(expenseGrowth) < 0.001 ? "持平" : `${rising ? "↑" : "↓"}${formatMoney(Math.abs(expenseGrowth) * 100)}%`}`;

  return (
    <div className="ld-topbar">
      <div className="ld-topbar__left">
        <Segmented<LedgerPeriod>
          value={period}
          options={PERIOD_OPTIONS}
          onChange={(value) => handlePeriod(value)}
          aria-label="统计周期"
        />
        <Popover
          open={customOpen}
          onOpenChange={setCustomOpen}
          trigger="click"
          placement="bottomLeft"
          content={
            <div className="ld-topbar__range">
              <DatePicker.RangePicker
                value={[dayjs(range.start), dayjs(range.end)]}
                onChange={(dates) => handleRangePick(dates)}
                allowClear={false}
              />
            </div>
          }
        >
          <span className="ld-topbar__pill" role="button" tabIndex={0}>
            {rangeText}
          </span>
        </Popover>
      </div>

      <div className="ld-topbar__right">
        <div className="ld-topbar__balance">
          <span className="ld-topbar__balance-label">{balance >= 0 ? "结余" : "超支"}</span>
          <span className={`ld-topbar__balance-value${balance < 0 ? " is-negative" : ""}`}>
            {formatAmount(balance)}
          </span>
        </div>
        <span
          className={`ld-topbar__growth${
            expenseGrowth === null ? " is-flat" : rising ? " is-up" : " is-down"
          }`}
        >
          {expenseGrowth !== null && Math.abs(expenseGrowth) >= 0.001 ? (
            rising ? (
              <ArrowUpOutlined />
            ) : (
              <ArrowDownOutlined />
            )
          ) : null}
          {growthText}
        </span>
        <Dropdown menu={{ items: MORE_ITEMS }} placement="bottomRight" trigger={["click"]}>
          <button type="button" className="ld-topbar__more" aria-label="更多操作">
            <EllipsisOutlined />
          </button>
        </Dropdown>
      </div>
    </div>
  );
}

// 周期条挂着 RangePicker 弹层：筛选框每敲一个字都不该把它重渲染一遍
export default memo(LedgerPeriodBar);
