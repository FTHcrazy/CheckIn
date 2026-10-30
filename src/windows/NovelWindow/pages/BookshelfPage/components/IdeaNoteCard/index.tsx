import { useState } from "react";
import type { KeyboardEvent } from "react";
import {
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  PushpinFilled,
  PushpinOutlined,
  RollbackOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Input, Popconfirm, Tooltip } from "antd";
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
  /** 编辑内容（1.41.0）：Enter 保存 · Shift+Enter 换行 · Esc 取消 */
  onUpdateContent: (content: string) => void;
  onRemove: () => void;
}

/**
 * 灵感卡（R32 全局灵感库）：内容 + 来源归属 chip + 相对时间，
 * 悬浮操作：置顶 / 编辑 / 归档到作品（未归属）或退回灵感池（已归档）/ 删除。
 */
export default function IdeaNoteCard({
  note,
  workName,
  workOptions,
  onTogglePin,
  onArchiveTo,
  onUnassign,
  onUpdateContent,
  onRemove,
}: IdeaNoteCardProps) {
  const unassigned = workName === null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(note.content);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const commitEdit = () => {
    setEditing(false);
    onUpdateContent(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      cancelEdit();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    commitEdit();
  };

  return (
    <div className={`bs-idea${note.pinned ? " is-pinned" : ""}`}>
      {editing ? (
        <div className="bs-idea__edit">
          <Input.TextArea
            variant="borderless"
            value={draft}
            autoFocus
            rows={3}
            aria-label="编辑灵感内容"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commitEdit}
          />
          <span className="bs-idea__edittip">Enter 保存 · Shift+Enter 换行 · Esc 取消</span>
        </div>
      ) : (
        <p className="bs-idea__content">{note.content}</p>
      )}

      <div className="bs-idea__footer">
        <span className={`bs-idea__source bs-idea__source--${unassigned ? "unassigned" : "work"}`}>
          {unassigned ? "未归属" : `来自《${workName}》`}
        </span>
        <span className="bs-idea__time">{formatDayLabel(note.createdAt)}</span>
      </div>

      {/* 悬浮操作栏：编辑态整条不渲染 —— 编辑时 TextArea 占满卡片，
          操作栏浮在上面既挡文本又容易误触（置顶 / 删除都在一拍之内） */}
      {!editing && (
        <div className="bs-idea__actions">
          <Tooltip title={note.pinned ? "取消置顶" : "置顶"}>
            <Button
              className={`bs-idea__action${note.pinned ? " is-on" : ""}`}
              onClick={onTogglePin}
              aria-label={note.pinned ? "取消置顶" : "置顶"}
            >
              {note.pinned ? <PushpinFilled /> : <PushpinOutlined />}
            </Button>
          </Tooltip>

          <Tooltip title="编辑">
            <Button className="bs-idea__action" onClick={startEdit} aria-label="编辑灵感">
              <EditOutlined />
            </Button>
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
                <Button
                  className="bs-idea__action"
                  aria-label="归档到作品"
                >
                  <FolderAddOutlined />
                </Button>
              </Tooltip>
            </Dropdown>
          ) : (
            <Tooltip title="退回灵感池">
              <Button
                className="bs-idea__action"
                onClick={onUnassign}
                aria-label="退回灵感池"
              >
                <RollbackOutlined />
              </Button>
            </Tooltip>
          )}

          <Popconfirm
            title="删除这条灵感？"
            okText="删除"
            cancelText="取消"
            onConfirm={onRemove}
          >
            <Tooltip title="删除">
              <Button className="bs-idea__action" aria-label="删除灵感">
                <DeleteOutlined />
              </Button>
            </Tooltip>
          </Popconfirm>
        </div>
      )}
    </div>
  );
}
