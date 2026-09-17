import { ToolOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import "./index.scss";

interface WorkerFloatButtonProps {
  /**
   * float：窗口右下角悬浮圆钮（默认）
   * inline：嵌入侧边栏的方形图标钮，不脱离文档流
   */
  variant?: "float" | "inline";
}

/**
 * WorkerFloatButton —— 打开 WorkerWindow（即关即销的临时窗口）的入口
 *
 * 窗口的创建/销毁由主进程负责，渲染层只发起请求。
 * 默认悬浮在右下角；首页侧边栏改用 `variant="inline"` 内嵌，避免两个悬浮入口并存。
 */
export default function WorkerFloatButton({
  variant = "float",
}: WorkerFloatButtonProps) {
  const handleOpen = () => {
    window.electronAPI?.send("worker-window-open", { type: "open" });
  };

  const isInline = variant === "inline";

  return (
    <Tooltip
      title="打开 Worker 窗口"
      placement={isInline ? "right" : "left"}
    >
      <button
        type="button"
        className={
          isInline ? "worker-btn worker-btn--inline" : "worker-btn worker-btn--float"
        }
        aria-label="打开 Worker 窗口"
        onClick={handleOpen}
      >
        <ToolOutlined className="worker-btn__icon" />
      </button>
    </Tooltip>
  );
}
