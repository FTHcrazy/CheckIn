import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  CloseOutlined,
  EditOutlined,
  FlagOutlined,
  PushpinFilled,
  PushpinOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Virtuoso } from "react-virtuoso";
import { filterNotes, formatRelativeTime } from "../../novel-utils";
import type { NovelNote } from "../../types";
import "./index.scss";

/** 灵感面板动作组：由页面组合层注入，面板本身不接触数据层 Hook */
export interface InspirationActions {
  onAddNote: (content: string) => void;
  onUpdateNote: (noteId: string, content: string) => void;
  /** 置顶切换：pinned 是切换后的目标状态 */
  onTogglePin: (noteId: string, pinned: boolean) => void;
  onRemoveNote: (noteId: string) => void;
  /** 一键把灵感转成大纲伏笔（跨面板联动，在页面层编排） */
  onPromoteNote: (noteId: string) => void;
}

interface InspirationPanelProps {
  /** 当前作品的灵感（已按「置顶优先 + 时间倒序」排好序） */
  notes: NovelNote[];
  /** 全部作品的灵感：搜索时的全局数据源；缺省退化为仅当前作品 */
  globalNotes?: NovelNote[];
  /** 当前作品 id：搜索结果里非本作品的灵感标注来源并只读展示 */
  activeWorkId?: string;
  /** 作品 id → 书名（外部灵感的来源标签） */
  workNameOf?: (workId: string) => string;
  actions: InspirationActions;
}

/**
 * 灵感速记面板（PRD R7）
 *
 * 写作中一键把想法甩进来，不离开正文：新增 / 编辑都自持草稿并做 IME 守卫
 * （中文候选期间的回车不上抛）；重要灵感可置顶，卡壳时置顶的永远在最上面。
 * 与大纲的联动只有一条：灵感可以一键落成伏笔，落点由页面层决定。
 * 搜索为全局口径：关键词命中全部书籍的灵感，其他书的灵感只读展示来源。
 *
 * 列表虚拟化：灵感可能积累到上千条，不允许全量挂载。
 */
export default function InspirationPanel({
  notes,
  globalNotes,
  activeWorkId = "",
  workNameOf,
  actions,
}: InspirationPanelProps) {
  // 新增草稿
  const [draft, setDraft] = useState("");
  const composingRef = useRef(false);

  // 搜索关键词：本面板的短生命周期状态，不进全局
  const [keyword, setKeyword] = useState("");

  // 编辑草稿
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // 全局搜索池：有关键词时跨全部书籍检索；无关键词展示当前作品列表
  const searchPool = globalNotes ?? notes;
  const filtering = keyword.trim().length > 0;

  const visible = useMemo(
    () => (filtering ? filterNotes(searchPool, keyword) : notes),
    [filtering, searchPool, keyword, notes],
  );
  const pinnedCount = notes.filter((note) => note.pinned).length;

  const countText = filtering
    ? `${visible.length} / ${searchPool.length}${
        pinnedCount > 0 ? ` · 置顶 ${pinnedCount}` : ""
      }`
    : `${notes.length} 条${pinnedCount > 0 ? ` · 置顶 ${pinnedCount}` : ""}`;

  /** 其他书籍的灵感：全局搜索结果中只读展示，操作留给归属作品 */
  const isExternal = (note: NovelNote): boolean =>
    Boolean(activeWorkId) && note.workId !== activeWorkId;

  const submit = (): void => {
    const value = draft.trim();
    if (!value) return;
    actions.onAddNote(value);
    setDraft("");
  };

  const startEdit = (note: NovelNote): void => {
    setEditingId(note.id);
    setEditDraft(note.content);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setEditDraft("");
  };

  const commitEdit = (note: NovelNote): void => {
    const trimmed = editDraft.trim();
    setEditingId(null);
    // 空内容与未改动都不落库（编辑态照常退出，行为与左栏改名一致）
    if (trimmed && trimmed !== note.content) {
      actions.onUpdateNote(note.id, trimmed);
    }
  };

  const handleEditKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    note: NovelNote,
  ): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      cancelEdit();
      return;
    }
    // Enter 保存、Shift+Enter 换行（与新增框一致）
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    commitEdit(note);
  };

  const renderNote = (note: NovelNote, index: number) => {
    const external = isExternal(note);
    const preceding = index > 0 ? visible[index - 1] : null;
    // 置顶分组独立成段：卡壳时一眼看到最重要的那几条
    const pinnedHead = index === 0 && note.pinned;
    const restHead = !note.pinned && (index === 0 || Boolean(preceding?.pinned));

    return (
      <div className="nv-note__item" key={note.id}>
        {pinnedHead && (
          <div className="nv-sechead">
            置顶<em>{pinnedCount}</em>
          </div>
        )}
        {restHead && (
          <div className="nv-sechead">
            {pinnedCount > 0 ? "最近" : "全部"}
            <em>{visible.length - pinnedCount}</em>
          </div>
        )}
        <div
          className={`nv-note__card${note.pinned ? " is-pinned" : ""}`}
          role="group"
          aria-label={note.content}
        >
          {editingId === note.id ? (
            <>
              <textarea
                className="nv-note__edit"
                value={editDraft}
                autoFocus
                rows={3}
                aria-label="编辑灵感内容"
                onChange={(event) => setEditDraft(event.target.value)}
                onKeyDown={(event) => handleEditKeyDown(event, note)}
                onBlur={() => commitEdit(note)}
              />
              <footer className="nv-note__foot">
                <span className="nv-note__tip">
                  Enter 保存 · Shift+Enter 换行 · Esc 取消
                </span>
              </footer>
            </>
          ) : (
            <>
              <p className="nv-note__text">{note.content}</p>
              <footer className="nv-note__foot">
                <span className="nv-note__time">
                  {formatRelativeTime(note.createdAt)}
                </span>
                {external && (
                  <span
                    className="nv-note__src"
                    title={`来自《${workNameOf?.(note.workId) ?? "其他作品"}》`}
                  >
                    {workNameOf?.(note.workId) ?? "其他作品"}
                  </span>
                )}
                {note.foreshadowId && (
                  <span className="nv-note__flag" title="已写入大纲为伏笔">
                    <FlagOutlined /> 已转为伏笔
                  </span>
                )}
                {!external && (
                  <span className="nv-note__acts">
                    <button
                      type="button"
                      className={`nv-mini${note.pinned ? " is-on" : ""}`}
                      aria-pressed={note.pinned}
                      aria-label={note.pinned ? "取消置顶" : "置顶"}
                      title={note.pinned ? "取消置顶" : "置顶"}
                      onClick={() => actions.onTogglePin(note.id, !note.pinned)}
                    >
                      {note.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                    </button>
                    <button
                      type="button"
                      className="nv-mini"
                      disabled={Boolean(note.foreshadowId)}
                      aria-label="转为伏笔"
                      title={
                        note.foreshadowId
                          ? "已转为伏笔"
                          : "转为伏笔（写入大纲）"
                      }
                      onClick={() => actions.onPromoteNote(note.id)}
                    >
                      <FlagOutlined />
                    </button>
                    <button
                      type="button"
                      className="nv-mini"
                      aria-label="编辑灵感"
                      title="编辑灵感"
                      onClick={() => startEdit(note)}
                    >
                      <EditOutlined />
                    </button>
                    <button
                      type="button"
                      className="nv-mini nv-mini--warn"
                      aria-label="删除灵感"
                      title="删除灵感"
                      onClick={() => actions.onRemoveNote(note.id)}
                    >
                      <CloseOutlined />
                    </button>
                  </span>
                )}
              </footer>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="nv-note">
      <div className="nv-note__composer">
        <textarea
          value={draft}
          placeholder="甩一句灵感进来…"
          aria-label="新增灵感"
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            if (composingRef.current || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
        />
        <div className="nv-note__composer-foot">
          <span className="nv-note__tip">
            <kbd>Enter</kbd> 记录 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行
          </span>
          <button
            type="button"
            className="nv-note__send"
            onClick={submit}
            disabled={draft.trim().length === 0}
          >
            记录
          </button>
        </div>
      </div>

      <div className="nv-field nv-note__search">
        <SearchOutlined />
        <input
          value={keyword}
          placeholder="搜索灵感（全书口径）"
          aria-label="搜索灵感"
          onChange={(event) => setKeyword(event.target.value)}
        />
        {filtering && (
          <button
            type="button"
            className="nv-field__clear"
            aria-label="清空搜索"
            onClick={() => setKeyword("")}
          >
            <CloseOutlined />
          </button>
        )}
      </div>

      {searchPool.length === 0 ? (
        <div className="nv-empty">
          <b>还没有灵感记录</b>
          <span>想到什么先甩进来，之后再整理</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="nv-empty">
          <b>没有匹配「{keyword.trim()}」的灵感</b>
          <span>清空关键词看看全部</span>
        </div>
      ) : (
        <>
          <div className="nv-sechead">
            本作品灵感<em>{countText}</em>
          </div>
          <Virtuoso
            className="nv-note__list"
            style={{ flex: 1, minHeight: 0 }}
            data={visible}
            overscan={8}
            computeItemKey={(_, note) => note.id}
            itemContent={(index, note) => renderNote(note, index)}
          />
        </>
      )}
    </div>
  );
}
