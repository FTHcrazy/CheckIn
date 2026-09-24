import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChapterJumpPalette from "./components/ChapterJumpPalette";
import ChapterTree from "./components/ChapterTree";
import EditorPane from "./components/EditorPane";
import EntityContextMenu from "./components/EntityContextMenu";
import EntityTypeManager from "./components/EntityTypeManager";
import HoverEntityCard from "./components/HoverEntityCard";
import LevelSystemManager from "./components/LevelSystemManager";
import NovelToast from "./components/NovelToast";
import NovelTopBar from "./components/NovelTopBar";
import ReorderConfirmModal from "./components/ReorderConfirmModal";
import RestoreBanner from "./components/RestoreBanner";
import SettingsDrawer from "./components/SettingsDrawer";
import SnapshotDrawer from "./components/SnapshotDrawer";
import StatusBar from "./components/StatusBar";
import StatusPanelPopover from "./components/StatusPanelPopover";
import SupportPanel from "./components/SupportPanel";
import { useStatusSheet } from "./hooks/useStatusSheet";
import { EntityTypesProvider } from "./hooks/useEntityTypes";
import { useNovelPage } from "./hooks/useNovelPage";
import { hoverActions } from "./store/useHoverStore";
import { syncAppearances } from "./store/useAppearanceStore";
import { findTermMatches, formatNumberedLabel } from "./novel-utils";
import type { EntityAppearance } from "./types";
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
    handleRollback,
    handleOpenEntity,
    handleRestoreRecovery,
    ctxMenu,
    handleEditorContextMenu,
    closeCtxMenu,
    handleCtxMark,
    handleCtxBind,
    handleNewVolume,
    handleSaveEntity,
    handleRenameVolume,
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
    handleRemoveCustomType,
    entityTypesValue,
    editorPaneRef,
    namingActions,
    namingExclude,
    namingFavorites,
  } = useNovelPage();

  const { loadSnapshots, activeChapterId, searchBook } = data;

  // 书架 → 编辑器：消费打开请求（token 守卫，StrictMode 双执行只消费一次）
  const consumedTokenRef = useRef<number | null>(null);
  const { reload, setActiveWorkId, selectChapter, works } = data;
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

  /** 出场章节（R21 升级）：返回全量可跳转引用，序号标签随序号配置派生 */
  const getAppearances = useCallback(
    (entityId: string): EntityAppearance[] => {
      const owned = terms.filter((term) => term.entityId === entityId);
      if (owned.length === 0) return [];
      const { numberStyle, chapterSuffix } = editor.settings;
      return data.chapters
        .filter(
          (chapter) => findTermMatches(chapter.content, owned).length > 0,
        )
        .map((chapter) => {
          const number = data.chapterNumbers.get(chapter.id) ?? 0;
          return {
            chapterId: chapter.id,
            title: chapter.title,
            label:
              number > 0
                ? formatNumberedLabel(numberStyle, chapterSuffix, number)
                : "",
          };
        });
    },
    [terms, data.chapters, data.chapterNumbers, editor.settings],
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

  // onExportCard 为同步签名（EntityPanel 透传链），异步导出在此收口
  const triggerExportCard = useCallback(() => {
    void handleExportCard();
  }, [handleExportCard]);

  /** 删除类型弹框用：该自建类型下现有多少张要素卡（当前作品口径） */
  const usageCountOf = useCallback(
    (typeId: string) => data.entities.filter((entity) => entity.type === typeId).length,
    [data.entities],
  );

  // ── 主角属性面板（PRD v0.1，M1：本地 mock 数据，持久化链路后续打通） ──
  const statusSheet = useStatusSheet();
  const [statusOpen, setStatusOpen] = useState(false);
  const toggleStatus = useCallback(() => setStatusOpen((v) => !v), []);
  const closeStatus = useCallback(() => setStatusOpen(false), []);

  return (
    <EntityTypesProvider value={entityTypesValue}>
      <div className={`nv-page${view.focusMode ? " is-focus" : ""}`}>
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
          volumeName={breadcrumb.volumeName}
          chapterName={breadcrumb.chapterName}
          leftOpen={view.leftOpen}
          rightOpen={view.rightOpen}
          typewriter={view.typewriter}
          settingsOpen={view.settingsOpen}
          onSelectWork={data.setActiveWorkId}
          onCreateWork={handleCreateWork}
          onRenameWork={handleRenameWork}
          onDeleteWork={handleDeleteWork}
          onResetTemplate={() => void handleResetTemplate()}
          onExportBook={() => void handleExportBook()}
          onExportVolume={() => void handleExportVolume()}
          onExportChapter={() => void handleExportChapter()}
          onToggleLeft={view.toggleLeft}
          onToggleRight={view.toggleRight}
          onToggleTypewriter={view.toggleTypewriter}
          onToggleSettings={view.toggleSettings}
          snapshotOpen={view.snapshotOpen}
          onToggleHistory={view.toggleSnapshot}
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
            typewriter={view.typewriter}
            annotationOn={view.annotationOn}
            onSelectionChange={editor.setSelection}
            onContextMenu={handleEditorContextMenu}
            onTermHover={hoverActions.enter}
            onTermLeave={hoverActions.leave}
            onTermClick={handleOpenEntity}
            onCreateChapter={handleNewChapter}
            onRenameChapter={data.renameChapter}
            restore={data.lastPosition}
            onRestoreDone={data.consumeLastPosition}
            onCursorChange={handleCursorChange}
            onScrollChange={handleScrollChange}
          />

          <StatusBar
            annotationOn={view.annotationOn}
            onToggleAnnotation={view.toggleAnnotation}
          />

          {/* 选区右键菜单：手动绑定路线的标注入口（新建 / 绑定为别名） */}
          {editor.selection && ctxMenu && (
            <EntityContextMenu
              x={ctxMenu.x}
              y={ctxMenu.y}
              text={editor.selection.text}
              entities={data.entities}
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

          {/* 主角属性面板：编辑区右下角悬浮入口 + 贴身无遮罩浮层（专注模式隐藏） */}
          {!view.focusMode && (
            <StatusPanelPopover
              open={statusOpen}
              sheet={statusSheet}
              onToggle={toggleStatus}
              onClose={closeStatus}
            />
          )}
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
          levelSystems={data.levelSystems}
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
          onSetEntityLevel={(entityId, rungId) => {
            const target = data.getEntityById(entityId);
            if (target) handleSetEntityLevel(entityId, target.type, rungId);
          }}
          onOpenLevelManager={view.openLevelManager}
          onOpenTypeManager={view.openTypeManager}
          namingActions={namingActions}
          namingExclude={namingExclude}
          namingFavorites={namingFavorites}
        />
      </div>

      {/* 等级体系管理（R25）/ 自定义类型管理（R23） */}
      <LevelSystemManager
        open={view.levelManagerOpen}
        levelSystems={data.levelSystems}
        onClose={view.closeLevelManager}
        onCreateSystem={data.createLevelSystem}
        onRenameSystem={data.renameLevelSystem}
        onDeleteSystem={data.deleteLevelSystem}
        onAddLevel={data.addLevel}
        onRenameLevel={data.renameLevel}
        onDeleteLevel={data.deleteLevel}
        onReorderLevels={data.reorderLevels}
      />
      <EntityTypeManager
        open={view.typeManagerOpen}
        customTypes={entityTypesValue.customTypes}
        usageCountOf={usageCountOf}
        onClose={view.closeTypeManager}
        onAdd={handleAddCustomType}
        onRename={handleRenameCustomType}
        onRemove={handleRemoveCustomType}
      />
      </div>
    </EntityTypesProvider>
  );
}
