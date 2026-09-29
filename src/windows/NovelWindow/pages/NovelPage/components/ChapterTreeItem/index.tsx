import { useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactElement } from "react";
import { Input, Popconfirm, Tooltip } from "antd";
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
  /** 点击状态圆点：草稿 ⇄ 完稿 */
  onToggleStatus: (chapterId: string) => void;
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
 * 双击标题快捷重命名；编辑态行不渲染删除按钮。
 *
 * 状态点对齐 UI 稿（原型 .chap__st）：草稿空心描边、完稿实心语义色，
 * 状态点在序号之前（st → no → 标题 → 删除 → 字数）。
 * 状态点可点击切换（草稿 ⇄ 完稿）——数据层 toggleChapterStatus 的唯一 UI 入口，
 * 点击只切状态不选中章节。
 * 空章节字数显示「—」而非 0（对齐原型 renderTree 的 w === '0' ? '—'）。
 *
 * 行用 div[role=button] 而非 <button>：删除按钮需要行内排在字数之前
 * （原型右端只有干净的字数，悬浮删除按钮浮现时不遮盖字数），
 * button 内不能嵌套 button；键盘语义由 role/tabIndex/onKeyDown 补齐。
 */
export default function ChapterTreeItem({
  chapter,
  chapterNumber,
  active,
  onSelect,
  onToggleStatus,
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

  const handleStatusClick = (event: MouseEvent<HTMLSpanElement>): void => {
    event.stopPropagation();
    onToggleStatus(chapter.id);
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData(DRAG_MIME_CHAPTER, chapter.id);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes(DRAG_MIME_CHAPTER)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    if (event.currentTarget === event.target) setDropActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDropActive(false);
    const fromId = event.dataTransfer.getData(DRAG_MIME_CHAPTER);
    if (fromId && fromId !== chapter.id) onReorder(fromId, chapter.id);
  };

  const handleDragEnd = (): void => setDropActive(false);

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(chapter.id);
    }
  };

  const rowClass = `nv-chapter__row${active ? " is-active" : ""}${
    dropActive ? " is-drop" : ""
  }`;

  const statusHint =
    chapter.status === "done"
      ? "完稿 · 点击改回草稿"
      : "草稿 · 点击标记完稿";

  const renderStatus = (): ReactElement => (
    <Tooltip title={statusHint}>
      <span
        className="nv-chapter__status"
        data-s={chapter.status}
        role="button"
        aria-label={`章节状态：${status.label}，点击切换`}
        onClick={handleStatusClick}
      />
    </Tooltip>
  );

  return (
    <div className="nv-chapter" role="treeitem" aria-selected={active}>
      {titleEditing ? (
        <div className={`${rowClass} is-editing`}>
          {renderStatus()}
          <span className="nv-chapter__index">{padIndex(chapterNumber)}</span>
          <Input
            className="nv-chapter__title-input"
            variant="borderless"
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
        <div
          role="button"
          tabIndex={0}
          className={rowClass}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onClick={() => onSelect(chapter.id)}
          onKeyDown={handleRowKeyDown}
        >
          {renderStatus()}
          <span className="nv-chapter__index">{padIndex(chapterNumber)}</span>
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
          {/* 删除按钮行内排在字数之前：悬浮时宽度展开，字数只平移不被遮盖 */}
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
          <span className="nv-chapter__words">
            {chapter.wordCount === 0 ? "—" : formatThousands(chapter.wordCount)}
          </span>
        </div>
      )}
    </div>
  );
}
