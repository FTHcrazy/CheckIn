import dayjs from "dayjs";
import { Lunar } from "lunar-typescript";

/**
 * NewsPage 页面本地数据层：假期倒计时（公历规则 + 农历年表）、
 * 摸鱼日报文案（状态 / 计划表 / 语录）、日期卡组装。
 *
 * 60s API 数据层（fetchDailyNews / NewsItem / SAMPLE_NEWS 等）已上移
 * `@/shared/services/news`（HomePage 探活与 NewsPage 展示共用），
 * 此处 re-export 保持页面内 import 路径稳定。
 */

export { MAX_NEWS, SAMPLE_NEWS, fetchDailyNews, mapDaily60s } from "@/shared/services/news";
export type {
  Daily60sData,
  DailyNewsPayload,
  MoyuData,
  NewsItem,
  ProgressItem,
} from "@/shared/services/news";

/* ───────────────────────── 假期倒计时 ───────────────────────── */

/** 假期倒计时条目 */
export interface HolidayCountdown {
  /** 节日名 */
  name: string;
  /** 公历日期 "YYYY-MM-DD" */
  date: string;
  /** 距今天数（0 = 就是今天） */
  days: number;
}

/** 公历固定节日（月-日规则） */
const SOLAR_HOLIDAYS: ReadonlyArray<{
  name: string;
  month: number;
  day: number;
}> = [
  { name: "元旦", month: 1, day: 1 },
  { name: "劳动节", month: 5, day: 1 },
  { name: "国庆节", month: 10, day: 1 },
];

/** 农历节日公历日期年表（逐年来回浮动，硬编码最可靠；过期年份请追加） */
const LUNAR_HOLIDAY_DATES: ReadonlyArray<{
  name: string;
  date: string;
}> = [
  { name: "中秋", date: "2026-09-25" },
  { name: "国庆节", date: "2026-10-01" },
  { name: "元旦", date: "2027-01-01" },
  { name: "春节", date: "2027-02-06" },
  { name: "清明", date: "2027-04-05" },
  { name: "劳动节", date: "2027-05-01" },
  { name: "端午", date: "2027-06-09" },
  { name: "中秋", date: "2027-09-15" },
  { name: "春节", date: "2028-01-26" },
  { name: "清明", date: "2028-04-04" },
  { name: "劳动节", date: "2028-05-01" },
  { name: "端午", date: "2028-05-28" },
  { name: "中秋", date: "2028-10-03" },
  { name: "春节", date: "2029-02-13" },
  { name: "清明", date: "2029-04-04" },
  { name: "劳动节", date: "2029-05-01" },
  { name: "端午", date: "2029-06-16" },
  { name: "中秋", date: "2029-09-22" },
  { name: "春节", date: "2030-02-03" },
  { name: "清明", date: "2030-04-05" },
  { name: "劳动节", date: "2030-05-01" },
  { name: "端午", date: "2030-06-05" },
  { name: "中秋", date: "2030-09-12" },
];

/** 倒计时展示条数（右栏空间固定取最近 4 个） */
export const HOLIDAY_COUNT = 4;

/**
 * 计算最近的假期倒计时（含今天，按日期升序取前 HOLIDAY_COUNT 个）。
 *
 * @param today 任意时刻的“今天”，纯函数便于测试
 */
export function getUpcomingHolidays(today: Date): HolidayCountdown[] {
  const todayDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const candidates: { name: string; date: string }[] = [];
  // 公历规则：今年 + 明年各生成一遍，跨年自然覆盖
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    for (const h of SOLAR_HOLIDAYS) {
      candidates.push({
        name: h.name,
        date: `${year}-${String(h.month).padStart(2, "0")}-${String(h.day).padStart(2, "0")}`,
      });
    }
  }
  candidates.push(...LUNAR_HOLIDAY_DATES);

  const result: HolidayCountdown[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const target = new Date(`${c.date}T00:00:00`);
    const diffDays = Math.round(
      (target.getTime() - todayDay.getTime()) / 86_400_000,
    );
    // 已过去的跳过；同一天只留一条（公历规则可能与年表重复）
    if (diffDays < 0 || seen.has(c.date)) continue;
    seen.add(c.date);
    result.push({ name: c.name, date: c.date, days: diffDays });
  }

  result.sort((a, b) => a.date.localeCompare(b.date));
  return result.slice(0, HOLIDAY_COUNT);
}

/* ───────────────────────── 摸鱼日报文案 ───────────────────────── */

/** 按星期轮换的打鱼状态（index = getDay()，0 = 周日） */
export const WEEK_STATUS: ReadonlyArray<{ status: string; tip: string }> = [
  { status: "休渔期", tip: "今天是周日，好好休息，别想工作的事。" },
  { status: "打鱼日", tip: "周一开工，先把最难的事干了，后面全是顺路。" },
  { status: "打鱼日", tip: "周二状态在线，适合攻坚与代码评审。" },
  { status: "晒网日", tip: "周三节奏放缓，梳理进度，别硬撑。" },
  { status: "打鱼日", tip: "周四冲一冲，把周内目标清到大半。" },
  { status: "晒网日", tip: "周五收尾日，整理周报，早点下班。" },
  { status: "休渔期", tip: "周六属于自己，出门走走，给灵感充电。" },
];

/** 摸鱼计划表：一日时间轴 */
export const SLACK_PLAN: ReadonlyArray<{ time: string; thing: string }> = [
  { time: "09:00", thing: "上班打卡，进入工作状态" },
  { time: "09:30", thing: "泡杯茶，浏览今日资讯" },
  { time: "10:30", thing: "专注输出两小时，间休五分钟" },
  { time: "12:00", thing: "干饭充电，午休别趴桌上" },
  { time: "14:00", thing: "会议纪要与协作沟通" },
  { time: "15:30", thing: "下午茶时间，眺望远方护眼" },
  { time: "18:00", thing: "整理今日产出，准点下班" },
];

/** 摸鱼语录：按一年中的天序轮换，每天固定一条（保证渲染稳定） */
const SLACK_QUOTES: ReadonlyArray<string> = [
  "上班是老板的，下班才是自己的。",
  "好好摸鱼，是为了更好地工作；好好工作，是为了更快地下班。",
  "效率的尽头是准点下班。",
  "别跟 Bug 硬耗，摸五分钟鱼再看往往一眼就通。",
  "工位五分钟，茶水间两小时——社交也是生产力。",
  "今天不想卷没关系，卷是卷不完的。",
  "写代码如泡茶，火候到了自然香。",
  "会休息的人才会工作，周日请彻底放空。",
  "灵感不在工位上，在散步的路上。",
  "计划表是用来参考的，快乐才是硬指标。",
];

/** 取当日语录（dayOfYear 轮换，同一天内稳定） */
export function getDailyQuote(today: Date): string {
  const start = new Date(today.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (today.getTime() - start.getTime()) / 86_400_000,
  );
  return SLACK_QUOTES[dayOfYear % SLACK_QUOTES.length];
}

/** 右栏日期卡视图模型 */
export interface TodayInfo {
  /** "2026年9月18日" */
  dateText: string;
  /** "星期五" */
  weekText: string;
  /** 农历，如 "八月初八"（初一显示月份） */
  lunarText: string;
}

/** 组装右栏日期卡（农历计算复用 lunar-typescript，与 DailyPage 同源） */
export function getTodayInfo(today: Date): TodayInfo {
  const d = dayjs(today);
  const lunar = Lunar.fromDate(today);
  const lunarDay = lunar.getDayInChinese();
  const lunarText =
    lunarDay === "初一"
      ? `${lunar.getMonthInChinese()}月`
      : lunarDay;
  return {
    dateText: `${d.year()}年${d.month() + 1}月${d.date()}日`,
    weekText: `星期${["日", "一", "二", "三", "四", "五", "六"][d.day()]}`,
    lunarText,
  };
}
