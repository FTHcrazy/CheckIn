import Page from "@/shared/components/Page";
import NewsList from "./components/NewsList";
import NewsAside from "./components/NewsAside";
import { useNewsData } from "./hooks/useNewsData";
import "./index.scss";

/**
 * 今日资讯页（承接首页 NEWS 海报的跳转）：
 * 左栏为当日热点资讯 Top 10，右栏为摸鱼日报风格栏目
 * （日期 / 打鱼状态 / 假期倒计时 / 摸鱼计划表 / 每日语录）。
 */
export default function NewsPage() {
  const view = useNewsData();

  return (
    <Page>
      <div className="news-page">
        <NewsList items={view.news} loading={view.loading} />
        <NewsAside
          dateText={view.todayInfo.dateText}
          weekText={view.todayInfo.weekText}
          lunarText={view.todayInfo.lunarText}
          status={view.status}
          workday={view.workday}
          progress={view.progress}
          holidays={view.holidays}
          plan={view.plan}
          activePlanIndex={view.activePlanIndex}
          quote={view.quote}
        />
      </div>
    </Page>
  );
}
