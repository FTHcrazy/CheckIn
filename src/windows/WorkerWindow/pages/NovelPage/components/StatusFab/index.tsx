import { Tooltip } from "antd";
import "./index.scss";

interface StatusFabProps {
  open: boolean;
  onToggle: () => void;
}

/** R1 悬浮入口：编辑区右下角圆形按钮，浮于正文之上、不依附左右侧栏、不占布局流 */
export default function StatusFab({ open, onToggle }: StatusFabProps) {
  return (
    <Tooltip title="主角属性面板" placement="left" mouseEnterDelay={0.3}>
      <button
        type="button"
        className={`nv-status-fab${open ? " is-open" : ""}`}
        aria-label="主角属性面板"
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="6.2" r="3.1" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M3.6 16.4c.9-2.9 3.4-4.4 6.4-4.4s5.5 1.5 6.4 4.4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M14.6 3.2v3.4M12.9 4.9h3.4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </Tooltip>
  );
}
