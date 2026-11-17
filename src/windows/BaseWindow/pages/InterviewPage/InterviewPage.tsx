import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Space } from "antd";
import Page from "@/shared/components/Page";
import SearchPanel from "./components/SearchPanel";
import CategorySidebar from "./components/CategorySidebar";
import FilterBar from "./components/FilterBar";
import QuestionList from "./components/QuestionList";
import KnowledgeDrawer from "./components/KnowledgeDrawer";
import QuestionEditDrawer from "./components/QuestionEditDrawer";
import HiddenBaselineDrawer from "./components/HiddenBaselineDrawer";
import StaleBaseDrawer from "./components/StaleBaseDrawer";
import OrphanPanel from "./components/OrphanPanel";
import TaxonomyPanel from "./components/TaxonomyPanel";
import AiDraftDrawer, { type AiDraftPrefill } from "./components/AiDraftDrawer";
import SelectionTermPopover from "./components/SelectionTermPopover";
import InterviewBankProvider from "./components/InterviewBankProvider";
import { useInterviewBankContext } from "./components/InterviewBankProvider/context";
import { useInterviewPage } from "./hooks/useInterviewPage";
import { useQuestionOverride, type QuestionOrigin } from "./hooks/useQuestionOverride";
import { useInterviewAi } from "./hooks/useInterviewAi";
import { useInterviewTaxonomy } from "./hooks/useInterviewTaxonomy";
import { useSelectionTerms } from "./hooks/useSelectionTerms";
import { CATEGORIES } from "./data/interview-taxonomy";
import type { InterviewQuestion } from "./data/interview-types";
import type { InterviewTaxonomyDTO } from "@/shared/types/electron";
import "./index.scss";

/** 没有 Provider 时的空刷新（模块级常量：引用稳定，不会把下层的 useCallback 全重建） */
const NOOP_RELOAD = (): void => {};

/** 没有 Provider 时的空来源表（同上：引用稳定） */
const EMPTY_ORIGIN: Readonly<Record<string, QuestionOrigin>> = {};

/** 没有 Provider 时的空分类表（同上） */
const EMPTY_TAXONOMY: readonly InterviewTaxonomyDTO[] = [];

/** 打开 AI 拓展抽屉时的默认参数（`kind` 必有，其余按入口预填） */
const DEFAULT_AI_PREFILL: AiDraftPrefill = { kind: "question" };

/** 二次确认要的文案（三种危险动作各一套，别让用户猜自己点的是什么） */
interface ConfirmCopy {
  title: string;
  content: string;
  okText: string;
}

/**
 * 前端面试题页。
 *
 * 外层只负责挂 `InterviewBankProvider`（题库合并视图：基线 ∪ `interview.db` 增量），
 * 真正的页面内容在 `InterviewPageBody` 里 —— 因为 `useInterviewPage()` 要读
 * Provider 提供的题目，"同一个组件先提供再消费"是不成立的，必须拆成两层。
 *
 * 拆层还有个附带好处：`InterviewBankProvider` 的挂载与卸载与筛选状态无关，
 * 拉库失败回落基线时页面内容不会被重挂（收藏、展开态、分页都不会被重置）。
 */
export default function InterviewPage() {
  return (
    <InterviewBankProvider>
      <InterviewPageBody />
    </InterviewBankProvider>
  );
}

/**
 * 页面主体。
 *
 * 结构固定三层：顶部搜索区 → 左侧分类栏 + 右侧（筛选条 + 题目列表）。
 * 状态全部收敛在 `useInterviewPage`：一个 `useReducer` 持有筛选条件，
 * 命中集合 / 角标 / 排序 / 分页都由 `useMemo` 从题库派生，组件本身不存业务状态。
 *
 * 维护动作（编辑 / 隐藏 / 还原 / 删除自建 / 转存孤儿）的状态**只在这里建一份**
 * （`useQuestionOverride`）：它们共享 `pendingId` 与失败原因，
 * 每张卡片各建一份会让同一条记录被并发写两次。
 */
function InterviewPageBody() {
  /** 知识体系抽屉是纯展示态，不影响筛选，留在页面本地 */
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  /** 「已隐藏的默认题」抽屉（隐藏是删除内置题的唯一形态，必须能反悔） */
  const [hiddenOpen, setHiddenOpen] = useState(false);
  /** 「基线已更新」批量抽屉（§5.4 的批量入口） */
  const [staleOpen, setStaleOpen] = useState(false);
  /** 孤儿覆盖处理面板（§5.2 步骤 6） */
  const [orphanOpen, setOrphanOpen] = useState(false);
  /** 分类管理抽屉 */
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  /** AI 拓展抽屉 + 这次打开的参数 */
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrefill, setAiPrefill] = useState<AiDraftPrefill>(DEFAULT_AI_PREFILL);
  /** 正在编辑的题；`null` = 抽屉关着 */
  const [editing, setEditing] = useState<InterviewQuestion | null>(null);

  /** 划词的边界：只有页面主体参与（顶栏输入框、抽屉表单不该触发） */
  const pageRef = useRef<HTMLDivElement | null>(null);

  /** 合并视图：来源标记 / 已隐藏 / 基线已更新 / 分类可选项 / 写后刷新 */
  const bank = useInterviewBankContext();
  const reload = bank?.reload ?? NOOP_RELOAD;
  /**
   * 六个写动作 + 共享的 `pendingId` / 失败原因。
   *
   * 解构出来是为了**引用稳定**：hook 返回的是每次渲染新建的对象，直接把它塞进
   * `useCallback` 依赖会让所有卡片每渲染一次就换一批回调（12 张卡片 × 6 个动作）。
   */
  const {
    pendingId,
    error: overrideError,
    clearError,
    saveOverride,
    hideBaseline,
    deleteNew,
    revertToDefault,
    ackBaseline,
    adoptOrphan,
  } = useQuestionOverride(reload);
  const { modal } = App.useApp();

  const {
    filter,
    keywordInput,
    setKeywordInput,
    submitKeyword,
    questions,
    total,
    page,
    pageCount,
    pageSize,
    counts,
    tagOptions,
    favorites,
    favoriteCount,
    toggleFavorite,
    setTrack,
    setCategory,
    setDifficulty,
    setTags,
    setFavoritesOnly,
    setSortBy,
    setPage,
    reset,
  } = useInterviewPage();

  /** 每道题的来源：决定卡片显示哪些动作 */
  const originById: Readonly<Record<string, QuestionOrigin>> =
    bank?.originById ?? EMPTY_ORIGIN;

  /** 「基线已更新」命中集合（`staleBase` → Set，卡片按 id 查） */
  const staleIds = useMemo<ReadonlySet<string>>(
    () => new Set((bank?.staleBase ?? []).map((item) => item.id)),
    [bank?.staleBase],
  );

  /** 合并后的分类表（22 基线 + 已采纳的自定义分类）；没有 Provider 时用基线 */
  const categories = bank?.categories ?? CATEGORIES;

  /** 分类管理：写通道 + 库里的原始行（含 draft） */
  const taxonomyRows = bank?.taxonomy ?? EMPTY_TAXONOMY;
  const taxonomyApi = useInterviewTaxonomy(taxonomyRows, reload);

  /**
   * AI 拓展：上下文取合并视图（分类 / 已有标题 / 已有词条 / 规模）。
   *
   * 这三个数组在页面里 `useMemo` 一次：hook 内部靠它们的引用判断
   * 要不要重建 prompt 上下文，每次渲染新建数组会让上下文每帧重算一遍。
   */
  const aiQuestionTitles = useMemo(
    () => (bank?.questions ?? []).map((question) => question.title),
    [bank?.questions],
  );
  const aiGlossaryTerms = useMemo(
    () =>
      (bank?.glossary ?? []).flatMap((term) => [term.term, ...(term.aliases ?? [])]),
    [bank?.glossary],
  );
  const aiStats = useMemo(
    () => ({
      questions: bank?.questions.length ?? 0,
      glossaries: bank?.glossary.length ?? 0,
      diagrams: bank?.diagrams.length ?? 0,
    }),
    [bank?.questions.length, bank?.glossary.length, bank?.diagrams.length],
  );
  const ai = useInterviewAi({
    categories,
    questionTitles: aiQuestionTitles,
    glossaryTerms: aiGlossaryTerms,
    stats: aiStats,
    reload,
  });

  /** 划词：只认页面主体里的拖选 */
  const { selection, clear: clearSelection } = useSelectionTerms(pageRef);

  /** 划中的词是否已经在词表里（基线 ∪ 增量） */
  const existingTerm = useMemo(() => {
    if (!selection) return null;
    return bank?.glossaryIndex.exact(selection.text) ?? null;
  }, [selection, bank?.glossaryIndex]);

  /** 编辑中的那道题必须属于基线题或已采纳的增量题，来源决定保存后写哪种行 */
  const editingOrigin: QuestionOrigin = editing
    ? (originById[editing.id] ?? "baseline")
    : "baseline";

  /**
   * 危险动作的二次确认。
   *
   * 用 `App.useApp()` 拿 `modal`（**不要** import `Modal` 静态方法：静态方法没有
   * 主题上下文，弹出来的是另一套配色）。组件测试里没有 `<App>` 包裹，
   * 那时 `modal` 是空对象 —— 直接执行动作，而不是静默把这次点击吞掉。
   */
  const confirmThen = useCallback(
    (copy: ConfirmCopy, action: () => void): void => {
      if (typeof modal?.confirm !== "function") {
        action();
        return;
      }
      modal.confirm({
        title: copy.title,
        content: copy.content,
        okText: copy.okText,
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => {
          action();
        },
      });
    },
    [modal],
  );

  const handleEdit = useCallback((question: InterviewQuestion): void => {
    setEditing(question);
  }, []);

  const handleHide = useCallback(
    (question: InterviewQuestion): void => {
      confirmThen(
        {
          title: "隐藏这道默认题？",
          content: `「${question.title}」将不再出现在题库里，内置内容不会丢，随时可以在「已隐藏的默认题」里恢复。`,
          okText: "隐藏",
        },
        () => {
          void hideBaseline(question);
        },
      );
    },
    [confirmThen, hideBaseline],
  );

  const handleRevert = useCallback(
    (question: InterviewQuestion): void => {
      confirmThen(
        {
          title: "还原成默认内容？",
          content: `你对「${question.title}」的修改会被丢弃，恢复成内置版本的原文。`,
          okText: "还原",
        },
        () => {
          void revertToDefault(question.id);
        },
      );
    },
    [confirmThen, revertToDefault],
  );

  const handleDeleteNew = useCallback(
    (question: InterviewQuestion): void => {
      confirmThen(
        {
          title: "删除这道题？",
          content: `「${question.title}」是你自己新建的题，删除后进回收站，可以在回收站里找回。`,
          okText: "删除",
        },
        () => {
          void deleteNew(question.id);
        },
      );
    },
    [confirmThen, deleteNew],
  );

  const handleAckBase = useCallback(
    (question: InterviewQuestion): void => {
      // 「沿用我的」不改内容，只记一个指纹，不值得再弹一次确认
      void ackBaseline(question.id);
    },
    [ackBaseline],
  );

  /** 恢复被隐藏的默认题 = 删掉墓碑行，合并时自然回落基线 */
  const handleRestore = useCallback(
    (id: string): void => {
      void revertToDefault(id);
    },
    [revertToDefault],
  );

  /** 批量抽屉里的「用新版覆盖」：同样走 revert，先确认再写 */
  const handleReplaceWithBaseline = useCallback(
    (id: string): void => {
      confirmThen(
        {
          title: "用新版覆盖这道题？",
          content: "你在这道题上的修改会被丢弃，恢复成新版默认答案。",
          okText: "覆盖",
        },
        () => {
          void revertToDefault(id);
        },
      );
    },
    [confirmThen, revertToDefault],
  );

  /** 孤儿「丢弃」= 删掉覆盖行，内容不再保留 */
  const handleDiscardOrphan = useCallback(
    (id: string): void => {
      confirmThen(
        {
          title: "丢弃这份修改？",
          content: "这条内容不会被保留，删除后无法恢复。",
          okText: "丢弃",
        },
        () => {
          void revertToDefault(id);
        },
      );
    },
    [confirmThen, revertToDefault],
  );

  const closeEditor = useCallback((): void => {
    setEditing(null);
  }, []);

  /** 划词「加为词条」：打开 AI 拓展抽屉并直接生成 */
  const handleAddTerm = useCallback(
    (picked: { text: string; sentence: string }): void => {
      const fallbackCategory =
        filter.categoryId !== "all"
          ? filter.categoryId
          : (categories[0]?.id ?? "foundation-js");
      setAiPrefill({
        kind: "glossary",
        categoryId: fallbackCategory,
        seed: picked.text,
        autoRun: true,
      });
      setAiOpen(true);
    },
    [filter.categoryId, categories],
  );

  /** 打开 AI 抽屉（顶栏入口）：默认出题，分类跟着当前筛选走 */
  const openAiDrawer = useCallback((): void => {
    setAiPrefill({
      kind: "question",
      ...(filter.categoryId !== "all" ? { categoryId: filter.categoryId } : {}),
    });
    setAiOpen(true);
  }, [filter.categoryId]);

  /** 标题查表：优先合并视图（可含用户新增的题），回落基线常量 */
  const titleOf = useCallback(
    (id: string): string => bank?.questions.find((item) => item.id === id)?.title ?? "",
    [bank?.questions],
  );

  const staleCount = bank?.staleBase.length ?? 0;
  const orphanCount = bank?.orphaned.length ?? 0;

  return (
    <Page>
      <div className="interview-page" ref={pageRef}>
        <SearchPanel
          track={filter.track}
          keyword={keywordInput}
          total={total}
          favoriteCount={favoriteCount}
          hiddenCount={bank?.hiddenIds.length ?? 0}
          onTrackChange={setTrack}
          onKeywordChange={setKeywordInput}
          onSearch={submitKeyword}
          onOpenKnowledge={() => setKnowledgeOpen(true)}
          onOpenHidden={() => setHiddenOpen(true)}
          onOpenAi={openAiDrawer}
          aiHidden={ai.hidden}
          aiDisabledText={ai.available ? "" : ai.unavailableText}
        />

        {/* 升级后的两件待办：基线被官方修订过 / 我的修改在新版失效。
            一次只报条数，点进去才逐条处理 —— 顶部条不该抢走整页注意力 */}
        {staleCount > 0 || orphanCount > 0 ? (
          <Alert
            className="interview-page__notice"
            type="warning"
            showIcon
            message={`${staleCount > 0 ? `${staleCount} 道你改过的题在新版有更新` : ""}${
              staleCount > 0 && orphanCount > 0 ? "；" : ""
            }${orphanCount > 0 ? `${orphanCount} 条修改因默认题被移除而失效` : ""}`}
            action={
              <Space size={8}>
                {staleCount > 0 ? (
                  <Button
                    className="interview-page__notice-stale"
                    size="small"
                    onClick={() => setStaleOpen(true)}
                  >
                    处理更新
                  </Button>
                ) : null}
                {orphanCount > 0 ? (
                  <Button
                    className="interview-page__notice-orphan"
                    size="small"
                    onClick={() => setOrphanOpen(true)}
                  >
                    处理失效
                  </Button>
                ) : null}
              </Space>
            }
          />
        ) : null}

        {/* 写失败的原因：主进程返回的中文原话，原样摆出来（吞掉就只剩「没反应」） */}
        {overrideError ? (
          <Alert
            className="interview-page__failure"
            type="error"
            showIcon
            closable
            message={overrideError}
            onClose={clearError}
          />
        ) : null}

        <div className="interview-page__body">
          <CategorySidebar
            track={filter.track}
            categoryId={filter.categoryId}
            counts={counts}
            categories={categories}
            onSelect={setCategory}
            onManage={() => setTaxonomyOpen(true)}
          />

          <div className="interview-page__main">
            <FilterBar
              difficulty={filter.difficulty}
              sortBy={filter.sortBy}
              tags={filter.tags}
              tagOptions={tagOptions}
              favoritesOnly={filter.favoritesOnly}
              onDifficultyChange={setDifficulty}
              onSortChange={setSortBy}
              onTagsChange={setTags}
              onFavoritesOnlyChange={setFavoritesOnly}
              onReset={reset}
            />

            <QuestionList
              questions={questions}
              total={total}
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              keyword={filter.keyword}
              favorites={favorites}
              originById={originById}
              staleIds={staleIds}
              pendingId={pendingId}
              onToggleFavorite={toggleFavorite}
              onPageChange={setPage}
              onReset={reset}
              onEdit={handleEdit}
              onHide={handleHide}
              onRevert={handleRevert}
              onDeleteNew={handleDeleteNew}
              onAckBase={handleAckBase}
            />
          </div>
        </div>

        <KnowledgeDrawer
          open={knowledgeOpen}
          track={filter.track}
          categoryId={filter.categoryId}
          onClose={() => setKnowledgeOpen(false)}
        />

        <HiddenBaselineDrawer
          open={hiddenOpen}
          hiddenIds={bank?.hiddenIds ?? []}
          pendingId={pendingId}
          onRestore={handleRestore}
          onClose={() => setHiddenOpen(false)}
        />

        <StaleBaseDrawer
          open={staleOpen}
          items={bank?.staleBase ?? []}
          pendingId={pendingId}
          titleOf={titleOf}
          onAck={(id) => void ackBaseline(id)}
          onUseBaseline={handleReplaceWithBaseline}
          onClose={() => setStaleOpen(false)}
        />

        <OrphanPanel
          open={orphanOpen}
          items={bank?.orphaned ?? []}
          pendingId={pendingId}
          onAdopt={(id) => void adoptOrphan(id)}
          onDiscard={handleDiscardOrphan}
          onClose={() => setOrphanOpen(false)}
        />

        <TaxonomyPanel
          open={taxonomyOpen}
          taxonomy={taxonomyRows}
          track={filter.track}
          api={taxonomyApi}
          onClose={() => setTaxonomyOpen(false)}
        />

        <AiDraftDrawer
          open={aiOpen}
          prefill={aiPrefill}
          categories={categories}
          ai={ai}
          onClose={() => setAiOpen(false)}
        />

        <QuestionEditDrawer
          open={editing !== null}
          question={editing}
          origin={editingOrigin}
          categories={categories}
          onClose={closeEditor}
          onSaved={closeEditor}
          saveOverride={saveOverride}
        />

        {/* 划词浮层：portal 到 body，位置由选区矩形算 */}
        <SelectionTermPopover
          selection={selection}
          existing={existingTerm}
          answer={ai.explain}
          onAddTerm={handleAddTerm}
          onAskAi={(picked) => void ai.askExplain(picked.text, picked.sentence)}
          onClearAnswer={ai.clearExplain}
          onClose={() => {
            clearSelection();
            ai.clearExplain();
          }}
        />
      </div>
    </Page>
  );
}
