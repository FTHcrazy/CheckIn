import { Modal } from "antd";
import { ArrowRightOutlined, InfoCircleOutlined } from "@ant-design/icons";
import GuideTooltip from "@/shared/components/GuideTooltip";
import { consumeGuideTooltip } from "../../../../store/useGuideStore";
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
      title={
        <span className="nv-reorder__title">
          {title}
          {/*
           * T-07：首次弹出时补一句「这个确认是防误触排序的，可在排版与偏好里关掉」。
           * 锚点常驻标题旁（气泡只出现一次，消费走窗口 store），所以这里不放
           * 「一次性」的东西——图标本身就是说明入口，一直看得见。
           */}
          <GuideTooltip id="T-07" consume={() => consumeGuideTooltip("T-07")}>
            <InfoCircleOutlined
              className="nv-reorder__title-hint"
              aria-label="排序确认说明"
            />
          </GuideTooltip>
        </span>
      }
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
