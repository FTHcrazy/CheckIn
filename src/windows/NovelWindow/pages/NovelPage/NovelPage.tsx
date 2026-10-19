import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChapterJumpPalette from "./components/ChapterJumpPalette";
import ChapterTree from "./components/ChapterTree";
import EditorPane from "./components/EditorPane";
import EntityContextMenu from "./components/EntityContextMenu";
import EntityTypeManager from "./components/EntityTypeManager";
import HoverEntityCard from "./components/HoverEntityCard";
import NovelGuideTour from "../../components/NovelGuideTour";
import type { GuideView } from "@/shared/novel/guide-copy";
// T03：设定中心整棵树在 src/shared（GlobalSettingWindow 要跨窗口复用同一份），
// 这里直接引 shared，不再经 NovelPage 本地垫片。
import SettingCenter from "@/shared/components/SettingCenter";
import { SETTING_PRESETS } from "./utils/setting-presets";
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
import type { EntityAppearance, NovelChapter, SettingCategory } from "./types";
import "./index.scss";

/** 书架 → 编辑器的打开请求：幂等 token 防止 StrictMode 下 effect 双消费 */
export interface OpenWorkRequest {
  workId: string;
  chapterId?: string;
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
    handleCtxBind,
    handleCtxToPack,
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
    protagonistEntityId,
    handleSetProtagonist,
    openPackWindow,
    packOpening,
  } = useNovelPage();

  const { loadSnapshots, activeChapterId, searchBook } = data;

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
      const { workId, chapterId } = openRequest;
      // 书架新建的作品尚未进编辑器内存 → 先重载全量再选中
      if (workId && !works.some((work) => work.id === workId)) {
        await reload();
      }
      if (workId) setActiveWorkId(workId);
      if (chapterId) selectChapter(chapterId);
      onOpenRequestConsumed?.();
    })();
  }, [
    openRequest,
    works,
    reload,
    setActiveWorkId,
    selectChapter,
    onOpenRequestConsumed,
  ]);

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
    () => (view.detailEntityId ? data.getEntityById(view.detailEntityId) : null),
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

  /** 预设模板列表：设定中心的模板库面板按需拉取（打开时才读库） */
  const [settingTemplates, setSettingTemplates] = useState<
    Array<{ id: string; name: string; createdAt: number }>
  >([]);
  const refreshTemplates = useCallback(() => {
    void listSettingTemplates().then((list) =>
      setSettingTemplates(list.map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.createdAt,
      }))),
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
          const alias = level.aliases.length > 0 ? `（别名：${level.aliases.join("、")}）` : "";
          lines.push(`- **${level.rank}. ${level.name}**${alias} ${level.note}`);
        }
        await exportTextFile(base, lines.join("\n"), "md", "Markdown 文件");
      })();
    },
    [data.settings, data.activeWorkId, workNameOf],
  );

  const handleSaveSettingTemplate = useCallback(
    (categoryId: string, name: string) => {
      void saveSettingTemplate(
        createNovelId("st"),
        name,
        data.activeWorkId,
        [categoryId],
      ).then((ok) => {
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
        list.map((item) => toSettingCategory(item, { workId: "", withRefCount: true })),
      ),
    );
  }, []);

  /**
   * 建立引用（D2）：主进程写入本书镜像（只读、随全局实时同步）；
   * 成功后重载本书设定 —— 新引用的分类即出现在左栏（带「全局 · 自动同步」徽标）。
   */
  const handleReferenceGlobal = useCallback(
    async (globalCategoryId: string): Promise<boolean> => {
      const ok = await referenceGlobalCategory(data.activeWorkId, globalCategoryId);
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
    (typeId: string) => data.entities.filter((entity) => entity.type === typeId).length,
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
          />

          <StatusBar
            annotationOn={view.annotationOn}
            onToggleAnnotation={view.toggleAnnotation}
            onOpenSensitive={() => view.openToolSub("sensitive")}
          />

          {/* 选区右键菜单：手动绑定路线的标注入口（新建 / 绑定为别名） */}
          {editor.selection && ctxMenu && (
            <EntityContextMenu
              x={ctxMenu.x}
              y={ctxMenu.y}
              text={editor.selection.text}
              entities={data.entities}
              onAddToPack={() => void handleCtxToPack()}
              onMark={handleCtxMark}
              onBind={handleCtxBind}
              onClose={closeCtxMenu}
            />
          )}

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
            if (target) handleSetEntityLevel(entityId, target.type, levelId, sub);
          }}
          onOpenSettings={openSettingCenterForRealm}
          onOpenTypeManager={view.openTypeManager}
          protagonistEntityId={protagonistEntityId}
          onSetProtagonist={handleSetProtagonist}
          namingActions={namingActions}
          namingExclude={namingExclude}
          namingFavorites={namingFavorites}
          onNotify={view.showToast}
          chapters={data.chapters}
          toolSub={view.toolSub}
          onToolSubChange={view.setToolSub}
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
        onCreateCategory={(name) => data.createSettingCategory(name, "custom")}
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
          void removeSettingTemplate(templateId).then(() => void refreshTemplates());
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
      <NovelGuideTour view="editor" visible={visible} onGoToView={onGoToView} />
      </div>
    </EntityTypesProvider>
  );
}
