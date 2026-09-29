import { useEffect, useRef, useState } from "react";
import type { ComponentType, PointerEvent as ReactPointerEvent } from "react";
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
import { PACK_PANEL } from "./pack-config";
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
 * 数据装载、草稿、保存、界面偏好都在 `usePackPanel` 里收口。未来要把它搬到
 * 独立窗口，只需在新窗口入口渲染同一个组件、把 `onClose` 换成 `window.close`，
 * 这里与其下的任何文件都不需要改动。
 *
 * 形态（§8.2）：默认「右侧让位」—— 作为正文之外的 flex 兄弟项存在，编辑器被
 * 压缩重排而不是被盖住；窗口不够宽时降级为全屏浮层。
 */
export default function CharacterPackHost({
  workId,
  chapterId,
  onClose,
}: CharacterPackHostProps) {
  const api = usePackPanel({ workId, chapterId, open: true, onClose });
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

  // 事件监听里要读最新 api，但监听不能每次渲染都重挂 —— 用 effect 同步 ref
  // （渲染期写 ref 会破坏并发渲染下的可预测性，必须放 effect 里）
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  // Esc 关闭：用捕获阶段，保证在「专注模式」等页面级 Esc 之前处理，
  // 避免一次 Esc 同时触发两件事。输入框内按 Esc 一律放行（IME / 改名场景）。
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
        return;
      }
      const anyModalOpen =
        Boolean(current.editingOwner) ||
        current.moduleManagerOpen ||
        current.unitManagerOpen ||
        current.slotManagerOpen ||
        current.recordDrawerOpen ||
        Boolean(current.detailAttrId) ||
        current.closeGuardOpen;
      if (anyModalOpen) return;
      event.stopPropagation();
      event.preventDefault();
      void current.requestClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // 窄窗降级：把「右侧让位」换成全屏浮层 + 遮罩，否则正文会被挤到不可用
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── 宽度拖拽（左边缘；越界即夹取，记忆走即改即存的 prefs） ──
  const onGripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: api.prefs.width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state) return;
    const next = Math.min(
      PACK_PANEL.maxWidth,
      Math.max(PACK_PANEL.minWidth, state.startWidth - (event.clientX - state.startX)),
    );
    api.patchPrefs({ width: Math.round(next) });
  };

  const onGripUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const overlay = api.prefs.form === "overlay" || windowWidth < PACK_PANEL.overlayBelow;
  const doc = api.doc;

  return (
    <>
      {overlay ? (
        <div
          className="cpk-backdrop"
          role="presentation"
          onClick={() => void api.requestClose()}
        />
      ) : null}
      <aside
        className={`cpk${overlay ? " is-overlay" : ""}`}
        style={overlay ? undefined : { width: api.prefs.width }}
        aria-label="行囊"
      >
      {!overlay ? (
        <div
          className="cpk__grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整行囊宽度"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onDoubleClick={() => api.patchPrefs({ width: PACK_PANEL.defaultWidth })}
        />
      ) : null}

      <PackHeader
        characterName={doc?.character.name ?? "主角"}
        realmText={api.realmText}
        realmHint={api.realmHint}
        dirty={api.dirty}
        saving={api.saving}
        saveFailed={api.saveFailed}
        savedAt={api.savedAt}
        breathe={Boolean(api.dirtyHint.breathe)}
        onRename={api.renameCharacter}
        onSave={() => void api.save("手动保存")}
        onRevertAll={() => void api.revertAll()}
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
        open={api.closeGuardOpen}
        dirty={api.dirty}
        saving={api.saving}
        onSaveAndClose={() => void api.confirmSaveAndClose()}
        onDiscardAndClose={() => void api.confirmDiscardAndClose()}
        onCancel={api.cancelClose}
      />
    </aside>
    </>
  );
}
