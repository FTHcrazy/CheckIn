import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { fetchGitWebhookLogs } from "@/shared/services/code";
import type { GitWebhookLogItem } from "@/shared/services/code";
import {
  calcWorkdaysWith,
  DAILY_TARGET,
  getCommitOutput,
  getThisMonthRange,
  isWorkdayWith,
} from "../code-utils";
import type { HolidayData } from "../code-utils";
import { fetchHolidayData, getCachedHoliday } from "../code-holiday";

/** 趋势条最多铺多少天：超过就截断，避免极端区间拖死页面 */
const MAX_TREND_DAYS = 366;

/** 按年份聚合动态节假日数据：key=年份，value=该年动态数据（null 表示拉取失败用硬编码兜底） */
type HolidayByYear = Map<number, HolidayData | null>;

/** 取某日所在年份的动态数据；无则返回 null（走硬编码兜底） */
function holidayOf(byYear: HolidayByYear, d: Dayjs): HolidayData | null {
  return byYear.get(d.year()) ?? null;
}

/** CodePage 业务逻辑：Git 提交数据查询、工作日统计与产出趋势计算 */
export function useCodePage() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GitWebhookLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf("day"),
    dayjs().endOf("day"),
  ]);
  /** 输入框里的即时值：只是草稿，变化不触发任何请求 */
  const [email, setEmail] = useState("");
  /** 已提交查询的邮箱：只有显式查询（回车 / 按钮 / 首次自动查询）才更新 */
  const [queryEmail, setQueryEmail] = useState("");
  const [workdays, setWorkdays] = useState(1);
  const [emailInitialized, setEmailInitialized] = useState(false);
  const [autoFetched, setAutoFetched] = useState(false);

  // 本月累计有效产出（独立于表格查询区间）
  const [monthOutput, setMonthOutput] = useState(0);

  /**
   * 动态节假日数据（按年份）。空 Map = 尚未填充完成。
   * 挂载时先用本地缓存同步填充（立即生效，不等网络），随后每日静默拉取「今年 + 明年」
   * 刷新缓存并更新状态；拉取失败保持缓存/回退硬编码表兜底。
   */
  const [holidayByYear, setHolidayByYear] = useState<HolidayByYear>(() => {
    const now = new Date();
    const years = [now.getFullYear(), now.getFullYear() + 1];
    const m = new Map<number, HolidayData | null>();
    years.forEach((y) => m.set(y, getCachedHoliday(y)));
    return m;
  });

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const years = [now.getFullYear(), now.getFullYear() + 1];
    years.forEach((y) => {
      void fetchHolidayData(y, (data) => {
        if (cancelled) return;
        setHolidayByYear((prev) => {
          const next = new Map(prev);
          next.set(y, data);
          return next;
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 月度统计请求序号。
   *
   * 连续换邮箱查询时，先发的不一定先回；不判序号会把上一个邮箱的月度产出
   * 写进新邮箱的视图（「本月剩余日均」显示的是别人的数据）。
   */
  const monthSeqRef = useRef(0);
  const loadMonthOutput = useCallback(async (target: string) => {
    const seq = (monthSeqRef.current += 1);
    try {
      const today = dayjs().startOf("day");
      const monthStart = today.startOf("month");

      // 仅当邮箱有效时发起请求
      if (!target) {
        setMonthOutput(0);
        return;
      }

      const res = await fetchGitWebhookLogs(
        target,
        monthStart.format("YYYY/M/D HH:mm:ss"),
        today.endOf("day").format("YYYY/M/D HH:mm:ss"),
      );

      const list = res.gitwebhooklog?.pageInfo?.list ?? [];
      const output = list.reduce((acc, item) => acc + getCommitOutput(item), 0);

      if (seq !== monthSeqRef.current) return;
      setMonthOutput(output);
    } catch {
      // 月度统计请求失败不影响主流程，静默处理或置零
      if (seq !== monthSeqRef.current) return;
      setMonthOutput(0);
    }
  }, []);

  useEffect(() => {
    const loadDefaultEmail = async () => {
      try {
        const user = await window.electronAPI?.user.get();

        if (user?.email) {
          // 用户已经手打过就不覆盖：避免默认值把正在输入的内容冲掉
          setEmail((current) => (current.trim() ? current : user.email!.trim()));
          setQueryEmail((current) =>
            current.trim() ? current : user.email!.trim(),
          );
        }
      } catch {
        // 忽略读取失败，留空由用户手动输入
      } finally {
        setEmailInitialized(true);
      }
    };

    void loadDefaultEmail();
  }, []);

  // overrideRange：编程式查询入口（如「查询当月」）——
  // setState 后同轮闭包里的 dateRange 仍是旧值，必须显式传入新区间
  //
  // 本函数是**唯一的请求入口**：邮箱在这里被「提交」，随后表格与本月统计
  // 都以提交的邮箱发起。输入框里逐字打字不再打接口（此前 email 一变就
  // 触发一次整月拉取，敲 20 个字符就是 20 个请求）。
  const loadData = useCallback(
    async (overrideRange?: [Dayjs, Dayjs]) => {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        setData([]);
        setTotal(0);
        setMonthOutput(0);
        message.warning("请输入邮箱后再查询");
        return;
      }

      setLoading(true);
      try {
        const [from, to] = overrideRange ?? dateRange;
        const res = await fetchGitWebhookLogs(
          trimmedEmail,
          from.startOf("day").format("YYYY/M/D HH:mm:ss"),
          to.endOf("day").format("YYYY/M/D HH:mm:ss"),
        );
        const list = res.gitwebhooklog?.pageInfo?.list ?? [];
        const totalCount = res.gitwebhooklog?.pageInfo?.total ?? 0;
        setData(list);
        setTotal(totalCount);
        setQueryEmail(trimmedEmail);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "请求失败";
        message.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [dateRange, email, message],
  );

  // 提交过的邮箱变了才刷新本月统计（首次自动查询 / 换邮箱查询都会走到这里）
  useEffect(() => {
    void loadMonthOutput(queryEmail);
  }, [loadMonthOutput, queryEmail]);

  /** 查询当月：日期区间置为本月 1 号 ~ 今天并立即查询 */
  const loadThisMonth = useCallback(() => {
    const range = getThisMonthRange(dayjs());
    setDateRange(range);
    void loadData(range);
  }, [loadData]);

  // 首次自动查询：只在「已提交邮箱」出现后跑一次。
  // 守的是 queryEmail 而不是输入框草稿——否则用户在默认值回来前敲了半截邮箱，
  // 就会被当成默认邮箱自动查一次
  useEffect(() => {
    if (!emailInitialized || !queryEmail || autoFetched) {
      return;
    }

    setAutoFetched(true);
    void loadData();
  }, [emailInitialized, queryEmail, autoFetched, loadData]);

  useEffect(() => {
    const [from, to] = dateRange;
    setWorkdays(calcWorkdaysWith(from, to, holidayOf(holidayByYear, from)) || 1);
  }, [dateRange, holidayByYear]);
  // 数据未变化时避免每次渲染都对最多 9999 条记录重新 reduce
  const summaryStats = useMemo(
    () =>
      data.reduce(
        (acc, item) => ({
          commits: acc.commits + 1,
          files: acc.files + (parseInt(item.fileChanges) || 0),
          insertions: acc.insertions + (parseInt(item.insertions) || 0),
          deletions: acc.deletions + (parseInt(item.deletions) || 0),
        }),
        { commits: 0, files: 0, insertions: 0, deletions: 0 },
      ),
    [data],
  );

  /**
   * 本月剩余日均所需产出（存量缺口模型）
   *
   * 目标：本月累计写够 DAILY_TARGET × 全月工作日。
   * 结果：把「目标总量 - 已产出」的缺口，摊到【明天 → 月底】的剩余工作日上，
   *       得出剩余每个工作日平均还需产出多少行。
   *
   * 关键口径（修复点）：
   * - 「已产出」= monthOutput，覆盖【本月 1 号 ~ 今天结束】；
   * - 「剩余工作日」从【明天】起算，不含今天 —— 今天已发生的产出既不能
   *   被重复扣减，也不能再被当作「还没写、需要补足」的一个工作日；
   *   否则今天没写满 200 时，缺口会被多算一整天的量。
   */
  const monthlyDailyNeeded = useMemo(() => {
    const today = dayjs().startOf("day");
    const monthEnd = today.endOf("month").startOf("day");
    const monthStart = today.startOf("month");

    const totalMonthWorkdays = calcWorkdaysWith(
      monthStart,
      monthEnd,
      holidayOf(holidayByYear, today),
    );
    // 剩余工作日从明天起算（今天已计入 monthOutput）
    const remainingWorkdays = calcWorkdaysWith(
      today.add(1, "day"),
      monthEnd,
      holidayOf(holidayByYear, today),
    );

    if (remainingWorkdays <= 0 || totalMonthWorkdays <= 0) return 0;

    const required =
      (DAILY_TARGET * totalMonthWorkdays - monthOutput) / remainingWorkdays;
    return Math.max(0, Math.ceil(required));
  }, [monthOutput, holidayByYear]);

  // 日均代码产出 = (总增加行 + 总删除行 * 0.3) / 工作日
  const dailyOutput = useMemo(() => {
    if (!workdays || workdays <= 0) return 0;
    return (summaryStats.insertions + summaryStats.deletions * 0.3) / workdays;
  }, [summaryStats.insertions, summaryStats.deletions, workdays]);

  /**
   * 选中区间日均产出（行/天）
   *
   * 只回答「所选区间内，平均每个工作日产出了多少行」，不再做缺口/剩余预测。
   * 与「本月剩余日均」彻底解耦：那个卡片关注「本月还要追多少」，这个卡片
   * 关注「这段区间产出效率如何」。
   *
   * 产出 = 区间内累计有效产出（新增行 + 删除行 × 0.3）；
   * 分母 = 区间内工作日数（调休补班算工作日、节假日不算）。
   */
  const selectedRangeDailyOutput = useMemo(() => {
    const [rangeFrom, rangeTo] = dateRange;
    const startDate = rangeFrom.startOf("day");
    const endDate = rangeTo.startOf("day");

    // 起始晚于结束（理论不会发生，RangePicker 保证有序）→ 无意义
    if (startDate.isAfter(endDate)) return null;

    const workdays = calcWorkdaysWith(
      startDate,
      endDate,
      holidayOf(holidayByYear, startDate),
    );
    if (workdays <= 0) return null;

    // 只聚合 [startDate, endDate] 区间内的产出
    const fromTs = startDate.valueOf();
    const endTs = endDate.endOf("day").valueOf();
    let output = 0;
    for (const item of data) {
      const ts = new Date(item.commitTime).getTime();
      if (ts >= fromTs && ts <= endTs) output += getCommitOutput(item);
    }

    return output / workdays;
  }, [dateRange, data, holidayByYear]);

  /**
   * 选中区间的目标提示文案（Tooltip 用）。
   *
   * 说明这个区间日均产出是怎么算的：产出口径 + 工作日口径。
   */
  const selectedRangeHint = useMemo(() => {
    const [rangeFrom, rangeTo] = dateRange;
    const startDate = rangeFrom.startOf("day");
    const endDate = rangeTo.startOf("day");
    const wd = calcWorkdaysWith(
      startDate,
      endDate,
      holidayOf(holidayByYear, startDate),
    );
    return `所选区间共 ${wd} 个工作日；产出 = (新增行 + 删除行 × 0.3) 之和 ÷ 工作日数，反映该区间的日均产出效率。`;
  }, [dateRange, holidayByYear]);

  const dailyOutputTrend = useMemo(() => {
    const [rangeFrom, rangeTo] = dateRange;
    const outputByDate = new Map<string, number>();
    data.forEach((item) => {
      const date = dayjs(item.commitTime).format("YYYY-MM-DD");
      outputByDate.set(date, (outputByDate.get(date) ?? 0) + getCommitOutput(item));
    });

    const trend: { date: string; output: number; isWorkday: boolean }[] = [];
    let current = rangeFrom.startOf("day");
    const end = rangeTo.startOf("day");
    // 区间只禁未来、不禁过去，选到几年前就是几千天 → 趋势条几千个节点，
    // 页面直接失去响应。这里兜底截断，避免极端区间把页面拖死。
    let guard = 0;
    while ((current.isBefore(end) || current.isSame(end)) && guard < MAX_TREND_DAYS) {
      const date = current.format("YYYY-MM-DD");
      trend.push({
        date,
        output: outputByDate.get(date) ?? 0,
        isWorkday: isWorkdayWith(current, holidayOf(holidayByYear, current)),
      });
      current = current.add(1, "day");
      guard += 1;
    }
    return trend;
  }, [dateRange, data, holidayByYear]);

  // reduce 而非 Math.max(...arr)：展开 6 万+ 元素会抛 RangeError（栈溢出），
  // 且原本没有 memo，每次渲染都重跑一遍
  const trendMax = useMemo(
    () =>
      dailyOutputTrend.reduce(
        (max, item) => (item.output > max ? item.output : max),
        DAILY_TARGET,
      ),
    [dailyOutputTrend],
  );

  return {
    loading,
    data,
    total,
    dateRange,
    setDateRange,
    /** 输入框草稿：只改它不会发请求，要查询请调 loadData */
    email,
    setEmail,
    /** 最近一次实际发起查询的邮箱 */
    queryEmail,
    workdays,
    setWorkdays,
    loadData,
    loadThisMonth,
    summaryStats,
    monthlyDailyNeeded,
    dailyOutput,
    selectedRangeDailyOutput,
    /** 选中区间日均产出的说明（Tooltip 文案） */
    selectedRangeHint,
    dailyOutputTrend,
    trendMax,
  };
}
