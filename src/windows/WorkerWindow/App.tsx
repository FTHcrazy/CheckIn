import { Empty, Typography } from "antd";
import { ToolOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import WindowHeader from "@/shared/components/WindowHeader";

const { Text } = Typography;

/**
 * WorkerWindow —— 普通临时工作窗口
 *
 * 特性：
 * - 标准窗口：出现在任务栏，标题栏（WindowHeader）提供拖动与最小化/最大化/关闭
 * - 关闭即随实例销毁，不持有任何业务状态，重新打开即全新实例
 * - 支持 Esc 快捷关闭
 */
export default function WorkerWindowApp() {
  // Esc 快捷关闭，走通用窗口控制通道（与标题栏关闭按钮同一条链路）
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      window.electronAPI?.send("window-control", "close");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="window-shell">
      <WindowHeader title="Worker" icon={<ToolOutlined />} />
      <div className="window-shell__body">
        <main className="worker-body">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div className="worker-body__empty">
                <Text>临时工作窗口</Text>
                <Text type="secondary" className="worker-body__hint">
                  拖动标题栏可移动窗口，按 Esc 或点击右上角关闭
                </Text>
              </div>
            }
          />
        </main>
      </div>
    </div>
  );
}
