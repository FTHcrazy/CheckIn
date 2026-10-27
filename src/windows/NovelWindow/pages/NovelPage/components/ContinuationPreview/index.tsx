import { Button } from "antd";
import {
  CloseOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import "./index.scss";

interface ContinuationPreviewProps {
  /** 候选列表（每条是一段续写正文） */
  candidates: string[];
  /** 是否正在请求 AI */
  loading: boolean;
  /** 错误信息；非空时展示错误态 */
  error: string | null;
  /** 确认某个候选（插入光标处） */
  onConfirm: (text: string) => void;
  /** 换一批（重新续写） */
  onRetry: () => void;
  /** 关闭浮层（不写入） */
  onClose: () => void;
}

/**
 * AI 续写候选浮层（R-AI-07）
 *
 * 光标处触发「续写」后弹出：列出 2–3 个续写候选，点某一条即插入光标处
 * （走编辑器 `insertText`，可 Ctrl+Z 撤销）。候选是**跳板不是代笔**——
 * 显眼标注「AI 建议，请自行改写」。
 *
 * 本组件是纯展示 + 回调：AI 请求、光标定位、插入动作全部由上层（useNovelPage）
 * 编排，组件不接触编辑器 / AI 服务层。
 */
export default function ContinuationPreview({
  candidates,
  loading,
  error,
  onConfirm,
  onRetry,
  onClose,
}: ContinuationPreviewProps) {
  return (
    <>
      {/* 点外部关闭：铺满 stage 的透明捕获层 */}
      <div className="nv-cont__mask" aria-hidden="true" onClick={onClose} />
      <div className="nv-cont" role="dialog" aria-label="AI 续写候选">
        <div className="nv-cont__head">
          <span className="nv-cont__title">
            <ThunderboltOutlined /> AI 续写
          </span>
          <Button className="nv-cont__close" aria-label="关闭" onClick={onClose}>
            <CloseOutlined />
          </Button>
        </div>

        <p className="nv-cont__hint">AI 建议，请自行改写</p>

        <div className="nv-cont__body">
          {loading ? (
            <div className="nv-cont__text is-loading">正在续写…</div>
          ) : error ? (
            <div className="nv-cont__text is-error">{error}</div>
          ) : (
            <div className="nv-cont__list">
              {candidates.map((text, index) => (
                <button
                  key={index}
                  type="button"
                  className="nv-cont__candidate"
                  onClick={() => onConfirm(text)}
                  title="点击插入到光标处"
                >
                  <span className="nv-cont__candidate-text">{text}</span>
                  <span className="nv-cont__candidate-go">插入</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="nv-cont__foot">
          {error ? (
            <Button className="nv-cont__retry" onClick={onRetry}>
              <ReloadOutlined />
              重试
            </Button>
          ) : (
            <Button
              className="nv-cont__regen"
              onClick={onRetry}
              disabled={loading}
              title="换一批续写方向"
            >
              <ReloadOutlined />
              换一批
            </Button>
          )}
          <span className="nv-cont__spacer" />
          <Button className="nv-cont__cancel" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </>
  );
}
