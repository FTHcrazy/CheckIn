import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  DownOutlined,
  DeleteOutlined,
  EditOutlined,
  FlagOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Input, Select, Tooltip } from "antd";
import { CHAPTER_STATUS_META } from "../../novel-config";
import { formatThousands } from "../../novel-utils";
import type { ForeshadowPatch, OutlineNode } from "../../types";
import "./index.scss";

const { TextArea } = Input;

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

/** 伏笔编辑 / 新增的当前目标（弹在哪一行）
 *
 * add：anchor 缺省 = 挂在卷尾的卷级新增（面板头 / 卷头「＋」入口）；
 * anchor = 章节 node id 时表单内联在该章下方（章节行「＋」入口，
 * 草稿的 chapterId 预设为该章）。
 */
type ForeshadowTarget =
  | { mode: "add"; volumeId: string; anchor?: string }
  | { mode: "edit"; entryId: string; volumeId: string };

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

  /**
   * 章节行展开的伏笔清单：点章节行上的旗标标识即开合。
   *
   * 起因：标识原来只报个数，作者看到「2」还得切到「伏笔」页再按章节名找一遍
   * —— 记伏笔是为了回收时能想起来，找不到就等于没记。
   * 按章节 id 存（可同时展开多章），与卷折叠 `folded` 同一套写法。
   */
  const [expandedFs, setExpandedFs] = useState<Record<string, boolean>>({});

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

  /**
   * 章节 id → 该章埋的伏笔。章节行展开清单与悬浮预览共用一份索引。
   *
   * 顺序直接沿用大纲里的既有顺序（`buildOutlineTree` 已按「未回收在前、同级按
   * 写入时间」排过），不再排一次 —— 免得同一批伏笔在两处呈现不同次序。
   * 卷级伏笔（没绑章）不进索引，它由卷头的计数承载。
   */
  const foreshadowsOfChapter = new Map<string, ForeshadowNode[]>();
  for (const node of allForeshadows) {
    if (!node.chapterId) continue;
    const list = foreshadowsOfChapter.get(node.chapterId);
    if (list) list.push(node);
    else foreshadowsOfChapter.set(node.chapterId, [node]);
  }

  const toggleChapterFs = (chapterId: string): void =>
    setExpandedFs((current) => ({ ...current, [chapterId]: !current[chapterId] }));

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

  /** 章节行「＋」入口：表单内联在该章下方，埋设章节预设为本章 */
  const startAddForeshadowAt = (volumeId: string, chapterId: string): void => {
    setFsDraft({ ...EMPTY_DRAFT, chapterId });
    setFsTarget({ mode: "add", volumeId, anchor: chapterId });
  };

  const startEditForeshadow = (node: ForeshadowNode): void => {
    setFsDraft({ title: node.title, note: node.note, chapterId: node.chapterId });
    setFsTarget({ mode: "edit", entryId: node.entryId, volumeId: node.volumeId });
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
      // 记完就展开该章的清单：否则刚写下的伏笔只体现在标识的数字上，
      // 作者还是不知道「是哪条」（这正是本来的痛点）
      const anchor = fsTarget.anchor;
      if (anchor) setExpandedFs((current) => ({ ...current, [anchor]: true }));
    } else {
      actions.onUpdateForeshadow(fsTarget.entryId, {
        title,
        note: fsDraft.note,
        // 改绑埋设章节：空串 = 退回卷级（patchOutlineEntry 负责归一化）
        chapterId: fsDraft.chapterId,
      });
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

  /** 某卷的埋设章节下拉选项（伏笔表单共用） */
  const chapterOptionsOf = (volumeId: string) => {
    const volume = volumeNodes.find((node) => node.id === volumeId);
    if (!volume) return [];
    return volume.children.filter(isChapter).map((chapter) => ({
      value: chapter.chapterId,
      label: `${chapter.label} ${chapter.title}`,
    }));
  };

  /** 伏笔表单（新增卷级 / 新增章节级 / 编辑三处共用，差异只在提交按钮文案） */
  const renderFsForm = (
    chapterOptions: Array<{ value: string; label: string }>,
    saveLabel: string,
  ) => (
    <div className="nv-outline__form">
      <Input
        variant="borderless"
        className="nv-outline__input"
        value={fsDraft.title}
        autoFocus
        maxLength={30}
        aria-label="伏笔标题"
        placeholder={`伏笔标题（Enter ${saveLabel} / Esc 取消）`}
        onChange={(event) =>
          setFsDraft((draft) => ({ ...draft, title: event.target.value }))
        }
        onKeyDown={handleFsTitleKeyDown}
      />
      <TextArea
        variant="borderless"
        className="nv-outline__textarea"
        value={fsDraft.note}
        rows={2}
        aria-label="伏笔说明"
        placeholder="说明：埋在哪一章 / 计划怎么回收"
        onChange={(event) =>
          setFsDraft((draft) => ({ ...draft, note: event.target.value }))
        }
      />
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
      <div className="nv-outline__form-actions">
        <Button className="nv-outline__save" onClick={commitForeshadow}>
          {saveLabel}
        </Button>
        <Button className="nv-outline__cancel" onClick={cancelForeshadow}>
          取消
        </Button>
      </div>
    </div>
  );

  const renderChapter = (node: ChapterNode, volumeId: string) => {
    const active = node.chapterId === activeChapterId;
    const editing = noteEditingId === node.chapterId;
    const addingHere = fsTarget?.mode === "add" && fsTarget.anchor === node.id;

    const boundForeshadows = foreshadowsOfChapter.get(node.chapterId) ?? [];
    // 展开态 = 用户点开的，或者正在这份行内清单里编辑某一条 ——
    // 编辑中不能被「收起」把表单连同草稿一起藏掉（点标识收起时最容易撞上）
    const inlineEditId = fsTarget?.mode === "edit" ? fsTarget.entryId : null;
    const fsOpen =
      Boolean(expandedFs[node.chapterId]) ||
      (inlineEditId !== null &&
        boundForeshadows.some((item) => item.entryId === inlineEditId));

    // 标识的悬浮预览：不点开也能先看清埋的是哪几条
    const fsTip = (
      <div className="nv-outline__fs-tip">
        <b>
          本章埋了 {node.foreshadows} 条伏笔
          {node.openForeshadows > 0
            ? `，其中 ${node.openForeshadows} 条待回收`
            : "，已全部回收"}
        </b>
        {boundForeshadows.map((item) => (
          <span key={item.id} className={item.resolved ? "is-resolved" : undefined}>
            {item.title}
          </span>
        ))}
        <em>{fsOpen ? "点击收起清单" : "点击在本章下方展开"}</em>
      </div>
    );

    return (
      <li
        key={node.id}
        className={`nv-outline__item${active ? " is-active" : ""}`}
      >
        {/* 行容器 + 并列真按钮（§6.1.2 第 4 条）：旗标标识是**按钮**（点开本章的
            伏笔清单），而 <button> 里不能嵌 <button>（浏览器会拆坏 DOM，
            React 不报错）→ 标识只能与整行按钮并列。
            行尾的字数与状态点因此也一并挪到行容器里：它们本来就是纯文本，留
            在按钮里的话，「有标识的行」会因标识占位而把这列整体推左，同一屏里
            几个章节的字数对不到一条竖线上。行的底色/描边/hover 态挂在行容器上，
            两个按钮各自清零后只声明文字色 */}
        <div className="nv-outline__line">
          <Button
            className="nv-outline__row"
            onClick={() => onSelectChapter(node.chapterId)}
          >
            <span className="nv-outline__no">{node.label}</span>
            <span className="nv-outline__title">{node.title}</span>
          </Button>

          {/* 本章埋了伏笔就留个标识：伏笔列表是另一个子视图，不标出来作者在
              骨架里根本看不出哪一章埋过线头。待回收走警示色，全部回收后转中性，
              但标识保留（「这章埋过」本身就是大纲要记住的信息）。
              点它就是展开 / 收起本章的伏笔清单 —— 不用再切到「伏笔」页找一遍 */}
          {node.foreshadows > 0 && (
            <Tooltip title={fsTip} mouseEnterDelay={0.15}>
              <Button
                className={`nv-outline__ch-fs${
                  node.openForeshadows > 0 ? " is-open" : ""
                }${fsOpen ? " is-expanded" : ""}`}
                aria-expanded={fsOpen}
                aria-label={`本章 ${node.foreshadows} 条伏笔，点击${
                  fsOpen ? "收起" : "展开"
                }清单`}
                onClick={() => toggleChapterFs(node.chapterId)}
              >
                <FlagOutlined />
                {node.foreshadows}
                <DownOutlined className="nv-outline__ch-fs-chev" />
              </Button>
            </Tooltip>
          )}

          <span className="nv-outline__words">
            {node.wordCount > 0 ? formatThousands(node.wordCount) : "—"}
          </span>
          <span
            className="nv-outline__dot"
            style={{ background: CHAPTER_STATUS_META[node.status].color }}
            title={CHAPTER_STATUS_META[node.status].label}
          />
        </div>
        {/* 章节级伏笔入口：悬停浮现（§6.1.2 行容器 + 并列真按钮，
            不能嵌进行按钮里）；表单内联在本章下方，绑定预设为本章 */}
        <Button
          className="nv-outline__row-add"
          title="在本章添加伏笔"
          aria-label={`在本章（${node.label} ${node.title}）添加伏笔`}
          onClick={() => startAddForeshadowAt(volumeId, node.chapterId)}
        >
          <PlusOutlined />
        </Button>

        {editing ? (
          <Input
            variant="borderless"
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
          <Button
            className={`nv-outline__note${node.note ? "" : " is-empty"}`}
            title="点击编辑一句话梗概"
            onClick={() => startNoteEdit(node)}
          >
            {node.note || "＋ 一句话梗概"}
          </Button>
        )}

        {/* 本章的伏笔清单：就挂在章节下面，回收 / 编辑 / 删除都在原地完成，
            不必切到「伏笔」页再按章节名找一遍。复用伏笔页的行渲染（compact
            变体：去掉重复的「埋在哪一章」标签） */}
        {fsOpen && boundForeshadows.length > 0 && (
          <ul className="nv-outline__ch-fs-list">
            {boundForeshadows.map((item) => renderForeshadow(item, true))}
          </ul>
        )}

        {addingHere && renderFsForm(chapterOptionsOf(volumeId), "记录")}
      </li>
    );
  };

  const renderForeshadow = (node: ForeshadowNode, compact = false) => {
    const editing = fsTarget?.mode === "edit" && fsTarget.entryId === node.entryId;

    if (editing) {
      return (
        <li key={node.id} className="nv-outline__fs-item is-editing">
          {renderFsForm(chapterOptionsOf(node.volumeId), "保存")}
        </li>
      );
    }

    return (
      <li
        key={node.id}
        className={`nv-outline__fs-item${node.resolved ? " is-resolved" : ""}${
          compact ? " is-compact" : ""
        }`}
      >
        <div className="nv-outline__fs">
          <Button
            className="nv-outline__check"
            aria-pressed={node.resolved}
            aria-label={node.resolved ? "标记为待回收" : "标记为已回收"}
            title={node.resolved ? "已回收，点击恢复待回收" : "标记为已回收"}
            onClick={() => actions.onToggleForeshadow(node.entryId, !node.resolved)}
          >
            <span className="nv-outline__check-mark">✓</span>
          </Button>

          <div className="nv-outline__fs-body">
            <div className="nv-outline__fs-head">
              <span className="nv-outline__tag">
                {node.resolved ? "已回收" : "伏笔"}
              </span>
              <span className="nv-outline__fs-title">{node.title}</span>
              <span className="nv-outline__fs-tools">
                <Button
                  className="nv-mini"
                  aria-label="编辑伏笔"
                  title="编辑伏笔"
                  onClick={() => startEditForeshadow(node)}
                >
                  <EditOutlined />
                </Button>
                <Button
                  className="nv-mini nv-mini--warn"
                  aria-label="删除伏笔"
                  title="删除伏笔"
                  onClick={() =>
                    actions.onRemoveForeshadow(node.entryId, node.title)
                  }
                >
                  <DeleteOutlined />
                </Button>
              </span>
            </div>
            {node.note && <p className="nv-outline__fs-note">{node.note}</p>}
            {/* 行内清单已经挂在那一章下面了，再标一次「埋在哪一章」是废话 */}
            {!compact && (
              <span className="nv-outline__fs-src">
                {node.source || "卷级伏笔 · 不绑定具体章"}
              </span>
            )}
          </div>
        </div>
      </li>
    );
  };

  const renderFsFilters = () => (
    <div className="nv-sub nv-outline__filter">
      <Button
        className={`nv-sub__btn${fsFilter === "open" ? " is-on" : ""}`}
        onClick={() => setFsFilter("open")}
      >
        待回收<span className="nv-sub__count">{openForeshadows}</span>
      </Button>
      <Button
        className={`nv-sub__btn${fsFilter === "resolved" ? " is-on" : ""}`}
        onClick={() => setFsFilter("resolved")}
      >
        已回收
        <span className="nv-sub__count">
          {allForeshadows.length - openForeshadows}
        </span>
      </Button>
      <Button
        className={`nv-sub__btn${fsFilter === "all" ? " is-on" : ""}`}
        onClick={() => setFsFilter("all")}
      >
        全部<span className="nv-sub__count">{allForeshadows.length}</span>
      </Button>
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
        <Button
          className={`nv-sub__btn${view === "chapter" ? " is-on" : ""}`}
          onClick={() => setView("chapter")}
        >
          章节<span className="nv-sub__count">{totalChapters}</span>
        </Button>
        <Button
          className={`nv-sub__btn${view === "fs" ? " is-on" : ""}`}
          onClick={() => setView("fs")}
        >
          伏笔<span className="nv-sub__count">{allForeshadows.length}</span>
        </Button>
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
              {filteredForeshadows.map((node) => renderForeshadow(node))}
            </ul>
          )}
        </>
      ) : (
        volumeNodes.map((volume) => {
          const chapters = volume.children.filter(isChapter);
          // 卷级新增（面板头 / 卷头「＋」入口）：表单挂在卷尾；
          // 章节级新增的表单内联在对应章的 li 里，不走这里
          const adding =
            fsTarget?.mode === "add" &&
            fsTarget.volumeId === volume.id &&
            !fsTarget.anchor;
          const isFolded = Boolean(folded[volume.id]);

          return (
            <section
              key={volume.id}
              className={`nv-outline__vol${isFolded ? " is-fold" : ""}`}
            >
              <div className="nv-outline__vol-head">
                <Button
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
                </Button>
                {volume.openForeshadows > 0 && (
                  <span
                    className="nv-outline__vol-pill"
                    title={`${volume.openForeshadows} 条伏笔待回收`}
                  >
                    {volume.openForeshadows}
                  </span>
                )}
                <Button
                  className="nv-outline__vol-add"
                  title="在本卷添加卷级伏笔（不绑具体章）"
                  onClick={() => startAddForeshadow(volume.id)}
                >
                  <PlusOutlined />
                </Button>
              </div>

              <div className="nv-outline__vol-list">
                {chapters.length === 0 ? (
                  <p className="nv-outline__hint">本卷还没有章节</p>
                ) : (
                  <ul className="nv-outline__list">
                    {chapters.map((chapter) => renderChapter(chapter, volume.id))}
                  </ul>
                )}
              </div>

              {adding && renderFsForm(chapterOptionsOf(volume.id), "记录")}
            </section>
          );
        })
      )}
    </div>
  );
}
