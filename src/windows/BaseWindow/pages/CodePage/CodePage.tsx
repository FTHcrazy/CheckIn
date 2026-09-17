import {
  Table,
  DatePicker,
  Button,
  Space,
  Tag,
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
import Page from "@/shared/components/Page";
import type { GitWebhookLogItem } from "@/shared/services/code";
import { calcWorkdays, getCommitOutput } from "./code-utils";
import { useCodePage } from "./hooks/useCodePage";
import "./index.scss";

const { RangePicker } = DatePicker;
const { Text } = Typography;

// 列定义与组件状态无关，提升到模块作用域：
// 避免每次渲染都新建数组导致 Table 内部列配置全量重算
const COMMIT_COLUMNS = [
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
        <FileOutlined style={{ color: "var(--app-text-muted)" }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {record.fileChanges}
        </Text>
        <PlusOutlined style={{ color: "var(--app-success)", fontSize: 11 }} />
        <Text style={{ color: "var(--app-success)", fontSize: 12 }}>
          {record.insertions}
        </Text>
        <MinusOutlined style={{ color: "var(--app-error)", fontSize: 11 }} />
        <Text style={{ color: "var(--app-error)", fontSize: 12 }}>
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

export default function CodePage() {
  const {
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
  } = useCodePage();

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

        {/* 统计卡片区域 */}
        <Row gutter={[16, 16]} className="stats-row">
          <Col xs={12} sm={12} md={8} lg={6} xl={6}>
            <Card size="small">
              <Statistic
                title="提交次数"
                value={summaryStats.commits}
                suffix="次"
              />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={8} lg={6} xl={6}>
            <Card size="small">
              <Statistic
                title="修改文件数"
                value={summaryStats.files}
                suffix="个"
              />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={8} lg={6} xl={6}>
            <Card size="small">
              <Statistic
                title="增加行数"
                value={summaryStats.insertions}
                suffix="行"
                styles={{ content: { color: "var(--app-success)" } }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={8} lg={6} xl={6}>
            <Card size="small">
              <Statistic
                title="删除行数"
                value={summaryStats.deletions}
                suffix="行"
                styles={{ content: { color: "var(--app-error)" } }}
              />
            </Card>
          </Col>

          <Col xs={12} sm={12} md={8} lg={6} xl={6}>
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

          <Col xs={12} sm={12} md={8} lg={6} xl={6}>
            <Card size="small">
              <Statistic
                title="日均代码产出"
                value={dailyOutput}
                precision={1}
                suffix="行/天"
                styles={{
                  content: {
                    color: "var(--app-primary)",
                    fontWeight: 700,
                  },
                }}
              />
            </Card>
          </Col>

          <Col xs={12} sm={12} md={8} lg={6} xl={6}>
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
                      color:
                        monthlyDailyNeeded === 0
                          ? "var(--app-success)"
                          : "var(--app-warning)",
                      fontWeight: 700,
                    },
                  }}
                />
              ) : (
                <Statistic
                  title="本月剩余日均"
                  value="-"
                  styles={{
                    content: { color: "var(--app-text-disabled)" },
                  }}
                />
              )}
            </Card>
          </Col>

          <Col xs={12} sm={12} md={8} lg={6} xl={6}>
            <Card size="small">
              {selectedRangeDailyNeeded !== null ? (
                <Statistic
                  title={
                    <Tooltip
                      title={(() => {
                        const mEnd = dayjs().endOf("month").startOf("day");
                        const effEnd = dateRange[1].isBefore(mEnd)
                          ? dateRange[1].startOf("day")
                          : mEnd;
                        const totalWd = calcWorkdays(
                          dateRange[0].startOf("day"),
                          mEnd,
                        );
                        const remainWd = calcWorkdays(effEnd, mEnd);
                        const outEnd = effEnd.subtract(1, "day");
                        const output = data
                          .filter((i) => {
                            const d = dayjs(i.commitTime).startOf("day");
                            return (
                              (d.isSame(dateRange[0], "day") ||
                                d.isAfter(dateRange[0], "day")) &&
                              (d.isSame(outEnd, "day") ||
                                d.isBefore(outEnd, "day"))
                            );
                          })
                          .reduce((s, i) => s + getCommitOutput(i), 0);
                        return `目标: 200×${totalWd}=${200 * totalWd}行 | 已产出(不含截止日): ${Math.round(output)}行 | 剩余${remainWd}个工作日均摊缺口`;
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
                        selectedRangeDailyNeeded === 0
                          ? "var(--app-success)"
                          : "var(--app-accent-purple)",
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
                      color: "var(--app-text-disabled)",
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

        <Card
          size="small"
          className="trend-card"
          title="选中日期日均代码产出趋势"
          extra={<Text type="secondary">目标 200 行/天</Text>}
        >
          <div className="trend-chart" aria-label="选中日期日均代码产出趋势">
            <div className="trend-values">
              {dailyOutputTrend.map((item) => (
                <div className="trend-value" key={item.date}>
                  {Math.round(item.output)}
                </div>
              ))}
            </div>
            <div className="trend-bars">
              <div
                className="trend-target-line"
                style={{ bottom: `${(200 / trendMax) * 100}%` }}
              />
              {dailyOutputTrend.map((item) => (
                <div className="trend-bar-area" key={item.date}>
                  <div
                    className={`trend-bar${item.isWorkday ? "" : " trend-bar-weekend"}`}
                    style={{ height: `${Math.max((item.output / trendMax) * 100, 2)}%` }}
                    title={`${item.date}: ${item.output.toFixed(1)} 行`}
                  />
                </div>
              ))}
            </div>
            <div className="trend-dates">
              {dailyOutputTrend.map((item) => (
                <div className="trend-date" key={item.date}>
                  {dayjs(item.date).format("MM-DD")}
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Table
          className="commit-table"
          columns={COMMIT_COLUMNS}
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
