import { useMemo, useState } from "react";
import { PlusOutlined, SearchOutlined, SortAscendingOutlined } from "@ant-design/icons";
import VolumeNode from "../VolumeNode";
import type { ChapterGroup } from "../../novel-utils";
import "./index.scss";

interface ChapterTreeProps {
  collapsed: boolean;
  groups: ChapterGroup[];
  activeChapterId: string | null;
  onSelect: (chapterId: string) => void;
  onCreate: () => void;
  onMove: (chapterId: string, direction: "up" | "down") => void;
  /** 拖拽：章节落到章节位置（同卷重排 / 跨卷移动） */
  onReorderChapter: (fromId: string, toId: string) => void;
  /** 拖拽：章节落到卷头（移入该卷末尾） */
  onMoveChapterToVolume: (chapterId: string, volumeId: string) => void;
  /** 拖拽：卷落到卷头（重排卷顺序） */
  onReorderVolume: (fromId: string, toId: string) => void;
}

/**
 * 左栏章节树（设计方案 §05 ①：236px · 卷 → 章两级）
 *
 * 底部「新章节 / 排序」常驻，不用悬浮加号遮挡正文；
 * 搜索输入由本组件自持（局部交互状态不下沉到页面），检测结果供下列表使用。
 * 拖拽排序（R9）的交互状态都在行/卷头组件内部，这里只透传数据动作。
 */
export default function ChapterTree({
  collapsed,
  groups,
  activeChapterId,
  onSelect,
  onCreate,
  onMove,
  onReorderChapter,
  onMoveChapterToVolume,
  onReorderVolume,
}: ChapterTreeProps) {
  const [keyword, setKeyword] = useState("");
  const [sortMode, setSortMode] = useState(false);

  const filtered = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return groups;
    return groups
      .map((group) => ({
        volume: group.volume,
        chapters: group.chapters.filter((chapter) =>
          chapter.title.toLowerCase().includes(trimmed),
        ),
      }))
      .filter((group) => group.chapters.length > 0);
  }, [groups, keyword]);

  return (
    <div className={`nv-tree${collapsed ? " nv-tree--collapsed" : ""}`}>
      <label className="nv-tree__search">
        <SearchOutlined className="nv-tree__search-icon" />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索章节"
          aria-label="搜索章节"
        />
      </label>

      <div className="nv-tree__list">
        {filtered.length === 0 ? (
          <p className="nv-tree__empty">没有匹配的章节</p>
        ) : (
          filtered.map((group) => (
            <VolumeNode
              key={group.volume.id}
              volume={group.volume}
              chapters={group.chapters}
              activeChapterId={activeChapterId}
              sortMode={sortMode}
              onSelect={onSelect}
              onMove={onMove}
              onReorderChapter={onReorderChapter}
              onMoveChapterToVolume={onMoveChapterToVolume}
              onReorderVolume={onReorderVolume}
            />
          ))
        )}
      </div>

      <div className="nv-tree__foot">
        <button type="button" className="nv-tree__foot-btn" onClick={onCreate}>
          <PlusOutlined /> 新章节
        </button>
        <button
          type="button"
          className={`nv-tree__foot-btn${sortMode ? " is-on" : ""}`}
          onClick={() => setSortMode((on) => !on)}
        >
          <SortAscendingOutlined /> 排序
        </button>
      </div>
    </div>
  );
}
