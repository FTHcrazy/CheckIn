import { useCallback, useEffect, useMemo } from "react";
import ChapterJumpPalette from "./components/ChapterJumpPalette";
import ChapterTree from "./components/ChapterTree";
import EditorPane from "./components/EditorPane";
import HoverEntityCard from "./components/HoverEntityCard";
import NovelToast from "./components/NovelToast";
import NovelTopBar from "./components/NovelTopBar";
import RestoreBanner from "./components/RestoreBanner";
import SelectionToolbar from "./components/SelectionToolbar";
import SettingsDrawer from "./components/SettingsDrawer";
import SnapshotDrawer from "./components/SnapshotDrawer";
import StatusBar from "./components/StatusBar";
import SupportPanel from "./components/SupportPanel";
import { useNovelPage } from "./hooks/useNovelPage";
import { findTermMatches } from "./novel-utils";
import type { EntityType } from "./types";
import "./index.scss";

/** 悬浮资料卡触底翻转阈值（px） */
const POP_FLIP_THRESHOLD = 220;

/**
 * 小说编辑器主页面（W1）
 *
 * 只负责编排：把三个 Hook 暴露的状态接到对应的私有组件上。
 * 容器管辖范围对应设计方案 §03 的 W1 / D1 / D2 / O1 / O2 / O3 / P1。
 */
export default function NovelPage() {
  const {
    data,
    editor,
    view,
    hover,
    terms,
    breadcrumb,
    handleNewChapter,
    handleSelectChapter,
    handleRollback,
    handleMark,
    handleOpenEntity,
    handleRestoreRecovery,
  } = useNovelPage();

  const { loadSnapshots, activeChapterId, searchBook } = data;

  // 快照抽屉按需加载：打开时才查该章的版本时间线
  useEffect(() => {
    if (!view.snapshotOpen || !activeChapterId) return;
    void loadSnapshots(activeChapterId);
  }, [view.snapshotOpen, activeChapterId, loadSnapshots]);

  const hoverEntity = useMemo(
    () => (hover.target ? data.getEntityById(hover.target.entityId) : null),
    [hover.target, data],
  );

  const getAppearances = useCallback(
    (entityId: string) => {
      const owned = terms.filter((term) => term.entityId === entityId);
      if (owned.length === 0) return [];
      return data.chapters
        .filter(
          (chapter) => findTermMatches(chapter.content, owned).length > 0,
        )
        .map((chapter) => chapter.title);
    },
    [terms, data.chapters],
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

  const handleExportCard = useCallback(() => {
    if (!detailEntity) return;
    view.showToast(`已导出「${detailEntity.name}」设定卡`, "info");
  }, [detailEntity, view]);

  const handleSearch = useCallback(
    (keyword: string) => searchBook(keyword),
    [searchBook],
  );

  const handleMarkSelection = useCallback(
    (type: EntityType) => handleMark(type),
    [handleMark],
  );

  return (
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
          volumeName={breadcrumb.volumeName}
          chapterName={breadcrumb.chapterName}
          saveState={editor.saveState}
          lastSavedAt={editor.lastSavedAt}
          leftOpen={view.leftOpen}
          rightOpen={view.rightOpen}
          typewriter={view.typewriter}
          settingsOpen={view.settingsOpen}
          onSelectWork={data.setActiveWorkId}
          onToggleLeft={view.toggleLeft}
          onToggleRight={view.toggleRight}
          onToggleTypewriter={view.toggleTypewriter}
          onToggleSettings={view.toggleSettings}
          onOpenHistory={view.openSnapshot}
        />
      </div>

      <div className="nv-page__body">
        <ChapterTree
          collapsed={!view.leftOpen}
          groups={data.groups}
          chapterNumbers={data.chapterNumbers}
          activeChapterId={data.activeChapterId}
          onSelect={handleSelectChapter}
          onCreate={handleNewChapter}
          onMove={data.moveChapter}
          onReorderChapter={data.reorderChapters}
          onMoveChapterToVolume={data.moveChapterToVolume}
          onReorderVolume={data.reorderVolumes}
        />

        <div className="nv-page__stage">
          <EditorPane
            chapter={data.activeChapter}
            chapterNumber={
              data.activeChapterId
                ? (data.chapterNumbers.get(data.activeChapterId) ?? 0)
                : 0
            }
            content={editor.content}
            settings={editor.settings}
            terms={terms}
            typewriter={view.typewriter}
            onChange={editor.handleContentChange}
            onSelectionChange={editor.setSelection}
            onTermHover={hover.enter}
            onTermLeave={hover.leave}
            onTermClick={handleOpenEntity}
            onCreateChapter={handleNewChapter}
            onRenameChapter={data.renameChapter}
          />

          <StatusBar stats={editor.stats} />

          {editor.selection && (
            <SelectionToolbar
              x={editor.selection.x}
              y={editor.selection.y}
              text={editor.selection.text}
              onMark={handleMarkSelection}
            />
          )}

          {hover.target && hoverEntity && (
            <HoverEntityCard
              target={hover.target}
              entity={hoverEntity}
              flip={hover.target.y > POP_FLIP_THRESHOLD}
              onOpenDetail={handleOpenEntity}
            />
          )}

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
        </div>

        <SupportPanel
          open={view.rightOpen}
          activeTab={view.panelTab}
          onTabChange={view.selectPanelTab}
          outline={data.outline}
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
          onAddNote={data.addNote}
          onRemoveNote={data.removeNote}
          onSearch={handleSearch}
          onSelectChapter={handleSelectChapter}
          highlighted={detailHighlighted}
          onToggleHighlight={handleToggleHighlight}
          onExportCard={handleExportCard}
        />
      </div>
    </div>
  );
}
