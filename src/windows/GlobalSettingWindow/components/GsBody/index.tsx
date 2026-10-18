/**
 * 全局设定中心 · 主体（窗口私有外壳，方案 A⁺）
 *
 * 状态机**仍**是 shared 的 `useSettingCenter`（与书本侧同一份），本组件只换外壳：
 * - 左栏换成窗口私有的 `GsCategorySidebar`（搜索 / 筛选 / 排序 / 引用徽标 /
 *   双击改名 / 右键菜单），shared 的 `CategoryList` 不再渲染；
 * - 右栏在原样复用 `CategoryCard` + `LevelSequence` 的基础上，把影响面
 *   （`GsImpactBar`）与分类头合并进同一张 `gs-hero` 卡，空库时给 `GsEmptyGuide`；
 * - 顶部工具头换成 `GsToolbar`（shared 的 `SettingPanelHead` 不再渲染 —— 它把
 *   本书域的「另存为模板」挂在动作区，全局库没有该能力）。
 *
 * 三条最容易漏的事（漏了就是假入口 / 静默失效）：
 * 1. **三个弹窗必须挂齐**：`TemplateLibraryModal`（`showTemplates={false}`）/
 *    `BatchGenerateModal` / `SplitLevelModal`。漏挂 ⇒「模板库 / 批量生成 /
 *    新增子层级」点了没反应。**不挂** `SaveTemplateModal` / `GlobalCategoryPicker`
 *    / 上架冲突 Modal（全局域无此能力，挂了就是僵尸入口）。
 * 2. **`DndContext` 必须同时包住左右两栏**：等级行拖到左栏分类上做跨分类搬移，
 *    靠 `cat:` 前缀的 sortable 兼作 droppable；sortable id 一律用 shared 的
 *    `catId()` / `lvlId()`，**禁止自拼**（`handleDragEnd` 按前缀分流）。
 * 3. **`open` 必须传常量 `true`**：`useSettingCenter` 里有个「`open` 为 falsy 时
 *    清空全部草稿」的 effect（`useSettingCenter.ts:318-342`），整窗形态绝不能触发。
 */

import { useCallback, useRef, useState } from "react";
import { closestCenter, DndContext } from "@dnd-kit/core";
import type { InputRef } from "antd";
import CategoryCard from "@/shared/components/SettingCenter/components/CategoryCard";
import LevelSequence from "@/shared/components/SettingCenter/components/LevelSequence";
import BatchGenerateModal from "@/shared/components/SettingCenter/components/BatchGenerateModal";
import SplitLevelModal from "@/shared/components/SettingCenter/components/SplitLevelModal";
import TemplateLibraryModal from "@/shared/components/SettingCenter/components/TemplateLibraryModal";
import { useSettingCenter } from "@/shared/components/SettingCenter/hooks/useSettingCenter";
import type { GlobalSettingController } from "../../hooks/useGlobalSetting";
import { impactTierOf } from "../../hooks/gs-view-utils";
import { useGlobalSettingView } from "../../hooks/useGlobalSettingView";
import { useGlobalSettingRefs } from "../../hooks/useGlobalSettingRefs";
import { useGsShortcuts, type GsShortcutHandlers } from "../../hooks/useGsShortcuts";
import GsToolbar from "../GsToolbar";
import GsCategorySidebar from "../GsCategorySidebar";
import GsImpactBar from "../GsImpactBar";
import GsEmptyGuide from "../GsEmptyGuide";
import GsLevelBatchBar from "../GsLevelBatchBar";
import GsRefsDrawer from "../GsRefsDrawer";
import "./index.scss";

export interface GsBodyProps {
  data: GlobalSettingController;
}

/**
 * `onClose` 是 `SettingCenterProps` 的必填项，但整窗形态下**不生效** ——
 * 关窗只走窗口三键（本窗口是设定编辑器，行内编辑到一半被 Esc 连窗收掉会丢草稿）。
 * 模块级常量：身份恒定，不会让 `useSettingCenter` 的重渲染白白多跑一轮。
 */
const NOOP_CLOSE = (): void => {};

export default function GsBody({ data }: GsBodyProps) {
  const c = useSettingCenter({
    open: true, // ⚠️ 常量 true：见文件头第 3 条
    workName: "跨书共享",
    source: "global",
    settings: data.settings,
    focusCategoryId: null,
    onClose: NOOP_CLOSE,
    onCreateCategory: data.onCreateCategory,
    onPatchCategory: data.onPatchCategory,
    onDeleteCategory: data.onDeleteCategory,
    onReorderCategories: data.onReorderCategories,
    onAddLevel: data.onAddLevel,
    onBatchAddLevels: data.onBatchAddLevels,
    onPatchLevel: data.onPatchLevel,
    onDeleteLevel: data.onDeleteLevel,
    onReorderLevels: data.onReorderLevels,
    onSplitLevel: data.onSplitLevel,
    onMergeLevel: data.onMergeLevel,
    onExport: data.onExport,
    onApplyPreset: data.onApplyPreset,
    // 模板能力 5 props 一律不传（全局域不提供，N-04）
  });

  const newCategoryInputRef = useRef<InputRef | null>(null);
  const searchInputRef = useRef<InputRef | null>(null);
  const [refsDrawerOpen, setRefsDrawerOpen] = useState(false);
  const refsState = useGlobalSettingRefs();

  const renameCategory = useCallback(
    (categoryId: string, name: string): void => {
      data.onPatchCategory(categoryId, { name });
    },
    [data.onPatchCategory],
  );

  const view = useGlobalSettingView({
    categories: c.sorted,
    activeId: c.activeIdResolved,
    onSelect: c.setActiveId,
    onRename: renameCategory,
  });
  const { selectedLevelIds, clearLevelSelection } = view;
  /** 选中分类的 id（派生自 c，避免在闭包里对 `c.active` 做非空断言） */
  const activeCategoryId = c.activeIdResolved;

  const focusNewCategory = useCallback((): void => {
    newCategoryInputRef.current?.focus();
  }, []);

  /** R12：打开引用方名单抽屉（入口在 `refCount === 0` 时不渲染） */
  const openRefs = useCallback(
    (categoryId: string): void => {
      setRefsDrawerOpen(true);
      refsState.open(categoryId);
    },
    [refsState],
  );

  const closeRefs = useCallback((): void => {
    setRefsDrawerOpen(false);
    refsState.close();
  }, [refsState]);

  /**
   * R10 批量删除：**串行**执行，避免两条并发的重排互相覆盖。
   *
   * ⚠️ 偏差说明：`data.onDeleteLevel` 内部自带一次 `reload()`（写后重载是本项目
   * 的既有纪律，且 `useGlobalSetting.ts` 本次禁止改动），所以 N 条会带回 N 次
   * 整表重载，做不到「全部结束后只 reload 一次」。串行是能做到的部分，已做。
   */
  const deleteSelectedLevels = useCallback((): void => {
    // 按勾选顺序逐条下发：两条并发的重排会互相覆盖，必须一条走完再下一条
    for (const levelId of selectedLevelIds) {
      data.onDeleteLevel(levelId);
    }
    clearLevelSelection();
  }, [data.onDeleteLevel, selectedLevelIds, clearLevelSelection]);

  /**
   * Esc 级联（Q-C5）：① 行内改名 → ② 等级行编辑 → ③ 行间插入 → ④ 清空搜索。
   */
  const handleEscape = useCallback((): void => {
    if (view.renamingId) {
      view.cancelRename();
      return;
    }
    if (c.editingLevelId) {
      c.endEditLevel();
      return;
    }
    if (c.insertAt !== null) {
      c.cancelInsert();
      return;
    }
    if (view.keyword) view.clearKeyword();
  }, [
    view.renamingId,
    view.cancelRename,
    view.keyword,
    view.clearKeyword,
    c.editingLevelId,
    c.endEditLevel,
    c.insertAt,
    c.cancelInsert,
  ]);

  const handleRenameShortcut = useCallback((): void => {
    if (activeCategoryId) view.beginRename(activeCategoryId);
  }, [activeCategoryId, view.beginRename]);

  const handleDeleteShortcut = useCallback((): void => {
    if (activeCategoryId) data.onDeleteCategory(activeCategoryId);
  }, [activeCategoryId, data.onDeleteCategory]);

  const handleFocusSearch = useCallback((): void => {
    const native = searchInputRef.current?.input;
    if (!native) return;
    native.focus();
    native.select();
  }, []);

  const handlers: GsShortcutHandlers = {
    onFocusSearch: handleFocusSearch,
    onMove: view.moveSelection,
    onRename: handleRenameShortcut,
    onDelete: handleDeleteShortcut,
    onEscape: handleEscape,
  };
  useGsShortcuts(handlers, true);

  const activeRefCount = c.active?.refCount ?? 0;

  return (
    <div className="gs-shell">
      <GsToolbar
        active={c.active}
        onOpenLibrary={c.openLibrary}
        onFocusNewCategory={focusNewCategory}
        onExport={(format) => data.onExport(activeCategoryId, format)}
        onUnsetRealm={() => {
          if (activeCategoryId) data.onPatchCategory(activeCategoryId, { kind: "custom" });
        }}
        batchSelecting={view.batchSelecting}
        onToggleBatchSelecting={() => {
          view.setBatchSelecting(!view.batchSelecting);
          view.clearLevelSelection();
        }}
      />

      <DndContext
        sensors={c.sensors}
        collisionDetection={closestCenter}
        onDragStart={c.handleDragStart}
        onDragOver={c.handleDragOver}
        onDragEnd={c.handleDragEnd}
        onDragCancel={c.handleDragCancel}
      >
        <div className="gs-body">
          <GsCategorySidebar
            categories={view.visible}
            total={c.sorted.length}
            activeId={c.activeIdResolved}
            view={view}
            canDrag={view.canDrag}
            dragId={c.dragId}
            newCategoryName={c.newCategoryName}
            onNewCategoryNameChange={c.setNewCategoryName}
            onCreate={c.handleCreateCategory}
            onSelect={c.setActiveId}
            onRename={renameCategory}
            onDelete={data.onDeleteCategory}
            onToggleKind={(id) => {
              const target = c.sorted.find((item) => item.id === id);
              if (target) data.onPatchCategory(id, { kind: target.kind === "realm" ? "custom" : "realm" });
            }}
            inputRef={newCategoryInputRef}
            searchRef={searchInputRef}
          />

          <section className="gs-main">
            {!c.active ? (
              <GsEmptyGuide
                onApplyPreset={c.openLibrary}
                onFocusNewCategory={focusNewCategory}
              />
            ) : (
              <>
                {/* 影响面与分类头合住一张卡（.gs-hero）：两者说的是同一件事，
                    拆成「灰条 + 卡」会让右栏碎成两块。 */}
                <div className="gs-hero">
                  <GsImpactBar
                    refCount={activeRefCount}
                    tier={impactTierOf(activeRefCount)}
                    onOpenRefs={() => openRefs(activeCategoryId)}
                  />

                  <CategoryCard
                    active={c.active}
                    carryExample={c.carryExample}
                    categoryDraft={c.categoryDraft}
                    onStartEdit={c.startEditCategory}
                    onCloseDraft={c.closeCategoryDraft}
                    onSubmitDraft={c.submitCategoryDraft}
                    onDraftChange={c.setCategoryDraft}
                    onPatchCategory={data.onPatchCategory}
                    onDeleteCategory={data.onDeleteCategory}
                    isGlobal={c.isGlobal}
                    referenced={c.referenced}
                    detachedHint={c.detachedHint}
                  />
                </div>

                {view.batchSelecting && selectedLevelIds.length > 0 && (
                  <GsLevelBatchBar
                    count={selectedLevelIds.length}
                    onDeleteSelected={deleteSelectedLevels}
                    onClear={clearLevelSelection}
                  />
                )}

                <LevelSequence
                  active={c.active}
                  orderedLevels={c.orderedLevels}
                  editingLevelId={c.editingLevelId}
                  levelDraft={c.levelDraft}
                  onLevelDraftChange={c.setLevelDraft}
                  onBeginEditLevel={c.beginEditLevel}
                  onEndEditLevel={c.endEditLevel}
                  onSubmitLevelDraft={c.submitLevelDraft}
                  insertAt={c.insertAt}
                  insertName={c.insertName}
                  onInsertNameChange={c.setInsertName}
                  onBeginInsert={c.beginInsert}
                  onCancelInsert={c.cancelInsert}
                  onSubmitInsert={c.submitInsert}
                  appendIndex={c.appendIndex}
                  newLevelName={c.newLevelName}
                  onNewLevelNameChange={c.setNewLevelName}
                  onSubmitAppend={c.submitAppend}
                  dragId={c.dragId}
                  dropIndex={c.dropIndex}
                  subLevelTotal={c.subLevelTotal}
                  onOpenBatch={c.openBatch}
                  onStartSplit={c.startSplit}
                  onMergeLevel={data.onMergeLevel}
                  onDeleteLevel={data.onDeleteLevel}
                  referenced={c.referenced}
                  selectable={view.batchSelecting}
                  selectedIds={selectedLevelIds}
                  onToggleSelect={view.toggleLevelSelected}
                />
              </>
            )}
          </section>
        </div>
      </DndContext>

      {/* ── 三个弹窗：漏挂 = 点了没反应（见文件头第 1 条） ── */}

      {/* 模板库：全局域只提供「内置预设」（onApplyPreset 必填，纯本地能力），
          模板能力（另存为模板 / 我的模板）不提供 ⇒ showTemplates={false}，
          模板能力 3 props 一律不传（N-04：不传，而不是传空实现） */}
      <TemplateLibraryModal
        open={c.libraryOpen}
        showTemplates={false}
        isGlobal={c.isGlobal}
        onApplyPreset={c.applyPreset}
        onCancel={c.closeLibrary}
      />

      <BatchGenerateModal
        open={c.batchOpen}
        mode={c.batchMode}
        onModeChange={c.setBatchMode}
        lines={c.batchLines}
        onLinesChange={c.setBatchLines}
        count={c.batchCount}
        onCountChange={c.setBatchCount}
        pattern={c.batchPattern}
        onPatternChange={c.setBatchPattern}
        names={c.batchNames}
        onSubmit={c.submitBatch}
        onCancel={c.closeBatch}
      />

      <SplitLevelModal
        open={Boolean(c.splitTarget)}
        targetName={c.splitTarget?.name ?? ""}
        parts={c.splitParts}
        onPartsChange={c.setSplitParts}
        pattern={c.splitPattern}
        onPatternChange={c.setSplitPattern}
        preview={c.splitPreview}
        onSubmit={c.submitSplit}
        onCancel={c.closeSplit}
      />

      <GsRefsDrawer
        open={refsDrawerOpen}
        categoryName={c.active?.name ?? ""}
        refCount={activeRefCount}
        refs={refsState.refs}
        loading={refsState.loading}
        error={refsState.error}
        onClose={closeRefs}
        onRetry={refsState.retry}
      />
    </div>
  );
}
