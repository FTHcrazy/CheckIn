/**
 * 设定中心
 *
 * 一部作品的全部等级序列（境界体系 / 功法等级 / 丹药稀有度…）都在这里维护。
 * 境界体系只是 `kind='realm'` 的那一个分类，与自定义分类共用同一套编辑能力。
 *
 * 交互取舍（与设计稿一致）：
 * - 行尾三个常驻图标在七行同屏时太吵 → 收成一个「⋯」菜单，行间悬停出插入条
 * - 拆分 / 合并只在「⋯」里，因为它们一年用不了几次，但需要说清后果
 *
 * UI-10 拆分：原 1494 行单体按功能切为
 * - 左栏分类列表 CategoryList（UI-05 常识化分组与说明也落在这里）
 * - 分类卡 CategoryCard（分类头 / 说明 / 进位规则条）
 * - 等级序列 LevelSequence（可排序阶梯行 / 行间插入条 / 状态条）
 * - 顶部工具头 SettingPanelHead、四个弹窗各自的子组件
 * 状态机与全部提交动作收进 hooks/useSettingCenter。父组件只做组合，
 * **对外 props / 导出方式 / 回调时机完全不变**。
 */

import { closestCenter, DndContext } from "@dnd-kit/core";
import { SaveOutlined } from "@ant-design/icons";
import { Button, Empty, Modal } from "antd";
import { EMPTY_CTA_COPY } from "@/shared/novel/guide-copy";
import BatchGenerateModal from "./components/BatchGenerateModal";
import CategoryCard from "./components/CategoryCard";
import CategoryList from "./components/CategoryList";
import LevelSequence from "./components/LevelSequence";
import SaveTemplateModal from "./components/SaveTemplateModal";
import SettingPanelHead from "./components/SettingPanelHead";
import SplitLevelModal from "./components/SplitLevelModal";
import TemplateLibraryModal from "./components/TemplateLibraryModal";
import { useSettingCenter } from "./hooks/useSettingCenter";
import type { SettingCenterProps } from "./setting-center-shared";
import "./index.scss";

export default function SettingCenter(props: SettingCenterProps) {
  const c = useSettingCenter(props);

  return (
    <Modal
      className="nv-sc"
      classNames={{ body: "nv-sc__body" }}
      open={props.open}
      onCancel={props.onClose}
      footer={null}
      width={1180}
      style={{ maxWidth: "calc(100vw - 48px)" }}
      title={
        <div className="nv-sc__title">
          <span>设定中心</span>
          <span className="nv-sc__pill">{props.workName}</span>
        </div>
      }
      destroyOnHidden
    >
      <SettingPanelHead
        active={c.active}
        onOpenLibrary={c.openLibrary}
        onStartSaveTemplate={c.openSaveTemplate}
        onExport={props.onExport}
        onPatchCategory={props.onPatchCategory}
      />

      <DndContext
        sensors={c.sensors}
        collisionDetection={closestCenter}
        onDragStart={c.handleDragStart}
        onDragOver={c.handleDragOver}
        onDragEnd={c.handleDragEnd}
        onDragCancel={c.handleDragCancel}
      >
        <div className="nv-sc__body-grid">
          <CategoryList
            categories={c.sorted}
            activeId={c.activeIdResolved}
            dragId={c.dragId}
            newCategoryName={c.newCategoryName}
            onNewCategoryNameChange={c.setNewCategoryName}
            onSelect={c.setActiveId}
            onCreate={c.handleCreateCategory}
          />

          <section className="nv-sc__main">
            {!c.active ? (
              <Empty
                className="nv-sc__empty"
                description="先新建一个设定分类"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                {/* E-02 空态引导卡：空态必须给「下一步动作」，不只描述困境。
                    直达模板库而不是直接灌某条预设——让作者自己挑，避免误建一堆体系 */}
                <Button size="small" onClick={c.openLibrary}>
                  <SaveOutlined />
                  {EMPTY_CTA_COPY.settingEmpty}
                </Button>
              </Empty>
            ) : (
              <>
                <CategoryCard
                  active={c.active}
                  carryExample={c.carryExample}
                  categoryDraft={c.categoryDraft}
                  onStartEdit={c.startEditCategory}
                  onCloseDraft={c.closeCategoryDraft}
                  onSubmitDraft={c.submitCategoryDraft}
                  onDraftChange={c.setCategoryDraft}
                  onPatchCategory={props.onPatchCategory}
                  onDeleteCategory={props.onDeleteCategory}
                />

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
                  onMergeLevel={props.onMergeLevel}
                  onDeleteLevel={props.onDeleteLevel}
                />
              </>
            )}
          </section>
        </div>
      </DndContext>

      <SaveTemplateModal
        open={Boolean(c.templateDraft)}
        name={c.templateName}
        onNameChange={c.setTemplateName}
        onSubmit={c.submitSaveTemplate}
        onCancel={c.closeSaveTemplate}
      />

      <TemplateLibraryModal
        open={c.libraryOpen}
        templates={props.templates}
        onApplyPreset={c.applyPreset}
        onApplyTemplate={c.applyTemplate}
        onDeleteTemplate={props.onDeleteTemplate}
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
    </Modal>
  );
}
