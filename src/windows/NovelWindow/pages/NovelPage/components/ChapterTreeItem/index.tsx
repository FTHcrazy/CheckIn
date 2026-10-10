import { useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
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
  /**
   * 请求列表容器打开「删除本章」的确认浮层（§6.1.2 超长虚拟化列表行例外）。
   *
   * 行自己不挂 Popconfirm：3000 行里每行一个浮层 = 3000 个 Portal + 状态机，
   * 滚动时反复 mount/unmount 是主要抖动源。改为行只上报意图与锚点 DOM，
   * 由容器渲染**唯一**一个 Popconfirm。
   *
   * 注意：行**不再**直接持删除回调 —— 真正执行删除的是容器里那个共享
   * Popconfirm 的 `onConfirm`（见 ChapterTree）。行只负责「请求确认」，
   * 所以这里没有 `onDelete`，避免两条删除路径并存。
   */
  onRequestDelete: (chapterId: string, anchor: HTMLElement | null) => void;
}

/**
 * 章节列表项（R1：标题 / 状态圆点 / 字数）
 *
 * ── 为什么行内控件是语义化原生标签（§6.1.2「超长虚拟化列表行」例外）──
 *
 * 左栏在长篇里是数千行，且已由 Virtuoso 虚拟化：滚动时行会被反复
 * mount / unmount。原先每行由 antd `Button` + `Tooltip` + `Popconfirm` + `Input`
 * 组成，一次滚动要反复创建/销毁上万个带 Context 与 Portal 的组件，
 * 表现就是「滚一下卡一下、切章卡一下」。
 *
 * 本条例外**只**放开「必须用组件库组件」这一条，其它约束照旧：
 *   - 仍是语义化 `<button>` / `<input>`，键盘可达、带 `aria-*`
 *   - 行容器（非交互元素）承载外观，里面放**并列**的真按钮 ——
 *     不出现 `<button>` 嵌 `<button>`（§6.1.2 第 4 条）
 *   - 外观全部走 `var(--app-*)`，状态选择器写在 index.scss（例外允许处）
 *
 * 状态点对齐 UI 稿（原型 .chap__st）：草稿空心描边、完稿实心语义色，
 * 状态点在序号之前（st → no → 标题 → 删除 → 字数）。
 * 空章节字数显示「—」而非 0（对齐原型 renderTree 的 w === '0' ? '—'）。
 */
export default function ChapterTreeItem({
  chapter,
  chapterNumber,
  active,
  onSelect,
  onToggleStatus,
  onReorder,
  onRename,
  onRequestDelete,
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

  const handleDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData(DRAG_MIME_CHAPTER, chapter.id);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes(DRAG_MIME_CHAPTER)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!dropActive) setDropActive(true);
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
    chapter.status === "done" ? "完稿 · 点击改回草稿" : "草稿 · 点击标记完稿";

  if (titleEditing) {
    return (
      <div className="nv-chapter" role="treeitem" aria-selected={active}>
        <div className={`${rowClass} is-editing`}>
          <button
            type="button"
            className="nv-chapter__status"
            data-s={chapter.status}
            aria-label={`章节状态：${status.label}，点击切换`}
            onClick={() => onToggleStatus(chapter.id)}
          />
          <span className="nv-chapter__index">{padIndex(chapterNumber)}</span>
          <input
            className="nv-chapter__title-input"
            aria-label="章节名称"
            maxLength={60}
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitleEdit}
            onKeyDown={handleTitleKeyDown}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="nv-chapter" role="treeitem" aria-selected={active}>
      {/* 行容器只承载外观与拖拽：点击由内部 __hit 按钮承担。
          「整行可点 + 行尾删除」拆成「行容器 + 两个并列真按钮」——
          直接整行做成 button 会包住删除按钮，形成 <button> 嵌 <button> */}
      <div
        className={rowClass}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      >
        <button
          type="button"
          className="nv-chapter__status"
          data-s={chapter.status}
          aria-label={`章节状态：${status.label}，点击切换`}
          title={statusHint}
          onClick={(event) => {
            event.stopPropagation();
            onToggleStatus(chapter.id);
          }}
        />
        <button
          type="button"
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
        </button>
        {/* 删除按钮行内排在字数之前：悬浮时宽度展开，字数只平移不被遮盖。
            确认浮层由 ChapterTree 的唯一 Popconfirm 承担（本行只上报意图） */}
        <button
          type="button"
          className="nv-chapter__del"
          aria-label={`删除章节 ${chapter.title}`}
          title="删除章节"
          onClick={(event) => {
            event.stopPropagation();
            onRequestDelete(chapter.id, event.currentTarget);
          }}
        >
          <DeleteOutlined />
        </button>
        <span className="nv-chapter__words">
          {chapter.wordCount === 0 ? "—" : formatThousands(chapter.wordCount)}
        </span>
      </div>
    </div>
  );
}
