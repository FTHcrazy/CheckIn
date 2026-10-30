import {
  CheckCircleFilled,
  CloseCircleFilled,
  InfoCircleFilled,
  WarningFilled,
} from "@ant-design/icons";
import type { ToastPayload } from "../../hooks/useNovelViewState";
import "./index.scss";

interface NovelToastProps {
  toast: ToastPayload | null;
}

// tone 集合随共享 hook 收口后含 error（P3-3）；编辑器当前不弹 error，
// 图标先备齐，样式走 warning 同色系
const ICONS = {
  success: <CheckCircleFilled />,
  info: <InfoCircleFilled />,
  warning: <WarningFilled />,
  error: <CloseCircleFilled />,
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
