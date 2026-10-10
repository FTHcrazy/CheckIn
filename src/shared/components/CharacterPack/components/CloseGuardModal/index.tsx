import { Button, Modal } from "antd";
import "./index.scss";

interface CloseGuardModalProps {
  open: boolean;
  dirty: number;
  saving: boolean;
  /** 请求来源（「关闭行囊」/「切换章节」/「退出应用」…），决定这弹窗在说什么事 */
  reason: string;
  onSaveAndProceed: () => void;
  onDiscardAndProceed: () => void;
  onCancel: () => void;
}

/**
 * 未保存拦截三选一（G-2 / REQ-043）
 *
 * 一个弹窗服务四件事：关闭面板、切章、切作品、退出应用。它们共用同一份
 * 「有 N 处改动未提交」的判断与同一组出路 —— 分成四个弹窗只会让文案各说各话。
 *
 * 默认焦点落在「保存并继续」而不是「丢弃改动」—— 安全侧优先（§8.6.3）。
 * 「丢弃改动」是破坏性动作：警示色 + 非默认焦点。
 */
export default function CloseGuardModal({
  open,
  dirty,
  saving,
  reason,
  onSaveAndProceed,
  onDiscardAndProceed,
  onCancel,
}: CloseGuardModalProps) {
  return (
    <Modal
      open={open}
      title="有改动未保存"
      centered
      width={380}
      closable={false}
      maskClosable={false}
      onCancel={onCancel}
      footer={
        <div className="cpk-guard__footer">
          <Button onClick={onCancel}>取消</Button>
          <Button danger onClick={onDiscardAndProceed}>
            丢弃改动
          </Button>
          <Button type="primary" autoFocus loading={saving} onClick={onSaveAndProceed}>
            保存并继续
          </Button>
        </div>
      }
    >
      <p className="cpk-guard__text">
        {reason}前有 <b>{dirty}</b> 处改动尚未提交。
      </p>
      <p className="cpk-guard__sub">
        草稿已持久化，即使直接丢弃也可以从「盘点记录」找回上一次保存的版本。
      </p>
    </Modal>
  );
}
