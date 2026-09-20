import { useMemo, useState } from "react";
import { BookOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Virtuoso } from "react-virtuoso";
import VolumeNode from "../VolumeNode";
import ChapterTreeItem from "../ChapterTreeItem";
import type { ChapterGroup } from "../../novel-utils";
import type { LabelNumberStyle, NovelChapter, NovelVolume } from "../../types";
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
  /** 双击章节标题快捷重命名 */
  onRenameChapter: (chapterId: string, title: string) => void;
  /** 拖拽：章节落到章节位置（同卷重排 / 跨卷移动） */
  onReorderChapter: (fromId: string, toId: string) => void;
  /** 拖拽：章节落到卷头（移入该卷末尾） */
  onMoveChapterToVolume: (chapterId: string, volumeId: string) => void;
  /** 拖拽：卷落到卷头（重排卷顺序） */
  onReorderVolume: (fromId: string, toId: string) => void;
  /** 双击卷名重命名 */
  onRenameVolume: (volumeId: string, name: string) => void;
}

/** 扁平行模型：卷头行 + 已展开的章行（Virtuoso 只接受一维列表） */
type TreeRow =
  | { kind: "volume"; volume: NovelVolume; chapterCount: number }
  | { kind: "chapter"; chapter: NovelChapter };

/**
 * 左栏章节树（设计方案 §05 ①：236px · 卷 → 章两级）
 *
 * 排序唯一入口是拖拽（R9）；原「排序模式 + 上下移按钮」已随拖拽下线。
 * 搜索输入由本组件自持（局部交互状态不下沉到页面），检测结果供下列表使用。
 * 列表用 Virtuoso 虚拟化：卷章结构扁平化为一维行（卷头行 + 章行），
 * 长篇上千章时只挂载可视区；折叠状态提升到本组件——
 * 虚拟化后离屏行会被卸载，行内局部状态会丢失，不能留在行组件里。
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
  onRenameChapter,
  onReorderChapter,
  onMoveChapterToVolume,
  onReorderVolume,
  onRenameVolume,
}: ChapterTreeProps) {
  const [keyword, setKeyword] = useState("");
  /** 折叠的卷 id 集合（默认全部展开） */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  const searching = keyword.trim().length > 0;

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

  const rows = useMemo<TreeRow[]>(() => {
    const list: TreeRow[] = [];
    for (const group of filtered) {
      list.push({
        kind: "volume",
        volume: group.volume,
        chapterCount: group.chapters.length,
      });
      // 搜索时强制展开：折叠中的命中章不能被藏起来
      if (searching || !folded.has(group.volume.id)) {
        for (const chapter of group.chapters) {
          list.push({ kind: "chapter", chapter });
        }
      }
    }
    return list;
  }, [filtered, folded, searching]);

  const toggleVolume = (volumeId: string): void => {
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(volumeId)) {
        next.delete(volumeId);
      } else {
        next.add(volumeId);
      }
      return next;
    });
  };

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

      {rows.length === 0 ? (
        <div className="nv-tree__list">
          <p className="nv-tree__empty">没有匹配的章节</p>
        </div>
      ) : (
        <Virtuoso
          className="nv-tree__list"
          data={rows}
          overscan={12}
          computeItemKey={(_, row) =>
            row.kind === "volume" ? row.volume.id : row.chapter.id
          }
          itemContent={(_, row) =>
            row.kind === "volume" ? (
              <VolumeNode
                volume={row.volume}
                numberStyle={numberStyle}
                volumeSuffix={volumeSuffix}
                chapterCount={row.chapterCount}
                open={searching || !folded.has(row.volume.id)}
                onToggleOpen={() => toggleVolume(row.volume.id)}
                onMoveChapterToVolume={onMoveChapterToVolume}
                onReorderVolume={onReorderVolume}
                onRenameVolume={onRenameVolume}
              />
            ) : (
              <ChapterTreeItem
                chapter={row.chapter}
                chapterNumber={chapterNumbers.get(row.chapter.id) ?? 0}
                active={row.chapter.id === activeChapterId}
                onSelect={onSelect}
                onRename={onRenameChapter}
                onReorder={onReorderChapter}
              />
            )
          }
        />
      )}

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
