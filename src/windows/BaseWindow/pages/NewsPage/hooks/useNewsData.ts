import { useEffect, useMemo, useState } from "react";
import {
  SLACK_PLAN,
  WEEK_STATUS,
  fetchDailyNews,
  getDailyQuote,
  getTodayInfo,
  getUpcomingHolidays,
  type DailyNewsPayload,
  type HolidayCountdown,
  type NewsItem,
} from "../news";

/** NewsPage 视图模型：页面挂载时组装一次，当日不变 */
export interface NewsPageView {
  news: NewsItem[];
  loading: boolean;
  todayInfo: ReturnType<typeof getTodayInfo>;
  holidays: HolidayCountdown[];
  status: { status: string; tip: string };
  quote: string;
  plan: ReadonlyArray<{ time: string; thing: string }>;
  /** 当前进行中的摸鱼计划索引（-1 = 尚未开始） */
  activePlanIndex: number;
  /** 周 / 月 / 年进度（API 未提供时为 null，UI 隐藏） */
  progress: DailyNewsPayload["progress"];
  /** 是否工作日：null = 未知（UI 按周末本地推断） */
  workday: boolean | null;
}

/** fetch 完成前的占位载荷（进度 / 工作日未知，语录走本地轮换） */
const EMPTY_RESULT: DailyNewsPayload = {
  items: [],
  live: false,
  quote: null,
  progress: null,
  workday: null,
  lunarText: null,
};

/**
 * 拉取资讯（60s API 双端点 + 本地兜底）并组装右栏全部展示数据。
 * 资讯为异步加载；日期 / 倒计时 / 文案在挂载当天内不变，memo 一次即可。
 */
export function useNewsData(): NewsPageView {
  const [payload, setPayload] = useState<DailyNewsPayload>(EMPTY_RESULT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchDailyNews()
      .then((result) => {
        if (!mounted) return;
        setPayload(result);
        setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => {
    const today = new Date();
    const minutesNow = today.getHours() * 60 + today.getMinutes();
    let activePlanIndex = -1;
    SLACK_PLAN.forEach((slot, i) => {
      const [h, m] = slot.time.split(":").map(Number);
      if (h * 60 + m <= minutesNow) activePlanIndex = i;
    });
    const info = getTodayInfo(today);
    return {
      news: payload.items,
      loading,
      // 农历以摸鱼日报接口为准，接口未提供时用本地计算
      todayInfo: {
        ...info,
        lunarText: payload.lunarText ?? info.lunarText,
      },
      holidays: getUpcomingHolidays(today),
      status: WEEK_STATUS[today.getDay()],
      quote: payload.quote || getDailyQuote(today),
      plan: SLACK_PLAN,
      activePlanIndex,
      progress: payload.progress,
      workday: payload.workday,
    };
  }, [payload, loading]);
}
