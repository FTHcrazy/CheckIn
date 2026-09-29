import { Button, Modal } from "antd";
import "./index.scss";

interface CloseGuardModalProps {
  open: boolean;
  dirty: number;
  saving: boolean;
  onSaveAndClose: () => void;
  onDiscardAndClose: () => void;
  onCancel: () => void;
}

/**
 * 关闭拦截三选一（G-2）
 *
 * 默认焦点落在「保存并关闭」而不是「丢弃改动」—— 安全侧优先（§8.6.3）。
 * 「丢弃改动」是破坏性动作：警示色 + 非默认焦点。
 */
export default function CloseGuardModal({
  open,
  dirty,
  saving,
  onSaveAndClose,
  onDiscardAndClose,
  onCancel,
}: CloseGuardModalProps) {
  return (
    <Modal
      open={open}
      title="有改动未保存"
      centered
      width={360}
      closable={false}
      maskClosable={false}
      onCancel={onCancel}
      footer={
        <div className="cpk-guard__footer">
          <Button onClick={onCancel}>取消</Button>
          <Button danger onClick={onDiscardAndClose}>
            丢弃改动
          </Button>
          <Button type="primary" autoFocus loading={saving} onClick={onSaveAndClose}>
            保存并关闭
          </Button>
        </div>
      }
    >
      <p className="cpk-guard__text">
        当前有 <b>{dirty}</b> 处改动尚未提交。
      </p>
      <p className="cpk-guard__sub">
        草稿已持久化，即使直接丢弃也可以从「盘点记录」找回上一次保存的版本。
      </p>
    </Modal>
  );
}
