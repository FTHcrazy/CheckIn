import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input, Popconfirm } from "antd";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { Virtuoso } from "react-virtuoso";
import type { VirtuosoHandle } from "react-virtuoso";
import VolumeNode from "../VolumeNode";
import ChapterTreeItem from "../ChapterTreeItem";
import type { ChapterGroup } from "../../novel-utils";
import { volumeDisplayName } from "../../novel-utils";
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
  /** 删除卷（共享 Popconfirm 确认后触发） */
  onDeleteVolume: (volumeId: string) => void;
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
 *
 * 激活章变化（点左栏、点大纲、点要素详情的「出场章节」、Ctrl+P 跳转……）
 * 一律以 `activeChapterId` 为唯一信号，列表自动滚到该章 —— 跳转入口五花八门，
 * 逐个埋滚动调用必然漏；盯住状态才是收口。
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
  onDeleteVolume,
}: ChapterTreeProps) {
  const [keyword, setKeyword] = useState("");
  /** 折叠的卷 id 集合（默认全部展开） */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<VirtuosoHandle | null>(null);

  /**
   * 删除确认浮层（§6.1.2「超长虚拟化列表行」例外）。
   *
   * 行自己不挂 Popconfirm：数千行各带一个 Portal + 状态机，滚动时反复
   * mount/unmount 是主要抖动源。改为**全列表共享唯一一个** Popconfirm，
   * 行只上报「要删哪一卷/章 + 锚点 DOM」，浮层按需定位。
   * `anchor` 一起存：虚拟化下被点的那一行可能在浮层关闭前就滚出视口，
   * 届时锚点已脱离文档，Popconfirm 会自行贴到视口边缘而不是崩掉。
   * 章节与卷共用这一个浮层：文案与级联说明按 kind 分支。
   */
  const [pendingDelete, setPendingDelete] = useState<{
    kind: "chapter" | "volume";
    id: string;
    anchor: HTMLElement | null;
  } | null>(null);

  const requestDelete = useCallback(
    (kind: "chapter" | "volume", id: string, anchor: HTMLElement | null) => {
      setPendingDelete({ kind, id, anchor });
    },
    [],
  );

  const handleRequestDelete = useCallback(
    (chapterId: string, anchor: HTMLElement | null) => {
      requestDelete("chapter", chapterId, anchor);
    },
    [requestDelete],
  );

  const handleRequestDeleteVolume = useCallback(
    (volumeId: string, anchor: HTMLElement | null) => {
      requestDelete("volume", volumeId, anchor);
    },
    [requestDelete],
  );

  /** 待删目标的文案与确认动作：章节 / 卷各一套，级联影响写进 description */
  const pendingDeleteAction = useMemo(() => {
    if (!pendingDelete) return null;
    const group = groups.find((item) =>
      pendingDelete.kind === "volume"
        ? item.volume.id === pendingDelete.id
        : item.chapters.some((chapter) => chapter.id === pendingDelete.id),
    );
    if (!group) return null;
    if (pendingDelete.kind === "volume") {
      const count = group.chapters.length;
      const name = volumeDisplayName(group.volume, numberStyle, volumeSuffix);
      // ⚠️ 文案不能再说「不可恢复」：卷与章节的删除现在是软删除（进回收站），
      // 正文 / 历史快照 / 大纲条目全都保留，恢复后原样回来。
      return {
        title: "删除这个卷？",
        description:
          count > 0
            ? `「${name}」及其下 ${count} 章将移入回收站，可在书架「回收站」里恢复。`
            : `「${name}」（空卷）将移入回收站，可在书架「回收站」里恢复。`,
        onConfirm: () => onDeleteVolume(pendingDelete.id),
      };
    }
    const chapter = group.chapters.find(
      (item) => item.id === pendingDelete.id,
    );
    if (!chapter) return null;
    return {
      title: "删除章节",
      description: `「${chapter.title}」将移入回收站，可在书架「回收站」里恢复。`,
      onConfirm: () => onDeleteChapter(pendingDelete.id),
    };
  }, [
    groups,
    pendingDelete,
    numberStyle,
    volumeSuffix,
    onDeleteChapter,
    onDeleteVolume,
  ]);

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

  /**
   * 激活章变化 → 列表滚动到该章。
   *
   * 只依赖 `activeChapterId`：无论跳转从哪来（左栏点击 / 大纲 / 要素的出场章节 /
   * Ctrl+P），激活章一变就滚，不区分来源。
   *
   * 三种情况静默跳过，都不是错误：
   * - `index < 0`：目标章被搜索词滤掉、或所在卷处于折叠状态（不可见就无从滚）；
   * - `activeChapterId` 为空：没有激活章；
   * - 列表尚未挂载（`rows` 为空时渲染的是空态 div，没有 Virtuoso 实例）。
   */
  useEffect(() => {
    if (!activeChapterId) return;
    const index = rows.findIndex(
      (row) => row.kind === "chapter" && row.chapter.id === activeChapterId,
    );
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, align: "center" });
  }, [activeChapterId, rows]);

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

  // ── 拖拽（@dnd-kit，1.39.1 替换 HTML5 dataTransfer）──────────────
  //
  // 一个 DndContext 管整个树，行 id 前缀区分归属：
  // - 「ch:」章行：拖到别的章行上 = 落到那个位置（同卷重排 / 跨卷移动），
  //   拖到卷头上 = 移入该卷末尾；
  // - 「vol:」卷头：拖到别的卷头上 = 重排卷顺序。
  //
  // PointerSensor 带 distance 约束：行上的点击（选章 / 状态点 / 展开卷）
  // 不会误触发拖拽。相比 HTML5 拖拽，浮起的拖拽随动卡片 + 自动滚屏
  // （拖到列表边缘时 Virtuoso 跟着滚动）是这次换库换来的体验。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  /** 正在拖拽的行（浮层展示与落点去重都用它） */
  const [drag, setDrag] = useState<{
    id: string;
    kind: "chapter" | "volume";
    label: string;
  } | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent): void => {
      const rawId = String(event.active.id);
      if (rawId.startsWith("ch:")) {
        const chapterId = rawId.slice(3);
        const chapter = filtered
          .flatMap((group) => group.chapters)
          .find((item) => item.id === chapterId);
        if (chapter) {
          setDrag({ id: rawId, kind: "chapter", label: chapter.title });
        }
      } else if (rawId.startsWith("vol:")) {
        const volumeId = rawId.slice(4);
        const group = filtered.find((item) => item.volume.id === volumeId);
        if (group) {
          setDrag({
            id: rawId,
            kind: "volume",
            label: volumeDisplayName(group.volume, numberStyle, volumeSuffix),
          });
        }
      }
    },
    [filtered, numberStyle, volumeSuffix],
  );

  const clearDrag = useCallback((): void => setDrag(null), []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      clearDrag();
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      if (!overId || overId === activeId) return;

      if (activeId.startsWith("ch:")) {
        const fromId = activeId.slice(3);
        if (overId.startsWith("ch:")) {
          onReorderChapter(fromId, overId.slice(3));
        } else if (overId.startsWith("vol:")) {
          onMoveChapterToVolume(fromId, overId.slice(4));
        }
        return;
      }
      if (activeId.startsWith("vol:") && overId.startsWith("vol:")) {
        onReorderVolume(activeId.slice(4), overId.slice(4));
      }
    },
    [clearDrag, onReorderChapter, onMoveChapterToVolume, onReorderVolume],
  );

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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={clearDrag}
        >
          <Virtuoso
            ref={listRef}
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
                  dragActiveId={drag?.id ?? null}
                  onToggleOpen={() => toggleVolume(row.volume.id)}
                  onRenameVolume={onRenameVolume}
                  onCreateChapter={onCreateChapterInVolume}
                  onRequestDelete={handleRequestDeleteVolume}
                />
              ) : (
                <ChapterTreeItem
                  chapter={row.chapter}
                  chapterNumber={chapterNumbers.get(row.chapter.id) ?? 0}
                  active={row.chapter.id === activeChapterId}
                  dragActiveId={drag?.id ?? null}
                  onSelect={onSelect}
                  onToggleStatus={onToggleStatus}
                  onRename={onRenameChapter}
                  onRequestDelete={handleRequestDelete}
                />
              )
            }
          />
          {/*
            拖拽随动浮层：跟随光标的小卡片，告诉作者「拖的是哪一章/卷」。
            HTML5 拖拽的原位半透明鬼影在窄行上几乎认不出内容，这是体验主诉。
          */}
          <DragOverlay dropAnimation={null}>
            {drag ? <div className="nv-tree__drag-chip">{drag.label}</div> : null}
          </DragOverlay>
        </DndContext>
      )}

      <div className="nv-tree__foot">
        <Button
          className="nv-tree__foot-btn"
          onClick={onCreate}
          data-tour-target="tree-new-chapter"
        >
          <PlusOutlined />新章节
        </Button>
        <Button
          className="nv-tree__foot-btn"
          onClick={onCreateVolume}
          title="在当前作品末尾新建一卷"
          data-tour-target="tree-new-volume"
        >
          <BookOutlined />新卷
        </Button>
      </div>

      {/*
        删除确认浮层：**全列表唯一一个**，`open` 由 pendingDelete 驱动，
        锚点用被点击的那颗删除按钮。Virtuoso 会在浮层挂载后测量行高，
        浮层本身挂在 portal 上、不参与列表布局，不会引起虚拟列表抖动。
        章节与卷共用：文案 / 级联说明 / 确认动作由 pendingDeleteAction 给出。
      */}
      {pendingDelete && pendingDeleteAction && (
        <Popconfirm
          open
          title={pendingDeleteAction.title}
          description={pendingDeleteAction.description}
          okText="移入回收站"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => {
            pendingDeleteAction.onConfirm();
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
