import { useMemo, useState } from "react";
import { BookOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import VolumeNode from "../VolumeNode";
import type { ChapterGroup } from "../../novel-utils";
import type { LabelNumberStyle } from "../../types";
import "./index.scss";

interface ChapterTreeProps {
  collapsed: boolean;
  groups: ChapterGroup[];
  /** 全书章节序号（拖拽重排后自动跟随的派生属性） */
  chapterNumbers: Map<string, number>;
  /** 序号标签配置：数字样式 + 卷后缀（第一卷 / 第2部 …） */
  numberStyle: LabelNumberStyle;
  volumeSuffix: string;
  activeChapterId: string | null;
  onSelect: (chapterId: string) => void;
  onCreate: () => void;
  onCreateVolume: () => void;
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
 * 排序唯一入口是拖拽（R9）；原「排序模式 + 上下移按钮」已随拖拽下线。
 * 搜索输入由本组件自持（局部交互状态不下沉到页面），检测结果供下列表使用。
 */
export default function ChapterTree({
  collapsed,
  groups,
  chapterNumbers,
  numberStyle,
  volumeSuffix,
  activeChapterId,
  onSelect,
  onCreate,
  onCreateVolume,
  onReorderChapter,
  onMoveChapterToVolume,
  onReorderVolume,
}: ChapterTreeProps) {
  const [keyword, setKeyword] = useState("");

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
              numberStyle={numberStyle}
              volumeSuffix={volumeSuffix}
              chapters={group.chapters}
              chapterNumbers={chapterNumbers}
              activeChapterId={activeChapterId}
              onSelect={onSelect}
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
          className="nv-tree__foot-btn"
          onClick={onCreateVolume}
          title="在当前作品末尾新建一卷"
        >
          <BookOutlined /> 新卷
        </button>
      </div>
    </div>
  );
}
