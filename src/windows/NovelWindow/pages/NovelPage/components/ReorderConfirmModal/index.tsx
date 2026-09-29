import { Modal } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import "./index.scss";

/** 一条序号变更：name 是章节名 / 卷名，from → to 是序号标签 */
export interface ReorderChange {
  id: string;
  name: string;
  from: string;
  to: string;
}

interface ReorderConfirmModalProps {
  open: boolean;
  title: string;
  changes: ReorderChange[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 防误触排序确认框（R9 增强）
 *
 * 拖拽放下后先展示「谁的序号会从几变成几」，确认才真正应用。
 * 列表可滚动，应对整卷顺延时的长清单。
 */
export default function ReorderConfirmModal({
  open,
  title,
  changes,
  onConfirm,
  onCancel,
}: ReorderConfirmModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      okText="确认调整"
      cancelText="取消"
      onOk={onConfirm}
      onCancel={onCancel}
      width={380}
      centered
      zIndex={1200}
    >
      <p className="nv-reorder__hint">
        本次拖拽将影响以下 {changes.length} 处序号：
      </p>
      <ul className="nv-reorder__list">
        {changes.map((change) => (
          <li key={change.id} className="nv-reorder__row">
            <span className="nv-reorder__name" title={change.name}>
              {change.name}
            </span>
            <span className="nv-reorder__from">{change.from}</span>
            <ArrowRightOutlined className="nv-reorder__arrow" />
            <span className="nv-reorder__to">{change.to}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
