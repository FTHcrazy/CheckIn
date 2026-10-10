import { useCallback, useMemo, useState } from "react";
import { BookOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input, Popconfirm } from "antd";
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
  /** 点击章节状态圆点：草稿 ⇄ 完稿 */
  onToggleStatus: (chapterId: string) => void;
  onCreate: () => void;
  /** 在指定卷末尾新建章节（卷头悬浮 + 按钮） */
  onCreateChapterInVolume: (volumeId: string) => void;
  onCreateVolume: () => void;
  /** 双击章节标题快捷重命名 */
  onRenameChapter: (chapterId: string, title: string) => void;
  /** 删除章节（行内 Popconfirm 确认后触发） */
  onDeleteChapter: (chapterId: string) => void;
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
  onToggleStatus,
  onCreate,
  onCreateChapterInVolume,
  onCreateVolume,
  onRenameChapter,
  onDeleteChapter,
  onReorderChapter,
  onMoveChapterToVolume,
  onReorderVolume,
  onRenameVolume,
}: ChapterTreeProps) {
  const [keyword, setKeyword] = useState("");
  /** 折叠的卷 id 集合（默认全部展开） */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  /**
   * 删除确认浮层（§6.1.2「超长虚拟化列表行」例外）。
   *
   * 行自己不挂 Popconfirm：数千行各带一个 Portal + 状态机，滚动时反复
   * mount/unmount 是主要抖动源。改为**全列表共享唯一一个** Popconfirm，
   * 行只上报「要删哪一章 + 锚点 DOM」，浮层按需定位。
   * `anchor` 一起存：虚拟化下被点的那一行可能在浮层关闭前就滚出视口，
   * 届时锚点已脱离文档，Popconfirm 会自行贴到视口边缘而不是崩掉。
   */
  const [pendingDelete, setPendingDelete] = useState<{
    chapterId: string;
    anchor: HTMLElement | null;
  } | null>(null);

  const handleRequestDelete = useCallback(
    (chapterId: string, anchor: HTMLElement | null) => {
      setPendingDelete({ chapterId, anchor });
    },
    [],
  );

  const pendingDeleteChapter = useMemo(
    () =>
      pendingDelete
        ? (groups
            .flatMap((group) => group.chapters)
            .find((chapter) => chapter.id === pendingDelete.chapterId) ?? null)
        : null,
    [groups, pendingDelete],
  );

  /**
   * 锚点位置：取被点删除按钮的视口矩形，转成相对页面的绝对坐标。
   *
   * 用坐标而非 DOM 锚点：虚拟化下被点的那一行随时可能滚出视口被卸载，
   * 直接引用那个 DOM 会让 antd 在定位时读到 null 或 0 尺寸。
   * 记下坐标后即使行被回收，浮层仍指向用户当时点的那一屏位置。
   */
  const deleteAnchorStyle = useMemo(() => {
    const rect = pendingDelete?.anchor?.getBoundingClientRect();
    if (!rect) return undefined;
    return {
      position: "fixed" as const,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, [pendingDelete]);

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
        <Input
          variant="borderless"
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
                onCreateChapter={onCreateChapterInVolume}
              />
            ) : (
              <ChapterTreeItem
                chapter={row.chapter}
                chapterNumber={chapterNumbers.get(row.chapter.id) ?? 0}
                active={row.chapter.id === activeChapterId}
                onSelect={onSelect}
                onToggleStatus={onToggleStatus}
                onRename={onRenameChapter}
                onReorder={onReorderChapter}
                onRequestDelete={handleRequestDelete}
              />
            )
          }
        />
      )}

      <div className="nv-tree__foot">
        <Button className="nv-tree__foot-btn" onClick={onCreate}>
          <PlusOutlined />新章节
        </Button>
        <Button
          className="nv-tree__foot-btn"
          onClick={onCreateVolume}
          title="在当前作品末尾新建一卷"
        >
          <BookOutlined />新卷
        </Button>
      </div>

      {/*
        删除确认浮层：**全列表唯一一个**，`open` 由 pendingDelete 驱动，
        锚点用被点击的那颗删除按钮。Virtuoso 会在浮层挂载后测量行高，
        浮层本身挂在 portal 上、不参与列表布局，不会引起虚拟列表抖动。
      */}
      {pendingDelete && pendingDeleteChapter && (
        <Popconfirm
          open
          title="删除章节"
          description={`删除「${pendingDeleteChapter.title}」及其全部历史快照，不可恢复。`}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => {
            onDeleteChapter(pendingDelete.chapterId);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        >
          {/* 定位锚点：用被点删除按钮当时的视口坐标做一个固定定位的占位元素。
              行已被虚拟滚动回收也不影响 —— 浮层指向的是用户点击时的位置 */}
          <span className="nv-tree__del-anchor" style={deleteAnchorStyle} />
        </Popconfirm>
      )}
    </div>
  );
}
