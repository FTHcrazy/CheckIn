import { Modal, Radio } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import {
  COMPLIANCE_NOTICE,
  L3_SCOPE_LABELS,
  L3_SCOPE_ORDER,
  type L3Scope,
} from "@/shared/ai/ai-consent";
import type { AiProvider } from "@/shared/ai/ai-types";
import "./index.scss";

interface AiConsentDialogProps {
  open: boolean;
  /** 本次将发送的量（字数 / token），由调用方用 ai-estimate 算好传入。
   *  ⚠️ 必须与实际发送内容同源：范围改了这里要跟着变，否则「承诺 3000 字」的
   *  旧实现会再回来一次（review G4）。 */
  estimate: {
    chars: number;
    tokens: number;
  };
  /** 本次授权范围 */
  scope: L3Scope;
  onScopeChange: (scope: L3Scope) => void;
  /** 范围相关的补充说明（如「选中段落」但没选中任何内容） */
  notice?: string | null;
  /** 禁用「同意」（范围内没有可发送的内容时，不该让人点下去） */
  confirmDisabled?: boolean;
  /** 模型服务类型：本地 Ollama 时明确提示「内容不出本机」 */
  provider: AiProvider;
  /** 确认授权（打开 L3 总开关并继续本次调用） */
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 标题随范围变：范围决定「读的是什么」，标题就不能恒定写「本章」——
 * 「最近 3 章」的弹窗顶着「允许 AI 读取本章内容」同样是承诺与实现不一致。
 */
const SCOPE_TITLES: Record<L3Scope, string> = {
  chapter: "允许 AI 读取本章内容",
  selection: "允许 AI 读取选中的段落",
  recent3: "允许 AI 读取最近 3 章",
};

/**
 * L3 数据出境授权弹窗（M5，PRD §5.2 强制）。
 *
 * 首次触发任何 L3 功能（章节摘要 / 实体抽取 / 一致性校对 …）时弹出，
 * 说明：将发送什么、发给谁（用户配置的服务商）、是否可撤销；并提供
 * 本次范围选择（默认「仅本章」，不提供「全书」档）。
 *
 * 纯展示 + 回调：授权状态写入由上层（useAiConsent.enableL3）负责，
 * 本组件不碰 IPC。
 */
export default function AiConsentDialog({
  open,
  estimate,
  scope,
  onScopeChange,
  notice,
  confirmDisabled = false,
  provider,
  onConfirm,
  onCancel,
}: AiConsentDialogProps) {
  const isLocal = provider === "ollama";

  return (
    <Modal
      open={open}
      title={
        <span className="aic__title">
          <ThunderboltOutlined className="aic__icon" />
          {SCOPE_TITLES[scope]}
        </span>
      }
      onCancel={onCancel}
      onOk={onConfirm}
      okText="同意并继续"
      okButtonProps={{ disabled: confirmDisabled }}
      cancelText="取消"
      width={520}
      className="aic"
    >
      <div className="aic__body">
        <p className="aic__amount">
          本次将发送约 <strong>{estimate.chars}</strong> 字
          （≈ {estimate.tokens} tokens）。
        </p>

        <div className="aic__scope">
          <span className="aic__scope-label">本次范围</span>
          <Radio.Group
            value={scope}
            onChange={(event) => onScopeChange(event.target.value as L3Scope)}
          >
            {L3_SCOPE_ORDER.map((item) => (
              <Radio key={item} value={item}>
                {L3_SCOPE_LABELS[item]}
              </Radio>
            ))}
          </Radio.Group>
        </div>

        {notice ? <p className="aic__hint aic__hint--notice">{notice}</p> : null}

        {isLocal ? (
          <p className="aic__hint aic__hint--local">
            当前使用本地模型（Ollama），内容不出本机。
          </p>
        ) : (
          <p className="aic__hint">内容将发送至你配置的模型服务商。</p>
        )}

        <p className="aic__notice">{COMPLIANCE_NOTICE}</p>
      </div>
    </Modal>
  );
}
