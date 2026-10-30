import { useState } from "react";
import type { KeyboardEvent } from "react";
import {
  DeleteOutlined,
  DownOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { UNNAMED_VOLUME } from "../../novel-config";
import { volumeDisplayName } from "../../novel-utils";
import type { LabelNumberStyle, NovelVolume } from "../../types";
import "./index.scss";

interface VolumeNodeProps {
  volume: NovelVolume;
  /** 序号标签配置：数字样式 + 卷后缀（第一卷 / 第2部 …） */
  numberStyle: LabelNumberStyle;
  volumeSuffix: string;
  /** 本卷章数（计数徽标） */
  chapterCount: number;
  /** 展开/折叠受控：状态提升到 ChapterTree（虚拟化后行组件不留状态） */
  open: boolean;
  /** 正在被拖拽的行 id（"ch:…" / "vol:…"）；null = 当前没有拖拽 */
  dragActiveId: string | null;
  onToggleOpen: () => void;
  /** 双击卷名重命名（R9 扩展）：空名 / 同名不落 */
  onRenameVolume: (volumeId: string, name: string) => void;
  /** 在本卷末尾新建章节（卷头悬浮 + 按钮） */
  onCreateChapter: (volumeId: string) => void;
  /**
   * 请求列表容器打开「删除本卷」的确认浮层（同章删除：行只上报意图与
   * 锚点 DOM，共享 Popconfirm 由 ChapterTree 渲染，行内不挂浮层）。
   */
  onRequestDelete: (volumeId: string, anchor: HTMLElement | null) => void;
}

/**
 * 卷头行（左栏章节树虚拟化后的行组件）
 *
 * 只渲染卷头本身：展开折叠（受控）、拖拽（卷重排 / 章节移入）、双击重命名。
 * 卷下的章行由 ChapterTree 扁平化后单独渲染，不再嵌套在本组件里。
 * 卷名编辑是本行的短生命周期状态，可以留在行内——编辑中的行必然可见。
 *
 * 行内控件走语义化原生标签，理由与约束见 ChapterTreeItem 顶部注释
 * （§6.1.2「超长虚拟化列表行」例外）。
 *
 * ── 拖拽（1.39.1 起用 @dnd-kit）──
 *
 * 卷头同时是两种 drop 目标：章节（移入本卷末尾）与卷（重排顺序）——
 * 谁被拖拽在 ChapterTree 的 handleDragEnd 里按 id 前缀分辨，本组件不管。
 * listeners 只挂卷头按钮（卷头本来就是整块可点区域，点击展开与拖拽
 * 由 PointerSensor 的 distance 约束区分）。
 */
export default function VolumeNode({
  volume,
  numberStyle,
  volumeSuffix,
  chapterCount,
  open,
  dragActiveId,
  onToggleOpen,
  onRenameVolume,
  onCreateChapter,
  onRequestDelete,
}: VolumeNodeProps) {
  // 卷名编辑：双击进入（本组件局部交互，含 IME 守卫）
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const dragId = `vol:${volume.id}`;
  const {
    setNodeRef: setDragRef,
    listeners,
    isDragging,
  } = useDraggable({ id: dragId, data: { kind: "volume" } });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dragId,
    data: { kind: "volume" },
  });
  /** 落点高亮：悬停在本卷头上、且拖的不是本卷自己 */
  const dropActive = isOver && dragActiveId !== null && dragActiveId !== dragId;

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

  /** 展示名与面包屑 / 确认弹框共用一套派生口径：未命名卷 → 第N卷 */
  const displayName = volumeDisplayName(volume, numberStyle, volumeSuffix);

  if (nameEditing) {
    return (
      <div className="nv-volume">
        <div className="nv-volume__head is-editing">
          <DownOutlined className="nv-volume__caret" />
          <input
            className="nv-volume__name-input"
            aria-label="卷名称"
            maxLength={30}
            placeholder="卷名称（可留空）"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitNameEdit}
            onKeyDown={handleNameKeyDown}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="nv-volume">
      <button
        type="button"
        ref={(node) => {
          setDragRef(node);
          setDropRef(node);
        }}
        {...listeners}
        className={`nv-volume__head${dropActive ? " is-drop" : ""}${
          isDragging ? " is-drag" : ""
        }`}
        aria-expanded={open}
        aria-label={`${displayName}：${open ? "收起" : "展开"}本卷的章节`}
        title="单击展开/收起 · 双击卷名重命名 · 拖拽重排"
        onClick={onToggleOpen}
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
            startNameEdit();
          }}
        >
          {displayName}
        </span>
        <span className="nv-volume__count">{chapterCount}</span>
      </button>
      {/* 新建章节入口挂在行外（button 不能嵌 button），卷头悬浮时浮现盖住章数 */}
      <button
        type="button"
        className="nv-volume__add"
        aria-label={`在${displayName}新建章节`}
        title={`在${displayName}新建章节`}
        onClick={(event) => {
          event.stopPropagation();
          onCreateChapter(volume.id);
        }}
      >
        <PlusOutlined />
      </button>
      {/* 删除卷：同样挂在行外，紧贴「＋」左侧；确认浮层由 ChapterTree 承担 */}
      <button
        type="button"
        className="nv-volume__del"
        aria-label={`删除${displayName}`}
        title={`删除${displayName}`}
        onClick={(event) => {
          event.stopPropagation();
          onRequestDelete(volume.id, event.currentTarget);
        }}
      >
        <DeleteOutlined />
      </button>
    </div>
  );
}
