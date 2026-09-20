import { useState } from "react";
import type { KeyboardEvent } from "react";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { CHAPTER_STATUS_META } from "../../novel-config";
import { formatThousands } from "../../novel-utils";
import type { ForeshadowPatch, OutlineNode } from "../../types";
import "./index.scss";

/** 大纲面板动作组：由页面组合层注入，面板本身不接触数据层 Hook */
export interface OutlineActions {
  /** 章节一句话梗概，空串即清除 */
  onEditChapterNote: (chapterId: string, note: string) => void;
  /** 新增伏笔；chapterId 缺省 = 卷级伏笔（不绑具体章） */
  onAddForeshadow: (
    volumeId: string,
    title: string,
    note: string,
    chapterId?: string,
  ) => void;
  onUpdateForeshadow: (entryId: string, patch: ForeshadowPatch) => void;
  /** 回收状态切换：resolved 是切换后的目标状态 */
  onToggleForeshadow: (entryId: string, resolved: boolean) => void;
  onRemoveForeshadow: (entryId: string, title: string) => void;
}

interface OutlinePanelProps {
  outline: OutlineNode[];
  /** 当前编辑章：大纲里同步高亮，便于对照 */
  activeChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
  actions: OutlineActions;
}

type VolumeNode = Extract<OutlineNode, { kind: "volume" }>;
type ChapterNode = Extract<OutlineNode, { kind: "chapter" }>;
type ForeshadowNode = Extract<OutlineNode, { kind: "foreshadow" }>;

const isVolume = (node: OutlineNode): node is VolumeNode => node.kind === "volume";
const isChapter = (node: OutlineNode): node is ChapterNode => node.kind === "chapter";
const isForeshadow = (node: OutlineNode): node is ForeshadowNode =>
  node.kind === "foreshadow";

/** 伏笔编辑 / 新增的当前目标（弹在哪一行） */
type ForeshadowTarget =
  | { mode: "add"; volumeId: string }
  | { mode: "edit"; entryId: string };

interface ForeshadowDraft {
  title: string;
  note: string;
  chapterId: string;
}

const EMPTY_DRAFT: ForeshadowDraft = { title: "", note: "", chapterId: "" };

/**
 * 大纲面板（PRD R7）
 *
 * 骨架是真实卷 / 章（点章节即跳转，与左栏章节树严格一致），用户在大纲上写的
 * 内容只有两类：章节的一句话梗概（写进章节）+ 伏笔条目（可标记回收）。
 * 编辑态均为「本组件短生命周期状态」，提交后立即回落，不做二级弹窗。
 */
export default function OutlinePanel({
  outline,
  activeChapterId,
  onSelectChapter,
  actions,
}: OutlinePanelProps) {
  // 章节梗概行内编辑
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  // 伏笔新增 / 编辑（共用一份草稿，靠 target 区分模式）
  const [fsTarget, setFsTarget] = useState<ForeshadowTarget | null>(null);
  const [fsDraft, setFsDraft] = useState<ForeshadowDraft>(EMPTY_DRAFT);

  const volumeNodes = outline.filter(isVolume);
  const totalChapters = volumeNodes.reduce(
    (sum, volume) => sum + volume.children.filter(isChapter).length,
    0,
  );
  const openForeshadows = volumeNodes.reduce(
    (sum, volume) => sum + volume.openForeshadows,
    0,
  );

  // ── 章节梗概 ────────────────────────────────────────────────────────
  const startNoteEdit = (node: ChapterNode): void => {
    setNoteEditingId(node.chapterId);
    setNoteDraft(node.note);
  };

  const commitNoteEdit = (node: ChapterNode): void => {
    setNoteEditingId(null);
    const trimmed = noteDraft.trim();
    // 未改动不落库，避免每次点击都刷一条「已保存梗概」
    if (trimmed !== node.note) actions.onEditChapterNote(node.chapterId, trimmed);
  };

  const handleNoteKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    node: ChapterNode,
  ): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitNoteEdit(node);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setNoteEditingId(null);
    }
  };

  // ── 伏笔新增 / 编辑 ─────────────────────────────────────────────────
  const startAddForeshadow = (volumeId: string): void => {
    setFsDraft(EMPTY_DRAFT);
    setFsTarget({ mode: "add", volumeId });
  };

  const startEditForeshadow = (node: ForeshadowNode): void => {
    setFsDraft({ title: node.title, note: node.note, chapterId: "" });
    setFsTarget({ mode: "edit", entryId: node.entryId });
  };

  const cancelForeshadow = (): void => setFsTarget(null);

  const commitForeshadow = (): void => {
    if (!fsTarget) return;
    const title = fsDraft.title.trim();
    if (!title) return;
    if (fsTarget.mode === "add") {
      actions.onAddForeshadow(
        fsTarget.volumeId,
        title,
        fsDraft.note,
        fsDraft.chapterId || undefined,
      );
    } else {
      actions.onUpdateForeshadow(fsTarget.entryId, { title, note: fsDraft.note });
    }
    setFsTarget(null);
    setFsDraft(EMPTY_DRAFT);
  };

  const handleFsTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitForeshadow();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      cancelForeshadow();
    }
  };

  if (outline.length === 0) {
    return (
      <p className="nv-outline__empty">
        这个作品还没有大纲
        <br />
        在左栏新建一卷并写下第一章，大纲会自动长出来
      </p>
    );
  }

  const renderChapter = (node: ChapterNode) => {
    const active = node.chapterId === activeChapterId;
    const editing = noteEditingId === node.chapterId;

    return (
      <li
        key={node.id}
        className={`nv-outline__item nv-outline__item--chapter${active ? " is-active" : ""}`}
      >
        <button
          type="button"
          className="nv-outline__row"
          onClick={() => onSelectChapter(node.chapterId)}
        >
          <span className="nv-outline__no">{node.label}</span>
          <span className="nv-outline__title">{node.title}</span>
          <span className="nv-outline__words">
            {formatThousands(node.wordCount)}
          </span>
          <span
            className="nv-outline__status"
            style={{ background: CHAPTER_STATUS_META[node.status].color }}
            title={CHAPTER_STATUS_META[node.status].label}
          />
        </button>

        {editing ? (
          <input
            className="nv-outline__note-input"
            value={noteDraft}
            autoFocus
            maxLength={60}
            aria-label="章节梗概"
            placeholder="一句话梗概（Enter 保存 / Esc 取消）"
            onChange={(event) => setNoteDraft(event.target.value)}
            onBlur={() => commitNoteEdit(node)}
            onKeyDown={(event) => handleNoteKeyDown(event, node)}
          />
        ) : (
          <button
            type="button"
            className={`nv-outline__note${node.note ? "" : " is-empty"}`}
            title="点击编辑一句话梗概"
            onClick={() => startNoteEdit(node)}
          >
            {node.note || "＋ 一句话梗概"}
          </button>
        )}
      </li>
    );
  };

  const renderForeshadow = (node: ForeshadowNode) => {
    const editing = fsTarget?.mode === "edit" && fsTarget.entryId === node.entryId;

    if (editing) {
      return (
        <li
          key={node.id}
          className="nv-outline__item nv-outline__item--foreshadow is-editing"
        >
          <div className="nv-outline__fs-form">
            <input
              className="nv-outline__fs-input"
              value={fsDraft.title}
              autoFocus
              maxLength={30}
              aria-label="伏笔标题"
              placeholder="伏笔标题（Enter 保存 / Esc 取消）"
              onChange={(event) =>
                setFsDraft((draft) => ({ ...draft, title: event.target.value }))
              }
              onKeyDown={handleFsTitleKeyDown}
            />
            <textarea
              className="nv-outline__fs-textarea"
              value={fsDraft.note}
              rows={2}
              aria-label="伏笔说明"
              placeholder="说明：埋在哪一章 / 计划怎么回收"
              onChange={(event) =>
                setFsDraft((draft) => ({ ...draft, note: event.target.value }))
              }
            />
            <div className="nv-outline__fs-actions">
              <button
                type="button"
                className="nv-outline__fs-save"
                onClick={commitForeshadow}
              >
                保存
              </button>
              <button
                type="button"
                className="nv-outline__fs-cancel"
                onClick={cancelForeshadow}
              >
                取消
              </button>
            </div>
          </div>
        </li>
      );
    }

    return (
      <li
        key={node.id}
        className={`nv-outline__item nv-outline__item--foreshadow${node.resolved ? " is-resolved" : ""}`}
      >
        <div className="nv-outline__fs">
          <button
            type="button"
            className="nv-outline__fs-toggle"
            aria-pressed={node.resolved}
            title={node.resolved ? "已回收，点击恢复待回收" : "标记为已回收"}
            onClick={() => actions.onToggleForeshadow(node.entryId, !node.resolved)}
          >
            <CheckCircleOutlined />
          </button>

          <div className="nv-outline__fs-body">
            <div className="nv-outline__fs-head">
              <span className="nv-outline__tag">
                {node.resolved ? "已回收" : "伏笔"}
              </span>
              <span className="nv-outline__title">{node.title}</span>
              <span className="nv-outline__fs-tools">
                <button
                  type="button"
                  aria-label="编辑伏笔"
                  title="编辑伏笔"
                  onClick={() => startEditForeshadow(node)}
                >
                  <EditOutlined />
                </button>
                <button
                  type="button"
                  aria-label="删除伏笔"
                  title="删除伏笔"
                  onClick={() =>
                    actions.onRemoveForeshadow(node.entryId, node.title)
                  }
                >
                  <DeleteOutlined />
                </button>
              </span>
            </div>
            {node.note && <p className="nv-outline__fs-note">{node.note}</p>}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="nv-outline">
      <div className="nv-outline__summary">
        <span>
          {volumeNodes.length} 卷 · {totalChapters} 章
        </span>
        <span className={openForeshadows > 0 ? "is-warn" : undefined}>
          {openForeshadows} 条待回收
        </span>
      </div>

      {volumeNodes.map((volume) => {
        const chapters = volume.children.filter(isChapter);
        const adding = fsTarget?.mode === "add" && fsTarget.volumeId === volume.id;

        return (
          <section key={volume.id} className="nv-outline__volume">
            <header className="nv-outline__volume-head">
              <span className="nv-outline__volume-title">{volume.title}</span>
              {volume.note && (
                <span className="nv-outline__volume-note">{volume.note}</span>
              )}
              {volume.openForeshadows > 0 && (
                <span
                  className="nv-outline__badge"
                  title={`${volume.openForeshadows} 条伏笔待回收`}
                >
                  {volume.openForeshadows}
                </span>
              )}
              <button
                type="button"
                className="nv-outline__add"
                title="在本卷添加伏笔"
                onClick={() => startAddForeshadow(volume.id)}
              >
                <PlusOutlined />
              </button>
            </header>

            {volume.children.length === 0 ? (
              <p className="nv-outline__hint">本卷还没有章节</p>
            ) : (
              <ul className="nv-outline__list">
                {volume.children.map((child) => {
                  if (isChapter(child)) return renderChapter(child);
                  if (isForeshadow(child)) return renderForeshadow(child);
                  // 卷不再嵌套卷（大纲只有两级），兜底不渲染
                  return null;
                })}
              </ul>
            )}

            {adding && (
              <div className="nv-outline__fs-form">
                <input
                  className="nv-outline__fs-input"
                  value={fsDraft.title}
                  autoFocus
                  maxLength={30}
                  aria-label="伏笔标题"
                  placeholder="伏笔标题（Enter 记录 / Esc 取消）"
                  onChange={(event) =>
                    setFsDraft((draft) => ({ ...draft, title: event.target.value }))
                  }
                  onKeyDown={handleFsTitleKeyDown}
                />
                <textarea
                  className="nv-outline__fs-textarea"
                  value={fsDraft.note}
                  rows={2}
                  aria-label="伏笔说明"
                  placeholder="说明：埋在哪一章 / 计划怎么回收"
                  onChange={(event) =>
                    setFsDraft((draft) => ({ ...draft, note: event.target.value }))
                  }
                />
                {chapters.length > 0 && (
                  <select
                    className="nv-outline__fs-select"
                    value={fsDraft.chapterId}
                    aria-label="埋设章节"
                    onChange={(event) =>
                      setFsDraft((draft) => ({
                        ...draft,
                        chapterId: event.target.value,
                      }))
                    }
                  >
                    <option value="">卷级伏笔（不绑具体章）</option>
                    {chapters.map((chapter) => (
                      <option key={chapter.chapterId} value={chapter.chapterId}>
                        {chapter.label} {chapter.title}
                      </option>
                    ))}
                  </select>
                )}
                <div className="nv-outline__fs-actions">
                  <button
                    type="button"
                    className="nv-outline__fs-save"
                    onClick={commitForeshadow}
                  >
                    记录
                  </button>
                  <button
                    type="button"
                    className="nv-outline__fs-cancel"
                    onClick={cancelForeshadow}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
