import { Button } from "antd";
import { CheckOutlined, CloseOutlined, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import "./index.scss";

interface SummaryPreviewProps {
  /** 摘要生成结果（成功后落库，这里展示）；null = 加载中 / 无结果 */
  result: string | null;
  loading: boolean;
  error: string | null;
  /** 来源模型名（M6 溯源标记；空 = 未知） */
  model?: string;
  /** 重新生成 */
  onRegenerate: () => void;
  /** 关闭（结果已落库，关闭只是收起浮层） */
  onClose: () => void;
}

/**
 * 章节摘要预览浮层（R-AI-09）。
 *
 * 生成成功后立即落库（`ai_summary` + 来源标记），本浮层只做「展示 + 告知」：
 * 显眼标注「AI 生成」与模型名，让用户能区分 AI 摘要与自己写的备注。
 * 纯展示 + 回调，不碰 IPC。
 */
export default function SummaryPreview({
  result,
  loading,
  error,
  model,
  onRegenerate,
  onClose,
}: SummaryPreviewProps) {
  return (
    <>
      {/* 点外部关闭：铺满 stage 的透明捕获层 */}
      <div className="nv-summary__mask" aria-hidden="true" onClick={onClose} />
      <div className="nv-summary" role="dialog" aria-label="本章摘要">
        <div className="nv-summary__head">
          <span className="nv-summary__title">
            <ThunderboltOutlined /> 本章摘要
          </span>
          <Button className="nv-summary__close" aria-label="关闭" onClick={onClose}>
            <CloseOutlined />
          </Button>
        </div>

        <div className="nv-summary__body">
          {loading ? (
            <p className="nv-summary__loading">正在生成摘要…</p>
          ) : error ? (
            <p className="nv-summary__error">{error}</p>
          ) : result ? (
            <div className="nv-summary__content">
              <p className="nv-summary__text">{result}</p>
              <p className="nv-summary__meta">
                <ThunderboltOutlined /> AI 生成
                {model ? ` · 模型 ${model}` : ""}
              </p>
            </div>
          ) : null}
        </div>

        <div className="nv-summary__foot">
          {error ? (
            <Button className="nv-summary__retry" onClick={onRegenerate}>
              <ReloadOutlined />
              重试
            </Button>
          ) : (
            <Button
              className="nv-summary__regen"
              onClick={onRegenerate}
              disabled={loading}
              title="重新生成摘要"
            >
              <ReloadOutlined />
              重新生成
            </Button>
          )}
          <span className="nv-summary__spacer" />
          <Button type="primary" className="nv-summary__confirm" onClick={onClose}>
            <CheckOutlined />
            知道了
          </Button>
        </div>
      </div>
    </>
  );
}
