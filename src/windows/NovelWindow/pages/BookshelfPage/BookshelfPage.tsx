import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOutlined,
  CalendarOutlined,
  EditOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { AutoComplete, Input, Modal, Button, Steps, type InputRef } from "antd";
import ContinueHero from "./components/ContinueHero";
import BookCard from "./components/BookCard";
import IdeaRail from "./components/IdeaRail";
import NewWorkCard from "./components/NewWorkCard";
import ShelfStats, { type ShelfStatItem } from "./components/ShelfStats";
import ShelfToolbar, { type ShelfViewMode } from "./components/ShelfToolbar";
import ShelfTopBar from "./components/ShelfTopBar";
import DataSafetyModal from "./components/DataSafetyModal";
import { useBookshelfData } from "./hooks/useBookshelfData";
import { useBookImport } from "./hooks/useBookImport";
import { listTrash } from "../NovelPage/services/novel-service";
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
import { GENRE_MAX_LENGTH, GENRE_OPTIONS } from "@/shared/novel/genres";
import { useAiAvailability } from "@/shared/ai/hooks/useAiAvailability";
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
   * 打开回收站页面（书架的数据管理面）。
   *
   * 回收站是**独立页面**（2.5.0 从「数据安全」弹窗里拆出）：逐条判断「捞回还是
   * 销毁」需要横向空间，弹窗里只能靠省略号过日子。备份 / 恢复仍留在弹窗。
   */
  onOpenTrash: () => void;
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
  onOpenTrash,
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

  /**
   * AI 是否该整块隐去（REQ-063）。
   *
   * 书架本身没有 AI 入口（续写 / 润色 / 摘要都在编辑器里），但「新建作品」的
   * 题材提示会提 AI —— 那是用户会看到的**提示**，总开关关掉后要换成不提 AI 的
   * 说法，否则同一句「题材只作 AI 起名、润色的风格参考」会留成一条孤零零的
   * 承诺。判据与编辑器侧同源（`useAiAvailability` 的 `hidden`），不各判一套。
   */
  const { hidden: aiHidden } = useAiAvailability();
  const [ideaFilter, setIdeaFilter] = useState<IdeaFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  /** 书名校验提示（L-03：空名点「创建并开写」曾静默无反应，现在明确告诉你差什么） */
  const [createError, setCreateError] = useState("");
  /**
   * 建书分两步：① 书名（必填）→ ② 题材（可选，可跳过）。
   *
   * 为什么拆成步骤而不是一屏两个输入框：书名是**必填且要动脑**的，题材是
   * **可跳过**的辅助信息。并排会让「题材」看起来同样必填，作者在列表里纠结
   * 半天才敢点确定；拆开之后第二步明确写着「可以跳过」，负担反而更轻。
   */
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [createGenre, setCreateGenre] = useState("");
  const createInputRef = useRef<InputRef>(null);

  /**
   * 「正在打开全局设定中心」态（REQ-054 在全局设定中心入口上的补全）。
   *
   * 与编辑器顶栏行囊按钮的 `packOpening` 同一条修法：独立窗口首次创建要等整个
   * SPA 装载（dev 下 1–3s），期间屏幕上什么都不会发生 —— 作者会以为点了没反应
   * 再点一次，第二次恰好命中「已开」分支，于是被记成「要点两次才打开全局设定中心」。
   * 点击即置位（按钮转「正在打开…」），主进程在窗口真正可见时回执
   * `global-setting-window-shown` 复位；另有 8s 兜底防回执丢失把按钮永久钉住。
   */
  const [globalSettingOpening, setGlobalSettingOpening] = useState(false);
  /** 回执可能永远不来（窗口装载失败且被关掉），兜底时长按 dev 最慢路径留够余量 */
  const GLOBAL_SETTING_OPENING_TIMEOUT_MS = 8000;
  const globalSettingOpeningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 「数据安全」面板（备份 / 恢复）与回收站角落数量 */
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [trashCount, setTrashCount] = useState(0);

  /**
   * 回收站数量角标：只数条数，不拉每条详情（listTrash 已带摘要，这里只取长度）。
   * 读失败静默归零 —— 角标是锦上添花，不该因为一次查询失败弹错误提示。
   */
  const refreshTrashCount = useCallback(async (): Promise<void> => {
    try {
      const result = await listTrash();
      setTrashCount(result.items.length);
    } catch {
      setTrashCount(0);
    }
  }, []);

  const openCreate = useCallback(() => {
    // PRD §11：Tour 不与弹窗抢焦点 —— 弹窗打开时引导让位，
    // 否则第 1 步的卡片钉在「新建作品」按钮上，正好盖住书名输入框
    useGuideStore.getState().pause();
    setCreateError("");
    setCreateStep(1);
    setCreateGenre("");
    setCreateOpen(true);
  }, []);

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateName("");
    setCreateError("");
    setCreateStep(1);
    setCreateGenre("");
  }, []);

  /** 取消关闭：把刚才让位的引导续播回来（创建成功走 closeCreate，由视图切换接到第 2 步） */
  const cancelCreate = useCallback(() => {
    closeCreate();
    useGuideStore.getState().start(1);
  }, [closeCreate]);

  /**
   * 打开全局设定中心独立窗口（REQ-041 / M13；lite 版不打包，主进程侧拦截）。
   *
   * 先给反馈再发 IPC：窗口装载期间屏幕上只有这颗按钮能动，没有它作者只会看到
   * 「点了没反应」（见 globalSettingOpening 的注释）。
   */
  const openGlobalSetting = useCallback((): void => {
    setGlobalSettingOpening(true);
    if (globalSettingOpeningTimerRef.current) {
      clearTimeout(globalSettingOpeningTimerRef.current);
    }
    globalSettingOpeningTimerRef.current = setTimeout(() => {
      globalSettingOpeningTimerRef.current = null;
      setGlobalSettingOpening(false);
    }, GLOBAL_SETTING_OPENING_TIMEOUT_MS);
    window.electronAPI?.send("global-setting-window-open", null);
  }, []);

  /**
   * 全局设定中心窗口「真的可见」的回执（主进程 `notifyGlobalSettingShown` →
   * `global-setting-window-shown`）。收到即复位 loading，并清掉兜底定时器。
   */
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.receive) return undefined;
    const unsubscribe = api.receive("global-setting-window-shown", () => {
      if (globalSettingOpeningTimerRef.current) {
        clearTimeout(globalSettingOpeningTimerRef.current);
        globalSettingOpeningTimerRef.current = null;
      }
      setGlobalSettingOpening(false);
    });
    return () => {
      unsubscribe();
      if (globalSettingOpeningTimerRef.current) {
        clearTimeout(globalSettingOpeningTimerRef.current);
        globalSettingOpeningTimerRef.current = null;
      }
    };
  }, []);

  // 从编辑器返回书架时静默刷新统计；首次可见跳过（hook 自身已加载）
  const firstVisibleRef = useRef(true);
  useEffect(() => {
    if (!visible) return;
    if (firstVisibleRef.current) {
      firstVisibleRef.current = false;
      // 首帧只补回收站角标：书架数据由 useBookshelfData 自己装载
      void refreshTrashCount();
      return;
    }
    void refresh(true);
    void refreshTrashCount();
  }, [visible, refresh, refreshTrashCount]);

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

  /** 第 1 步 → 第 2 步：只校验书名，先不落库（作者还能退回去改） */
  const handleCreateNext = useCallback(() => {
    // L-03：书名留空时明确报错并聚焦输入框，绝不静默返回
    const error = validateWorkName(createName);
    if (error) {
      setCreateError(error);
      createInputRef.current?.focus();
      return;
    }
    setCreateError("");
    setCreateStep(2);
  }, [createName]);

  /**
   * 第 2 步落库并进编辑器。
   *
   * `skipGenre` = 点「跳过」：题材不写库（AI 层按书名 + 要素弱兜底）。
   * 建书不该被「想不出题材」卡住 —— 这是把题材拆成独立步骤的前提。
   */
  const finishCreate = useCallback(
    (skipGenre: boolean) => {
      const error = validateWorkName(createName);
      if (error) {
        // 从第 2 步退回第 1 步时书名可能已被清空，回到第 1 步报错而不是静默失败
        setCreateError(error);
        setCreateStep(1);
        return;
      }
      const workId = createWork(createName, skipGenre ? undefined : createGenre);
      if (!workId) return;
      closeCreate();
      // 空作品直接进编辑器：空态引导「写下第一章」
      onOpenWork(workId);
    },
    [createGenre, createName, closeCreate, createWork, onOpenWork],
  );

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
        onGlobalSettingClick={openGlobalSetting}
        globalSettingOpening={globalSettingOpening}
        onSafetyClick={() => setSafetyOpen(true)}
        onTrashClick={onOpenTrash}
        trashCount={trashCount}
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

      {/* 新建作品（2.7.1 起两步）：① 书名必填 → ② 题材可选、可跳过。
          题材只服务 AI 风格锚定，不该成为建书的门槛，所以它单独占一步而不是
          和书名并排；第二步显式提供「跳过」，跳过即视为「未设置」。 */}
      <Modal
        open={createOpen}
        title="新建作品"
        cancelText="取消"
        onCancel={cancelCreate}
        width={400}
        footer={
          createStep === 1 ? (
            <>
              <Button onClick={cancelCreate}>取消</Button>
              <Button type="primary" onClick={handleCreateNext}>
                下一步
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setCreateStep(1)}>上一步</Button>
              <Button onClick={() => finishCreate(true)}>跳过</Button>
              <Button type="primary" onClick={() => finishCreate(false)}>
                创建并开写
              </Button>
            </>
          )
        }
      >
        <Steps
          className="bs-page__create-steps"
          size="small"
          current={createStep - 1}
          items={[{ title: "书名" }, { title: "题材" }]}
        />

        {createStep === 1 ? (
          <>
            <Input
              ref={createInputRef}
              value={createName}
              status={createError ? "error" : undefined}
              onChange={(event) => {
                setCreateName(event.target.value);
                // 一敲字就撤掉报错：作者已经在处理了，红框不该挂着不走
                setCreateError("");
              }}
              onPressEnter={handleCreateNext}
              placeholder="给这本书起个名字"
              maxLength={50}
              autoFocus
            />
            {createError && <p className="bs-page__create-error">{createError}</p>}
          </>
        ) : (
          <>
            <AutoComplete
              className="bs-page__create-genre"
              value={createGenre}
              options={[...GENRE_OPTIONS]}
              placeholder="选一个题材，或直接填写（可不填）"
              aria-label="作品题材"
              onChange={(value: string) => setCreateGenre(value.slice(0, GENRE_MAX_LENGTH))}
              filterOption={(input, option) =>
                String(option?.value ?? "").includes(input.trim())
              }
              autoFocus
            />
            <p className="bs-page__create-hint">
              {aiHidden
                ? "题材只作统一用字风格的参考，也可以直接跳过，之后在作品管理里补"
                : "题材只作 AI 起名、润色的风格参考，也可以直接跳过，之后在作品管理里补"}
            </p>
          </>
        )}
      </Modal>

      {/* 数据安全（P0）：一键全量备份 / 从备份恢复（回收站已拆成独立页面）。
          整库被替换后同时刷新书架与角标 —— 恢复一部作品要立刻出现在书架上。 */}
      <DataSafetyModal
        open={safetyOpen}
        onClose={() => setSafetyOpen(false)}
        onDataChanged={() => {
          void refresh(true);
          void refreshTrashCount();
        }}
      />

      {/* L1 漫游引导：第 1 步属书架页（第 2-5 步属编辑器页，由 NovelPage 内的实例接管） */}
      <NovelGuideTour view="shelf" visible={visible} />
    </div>
  );
}
