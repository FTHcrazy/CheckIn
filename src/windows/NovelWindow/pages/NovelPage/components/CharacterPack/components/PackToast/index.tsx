import type { PackToastState } from "../../hooks/usePackPanel";
import "./index.scss";

interface PackToastProps {
  toast: PackToastState | null;
}

/** 行囊轻提示（2.6s 自动消失，pointer-events:none 不阻塞输入） */
export default function PackToast({ toast }: PackToastProps) {
  if (!toast) return null;
  return (
    <div className={`cpk-toast is-${toast.tone}`} role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}
