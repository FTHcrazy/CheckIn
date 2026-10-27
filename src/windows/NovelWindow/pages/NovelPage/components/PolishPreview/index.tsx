import { Button } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { TRANSFORM_KIND_LABELS, type TransformKind } from "@/shared/ai/context";
import "./index.scss";

interface PolishPreviewProps {
  /** 选中的原文（待变换文本） */
  original: string;
  /** 变换后的结果；null = 加载中 */
  polished: string | null;
  /** 是否正在请求 AI */
  loading: boolean;
  /** 错误信息；非空时展示错误态 */
  error: string | null;
  /** 当前预览身份：`"polish"` = 润色，其余 = 某种文本变换（决定标题与文案） */
  mode: "polish" | TransformKind;
  /** 确认替换（把变换结果回填到原区间） */
  onConfirm: () => void;
  /** 重新变换（再次请求） */
  onRetry: () => void;
  /** 关闭预览（不替换） */
  onClose: () => void;
}

/**
 * AI 润色 / 文本变换预览（R-AI-03 / R-AI-06 对比预览形态）
 *
 * 划词右键「润色这段文字」或五种变换后弹出：左列原句、右列结果，
 * 用户确认后才替换，避免 AI 结果直接覆盖原文。
 *
 * 本组件是纯展示 + 回调：AI 请求、选区记录、替换动作全部由上层
 * （useNovelPage）编排，组件不接触编辑器 / AI 服务层。
 */
export default function PolishPreview({
  original,
  polished,
  loading,
  error,
  mode,
  onConfirm,
  onRetry,
  onClose,
}: PolishPreviewProps) {
  const title = mode === "polish" ? "AI 润色" : `AI ${TRANSFORM_KIND_LABELS[mode]}`;
  const resultLabel = mode === "polish" ? "润色后" : `${TRANSFORM_KIND_LABELS[mode]}后`;
  const loadingLabel = mode === "polish" ? "正在润色…" : `正在${TRANSFORM_KIND_LABELS[mode]}…`;
  const retryTitle = mode === "polish" ? "换一种润色方式" : `换一种${TRANSFORM_KIND_LABELS[mode]}方式`;

  return (
    <>
      {/* 点外部关闭：铺满 stage 的透明捕获层 */}
      <div className="nv-polish__mask" aria-hidden="true" onClick={onClose} />
      <div className="nv-polish" role="dialog" aria-label={title}>
        <div className="nv-polish__head">
          <span className="nv-polish__title">
            <ThunderboltOutlined /> {title}
          </span>
          <Button
            className="nv-polish__close"
            aria-label="关闭"
            onClick={onClose}
          >
            <CloseOutlined />
          </Button>
        </div>

        <div className="nv-polish__body">
          <div className="nv-polish__col">
            <span className="nv-polish__col-label">原文</span>
            <div className="nv-polish__text">{original}</div>
          </div>

          <div className="nv-polish__col is-polished">
            <span className="nv-polish__col-label">{resultLabel}</span>
            {loading ? (
              <div className="nv-polish__text is-loading">{loadingLabel}</div>
            ) : error ? (
              <div className="nv-polish__text is-error">{error}</div>
            ) : polished ? (
              <div className="nv-polish__text">{polished}</div>
            ) : null}
          </div>
        </div>

        <div className="nv-polish__foot">
          {error ? (
            <Button className="nv-polish__retry" onClick={onRetry}>
              <ReloadOutlined />
              重试
            </Button>
          ) : (
            <Button
              className="nv-polish__regen"
              onClick={onRetry}
              disabled={loading}
              title={retryTitle}
            >
              <ReloadOutlined />
              换一种
            </Button>
          )}
          <span className="nv-polish__spacer" />
          <Button className="nv-polish__cancel" onClick={onClose}>
            取消
          </Button>
          <Button
            type="primary"
            className="nv-polish__confirm"
            onClick={onConfirm}
            disabled={!polished || loading}
          >
            <CheckOutlined />
            替换原文
          </Button>
        </div>
      </div>
    </>
  );
}
