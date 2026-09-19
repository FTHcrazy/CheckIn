import { useState } from "react";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import ChapterTreeItem from "../ChapterTreeItem";
import type { NovelChapter, NovelVolume } from "../../types";
import "./index.scss";

interface VolumeNodeProps {
  volume: NovelVolume;
  chapters: NovelChapter[];
  activeChapterId: string | null;
  sortMode: boolean;
  onSelect: (chapterId: string) => void;
  onMove: (chapterId: string, direction: "up" | "down") => void;
}

/** 卷节点：默认展开，点击标题折叠；右侧显示本章卷字数合计 / 章节数 */
export default function VolumeNode({
  volume,
  chapters,
  activeChapterId,
  sortMode,
  onSelect,
  onMove,
}: VolumeNodeProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="nv-volume">
      <button
        type="button"
        className="nv-volume__head"
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
            />
          ))}
        </ul>
      )}
    </div>
  );
}
