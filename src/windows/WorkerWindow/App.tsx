import { Button, Empty, Typography } from "antd";
import { CloseOutlined, ToolOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { registerWorkerWindowBridge } from "@/shared/ipc/workerWindowBridge";

const { Text } = Typography;

/**
 * WorkerWindow —— 即关即销的临时工作窗口
 *
 * 特性：
 * - `frame: false` 无系统边框，自带拖动区与关闭按钮
 * - 窗口关闭即销毁（主进程 destroy），不驻留内存
 * - 不持有任何业务状态，关闭后重新打开即全新实例
 */
export default function WorkerWindowApp() {
  const [closing, setClosing] = useState(false);

  // 注册关闭桥接，拿到向主进程请求关闭的函数
  const [closeWindow] = useState(() => registerWorkerWindowBridge());

  // Esc 快捷关闭，符合临时窗口的操作直觉
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setClosing(true);
      closeWindow();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeWindow]);

  return (
    <div className="worker-window">
      {/* 无边框窗口的拖动条 */}
      <header className="worker-titlebar">
        <div className="worker-titlebar__drag">
          <ToolOutlined className="worker-titlebar__icon" />
          <span className="worker-titlebar__title">Worker</span>
        </div>
        <Button
          className="worker-titlebar__close"
          type="text"
          size="small"
          aria-label="关闭"
          icon={<CloseOutlined />}
          onClick={() => {
            setClosing(true);
            closeWindow();
          }}
        />
      </header>

      <main className="worker-body">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div className="worker-body__empty">
              <Text>临时工作窗口</Text>
              <Text type="secondary" className="worker-body__hint">
                {closing ? "正在关闭…" : "按 Esc 或点击右上角即可关闭"}
              </Text>
            </div>
          }
        />
      </main>
    </div>
  );
}
