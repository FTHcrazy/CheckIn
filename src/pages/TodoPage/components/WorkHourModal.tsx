import { InputNumber, Modal } from "antd";

export interface WorkHourModalProps {
  open: boolean;
  value: number | null;
  onChange: (value: number | null) => void;
  onCancel: () => void;
  onSave: (value: number | null) => void;
}

function WorkHourModal({
  open,
  value,
  onChange,
  onCancel,
  onSave,
}: WorkHourModalProps) {
  return (
    <Modal
      title="工时"
      open={open}
      onCancel={onCancel}
      footer={null}
      centered
      destroyOnHidden
    >
      <InputNumber
        min={0}
        step={0.5}
        precision={1}
        value={value}
        placeholder="请输入工时（h）"
        style={{ width: "100%" }}
        autoFocus
        onChange={(nextValue) => onChange(nextValue ?? null)}
        onPressEnter={() => onSave(value)}
        onBlur={() => onSave(value)}
      />
    </Modal>
  );
}

export default WorkHourModal;
