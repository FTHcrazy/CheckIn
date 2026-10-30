import { Button } from "antd";
import {
  CloseOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useTypewriter } from "./useTypewriter";
import "./index.scss";

interface ContinuationPreviewProps {
  /** 已流式生成的续写正文（逐字 append 到这里） */
  text: string;
  /** 是否正在流式生成（逐字输出中） */
  streaming: boolean;
  /** 是否正在建立连接（尚未产出首字） */
  loading: boolean;
  /** 错误信息；非空时展示错误态 */
  error: string | null;
  /** 确认插入（光标处） */
  onConfirm: (text: string) => void;
  /** 中断当前流式生成（保留已生成部分） */
  onStop: () => void;
  /** 重新生成（中断当前流，重新发起） */
  onRetry: () => void;
  /** 关闭浮层（不写入） */
  onClose: () => void;
}

/**
 * AI 续写浮层（R-AI-07 / B5 流式版）
 *
 * 光标处触发「续写」后弹出：AI 顺着前文**逐字流式**往下写一段，作者可随时
 * 中断保留已生成部分，确认后插入光标处（走编辑器 `insertText`，可 Ctrl+Z
 * 撤销）。定位是**跳板不是代笔**——显眼标注「AI 建议，请自行改写」。
 *
 * 本组件是纯展示 + 回调：AI 请求、流式读取、光标定位、插入动作全部由上层
 * （useNovelPage）编排，组件不接触编辑器 / AI 服务层。
 */
export default function ContinuationPreview({
  text,
  streaming,
  loading,
  error,
  onConfirm,
  onStop,
  onRetry,
  onClose,
}: ContinuationPreviewProps) {
  const hasText = text.trim().length > 0;
  // 逐字上屏：网络块可能一次就是半段，这里摊平成打字机（REQ-058）
  const { shown, revealing } = useTypewriter(text);
  // 还没揭示完（或流还在跑）就显示光标；插入按钮等全部揭示完才可用，
  // 否则作者点了「插入」会看到浮层里只有半截字、正文却整段插进去
  const writing = streaming || revealing;

  return (
    <>
      {/* 点外部关闭：铺满 stage 的透明捕获层 */}
      <div className="nv-cont__mask" aria-hidden="true" onClick={onClose} />
      <div className="nv-cont" role="dialog" aria-label="AI 续写">
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
          {loading && !hasText ? (
            <div className="nv-cont__text is-loading">正在续写…</div>
          ) : error && !hasText ? (
            <div className="nv-cont__text is-error">{error}</div>
          ) : (
            <div className="nv-cont__text">
              {hasText ? (
                <>
                  {shown}
                  {/* 还在上屏：末尾给一个闪烁光标，暗示「还在写」 */}
                  {writing && <span className="nv-cont__caret" aria-hidden="true" />}
                </>
              ) : (
                "（本次没有产出续写内容）"
              )}
            </div>
          )}
        </div>

        <div className="nv-cont__foot">
          {streaming ? (
            <Button className="nv-cont__regen" onClick={onStop} title="停止生成，保留已生成部分">
              停止
            </Button>
          ) : error ? (
            <Button className="nv-cont__retry" onClick={onRetry}>
              <ReloadOutlined />
              重试
            </Button>
          ) : (
            <Button
              className="nv-cont__regen"
              onClick={onRetry}
              disabled={loading}
              title="重新生成续写"
            >
              <ReloadOutlined />
              重新生成
            </Button>
          )}
          <span className="nv-cont__spacer" />
          <Button
            className="nv-cont__confirm"
            onClick={() => onConfirm(text)}
            disabled={!hasText || writing}
            title={
              !hasText
                ? "还没有可插入的内容"
                : writing
                  ? "等文字上屏完再插入"
                  : "插入到光标处"
            }
          >
            插入
          </Button>
          <Button className="nv-cont__cancel" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </>
  );
}
