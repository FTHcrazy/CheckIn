import {
  DeleteOutlined,
  FolderAddOutlined,
  PushpinFilled,
  PushpinOutlined,
  RollbackOutlined,
} from "@ant-design/icons";
import { Dropdown, Popconfirm, Tooltip } from "antd";
import { formatDayLabel } from "../../bookshelf-utils";
import type { NovelNoteDTO } from "@/shared/types/electron";
import "./index.scss";

interface IdeaNoteCardProps {
  note: NovelNoteDTO;
  /** 所属作品名；null = 未归属 */
  workName: string | null;
  /** 归档目标选项（未归属卡的「归档到…」菜单） */
  workOptions: Array<{ id: string; name: string }>;
  onTogglePin: () => void;
  onArchiveTo: (workId: string) => void;
  onUnassign: () => void;
  onRemove: () => void;
}

/**
 * 灵感卡（R32 全局灵感库）：内容 + 来源归属 chip + 相对时间，
 * 悬浮操作：置顶 / 归档到作品（未归属）或退回灵感池（已归档）/ 删除。
 */
export default function IdeaNoteCard({
  note,
  workName,
  workOptions,
  onTogglePin,
  onArchiveTo,
  onUnassign,
  onRemove,
}: IdeaNoteCardProps) {
  const unassigned = workName === null;

  return (
    <div className={`bs-idea${note.pinned ? " is-pinned" : ""}`}>
      <p className="bs-idea__content">{note.content}</p>

      <div className="bs-idea__footer">
        <span className={`bs-idea__source bs-idea__source--${unassigned ? "unassigned" : "work"}`}>
          {unassigned ? "未归属" : `来自《${workName}》`}
        </span>
        <span className="bs-idea__time">{formatDayLabel(note.createdAt)}</span>
      </div>

      <div className="bs-idea__actions">
        <Tooltip title={note.pinned ? "取消置顶" : "置顶"}>
          <button
            type="button"
            className={`bs-idea__action${note.pinned ? " is-on" : ""}`}
            onClick={onTogglePin}
            aria-label={note.pinned ? "取消置顶" : "置顶"}
          >
            {note.pinned ? <PushpinFilled /> : <PushpinOutlined />}
          </button>
        </Tooltip>

        {unassigned ? (
          <Dropdown
            trigger={["click"]}
            disabled={workOptions.length === 0}
            menu={{
              items: workOptions.map((work) => ({
                key: work.id,
                label: `归档到《${work.name}》`,
              })),
              onClick: ({ key }) => onArchiveTo(String(key)),
            }}
          >
            <Tooltip title={workOptions.length === 0 ? "先创建作品再归档" : "归档到作品"}>
              <button
                type="button"
                className="bs-idea__action"
                aria-label="归档到作品"
              >
                <FolderAddOutlined />
              </button>
            </Tooltip>
          </Dropdown>
        ) : (
          <Tooltip title="退回灵感池">
            <button
              type="button"
              className="bs-idea__action"
              onClick={onUnassign}
              aria-label="退回灵感池"
            >
              <RollbackOutlined />
            </button>
          </Tooltip>
        )}

        <Popconfirm
          title="删除这条灵感？"
          okText="删除"
          cancelText="取消"
          onConfirm={onRemove}
        >
          <Tooltip title="删除">
            <button type="button" className="bs-idea__action" aria-label="删除灵感">
              <DeleteOutlined />
            </button>
          </Tooltip>
        </Popconfirm>
      </div>
    </div>
  );
}
