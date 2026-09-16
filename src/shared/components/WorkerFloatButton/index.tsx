import { ToolOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import "./index.scss";

/**
 * WorkerFloatButton —— 主界面右下角的悬浮按钮
 *
 * 点击后请求主进程打开 WorkerWindow（即关即销的临时窗口）。
 * 窗口的创建/销毁由主进程负责，渲染层只发起请求。
 */
export default function WorkerFloatButton() {
  const handleOpen = () => {
    window.electronAPI?.send("worker-window-open", { type: "open" });
  };

  return (
    <Tooltip title="打开 Worker 窗口" placement="left">
      <button
        type="button"
        className="worker-float-btn"
        aria-label="打开 Worker 窗口"
        onClick={handleOpen}
      >
        <ToolOutlined className="worker-float-btn__icon" />
      </button>
    </Tooltip>
  );
}
