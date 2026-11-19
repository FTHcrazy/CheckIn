/**
 * 灵感卡（O-12 上提到窗口级）
 *
 * 从 BookshelfPage/components/IdeaNoteCard 上提：书架 IdeaRail 与编辑器
 * 全局灵感抽屉共用同一张卡，动作词必须一致（「归属到」而非「归档到」）。
 * 只做渲染与局部编辑态，数据动作全部回调上抛。
 */
import { useState } from "react";
import type { KeyboardEvent } from "react";
import {
  DeleteOutlined,
  EditOutlined,
  FlagOutlined,
  FolderAddOutlined,
  PushpinFilled,
  PushpinOutlined,
  RollbackOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Input, Popconfirm, Tooltip } from "antd";
import { formatDayLabel } from "../../utils/day-label";
import type { NovelNoteDTO } from "@/shared/types/electron";
import "./index.scss";

interface IdeaNoteCardProps {
  note: NovelNoteDTO;
  /** 所属作品名；null = 未归属 */
  workName: string | null;
  /** 归属目标选项（未归属卡的「归属到…」菜单） */
  workOptions: Array<{ id: string; name: string }>;
  onTogglePin: () => void;
  onMoveTo: (workId: string) => void;
  onUpdateContent: (content: string) => void;
  onRemove: () => void;
  /** 可选：转伏笔动作（书架/抽屉只读角标不传；编辑器全局场景按需传入） */
  onPromote?: () => void;
}

export default function IdeaNoteCard({
  note,
  workName,
  workOptions,
  onTogglePin,
  onMoveTo,
  onUpdateContent,
  onRemove,
  onPromote,
}: IdeaNoteCardProps) {
  const unassigned = workName === null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = (): void => {
    setDraft(note.content);
    setEditing(true);
  };

  const cancelEdit = (): void => setEditing(false);

  const commitEdit = (): void => {
    setEditing(false);
    onUpdateContent(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
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
          <span className="bs-idea__edittip">
            Enter 保存 · Shift+Enter 换行 · Esc 取消
          </span>
        </div>
      ) : (
        <p className="bs-idea__content">{note.content}</p>
      )}

      <div className="bs-idea__footer">
        <span
          className={`bs-idea__source bs-idea__source--${unassigned ? "unassigned" : "work"}`}
        >
          {unassigned ? "未归属" : `来自《${workName}》`}
        </span>
        <span className="bs-idea__time">{formatDayLabel(note.createdAt)}</span>
        {note.foreshadowId ? (
          <span className="bs-idea__flag" title="已写入大纲为伏笔">
            已转为伏笔
          </span>
        ) : null}
      </div>

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
            <Button
              className="bs-idea__action"
              onClick={startEdit}
              aria-label="编辑"
            >
              <EditOutlined />
            </Button>
          </Tooltip>

          {onPromote && !note.foreshadowId && (
            <Tooltip title="转为伏笔">
              <Button
                className="bs-idea__action"
                onClick={onPromote}
                aria-label="转为伏笔"
              >
                <FlagOutlined />
              </Button>
            </Tooltip>
          )}

          {unassigned ? (
            <Dropdown
              trigger={["click"]}
              disabled={workOptions.length === 0}
              menu={{
                items: workOptions.map((work) => ({
                  key: work.id,
                  label: `归属到《${work.name}》`,
                })),
                onClick: ({ key }) => onMoveTo(String(key)),
              }}
            >
              <Tooltip
                title={
                  workOptions.length === 0 ? "先创建作品再归属" : "归属到"
                }
              >
                <Button className="bs-idea__action" aria-label="归属到">
                  <FolderAddOutlined />
                </Button>
              </Tooltip>
            </Dropdown>
          ) : (
            <Tooltip title="退回灵感池">
              <Button
                className="bs-idea__action"
                onClick={() => onMoveTo("")}
                aria-label="退回灵感池"
              >
                <RollbackOutlined />
              </Button>
            </Tooltip>
          )}

          <Popconfirm
            title={
              note.foreshadowId
                ? "这条灵感已转为伏笔，删除后大纲伏笔仍保留。继续删除？"
                : "删除这条灵感？"
            }
            okText="删除"
            cancelText="取消"
            onConfirm={onRemove}
          >
            <Tooltip title="删除">
              <Button className="bs-idea__action" aria-label="删除">
                <DeleteOutlined />
              </Button>
            </Tooltip>
          </Popconfirm>
        </div>
      )}
    </div>
  );
}
