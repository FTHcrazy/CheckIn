import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOLIDAY_COUNT,
  MAX_NEWS,
  SAMPLE_NEWS,
  SLACK_PLAN,
  WEEK_STATUS,
  fetchDailyNews,
  getDailyQuote,
  getTodayInfo,
  getUpcomingHolidays,
  mapDaily60s,
} from "./news";

/**
 * 桩掉渲染进程 fetch（请求已下沉到渲染进程，不再走主进程 IPC）。
 * client 只依赖 ok / status / headers.get / text 四个字段。
 */
function stubFetch(
  handler: (url: string) => Promise<{ status: number; body: unknown }>,
): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const result = await handler(url);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      url,
      headers: {
        get: (key: string) =>
          key.toLowerCase() === "content-type" ? "application/json" : null,
      },
      text: async () => JSON.stringify(result.body),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
}

describe("今日资讯", () => {
  it("返回不超过十条且按热度降序", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    const payload = await fetchDailyNews();
    const news = payload.items;
    expect(news.length).toBeGreaterThan(0);
    expect(news.length).toBeLessThanOrEqual(MAX_NEWS);
    for (let i = 1; i < news.length; i++) {
      expect(news[i].heat).toBeLessThanOrEqual(news[i - 1].heat);
    }
  });

  it("样例数据本身不超过上限，字段完整", () => {
    expect(SAMPLE_NEWS.length).toBeLessThanOrEqual(MAX_NEWS);
    for (const item of SAMPLE_NEWS) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.source.length).toBeGreaterThan(0);
      expect(item.heat).toBeGreaterThanOrEqual(0);
      expect(item.heat).toBeLessThanOrEqual(100);
      expect(item.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});

describe("60s API 接入", () => {
  beforeEach(() => {
    // 默认断网，保证测试离线可跑；各用例按需覆盖
    stubFetch(() => Promise.reject(new Error("offline")));
  });

  it("mapDaily60s：截取十条、提取时间、热度按序衰减", () => {
    const items = mapDaily60s({
      date: "2026-09-18",
      news: Array.from({ length: 15 }, (_, i) => `要闻 ${i + 1}`),
      created: "2026/09/18 07:49",
      tip: "编辑推荐",
    });
    expect(items.length).toBe(MAX_NEWS);
    expect(items[0].title).toBe("要闻 1");
    expect(items[0].time).toBe("07:49");
    for (let i = 1; i < items.length; i++) {
      expect(items[i].heat).toBeLessThan(items[i - 1].heat);
    }
    // API 无摘要：summary 置空，UI 不渲染
    expect(items[0].summary).toBe("");
  });

  it("mapDaily60s：news 缺失或为空返回空列表，无时间信息为空串", () => {
    expect(mapDaily60s({})).toEqual([]);
    expect(mapDaily60s({ news: [], created: "2026/09/18" })).toEqual([]);
    const noTime = mapDaily60s({ news: ["仅有一条"] });
    expect(noTime[0].time).toBe("");
  });

  it("fetchDailyNews：接口不可用时走本地兜底", async () => {
    const result = await fetchDailyNews();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.live).toBe(false);
    expect(result.quote).toBeNull();
    expect(result.progress).toBeNull();
    expect(result.workday).toBeNull();
    expect(result.lunarText).toBeNull();
  });

  it("fetchDailyNews：接口成功时映射真实数据，tip 优先于 moyuQuote，无效进度槽位为 null", async () => {
    stubFetch(async (url) => {
      if (url.endsWith("/60s")) {
        return {
          status: 200,
          body: {
            code: 200,
            data: {
              news: ["热点一条", "热点两条"],
              created: "2026/09/18 07:49",
              tip: "一句话",
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          code: 200,
          data: {
            today: { isWorkday: true },
            progress: {
              week: { passed: 3, total: 7, remaining: 4, percentage: 42.86 },
              month: "bad",
            },
            date: { lunar: { monthCN: "八月", dayCN: "初八" } },
            moyuQuote: "摸住鱼了",
          },
        },
      };
    });

    const result = await fetchDailyNews();
    expect(result.items).toHaveLength(2);
    expect(result.live).toBe(true);
    expect(result.items[0].title).toBe("热点一条");
    expect(result.items[0].time).toBe("07:49");
    expect(result.quote).toBe("一句话");
    expect(result.workday).toBe(true);
    expect(result.lunarText).toBe("八月初八");
    expect(result.progress?.week?.percentage).toBeCloseTo(42.86);
    expect(result.progress?.month).toBeNull();
    expect(result.progress?.year).toBeNull();
  });

  it("fetchDailyNews：单端点失败不影响另一端点", async () => {
    stubFetch(async (url) => {
      if (url.endsWith("/60s")) throw new Error("60s down");
      return {
        status: 200,
        body: {
          code: 200,
          data: { today: { isWorkday: false }, moyuQuote: "休息日" },
        },
      };
    });

    const result = await fetchDailyNews();
    // 60s 失败 → 样例兜底；moyu 成功 → workday / quote 来自 API
    expect(result.items.map((n) => n.title)).toEqual(
      SAMPLE_NEWS.map((n) => n.title),
    );
    expect(result.workday).toBe(false);
    expect(result.quote).toBe("休息日");
  });

  it("fetchDailyNews：全部失败时整体兜底", async () => {
    stubFetch(() => Promise.reject(new Error("network down")));

    const result = await fetchDailyNews();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.progress).toBeNull();
    expect(result.workday).toBeNull();
  });
});

describe("假期倒计时", () => {
  it("2026-09-18 视角：中秋 7 天后、国庆 13 天后，按日期升序", () => {
    const list = getUpcomingHolidays(new Date(2026, 8, 18));
    expect(list[0]).toEqual({ name: "中秋", date: "2026-09-25", days: 7 });
    expect(list[1]).toEqual({ name: "国庆节", date: "2026-10-01", days: 13 });
    // 元旦在国庆之后（跨年覆盖）
    expect(list[2]).toEqual({ name: "元旦", date: "2027-01-01", days: 105 });
    expect(list.length).toBe(HOLIDAY_COUNT);
  });

  it("节日当天 days 为 0，当天之后的同节日不再出现", () => {
    const onNationalDay = getUpcomingHolidays(new Date(2026, 9, 1));
    expect(onNationalDay[0]).toEqual({
      name: "国庆节",
      date: "2026-10-01",
      days: 0,
    });
    // 2026-10-02 视角：2026 国庆已过，最近的应是 2027 元旦
    const after = getUpcomingHolidays(new Date(2026, 9, 2));
    expect(after[0].name).toBe("元旦");
    expect(after[0].days).toBe(91);
  });

  it("年底视角仍能凑满四条（公历规则跨年 + 农历年表）", () => {
    const list = getUpcomingHolidays(new Date(2026, 11, 30));
    expect(list.length).toBe(HOLIDAY_COUNT);
    expect(list[0].name).toBe("元旦");
    expect(list[0].days).toBe(2);
    for (const item of list) {
      expect(item.days).toBeGreaterThanOrEqual(0);
      expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("日期与天数换算无时区漂移（凌晨与深夜一致）", () => {
    const morning = getUpcomingHolidays(new Date(2026, 8, 18, 0, 0, 0));
    const night = getUpcomingHolidays(new Date(2026, 8, 18, 23, 59, 59));
    expect(morning.map((x) => x.days)).toEqual(night.map((x) => x.days));
  });
});

describe("摸鱼文案", () => {
  it("一周七天都有状态文案，语录按天轮换且当天稳定", () => {
    expect(WEEK_STATUS.length).toBe(7);
    const d1 = getDailyQuote(new Date(2026, 8, 18, 9));
    const d2 = getDailyQuote(new Date(2026, 8, 18, 21));
    expect(d1).toBe(d2);
    const next = getDailyQuote(new Date(2026, 8, 19, 9));
    expect(next).not.toBe(d1);
  });

  it("摸鱼计划表时间合法且为升序", () => {
    expect(SLACK_PLAN.length).toBeGreaterThan(0);
    for (let i = 1; i < SLACK_PLAN.length; i++) {
      expect(SLACK_PLAN[i].time >= SLACK_PLAN[i - 1].time).toBe(true);
    }
  });

  it("日期卡包含年月日 / 星期 / 农历", () => {
    const info = getTodayInfo(new Date(2026, 8, 18));
    expect(info.dateText).toBe("2026年9月18日");
    expect(info.weekText).toBe("星期五");
    expect(info.lunarText.length).toBeGreaterThan(0);
  });
});
