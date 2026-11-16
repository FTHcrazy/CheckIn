/**
 * 切书横幅（S2）
 *
 * 主窗口切了作品，本窗口**不静默跟随**：正在看《A》的人不该在毫无提示的情况下
 * 发现画布换成了《B》—— 尤其当他刚摆好位置、还没意识到窗口里已经是另一本书。
 *
 * 所以只提示、不自动切：用户点「切到《B》」才换（换之前会先把当前书的坐标写掉）。
 * 这是「不静默」的最小实现，也是唯一不会丢用户手工成果的做法。
 */
import { Alert, Button, Space } from "antd";
import "./index.scss";

export interface WorkSwitchBannerProps {
  /** 当前正在看的作品名 */
  currentName: string;
  /** 主窗口已经切到的作品名 */
  pendingName: string;
  /** 当前书还有没落库的坐标改动 */
  dirty: boolean;
  onAdopt: () => void;
  onDismiss: () => void;
}

export default function WorkSwitchBanner({
  currentName,
  pendingName,
  dirty,
  onAdopt,
  onDismiss,
}: WorkSwitchBannerProps) {
  return (
    <Alert
      className="rel-switch"
      type="warning"
      showIcon
      message={`当前查看《${currentName}》，主窗口已切到《${pendingName}》`}
      description={dirty ? "当前这本的节点位置还有改动未保存，切换前会先保存。" : undefined}
      action={
        <Space size={6}>
          <Button size="small" type="primary" onClick={onAdopt}>
            切到《{pendingName}》
          </Button>
          <Button size="small" onClick={onDismiss}>
            留在这本
          </Button>
        </Space>
      }
    />
  );
}
