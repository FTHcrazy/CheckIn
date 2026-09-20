import { useState } from "react";
import type { DragEvent } from "react";
import { Tooltip } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { CHAPTER_STATUS_META, DRAG_MIME_CHAPTER } from "../../novel-config";
import { formatThousands, padIndex } from "../../novel-utils";
import type { NovelChapter } from "../../types";
import "./index.scss";

interface ChapterTreeItemProps {
  chapter: NovelChapter;
  /** 全书序号（跨卷连续，随拖拽重排自动变动） */
  chapterNumber: number;
  active: boolean;
  sortMode: boolean;
  onSelect: (chapterId: string) => void;
  onMove: (chapterId: string, direction: "up" | "down") => void;
  /** 拖拽放下：fromId 落到本章节（chapter.id）的位置，同卷重排 / 跨卷移动 */
  onReorder: (fromId: string, toId: string) => void;
}

/**
 * 章节列表项（R1：标题 / 状态圆点 / 字数）
 *
 * 排序模式下的上下移动按钮属于本列表项的局部交互；
 * 拖拽（R9）同样由行自己承载：dragstart 写入 MIME，dragover/drop 消费，
 * 「是否悬浮在自身上方」是本行的短生命周期状态，不提升到页面。
 */
export default function ChapterTreeItem({
  chapter,
  chapterNumber,
  active,
  sortMode,
  onSelect,
  onMove,
  onReorder,
}: ChapterTreeItemProps) {
  const status = CHAPTER_STATUS_META[chapter.status];
  const [dropActive, setDropActive] = useState(false);

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

  return (
    <li className="nv-chapter" role="treeitem" aria-selected={active}>
      <button
        type="button"
        className={`nv-chapter__row${active ? " is-active" : ""}${dropActive ? " is-drop" : ""}`}
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
        <span className="nv-chapter__title">{chapter.title}</span>
        {!sortMode && (
          <span className="nv-chapter__words">
            {formatThousands(chapter.wordCount)}
          </span>
        )}
      </button>

      {sortMode && (
        <div className="nv-chapter__sorter">
          <button
            type="button"
            aria-label="上移"
            onClick={() => onMove(chapter.id, "up")}
          >
            <ArrowUpOutlined />
          </button>
          <button
            type="button"
            aria-label="下移"
            onClick={() => onMove(chapter.id, "down")}
          >
            <ArrowDownOutlined />
          </button>
        </div>
      )}
    </li>
  );
}
