import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { fetchGitWebhookLogs } from "@/shared/services/code";
import type { GitWebhookLogItem } from "@/shared/services/code";
import { calcWorkdays, getCommitOutput, isWorkday } from "../code-utils";

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
  const [email, setEmail] = useState("");
  const [workdays, setWorkdays] = useState(1);
  const [emailInitialized, setEmailInitialized] = useState(false);
  const [autoFetched, setAutoFetched] = useState(false);

  // 本月累计有效产出（独立于表格查询区间）
  const [monthOutput, setMonthOutput] = useState(0);

  const loadMonthOutput = useCallback(async () => {
    try {
      const today = dayjs().startOf("day");
      const monthStart = today.startOf("month");

      // 仅当邮箱有效时发起请求
      if (!email) {
        setMonthOutput(0);
        return;
      }

      const res = await fetchGitWebhookLogs(
        email,
        monthStart.format("YYYY/M/D HH:mm:ss"),
        today.endOf("day").format("YYYY/M/D HH:mm:ss"),
      );

      const list = res.gitwebhooklog?.pageInfo?.list ?? [];
      const output = list.reduce((acc, item) => acc + getCommitOutput(item), 0);

      setMonthOutput(output);
    } catch {
      // 月度统计请求失败不影响主流程，静默处理或置零
      setMonthOutput(0);
    }
  }, [email]);

  useEffect(() => {
    const loadDefaultEmail = async () => {
      try {
        const user = await window.electronAPI?.user.get();

        if (user?.email) {
          setEmail(user.email.trim());
        }
      } catch {
        // 忽略读取失败，留空由用户手动输入
      } finally {
        setEmailInitialized(true);
      }
    };

    void loadDefaultEmail();
  }, []);

  // 页面加载及邮箱变更时重新拉取本月数据
  useEffect(() => {
    if (!email) {
      setMonthOutput(0);
      return;
    }

    void loadMonthOutput();
  }, [loadMonthOutput]);

  const loadData = useCallback(async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setData([]);
      setTotal(0);
      message.warning("请输入邮箱后再查询");
      return;
    }

    setLoading(true);
    try {
      const [from, to] = dateRange;
      const res = await fetchGitWebhookLogs(
        trimmedEmail,
        from.startOf("day").format("YYYY/M/D HH:mm:ss"),
        to.endOf("day").format("YYYY/M/D HH:mm:ss"),
      );
      const list = res.gitwebhooklog?.pageInfo?.list ?? [];
      const totalCount = res.gitwebhooklog?.pageInfo?.total ?? 0;
      setData(list);
      setTotal(totalCount);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "请求失败";
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [dateRange, email, message]);

  useEffect(() => {
    if (!emailInitialized || !email.trim() || autoFetched) {
      return;
    }

    setAutoFetched(true);
    void loadData();
  }, [emailInitialized, email, autoFetched, loadData]);

  useEffect(() => {
    const [from, to] = dateRange;
    setWorkdays(calcWorkdays(from, to) || 1);
  }, [dateRange]);

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
   * 本月剩余工作日（含今日）平均每天需要多少行才能达成 200行/天
   * 基于【本月1号至今日】的真实累计产出计算，不受表格筛选区间影响
   */
  const monthlyDailyNeeded = useMemo(() => {
    const TARGET = 200;
    const today = dayjs().startOf("day");
    const monthEnd = today.endOf("month").startOf("day");
    const monthStart = today.startOf("month");

    const totalMonthWorkdays = calcWorkdays(monthStart, monthEnd);
    const remainingWorkdays = calcWorkdays(today, monthEnd);

    if (remainingWorkdays <= 0 || totalMonthWorkdays <= 0) return 0;

    // 使用独立请求的 monthOutput，而非 summaryStats
    const required =
      (TARGET * totalMonthWorkdays - monthOutput) / remainingWorkdays;
    return Math.max(0, Math.ceil(required));
  }, [monthOutput]);

  // 日均代码产出 = (总增加行 + 总删除行 * 0.3) / 工作日
  const dailyOutput = useMemo(() => {
    if (!workdays || workdays <= 0) return 0;
    return (summaryStats.insertions + summaryStats.deletions * 0.3) / workdays;
  }, [summaryStats.insertions, summaryStats.deletions, workdays]);

  /**
   * 选中区间剩余日均所需产出
   *
   * 计算规则：
   *   总目标 = 200 × [选中起始日 ~ 本月底最后工作日] 的工作日数
   *   已产出 = dateRange 整个区间的累计代码产出
   *   剩余工作日 = [选中截止日 ~ 本月底最后工作日] 的工作日数
   *              （包含截止日当天，因其产出已在"已产出"中被部分扣减，
   *               若当日不足200行则仍需继续补足）
   *   结果 = max(0, ceil((总目标 - 已产出) / 剩余工作日))
   */
  const selectedRangeDailyNeeded = useMemo(() => {
    const TARGET = 200;
    const [rangeFrom, rangeTo] = dateRange;
    const startDate = rangeFrom.startOf("day");
    const monthEnd = dayjs().endOf("month").startOf("day");

    // 选中起始日超出本月 → 无意义
    if (startDate.isAfter(monthEnd)) return null;

    // 有效截止日 = min(选中截止日, 本月底)
    const effectiveEnd = rangeTo.isBefore(monthEnd)
      ? rangeTo.startOf("day")
      : monthEnd;

    if (startDate.isAfter(effectiveEnd)) return null;

    // 总工作日：选中起始日 → 本月底最后工作日
    const totalWorkdays = calcWorkdays(startDate, monthEnd);
    if (totalWorkdays <= 0) return 0;

    // 剩余工作日：选中截止日 → 本月底最后工作日（含截止日当天）
    const remainingWorkdays = calcWorkdays(effectiveEnd, monthEnd);
    if (remainingWorkdays <= 0) return 0;

    // 只聚合 [startDate, effectiveEnd前一天] 的产出
    // 因为截止日当天计入剩余工作日，其产出不应被提前扣减
    const outputEndDate = effectiveEnd.subtract(1, "day");
    const rangeOutput = data
      .filter((item) => {
        const d = dayjs(item.commitTime).startOf("day");
        return (
          (d.isSame(startDate) || d.isAfter(startDate)) &&
          (d.isSame(outputEndDate) || d.isBefore(outputEndDate))
        );
      })
      .reduce((sum, item) => sum + getCommitOutput(item), 0);

    const totalTarget = TARGET * totalWorkdays;
    const gap = totalTarget - rangeOutput;

    if (gap <= 0) return 0;
    return Math.ceil(gap / remainingWorkdays);
  }, [dateRange, data]);

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
    while (current.isBefore(end) || current.isSame(end)) {
      const date = current.format("YYYY-MM-DD");
      trend.push({
        date,
        output: outputByDate.get(date) ?? 0,
        isWorkday: isWorkday(current),
      });
      current = current.add(1, "day");
    }
    return trend;
  }, [dateRange, data]);

  const trendMax = Math.max(
    200,
    ...dailyOutputTrend.map((item) => item.output),
  );

  return {
    loading,
    data,
    total,
    dateRange,
    setDateRange,
    email,
    setEmail,
    workdays,
    setWorkdays,
    loadData,
    summaryStats,
    monthlyDailyNeeded,
    dailyOutput,
    selectedRangeDailyNeeded,
    dailyOutputTrend,
    trendMax,
  };
}
