import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Collapse, Empty, Popconfirm, Select, Spin, Tag } from "antd";
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import type { AiLogRowDTO } from "@/shared/types/electron";
import { TRANSFORM_INTENT_SUB } from "@/shared/ai/context";
import { AI_EVENT_INTENT_LABELS, intentLabel } from "@/shared/ai/intent-labels";
import type { TransformKind } from "@/shared/ai/context";
import "./index.scss";

/**
 * AI 调用记录页（2.7.1）
 *
 * 为什么单独占一页而不是塞进「AI 配置」：配置是「设一次就不动」的动作，
 * 记录是「调 prompt 时反复回看」的动作，两类操作混在一页会让配置表单被日志
 * 淹没（AI 配置页已经有三张卡，再加一张长列表就是逼用户滚到底找「保存」）。
 *
 * 数据源是主进程 `ai.db` 的 `ai_log` 表（每次调用一行，成功与失败都记），
 * 与本地日志文件里的 `[ai]` 行是**同一批事实的两种形态**：
 * - 这里用来「横向对比」：同一意图下哪次输出更好、失败集中在哪种错误；
 * - 日志文件用来「看现场」：含完整时间轴，能对照 IPC 与窗口生命周期。
 *
 * ⚠️ 这里能看到的 prompt / 输出都是**截断后的预览**（主进程落库时各截 600 字），
 * 不含任何明文 API Key（Key 在请求头里，从不进日志）。
 *
 * ⚠️ 意图中文走 `shared/ai/intent-labels`（REQ-064）：本页原先自带一份含
 * 变换子类型的映射，「用量与效果」页只有基础表，两页对同一条记录叫法不同。
 * 现在两页共用一张表，本页只保留「筛选下拉」这份派生清单。
 */

/** 每页条数：一屏能看完一次调优对比即可，不必提供可调 */
const PAGE_SIZE = 20;

/** 变换类型 → 完整 intent（`transform:expand` 等，与 ai_log.intent 落库值一致） */
const TRANSFORM_INTENTS = (
  Object.keys(TRANSFORM_INTENT_SUB) as TransformKind[]
).map((kind) => `transform:${TRANSFORM_INTENT_SUB[kind]}`);

/**
 * 筛选下拉的选项：基础意图逐一列出 + 变换子类型展开。
 *
 * 从 `AI_EVENT_INTENT_LABELS` 派生而不是手抄一份：新增意图时只有产地要改，
 * 这里跟着长出来，不会出现「看板认识、筛选里却没有」的漏斗。
 * 顺序按「高频使用 → 低频」固定，`test`（连接测试）放最后。
 */
const INTENT_FILTER_ORDER = [
  "naming",
  "polish",
  "continuation",
  "summary",
  ...TRANSFORM_INTENTS,
  "test",
];

const INTENT_OPTIONS = [
  { value: "", label: "全部意图" },
  ...INTENT_FILTER_ORDER.filter((value) => value in AI_EVENT_INTENT_LABELS).map((value) => ({
    value,
    label: intentLabel(value),
  })),
];

/** 时间列只显示到分钟（同一分钟内的两次调用靠 id 排序区分），hover 看全量 */
function shortTime(value: string): string {
  return value?.slice(0, 16) || "-";
}

export default function AILogSection() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AiLogRowDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [intent, setIntent] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  /** 已展开的行 id 集合（Collapse 的 activeKey） */
  const [expanded, setExpanded] = useState<string[]>([]);

  const load = useCallback(
    async (targetPage: number, targetIntent: string): Promise<void> => {
      setLoading(true);
      try {
        const result = await window.electronAPI?.ai?.listLogs({
          limit: PAGE_SIZE,
          offset: (targetPage - 1) * PAGE_SIZE,
          intent: targetIntent || undefined,
        });
        if (!result) {
          // 通道没注册（lite 版 / 主进程未初始化）时如实展示为空，不伪造数据
          setRows([]);
          setTotal(0);
          return;
        }
        setRows(result.items);
        setTotal(result.total);
      } catch {
        setRows([]);
        setTotal(0);
        message.error("读取调用记录失败");
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    void load(page, intent);
  }, [load, page, intent]);

  const handleClear = async (): Promise<void> => {
    setClearing(true);
    try {
      const result = await window.electronAPI?.ai?.clearLogs();
      if (result?.ok) {
        setExpanded([]);
        setPage(1);
        await load(1, intent);
        message.success("已清空调用记录");
      } else {
        message.error("清空失败，请稍后重试");
      }
    } catch {
      message.error("清空失败，请稍后重试");
    } finally {
      setClearing(false);
    }
  };

  /** 展开项：把行数据拼成 Collapse 需要的 items（只渲染当前页，成本可忽略） */
  const items = useMemo(
    () =>
      rows.map((row) => {
        const failed = Boolean(row.error_code);
        return {
          key: String(row.id),
          label: (
            <div className="settings-ailog__brief">
              <span className="settings-ailog__time" title={row.created_at}>
                {shortTime(row.created_at)}
              </span>
              <Tag className="settings-ailog__intent">{intentLabel(row.intent)}</Tag>
              <span className="settings-ailog__model" title={row.model}>
                {row.model || "-"}
              </span>
              <span className="settings-ailog__duration">{row.duration_ms} ms</span>
              <span
                className={`settings-ailog__status${failed ? " is-fail" : " is-ok"}`}
                title={row.error_message ?? "调用成功"}
              >
                {failed ? (row.error_message ?? row.error_code) : "成功"}
              </span>
            </div>
          ),
          children: (
            <div className="settings-ailog__detail">
              <section className="settings-ailog__block">
                <h4 className="settings-ailog__block-title">系统提示词</h4>
                <pre className="settings-ailog__pre">{row.system_prompt || "（空）"}</pre>
              </section>
              <section className="settings-ailog__block">
                <h4 className="settings-ailog__block-title">用户输入</h4>
                <pre className="settings-ailog__pre">{row.user_prompt || "（空）"}</pre>
              </section>
              <section className="settings-ailog__block">
                <h4 className="settings-ailog__block-title">模型输出</h4>
                <pre className="settings-ailog__pre">{row.raw_output || "（无输出）"}</pre>
              </section>
            </div>
          ),
        };
      }),
    [rows],
  );

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section__title">调用记录</h2>
        <div className="settings-section__body">
          <div className="settings-item">
            <div className="settings-item__text">
              <span className="settings-item__label">最近调用</span>
              <span className="settings-item__hint">
                共 {total} 条；每条含提示词与输出的前 600 字，用于对比调优。
                只保留最近 30 天，超期记录在下次调用或启动时自动清理
              </span>
            </div>
            <div className="settings-ailog__tools">
              <Select
                className="settings-ailog__filter"
                aria-label="按意图筛选"
                value={intent}
                options={INTENT_OPTIONS}
                onChange={(value) => {
                  setIntent(value);
                  setPage(1);
                }}
              />
              <Button
                className="settings-btn"
                onClick={() => void load(page, intent)}
                loading={loading}
              >
                <ReloadOutlined />
                刷新
              </Button>
              <Popconfirm
                title="清空全部调用记录？"
                description="只删本地调用日志，不影响 AI 配置与作品数据。"
                okText="清空"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => void handleClear()}
              >
                <Button className="settings-btn" danger loading={clearing} disabled={total === 0}>
                  <DeleteOutlined />
                  清空
                </Button>
              </Popconfirm>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section__body">
          {loading && rows.length === 0 ? (
            <div className="settings-ailog__loading">
              <Spin size="small" />
              <span>正在读取调用记录…</span>
            </div>
          ) : rows.length === 0 ? (
            <Empty
              className="settings-ailog__empty"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                intent
                  ? "这个意图下还没有调用记录"
                  : "还没有调用记录。用一次 AI 起名或润色后，这里会留下完整上下文"
              }
            />
          ) : (
            <Collapse
              className="settings-ailog__list"
              bordered={false}
              activeKey={expanded}
              onChange={(keys) =>
                setExpanded(Array.isArray(keys) ? keys.map(String) : [String(keys)])
              }
              items={items}
            />
          )}

          {pageCount > 1 ? (
            <div className="settings-ailog__pager">
              <Button
                className="settings-btn"
                size="small"
                disabled={page <= 1 || loading}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </Button>
              <span className="settings-ailog__page-text">
                {page} / {pageCount}
              </span>
              <Button
                className="settings-btn"
                size="small"
                disabled={page >= pageCount || loading}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
