import { Button, Checkbox, Popconfirm, Tooltip } from "antd";
import { DeleteOutlined, UndoOutlined } from "@ant-design/icons";
import type { NovelTrashItemDTO } from "@/shared/types/electron";
import {
  daysLeftInfo,
  TRASH_KIND_LABEL,
  trashMetaText,
} from "../../recycle-bin-utils";
import "./index.scss";

interface TrashRowProps {
  item: NovelTrashItemDTO;
  selected: boolean;
  /** 本条正在恢复 / 删除（批量操作期间为 false —— 那是整页的忙，不是某一行） */
  busy: boolean;
  onToggle: (checked: boolean) => void;
  onRestore: () => void;
  onPurge: () => void;
}

/**
 * 回收站条目行。
 *
 * 行本身不可点（勾选 / 恢复 / 彻底删除是三个独立动作），所以整行不是 Button，
 * 只有右侧两颗真按钮 —— 避免「点中间也算恢复」这种误触。
 */
export default function TrashRow({
  item,
  selected,
  busy,
  onToggle,
  onRestore,
  onPurge,
}: TrashRowProps) {
  const days = daysLeftInfo(item);
  const kindLabel = TRASH_KIND_LABEL[item.kind];
  const meta = trashMetaText(item);

  return (
    <li className={`rb-row${selected ? " is-selected" : ""}`}>
      <Checkbox
        className="rb-row__pick"
        checked={selected}
        onChange={(event) => onToggle(event.target.checked)}
        aria-label={`选择${kindLabel}「${item.name}」`}
      />
      <span className={`rb-row__kind rb-row__kind--${item.kind}`}>{kindLabel}</span>

      <div className="rb-row__main">
        {/* 名称可能很长：单行省略，完整名走 title（悬停可见） */}
        <span className="rb-row__name" title={item.name}>
          {item.name}
        </span>
        <span className="rb-row__meta">{meta}</span>
      </div>

      <Tooltip
        title={
          days.urgency === "urgent"
            ? `超过 ${days.text === "已过期" ? "保留期" : "今天"}就会被彻底删除`
            : "超过保留期会被彻底删除"
        }
      >
        <span className={`rb-row__days rb-row__days--${days.urgency}`}>
          {days.text}
        </span>
      </Tooltip>

      <div className="rb-row__actions">
        <Button
          className="rb-row__restore"
          size="small"
          icon={<UndoOutlined />}
          loading={busy}
          onClick={onRestore}
        >
          恢复
        </Button>
        <Popconfirm
          title={`彻底删除${kindLabel}「${item.name}」？`}
          description={
            item.kind === "work"
              ? "卷章正文、要素、设定与行囊将一并销毁，无法恢复。"
              : "正文与全部历史快照将一并销毁，无法恢复。"
          }
          okText="彻底删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={onPurge}
        >
          <Button
            className="rb-row__purge"
            size="small"
            icon={<DeleteOutlined />}
            disabled={busy}
          >
            彻底删除
          </Button>
        </Popconfirm>
      </div>
    </li>
  );
}
