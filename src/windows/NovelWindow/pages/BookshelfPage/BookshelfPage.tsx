import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOutlined,
  CalendarOutlined,
  EditOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Input, Modal, Button, type InputRef } from "antd";
import ContinueHero from "./components/ContinueHero";
import BookCard from "./components/BookCard";
import IdeaRail from "./components/IdeaRail";
import NewWorkCard from "./components/NewWorkCard";
import ShelfStats, { type ShelfStatItem } from "./components/ShelfStats";
import ShelfToolbar, { type ShelfViewMode } from "./components/ShelfToolbar";
import ShelfTopBar from "./components/ShelfTopBar";
import { useBookshelfData } from "./hooks/useBookshelfData";
import { useBookImport } from "./hooks/useBookImport";
import NovelGuideTour from "../../components/NovelGuideTour";
import { useGuideStore } from "../../store/useGuideStore";
import {
  filterIdeaNotes,
  filterWorkCards,
  formatThousands,
  formatWordsCompact,
  sortIdeaNotes,
  sortWorkCards,
  validateWorkName,
  type IdeaFilter,
  type ShelfSortKey,
  type ShelfStatusFilter,
} from "./bookshelf-utils";
import { TODAY_ADDED_LABEL, WORD_UNIT } from "@/shared/novel/today-stats";
import "./index.scss";

interface BookshelfPageProps {
  /**
   * 页面在 App 中常驻挂载、用 display 切换显隐（保住编辑器未落库输入的同时，
   * 书架从编辑器返回时需要静默重算统计）——由窗口根组件传入当前可见性。
   */
  visible?: boolean;
  /** 打开某部作品进入编辑器；chapterId 缺省时由编辑器落到该作品第一章 */
  onOpenWork: (workId: string, chapterId?: string) => void;
  /**
   * 编辑器空书架空态的「导入书籍」请求（幂等 token）：收到后在本页发起选文件
   * 导入。导入的实现（选文件 → worker 解析 → 落库）只在这里有一份，
   * 编辑器侧经窗口根转发请求，不抄第二条链路。
   */
  importRequest?: number | null;
  /** 导入请求处理完成后回调（窗口根组件据此置空请求） */
  onImportRequestConsumed?: () => void;
}

/**
 * 书架主页面（R32）：NovelWindow 打开的默认主页。
 *
 * 结构对照设计稿：顶栏（标题/规模胶囊/搜索/新建）→ 统计条 ×4 →
 * 继续写作 Hero → 我的书架（筛选/排序/视图 + 书卡网格）→ 右栏全局灵感库 →
 * 底部状态条。数据经 useBookshelfData 乐观更新；进入编辑器由 App 编排。
 */
export default function BookshelfPage({
  visible = true,
  onOpenWork,
  importRequest = null,
  onImportRequestConsumed,
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
    loadError,
    createWork,
    addNote,
    toggleNotePinned,
    moveNoteTo,
    updateNoteContent,
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
  /** 书名校验提示（L-03：空名点「创建并开写」曾静默无反应，现在明确告诉你差什么） */
  const [createError, setCreateError] = useState("");
  const createInputRef = useRef<InputRef>(null);

  const openCreate = useCallback(() => {
    // PRD §11：Tour 不与弹窗抢焦点 —— 弹窗打开时引导让位，
    // 否则第 1 步的卡片钉在「新建作品」按钮上，正好盖住书名输入框
    useGuideStore.getState().pause();
    setCreateError("");
    setCreateOpen(true);
  }, []);

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateName("");
    setCreateError("");
  }, []);

  /** 取消关闭：把刚才让位的引导续播回来（创建成功走 closeCreate，由视图切换接到第 2 步） */
  const cancelCreate = useCallback(() => {
    closeCreate();
    useGuideStore.getState().start(1);
  }, [closeCreate]);

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

  // ── 导入书籍（TXT）：worker 解析 + 单事务落库 + 完成后刷新书架 ──
  const {
    importing,
    phase: importPhase,
    startImport,
  } = useBookImport({ onDone: () => void refresh(true) });

  // 编辑器空书架空态发来的导入请求：token 守卫，StrictMode 双执行只消费一次
  const consumedImportRef = useRef<number | null>(null);
  useEffect(() => {
    if (!importRequest || consumedImportRef.current === importRequest) return;
    consumedImportRef.current = importRequest;
    void startImport();
    onImportRequestConsumed?.();
  }, [importRequest, startImport, onImportRequestConsumed]);

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
    // L-03：书名留空时明确报错并聚焦输入框，绝不静默返回
    // （旧行为：createWork 返回 null 就 return，弹窗不动也不提示，像卡住）
    const error = validateWorkName(createName);
    if (error) {
      setCreateError(error);
      createInputRef.current?.focus();
      return;
    }
    const workId = createWork(createName);
    if (!workId) return;
    closeCreate();
    // 空作品直接进编辑器：空态引导「写下第一章」
    onOpenWork(workId);
  }, [createName, closeCreate, createWork, onOpenWork]);

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
        // UI-08：单位跟着数字（与同排「12 部」「48.2 万」「5 天」一致），
        // 术语取自 today-stats，与编辑器状态条同源
        value: `${formatThousands(usage.todayWords)} ${WORD_UNIT}`,
        label: TODAY_ADDED_LABEL,
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

  // bundle 还没到手时的三种形态必须严格分开（P2-6）：装载中 / 失败 / 都不是。
  // 失败绝不能落进下面的「书架还是空的」空态 —— 那会让用户以为数据丢了。
  if (loading && !bundle) {
    return (
      <div className="bs-page">
        <div className="bs-page__loading">正在载入书架…</div>
      </div>
    );
  }

  if (!bundle && loadError) {
    return (
      <div className="bs-page">
        <div className="bs-page__error" role="alert">
          <span>{loadError}</span>
          <Button size="small" onClick={() => void refresh()}>
            重试
          </Button>
        </div>
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
        onCreateClick={openCreate}
        onImportClick={() => void startImport()}
        importing={importing}
        importPhase={importPhase}
        onGlobalSettingClick={() =>
          // 打开「全局设定中心」独立窗口（M13）；lite 版不打包该窗口，主进程侧拦截
          window.electronAPI?.send("global-setting-window-open", null)
        }
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

            {cards.length === 0 && (
              <div className="bs-page__welcome">
                <span className="bs-page__welcome-text">
                  书架还是空的。新建一部作品开始写，或从 TXT／DOCX 导入整本书。
                </span>
                <Button
                  size="small"
                  onClick={() => void startImport()}
                  disabled={importing}
                  loading={importing}
                >
                  导入书籍
                </Button>
              </div>
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
              <NewWorkCard
                view={viewMode}
                onCreateClick={openCreate}
              />
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
          onUpdateContent={updateNoteContent}
          onRemove={removeNoteById}
        />
      </div>

      <footer className="bs-page__status">
        {/* 作品数 / 字数 / 今日新增 / 连续码字已分别由顶栏胶囊与统计条承载，
            底栏不再复读 —— 一份信息只在一个地方说。 */}
        <span>本地优先 · 数据存储于本机</span>
      </footer>

      <Modal
        open={createOpen}
        title="新建作品"
        okText="创建并开写"
        cancelText="取消"
        onOk={handleCreateOk}
        onCancel={cancelCreate}
        width={380}
      >
        <Input
          ref={createInputRef}
          value={createName}
          status={createError ? "error" : undefined}
          onChange={(event) => {
            setCreateName(event.target.value);
            // 一敲字就撤掉报错：作者已经在处理了，红框不该挂着不走
            setCreateError("");
          }}
          onPressEnter={handleCreateOk}
          placeholder="给这本书起个名字"
          maxLength={50}
          autoFocus
        />
        {createError && <p className="bs-page__create-error">{createError}</p>}
      </Modal>

      {/* L1 漫游引导：第 1 步属书架页（第 2-5 步属编辑器页，由 NovelPage 内的实例接管） */}
      <NovelGuideTour view="shelf" visible={visible} />
    </div>
  );
}
