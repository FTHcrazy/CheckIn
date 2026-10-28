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
  /** 本次摘要采用的数据范围（L3 授权范围标签）；空 = 未记录 */
  scopeLabel?: string;
  /** 模型给的「一句话梗概」（回填大纲用）；空 = 本次没产出 */
  oneLiner?: string;
  /** 本章已有手写梗概（非空 = 待确认覆盖，此时尚未写入） */
  noteConflict?: string;
  /** 一句话是否已写进大纲梗概 */
  noteApplied?: boolean;
  /** 确认用 AI 一句话覆盖已有手写梗概 */
  onApplyNote?: () => void;
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
  scopeLabel,
  oneLiner,
  noteConflict,
  noteApplied,
  onApplyNote,
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
                {scopeLabel ? ` · 范围 ${scopeLabel}` : ""}
              </p>

              {/* 大纲回流：一句话梗概展示 + 手写冲突确认。
                  长摘要留在这里，一句话落进右栏大纲，两个粒度各归其位 */}
              {oneLiner ? (
                <div className="nv-summary__note">
                  <p className="nv-summary__note-head">一句话梗概</p>
                  <p className="nv-summary__note-text">{oneLiner}</p>
                  {noteConflict ? (
                    <div className="nv-summary__note-conflict">
                      <span className="nv-summary__note-existing">
                        本章已有手写梗概：{noteConflict}
                      </span>
                      <Button className="nv-summary__note-apply" onClick={onApplyNote}>
                        覆盖为这句
                      </Button>
                    </div>
                  ) : noteApplied ? (
                    <p className="nv-summary__note-done">
                      已填入大纲 · 可在右栏「大纲」直接改
                    </p>
                  ) : null}
                </div>
              ) : null}
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
