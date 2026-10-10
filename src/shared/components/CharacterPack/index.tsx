import { useEffect, useRef } from "react";
import type { ComponentType } from "react";
import PackHeader from "./components/PackHeader";
import PackToast from "./components/PackToast";
import CloseGuardModal from "./components/CloseGuardModal";
import EffectEditor from "./components/EffectEditor";
import SummaryModule from "./components/SummaryModule";
import AttributesModule from "./components/AttributesModule";
import EquipmentModule from "./components/EquipmentModule";
import InventoryModule from "./components/InventoryModule";
import SkillsModule from "./components/SkillsModule";
import RealmModule from "./components/RealmModule";
import CurrencyModule from "./components/CurrencyModule";
import StatusModule from "./components/StatusModule";
import NoteModule from "./components/NoteModule";
import ModuleManager from "./components/ModuleManager";
import UnitSystemManager from "./components/UnitSystemManager";
import SlotManager from "./components/SlotManager";
import RecordDrawer from "./components/RecordDrawer";
import SourceDetailDrawer from "./components/SourceDetailDrawer";
import { usePackPanel, type PackPanelApi } from "./hooks/usePackPanel";
import { downloadText } from "./services/pack-export";
import type { PackModuleKey } from "./types";
import "./index.scss";

interface CharacterPackHostProps {
  workId: string;
  chapterId: string;
  onClose: () => void;
}

type ModuleView = ComponentType<{ api: PackPanelApi }>;

const MODULE_VIEWS: Record<PackModuleKey, ModuleView> = {
  summary: SummaryModule,
  attributes: AttributesModule,
  equipment: EquipmentModule,
  inventory: InventoryModule,
  skills: SkillsModule,
  realm: RealmModule,
  currency: CurrencyModule,
  status: StatusModule,
  note: NoteModule,
};

/**
 * 行囊面板宿主（唯一入口）
 *
 * 整个功能只吃 `workId / chapterId / onClose` 三个入参，其余全部自持 ——
 * 数据装载、草稿、保存、界面偏好都在 `usePackPanel` 里收口。
 *
 * 行囊已独立成专属窗口（PackWindow）：本组件铺满整个窗口内容区，
 * 不再有内嵌面板时代的拖宽 / 浮层降级 / 速览形态。
 */
export default function CharacterPackHost({
  workId,
  chapterId,
  onClose,
}: CharacterPackHostProps) {
  const api = usePackPanel({ workId, chapterId, open: true, onClose });

  // 事件监听里要读最新 api，但监听不能每次渲染都重挂 —— 用 effect 同步 ref
  // （渲染期写 ref 会破坏并发渲染下的可预测性，必须放 effect 里）
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  // Esc 关闭。输入框内按 Esc 一律放行（IME / 改名场景）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const current = apiRef.current;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        // 输入框内放行，让按键继续到达 target（antd 的输入控件自己要处理 Esc）。
        return;
      }
      // 闸门弹窗自己吃掉 Esc：等价于三选一里的「取消」（那件事不继续做）。
      if (current.guardOpen) {
        event.stopPropagation();
        event.preventDefault();
        current.guardCancel();
        return;
      }
      const anyModalOpen =
        Boolean(current.editingOwner) ||
        current.moduleManagerOpen ||
        current.unitManagerOpen ||
        current.slotManagerOpen ||
        current.recordDrawerOpen ||
        Boolean(current.detailAttrId);
      if (anyModalOpen) return;
      event.stopPropagation();
      event.preventDefault();
      void current.requestClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const doc = api.doc;

  /** 保存失败时的逃生出口：把内存里这份改动整份落盘（G-4） */
  const handleExportDraft = async (): Promise<void> => {
    const path = await downloadText(
      `行囊-${doc?.character.name || "主角"}-草稿.json`,
      api.exportDraftJson(),
      "json",
      "JSON",
    );
    if (path) api.showToast(`草稿已导出：${path}`);
    else api.showToast("已取消导出", "info");
  };

  return (
    <aside className="cpk" aria-label="行囊">
      <PackHeader
        characterName={doc?.character.name ?? "主角"}
        realmText={api.realmText}
        realmHint={api.realmHint}
        dirty={api.dirty}
        saving={api.saving}
        saveFailed={api.saveFailed}
        savedAt={api.savedAt}
        breathe={Boolean(api.dirtyHint.breathe)}
        changedCount={api.changedCount}
        onMarkAllRead={api.markAllChangesRead}
        onRename={api.renameCharacter}
        onSave={() => void api.save("手动保存")}
        onRevertAll={() => void api.revertAll()}
        onExportDraft={() => void handleExportDraft()}
        onOpenModules={() => api.setModuleManagerOpen(true)}
        onOpenUnitManager={() => api.setUnitManagerOpen(true)}
        onOpenRecords={() => api.setRecordDrawerOpen(true)}
        onClose={() => void api.requestClose()}
      />

      <div className="cpk__body">
        {api.loading ? (
          <div className="cpk__loading">
            <span className="cpk__spinner" />
            正在装载行囊…
          </div>
        ) : api.loadError ? (
          <p className="cpk__error">{api.loadError}</p>
        ) : !doc ? (
          <p className="cpk-empty">这本书还没有行囊数据。</p>
        ) : api.enabledModules.length === 0 ? (
          <p className="cpk-empty">
            所有模块都被关掉了。点右上角的齿轮重新打开需要的模块。
          </p>
        ) : (
          api.enabledModules.map((module) => {
            const View = MODULE_VIEWS[module.key];
            return <View key={module.key} api={api} />;
          })
        )}
      </div>

      <PackToast toast={api.toast} />

      {api.editingOwner && doc ? (
        <EffectEditor
          open
          ownerTitle={api.editingOwner.title}
          modifiers={api.modifiersOf(api.editingOwner.ownerType, api.editingOwner.ownerId)}
          attributes={doc.attributes}
          editingId={api.editingModifierId}
          onSelect={(id) =>
            api.openEffectEditor(
              api.editingOwner!.ownerType,
              api.editingOwner!.ownerId,
              api.editingOwner!.title,
              id ?? undefined,
            )
          }
          onAdd={(nature) =>
            api.addModifier(api.editingOwner!.ownerType, api.editingOwner!.ownerId, nature)
          }
          onUpdate={api.updateModifier}
          onRemove={api.removeModifier}
          onClose={api.closeEffectEditor}
        />
      ) : null}

      <ModuleManager api={api} />
      <UnitSystemManager api={api} />
      <SlotManager api={api} />
      <RecordDrawer api={api} />
      <SourceDetailDrawer api={api} />

      <CloseGuardModal
        open={api.guardOpen}
        dirty={api.dirty}
        saving={api.saving}
        reason={api.guardReason}
        onSaveAndProceed={() => void api.guardSaveAndProceed()}
        onDiscardAndProceed={() => void api.guardDiscardAndProceed()}
        onCancel={api.guardCancel}
      />
    </aside>
  );
}
