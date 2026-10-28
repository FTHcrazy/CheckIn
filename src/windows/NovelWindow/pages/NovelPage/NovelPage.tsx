import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "antd";
import ChapterJumpPalette from "./components/ChapterJumpPalette";
import ChapterTree from "./components/ChapterTree";
import EditorPane from "./components/EditorPane";
import EntityContextMenu from "./components/EntityContextMenu";
import EntityTypeManager from "./components/EntityTypeManager";
import PolishPreview from "./components/PolishPreview";
import ContinuationPreview from "./components/ContinuationPreview";
import SummaryPreview from "./components/SummaryPreview";
import AiConsentDialog from "@/shared/components/AiConsentDialog";
import { L3_SCOPE_LABELS } from "@/shared/ai/ai-consent";
import HoverEntityCard from "./components/HoverEntityCard";
import NovelGuideTour from "../../components/NovelGuideTour";
import type { GuideView } from "@/shared/novel/guide-copy";
// T03：设定中心整棵树在 src/shared（GlobalSettingWindow 要跨窗口复用同一份），
// 这里直接引 shared，不再经 NovelPage 本地垫片。
import SettingCenter from "@/shared/components/SettingCenter";
import { SETTING_PRESETS } from "./utils/setting-presets";
import ContinueFab from "./components/ContinueFab";
import NovelToast from "./components/NovelToast";
import NovelTopBar from "./components/NovelTopBar";
import type { WorkManageMenuHandle } from "./components/WorkManageMenu";
import ReorderConfirmModal from "./components/ReorderConfirmModal";
import RestoreBanner from "./components/RestoreBanner";
import SettingsDrawer from "./components/SettingsDrawer";
import SnapshotDrawer from "./components/SnapshotDrawer";
import StatusBar from "./components/StatusBar";
import SupportPanel from "./components/SupportPanel";
import { EntityTypesProvider } from "./hooks/useEntityTypes";
import { useNovelPage } from "./hooks/useNovelPage";
import { usePaperFonts } from "./hooks/usePaperFonts";
import { useSensitiveDetection } from "./hooks/useSensitiveDetection";
import { hoverActions } from "./store/useHoverStore";
import {
  appearancesOf,
  resetAppearances,
  syncAppearances,
} from "./store/useAppearanceStore";
import { createNovelId } from "./services/novel-service";
import {
  applySettingTemplate,
  exportSetting,
  exportTextFile,
  listSettingTemplates,
  loadGlobalSettingCategories,
  publishCategoryToGlobal,
  referenceGlobalCategory,
  removeSettingTemplate,
  saveSettingTemplate,
} from "./services/novel-service";
import { formatNumberedLabel } from "./novel-utils";
import { toSettingCategory } from "@/shared/novel/setting-mappers";
import {
  type EntityOpenPayload,
  type NovelEditorBridge,
} from "../../utils/entity-jump";
import type { EntityAppearance, NovelChapter, SettingCategory } from "./types";
import "./index.scss";

/** 书架 → 编辑器的打开请求：幂等 token 防止 StrictMode 下 effect 双消费 */
export interface OpenWorkRequest {
  workId: string;
  chapterId?: string;
  /** 关系图窗口带过来的要素：切完作品后把这张资料卡打开（R27 / S6） */
  entityId?: string;
  token: number;
}

interface NovelPageProps {
  /** 书架派发的打开请求；未挂载期间请求会被暂存，挂载后由 effect 消费 */
  openRequest?: OpenWorkRequest | null;
  /** 请求处理完成后回调（窗口根组件据此置空请求） */
  onOpenRequestConsumed?: () => void;
  /** 顶栏「返回书架」回调；未传则不渲染返回按钮 */
  onBackToShelf?: () => void;
  /**
   * 空书架空态「导入书籍」的回调（经窗口根转交书架发起导入）。
   * 之前这里误接 onBackToShelf：点了按钮只回书架、不出选文件框，
   * 现在一步直达 —— 由窗口根切回书架并派发导入请求。
   */
  onImportBook?: () => void;
  /**
   * 本页是否可见（App 层用 display 在两个视图间切换，页面常驻不卸载）。
   * 新手引导靠它决定何时探测目标：不可见时收摊暂停，重新可见再续播。
   */
  visible?: boolean;
  /**
   * 引导「下一步」跨视图回书架时的切视图请求（第 5 → 第 6 步，1.4x）。
   * 由窗口根注入并转交 Tour —— 只有窗口根同时持有两个视图的显隐开关。
   */
  onGoToView?: (view: GuideView) => void;
  /**
   * 把「编辑器能力句柄」交给窗口根（`NovelEditorBridge`）。
   * 关系图的消息只由窗口根监听一次，保存 / 切书 / 开卡都通过这个句柄下发；
   * 卸载时传 null，窗口根据此退回「直接打开」的兜底路径。
   */
  onEditorBridge?: (bridge: NovelEditorBridge | null) => void;
  /** 关系图要求打开另一本书的要素：非空即弹确认框（由窗口根判定，本页不自己拦消息） */
  entityJump?: EntityOpenPayload | null;
  /** 确认框「保存后跳转」进行中（防连点） */
  entityJumpSaving?: boolean;
  onConfirmEntityJump?: () => void;
  onCancelEntityJump?: () => void;
}

/**
 * 小说编辑器主页面（W1）
 *
 * 只负责编排：把三个 Hook 暴露的状态接到对应的私有组件上。
 * 容器管辖范围对应设计方案 §03 的 W1 / D1 / D2 / O1 / O2 / O3 / P1。
 */
export default function NovelPage({
  openRequest = null,
  onOpenRequestConsumed,
  onBackToShelf,
  onImportBook,
  visible = true,
  onGoToView,
  onEditorBridge,
  entityJump = null,
  entityJumpSaving = false,
  onConfirmEntityJump,
  onCancelEntityJump,
}: NovelPageProps = {}) {
  const {
    data,
    editor,
    view,
    terms,
    breadcrumb,
    outline,
    outlineActions,
    inspirationActions,
    workMeta,
    reorderPreview,
    handleReorderChapter,
    handleMoveChapterToVolume,
    handleReorderVolume,
    confirmReorder,
    cancelReorder,
    handleNewChapter,
    handleCreateChapterInVolume,
    handleSelectChapter,
    handleSelectWork,
    handleRollback,
    handleOpenEntity,
    handleRestoreRecovery,
    ctxMenu,
    handleEditorContextMenu,
    closeCtxMenu,
    handleCtxMark,
    handleCtxToPack,
    polish,
    handleCtxPolish,
    handleCtxTransform,
    handlePolishConfirm,
    handlePolishClose,
    handlePolishRetry,
    // AI 续写（R-AI-07）
    continuation,
    requestContinuation,
    handleContinuationConfirm,
    handleContinuationClose,
    handleContinuationRetry,
    handleContinuationStop,
    // AI 章节摘要（R-AI-09）
    summary,
    summaryPending,
    summaryPendingScope,
    aiConsent,
    aiAvailability,
    runChapterSummary,
    handleSummaryConsentConfirm,
    handleSummaryConsentCancel,
    handleSummaryClose,
    handleApplySummaryNote,
    handleNewVolume,
    handleSaveEntity,
    handleRenameVolume,
    handleDeleteVolume,
    handleAddRelation,
    handleRemoveRelation,
    handleCursorChange,
    handleScrollChange,
    handleCreateWork,
    handleRenameWork,
    handleSetWorkGenre,
    handleDeleteWork,
    handleResetTemplate,
    handleDeleteChapter,
    handleExportBook,
    handleExportVolume,
    handleExportChapter,
    handleExportCard,
    handleSetEntityLevel,
    handleAddCustomType,
    handleRenameCustomType,
    handleRecolorCustomType,
    handleRemoveCustomType,
    entityTypesValue,
    editorPaneRef,
    namingActions,
    namingExclude,
    namingFavorites,
    namingBook,
    protagonistEntityId,
    handleSetProtagonist,
    openPackWindow,
    openRelationWindow,
    packOpening,
  } = useNovelPage();

  const { loadSnapshots, activeChapterId, searchBook } = data;

  /**
   * AI 入口是否该**出现**（REQ-063）。
   *
   * 与 `aiAvailability.available` 是两个问题：`available=false` 但原因是
   * 「开关开着、只是没配全模型 / Key」时，入口要留着（禁用 + 说明原因），
   * 否则用户不知道该去补配置；只有总开关被关掉、或本版本根本没有 AI 通道
   * （lite / 未登录）才整块收掉，连灰按钮和提示文案都不留。
   * 判据的推导在 `useAiAvailability` 的 `isAiHidden` 里（纯函数，有单测）。
   */
  const aiVisible = !aiAvailability.hidden;

  /**
   * 正文字体：下载 / 列表 / @font-face 挂载 / 预览，都由这个 hook 持有。
   * activeFamily 直接绑定 settings.paperFont，select 回写 updateSetting。
   */
  const paperFonts = usePaperFonts({
    activeFamily: editor.settings.paperFont,
    onSelect: (family) => editor.updateSetting("paperFont", family),
  });

  /**
   * 阅读模式「滚动到首/尾自动加载上下章」：从 data.groups（卷按 sort、卷内
   * 章按 sort 已排好）扁平化出全书有序章节 id，据此定位当前章的 prev/next。
   *
   * openAnchor 是一次性信号：'bottom' 表示这次切章要定位到文末（加载上一章），
   * 'top' 定位到文首（加载下一章 / 正常切章）。EditorPane 消费后经回调清空。
   */
  const orderedChapterIds = useMemo(
    () =>
      data.groups.flatMap((group) =>
        group.chapters.map((chapter) => chapter.id),
      ),
    [data.groups],
  );
  const [openAnchor, setOpenAnchor] = useState<"top" | "bottom">("top");
  /**
   * 回收换章锚点的一次性信号。必须是稳定引用：EditorPane 的「换章滚动定位」
   * effect 把它放在依赖数组里，若像之前那样传内联箭头函数，每次重渲染都会换
   * 一个新引用 → effect 被反复触发 → 走到 `scrollTop = 0` 分支，表现为「选中
   * 文字（setSelection 引起页面根重渲染）后正文自动跳回顶部」。
   */
  const handleOpenAnchorApplied = useCallback((): void => {
    setOpenAnchor("top");
  }, []);

  const handleLoadPrevChapter = useCallback((): void => {
    const index = orderedChapterIds.indexOf(data.activeChapterId ?? "");
    const prevId = index > 0 ? orderedChapterIds[index - 1] : null;
    if (!prevId) return;
    setOpenAnchor("bottom");
    handleSelectChapter(prevId);
  }, [orderedChapterIds, data.activeChapterId, handleSelectChapter]);

  const handleLoadNextChapter = useCallback((): void => {
    const index = orderedChapterIds.indexOf(data.activeChapterId ?? "");
    const nextId =
      index >= 0 && index < orderedChapterIds.length - 1
        ? orderedChapterIds[index + 1]
        : null;
    if (!nextId) return;
    setOpenAnchor("top");
    handleSelectChapter(nextId);
  }, [orderedChapterIds, data.activeChapterId, handleSelectChapter]);

  /**
   * 敏感词检测：持久化登记 / 读盘 / 跳转消费都在这个 hook 里，
   * 页面只把它暴露的两件事接给编辑器——词库与定位偏移。
   */
  const sensitive = useSensitiveDetection({
    activeWorkId: data.activeWorkId,
    currentChapterId: activeChapterId,
    onSelectChapter: handleSelectChapter,
  });

  // 书架 → 编辑器：消费打开请求（token 守卫，StrictMode 双执行只消费一次）
  const consumedTokenRef = useRef<number | null>(null);
  const { reload, setActiveWorkId, selectChapter, works } = data;

  /**
   * 作品管理菜单的命令式句柄：空书架空态里的「新建作品」直接开它的创建弹框
   * （创建弹框只此一份，不另抄一个同名 Modal）。
   */
  const workMenuRef = useRef<WorkManageMenuHandle>(null);
  useEffect(() => {
    if (!openRequest || consumedTokenRef.current === openRequest.token) return;
    consumedTokenRef.current = openRequest.token;
    void (async () => {
      const { workId, chapterId, entityId } = openRequest;
      // 书架新建的作品尚未进编辑器内存 → 先重载全量再选中
      if (workId && !works.some((work) => work.id === workId)) {
        await reload();
      }
      if (workId) setActiveWorkId(workId);
      if (chapterId) selectChapter(chapterId);
      // 资料卡放在切书之后：要素列表随 bundle 重载，提前开只会指向上一本书的 id
      if (entityId) view.openEntityDetail(entityId);
      onOpenRequestConsumed?.();
    })();
  }, [
    openRequest,
    works,
    reload,
    setActiveWorkId,
    selectChapter,
    view,
    onOpenRequestConsumed,
  ]);

  /**
   * 关系图窗口的「在主窗口打开资料卡」（R27 / S6）· 编辑器态。
   *
   * ⚠️ **本页不再自己监听 `rel-open-entity`**：以前窗口根与本页各挂一个监听，
   * 事件一到两边同时动手 —— 窗口根先切了书，这张确认框才弹出来，用户看到的
   * 就是「先切书、再问要不要切」。现在监听只在窗口根，本页通过
   * `onEditorBridge` 把「保存 / 切书 / 开卡」的能力交出去，确认框只负责渲染。
   */

  // 快照抽屉按需加载：打开时才查该章的版本时间线
  useEffect(() => {
    if (!view.snapshotOpen || !activeChapterId) return;
    void loadSnapshots(activeChapterId);
  }, [view.snapshotOpen, activeChapterId, loadSnapshots]);

  /**
   * 出场章数索引交给 store（渲染后同步）：
   * 全书按章缓存，自动保存时只重扫「正在写的那一章」，
   * 页面根不再持有这个索引 —— 保存正文不会再把整棵树推一遍。
   */
  useEffect(() => {
    syncAppearances(data.chapters, terms);
  }, [data.chapters, terms]);

  // 切作品先清索引：上一本书的倒排索引留着会短暂读到别的书的出场章
  useEffect(() => {
    return () => resetAppearances();
  }, [data.activeWorkId]);

  /** 章节 id → 章（出场列表要把倒排索引的 id 还原成标题与序号） */
  const chapterById = useMemo(() => {
    const map = new Map<string, NovelChapter>();
    for (const chapter of data.chapters) map.set(chapter.id, chapter);
    return map;
  }, [data.chapters]);

  /**
   * 出场章节（R21 升级）：读 store 的倒排索引，不再自己扫全书。
   * 老实现在渲染体里对**每一章**跑 `findTermMatches`（字数 × 词条的正则），
   * 详情卡开着时自动保存每 800ms 就触发一遍全书扫描。
   */
  const getAppearances = useCallback(
    (entityId: string): EntityAppearance[] => {
      const chapterIds = appearancesOf(entityId);
      if (chapterIds.length === 0) return [];
      const { numberStyle, chapterSuffix } = editor.settings;
      const list: EntityAppearance[] = [];
      for (const chapterId of chapterIds) {
        const chapter = chapterById.get(chapterId);
        if (!chapter) continue;
        const number = data.chapterNumbers.get(chapterId) ?? 0;
        list.push({
          chapterId,
          title: chapter.title,
          label:
            number > 0
              ? formatNumberedLabel(numberStyle, chapterSuffix, number)
              : "",
        });
      }
      return list;
    },
    [chapterById, data.chapterNumbers, editor.settings],
  );

  const detailEntity = useMemo(
    () =>
      view.detailEntityId ? data.getEntityById(view.detailEntityId) : null,
    [view.detailEntityId, data],
  );

  const detailHighlighted = useMemo(() => {
    if (!detailEntity) return false;
    return editor.settings.annotationTypes.includes(detailEntity.type);
  }, [detailEntity, editor.settings.annotationTypes]);

  const handleToggleHighlight = useCallback(() => {
    if (!detailEntity) return;
    editor.toggleAnnotationType(detailEntity.type);
    view.showToast(
      detailHighlighted
        ? `已关闭「${detailEntity.name}」类型的高亮`
        : `已在正文中高亮「${detailEntity.name}」`,
      "info",
    );
  }, [detailEntity, detailHighlighted, editor, view]);

  const handleSearch = useCallback(
    (keyword: string) => searchBook(keyword),
    [searchBook],
  );

  /** 作品 id → 书名：全局灵感搜索结果的来源标签 */
  const workNameOf = useCallback(
    (workId: string): string =>
      data.works.find((work) => work.id === workId)?.name ?? "其他作品",
    [data.works],
  );

  /**
   * 把能力句柄交给窗口根（唯一监听 `rel-open-entity` 的地方）。
   *
   * `activeWorkId` 是**getter**：句柄在窗口根手里跨多次渲染存活，若传快照，
   * 事件到来时会拿挂载那一刻的旧作品 id 去判定，异书确认就退化成「总是同书」。
   */
  useEffect(() => {
    if (!onEditorBridge) return undefined;
    onEditorBridge({
      // ready：数据装载完成前 activeWorkId 恒为 ""，窗口根据此挂起跳转、
      // 就绪后重判 —— 拿空 id 判定会把异书跳转误判成「空态直开」
      ready: () => !data.loading,
      activeWorkId: () => data.activeWorkId,
      workNameOf,
      switchWork: (workId) => data.setActiveWorkId(workId),
      openEntity: (entityId) => view.openEntityDetail(entityId),
      flushSave: () => editor.flushSave(),
      toast: (text, tone) => view.showToast(text, tone),
    });
    return () => onEditorBridge(null);
  }, [
    onEditorBridge,
    workNameOf,
    data.loading,
    data.activeWorkId,
    data.setActiveWorkId,
    editor.flushSave,
    view.openEntityDetail,
    view.showToast,
  ]);

  /** 预设模板列表：设定中心的模板库面板按需拉取（打开时才读库） */
  const [settingTemplates, setSettingTemplates] = useState<
    Array<{ id: string; name: string; createdAt: number }>
  >([]);
  const refreshTemplates = useCallback(() => {
    void listSettingTemplates().then((list) =>
      setSettingTemplates(
        list.map((item) => ({
          id: item.id,
          name: item.name,
          createdAt: item.createdAt,
        })),
      ),
    );
  }, []);

  // onExportCard 为同步签名（EntityPanel 透传链），异步导出在此收口
  const triggerExportCard = useCallback(() => {
    void handleExportCard();
  }, [handleExportCard]);

  /**
   * 从角色卡进设定中心：直接落到境界体系那一个分类
   *
   * 传 focusId 而不是让组件自己猜 —— 同一本书可能还有「功法等级」等分类，
   * 作者从「当前境界」点进来想看的就是境界阶梯。还没有境界体系时传 null，
   * 由组件落在空态上（空态里有「新建境界体系」的入口）。
   */
  const openSettingCenterForRealm = useCallback(() => {
    view.openSettingCenter(data.realmCategory?.id ?? null);
  }, [view, data.realmCategory]);

  /** 导出设定：JSON 供再导入，Markdown 供人读 */
  const handleExportSetting = useCallback(
    (categoryId: string, format: "json" | "markdown") => {
      void (async () => {
        const category = data.settings.find((item) => item.id === categoryId);
        if (!category) return;
        const payload = await exportSetting(data.activeWorkId);
        const picked = payload.categories.filter(
          (item) => item.name === category.name,
        );
        const scope = picked.length > 0 ? picked : payload.categories;
        const base = `${workNameOf(data.activeWorkId)}-设定-${category.name}`;
        if (format === "json") {
          await exportTextFile(
            base,
            JSON.stringify({ ...payload, categories: scope }, null, 2),
            "json",
            "JSON 文件",
          );
          return;
        }
        const lines: string[] = [`# ${category.name}`, ""];
        if (category.note) lines.push(category.note, "");
        for (const level of category.levels) {
          const alias =
            level.aliases.length > 0
              ? `（别名：${level.aliases.join("、")}）`
              : "";
          lines.push(
            `- **${level.rank}. ${level.name}**${alias} ${level.note}`,
          );
        }
        await exportTextFile(base, lines.join("\n"), "md", "Markdown 文件");
      })();
    },
    [data.settings, data.activeWorkId, workNameOf],
  );

  const handleSaveSettingTemplate = useCallback(
    (categoryId: string, name: string) => {
      void saveSettingTemplate(createNovelId("st"), name, data.activeWorkId, [
        categoryId,
      ]).then((ok) => {
        if (ok) void refreshTemplates();
      });
    },
    [data.activeWorkId, refreshTemplates],
  );

  const handleApplySettingTemplate = useCallback(
    (templateId: string) => {
      void applySettingTemplate(templateId, data.activeWorkId).then(() => {
        void refreshTemplates();
        void data.reload();
      });
    },
    [data, refreshTemplates],
  );

  // ── 全局设定中心联动（1.4x，REQ-041 / REQ-042）：本书设定中心的引用 / 上架 ──

  /** 全局库分类（「从全局库选择」选择器展示用）；打开选择器时才读，低频 */
  const [globalSettingCategories, setGlobalSettingCategories] = useState<
    SettingCategory[]
  >([]);

  /**
   * 全局库分类（D2 选择器数据源）。
   *
   * 映射统一走 `@/shared/novel/setting-mappers`（N-06）：全局库无作品归属 →
   * `workId: ""`，`refCount` 带上（选择器显示「N 部书引用」），缺字段按同一套
   * 兜底口径回退 —— 此前这里内联了一份**无兜底**的映射，与全局窗口那份各写一遍。
   */
  const refreshGlobalCategories = useCallback(() => {
    void loadGlobalSettingCategories().then((list) =>
      setGlobalSettingCategories(
        list.map((item) =>
          toSettingCategory(item, { workId: "", withRefCount: true }),
        ),
      ),
    );
  }, []);

  /**
   * 建立引用（D2）：主进程写入本书镜像（只读、随全局实时同步）；
   * 成功后重载本书设定 —— 新引用的分类即出现在左栏（带「全局 · 自动同步」徽标）。
   */
  const handleReferenceGlobal = useCallback(
    async (globalCategoryId: string): Promise<boolean> => {
      const ok = await referenceGlobalCategory(
        data.activeWorkId,
        globalCategoryId,
      );
      if (ok) await data.reload();
      return ok;
    },
    [data],
  );

  /**
   * 放置到全局（D3）：`cancel` 先探同名，命中返回 `{ok:false, conflict:true}`
   * 由组件弹冲突确认（默认新建副本）；以 `duplicate` 再调一次即复制快照上架。
   */
  const handlePublishGlobal = useCallback(
    (categoryId: string, conflict: "duplicate" | "cancel") =>
      publishCategoryToGlobal(data.activeWorkId, categoryId, conflict),
    [data.activeWorkId],
  );

  /** 引用 / 上架的轻提示：复用页面既有 toast（引用镜像同步成功等） */
  const handleSettingNotify = useCallback(
    (text: string, tone?: "success" | "info" | "warning" | "error") => {
      view.showToast(text, tone);
    },
    [view],
  );

  /** 删除类型弹框用：该自建类型下现有多少张要素卡（当前作品口径） */
  const usageCountOf = useCallback(
    (typeId: string) =>
      data.entities.filter((entity) => entity.type === typeId).length,
    [data.entities],
  );

  return (
    <EntityTypesProvider value={entityTypesValue}>
      <div
        className={`nv-page${view.focusMode ? " is-focus" : ""}${
          view.pageOverlayOpen ? " is-overlay" : ""
        }`}
      >
        <div className="nv-page__head">
          {editor.recoveryVisible && data.recovery && (
            <RestoreBanner
              recovery={data.recovery}
              onAcknowledge={handleRestoreRecovery}
            />
          )}
          <NovelTopBar
            works={data.works}
            activeWorkId={data.activeWorkId}
            workMeta={workMeta}
            onBackToShelf={onBackToShelf}
            menuRef={workMenuRef}
            volumeName={breadcrumb.volumeName}
            chapterName={breadcrumb.chapterName}
            leftOpen={view.leftOpen}
            rightOpen={view.rightOpen}
            settingsOpen={view.settingsOpen}
            settingCenterOpen={view.settingCenterOpen}
            onSelectWork={(workId) => void handleSelectWork(workId)}
            onCreateWork={handleCreateWork}
            onRenameWork={handleRenameWork}
            onSetWorkGenre={handleSetWorkGenre}
            aiVisible={aiVisible}
            onDeleteWork={handleDeleteWork}
            onResetTemplate={() => void handleResetTemplate()}
            onExportBook={() => void handleExportBook()}
            onExportVolume={() => void handleExportVolume()}
            onExportChapter={() => void handleExportChapter()}
            onToggleLeft={view.toggleLeft}
            onToggleRight={view.toggleRight}
            onToggleSettings={view.toggleSettings}
            snapshotOpen={view.snapshotOpen}
            onOpenPack={openPackWindow}
            packOpening={packOpening}
            onToggleSettingCenter={view.toggleSettingCenter}
            onToggleHistory={view.toggleSnapshot}
            /* REQ-061：AI 续写已搬到正文区右下角的悬浮按钮，顶栏不再放这颗闪电 */
            /* REQ-053：浮层（设定中心 / 类型管理 Modal）开着时，点击顶栏即离开浮层 ——
             它们铺满视口的 wrap 会吃掉同一次点击，让「行囊 / 小说设定」需要点两次 */
            onDismissOverlays={view.dismissPageOverlays}
          />
        </div>

        <div className="nv-page__body">
          <ChapterTree
            collapsed={!view.leftOpen}
            groups={data.groups}
            chapterNumbers={data.chapterNumbers}
            numberStyle={editor.settings.numberStyle}
            volumeSuffix={editor.settings.volumeSuffix}
            activeChapterId={data.activeChapterId}
            onSelect={handleSelectChapter}
            onToggleStatus={data.toggleChapterStatus}
            onCreate={handleNewChapter}
            onCreateChapterInVolume={handleCreateChapterInVolume}
            onCreateVolume={handleNewVolume}
            onRenameChapter={data.renameChapter}
            onDeleteChapter={handleDeleteChapter}
            onReorderChapter={handleReorderChapter}
            onMoveChapterToVolume={handleMoveChapterToVolume}
            onReorderVolume={handleReorderVolume}
            onRenameVolume={handleRenameVolume}
            onDeleteVolume={handleDeleteVolume}
            onOpenSummary={runChapterSummary}
            showSummary={aiVisible}
          />

          <div className="nv-page__stage">
            <EditorPane
              ref={editorPaneRef}
              chapter={data.activeChapter}
              chapterNumber={
                data.activeChapterId
                  ? (data.chapterNumbers.get(data.activeChapterId) ?? 0)
                  : 0
              }
              settings={editor.settings}
              terms={terms}
              annotationOn={view.annotationOn}
              onSelectionChange={editor.setSelection}
              onContextMenu={handleEditorContextMenu}
              onTermHover={hoverActions.enter}
              onTermLeave={hoverActions.leave}
              onTermClick={handleOpenEntity}
              onCreateChapter={handleNewChapter}
              emptyKind={works.length === 0 ? "no-work" : "no-chapter"}
              onCreateWork={() => workMenuRef.current?.openCreate()}
              onImportBook={onImportBook}
              onRenameChapter={data.renameChapter}
              restore={data.lastPosition}
              onRestoreDone={data.consumeLastPosition}
              onCursorChange={handleCursorChange}
              onScrollChange={handleScrollChange}
              sensitiveWords={sensitive.words}
              sensitiveOn={sensitive.enabled}
              sensitiveRanges={sensitive.ranges}
              focusPos={sensitive.focusPos}
              onFocusPosApplied={sensitive.clearFocusPos}
              onDraftPulse={sensitive.handleDraftPulse}
              onSensitiveRangesMapped={sensitive.handleRangesMapped}
              onLoadPrevChapter={handleLoadPrevChapter}
              onLoadNextChapter={handleLoadNextChapter}
              openAnchor={openAnchor}
              onOpenAnchorApplied={handleOpenAnchorApplied}
            />

            <StatusBar
              annotationOn={view.annotationOn}
              onToggleAnnotation={view.toggleAnnotation}
              onOpenSensitive={() => view.openToolSub("sensitive")}
            />

            {/* AI 续写悬浮按钮（REQ-061）：贴着正文区右下角，比顶栏那一排图标
                更贴近「在光标处接着写」的语义，也给顶栏腾出空间。
                点击只是入口，真正发起前还有一次确认（useNovelPage.requestContinuation）。
                阅读模式 / 还没有章节时不出现：这两种情况下没有「光标前的前文」，
                浮一颗点了只会提示「先到正文里点一下」的按钮，属于噪音。
                REQ-063：AI 总开关关掉时整颗不渲染（`aiAvailability.hidden`）——
                留一颗灰按钮等于告诉用户「这里本来有 AI」。 */}
            {!aiAvailability.hidden &&
              !editor.settings.readMode &&
              data.activeChapter && (
                <ContinueFab
                  onContinue={requestContinuation}
                  aiAvailable={aiAvailability.available}
                  aiUnavailableText={aiAvailability.reasonText}
                  busy={continuation?.streaming ?? false}
                />
              )}

            {/* 选区右键菜单：文本变换 / 记入行囊 / 新建资料卡（REQ-062 已下线「绑定到现有资料卡」） */}
            {editor.selection && ctxMenu && (
              <EntityContextMenu
                x={ctxMenu.x}
                y={ctxMenu.y}
                text={editor.selection.text}
                onAddToPack={() => void handleCtxToPack()}
                onMark={handleCtxMark}
                onPolish={handleCtxPolish}
                onTransform={handleCtxTransform}
                aiVisible={aiVisible}
                aiAvailable={aiAvailability.available}
                aiUnavailableText={aiAvailability.reasonText}
                onClose={closeCtxMenu}
              />
            )}

            {/* AI 润色 / 文本变换预览：划词右键后弹出，确认才替换 */}
            {polish && (
              <PolishPreview
                original={polish.text}
                polished={polish.polished}
                loading={polish.loading}
                error={polish.error}
                mode={polish.mode}
                onConfirm={handlePolishConfirm}
                onRetry={handlePolishRetry}
                onClose={handlePolishClose}
              />
            )}

            {/* AI 续写候选：光标处触发，逐字流式输出，点「插入」写入光标处 */}
            {continuation && (
              <ContinuationPreview
                text={continuation.text}
                streaming={continuation.streaming}
                loading={continuation.loading}
                error={continuation.error}
                onConfirm={handleContinuationConfirm}
                onStop={handleContinuationStop}
                onRetry={handleContinuationRetry}
                onClose={handleContinuationClose}
              />
            )}

            {/* AI 章节摘要浮层（R-AI-09）：生成后已落库，这里只展示 + 告知来源 */}
            {summary && (
              <SummaryPreview
                result={summary.result}
                loading={summary.loading}
                error={summary.error}
                model={data.chapters.find((c) => c.id === summary.chapterId)?.aiSummaryModel}
                scopeLabel={L3_SCOPE_LABELS[aiConsent.scope]}
                oneLiner={summary.oneLiner}
                noteConflict={summary.noteConflict}
                noteApplied={summary.noteApplied}
                onApplyNote={handleApplySummaryNote}
                onRegenerate={() => runChapterSummary(summary.chapterId, true)}
                onClose={handleSummaryClose}
              />
            )}

            {/* L3 授权弹窗（M5）：首次触发摘要等 L3 功能时弹出。
                范围选择器已真正生效（发送内容随档变化），因此不再隐藏。 */}
            <AiConsentDialog
              open={summaryPending !== null}
              estimate={summaryPendingScope}
              scope={aiConsent.scope}
              onScopeChange={aiConsent.setScope}
              notice={summaryPendingScope.notice}
              confirmDisabled={summaryPendingScope.chars === 0}
              provider={aiConsent.provider}
              onConfirm={() => void handleSummaryConsentConfirm()}
              onCancel={handleSummaryConsentCancel}
            />

            {/* 悬浮卡自己订阅 hover store：指针扫过正文不再推整棵树 */}
            <HoverEntityCard onOpenDetail={handleOpenEntity} />

            <ChapterJumpPalette
              open={view.jumpOpen}
              chapters={data.chapters}
              onSelect={handleSelectChapter}
              onClose={view.closeJump}
            />

            <SnapshotDrawer
              open={view.snapshotOpen}
              snapshots={data.snapshots}
              activeChapterId={data.activeChapterId}
              onClose={view.closeSnapshot}
              onRollback={(snapshotId, snapshotTime) =>
                void handleRollback(snapshotId, snapshotTime)
              }
            />

            <SettingsDrawer
              open={view.settingsOpen}
              settings={editor.settings}
              onUpdate={editor.updateSetting}
              onToggleAnnotationType={editor.toggleAnnotationType}
              onClose={view.closeSettings}
              paperFonts={paperFonts}
            />

            <NovelToast toast={view.toast} />

            <ReorderConfirmModal
              open={reorderPreview !== null}
              title={reorderPreview?.title ?? ""}
              changes={reorderPreview?.changes ?? []}
              onConfirm={confirmReorder}
              onCancel={cancelReorder}
            />
          </div>

          <SupportPanel
            open={view.rightOpen}
            activeTab={view.panelTab}
            onTabChange={view.selectPanelTab}
            width={view.rightWidth}
            onWidthChange={view.setRightWidth}
            onCollapse={view.toggleRight}
            outline={outline}
            activeChapterId={data.activeChapterId}
            outlineActions={outlineActions}
            entities={data.entities}
            linkCount={data.entityLinkCount}
            filter={view.entityFilter}
            onFilterChange={view.setEntityFilter}
            detailEntityId={view.detailEntityId}
            onOpenEntity={handleOpenEntity}
            onCloseEntity={view.closeEntityDetail}
            getEntityRelations={data.getEntityRelations}
            getAppearances={getAppearances}
            settings={data.settings}
            notes={data.notes}
            globalNotes={data.allNotes}
            activeWorkId={data.activeWorkId}
            workNameOf={workNameOf}
            inspirationActions={inspirationActions}
            onSearch={handleSearch}
            onSelectChapter={handleSelectChapter}
            highlighted={detailHighlighted}
            onToggleHighlight={handleToggleHighlight}
            onExportCard={triggerExportCard}
            onSaveEntity={handleSaveEntity}
            onAddRelation={handleAddRelation}
            onRemoveRelation={handleRemoveRelation}
            onSetEntityLevel={(entityId, levelId, sub) => {
              const target = data.getEntityById(entityId);
              if (target)
                handleSetEntityLevel(entityId, target.type, levelId, sub);
            }}
            onOpenSettings={openSettingCenterForRealm}
            onOpenTypeManager={view.openTypeManager}
            protagonistEntityId={protagonistEntityId}
            onSetProtagonist={handleSetProtagonist}
            namingActions={namingActions}
            namingExclude={namingExclude}
            namingFavorites={namingFavorites}
            namingBook={namingBook}
            aiVisible={aiVisible}
            aiAvailable={aiAvailability.available}
            aiUnavailableText={aiAvailability.reasonText}
            onNotify={view.showToast}
            chapters={data.chapters}
            toolSub={view.toolSub}
            onToolSubChange={view.setToolSub}
            onOpenRelation={openRelationWindow}
          />

          {/*
          行囊已迁独立窗口（PackWindow）：顶栏按钮 / Ctrl+Shift+B 唤起，
          本页面不再内嵌渲染面板。作品 / 章节变化经 `novel-work-changed`
          广播由行囊窗口主动跟进（见 useNovelPage）。
        */}
        </div>

        {/* 设定中心（1.36.0 取代原「等级体系管理」弹框）/ 自定义类型管理（R23） */}
        <SettingCenter
          open={view.settingCenterOpen}
          workName={workNameOf(data.activeWorkId)}
          settings={data.settings}
          focusCategoryId={view.settingFocusId}
          source="book"
          onClose={view.closeSettingCenter}
          onCreateCategory={(name) =>
            data.createSettingCategory(name, "custom")
          }
          onPatchCategory={data.patchSettingCategory}
          onDeleteCategory={data.deleteSettingCategory}
          onReorderCategories={data.reorderSettingCategories}
          onAddLevel={(categoryId, name, index) =>
            data.addSettingLevel(categoryId, name, index)
          }
          onBatchAddLevels={(categoryId, names) => {
            data.batchAddSettingLevels(
              categoryId,
              names.map((name) => ({ name })),
            );
          }}
          onPatchLevel={data.patchSettingLevel}
          onDeleteLevel={data.deleteSettingLevel}
          onReorderLevels={data.reorderSettingLevels}
          onSplitLevel={data.splitSettingLevel}
          onMergeLevel={data.mergeSettingLevel}
          onExport={handleExportSetting}
          onSaveTemplate={handleSaveSettingTemplate}
          templates={settingTemplates}
          onRefreshTemplates={refreshTemplates}
          onApplyTemplate={handleApplySettingTemplate}
          onDeleteTemplate={(templateId) => {
            void removeSettingTemplate(templateId).then(
              () => void refreshTemplates(),
            );
          }}
          onApplyPreset={(presetId) => {
            const preset = SETTING_PRESETS.find((item) => item.id === presetId);
            if (!preset) return;
            // 一次性建分类 + 灌入等级（含分类级进位规则）。此前拆成
            // createSettingCategory + batchAddSettingLevels 两连调：batchAdd 从
            // 当前闭包的 bundle 里找刚建的分类，而 setBundle 是异步的，同一事件
            // 循环里它还不在里面 → 静默返回 0，表现为「应用模板后只有分类壳、
            // 等级序列永远是空的」。
            data.createSettingCategoryWithLevels(
              preset.name,
              preset.kind,
              preset.levels,
              {
                note: preset.note,
                subLevels: preset.subLevels,
                carryDir: preset.carryDir,
                subPattern: preset.subPattern,
              },
            );
          }}
          // ── 全局设定中心联动（1.4x，REQ-041 / REQ-042）：本书域引用 / 上架 ──
          globalCategories={globalSettingCategories}
          onRefreshGlobalCategories={refreshGlobalCategories}
          onReferenceGlobal={handleReferenceGlobal}
          onPublishGlobal={handlePublishGlobal}
          onNotify={handleSettingNotify}
        />
        <EntityTypeManager
          open={view.typeManagerOpen}
          customTypes={entityTypesValue.customTypes}
          usageCountOf={usageCountOf}
          onClose={view.closeTypeManager}
          onAdd={handleAddCustomType}
          onRename={handleRenameCustomType}
          onRecolor={handleRecolorCustomType}
          onRemove={handleRemoveCustomType}
        />

        {/* L1 漫游引导：第 2-5 步属编辑器页（第 1 步在书架页由那里的实例接管） */}
        <NovelGuideTour
          view="editor"
          visible={visible}
          onGoToView={onGoToView}
        />

        {/*
        关系图要求「在主窗口打开另一本书的资料卡」：只抬窗口，不替他做决定。
        两个动作就是用户能理解的两条路：取消（继续写当前这本）/ 保存后跳转。
        判定在窗口根（监听只此一处），本页只渲染这张确认框 —— 所以不可能出现
        「先切了书，再问要不要切」。
      */}
        <Modal
          open={entityJump !== null}
          title="要跳转到另一部作品吗？"
          okText="保存后跳转"
          cancelText="取消"
          confirmLoading={entityJumpSaving}
          mask={{ closable: false }}
          destroyOnHidden
          onOk={onConfirmEntityJump}
          onCancel={onCancelEntityJump}
        >
          <p className="nv-jump__text">
            关系图要在《{workNameOf(entityJump?.workId ?? "")}
            》里打开这条要素的资料卡。
          </p>
          <p className="nv-jump__text">
            当前作品的正文还有没落库的修改，跳转前会先保存；保存失败就留在原处，不会丢字。
          </p>
        </Modal>
      </div>
    </EntityTypesProvider>
  );
}
