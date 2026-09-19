import { CheckCircleFilled, InfoCircleFilled, WarningFilled } from "@ant-design/icons";
import type { ToastPayload } from "../../hooks/useNovelViewState";
import "./index.scss";

interface NovelToastProps {
  toast: ToastPayload | null;
}

const ICONS = {
  success: <CheckCircleFilled />,
  info: <InfoCircleFilled />,
  warning: <WarningFilled />,
};

/**
 * 轻提示（设计方案 §06）
 *
 * 底部居中、2.4s 自动消失、pointer-events:none 不阻塞点击。
 * 这是本项目唯一的「反馈」形态——码字路径上永不出现模态对话框。
 */
export default function NovelToast({ toast }: NovelToastProps) {
  if (!toast) return null;

  return (
    <div className={`nv-toast nv-toast--${toast.tone}`} role="status">
      {ICONS[toast.tone]}
      <span>{toast.text}</span>
    </div>
  );
}
