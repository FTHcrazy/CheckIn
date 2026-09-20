import { useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { Popconfirm, Tooltip } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { CHAPTER_STATUS_META, DRAG_MIME_CHAPTER } from "../../novel-config";
import { formatThousands, padIndex } from "../../novel-utils";
import type { NovelChapter } from "../../types";
import "./index.scss";

interface ChapterTreeItemProps {
  chapter: NovelChapter;
  /** 全书序号（跨卷连续，随拖拽重排自动变动） */
  chapterNumber: number;
  active: boolean;
  onSelect: (chapterId: string) => void;
  /** 拖拽放下：fromId 落到本章节（chapter.id）的位置，同卷重排 / 跨卷移动 */
  onReorder: (fromId: string, toId: string) => void;
  /** 双击标题快捷重命名：空名 / 同名不落 */
  onRename: (chapterId: string, title: string) => void;
  /** 删除章节（Popconfirm 确认后回调，快照级联清理） */
  onDelete: (chapterId: string) => void;
}

/**
 * 章节列表项（R1：标题 / 状态圆点 / 字数）
 *
 * 拖拽（R9）由行自己承载：dragstart 写入 MIME，dragover/drop 消费，
 * 「是否悬浮在自身上方」是本行的短生命周期状态，不提升到页面。
 * 排序的实际应用在页面层（防误触确认后），这里只发起 onReorder 请求。
 * 双击标题快捷重命名；编辑态行渲染为 div，避免 button 嵌套 input。
 */
export default function ChapterTreeItem({
  chapter,
  chapterNumber,
  active,
  onSelect,
  onReorder,
  onRename,
  onDelete,
}: ChapterTreeItemProps) {
  const status = CHAPTER_STATUS_META[chapter.status];
  const [dropActive, setDropActive] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const startTitleEdit = (): void => {
    setTitleDraft(chapter.title);
    setTitleEditing(true);
  };

  const commitTitleEdit = (): void => {
    setTitleEditing(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== chapter.title) {
      onRename(chapter.id, trimmed);
    }
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitTitleEdit();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setTitleEditing(false);
    }
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>): void => {
    event.dataTransfer.setData(DRAG_MIME_CHAPTER, chapter.id);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>): void => {
    if (!event.dataTransfer.types.includes(DRAG_MIME_CHAPTER)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLButtonElement>): void => {
    if (event.currentTarget === event.target) setDropActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setDropActive(false);
    const fromId = event.dataTransfer.getData(DRAG_MIME_CHAPTER);
    if (fromId && fromId !== chapter.id) onReorder(fromId, chapter.id);
  };

  const handleDragEnd = (): void => setDropActive(false);

  const rowClass = `nv-chapter__row${active ? " is-active" : ""}${
    dropActive ? " is-drop" : ""
  }`;

  return (
    <div className="nv-chapter" role="treeitem" aria-selected={active}>
      {titleEditing ? (
        <div className={`${rowClass} is-editing`}>
          <span className="nv-chapter__index">{padIndex(chapterNumber)}</span>
          <Tooltip title={status.label}>
            <span
              className="nv-chapter__status"
              style={{ background: status.color }}
            />
          </Tooltip>
          <input
            className="nv-chapter__title-input"
            value={titleDraft}
            autoFocus
            maxLength={60}
            aria-label="章节名称"
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitleEdit}
            onKeyDown={handleTitleKeyDown}
          />
        </div>
      ) : (
        <button
          type="button"
          className={rowClass}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onClick={() => onSelect(chapter.id)}
        >
          <span className="nv-chapter__index">{padIndex(chapterNumber)}</span>
          <Tooltip title={status.label}>
            <span
              className="nv-chapter__status"
              style={{ background: status.color }}
            />
          </Tooltip>
          <span
            className="nv-chapter__title"
            title="双击修改章节名称"
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              startTitleEdit();
            }}
          >
            {chapter.title}
          </span>
          <span className="nv-chapter__words">
            {formatThousands(chapter.wordCount)}
          </span>
        </button>
      )}
      {/* 删除按钮挂在行外（button 不能嵌 button），行悬浮时浮现盖住字数；编辑态不显示 */}
      {!titleEditing && (
        <Popconfirm
          title="删除章节"
          description={`删除「${chapter.title}」及其全部历史快照，不可恢复。`}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDelete(chapter.id)}
        >
          <button
            type="button"
            className="nv-chapter__del"
            aria-label={`删除章节 ${chapter.title}`}
            title="删除章节"
            onClick={(event) => event.stopPropagation()}
          >
            <DeleteOutlined />
          </button>
        </Popconfirm>
      )}
    </div>
  );
}
