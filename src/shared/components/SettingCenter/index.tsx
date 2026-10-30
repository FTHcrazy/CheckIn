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
 *
 * 1.45.1（N-04）：模板能力改为**显式可选**。5 个模板 props（templates /
 * onSaveTemplate / onRefreshTemplates / onApplyTemplate / onDeleteTemplate）
 * 任缺其一即视为「本形态不提供模板能力」，据此收掉「另存为模板」入口、
 * SaveTemplateModal 与弹窗内「我的模板」区块 —— 此前全局窗口传空实现、组件却
 * 无条件渲染，入口点了没反应属假承诺。
 * ⚠️ 「模板库」入口与空态 CTA **不受**此判据：库内「内置预设」是纯本地能力
 * （onApplyPreset 必填），任何形态都能用，误把模板库一起门控会删掉可用功能。
 */

import { closestCenter, DndContext } from "@dnd-kit/core";
import { SaveOutlined } from "@ant-design/icons";
import { Button, Empty, Modal } from "antd";
import { EMPTY_CTA_COPY } from "@/shared/novel/guide-copy";
import { SETTING_PUBLISH_CONFLICT_HINT } from "@/shared/novel/setting-reference";
import BatchGenerateModal from "./components/BatchGenerateModal";
import AiLevelGenModal from "./components/AiLevelGenModal";
import CategoryCard from "./components/CategoryCard";
import CategoryList from "./components/CategoryList";
import GlobalCategoryPicker from "./components/GlobalCategoryPicker";
import LevelSequence from "./components/LevelSequence";
import SaveTemplateModal from "./components/SaveTemplateModal";
import SettingPanelHead from "./components/SettingPanelHead";
import SplitLevelModal from "./components/SplitLevelModal";
import TemplateLibraryModal from "./components/TemplateLibraryModal";
import { useSettingCenter } from "./hooks/useSettingCenter";
import { useAiLevelGen } from "./hooks/useAiLevelGen";
import type { SettingCenterProps } from "./setting-center-shared";
import "./index.scss";

export default function SettingCenter(props: SettingCenterProps) {
  const c = useSettingCenter(props);

  /**
   * AI 排阶梯（R-AI-18）：写在既有批量追加通道上（`onBatchAddLevels`），
   * 不新增写路径。作品题材由调用方传（本书域有，全局库没有）。
   */
  const aiGen = useAiLevelGen({
    categories: props.settings,
    workName: props.workName,
    genre: props.workGenre,
    onBatchAddLevels: props.onBatchAddLevels,
    onNotify: props.onNotify,
  });

  /**
   * 模板能力是否齐备（N-04）。
   *
   * 5 个模板 props 全给了才算「本形态提供模板能力」；任缺其一 ⇒ 不提供。
   * 它只管**模板能力**（模板 IPC 绑 workId，属本书域）：动作区「另存为模板」
   * 入口、SaveTemplateModal、模板库弹窗里的「我的模板」区块看它。
   *
   * ⚠️ 与**预设能力**分开：模板库里的「内置预设」是纯本地能力
   * （`SETTING_PRESETS` 直接 import，`onApplyPreset` 是必填 prop），
   * 任何形态都有 —— 所以「模板库」入口、空态 CTA、TemplateLibraryModal
   * 都恒渲染，不看这个判据。
   */
  const hasTemplateCapability =
    props.templates !== undefined &&
    props.onSaveTemplate !== undefined &&
    props.onRefreshTemplates !== undefined &&
    props.onApplyTemplate !== undefined &&
    props.onDeleteTemplate !== undefined;

  /**
   * 主体内容：两种外壳**共用同一份**，差异只在「外面套不套 Modal」。
   * 拆成变量而不是复制一份 JSX —— 复制的话标题 / 空态 / 四个弹窗会在
   * 两条形态里各自漂移，改一处漏一处（本仓已吃过这类亏）。
   */
  const content = (
    <>
      <SettingPanelHead
        active={c.active}
        isGlobal={c.isGlobal}
        hasTemplateCapability={hasTemplateCapability}
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
            isGlobal={c.isGlobal}
            onOpenGlobalPicker={
              props.onReferenceGlobal ? c.openPicker : undefined
            }
          />

          <section className="nv-sc__main">
            {!c.active ? (
              <Empty
                className="nv-sc__empty"
                description="先新建一个设定分类"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                {/* E-02 空态引导卡：空态必须给「下一步动作」，不只描述困境。
                    直达模板库而不是直接灌某条预设——让作者自己挑，避免误建一堆体系。
                    ⚠️ 恒渲染：模板库打开后至少「内置预设」可用（onApplyPreset 必填），
                    与 hasTemplateCapability（只管「另存为模板」）无关（N-04）。 */}
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
                  isGlobal={c.isGlobal}
                  referenced={c.referenced}
                  detachedHint={c.detachedHint}
                  onPublishGlobal={
                    props.onPublishGlobal ? c.submitPublish : undefined
                  }
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
                  // AI 被关掉 / 本版本没有通道 → 不传，卡头不出现死按钮（M8 门控）
                  onOpenAiGen={
                    aiGen.hidden
                      ? undefined
                      : () => {
                          if (c.active) aiGen.openDialog(c.active);
                        }
                  }
                  onStartSplit={c.startSplit}
                  onMergeLevel={props.onMergeLevel}
                  onDeleteLevel={props.onDeleteLevel}
                  referenced={c.referenced}
                />
              </>
            )}
          </section>
        </div>
      </DndContext>

      {/* SaveTemplateModal 只由被门控的「另存为模板」入口打开
          （`c.templateDraft` 也只可能由它产生）⇒ 整块按 hasTemplateCapability 门控。
          antd Modal 走 portal 挂到 body，这里不渲染就连 portal 都不会出现。 */}
      {hasTemplateCapability && (
        <SaveTemplateModal
          open={Boolean(c.templateDraft)}
          name={c.templateName}
          onNameChange={c.setTemplateName}
          onSubmit={c.submitSaveTemplate}
          onCancel={c.closeSaveTemplate}
        />
      )}

      {/* 模板库弹窗恒渲染：预设能力恒有（onApplyPreset 必填），与模板能力无关；
          `showTemplates` 决定弹窗内「我的模板」区块是否出现。
          模板能力 3 props 在 TemplateLibraryModal 里是**可选**的：无模板能力时
          调用方**不传**（而非传空实现）—— showTemplates=false ⇒ 该区块不渲染，
          这三个 prop 也不会被读到（N-04）。 */}
      <TemplateLibraryModal
        open={c.libraryOpen}
        showTemplates={hasTemplateCapability}
        isGlobal={c.isGlobal}
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

      {/* AI 排阶梯：与「批量生成」共用同一写入通道，只是候选由模型产出（R-AI-18） */}
      <AiLevelGenModal
        open={aiGen.dialogOpen}
        categoryName={aiGen.categoryName}
        session={aiGen.session}
        mode={aiGen.mode}
        onModeChange={aiGen.setMode}
        countText={aiGen.countText}
        onCountChange={aiGen.setCountText}
        count={aiGen.count}
        pickedCount={aiGen.pickedCount}
        generateBlockedReason={aiGen.generateBlockedReason}
        unavailableText={aiGen.unavailableText}
        onRun={aiGen.run}
        onToggle={aiGen.toggle}
        onApply={aiGen.apply}
        onClose={aiGen.close}
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

      {/* D2：从全局库选择（多选建立引用）。只在本书域出现 ——
          全局库自己没有「引用别的全局」的概念 */}
      {props.onReferenceGlobal && (
        <GlobalCategoryPicker
          open={c.pickerOpen}
          categories={c.globalCategories}
          pickedIds={c.pickedGlobalIds}
          bookHasRealm={c.bookHasRealm}
          onToggle={c.togglePickedGlobal}
          onSubmit={c.submitReference}
          onCancel={c.closePicker}
        />
      )}

      {/* D3：上架命中同名分类 → 二次确认，默认「新建为副本」（不替换同名） */}
      <Modal
        open={c.publishConflictId !== null}
        title="全局库已有同名设定"
        okText="新建为副本"
        cancelText="取消"
        onOk={c.confirmPublishDuplicate}
        onCancel={c.cancelPublishConflict}
      >
        <p className="nv-sc__tip">{SETTING_PUBLISH_CONFLICT_HINT}</p>
      </Modal>
    </>
  );

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
          <span>{c.isGlobal ? "全局设定中心" : "设定中心"}</span>
          <span className="nv-sc__pill">{c.isGlobal ? "跨书共享" : props.workName}</span>
        </div>
      }
      destroyOnHidden
    >
      {content}
    </Modal>
  );
}
