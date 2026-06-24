import { useEffect, useState, useMemo } from "react";
import { Table, DatePicker, Button, Space, Tag, message, Card, Tooltip, Typography, Statistic, Row, Col, InputNumber, Input } from "antd";
import { ReloadOutlined, SearchOutlined, PlusOutlined, MinusOutlined, FileOutlined } from "@ant-design/icons";
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
  '2026-01-01', '2026-01-02', '2026-01-03', // 元旦
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', // 春节
  '2026-04-05', '2026-04-06', '2026-04-07', // 清明
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', // 劳动节
  '2026-06-19', '2026-06-20', '2026-06-21', // 端午
  '2026-09-25', '2026-09-26', '2026-09-27', // 中秋
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', // 国庆
  // 2025 年
  '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04',
  '2025-04-04', '2025-04-05', '2025-04-06',
  '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05',
  '2025-05-31', '2025-06-01', '2025-06-02',
  '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08',
]);

/** 调休补班日（周末上班） */
const MAKEUP_WORKDAYS = new Set([
  // 2026 年
  '2026-02-14', '2026-02-28', // 春节补班
  '2026-04-26', // 劳动节补班
  '2026-09-28', // 国庆补班
  // 2025 年
  '2025-01-26', '2025-02-08', // 春节补班
  '2025-04-27', // 劳动节补班
  '2025-09-28', '2025-10-11', // 国庆补班
]);

/** 计算日期区间内的法定工作日 */
function calcWorkdays(from: Dayjs, to: Dayjs): number {
  let count = 0;
  let cur = from.startOf('day');
  const end = to.startOf('day');
  while (cur.isBefore(end) || cur.isSame(end)) {
    const key = cur.format('YYYY-MM-DD');
    const dow = cur.day(); // 0=Sun, 6=Sat
    if (MAKEUP_WORKDAYS.has(key)) {
      count++; // 调休补班，周末也算工作日
    } else if (!HOLIDAYS.has(key) && dow >= 1 && dow <= 5) {
      count++; // 普通工作日（周一~周五且非节假日）
    }
    cur = cur.add(1, 'day');
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

  // 日期区间变化时自动计算工作日
  useEffect(() => {
    const [from, to] = dateRange;
    setWorkdays(calcWorkdays(from, to) || 1);
  }, [dateRange]);

  // 汇总统计
  const summaryStats = data.reduce(
    (acc, item) => ({
      commits: acc.commits + 1,
      files: acc.files + (parseInt(item.fileChanges) || 0),
      insertions: acc.insertions + (parseInt(item.insertions) || 0),
      deletions: acc.deletions + (parseInt(item.deletions) || 0),
    }),
    { commits: 0, files: 0, insertions: 0, deletions: 0 },
  );

  // 日均代码产出 = (总增加行 + 总删除行 * 0.3) / 工作日
  const dailyOutput = useMemo(() => {
    if (!workdays || workdays <= 0) return 0;
    return (summaryStats.insertions + summaryStats.deletions * 0.3) / workdays;
  }, [summaryStats.insertions, summaryStats.deletions, workdays]);

  const columns = [
    {
      title: "提交时间",
      dataIndex: "commitTime",
      key: "commitTime",
      width: 160,
      fixed: "left" as const,
      render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "-",
    },
    {
      title: "项目",
      dataIndex: "projectName",
      key: "projectName",
      width: 130,
      render: (v: string) => v ? <Tag color="geekblue">{v}</Tag> : "-",
    },
    {
      title: "仓库",
      dataIndex: "repositoryName",
      key: "repositoryName",
      width: 150,
      render: (v: string) => v ? <Tag color="blue">{v}</Tag> : "-",
    },
    {
      title: "分支",
      dataIndex: "branch",
      key: "branch",
      width: 200,
      render: (v: string) => v ? (
        <Tooltip title={v}>
          <Tag className="branch-tag">{v}</Tag>
        </Tooltip>
      ) : "-",
    },
    {
      title: "提交信息",
      dataIndex: "comments",
      key: "comments",
      ellipsis: true,
      render: (v: string) => v ? (
        <Tooltip title={v}>
          <span>{v.trim()}</span>
        </Tooltip>
      ) : "-",
    },
    {
      title: "变更",
      key: "changes",
      width: 130,
      render: (_: unknown, record: GitWebhookLogItem) => (
        <Space size={4}>
          <FileOutlined style={{ color: "#666" }} />
          <Text type="secondary" style={{ fontSize: 12 }}>{record.fileChanges}</Text>
          <PlusOutlined style={{ color: "#52c41a", fontSize: 11 }} />
          <Text style={{ color: "#52c41a", fontSize: 12 }}>{record.insertions}</Text>
          <MinusOutlined style={{ color: "#ff4d4f", fontSize: 11 }} />
          <Text style={{ color: "#ff4d4f", fontSize: 12 }}>{record.deletions}</Text>
        </Space>
      ),
    },
    {
      title: "团队",
      dataIndex: "teamName",
      key: "teamName",
      width: 100,
      render: (v: string) => v ? <Tag color="cyan">{v}</Tag> : "-",
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
            <Text type="secondary">共 <Text strong>{total}</Text> 条提交</Text>
          </Space>
        </Card>
        <Row gutter={16} className="stats-row">
          <Col span={4}>
            <Card size="small">
              <Statistic title="提交次数" value={summaryStats.commits} suffix="次" />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="修改文件数" value={summaryStats.files} suffix="个" />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="增加行数" value={summaryStats.insertions} suffix="行" valueStyle={{ color: "#52c41a" }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="删除行数" value={summaryStats.deletions} suffix="行" valueStyle={{ color: "#ff4d4f" }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <div className="stat-label">工作日</div>
              <InputNumber
                min={1}
                max={365}
                value={workdays}
                onChange={(v) => v && setWorkdays(v)}
                addonAfter="天"
                style={{ width: '100%' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="日均代码产出"
                value={dailyOutput}
                precision={1}
                suffix="行/天"
                valueStyle={{ color: "#1677ff", fontWeight: 700 }}
              />
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
