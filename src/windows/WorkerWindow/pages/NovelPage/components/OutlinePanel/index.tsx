import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  DownOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Select } from "antd";
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
  /**
   * 面板头「＋ 伏笔」的请求计数（每次自增即触发一次）。
   * 由 SupportPanel 持有：面板头在大纲 Tab 上提供全书级的新增入口，
   * 而伏笔必须挂在某一卷下，所以这里落到首卷并把视图切回章节。
   */
  addForeshadowSignal?: number;
}

type VolumeNode = Extract<OutlineNode, { kind: "volume" }>;
type ChapterNode = Extract<OutlineNode, { kind: "chapter" }>;
type ForeshadowNode = Extract<OutlineNode, { kind: "foreshadow" }>;

const isVolume = (node: OutlineNode): node is VolumeNode => node.kind === "volume";
const isChapter = (node: OutlineNode): node is ChapterNode => node.kind === "chapter";
const isForeshadow = (node: OutlineNode): node is ForeshadowNode =>
  node.kind === "foreshadow";

/** 大纲双视图：章节骨架 / 伏笔专项，二者不再交错混排 */
type OutlineView = "chapter" | "fs";

/** 伏笔过滤 */
type ForeshadowFilter = "open" | "resolved" | "all";

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
 *
 * 章节与伏笔拆成两个子视图：混排会让长卷里的伏笔被章节挤到看不见。
 */
export default function OutlinePanel({
  outline,
  activeChapterId,
  onSelectChapter,
  actions,
  addForeshadowSignal = 0,
}: OutlinePanelProps) {
  const [view, setView] = useState<OutlineView>("chapter");
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [fsFilter, setFsFilter] = useState<ForeshadowFilter>("open");

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
  const allForeshadows = volumeNodes.flatMap((volume) =>
    volume.children.filter(isForeshadow),
  );
  const openForeshadows = volumeNodes.reduce(
    (sum, volume) => sum + volume.openForeshadows,
    0,
  );

  // 面板头「＋ 伏笔」：切回章节视图并在首卷展开新增表单
  // 只在 signal 自增时响应一次，避免依赖变化时重复抢占正在编辑的表单
  const lastSignalRef = useRef(addForeshadowSignal);
  useEffect(() => {
    if (addForeshadowSignal === lastSignalRef.current) return;
    lastSignalRef.current = addForeshadowSignal;
    const first = volumeNodes[0];
    if (!first) return;
    setView("chapter");
    setFolded((current) => ({ ...current, [first.id]: false }));
    setFsDraft(EMPTY_DRAFT);
    setFsTarget({ mode: "add", volumeId: first.id });
  }, [addForeshadowSignal, volumeNodes]);

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
      <div className="nv-empty">
        <b>这个作品还没有大纲</b>
        <span>在左栏新建一卷并写下第一章，大纲会自动长出来</span>
      </div>
    );
  }

  const filteredForeshadows = allForeshadows.filter((node) => {
    if (fsFilter === "open") return !node.resolved;
    if (fsFilter === "resolved") return node.resolved;
    return true;
  });

  const renderChapter = (node: ChapterNode) => {
    const active = node.chapterId === activeChapterId;
    const editing = noteEditingId === node.chapterId;

    return (
      <li
        key={node.id}
        className={`nv-outline__item${active ? " is-active" : ""}`}
      >
        <button
          type="button"
          className="nv-outline__row"
          onClick={() => onSelectChapter(node.chapterId)}
        >
          <span className="nv-outline__no">{node.label}</span>
          <span className="nv-outline__title">{node.title}</span>
          <span className="nv-outline__words">
            {node.wordCount > 0 ? formatThousands(node.wordCount) : "—"}
          </span>
          <span
            className="nv-outline__dot"
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
        <li key={node.id} className="nv-outline__fs-item is-editing">
          <div className="nv-outline__form">
            <input
              className="nv-outline__input"
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
              className="nv-outline__textarea"
              value={fsDraft.note}
              rows={2}
              aria-label="伏笔说明"
              placeholder="说明：埋在哪一章 / 计划怎么回收"
              onChange={(event) =>
                setFsDraft((draft) => ({ ...draft, note: event.target.value }))
              }
            />
            <div className="nv-outline__form-actions">
              <button
                type="button"
                className="nv-outline__save"
                onClick={commitForeshadow}
              >
                保存
              </button>
              <button
                type="button"
                className="nv-outline__cancel"
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
        className={`nv-outline__fs-item${node.resolved ? " is-resolved" : ""}`}
      >
        <div className="nv-outline__fs">
          <button
            type="button"
            className="nv-outline__check"
            aria-pressed={node.resolved}
            aria-label={node.resolved ? "标记为待回收" : "标记为已回收"}
            title={node.resolved ? "已回收，点击恢复待回收" : "标记为已回收"}
            onClick={() => actions.onToggleForeshadow(node.entryId, !node.resolved)}
          >
            <span className="nv-outline__check-mark">✓</span>
          </button>

          <div className="nv-outline__fs-body">
            <div className="nv-outline__fs-head">
              <span className="nv-outline__tag">
                {node.resolved ? "已回收" : "伏笔"}
              </span>
              <span className="nv-outline__fs-title">{node.title}</span>
              <span className="nv-outline__fs-tools">
                <button
                  type="button"
                  className="nv-mini"
                  aria-label="编辑伏笔"
                  title="编辑伏笔"
                  onClick={() => startEditForeshadow(node)}
                >
                  <EditOutlined />
                </button>
                <button
                  type="button"
                  className="nv-mini nv-mini--warn"
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
            <span className="nv-outline__fs-src">
              {node.source || "卷级伏笔 · 不绑定具体章"}
            </span>
          </div>
        </div>
      </li>
    );
  };

  const renderFsFilters = () => (
    <div className="nv-sub nv-outline__filter">
      <button
        type="button"
        className={`nv-sub__btn${fsFilter === "open" ? " is-on" : ""}`}
        onClick={() => setFsFilter("open")}
      >
        待回收<span className="nv-sub__count">{openForeshadows}</span>
      </button>
      <button
        type="button"
        className={`nv-sub__btn${fsFilter === "resolved" ? " is-on" : ""}`}
        onClick={() => setFsFilter("resolved")}
      >
        已回收
        <span className="nv-sub__count">
          {allForeshadows.length - openForeshadows}
        </span>
      </button>
      <button
        type="button"
        className={`nv-sub__btn${fsFilter === "all" ? " is-on" : ""}`}
        onClick={() => setFsFilter("all")}
      >
        全部<span className="nv-sub__count">{allForeshadows.length}</span>
      </button>
    </div>
  );

  return (
    <div className="nv-outline">
      <div className="nv-outline__summary">
        <div>
          <b>{volumeNodes.length}</b>
          <span>卷</span>
        </div>
        <div>
          <b>{totalChapters}</b>
          <span>章</span>
        </div>
        <div className={openForeshadows > 0 ? "is-warn" : undefined}>
          <b>{openForeshadows}</b>
          <span>待回收伏笔</span>
        </div>
      </div>

      <div className="nv-sub nv-outline__switch">
        <button
          type="button"
          className={`nv-sub__btn${view === "chapter" ? " is-on" : ""}`}
          onClick={() => setView("chapter")}
        >
          章节<span className="nv-sub__count">{totalChapters}</span>
        </button>
        <button
          type="button"
          className={`nv-sub__btn${view === "fs" ? " is-on" : ""}`}
          onClick={() => setView("fs")}
        >
          伏笔<span className="nv-sub__count">{allForeshadows.length}</span>
        </button>
      </div>

      {view === "fs" ? (
        <>
          {renderFsFilters()}
          {filteredForeshadows.length === 0 ? (
            <div className="nv-empty">
              <b>这里空着</b>
              <span>切回「待回收」看看还没收的线头</span>
            </div>
          ) : (
            <ul className="nv-outline__fs-list">
              {filteredForeshadows.map(renderForeshadow)}
            </ul>
          )}
        </>
      ) : (
        volumeNodes.map((volume) => {
          const chapters = volume.children.filter(isChapter);
          // 埋设章节下拉选项（组件库 Select，AGENTS 6.1.2）
          const chapterOptions = chapters.map((chapter) => ({
            value: chapter.chapterId,
            label: `${chapter.label} ${chapter.title}`,
          }));
          const adding =
            fsTarget?.mode === "add" && fsTarget.volumeId === volume.id;
          const isFolded = Boolean(folded[volume.id]);

          return (
            <section
              key={volume.id}
              className={`nv-outline__vol${isFolded ? " is-fold" : ""}`}
            >
              <div className="nv-outline__vol-head">
                <button
                  type="button"
                  className="nv-outline__vol-toggle"
                  onClick={() =>
                    setFolded((current) => ({
                      ...current,
                      [volume.id]: !current[volume.id],
                    }))
                  }
                  title={isFolded ? "展开本卷" : "收起本卷"}
                >
                  <DownOutlined className="nv-outline__vol-chev" />
                  <span className="nv-outline__vol-title">{volume.title}</span>
                  {volume.note && (
                    <span className="nv-outline__vol-note">{volume.note}</span>
                  )}
                  <span className="nv-outline__vol-count">
                    {chapters.length} 章
                  </span>
                </button>
                {volume.openForeshadows > 0 && (
                  <span
                    className="nv-outline__vol-pill"
                    title={`${volume.openForeshadows} 条伏笔待回收`}
                  >
                    {volume.openForeshadows}
                  </span>
                )}
                <button
                  type="button"
                  className="nv-outline__vol-add"
                  title="在本卷添加伏笔"
                  onClick={() => startAddForeshadow(volume.id)}
                >
                  <PlusOutlined />
                </button>
              </div>

              <div className="nv-outline__vol-list">
                {chapters.length === 0 ? (
                  <p className="nv-outline__hint">本卷还没有章节</p>
                ) : (
                  <ul className="nv-outline__list">{chapters.map(renderChapter)}</ul>
                )}
              </div>

              {adding && (
                <div className="nv-outline__form">
                  <input
                    className="nv-outline__input"
                    value={fsDraft.title}
                    autoFocus
                    maxLength={30}
                    aria-label="伏笔标题"
                    placeholder="伏笔标题（Enter 记录 / Esc 取消）"
                    onChange={(event) =>
                      setFsDraft((draft) => ({
                        ...draft,
                        title: event.target.value,
                      }))
                    }
                    onKeyDown={handleFsTitleKeyDown}
                  />
                  <textarea
                    className="nv-outline__textarea"
                    value={fsDraft.note}
                    rows={2}
                    aria-label="伏笔说明"
                    placeholder="说明：埋在哪一章 / 计划怎么回收"
                    onChange={(event) =>
                      setFsDraft((draft) => ({
                        ...draft,
                        note: event.target.value,
                      }))
                    }
                  />
                  {chapters.length > 0 && (
                    <Select
                      className="nv-outline__select"
                      size="small"
                      classNames={{ popup: { root: "nv-outline__dropdown" } }}
                      aria-label="埋设章节"
                      placeholder="卷级伏笔（不绑具体章）"
                      value={fsDraft.chapterId || undefined}
                      options={chapterOptions}
                      onChange={(value: string) =>
                        setFsDraft((draft) => ({ ...draft, chapterId: value }))
                      }
                    />
                  )}
                  <div className="nv-outline__form-actions">
                    <button
                      type="button"
                      className="nv-outline__save"
                      onClick={commitForeshadow}
                    >
                      记录
                    </button>
                    <button
                      type="button"
                      className="nv-outline__cancel"
                      onClick={cancelForeshadow}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
