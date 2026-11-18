import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import DraftBoxDrawer from "./components/DraftBoxDrawer";
import MutePanel from "./components/MutePanel";
import GlossaryEditDrawer from "./components/GlossaryEditDrawer";
import AuditDrawer from "./components/AuditDrawer";
import AiDraftDrawer, { type AiDraftPrefill } from "./components/AiDraftDrawer";
import SelectionTermPopover from "./components/SelectionTermPopover";
import InterviewBankProvider from "./components/InterviewBankProvider";
import { useInterviewBankContext } from "./components/InterviewBankProvider/context";
import { GlossaryMatchIndexContext } from "./components/InterviewBankProvider/match-index-context";
import { TermActionContext, type TermActionApi } from "./components/TermText/term-action-context";
import { useInterviewPage } from "./hooks/useInterviewPage";
import { useQuestionOverride, type QuestionOrigin } from "./hooks/useQuestionOverride";
import { useInterviewAi, type GlossaryKeyOwner } from "./hooks/useInterviewAi";
import { useInterviewTaxonomy } from "./hooks/useInterviewTaxonomy";
import { useInterviewDrafts } from "./hooks/useInterviewDrafts";
import { useTaxonomySuggest } from "./hooks/useTaxonomySuggest";
import { useInterviewAudit } from "./hooks/useInterviewAudit";
import { useSelectionTerms } from "./hooks/useSelectionTerms";
import { useGlossaryAlias } from "./hooks/useGlossaryAlias";
import { useGlossaryEdit } from "./hooks/useGlossaryEdit";
import { useTermHints } from "./hooks/useTermHints";
import { findContainingTerm } from "./persistence/glossary-alias";
import type { GlossaryPrefer } from "./persistence/glossary-matcher";
import type { GlossaryKeyHolder } from "./persistence/glossary-edit";
import { CATEGORIES } from "./data/interview-taxonomy";
import type { InterviewQuestion, QuestionTrack } from "./data/interview-types";
import type { GlossaryShape } from "@/shared/interview/payload-shape";
import type { GlossaryTerm } from "./data/interview-glossary";
import type { InterviewItemDetailDTO, InterviewMuteHintDTO, InterviewTaxonomyDTO } from "@/shared/types/electron";
import "./index.scss";

/** 没有 Provider 时的空刷新（模块级常量：引用稳定，不会把下层的 useCallback 全重建） */
const NOOP_RELOAD = (): void => {};

/** 没有 Provider 时的空来源表（同上：引用稳定） */
const EMPTY_ORIGIN: Readonly<Record<string, QuestionOrigin>> = {};

/** 没有 Provider 时的空分类表（同上） */
const EMPTY_TAXONOMY: readonly InterviewTaxonomyDTO[] = [];

/** 没有 Provider 时的空草稿表（同上） */
const EMPTY_DRAFTS: readonly InterviewItemDetailDTO[] = [];

/** 没有 Provider 时的空词表（同上；判键冲突要用完整表，不能省） */
const EMPTY_GLOSSARY: readonly GlossaryTerm[] = [];

/** 没有 Provider 时的空负例表（同上） */
const EMPTY_HINTS: readonly InterviewMuteHintDTO[] = [];

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
  /** 草稿箱抽屉 */
  const [draftOpen, setDraftOpen] = useState(false);
  /** 题目质检面板 */
  const [auditOpen, setAuditOpen] = useState(false);
  /** 「已解除的名词绑定」抽屉（右键解除是破坏性的，必须能反悔） */
  const [muteOpen, setMuteOpen] = useState(false);
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
  const { modal, message } = App.useApp();

  const {
    filter,
    keywordInput,
    setKeywordInput,
    submitKeyword,
    questions,
    filteredQuestions,
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

  /** 草稿箱：`status='draft'` 的条目（合并视图里没有它们） */
  const drafts = bank?.drafts ?? EMPTY_DRAFTS;
  const draftApi = useInterviewDrafts(reload);

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

  /**
   * 草稿词条的键：判「与草稿撞键」用（规范 §10.3 第三行）。
   *
   * 草稿的 payload 是 `unknown`（库里是 JSON 文本），取不出 `term` 就退回标题 ——
   * 两者至少有一个能当键，总比放过一条同名词条强。
   */
  const aiDraftGlossary = useMemo<GlossaryKeyOwner[]>(
    () =>
      drafts
        .filter((item) => item.kind === "glossary")
        .map((item) => {
          const shape = (item.payload ?? null) as Partial<GlossaryShape> | null;
          return {
            id: item.id,
            term: typeof shape?.term === "string" && shape.term ? shape.term : item.title,
            ...(shape?.en ? { en: shape.en } : {}),
            ...(Array.isArray(shape?.aliases) ? { aliases: shape.aliases } : {}),
          };
        }),
    [drafts],
  );

  const ai = useInterviewAi({
    categories,
    questionTitles: aiQuestionTitles,
    glossaryTerms: aiGlossaryTerms,
    glossary: bank?.glossary ?? EMPTY_GLOSSARY,
    draftGlossary: aiDraftGlossary,
    stats: aiStats,
    reload,
  });

  /** 已被占用的分类名（含草稿）：AI 推荐要避开它们，否则采纳时必被拒 */
  const takenCategoryLabels = useMemo(
    () => taxonomyRows.map((row) => row.label),
    [taxonomyRows],
  );

  /** AI 推荐分类：与 AI 拓展共用同一份分类表与题库规模（两处口径必须一致） */
  const taxonomyAi = useTaxonomySuggest({
    categories,
    // 草稿分类不在侧栏（不在 categories 里），但已经占了名字 —— 一起参与重名判定
    takenLabels: takenCategoryLabels,
    questionTitles: aiQuestionTitles,
    stats: aiStats,
    track: filter.track,
  });

  /**
   * 题目质检：只读报告，不改题库。
   *
   * 上下文与 AI 拓展用同一份（分类 / 已有标题 / 词条键 / 库规模）——
   * 它们看的是同一个题库，两套上下文只会拼出两份可能不一致的判断依据。
   */
  const audit = useInterviewAudit({
    categories,
    questionTitles: aiQuestionTitles,
    glossaryTerms: aiGlossaryTerms,
    stats: aiStats,
  });

  /** 划词：只认页面主体里的拖选 */
  const { selection, clear: clearSelection } = useSelectionTerms(pageRef);

  /**
   * 名词选优偏好（同名不同义的主匹配）。
   *
   * 「节流」在浏览器性能里是「单位时间只跑一次」，在 RxJS 里是「丢弃窗口内的
   * 后续值」。两条词条都留在库里，正文里点亮哪一条取决于**你现在在哪个分类**：
   * 分类精确命中优先，其次同轨道，最后回落词表顺序（基线在前）。
   *
   * 只换 `pickTerm` 的入参、不重建索引：切一次分类就是换一个闭包，
   * 词表 / trie / 负例全部复用。
   */
  const termPrefer = useMemo<GlossaryPrefer>(
    () => ({
      ...(filter.categoryId !== "all" ? { categoryId: filter.categoryId } : {}),
      track: filter.track,
    }),
    [filter.categoryId, filter.track],
  );
  const matchIndex = useMemo(
    () => bank?.glossaryIndex.withPrefer(termPrefer),
    [bank?.glossaryIndex, termPrefer],
  );

  /** 划中的词是否已经在词表里（基线 ∪ 增量；带当前分类偏好） */
  const existingTerm = useMemo(() => {
    if (!selection) return null;
    return matchIndex?.exact(selection.text) ?? null;
  }, [selection, matchIndex]);

  /**
   * 「记为别名」的候选目标：库里那条词条的名字比划中的词长
   * （模型出词条时把 `loader` 写成了 `Webpack Loader`）。
   *
   * 只在**没有精确命中**时才算：精确命中的情况浮层已经显示「已是词条」，
   * 再提示「记为它自己的别名」只会让人困惑。
   */
  const aliasOwner = useMemo(() => {
    if (!selection || existingTerm) return null;
    return findContainingTerm(bank?.glossary ?? [], selection.text);
  }, [selection, existingTerm, bank?.glossary]);
  const aliasApi = useGlossaryAlias(reload);
  const clearAliasError = aliasApi.clearError;

  /**
   * 词条编辑：改词名 / 领域 / 分类 / 定义 / 细节 / 别名，删自建词条。
   *
   * 与 `useGlossaryAlias` 分工：那个只动别名（匹配键修正），这里动词条本身。
   * 词条建错了（AI 给的领域不对、词名太长、定义写歪）时，光「解除这一处绑定」
   * 治不了 —— 换个地方照样错。
   */
  const [editingTerm, setEditingTerm] = useState<GlossaryTerm | null>(null);
  const glossaryEdit = useGlossaryEdit(reload);
  const saveGlossary = glossaryEdit.save;
  const removeGlossary = glossaryEdit.remove;
  /**
   * 键冲突判定要看的全部词条：合并词表 + 草稿词条。
   * 口径与 AI 出词条一致（`useInterviewAi.buildDraftCandidate`）：同键同领域
   * 才算重复，同名不同义两条都留着。
   */
  const glossaryHolders = useMemo<GlossaryKeyHolder[]>(
    () => [
      ...(bank?.glossary ?? EMPTY_GLOSSARY),
      ...aiDraftGlossary.map((item) => ({ ...item, draft: true })),
    ],
    [bank?.glossary, aiDraftGlossary],
  );
  const openGlossaryEdit = useCallback((term: GlossaryTerm): void => {
    setEditingTerm(term);
  }, []);

  // 换一个选区就清掉上一条别名错误：否则「甲」的失败会挂到「乙」下面
  useEffect(() => {
    clearAliasError();
  }, [selection, clearAliasError]);

  /**
   * 名词的维护动作（右键菜单）：解除某一处的绑定 / 删掉某条别名。
   *
   * 【为什么不在这里做二次确认】
   * 两者都是**可撤销**的：解除的负例在「已解除」面板里能恢复，别名删错了可以
   * 重新划词补回来。给可撤销动作加确认框只会让每次右键都多一次点击；真正的
   * 不可逆动作（隐藏默认题、丢弃孤儿）才走 `confirmThen`。
   */
  const hints = bank?.hints ?? EMPTY_HINTS;
  const hintApi = useTermHints(reload);
  const hintUnbind = hintApi.unbind;
  const hintRestore = hintApi.restore;
  const clearHintError = hintApi.clearError;
  const aliasRemove = aliasApi.remove;
  const notifySuccess = useCallback(
    (text: string): void => {
      // 组件测试里没有 `<App>` 包裹，`message` 是空对象 —— 静默跳过而不是炸
      if (typeof message?.success === "function") message.success(text);
    },
    [message],
  );

  /** 词条 id → 词条（负例面板要显示词名，不能给用户看 id） */
  const glossaryOfId = useCallback(
    (id: string): GlossaryTerm | undefined => bank?.glossaryIndex.byId(id),
    [bank?.glossaryIndex],
  );

  const termAction = useMemo<TermActionApi>(
    () => ({
      unbind: (params) => {
        void hintUnbind(params).then((ok) => {
          if (ok) notifySuccess(`已解除「${params.term.term}」在这一处的绑定`);
        });
      },
      removeAlias: (term, alias) => {
        void aliasRemove(term, alias).then((ok) => {
          if (ok) notifySuccess(`已删掉「${term.term}」的别名「${alias}」`);
        });
      },
      editTerm: openGlossaryEdit,
      busy:
        hintApi.pendingId !== null ||
        aliasApi.pendingId !== null ||
        glossaryEdit.pendingId !== null,
    }),
    [
      hintUnbind,
      aliasRemove,
      notifySuccess,
      hintApi.pendingId,
      aliasApi.pendingId,
      openGlossaryEdit,
      glossaryEdit.pendingId,
    ],
  );

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
   *
   * `onOk` 原样返回写入的 Promise：antd 会据此让「确定」按钮一直转圈到写库
   * 结束，用户拿得到「这一下确实在写」的反馈；写失败不影响弹窗关闭，
   * 原因由页面上方的失败提示条接住。
   */
  const confirmThen = useCallback(
    (copy: ConfirmCopy, action: () => Promise<unknown> | void): void => {
      if (typeof modal?.confirm !== "function") {
        void action();
        return;
      }
      modal.confirm({
        title: copy.title,
        content: copy.content,
        okText: copy.okText,
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => action(),
      });
    },
    [modal],
  );

  const handleEdit = useCallback((question: InterviewQuestion): void => {
    setEditing(question);
  }, []);

  /**
   * 质检结论点「去改」：关面板 + 打开那道题的编辑抽屉。
   *
   * 走的是**同一条编辑路径**（`QuestionEditDrawer`），所以质检不会引入
   * 「AI 直接改答案」这种第二套写入逻辑。
   */
  const handleAuditEdit = useCallback((question: InterviewQuestion): void => {
    setAuditOpen(false);
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
        () => hideBaseline(question),
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
        () => revertToDefault(question.id),
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
        () => deleteNew(question.id),
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

  /**
   * 删除自建词条。
   *
   * 与「隐藏默认题」同一档：删除是不可逆的观感（那段文字不再可点），必须二次确认。
   * 内置词条不提供这个入口 —— `remove` 会直接拒绝并说明原因。
   */
  const handleDeleteTerm = useCallback(
    (term: GlossaryTerm): void => {
      confirmThen(
        {
          title: "删除这个词条？",
          content: `「${term.term}」删除后正文里不再点亮，也不会再出现在搜索里。`,
          okText: "删除",
        },
        () =>
          removeGlossary(term).then((outcome) => {
            if (outcome.ok) setEditingTerm(null);
          }),
      );
    },
    [confirmThen, removeGlossary],
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
        () => revertToDefault(id),
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
        () => revertToDefault(id),
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

  /**
   * 划词「补充释义」：给**已有的**那条词条再写一条更深的。
   *
   * 不覆盖原词条（覆盖会丢掉基线内容，也会让 `related` 引用断掉），
   * 而是新建一条 `u-g-*` 并把 `related` 指回它 —— 两条词条在弹层里互相可达。
   */
  const handleSupplementTerm = useCallback(
    (picked: { text: string }): void => {
      const term = matchIndex?.exact(picked.text);
      if (!term) return;
      const categoryId =
        filter.categoryId !== "all"
          ? filter.categoryId
          : (term.categoryId ?? categories[0]?.id ?? "foundation-js");
      setAiPrefill({
        kind: "glossary",
        categoryId,
        seed: term.term,
        autoRun: true,
        supplementOf: { id: term.id, term: term.term, short: term.short },
      });
      setAiOpen(true);
    },
    [matchIndex, filter.categoryId, categories],
  );

  /**
   * AI 建议的分类被采纳：先关分类面板，再带着示例题名去出题。
   *
   * 不做「只建分类」：新分类进侧栏却 0 道题，用户第一反应是「功能坏了」。
   */
  const handleTaxonomyAdopted = useCallback(
    (
      categoryId: string,
      samples: readonly string[],
      track: QuestionTrack,
    ): void => {
      setTaxonomyOpen(false);
      setAiPrefill({
        kind: "question",
        categoryId,
        track,
        ...(samples.length > 0 ? { seed: samples.join("、") } : {}),
        autoRun: true,
      });
      setAiOpen(true);
    },
    [],
  );

  /** 草稿箱：采纳进题库（会 bump 词表版本号并刷新合并视图） */
  const handleAdoptDraft = useCallback(
    (item: InterviewItemDetailDTO): void => {
      void draftApi.adopt(item);
    },
    [draftApi],
  );

  /** 草稿箱：丢弃是彻底删除，必须二次确认 */
  const handleDiscardDraft = useCallback(
    (item: InterviewItemDetailDTO): void => {
      confirmThen(
        {
          title: "丢弃这份草稿？",
          content: `「${item.title || item.id}」会被彻底删除（不进回收站，无法恢复）。`,
          okText: "丢弃",
        },
        () => draftApi.discard(item),
      );
    },
    [confirmThen, draftApi],
  );

  /** 质检报告按 id 反查题目：查不到（刚被删）就不给「去改」 */
  const questionOf = useCallback(
    (id: string): InterviewQuestion | undefined =>
      bank?.questions.find((item) => item.id === id),
    [bank?.questions],
  );

  /** 标题查表：优先合并视图（可含用户新增的题），回落基线常量 */
  const titleOf = useCallback(
    (id: string): string => bank?.questions.find((item) => item.id === id)?.title ?? "",
    [bank?.questions],
  );

  const staleCount = bank?.staleBase.length ?? 0;
  const orphanCount = bank?.orphaned.length ?? 0;

  return (
    // 名词右键菜单的动作入口：`TermText` 在题干 / 标题 / 答案 / 抽屉里共十几处，
    // 逐层透传回调会让每层都多两个与自己无关的参数
    <TermActionContext.Provider value={termAction}>
      {/* 名词匹配器带上当前分类偏好：同名字条（同名不同义）在主匹配上就能对上，
          用户不必每次去弹层里手动切领域 */}
      <GlossaryMatchIndexContext.Provider value={matchIndex ?? null}>
        <Page>
          <div className="interview-page" ref={pageRef}>
            <SearchPanel
              track={filter.track}
              keyword={keywordInput}
              total={total}
              favoriteCount={favoriteCount}
              hiddenCount={bank?.hiddenIds.length ?? 0}
              draftCount={drafts.length}
              hintCount={hints.length}
              onTrackChange={setTrack}
              onKeywordChange={setKeywordInput}
              onSearch={submitKeyword}
              onOpenKnowledge={() => setKnowledgeOpen(true)}
              onOpenHidden={() => setHiddenOpen(true)}
              onOpenDrafts={() => setDraftOpen(true)}
              onOpenHints={() => setMuteOpen(true)}
              onOpenAi={openAiDrawer}
              onOpenAudit={() => setAuditOpen(true)}
              aiHidden={ai.hidden}
              aiDisabledText={ai.available ? "" : ai.unavailableText}
              loading={bank?.loading ?? false}
            />

            {/* 读库失败：题库已经回落内置基线，页面照常可读 —— 但必须说清「你现在
                看到的不是自己的改动」，否则用户只会觉得「我改过的题全没了」。
                给一个重试入口：多数失败是库被锁 / 升级中，重试一次就好。 */}
            {bank?.error ? (
              <Alert
                className="interview-page__failure"
                type="warning"
                showIcon
                title={bank.error}
                action={
                  <Button className="interview-page__retry" size="small" onClick={reload}>
                    重新读取
                  </Button>
                }
              />
            ) : null}

          {/* 升级后的两件待办：基线被官方修订过 / 我的修改在新版失效。
              一次只报条数，点进去才逐条处理 —— 顶部条不该抢走整页注意力 */}
          {staleCount > 0 || orphanCount > 0 ? (
            <Alert
              className="interview-page__notice"
              type="warning"
              showIcon
              title={`${staleCount > 0 ? `${staleCount} 道你改过的题在新版有更新` : ""}${
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
              title={overrideError}
              onClose={clearError}
            />
          ) : null}

          {/* 名词维护失败（右键解除 / 删别名）：与题目维护共用一个位置，
              用户不需要知道是哪套通道失败的 */}
          {hintApi.error || aliasApi.error ? (
            <Alert
              className="interview-page__failure"
              type="error"
              showIcon
              closable
              title={hintApi.error ?? aliasApi.error ?? ""}
              onClose={() => {
                clearHintError();
                clearAliasError();
              }}
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
            ai={taxonomyAi}
            onAdoptedSuggest={handleTaxonomyAdopted}
            onClose={() => setTaxonomyOpen(false)}
          />

          <DraftBoxDrawer
            open={draftOpen}
            items={drafts}
            categories={categories}
            pendingId={draftApi.pendingId}
            error={draftApi.error}
            onClearError={draftApi.clearError}
            onAdopt={handleAdoptDraft}
            onDiscard={handleDiscardDraft}
            onClose={() => setDraftOpen(false)}
          />

          <AiDraftDrawer
            open={aiOpen}
            prefill={aiPrefill}
            categories={categories}
            ai={ai}
            onClose={() => setAiOpen(false)}
          />

          <AuditDrawer
            open={auditOpen}
            pool={filteredQuestions}
            questionOf={questionOf}
            available={audit.available}
            unavailableText={audit.available ? "" : audit.unavailableText}
            running={audit.running}
            error={audit.error}
            issues={audit.issues}
            usedFallback={audit.usedFallback}
            auditedCount={audit.auditedCount}
            onRun={() => void audit.run(filteredQuestions)}
            onDiscard={audit.discard}
            onEdit={handleAuditEdit}
            onClose={() => setAuditOpen(false)}
          />

          <MutePanel
            open={muteOpen}
            items={hints}
            termOf={glossaryOfId}
            pendingId={hintApi.pendingId}
            onRestore={(id) => void hintRestore(id)}
            onClose={() => setMuteOpen(false)}
          />

          <GlossaryEditDrawer
            open={editingTerm !== null}
            term={editingTerm}
            categories={categories}
            holders={glossaryHolders}
            pendingId={glossaryEdit.pendingId}
            error={glossaryEdit.error}
            onClearError={glossaryEdit.clearError}
            onClose={() => setEditingTerm(null)}
            onSaved={() => setEditingTerm(null)}
            save={saveGlossary}
            onDelete={handleDeleteTerm}
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
            onSupplement={handleSupplementTerm}
            aliasOwner={aliasOwner}
            aliasPending={aliasApi.pendingId !== null}
            aliasError={aliasApi.error}
            onAddAlias={(owner, text) => {
              void aliasApi.append(owner, text).then((ok) => {
                if (ok) clearSelection();
              });
            }}
            onAskAi={(picked) => void ai.askExplain(picked.text, picked.sentence)}
            onClearAnswer={ai.clearExplain}
            onClose={() => {
              clearSelection();
              aliasApi.clearError();
              ai.clearExplain();
            }}
          />
          </div>
        </Page>
      </GlossaryMatchIndexContext.Provider>
    </TermActionContext.Provider>
  );
}
