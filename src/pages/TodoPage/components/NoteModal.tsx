import { Input, Modal } from "antd";

export interface NoteModalProps {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onOk: () => void;
}

function NoteModal({ open, value, onChange, onCancel, onOk }: NoteModalProps) {
  return (
    <Modal
      title="添加备注"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="确定"
      cancelText="取消"
    >
      <Input.TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="请输入备注内容"
        autoSize={{ minRows: 3, maxRows: 6 }}
        spellCheck={false}
      />
    </Modal>
  );
}

export default NoteModal;
