import { Spin } from "antd";
import type { NewsItem } from "../../news";
import "./index.scss";

interface NewsListProps {
  items: NewsItem[];
  loading: boolean;
}

/** 热度前三名的徽标配色（金银铜位次感，走主题 accent） */
const RANK_TONES = ["is-top1", "is-top2", "is-top3"];

/** 左栏：今日热点资讯 Top 10 */
export default function NewsList({ items, loading }: NewsListProps) {
  return (
    <section className="news-list" aria-label="今日热点资讯">
      <header className="news-list__head">
        <h1 className="news-list__title">今日热点</h1>
        <p className="news-list__sub">最新最热资讯 · 每日十条</p>
      </header>

      {loading ? (
        <div className="news-list__loading">
          <Spin size="large" />
        </div>
      ) : (
        <ol className="news-list__items">
          {items.map((item, index) => (
            <li key={item.id} className="news-list__item">
              <span
                className={`news-list__rank ${RANK_TONES[index] ?? ""}`}
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="news-list__body">
                <h2 className="news-list__item-title">{item.title}</h2>
                {item.summary && (
                  <p className="news-list__summary">{item.summary}</p>
                )}
                <div className="news-list__meta">
                  <span className="news-list__source">{item.source}</span>
                  {item.time && (
                    <>
                      <span className="news-list__dot" aria-hidden="true" />
                      <span>{item.time}</span>
                    </>
                  )}
                  <span className="news-list__heat">
                    {item.heat}° 热度
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
