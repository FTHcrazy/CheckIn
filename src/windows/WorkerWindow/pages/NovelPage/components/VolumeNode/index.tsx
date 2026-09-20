import { useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import ChapterTreeItem from "../ChapterTreeItem";
import { DRAG_MIME_CHAPTER, DRAG_MIME_VOLUME } from "../../novel-config";
import { formatNumberedLabel } from "../../novel-utils";
import type { LabelNumberStyle, NovelChapter, NovelVolume } from "../../types";
import "./index.scss";

interface VolumeNodeProps {
  volume: NovelVolume;
  /** 序号标签配置：数字样式 + 卷后缀（第一卷 / 第2部 …） */
  numberStyle: LabelNumberStyle;
  volumeSuffix: string;
  chapters: NovelChapter[];
  /** 全书章节序号（拖拽重排后自动跟随的派生属性） */
  chapterNumbers: Map<string, number>;
  activeChapterId: string | null;
  onSelect: (chapterId: string) => void;
  /** 双击章节标题快捷重命名 */
  onRenameChapter: (chapterId: string, title: string) => void;
  /** 章节拖到章节上：同卷重排 / 跨卷移动 */
  onReorderChapter: (fromId: string, toId: string) => void;
  /** 章节拖到卷头：移入本卷并排到末尾 */
  onMoveChapterToVolume: (chapterId: string, volumeId: string) => void;
  /** 卷拖到卷头：重排卷顺序 */
  onReorderVolume: (fromId: string, toId: string) => void;
  /** 双击卷名重命名（R9 扩展）：空名 / 同名不落 */
  onRenameVolume: (volumeId: string, name: string) => void;
}

/** 新建卷的默认存储名：展示序号时视为「未命名」不追加显示 */
const UNNAMED_VOLUME = "未命名卷";

/** 卷节点：默认展开，点击标题折叠，双击卷名重命名；卷名按配置由 sort 派生 */
export default function VolumeNode({
  volume,
  numberStyle,
  volumeSuffix,
  chapters,
  chapterNumbers,
  activeChapterId,
  onSelect,
  onRenameChapter,
  onReorderChapter,
  onMoveChapterToVolume,
  onReorderVolume,
  onRenameVolume,
}: VolumeNodeProps) {
  const [open, setOpen] = useState(true);
  const [dropActive, setDropActive] = useState(false);

  // 卷名编辑：双击进入（本组件局部交互，含 IME 守卫）
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const startNameEdit = (): void => {
    setNameDraft(volume.name === UNNAMED_VOLUME ? "" : volume.name);
    setNameEditing(true);
  };

  const commitNameEdit = (): void => {
    setNameEditing(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== volume.name) {
      onRenameVolume(volume.id, trimmed);
    }
  };

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitNameEdit();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setNameEditing(false);
    }
  };

  const label = formatNumberedLabel(
    numberStyle,
    volumeSuffix,
    Math.max(1, volume.sort),
  );
  /** 存储名仅兜底：默认名「未命名卷」不追显，自定义名展示为「第N卷 - 名字」 */
  const customName = volume.name === UNNAMED_VOLUME ? "" : volume.name;

  const handleHeadDragStart = (event: DragEvent<HTMLButtonElement>): void => {
    event.dataTransfer.setData(DRAG_MIME_VOLUME, volume.id);
    event.dataTransfer.effectAllowed = "move";
  };

  /** 卷头同时是两种 drop 目标：章节（移入本卷）与卷（重排顺序） */
  const handleHeadDragOver = (event: DragEvent<HTMLButtonElement>): void => {
    const { types } = event.dataTransfer;
    if (!types.includes(DRAG_MIME_CHAPTER) && !types.includes(DRAG_MIME_VOLUME)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropActive(true);
  };

  const handleHeadDragLeave = (event: DragEvent<HTMLButtonElement>): void => {
    if (event.currentTarget === event.target) setDropActive(false);
  };

  const handleHeadDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setDropActive(false);

    const chapterId = event.dataTransfer.getData(DRAG_MIME_CHAPTER);
    if (chapterId) {
      onMoveChapterToVolume(chapterId, volume.id);
      return;
    }
    const volumeId = event.dataTransfer.getData(DRAG_MIME_VOLUME);
    if (volumeId && volumeId !== volume.id) onReorderVolume(volumeId, volume.id);
  };

  const handleHeadDragEnd = (): void => setDropActive(false);

  return (
    <div className="nv-volume">
      {nameEditing ? (
        /* 编辑态不用 button：避免 button 内嵌 input 的交互嵌套 */
        <div className="nv-volume__head is-editing">
          <DownOutlined className="nv-volume__caret" />
          <input
            className="nv-volume__name-input"
            value={nameDraft}
            autoFocus
            maxLength={30}
            aria-label="卷名称"
            placeholder="卷名称（可留空）"
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitNameEdit}
            onKeyDown={handleNameKeyDown}
          />
        </div>
      ) : (
        <button
          type="button"
          className={`nv-volume__head${dropActive ? " is-drop" : ""}`}
          draggable
          onDragStart={handleHeadDragStart}
          onDragOver={handleHeadDragOver}
          onDragLeave={handleHeadDragLeave}
          onDrop={handleHeadDrop}
          onDragEnd={handleHeadDragEnd}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? (
            <DownOutlined className="nv-volume__caret" />
          ) : (
            <RightOutlined className="nv-volume__caret" />
          )}
          <span
            className="nv-volume__name"
            title="双击修改卷名"
            onDoubleClick={(event) => {
              event.stopPropagation();
              setOpen(true);
              startNameEdit();
            }}
          >
            {customName ? `${label} · ${customName}` : label}
          </span>
          <span className="nv-volume__count">{chapters.length}</span>
        </button>
      )}

      {open && (
        <ul className="nv-volume__list" role="tree">
          {chapters.map((chapter) => (
            <ChapterTreeItem
              key={chapter.id}
              chapter={chapter}
              chapterNumber={chapterNumbers.get(chapter.id) ?? 0}
              active={chapter.id === activeChapterId}
              onSelect={onSelect}
              onRename={onRenameChapter}
              onReorder={onReorderChapter}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
