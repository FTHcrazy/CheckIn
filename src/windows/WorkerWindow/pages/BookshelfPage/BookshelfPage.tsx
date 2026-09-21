import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOutlined,
  CalendarOutlined,
  EditOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Input, Modal } from "antd";
import ContinueHero from "./components/ContinueHero";
import BookCard from "./components/BookCard";
import IdeaRail from "./components/IdeaRail";
import NewWorkCard from "./components/NewWorkCard";
import ShelfStats, { type ShelfStatItem } from "./components/ShelfStats";
import ShelfToolbar, { type ShelfViewMode } from "./components/ShelfToolbar";
import ShelfTopBar from "./components/ShelfTopBar";
import { useBookshelfData } from "./hooks/useBookshelfData";
import {
  filterIdeaNotes,
  filterWorkCards,
  formatThousands,
  formatWordsCompact,
  sortIdeaNotes,
  sortWorkCards,
  type IdeaFilter,
  type ShelfSortKey,
  type ShelfStatusFilter,
} from "./bookshelf-utils";
import "./index.scss";

interface BookshelfPageProps {
  /**
   * 页面在 App 中常驻挂载、用 display 切换显隐（保住编辑器未落库输入的同时，
   * 书架从编辑器返回时需要静默重算统计）——由窗口根组件传入当前可见性。
   */
  visible?: boolean;
  /** 打开某部作品进入编辑器；chapterId 缺省时由编辑器落到该作品第一章 */
  onOpenWork: (workId: string, chapterId?: string) => void;
}

/**
 * 书架主页面（R32）：WorkerWindow 打开的默认主页。
 *
 * 结构对照设计稿：顶栏（标题/规模胶囊/搜索/新建）→ 统计条 ×4 →
 * 继续写作 Hero → 我的书架（筛选/排序/视图 + 书卡网格）→ 右栏全局灵感库 →
 * 底部状态条。数据经 useBookshelfData 乐观更新；进入编辑器由 App 编排。
 */
export default function BookshelfPage({
  visible = true,
  onOpenWork,
}: BookshelfPageProps) {
  const {
    bundle,
    cards,
    notes,
    ideaCounts,
    hero,
    usage,
    style,
    loading,
    createWork,
    addNote,
    toggleNotePinned,
    moveNoteTo,
    removeNoteById,
    refresh,
  } = useBookshelfData();

  // ── 视图状态（筛选 / 排序 / 视图 / 灵感筛选 / 新建弹框） ──
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<ShelfStatusFilter>("all");
  const [sortKey, setSortKey] = useState<ShelfSortKey>("recent");
  const [viewMode, setViewMode] = useState<ShelfViewMode>("grid");
  const [ideaFilter, setIdeaFilter] = useState<IdeaFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  // 从编辑器返回书架时静默刷新统计；首次可见跳过（hook 自身已加载）
  const firstVisibleRef = useRef(true);
  useEffect(() => {
    if (!visible) return;
    if (firstVisibleRef.current) {
      firstVisibleRef.current = false;
      return;
    }
    void refresh(true);
  }, [visible, refresh]);

  const totalWords = useMemo(
    () => cards.reduce((sum, card) => sum + card.totalWords, 0),
    [cards],
  );

  const statusCounts = useMemo(
    () => ({
      all: cards.length,
      ongoing: cards.filter((card) => card.status === "ongoing").length,
      finished: cards.filter((card) => card.status === "finished").length,
    }),
    [cards],
  );

  const visibleCards = useMemo(
    () => sortWorkCards(filterWorkCards(cards, status, keyword), sortKey),
    [cards, status, keyword, sortKey],
  );

  const visibleNotes = useMemo(
    () => sortIdeaNotes(filterIdeaNotes(notes, ideaFilter, keyword)),
    [notes, ideaFilter, keyword],
  );

  const workOptions = useMemo(
    () => cards.map((card) => ({ id: card.id, name: card.name })),
    [cards],
  );

  const workNameOf = useCallback(
    (workId: string): string | null =>
      cards.find((card) => card.id === workId)?.name ?? null,
    [cards],
  );

  /** 卡片点击：优先该作品的位置记忆，否则取最近更新章节（空作品交编辑器空态） */
  const openWorkCard = useCallback(
    (workId: string) => {
      if (!bundle) return;
      let chapterId: string | undefined;
      if (
        bundle.works.some((work) => work.id === workId) &&
        bundle.chapters.some(
          (chapter) => chapter.workId === workId && chapter.id === hero?.chapterId,
        )
      ) {
        // Hero 正停留在该书 → 直接续写该章
        chapterId = hero?.chapterId;
      } else {
        const latest = bundle.chapters
          .filter((chapter) => chapter.workId === workId)
          .reduce<(typeof bundle.chapters)[number] | null>(
            (max, chapter) => (!max || chapter.updatedAt > max.updatedAt ? chapter : max),
            null,
          );
        chapterId = latest?.id;
      }
      onOpenWork(workId, chapterId);
    },
    [bundle, hero, onOpenWork],
  );

  const handleContinue = useCallback(() => {
    if (hero) onOpenWork(hero.workId, hero.chapterId);
  }, [hero, onOpenWork]);

  const handleCreateOk = useCallback(() => {
    const workId = createWork(createName);
    if (!workId) return;
    setCreateOpen(false);
    setCreateName("");
    // 空作品直接进编辑器：空态引导「写下第一章」
    onOpenWork(workId);
  }, [createName, createWork, onOpenWork]);

  const statsItems = useMemo<ShelfStatItem[]>(
    () => [
      {
        key: "works",
        icon: <BookOutlined />,
        tone: "blue",
        value: `${cards.length} 部`,
        label: "累计作品",
      },
      {
        key: "words",
        icon: <EditOutlined />,
        tone: "blue",
        value: formatWordsCompact(totalWords),
        label: "累计字数",
      },
      {
        key: "today",
        icon: <ThunderboltOutlined />,
        tone: "green",
        value: formatThousands(usage.todayWords),
        label: "今日新增（字）",
      },
      {
        key: "streak",
        icon: <CalendarOutlined />,
        tone: "orange",
        value: `${usage.streakDays} 天`,
        label: "连续码字",
      },
    ],
    [cards.length, totalWords, usage.todayWords, usage.streakDays],
  );

  if (loading && !bundle) {
    return (
      <div className="bs-page">
        <div className="bs-page__loading">正在载入书架…</div>
      </div>
    );
  }

  return (
    <div className="bs-page" aria-hidden={!visible}>
      <ShelfTopBar
        workCount={cards.length}
        totalWordsText={formatWordsCompact(totalWords)}
        keyword={keyword}
        onKeywordChange={setKeyword}
        onCreateClick={() => setCreateOpen(true)}
      />

      <div className="bs-page__body">
        <main className="bs-page__main">
          <ShelfStats items={statsItems} />

          {hero && (
            <ContinueHero
              hero={hero}
              todayWords={usage.todayWords}
              dailyGoal={style.dailyGoal}
              onContinue={handleContinue}
            />
          )}

          <section className="bs-page__shelf" aria-label="我的书架">
            <header className="bs-page__shelf-head">
              <h2 className="bs-page__shelf-title">我的书架</h2>
              <ShelfToolbar
                status={status}
                counts={statusCounts}
                sortKey={sortKey}
                viewMode={viewMode}
                onStatusChange={setStatus}
                onSortChange={setSortKey}
                onViewModeChange={setViewMode}
              />
            </header>

            {cards.length > 0 && visibleCards.length === 0 && (
              <div className="bs-page__empty">没有找到匹配的作品，换个关键词试试</div>
            )}

            <div className={`bs-page__grid bs-page__grid--${viewMode}`}>
              {visibleCards.map((card) => (
                <BookCard
                  key={card.id}
                  card={card}
                  view={viewMode}
                  onOpen={openWorkCard}
                />
              ))}
              <NewWorkCard onCreateClick={() => setCreateOpen(true)} />
            </div>
          </section>
        </main>

        <IdeaRail
          counts={ideaCounts}
          filter={ideaFilter}
          onFilterChange={setIdeaFilter}
          visibleNotes={visibleNotes}
          workOptions={workOptions}
          workNameOf={workNameOf}
          onAdd={addNote}
          onTogglePin={toggleNotePinned}
          onMove={moveNoteTo}
          onRemove={removeNoteById}
        />
      </div>

      <footer className="bs-page__status">
        <span>本地优先 · 数据存储于本机</span>
        <span>
          共 {cards.length} 部作品 · {formatWordsCompact(totalWords)}字 · 今日新增{" "}
          {formatThousands(usage.todayWords)} 字 · 连续码字 {usage.streakDays} 天
        </span>
      </footer>

      <Modal
        open={createOpen}
        title="新建作品"
        okText="创建并开写"
        cancelText="取消"
        onOk={handleCreateOk}
        onCancel={() => {
          setCreateOpen(false);
          setCreateName("");
        }}
        width={380}
      >
        <Input
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          onPressEnter={handleCreateOk}
          placeholder="给这本书起个名字"
          maxLength={50}
          autoFocus
        />
      </Modal>
    </div>
  );
}
