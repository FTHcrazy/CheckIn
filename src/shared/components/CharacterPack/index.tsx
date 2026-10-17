import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Button } from "antd";
import HelpCenter from "@/shared/components/HelpCenter";
import { NOVEL_HELP_DOC } from "@/shared/novel/guide-doc";
import PackHeader from "./components/PackHeader";
import PackToast from "./components/PackToast";
import CloseGuardModal from "./components/CloseGuardModal";
import EffectEditor from "./components/EffectEditor";
import PackDashboard from "./components/PackDashboard";
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
import CategoryManager from "./components/CategoryManager";
import RecordDrawer from "./components/RecordDrawer";
import SourceDetailDrawer from "./components/SourceDetailDrawer";
import { PackModuleSummaryContext } from "./components/module-summary-context";
import { usePackPanel, type PackPanelApi } from "./hooks/usePackPanel";
import { useElementWidth } from "./hooks/useElementWidth";
import { downloadText } from "./services/pack-export";
import { packWidthTier, isCorePackModule } from "./pack-config";
import { subLabelAt } from "./pack-utils";
import {
  PACK_ZONE_LABEL,
  PACK_ZONE_OF,
  activeZones,
  disabledModuleCount,
  isAutoCollapsed,
  missingZoneOf,
  moduleScrollDelta,
  moduleSummary,
  panelModuleCount,
  splitByZone,
  zonePanels,
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
 * （`prefs.collapsed`）、默认渐进披露策略（UI-04：非核心模块未表态默认收起）、
 * 以及钉选常驻。若每个模块自己调 `isAutoCollapsed`，规则一改就要改十处，
 * 且十个模块都得知道「当前窗口多宽」这件与它们无关的事。
 *
 * 这里用一层 api 代理把「(模块键, 档位, 偏好) → 是否折叠」收敛到唯一入口：
 * 模块照旧读 `api.prefs.collapsed[key]`，只是读到的是**算过的值**。
 *
 * ⚠️ `toggleModuleCollapsed` 必须**按生效值翻转**，不能按 `prefs.collapsed[key]`
 * 翻转：UI-04 之后未表态的非核心模块生效值是 `true`，而 `prefs.collapsed[key]`
 * 还是 `undefined` —— 用 `!undefined` 翻出来仍是 `true`，表现为「点了展不开」。
 * 所以这里把 toggle 换成一个绑定生效值的版本：`!collapsed`。
 */
function withEffectiveCollapse(
  api: PackPanelApi,
  key: PackModuleKey,
  tier: "wide" | "mid" | "narrow",
): PackPanelApi {
  const collapsed = isAutoCollapsed(key, tier, api.prefs.collapsed, api.prefs.pinned);
  const toggleCollapsed = () => api.setModuleCollapsed(key, !collapsed);
  // 生效值与作者偏好已经一致时，仍要换掉 toggle（模块读到的 collapsed 对，
  // 但 toggle 的翻转基准必须用生效值）；只在真的没差别时复用原 api 省一次分配。
  if (Boolean(api.prefs.collapsed[key]) === collapsed) {
    return { ...api, toggleModuleCollapsed: toggleCollapsed };
  }
  return {
    ...api,
    toggleModuleCollapsed: toggleCollapsed,
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
  /** 帮助中心开合（L3 常驻入口）：行囊窗口没有 Tour，故不传 onReplayGuide */
  const [helpOpen, setHelpOpen] = useState(false);
  /** 看板 C 区「展开全部」（UI-01）：只影响看板展示条数，不改任何数据 */
  const [attrsExpanded, setAttrsExpanded] = useState(false);

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

  /**
   * 每个模块的**生效折叠态**（含默认策略 / 钉选，见 `isAutoCollapsed`）。
   *
   * 看板 E 区的箭头与「展开」判定都读它，而不是读 `api.prefs.collapsed` ——
   * 后者只是作者显式偏好，未表态的非核心模块在默认策略下其实已折叠（UI-04）。
   * 与 `withEffectiveCollapse` 用同一条纯函数，避免两处口径分叉。
   */
  const effectiveCollapsed = useMemo(() => {
    const map: Partial<Record<PackModuleKey, boolean>> = {};
    for (const module of api.enabledModules) {
      map[module.key] = isAutoCollapsed(
        module.key,
        tier,
        api.prefs.collapsed,
        api.prefs.pinned,
      );
    }
    return map;
  }, [api.enabledModules, api.prefs.collapsed, api.prefs.pinned, tier]);

  /** 已展开（生效态为「不折叠」）的模块集合：看板摘要行据此显示箭头方向 */
  const expandedKeys = useMemo(
    () =>
      new Set(
        api.enabledModules
          .filter((module) => !effectiveCollapsed[module.key])
          .map((module) => module.key),
      ),
    [api.enabledModules, effectiveCollapsed],
  );

  /**
   * 把 L1 里的某个模块滚进可视区。
   *
   * 看板在上、编辑器在下：点摘要行若只改状态，变化会落在视口之外 —— 用户手点了、
   * 画面没动，就会以为按钮坏了（实测报障）。展开之后把目标模块滚到顶，变化就在眼前。
   * 目标已完整可见时 `moduleScrollDelta` 返回 `null`，这里一像素都不动。
   */
  const scrollToModule = (key: PackModuleKey) => {
    const body = bodyRef.current;
    if (!body) return;
    const node = body.querySelector<HTMLElement>(`[data-pack-module="${key}"]`);
    if (!node) return;
    const delta = moduleScrollDelta(
      node.getBoundingClientRect(),
      body.getBoundingClientRect(),
    );
    if (delta === null) return;
    // jsdom 不实现元素级滚动（测试环境），退回直接赋 scrollTop 而不是抛错
    if (typeof body.scrollTo === "function") {
      body.scrollTo({ top: body.scrollTop + delta, behavior: "smooth" });
    } else {
      body.scrollTop += delta;
    }
  };

  /**
   * 看板摘要行 / 境界卡入口：**导航**语义，不是翻转折叠。
   *
   * 「确保这个模块是展开的，并把我带到它那儿」：
   * - 收起态 → 按生效值展开（与 `withEffectiveCollapse` 同规则写
   *   `prefs.collapsed[key] = false`，作者显式表态过就长期保留）；
   * - 已展开 → 不收起，只滚动定位。
   *
   * 收起为什么不在看板上做：从看板「远程收起」一个视口外的模块，画面同样没有
   * 反馈，等于把「点了没反应」换个方向再犯一次。收起留给 L1 模块壳自己的折叠
   * 按钮 —— 那儿松手就能看到内容收起来。
   */
  const openModuleFromBoard = (key: PackModuleKey) => {
    if (effectiveCollapsed[key]) api.setModuleCollapsed(key, false);
    scrollToModule(key);
  };

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

  /**
   * 宽档的**分区面板**（UI-08）。
   *
   * 面板 = 栏头（分区名 + 模块数）+ 栏目（卡片流），整块撑满概览带以下的高度：
   * - 双分区都在 → 两块面板（左数值与状态 / 右装备类），44:56 走 `.cpk__zones`；
   * - 只剩一个分区 → **一块**面板占满整条量尺，内部再拆两栏（`soloColumns`），
   *   别让下半场缩成一条窄带；
   * - 对面分区被关掉时，引导卡落在最后一个栏目的末尾（`missingZone`）。
   *
   * 编排规则全在 `zonePanels` 这个纯函数里，组件只照着 `columns` 铺 DOM。
   */
  const panels = useMemo(() => zonePanels(zoneModules), [zoneModules]);

  /** 栏脚提示用的「还没开启几个模块」（纯减法，见 pack-layout） */
  const disabledCount = disabledModuleCount(api.enabledModules);

  /**
   * 渲染单个模块。代理只在该模块的生效折叠态与作者偏好不同时才新建对象。
   *
   * 外壳经 context 投下三件事：窄档摘要、钉选态、钉选开关。核心三块不参与
   * 钉选（它们永远展开，钉了对作者没有意义），故 `onTogglePin` 传 undefined。
   *
   * 外面那层 `.cpk__module` 只挂 `data-pack-module` 锚点：看板点摘要行后要
   * 把对应模块滚进可视区（见 `scrollToModule`），靠它定位。它是一层纯定位用的
   * 透明块，不改版式。
   */
  const renderModule = (module: PackModuleState) => {
    const View = MODULE_VIEWS[module.key];
    const scopedApi = withEffectiveCollapse(api, module.key, tier);
    const core = isCorePackModule(module.key);
    return (
      <div
        key={module.key}
        className="cpk__module"
        data-pack-module={module.key}
      >
        <PackModuleSummaryContext.Provider
          value={{
            summary: tier === "narrow" ? moduleSummary(module.key, doc) : "",
            pinned: api.prefs.pinned.includes(module.key),
            onTogglePin: core ? undefined : () => api.toggleModulePinned(module.key),
          }}
        >
          <View api={scopedApi} />
        </PackModuleSummaryContext.Provider>
      </div>
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
        onOpenHelp={() => setHelpOpen(true)}
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
        ) : (
          <>
            {/*
              统一内容量尺：看板与 L1 模块区共用同一个居中容器（`max-width`
              见 index.scss）。超宽窗口下两级内容左右边界必须落在同一处，
              否则上半铺满整窗、下半缩在中间，「割裂」就是这么来的。
            */}
            <div className="cpk__content">
              {/* ── L0 看板（UI-01）：一屏看懂主角当前状态 ── */}
              <PackDashboard
                api={api}
                tier={tier}
                attrsExpanded={attrsExpanded}
                onToggleAttrs={() => setAttrsExpanded((value) => !value)}
                onExpandModule={openModuleFromBoard}
                expandedKeys={expandedKeys}
              />

              {/* ── L1 编辑器区：十个模块（摘要行 / 就地展开）── */}
              {isWide ? (
                /*
                  宽档（UI-08）：概览带以下是**工作区**，由一块或两块面板铺成。
                  面板 = 栏头（这块是哪儿 + 几块模块）+ 栏目（卡片流），
                  两者共同撑到窗口底部，页脚贴底收口 —— 窗口再高也不会像
                  「只加载了一半」。

                  只剩一个分区时不再退化成通栏窄带：仍是一块面板（占满整条量尺），
                  内部由 `zonePanels` 拆成两栏继续走同一套栏目结构。
                */
                <div
                  className={`cpk__zones${panels.length === 1 ? " cpk__zones--single" : ""}`}
                >
                  {panels.map((panel, panelIndex) => (
                    <section
                      key={panel.key}
                      className={`cpk__zone cpk__zone--${panel.zone}${
                        panel.columns.length > 1 ? " cpk__zone--split" : ""
                      }`}
                      aria-label={PACK_ZONE_LABEL[panel.zone]}
                    >
                      <header className="cpk__zonehead">
                        <h3 className="cpk__zonetitle">{PACK_ZONE_LABEL[panel.zone]}</h3>
                        <span className="cpk__zonecount">
                          {panelModuleCount(panel)} 个模块
                        </span>
                      </header>
                      <div className="cpk__zonestack">
                        {panel.columns.map((column, columnIndex) => (
                          <div
                            className="cpk__zonecol"
                            key={`${panel.key}-${columnIndex}`}
                          >
                            {column.map(renderModule)}
                            {/*
                              对面分区被整体关掉时，引导卡落在最后一个栏目的末尾
                              —— 位置正好是它本该在的地方，作者才知道行囊还能开更多模块。
                            */}
                            {missingZone &&
                            panelIndex === panels.length - 1 &&
                            columnIndex === panel.columns.length - 1 ? (
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
                                  {PACK_MODULES.filter(
                                    (m) => PACK_ZONE_OF[m.key] === missingZone,
                                  )
                                    .map((m) => m.label)
                                    .join(" / ")}
                                  ，点这里在「模块管理」里按需开启。
                                </span>
                              </Button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                /* 中 / 窄档：单栏纵向流；窄档下次要模块由 isAutoCollapsed 折叠成标题行 */
                <div className="cpk__flow">{api.enabledModules.map(renderModule)}</div>
              )}

              {/*
                页脚（仅宽档）：把内容区**收口到窗口底部**。
                没有它，内容短的时候整页浮在上半屏，窗口下半截是一整片空底 ——
                真机截图里就是「像没加载完」。它不是导航（导航在头部与概览带），
                只报两个事实：草稿是即存的、模块开了几个。
              */}
              {isWide ? (
                <footer className="cpk__workfoot">
                  <span>改动即存草稿 · 关窗前会提醒保存</span>
                  <span className="cpk__workfoot-count">
                    已启用 {api.enabledModules.length} / {PACK_MODULES.length} 个模块
                    {disabledCount > 0 ? ` · 还有 ${disabledCount} 个可开` : ""}
                  </span>
                </footer>
              ) : null}
            </div>
          </>
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

      <HelpCenter
        open={helpOpen}
        doc={NOVEL_HELP_DOC}
        onClose={() => setHelpOpen(false)}
      />
    </aside>
  );
}
