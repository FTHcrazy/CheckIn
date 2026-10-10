import { useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactElement } from "react";
import { Button, Input, Popconfirm, Tooltip } from "antd";
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
 * 行结构 = 「行容器（只承载拖拽） + 三个并列的真按钮」（§6.1.2 第 4 条）：
 * 状态点 / 序号+标题的激活区 / 删除按钮必须在字数之前与之内，
 * 而 `<button>` 不能嵌 `<button>`，所以整行不能做成按钮 —— 旧实现整行是
 * `div[role=button]`、状态点是 `span[role=button]`（连 tabIndex 都没有，
 * 键盘完全不可达），现已拆成并列真按钮，键盘顺序为 状态 → 打开 → 删除。
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

  const handleStatusClick = (event: MouseEvent<HTMLElement>): void => {
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

  const rowClass = `nv-chapter__row${active ? " is-active" : ""}${
    dropActive ? " is-drop" : ""
  }`;

  const statusHint =
    chapter.status === "done"
      ? "完稿 · 点击改回草稿"
      : "草稿 · 点击标记完稿";

  // 状态点（原型 .chap__st）：既是「切换草稿⇄完稿」的按钮，也承载图示语义。
  // 由组件库按钮承载（§6.1.2）：旧实现是 `span[role=button]`，连 tabIndex 都没有，
  // 键盘完全不可达
  const renderStatus = (): ReactElement => (
    <Tooltip title={statusHint}>
      <Button
        className="nv-chapter__status"
        data-s={chapter.status}
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
        // 行容器只留拖拽：激活动作用在内部的 __hit 按钮上。
        // 「整行可点 + 行尾删除」按 §6.1.2 第 4 条拆成「行容器 + 两个并列真按钮」——
        // 直接把整行做成 Button 会包住删除按钮，形成 <button> 嵌套 <button>
        <div
          className={rowClass}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        >
          {renderStatus()}
          <Button
            className="nv-chapter__hit"
            aria-current={active}
            onClick={() => onSelect(chapter.id)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              startTitleEdit();
            }}
          >
            <span className="nv-chapter__index">{padIndex(chapterNumber)}</span>
            <span className="nv-chapter__title">{chapter.title}</span>
          </Button>
          {/* 删除按钮行内排在字数之前：悬浮时宽度展开，字数只平移不被遮盖 */}
          <Popconfirm
            title="删除章节"
            description={`删除「${chapter.title}」及其全部历史快照，不可恢复。`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDelete(chapter.id)}
          >
            <Button
              className="nv-chapter__del"
              aria-label={`删除章节 ${chapter.title}`}
              title="删除章节"
              onClick={(event) => event.stopPropagation()}
            >
              <DeleteOutlined />
            </Button>
          </Popconfirm>
          <span className="nv-chapter__words">
            {chapter.wordCount === 0 ? "—" : formatThousands(chapter.wordCount)}
          </span>
        </div>
      )}
    </div>
  );
}
