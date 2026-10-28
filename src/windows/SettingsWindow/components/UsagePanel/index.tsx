import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Spin, Tag } from "antd";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { exportAiDiagnostics, getAiEventStats } from "@/shared/ai/ai-client";
import { AI_INTENT_LABELS } from "@/shared/ai/context/prompt/registry";
import type { AiEventStatsDTO } from "@/shared/ai/ai-types";
import "./index.scss";

/**
 * AI 用量与效果看板（M1b）。
 *
 * 回答 PRD 排期 B1 的四个验收问题：本月调用次数、各 intent 分布、采纳率、
 * 平均耗时。数据源是 `ai_event` 表（纯元数据，不含正文），与「AI 记录」页
 * （`ai_log` 技术日志）分工：那边是「这次为什么失败」，这边是「用没被用起来」。
 *
 * ⚠️ 采纳率的含义：`adopt` 事件由各 AI 入口在「用户确认采纳产出」时上报，
 * 若还没接采纳上报的功能，采纳率会显示为 0 —— 这是**真实数据**，不伪造。
 */

/** 意图 → 中文（单一产地 AI_INTENT_LABELS，G7；补历史旧值兜底） */
const INTENT_LABEL: Record<string, string> = {
  ...AI_INTENT_LABELS,
  test: "连接测试",
  generate: "生成（旧）",
};

/** 百分比展示：0.333 → 33%；NaN / 空值归一为 0 */
function percent(rate: number): string {
  const value = Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) : 0;
  return `${value}%`;
}

/** 平均耗时展示：毫秒 → 秒，保留 1 位；0 显示「-」 */
function durationText(ms: number): string {
  if (!ms || ms <= 0) return "-";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function UsagePanel() {
  const { message } = App.useApp();
  const [stats, setStats] = useState<AiEventStatsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await getAiEventStats();
      setStats(result);
    } catch {
      setStats(null);
      message.error("读取用量统计失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = useCallback(async (): Promise<void> => {
    setExporting(true);
    try {
      const result = await exportAiDiagnostics();
      if (result) {
        message.success("诊断包已导出");
      }
      // 用户取消保存框时 result 为 null，静默即可（不算错误）
    } catch {
      message.error("导出失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  }, [message]);

  const totalCalls = stats?.totalCalls ?? 0;
  const hasData = totalCalls > 0;

  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section__title">用量概览</h2>
        <div className="settings-section__body">
          {loading ? (
            <div className="settings-usage__loading">
              <Spin size="small" />
              <span>正在读取用量统计…</span>
            </div>
          ) : !stats ? (
            <Empty
              className="settings-usage__empty"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="无法读取用量统计，请稍后重试"
            />
          ) : (
            <>
              {/* 四项核心指标：调用次数 / 采纳率 / 平均耗时 / 功能种类 */}
              <div className="settings-usage__metrics">
                <div className="settings-usage__metric">
                  <span className="settings-usage__metric-value">{totalCalls}</span>
                  <span className="settings-usage__metric-label">近 30 天调用次数</span>
                </div>
                <div className="settings-usage__metric">
                  <span className="settings-usage__metric-value">
                    {percent(stats.adoptRate)}
                  </span>
                  <span className="settings-usage__metric-label">
                    采纳率（{stats.adoptCount} 次采纳）
                  </span>
                </div>
                <div className="settings-usage__metric">
                  <span className="settings-usage__metric-value">
                    {durationText(stats.avgDurationMs)}
                  </span>
                  <span className="settings-usage__metric-label">平均耗时</span>
                </div>
              </div>

              {/* 各 intent 分布：一次调用一行，右对齐次数 */}
              <div className="settings-usage__breakdown">
                {stats.byIntent.length === 0 ? (
                  <div className="settings-usage__breakdown-empty">
                    还没有 AI 调用记录，用一次起名或润色后这里会出现分布
                  </div>
                ) : (
                  stats.byIntent.map((row) => (
                    <div className="settings-usage__row" key={row.intent}>
                      <Tag className="settings-usage__intent">
                        {INTENT_LABEL[row.intent] ?? row.intent}
                      </Tag>
                      <span className="settings-usage__row-count">{row.calls} 次</span>
                      <span className="settings-usage__row-adopts">
                        采纳 {row.adopts}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* 诊断包导出：用户主动回传，本地看板之外的最小回流通道 */}
      <section className="settings-section">
        <h2 className="settings-section__title">诊断与回传</h2>
        <div className="settings-section__body">
          <div className="settings-item">
            <div className="settings-item__text">
              <span className="settings-item__label">导出诊断包</span>
              <span className="settings-item__hint">
                只含调用次数、耗时、错误码等元数据，不含正文、作品名与密钥；可回传给开发者排查
              </span>
            </div>
            <div className="settings-usage__tools">
              <Button
                className="settings-btn"
                onClick={() => void load()}
                loading={loading}
                disabled={!hasData}
              >
                <ReloadOutlined />
                刷新
              </Button>
              <Button
                className="settings-btn"
                onClick={() => void handleExport()}
                loading={exporting}
                disabled={!hasData}
              >
                <DownloadOutlined />
                导出诊断包
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
