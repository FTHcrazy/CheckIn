import { useEffect, useState, useMemo } from "react";
import {
  Table,
  DatePicker,
  Button,
  Space,
  Tag,
  message,
  Card,
  Tooltip,
  Typography,
  Statistic,
  Row,
  Col,
  InputNumber,
  Input,
} from "antd";
import {
  ReloadOutlined,
  SearchOutlined,
  PlusOutlined,
  MinusOutlined,
  FileOutlined,
  AimOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import Page from "../../components/Page";
import { fetchGitWebhookLogs } from "../../services/code";
import type { GitWebhookLogItem } from "../../services/code";
import "./index.scss";

const { RangePicker } = DatePicker;
const { Text } = Typography;

/** 法定节假日（放假日期，含调休放假） */
const HOLIDAYS = new Set([
  // 2026 年
  "2026-01-01",
  "2026-01-02",
  "2026-01-03",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20",
  "2026-02-21",
  "2026-02-22",
  "2026-04-05",
  "2026-04-06",
  "2026-04-07",
  "2026-05-01",
  "2026-05-02",
  "2026-05-03",
  "2026-05-04",
  "2026-05-05",
  "2026-06-19",
  "2026-06-20",
  "2026-06-21",
  "2026-09-25",
  "2026-09-26",
  "2026-09-27",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  // 2025 年
  "2025-01-01",
  "2025-01-28",
  "2025-01-29",
  "2025-01-30",
  "2025-01-31",
  "2025-02-01",
  "2025-02-02",
  "2025-02-03",
  "2025-02-04",
  "2025-04-04",
  "2025-04-05",
  "2025-04-06",
  "2025-05-01",
  "2025-05-02",
  "2025-05-03",
  "2025-05-04",
  "2025-05-05",
  "2025-05-31",
  "2025-06-01",
  "2025-06-02",
  "2025-10-01",
  "2025-10-02",
  "2025-10-03",
  "2025-10-04",
  "2025-10-05",
  "2025-10-06",
  "2025-10-07",
  "2025-10-08",
]);

/** 调休补班日（周末上班） */
const MAKEUP_WORKDAYS = new Set([
  // 2026 年
  "2026-02-14",
  "2026-02-28",
  "2026-04-26",
  "2026-09-28",
  // 2025 年
  "2025-01-26",
  "2025-02-08",
  "2025-04-27",
  "2025-09-28",
  "2025-10-11",
]);

function calcWorkdays(from: Dayjs, to: Dayjs): number {
  let count = 0;
  let cur = from.startOf("day");
  const end = to.startOf("day");
  while (cur.isBefore(end) || cur.isSame(end)) {
    const key = cur.format("YYYY-MM-DD");
    const dow = cur.day();
    if (MAKEUP_WORKDAYS.has(key)) {
      count++;
    } else if (!HOLIDAYS.has(key) && dow >= 1 && dow <= 5) {
      count++;
    }
    cur = cur.add(1, "day");
  }
  return count;
}

export default function CodePage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GitWebhookLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [email, setEmail] = useState("e-tiehan.fang@smart.com");
  const [workdays, setWorkdays] = useState(1);

  // ✅ 新增：本月累计有效产出（独立于表格查询区间）
  const [monthOutput, setMonthOutput] = useState(0);

  const loadMonthOutput = async () => {
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
      const output = list.reduce(
        (acc, item) =>
          acc +
          (parseInt(item.insertions) || 0) +
          (parseInt(item.deletions) || 0) * 0.3,
        0,
      );

      setMonthOutput(output);
    } catch {
      // 月度统计请求失败不影响主流程，静默处理或置零
      setMonthOutput(0);
    }
  };

  // ✅ 页面加载及邮箱变更时重新拉取本月数据
  useEffect(() => {
    loadMonthOutput();
  }, [email]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [from, to] = dateRange;
      const res = await fetchGitWebhookLogs(
        email,
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
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const [from, to] = dateRange;
    setWorkdays(calcWorkdays(from, to) || 1);
  }, [dateRange]);

  const summaryStats = data.reduce(
    (acc, item) => ({
      commits: acc.commits + 1,
      files: acc.files + (parseInt(item.fileChanges) || 0),
      insertions: acc.insertions + (parseInt(item.insertions) || 0),
      deletions: acc.deletions + (parseInt(item.deletions) || 0),
    }),
    { commits: 0, files: 0, insertions: 0, deletions: 0 },
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

    // ✅ 使用独立请求的 monthOutput，而非 summaryStats
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

    // 起始日晚于有效截止日 → 无效区间
    if (startDate.isAfter(effectiveEnd)) return null;

    // ✅ 总工作日：选中起始日 → 本月底最后工作日
    const totalWorkdays = calcWorkdays(startDate, monthEnd);
    if (totalWorkdays <= 0) return 0;

    // ✅ 剩余工作日：选中截止日 → 本月底最后工作日（含截止日当天）
    const remainingWorkdays = calcWorkdays(effectiveEnd, monthEnd);
    if (remainingWorkdays <= 0) return 0;

    // ✅ 核心修正：直接从原始 data 中聚合选中区间的累计有效产出
    // 有效产出 = insertions + deletions × 0.3
    const rangeOutput = data.reduce((sum, item) => {
      const ins = parseInt(item.insertions) || 0;
      const del = parseInt(item.deletions) || 0;
      return sum + ins + del * 0.3;
    }, 0);

    const totalTarget = TARGET * totalWorkdays;
    const gap = totalTarget - rangeOutput;

    if (gap <= 0) return 0; // 已超额完成

    return Math.ceil(gap / remainingWorkdays);
  }, [dateRange, data]);

  const columns = [
    {
      title: "提交时间",
      dataIndex: "commitTime",
      key: "commitTime",
      width: 160,
      fixed: "left" as const,
      render: (v: string) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "-"),
    },
    {
      title: "项目",
      dataIndex: "projectName",
      key: "projectName",
      width: 130,
      render: (v: string) => (v ? <Tag color="geekblue">{v}</Tag> : "-"),
    },
    {
      title: "仓库",
      dataIndex: "repositoryName",
      key: "repositoryName",
      width: 150,
      render: (v: string) => (v ? <Tag color="blue">{v}</Tag> : "-"),
    },
    {
      title: "分支",
      dataIndex: "branch",
      key: "branch",
      width: 200,
      render: (v: string) =>
        v ? (
          <Tooltip title={v}>
            <Tag className="branch-tag">{v}</Tag>
          </Tooltip>
        ) : (
          "-"
        ),
    },
    {
      title: "提交信息",
      dataIndex: "comments",
      key: "comments",
      ellipsis: true,
      render: (v: string) =>
        v ? (
          <Tooltip title={v}>
            <span>{v.trim()}</span>
          </Tooltip>
        ) : (
          "-"
        ),
    },
    {
      title: "变更",
      key: "changes",
      width: 130,
      render: (_: unknown, record: GitWebhookLogItem) => (
        <Space size={4}>
          <FileOutlined style={{ color: "#666" }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.fileChanges}
          </Text>
          <PlusOutlined style={{ color: "#52c41a", fontSize: 11 }} />
          <Text style={{ color: "#52c41a", fontSize: 12 }}>
            {record.insertions}
          </Text>
          <MinusOutlined style={{ color: "#ff4d4f", fontSize: 11 }} />
          <Text style={{ color: "#ff4d4f", fontSize: 12 }}>
            {record.deletions}
          </Text>
        </Space>
      ),
    },
    {
      title: "团队",
      dataIndex: "teamName",
      key: "teamName",
      width: 100,
      render: (v: string) => (v ? <Tag color="cyan">{v}</Tag> : "-"),
    },
  ];

  return (
    <Page>
      <div className="code-page">
        <Card size="small" className="toolbar-card">
          <Space wrap>
            <RangePicker
              value={dateRange}
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  setDateRange([dates[0], dates[1]]);
                }
              }}
              disabledDate={(current) =>
                current && current.isAfter(dayjs().endOf("day"))
              }
            />
            <Input
              placeholder="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: 240 }}
              allowClear
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={loadData}
              loading={loading}
            >
              查询
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={loadData}
              loading={loading}
            >
              刷新
            </Button>
            <Text type="secondary">
              共 <Text strong>{total}</Text> 条提交
            </Text>
          </Space>
        </Card>

        {/* 统计卡片区域：新增第7个卡片，使用 flex 布局或调整 span */}
        <Row gutter={[16, 16]} className="stats-row">
          <Col xs={12} sm={8} md={6} lg={4} xl={3}>
            <Card size="small">
              <Statistic
                title="提交次数"
                value={summaryStats.commits}
                suffix="次"
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={6} lg={4} xl={3}>
            <Card size="small">
              <Statistic
                title="修改文件数"
                value={summaryStats.files}
                suffix="个"
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={6} lg={4} xl={3}>
            <Card size="small">
              <Statistic
                title="增加行数"
                value={summaryStats.insertions}
                suffix="行"
                styles={{ content: { color: "#52c41a" } }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={6} lg={4} xl={3}>
            <Card size="small">
              <Statistic
                title="删除行数"
                value={summaryStats.deletions}
                suffix="行"
                styles={{ content: { color: "#ff4d4f" } }}
              />
            </Card>
          </Col>

          {/* ✅ 修复: addonAfter → Space.Compact */}
          <Col xs={12} sm={8} md={6} lg={4} xl={3}>
            <Card size="small">
              <div className="stat-label">工作日</div>
              <Space.Compact style={{ width: "100%" }}>
                <InputNumber
                  min={1}
                  max={365}
                  value={workdays}
                  onChange={(v) => v && setWorkdays(v)}
                  style={{ flex: 1 }}
                />
                <Button disabled style={{ cursor: "default" }}>
                  天
                </Button>
              </Space.Compact>
            </Card>
          </Col>

          <Col xs={12} sm={8} md={6} lg={4} xl={3}>
            <Card size="small">
              <Statistic
                title="日均代码产出"
                value={dailyOutput}
                precision={1}
                suffix="行/天"
                styles={{ content: { color: "#1677ff", fontWeight: 700 } }}
              />
            </Card>
          </Col>

          <Col xs={12} sm={8} md={6} lg={4} xl={3}>
            <Card size="small">
              {monthlyDailyNeeded !== null ? (
                <Statistic
                  title={
                    <Tooltip title="以200行/天为月度目标，从今日起到本月底每个工作日平均需产出的有效代码行数">
                      <span style={{ cursor: "help" }}>
                        本月剩余日均 <AimOutlined />
                      </span>
                    </Tooltip>
                  }
                  value={monthlyDailyNeeded}
                  suffix="行/天"
                  styles={{
                    content: {
                      color: monthlyDailyNeeded === 0 ? "#52c41a" : "#fa8c16",
                      fontWeight: 700,
                    },
                  }}
                />
              ) : (
                <Statistic
                  title="本月剩余日均"
                  value="-"
                  styles={{
                    content: { color: "#999" },
                  }}
                />
              )}
            </Card>
          </Col>

          <Col xs={12} sm={8} md={6} lg={4} xl={3}>
            <Card size="small">
              {selectedRangeDailyNeeded !== null ? (
                <Statistic
                  title={
                    <Tooltip
                      title={(() => {
                        const totalWd = calcWorkdays(
                          dateRange[0].startOf("day"),
                          dayjs().endOf("month").startOf("day"),
                        );
                        const remainWd = calcWorkdays(
                          dateRange[1].isBefore(dayjs().endOf("month"))
                            ? dateRange[1].startOf("day")
                            : dayjs().endOf("month").startOf("day"),
                          dayjs().endOf("month").startOf("day"),
                        );
                        const output = data.reduce(
                          (s, i) =>
                            s +
                            (parseInt(i.insertions) || 0) +
                            (parseInt(i.deletions) || 0) * 0.3,
                          0,
                        );
                        return `目标: 200×${totalWd}=${200 * totalWd}行 | 已产出: ${Math.round(output)}行 | 剩余${remainWd}个工作日均摊缺口`;
                      })()}
                    >
                      <span style={{ cursor: "help" }}>
                        选中区间剩余日均 <AimOutlined />
                      </span>
                    </Tooltip>
                  }
                  value={selectedRangeDailyNeeded}
                  suffix="行/天"
                  styles={{
                    content: {
                      color:
                        selectedRangeDailyNeeded === 0 ? "#52c41a" : "#722ed1",
                      fontWeight: 700,
                    },
                  }}
                />
              ) : (
                <div>
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    选中区间剩余日均
                  </Text>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 600,
                      color: "#999",
                      marginTop: 4,
                    }}
                  >
                    -
                  </div>
                </div>
              )}
            </Card>
          </Col>
        </Row>

        <Table
          className="commit-table"
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
          scroll={{ x: 1100 }}
        />
      </div>
    </Page>
  );
}
