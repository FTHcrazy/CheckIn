import { useState } from "react";
import type { KeyboardEvent } from "react";
import { DeleteOutlined } from "@ant-design/icons";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CHAPTER_STATUS_META } from "../../novel-config";
import { formatThousands, padIndex } from "../../novel-utils";
import type { NovelChapter } from "../../types";
import "./index.scss";

interface ChapterTreeItemProps {
  chapter: NovelChapter;
  /** 全书序号（跨卷连续，随拖拽重排自动变动） */
  chapterNumber: number;
  active: boolean;
  /** 正在被拖拽的行 id（"ch:…" / "vol:…"）；null = 当前没有拖拽 */
  dragActiveId: string | null;
  onSelect: (chapterId: string) => void;
  /** 点击状态圆点：草稿 ⇄ 完稿 */
  onToggleStatus: (chapterId: string) => void;
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
 * ── 拖拽（1.39.1 起用 @dnd-kit，替换 HTML5 dataTransfer）──
 *
 * 行容器同时是 draggable 与 droppable（同一个 id，dnd-kit 允许并存）：
 * 拖它 = 移动本章，别人拖到它上面 = 落到本章的位置（同卷重排 / 跨卷移动）。
 * 只挂 `listeners` 不挂 `attributes`：attributes 会给行容器塞 `role="button"`
 * 和 tabIndex，与行内三个真按钮叠成嵌套交互语义；拖拽本就只有指针一种
 * 输入（HTML5 时代也没有键盘路径），可达性仍由行内按钮承担。
 * PointerSensor 带 distance 约束（见 ChapterTree），行上点按不误触拖拽。
 */
export default function ChapterTreeItem({
  chapter,
  chapterNumber,
  active,
  dragActiveId,
  onSelect,
  onToggleStatus,
  onRename,
  onRequestDelete,
}: ChapterTreeItemProps) {
  const status = CHAPTER_STATUS_META[chapter.status];
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const dragId = `ch:${chapter.id}`;
  const {
    setNodeRef: setDragRef,
    listeners,
    isDragging,
  } = useDraggable({ id: dragId, data: { kind: "chapter" } });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dragId,
    data: { kind: "chapter" },
  });
  /** 落点高亮：悬停在本行上、且拖的不是本行自己 */
  const dropActive = isOver && dragActiveId !== null && dragActiveId !== dragId;

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

  const rowClass = `nv-chapter__row${active ? " is-active" : ""}${
    dropActive ? " is-drop" : ""
  }${isDragging ? " is-drag" : ""}`;

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
        ref={(node) => {
          setDragRef(node);
          setDropRef(node);
        }}
        {...listeners}
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
