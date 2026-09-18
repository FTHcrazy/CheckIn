import {
  CalendarOutlined,
  FireOutlined,
  ReadOutlined,
  RocketOutlined,
  SmileOutlined,
} from "@ant-design/icons";
import type { HolidayCountdown, ProgressItem } from "../../news";
import "./index.scss";

interface NewsAsideProps {
  dateText: string;
  weekText: string;
  lunarText: string;
  status: { status: string; tip: string };
  /** 工作日状态：null = API 未提供，不展示徽标 */
  workday: boolean | null;
  /** 周 / 月 / 年进度，null = API 未提供，整组隐藏 */
  progress: {
    week: ProgressItem | null;
    month: ProgressItem | null;
    year: ProgressItem | null;
  } | null;
  holidays: HolidayCountdown[];
  plan: ReadonlyArray<{ time: string; thing: string }>;
  activePlanIndex: number;
  quote: string;
}

/** 天数徽标文案：0 当天 / 1 明天 / 其余 N 天 */
function daysLabel(days: number): string {
  if (days === 0) return "就是今天";
  if (days === 1) return "明天";
  return `${days} 天`;
}

/** 进度条行：过滤掉 API 未提供的槽位 */
function buildProgressRows(progress: NonNullable<NewsAsideProps["progress"]>) {
  const rows: { key: string; label: string; item: ProgressItem }[] = [];
  const candidates = [
    { key: "week", label: "本周进度", item: progress.week },
    { key: "month", label: "本月进度", item: progress.month },
    { key: "year", label: "本年进度", item: progress.year },
  ];
  for (const row of candidates) {
    if (row.item) {
      // push 新对象：保留 row.item 的窄化类型（直接 push row 会带回 null）
      rows.push({ key: row.key, label: row.label, item: row.item });
    }
  }
  return rows;
}

/** 右栏：摸鱼日报风格栏目（日期 / 状态 / 倒计时 / 进度 / 摸鱼计划 / 语录） */
export default function NewsAside({
  dateText,
  weekText,
  lunarText,
  status,
  workday,
  progress,
  holidays,
  plan,
  activePlanIndex,
  quote,
}: NewsAsideProps) {
  const progressRows = progress ? buildProgressRows(progress) : [];

  return (
    <aside className="news-aside" aria-label="摸鱼日报">
      {/* 日期卡 */}
      <div className="news-aside__card news-aside__date">
        <div>
          <p className="news-aside__date-main">{dateText}</p>
          <p className="news-aside__date-week">{weekText}</p>
        </div>
        <span className="news-aside__lunar">{lunarText}</span>
      </div>

      {/* 工作状态卡 */}
      <div className="news-aside__card">
        <h3 className="news-aside__card-title">
          <SmileOutlined className="news-aside__card-icon" />
          打鱼状态
        </h3>
        <p className="news-aside__status">{status.status}</p>
        {workday !== null && (
          <span className="news-aside__workday">
            {workday ? "今天是工作日" : "今天是休息日"}
          </span>
        )}
        <p className="news-aside__status-tip">{status.tip}</p>
        {progressRows.length > 0 && (
          <div className="news-aside__progress">
            {progressRows.map((row) => (
              <div className="news-aside__progress-row" key={row.key}>
                <span className="news-aside__progress-label">{row.label}</span>
                <div className="news-aside__progress-bar">
                  <div
                    className="news-aside__progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, row.item.percentage))}%`,
                    }}
                  />
                </div>
                <span className="news-aside__progress-value">
                  {Math.round(row.item.percentage)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 假期倒计时卡 */}
      <div className="news-aside__card">
        <h3 className="news-aside__card-title">
          <RocketOutlined className="news-aside__card-icon" />
          假期倒计时
        </h3>
        <ul className="news-aside__holidays">
          {holidays.map((h) => {
            const imminent = h.days <= 1;
            return (
              <li key={h.date} className="news-aside__holiday">
                <span className="news-aside__holiday-name">{h.name}</span>
                <span className="news-aside__holiday-date">
                  {h.date.slice(5).replace("-", "/")}
                </span>
                <span
                  className={
                    imminent
                      ? "news-aside__holiday-days is-imminent"
                      : "news-aside__holiday-days"
                  }
                >
                  {daysLabel(h.days)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 摸鱼计划表 */}
      <div className="news-aside__card">
        <h3 className="news-aside__card-title">
          <CalendarOutlined className="news-aside__card-icon" />
          摸鱼计划表
        </h3>
        <ul className="news-aside__plan">
          {plan.map((slot, i) => {
            const active = i === activePlanIndex;
            return (
              <li
                key={slot.time}
                className={
                  active
                    ? "news-aside__plan-item is-active"
                    : "news-aside__plan-item"
                }
              >
                <span className="news-aside__plan-time">{slot.time}</span>
                <span className="news-aside__plan-thing">{slot.thing}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 每日语录卡 */}
      <div className="news-aside__card news-aside__quote">
        <h3 className="news-aside__card-title">
          <ReadOutlined className="news-aside__card-icon" />
          摸鱼语录
        </h3>
        <p className="news-aside__quote-text">
          <FireOutlined className="news-aside__quote-mark" aria-hidden="true" />
          {quote}
        </p>
      </div>
    </aside>
  );
}
