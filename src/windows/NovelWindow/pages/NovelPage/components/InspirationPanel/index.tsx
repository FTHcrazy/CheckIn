import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  CloseOutlined,
  EditOutlined,
  FlagOutlined,
  FolderAddOutlined,
  PushpinFilled,
  PushpinOutlined,
  RollbackOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Input, Modal, Popconfirm, Select } from "antd";
import { Virtuoso } from "react-virtuoso";
import { filterNotes, formatRelativeTime } from "../../novel-utils";
import type { NovelNote } from "../../types";
import "./index.scss";

const { TextArea } = Input;

/** 灵感面板动作组：由页面组合层注入，面板本身不接触数据层 Hook */
export interface InspirationActions {
  onAddNote: (content: string) => void;
  onUpdateNote: (noteId: string, content: string) => void;
  /** 置顶切换：pinned 是切换后的目标状态 */
  onTogglePin: (noteId: string, pinned: boolean) => void;
  onRemoveNote: (noteId: string) => void;
  /**
   * 一键把灵感转成大纲伏笔（跨面板联动，在页面层编排）。
   * O-12：未归属灵感先由本面板弹归属选择，选中作品 id 作为第二参传入；
   * 已归属灵感省略第二参（用 note 自身的 workId）。
   */
  onPromoteNote: (noteId: string, workId?: string) => void;
  /** O-12 归属迁移：workId 传 '' 退回未归属池 */
  onMoveNote?: (noteId: string, workId: string) => void;
  /** O-12「查看全部」：打开全局灵感抽屉 */
  onOpenAll?: () => void;
  /**
   * R-AI-11「卡文急救」：第三个入口。
   *
   * 为什么灵感面板也要有这个入口：卡文的时刻八成正在翻灵感——想不起接下来
   * 该写什么时才来翻旧点子。入口开在同一处，等于把「翻灵感」与「要几个走向」
   * 合成一个动作，而不是让作者关面板、去正文找按钮。
   */
  onRescue?: () => void;
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
  /** O-12：可归属的作品列表（未归属灵感的「归属到」下拉 / 转伏笔前置选择） */
  workOptions?: Array<{ id: string; name: string }>;
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
  workOptions = [],
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

  /**
   * O-12 未归属灵感转伏笔的归属选择弹窗：null = 关闭，否则是被转的 noteId。
   * 默认归属当前作品；确认后先迁移归属再转伏笔（单向流 ①→②→③）。
   */
  const [promotePick, setPromotePick] = useState<{
    noteId: string;
    workId: string;
  } | null>(null);

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

  /**
   * 其他书籍的灵感：全局搜索结果中只读展示，操作留给归属作品。
   * 「未归属」（workId 为空）不算外部 —— 1.41.0 起它直接进当前列表，
   * 置顶 / 编辑 / 转伏笔都可用（它是跨作品收集池，不属于任何一本书管）。
   */
  const isExternal = (note: NovelNote): boolean =>
    Boolean(activeWorkId) && Boolean(note.workId) && note.workId !== activeWorkId;

  /**
   * 转伏笔入口：已归属直接转；未归属先弹归属选择（默认当前作品）。
   * 走 Modal + Select 而非 Modal.confirm：需要「选作品」这一步，确认框里
   * 放一个受控 Select 才能把归属选择交给用户（O-12 §2.3）。
   */
  const requestPromote = (note: NovelNote): void => {
    if (note.workId) {
      actions.onPromoteNote(note.id);
      return;
    }
    setPromotePick({ noteId: note.id, workId: activeWorkId });
  };

  const confirmPromote = (): void => {
    if (!promotePick) return;
    const { noteId, workId } = promotePick;
    setPromotePick(null);
    if (!workId) return;
    actions.onPromoteNote(noteId, workId);
  };

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
              <TextArea
                variant="borderless"
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
              {/* hover 操作条：浮到卡片右上角（REQ-054 视觉优化）。不再塞进 footer
                  与时间/来源/伏笔角标挤作一行 —— 那里按钮横向压成一条、和正文重叠。
                  现在它是独立的浮层条（卡片底 + 发丝线边 + 阴影），只在悬停时出现。 */}
              {!external && (
                <span className="nv-note__acts">
                  <Button
                    className={`nv-mini${note.pinned ? " is-on" : ""}`}
                    aria-pressed={note.pinned}
                    aria-label={note.pinned ? "取消置顶" : "置顶"}
                    title={note.pinned ? "取消置顶" : "置顶"}
                    onClick={() => actions.onTogglePin(note.id, !note.pinned)}
                  >
                    {note.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                  </Button>
                  {/*
                    O-12 归属动作（单向流）：未归属 →「归属到」下拉；已归属 →
                    「退回灵感池」。已转伏笔的灵感不允许再改归属（会断开反链）。
                  */}
                  {actions.onMoveNote && !note.foreshadowId && (
                    note.workId ? (
                      <Button
                        className="nv-mini"
                        aria-label="退回灵感池"
                        title="退回灵感池"
                        onClick={() => actions.onMoveNote?.(note.id, "")}
                      >
                        <RollbackOutlined />
                      </Button>
                    ) : (
                      <Dropdown
                        trigger={["click"]}
                        disabled={workOptions.length === 0}
                        menu={{
                          items: workOptions.map((work) => ({
                            key: work.id,
                            label: `归属到《${work.name}》`,
                          })),
                          onClick: ({ key }) =>
                            actions.onMoveNote?.(note.id, String(key)),
                        }}
                      >
                        <Button
                          className="nv-mini"
                          aria-label="归属到"
                          title={workOptions.length ? "归属到" : "先创建作品再归属"}
                          disabled={workOptions.length === 0}
                        >
                          <FolderAddOutlined />
                        </Button>
                      </Dropdown>
                    )
                  )}
                  <Button
                    className="nv-mini"
                    disabled={Boolean(note.foreshadowId)}
                    aria-label="转为伏笔"
                    title={
                      note.foreshadowId
                        ? "已转为伏笔"
                        : "转为伏笔（写入大纲）"
                    }
                    onClick={() => requestPromote(note)}
                  >
                    <FlagOutlined />
                  </Button>
                  <Button
                    className="nv-mini"
                    aria-label="编辑灵感"
                    title="编辑灵感"
                    onClick={() => startEdit(note)}
                  >
                    <EditOutlined />
                  </Button>
                  {note.foreshadowId ? (
                    <Popconfirm
                      title="这条灵感已转为伏笔，删除后大纲伏笔仍保留。继续删除？"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => actions.onRemoveNote(note.id)}
                    >
                      <Button
                        className="nv-mini nv-mini--warn"
                        aria-label="删除灵感"
                        title="删除灵感"
                      >
                        <CloseOutlined />
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button
                      className="nv-mini nv-mini--warn"
                      aria-label="删除灵感"
                      title="删除灵感"
                      onClick={() => actions.onRemoveNote(note.id)}
                    >
                      <CloseOutlined />
                    </Button>
                  )}
                </span>
              )}
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
        <TextArea
          variant="borderless"
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
          {actions.onRescue && (
            <Button
              className="nv-note__rescue"
              type="text"
              aria-label="卡文急救：要几个后续走向"
              onClick={actions.onRescue}
            >
              卡文急救
            </Button>
          )}
          <Button
            className="nv-note__send"
            onClick={submit}
            disabled={draft.trim().length === 0}
          >
            记录
          </Button>
        </div>
      </div>

      <div className="nv-note__search-row">
        <div className="nv-field nv-note__search">
          <SearchOutlined />
          <Input
            variant="borderless"
            value={keyword}
            placeholder="搜索灵感（全书口径）"
            aria-label="搜索灵感"
            onChange={(event) => setKeyword(event.target.value)}
          />
          {filtering && (
            <Button
              className="nv-field__clear"
              aria-label="清空搜索"
              onClick={() => setKeyword("")}
            >
              <CloseOutlined />
            </Button>
          )}
        </div>
        {actions.onOpenAll && (
          <Button
            type="link"
            aria-label="查看全部灵感"
            onClick={actions.onOpenAll}
          >
            查看全部 →
          </Button>
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

      {/*
        O-12 未归属灵感转伏笔的归属选择：默认当前作品，确认后由页面层
        先迁移归属再写 foreshadowId（单向流 ①→②→③，不跳过中间态）。
      */}
      <Modal
        className="nv-note__pick"
        title="先归属，再转为伏笔"
        open={promotePick !== null}
        okText="归属并转伏笔"
        cancelText="取消"
        onOk={confirmPromote}
        onCancel={() => setPromotePick(null)}
        okButtonProps={{ disabled: !promotePick?.workId }}
      >
        <p className="nv-note__pick-tip">
          伏笔属于具体作品的大纲。请先选一条灵感要归属的作品，确认后再写入该书大纲。
        </p>
        <Select
          className="nv-note__pick-select"
          aria-label="选择归属作品"
          value={promotePick?.workId ?? undefined}
          placeholder="选择归属作品"
          onChange={(workId) =>
            setPromotePick((prev) => (prev ? { ...prev, workId } : prev))
          }
          options={workOptions.map((work) => ({
            value: work.id,
            label: `《${work.name}》`,
          }))}
        />
      </Modal>
    </div>
  );
}
