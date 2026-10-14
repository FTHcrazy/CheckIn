import { useEffect, useMemo, useRef } from "react";
import type { ComponentType } from "react";
import { Button } from "antd";
import PackHeader from "./components/PackHeader";
import PackToast from "./components/PackToast";
import CloseGuardModal from "./components/CloseGuardModal";
import EffectEditor from "./components/EffectEditor";
import SummaryModule from "./components/SummaryModule";
import AttributesModule from "./components/AttributesModule";
import MappingModule from "./components/MappingModule";
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
import GroupManager from "./components/GroupManager";
import CategoryManager from "./components/CategoryManager";
import RecordDrawer from "./components/RecordDrawer";
import SourceDetailDrawer from "./components/SourceDetailDrawer";
import { PackModuleSummaryContext } from "./components/module-summary-context";
import { usePackPanel, type PackPanelApi } from "./hooks/usePackPanel";
import { useElementWidth } from "./hooks/useElementWidth";
import { downloadText } from "./services/pack-export";
import { packWidthTier } from "./pack-config";
import { subLabelAt } from "./pack-utils";
import {
  PACK_ZONE_LABEL,
  PACK_ZONE_OF,
  activeZones,
  isAutoCollapsed,
  missingZoneOf,
  moduleSummary,
  splitByZone,
  type PackZone,
} from "./pack-layout";
import { PACK_MODULES, type PackModuleKey, type PackModuleState } from "./types";
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
  mapping: MappingModule,
  equipment: EquipmentModule,
  inventory: InventoryModule,
  skills: SkillsModule,
  realm: RealmModule,
  currency: CurrencyModule,
  status: StatusModule,
  note: NoteModule,
};

/**
 * 给模块视图包一层「生效折叠态」。
 *
 * 为什么不让十个模块各自去算：折叠真值现在有两个来源 —— 作者的显式偏好
 * （`prefs.collapsed`）与窗口宽度（窄档下未表态的次要模块自动折叠）。若每个
 * 模块自己调 `isAutoCollapsed`，规则一改就要改十处，且十个模块都得知道
 * 「当前窗口多宽」这件与它们无关的事。
 *
 * 这里用一层 api 代理把「(模块键, 档位) → 是否折叠」收敛到唯一入口：
 * 模块照旧读 `api.prefs.collapsed[key]`，只是读到的是**算过的值**；
 * `toggleModuleCollapsed` 也照旧写 `prefs`，于是作者一点，「自动折叠」
 * 就被显式偏好接管（规则 2 生效）—— 与 `isAutoCollapsed` 的注释完全对应。
 */
function withEffectiveCollapse(
  api: PackPanelApi,
  key: PackModuleKey,
  tier: "wide" | "mid" | "narrow",
): PackPanelApi {
  const collapsed = isAutoCollapsed(key, tier, api.prefs.collapsed);
  if (Boolean(api.prefs.collapsed[key]) === collapsed) return api;
  return {
    ...api,
    prefs: { ...api.prefs, collapsed: { ...api.prefs.collapsed, [key]: collapsed } },
  };
}

/**
 * 行囊面板宿主（唯一入口）
 *
 * 整个功能只吃 `workId / chapterId / onClose` 三个入参，其余全部自持 ——
 * 数据装载、草稿、保存、界面偏好都在 `usePackPanel` 里收口。
 *
 * 行囊已独立成专属窗口（PackWindow）：本组件铺满整个窗口内容区，
 * 不再有内嵌面板时代的拖宽 / 浮层降级 / 速览形态。
 *
 * 布局是「分区仪表盘」：宽档按语义双栏并排，中档单栏纵向流，窄档把次要
 * 六模块自动折叠成带摘要的标题行、核心三块（汇总 / 属性 / 境界）照常展开。
 * 分档与折叠规则全在 `pack-layout.ts` 的纯函数里，这里只负责量宽度与铺 DOM。
 */
export default function CharacterPackHost({
  workId,
  chapterId,
  onClose,
}: CharacterPackHostProps) {
  const api = usePackPanel({ workId, chapterId, open: true, onClose });
  const { ref: bodyRef, width: contentWidth } = useElementWidth<HTMLDivElement>();

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
        current.groupManagerOpen ||
        current.categoryManagerOpen ||
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

  /**
   * 当前小层别名（1.41.0）：头部此前只显示「合体 2/4」，与境界模块的
   * 「合体 2/4 · 中期」不同口径 —— 同源数据两处读数不一致，是历史报障的
   * 同款观感问题（「实体面板显示」对照条的教训：要么都显示，要么都不显示）。
   */
  const realmSubText = useMemo(() => {
    const rung = api.rungs[api.realmPos.index];
    return rung ? subLabelAt(rung, api.realmPos.sub) : "";
  }, [api.rungs, api.realmPos.index, api.realmPos.sub]);

  /**
   * 档位。`contentWidth` 未测出（0，如 jsdom 或不支持 ResizeObserver 的宿主）
   * 时按最保守的窄档走 —— 宁可折叠得比需要多，也不要排成双栏挤成一团。
   */
  const tier = packWidthTier(contentWidth);
  const isWide = tier === "wide";

  const zoneModules = useMemo(
    () => splitByZone(api.enabledModules),
    [api.enabledModules],
  );

  /**
   * 宽档下实际要渲染的分区与被整体关掉的对面栏（渲染规则见 pack-layout）。
   */
  const wideZones = useMemo(
    () => activeZones(zoneModules),
    [zoneModules],
  );
  const missingZone: PackZone | null = missingZoneOf(wideZones);

  /** 渲染单个模块。代理只在该模块的生效折叠态与作者偏好不同时才新建对象。 */
  const renderModule = (module: PackModuleState) => {
    const View = MODULE_VIEWS[module.key];
    const scopedApi = withEffectiveCollapse(api, module.key, tier);
    return (
      <PackModuleSummaryContext.Provider
        key={module.key}
        value={tier === "narrow" ? moduleSummary(module.key, doc) : ""}
      >
        <View api={scopedApi} />
      </PackModuleSummaryContext.Provider>
    );
  };

  /** 保存失败时的逃生出口：把内存里这份改动整份落盘（G-4） */
  const handleExportDraft = async (): Promise<void> => {
    const path = await downloadText(
      `行囊-${doc?.character.displayName || doc?.character.name || "主角"}-草稿.json`,
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
        /*
          绑定了主角实体就显示实体名（主进程已解析进 displayName），
          未绑定时回退到行囊内的名字。见 PackCharacterDTO.displayName。
        */
        characterName={doc?.character.displayName || doc?.character.name || "主角"}
        realmText={api.realmText}
        realmSubText={realmSubText}
        realmHint={api.realmHint}
        realmBound={api.realmBound}
        compact={tier === "narrow"}
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
      />

      <div
        className={`cpk__body cpk__body--${tier}`}
        ref={bodyRef}
        data-tier={tier}
      >
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
        ) : isWide ? (
          /*
            宽档：按语义双栏。左「装备类」/ 右「数值与状态」——
            两栏各自独立滚动区会抢滚轮，所以仍共用外层这一条滚动条，
            两栏只是并排的网格轨道（高度由内容决定，短的那栏自然留白）。
          */
          <div
            className={`cpk__zones${wideZones.length === 1 ? " cpk__zones--solo" : ""}`}
          >
            {wideZones.map((zone) => (
              <section
                key={zone}
                className={`cpk__zone cpk__zone--${zone}`}
                aria-label={PACK_ZONE_LABEL[zone]}
              >
                {/*
                  单分区时眉标是噪音（整个内容区就是这一栏），只在双栏时出；
                  对面栏被整体关掉时补一张引导卡，作者才知道行囊还能开更多模块。
                */}
                {wideZones.length > 1 ? (
                  <h3 className="cpk__zonetitle">{PACK_ZONE_LABEL[zone]}</h3>
                ) : null}
                <div className="cpk__zonestack">
                  {zoneModules[zone].map(renderModule)}
                </div>
              </section>
            ))}
            {missingZone ? (
              <Button
                type="dashed"
                block
                className="cpk__zoneghost"
                onClick={() => api.setModuleManagerOpen(true)}
              >
                <span className="cpk__zoneghost-line cpk__zoneghost-line--title">
                  {PACK_ZONE_LABEL[missingZone]}模块都还没开
                </span>
                <span className="cpk__zoneghost-line">
                  {PACK_MODULES.filter((m) => PACK_ZONE_OF[m.key] === missingZone)
                    .map((m) => m.label)
                    .join(" / ")}
                  ，点这里在「模块管理」里按需开启。
                </span>
              </Button>
            ) : null}
          </div>
        ) : (
          /* 中 / 窄档：单栏纵向流；窄档下次要模块由 isAutoCollapsed 折叠成标题行 */
          <div className="cpk__flow">{api.enabledModules.map(renderModule)}</div>
        )}
      </div>

      <PackToast toast={api.toast} />

      {api.editingOwner && doc ? (
        <EffectEditor
          open
          ownerTitle={api.editingOwner.title}
          modifiers={api.modifiersOf(api.editingOwner.ownerType, api.editingOwner.ownerId)}
          attributes={api.attrView}
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
          proficiencyAlias={
            api.editingOwner.ownerType === "skill"
              ? api.schemeForSkill(
                  doc.skills.find((skill) => skill.id === api.editingOwner!.ownerId)?.groupId ?? "",
                ).meta.alias
              : undefined
          }
        />
      ) : null}

      <ModuleManager api={api} />
      <UnitSystemManager api={api} />
      <SlotManager api={api} />
      <GroupManager api={api} />
      <CategoryManager api={api} />
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
