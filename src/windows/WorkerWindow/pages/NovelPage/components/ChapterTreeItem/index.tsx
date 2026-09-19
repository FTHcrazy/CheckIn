import { Tooltip } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { CHAPTER_STATUS_META } from "../../novel-config";
import { formatThousands, padIndex } from "../../novel-utils";
import type { NovelChapter } from "../../types";
import "./index.scss";

interface ChapterTreeItemProps {
  chapter: NovelChapter;
  index: number;
  active: boolean;
  sortMode: boolean;
  onSelect: (chapterId: string) => void;
  onMove: (chapterId: string, direction: "up" | "down") => void;
}

/**
 * 章节列表项（R1：标题 / 状态圆点 / 字数）
 * 排序模式下的上下移动按钮属于本列表项的局部交互，由它自己负责触发。
 */
export default function ChapterTreeItem({
  chapter,
  index,
  active,
  sortMode,
  onSelect,
  onMove,
}: ChapterTreeItemProps) {
  const status = CHAPTER_STATUS_META[chapter.status];

  return (
    <li className="nv-chapter" role="treeitem" aria-selected={active}>
      <button
        type="button"
        className={`nv-chapter__row${active ? " is-active" : ""}`}
        onClick={() => onSelect(chapter.id)}
      >
        <span className="nv-chapter__index">{padIndex(index)}</span>
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
