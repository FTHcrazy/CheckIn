import { useState } from "react";
import type { DragEvent } from "react";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import ChapterTreeItem from "../ChapterTreeItem";
import { DRAG_MIME_CHAPTER, DRAG_MIME_VOLUME } from "../../novel-config";
import type { NovelChapter, NovelVolume } from "../../types";
import "./index.scss";

interface VolumeNodeProps {
  volume: NovelVolume;
  chapters: NovelChapter[];
  activeChapterId: string | null;
  sortMode: boolean;
  onSelect: (chapterId: string) => void;
  onMove: (chapterId: string, direction: "up" | "down") => void;
  /** 章节拖到章节上：同卷重排 / 跨卷移动 */
  onReorderChapter: (fromId: string, toId: string) => void;
  /** 章节拖到卷头：移入本卷并排到末尾 */
  onMoveChapterToVolume: (chapterId: string, volumeId: string) => void;
  /** 卷拖到卷头：重排卷顺序 */
  onReorderVolume: (fromId: string, toId: string) => void;
}

/** 卷节点：默认展开，点击标题折叠；右侧显示本章卷字数合计 / 章节数 */
export default function VolumeNode({
  volume,
  chapters,
  activeChapterId,
  sortMode,
  onSelect,
  onMove,
  onReorderChapter,
  onMoveChapterToVolume,
  onReorderVolume,
}: VolumeNodeProps) {
  const [open, setOpen] = useState(true);
  const [dropActive, setDropActive] = useState(false);

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
        <span className="nv-volume__name">{volume.name}</span>
        <span className="nv-volume__count">{chapters.length}</span>
      </button>

      {open && (
        <ul className="nv-volume__list" role="tree">
          {chapters.map((chapter, index) => (
            <ChapterTreeItem
              key={chapter.id}
              chapter={chapter}
              index={index + 1}
              active={chapter.id === activeChapterId}
              sortMode={sortMode}
              onSelect={onSelect}
              onMove={onMove}
              onReorder={onReorderChapter}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
