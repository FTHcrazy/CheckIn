/**
 * 设定中心 · 另存为模板弹窗（UI-10 拆分）
 *
 * 单字段弹窗：输入模板名后保存到模板库。无独立样式，复用 antd 默认外观。
 */

import { Input, Modal } from "antd";

export interface SaveTemplateModalProps {
  open: boolean;
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function SaveTemplateModal({
  open,
  name,
  onNameChange,
  onSubmit,
  onCancel,
}: SaveTemplateModalProps) {
  return (
    <Modal
      open={open}
      title="另存为模板"
      okText="保存"
      cancelText="取消"
      onOk={onSubmit}
      onCancel={onCancel}
    >
      <Input
        value={name}
        placeholder="模板名，如「通用修仙体系」"
        aria-label="模板名"
        onChange={(event) => onNameChange(event.target.value)}
      />
    </Modal>
  );
}
