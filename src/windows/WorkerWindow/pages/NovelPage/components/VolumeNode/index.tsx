import { useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { DownOutlined, PlusOutlined, RightOutlined } from "@ant-design/icons";
import { DRAG_MIME_CHAPTER, DRAG_MIME_VOLUME, UNNAMED_VOLUME } from "../../novel-config";
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
  onToggleOpen: () => void;
  /** 拖拽：章节落到卷头（移入本卷末尾） */
  onMoveChapterToVolume: (chapterId: string, volumeId: string) => void;
  /** 拖拽：卷落到卷头（重排卷顺序） */
  onReorderVolume: (fromId: string, toId: string) => void;
  /** 双击卷名重命名（R9 扩展）：空名 / 同名不落 */
  onRenameVolume: (volumeId: string, name: string) => void;
  /** 在本卷末尾新建章节（卷头悬浮 + 按钮） */
  onCreateChapter: (volumeId: string) => void;
}

/**
 * 卷头行（左栏章节树虚拟化后的行组件）
 *
 * 只渲染卷头本身：展开折叠（受控）、拖拽（卷重排 / 章节移入）、双击重命名。
 * 卷下的章行由 ChapterTree 扁平化后单独渲染，不再嵌套在本组件里。
 * 卷名编辑是本行的短生命周期状态，可以留在行内——编辑中的行必然可见。
 */
export default function VolumeNode({
  volume,
  numberStyle,
  volumeSuffix,
  chapterCount,
  open,
  onToggleOpen,
  onMoveChapterToVolume,
  onReorderVolume,
  onRenameVolume,
  onCreateChapter,
}: VolumeNodeProps) {
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

  /** 展示名与面包屑 / 确认弹框共用一套派生口径：未命名卷 → 第N卷 */
  const displayName = volumeDisplayName(volume, numberStyle, volumeSuffix);

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
          onClick={onToggleOpen}
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
              startNameEdit();
            }}
          >
            {displayName}
          </span>
          <span className="nv-volume__count">{chapterCount}</span>
        </button>
      )}
      {/* 新建章节入口挂在行外（button 不能嵌 button），卷头悬浮时浮现盖住章数 */}
      {!nameEditing && (
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
      )}
    </div>
  );
}
