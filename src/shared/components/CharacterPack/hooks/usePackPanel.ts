import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createNovelId, logUsageEvent } from "@/shared/services/novel-shared";
import {
  DEFAULT_LAYOUTS,
  QTY_MAX,
  registerPackCloser,
  registerPackGuard,
  registerPackQuickAdd,
  type PackGuardReason,
  type PackQuickAddRequest,
} from "../pack-config";
import {
  getPanelRealm,
  getRealm,
  setRealm,
  UNBOUND_REALM_HINT,
  type RealmState,
} from "../pack-realm";
import {
  buildActiveCarriersFrom,
  buildPackMarkdown,
  capacityStatus,
  carrierKey,
  computeHypotheticalSummary,
  computeSummary,
  countRecentChanges,
  formatRealm,
  hasRecentChange,
  normalizeLimit,
  sortLadder,
  stepQty,
  summaryDeltas,
  weightStatus,
  type HypotheticalInput,
  type LadderRung,
  type PackExportContext,
  type PackExportKey,
  type RealmPosition,
  type SummaryDelta,
  type SummaryResult,
  type ThresholdLevel,
} from "../pack-utils";
import {
  applyPreset,
  buildPresetPayload,
  describeApply,
  parsePresetPayload,
  readPreset,
  serializePresetPayload,
  type ApplyPresetResult,
  type PresetReadout,
} from "../pack-presets";
import {
  fetchPackUiPrefsRaw,
  savePackUiPrefsRaw,
  writeLevelMeta,
  writeProtagonistBinding,
} from "../services/pack-service";
import {
  ATTR_TEMPLATES,
  DEFAULT_ATTR_GROUP,
  DEFAULT_UI_PREFS,
  NATURE_META,
  PACK_MODULES,
  type EstimateEntry,
  type PackAttribute,
  type PackItem,
  type PackLayout,
  type PackModuleKey,
  type PackModuleState,
  type PackModifier,
  type PackPreset,
  type PackRecord,
  type PackSkill,
  type PackSlot,
  type PackUiPrefs,
  type PackUnitSystem,
} from "../types";
import { CURRENCY_TEMPLATE, PACK_PANEL } from "../pack-config";
import {
  notifyProtagonistChanged,
  PACK_PROTAGONIST_EVENT,
  PACK_REALM_EVENT,
  readEventDetail,
  type PackProtagonistEventDetail,
  type PackRealmEventDetail,
} from "../pack-config";
import { usePackData, type PackDoc } from "./usePackData";
import {
  onCloseRequest,
  respondCloseRequest,
  setCloseGuardEnabled,
} from "../services/pack-close-guard";
import { AUTOSAVE_IDLE_MS, DIRTY_BREATHE_AT } from "../types";

export interface PackToastState {
  id: number;
  text: string;
  tone: "success" | "info" | "warning" | "error";
}

type ToastTone = PackToastState["tone"];

interface UsePackPanelOptions {
  workId: string;
  chapterId: string;
  open: boolean;
  onClose: () => void;
}

function mergeLayouts(layouts: PackLayout[]): PackModuleState[] {
  const known = new Map(layouts.map((layout) => [layout.moduleKey, layout]));
  return PACK_MODULES.map((module, index) => {
    const stored = known.get(module.key);
    return {
      key: module.key,
      enabled: stored?.enabled ?? true,
      sortOrder: stored?.sortOrder ?? (index + 1) * 10,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

/**
 * 效果词条改动 → 它的宿主（装备 / 技能）也算改动（REQ-028 变动角标）。
 *
 * 不传播的话，「改了这件装备上的加成」在物品栏那行没有任何标记，而角标存在的
 * 意义正是回答「我刚才动了哪些东西」。状态效果没有宿主行（它自己就是载体），
 * 返回原名。
 */
function carrierOfModifier(
  current: PackDoc,
  modifierId: string,
): { ownerType: PackModifier["ownerType"]; ownerId: string } | null {
  const mod = current.modifiers.find((item) => item.id === modifierId);
  if (!mod || mod.ownerType === "status") return null;
  return { ownerType: mod.ownerType, ownerId: mod.ownerId };
}

/** 把宿主的 `updatedAt` 推到当前时刻；非装备 / 技能宿主原样返回 */
function touchCarrier(
  current: PackDoc,
  carrier: { ownerType: PackModifier["ownerType"]; ownerId: string } | null,
): PackDoc {
  if (!carrier) return current;
  const now = Date.now();
  if (carrier.ownerType === "item") {
    return {
      ...current,
      items: current.items.map((item) =>
        item.id === carrier.ownerId ? { ...item, updatedAt: now } : item,
      ),
    };
  }
  if (carrier.ownerType === "skill") {
    return {
      ...current,
      skills: current.skills.map((skill) =>
        skill.id === carrier.ownerId ? { ...skill, updatedAt: now } : skill,
      ),
    };
  }
  return current;
}

function parsePrefs(raw: string | null): Partial<PackUiPrefs> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<PackUiPrefs>) : {};
  } catch {
    return {};
  }
}

/**
 * 行囊面板层：视图状态 + 全部业务动作 + 派生数据
 *
 * 所有编辑都收束在这里，组件只做渲染与事件转发 —— 未来把整个模块
 * 迁到独立窗口时，只需换一个入口渲染 <CharacterPackHost>，本文件零改动。
 */
export function usePackPanel({ workId, chapterId, open, onClose }: UsePackPanelOptions) {
  const data = usePackData(workId, chapterId);
  // syncMeta 只经 dataRef 转发（事件回调里读最新的那一份），不在依赖里出现
  const { doc, meta, mutate } = data;

  /**
   * 文档镜像。
   *
   * 事件订阅（另一个入口改了同一格数据）需要在回调里读「当前」文档，
   * 但把它写进 effect 依赖会让监听器每改一个字就重新注册一次。
   */
  const docRef = useRef<PackDoc | null>(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  /**
   * `data` 的镜像（与 docRef 同理）。
   *
   * ⚠️ `usePackData` 每次渲染都返回一个**新对象**，把它直接放进 effect 依赖，
   * effect 就会在每次渲染时重跑：定时器被反复清掉重建、事件监听被反复解绑重挂。
   * 需要「读最新数据但不触发重注册」的地方一律走这两个 ref。
   */
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const saveRef = useRef(data.save);
  useEffect(() => {
    saveRef.current = data.save;
  }, [data.save]);

  // ── 界面偏好（即改即存） ──
  const [prefs, setPrefs] = useState<PackUiPrefs>(DEFAULT_UI_PREFS);
  const prefsLoadedRef = useRef(false);
  const prefsTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPackUiPrefsRaw()
      .then((raw) => {
        if (cancelled) return;
        setPrefs({ ...DEFAULT_UI_PREFS, ...parsePrefs(raw) });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) prefsLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!prefsLoadedRef.current) return undefined;
    if (prefsTimerRef.current !== null) window.clearTimeout(prefsTimerRef.current);
    prefsTimerRef.current = window.setTimeout(() => {
      prefsTimerRef.current = null;
      void savePackUiPrefsRaw(JSON.stringify(prefs));
    }, PACK_PANEL.debounceMs);
    return () => {
      if (prefsTimerRef.current !== null) {
        window.clearTimeout(prefsTimerRef.current);
        prefsTimerRef.current = null;
      }
    };
  }, [prefs]);

  const patchPrefs = useCallback((patch: Partial<PackUiPrefs>) => {
    setPrefs((previous) => ({ ...previous, ...patch }));
  }, []);

  // ── 纯视图状态 ──
  const [toast, setToast] = useState<PackToastState | null>(null);
  const [editingOwner, setEditingOwner] = useState<{
    ownerType: PackModifier["ownerType"];
    ownerId: string;
    title: string;
  } | null>(null);
  const [editingModifierId, setEditingModifierId] = useState<string | null>(null);
  const [detailAttrId, setDetailAttrId] = useState<string | null>(null);
  const [moduleManagerOpen, setModuleManagerOpen] = useState(false);
  const [unitManagerOpen, setUnitManagerOpen] = useState(false);
  const [slotManagerOpen, setSlotManagerOpen] = useState(false);
  const [recordDrawerOpen, setRecordDrawerOpen] = useState(false);
  /** 未保存闸门弹窗（关闭窗口 / 退出应用共用同一个） */
  const [guardOpen, setGuardOpen] = useState(false);
  const [guardReason, setGuardReason] = useState<PackGuardReason>("关闭行囊");
  const [inventoryKeyword, setInventoryKeyword] = useState("");
  const [lastEditAt, setLastEditAt] = useState(0);

  const showToast = useCallback((text: string, tone: ToastTone = "success") => {
    setToast({ id: Date.now(), text, tone });
  }, []);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // ── 派生：模块布局、在效载体、汇总 ──
  const modules = useMemo(
    () => (doc ? mergeLayouts(doc.layouts) : []),
    [doc],
  );
  const enabledModules = useMemo(
    () => modules.filter((module) => module.enabled),
    [modules],
  );

  const statusModifiers = useMemo(
    () => (doc ? doc.modifiers.filter((mod) => mod.ownerType === "status") : []),
    [doc],
  );

  const activeCarriers = useMemo(() => {
    if (!doc) return new Set<string>();
    // ⚠️ 组装口径必须与预览共用同一份（`buildActiveCarriersFrom`）：
    // 状态效果的载体键取 **效果自己的 id**，不能取 ownerId —— 所有 status 效果的
    // ownerId 都是同一个角色 id（多态表约定），用它会让全部状态折叠成单个
    // `status:<charId>` 键，于是「全关」时 passive 状态被整条丢弃、
    // 「任一条 sustained 开着」时 passive 的开关彻底失效。
    return buildActiveCarriersFrom({
      slots: doc.slots,
      items: doc.items,
      skills: doc.skills,
      modifiers: doc.modifiers,
    });
  }, [doc]);

  const proficiency = useMemo(() => {
    const map: Record<string, number> = {};
    for (const skill of doc?.skills ?? []) map[skill.id] = skill.proficiencyRaw;
    return map;
  }, [doc]);

  /**
   * 负重与格数（REQ-033 / F-5）
   *
   * 两个口径各算各的：200 株草药占 1 格却可能压垮肩膀。`limit` 为 0 表示不限，
   * 此时 `over` / `full` 恒 false —— 作者没设上限就永远不该看到警告。
   */
  const load = useMemo(() => {
    const items = doc?.items ?? [];
    return {
      weight: weightStatus(items, doc?.character.weightLimit ?? 0),
      capacity: capacityStatus(items, doc?.character.capacityLimit ?? 0),
    };
  }, [doc]);

  const summary: SummaryResult = useMemo(
    () =>
      computeSummary({
        attributes: doc?.attributes ?? [],
        modifiers: doc?.modifiers ?? [],
        activeCarriers,
        proficiency,
      }),
    [doc, activeCarriers, proficiency],
  );

  // ── 假想输入：一处能力，两条需求（REQ-018 换装预览 / REQ-037 估算模式）──
  const hypotheticalInput: HypotheticalInput = useMemo(
    () => ({
      attributes: doc?.attributes ?? [],
      slots: doc?.slots ?? [],
      items: doc?.items ?? [],
      skills: doc?.skills ?? [],
      modifiers: doc?.modifiers ?? [],
      proficiency,
    }),
    [doc, proficiency],
  );

  /**
   * 换装预览（REQ-018）：把某件未穿戴物品「假设穿上」后的属性变化。
   *
   * 刻意返回 Δ 而不是「装上后的总属性」：作者问的是「换这件值不值」，
   * 给一堆绝对值反而要自己减。非零项才回传，没变的属性不占位。
   */
  const previewEquipDeltas = useCallback(
    (itemId: string, slotId: string): SummaryDelta[] =>
      summaryDeltas(
        summary,
        computeHypotheticalSummary(hypotheticalInput, { equip: { itemId, slotId } }),
      ),
    [summary, hypotheticalInput],
  );

  // ── 估算模式（REQ-037）──
  const [estimateOn, setEstimateOn] = useState(false);
  const [estimateEntries, setEstimateEntries] = useState<EstimateEntry[]>([]);

  /**
   * 临时加成 → 效果词条。
   *
   * 挂成 `status` 型：状态效果「自己就是载体」，无需真的造一件装备 / 一个技能，
   * `active` 恒真才能过闸门 1 与闸门 2 —— 估算的全部意义就是「假设这些现在就生效」。
   * id 加 `est-` 前缀：它**不是**真数据，任何按 id 回查文档的地方都查不到它，
   * 前缀让这类落空一眼可辨（而不是伪装成一条被删掉的效果）。
   */
  const estimateModifiers = useMemo<PackModifier[]>(
    () =>
      estimateEntries.map((entry, index) => ({
        id: `est-${entry.id}`,
        ownerType: "status",
        ownerId: doc?.character.id ?? "",
        nature: "sustained",
        name: "估算",
        targetAttrId: entry.attrId,
        op: entry.op,
        value: entry.value,
        valueUnit: "",
        scaleByProficiency: false,
        active: true,
        defaultOn: false,
        cost: "",
        cooldown: null,
        duration: "",
        roundsLeft: null,
        target: "",
        trigger: "",
        condition: "",
        note: "",
        disabled: false,
        // 排在真实词条之后：override 冲突时估算值要能盖住（否则「估算」被反盖，很反直觉）
        sortOrder: 900000 + index,
      })),
    [estimateEntries, doc],
  );

  /** 估算结果：只在「开关打开 + 至少一条临时加成」时才算，其余情况是 null（不是等于真实值） */
  const estimateSummary = useMemo<SummaryResult | null>(
    () =>
      estimateOn && doc && estimateModifiers.length > 0
        ? computeHypotheticalSummary(hypotheticalInput, { extraModifiers: estimateModifiers })
        : null,
    [estimateOn, doc, estimateModifiers, hypotheticalInput],
  );

  const estimateDeltas = useMemo(
    () => (estimateSummary ? summaryDeltas(summary, estimateSummary) : []),
    [estimateSummary, summary],
  );

  const addEstimate = useCallback(
    (partial: Partial<EstimateEntry> = {}) => {
      setEstimateEntries((current) => [
        ...current,
        {
          id: createNovelId("est"),
          attrId: partial.attrId ?? docRef.current?.attributes[0]?.id ?? "",
          op: partial.op ?? "add",
          value: partial.value ?? 0,
        },
      ]);
    },
    [],
  );

  const updateEstimate = useCallback((id: string, patch: Partial<EstimateEntry>) => {
    setEstimateEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const removeEstimate = useCallback((id: string) => {
    setEstimateEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const clearEstimates = useCallback(() => setEstimateEntries([]), []);

  const moduleOf = useCallback(
    (key: PackModuleKey): PackModuleState | undefined =>
      modules.find((module) => module.key === key),
    [modules],
  );

  // ── 派生：量纲体系（货币 / 熟练度阈值） ──
  const unitSystemOf = useCallback(
    (kind: "currency" | "proficiency"): PackUnitSystem | undefined => {
      const match = (doc?.unitSystems ?? []).find((system) => {
        try {
          const config = JSON.parse(system.config || "{}") as { use?: string };
          return config.use === kind;
        } catch {
          return false;
        }
      });
      return match;
    },
    [doc],
  );

  const currencySystem = unitSystemOf("currency");
  const proficiencySystem = unitSystemOf("proficiency");

  // ── 派生：本章变动角标（REQ-028）──
  //
  // 只对「属性 / 物品 / 技能」三类判定（PRD F-2 的原话就是这三类）：
  // 它们各自有独立的行与字段，`updatedAt` 能准确定位到「这一条变了」。
  // 效果词条没有独立行（挂在宿主行的「效果 N」里），改动会借 `touchCarrier`
  // 记到宿主上，所以这里不需要第四类。
  const changedCount = useMemo(() => {
    if (!doc) return 0;
    return countRecentChanges(
      [...doc.attributes, ...doc.items, ...doc.skills],
      prefs.changedReadAt,
    );
  }, [doc, prefs.changedReadAt]);

  /** 某条目是否「刚改动」（各模块渲染角标用；`updatedAt` 为 0/undefined 时恒 false） */
  const isRecentlyChanged = useCallback(
    (updatedAt: number | undefined): boolean =>
      hasRecentChange(updatedAt, prefs.changedReadAt),
    [prefs.changedReadAt],
  );

  /** 「全部已读」：把底线推到此刻。属于界面偏好（即改即存），不进草稿、不计脏 */
  const markAllChangesRead = useCallback(() => {
    patchPrefs({ changedReadAt: Date.now() });
  }, [patchPrefs]);

  // ── 派生：Markdown 导出（REQ-030）──
  //
  // 组装交给纯函数（`buildPackMarkdown`），这里只负责把散落的派生拼成一份输入。
  // **不在渲染期调用**：`PackExportButton` 只在真正点菜单时才 build 一次。
  const buildModuleMarkdown = useCallback(
    (key: PackExportKey, label: string): string => {
      let proficiencyLevels: ThresholdLevel[] = [];
      try {
        const parsed: unknown = JSON.parse(proficiencySystem?.levels || "[]");
        if (Array.isArray(parsed)) proficiencyLevels = parsed as ThresholdLevel[];
      } catch {
        proficiencyLevels = [];
      }

      let currencyLevels: Array<{ name: string; ratioToBase: number }> = [];
      let currencyAutoCarry = true;
      try {
        const parsed: unknown = JSON.parse(currencySystem?.levels || "[]");
        if (Array.isArray(parsed)) {
          currencyLevels = parsed as Array<{ name: string; ratioToBase: number }>;
        }
        const config = JSON.parse(currencySystem?.config || "{}") as { autoCarry?: boolean };
        currencyAutoCarry = config.autoCarry !== false;
      } catch {
        currencyLevels = [];
      }

      const context: PackExportContext = {
        attributes: doc?.attributes ?? [],
        slots: doc?.slots ?? [],
        items: doc?.items ?? [],
        skills: doc?.skills ?? [],
        modifiers: doc?.modifiers ?? [],
        summary,
        proficiencyLevels,
        currency: currencyLevels.length
          ? { levels: currencyLevels, autoCarry: currencyAutoCarry }
          : null,
      };
      return buildPackMarkdown(key, context, label);
    },
    [doc, summary, proficiencySystem, currencySystem],
  );

  // ── 派生：境界（全部经由口子，禁止直接读字段 REQ-048） ──
  const rungs: LadderRung[] = useMemo(() => {
    const system = meta.levelSystems[0];
    if (!system) return [];
    return sortLadder(
      system.rungs.map((rung) => ({
        id: rung.id,
        name: rung.name,
        rank: rung.rank,
        subLevels: rung.subLevels,
        power: rung.power,
      })),
    );
  }, [meta.levelSystems]);

  const realmState: RealmState = useMemo(
    () => ({
      // 境界随草稿走：显示草稿里的 link（未保存也所见即所得），
      // 草稿没有时回退库内真值（meta.realmLink）
      link: doc?.realmLink ?? meta.realmLink,
      realmRaw: doc?.character.realmAt ?? "",
      rungs,
      bound: Boolean(doc?.character.entityId),
      entityId: doc?.character.entityId ?? "",
    }),
    [meta.realmLink, doc, rungs],
  );

  const realmPos = useMemo(() => getRealm(realmState), [realmState]);
  const panelRealmPos = useMemo(() => getPanelRealm(realmState), [realmState]);
  const realmText = useMemo(() => formatRealm(rungs, realmPos), [rungs, realmPos]);
  const panelRealmText = useMemo(
    () => formatRealm(rungs, panelRealmPos),
    [rungs, panelRealmPos],
  );

  /** 绑定 / 解绑主角实体（§9.7.5：不绑定就不写 novel_links）
   *
   *  与右侧要素栏的「设为主角」写的是**同一格**（`novel_pack_characters.entity_id`），
   *  所以这里不只在内存里改：立即落库 + 广播，否则要素卡的角标要等到保存
   *  才跟上，而保存又会把这一格覆盖回去（两边各持一份 entityId 就是分叉源头）。
   *
   *  因此主角绑定与境界关联一样，属于「跨模块共享的那一份」，即时落库、
   *  不计入未保存改动数、不参与「撤销到上次保存」。 */
  const bindEntity = useCallback(
    async (entityId: string) => {
      const workId = doc?.character.workId ?? "";
      if (!workId) return;
      const ok = await writeProtagonistBinding(workId, entityId);
      if (!ok) {
        showToast("主角绑定失败", "error");
        return;
      }
      mutate((current) => ({
        ...current,
        character: { ...current.character, entityId },
      }));
      notifyProtagonistChanged(workId, entityId);
      await data.syncMeta();
      showToast(
        entityId ? "已设为主角，境界与右侧角色卡同步" : "已取消主角，境界仅在行囊内使用",
        "info",
      );
    },
    [doc, mutate, data, showToast],
  );

  /** 右侧要素栏改了主角：把这一格同步进行囊（不重载文档，避免吃掉未保存的编辑） */
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const detail = readEventDetail<PackProtagonistEventDetail>(args);
      if (!detail || typeof detail !== "object") return;
      if (detail.workId !== workId) return;
      const next = detail.entityId ?? "";
      mutate((current) =>
        current.character.entityId === next
          ? current
          : { ...current, character: { ...current.character, entityId: next } },
      );
      void dataRef.current.syncMeta();
    };
    window.addEventListener(PACK_PROTAGONIST_EVENT, handler as EventListener);
    const api = window.electronAPI?.windowAPI;
    api?.on(PACK_PROTAGONIST_EVENT, handler);
    return () => {
      window.removeEventListener(PACK_PROTAGONIST_EVENT, handler as EventListener);
      api?.off(PACK_PROTAGONIST_EVENT, handler);
    };
  }, [workId, mutate]);

  /**
   * 右侧要素栏改了「当前境界」：这里跟进同一行。
   *
   * 反向由 usePackData.save() 在境界行落库后广播（origin="pack"）。两边都不订阅
   * 对方，就会出现「一边改了、另一边还显示旧值」。
   * 外部改动（origin≠"pack"）用 delta=0 的 mutate 把新 link 写进文档 —— 不计脏、
   * 但会随下次防抖进草稿；这样本次未保存的其它编辑不会把它冲掉，保存时
   * usePackData 也会因与 savedRef 一致而不重复写库。只同步，不重载文档。
   */
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const detail = readEventDetail<PackRealmEventDetail>(args);
      if (!detail || typeof detail !== "object") return;
      if (detail.workId !== workId) return;
      // 自己保存写库的广播已经落文档了，不为自己再走一遍
      if (detail.origin === "pack") return;
      const link = detail.link;
      // 与本人无关的要素（另一本书 / 另一张角色卡）不跟进
      if (link && link.fromId !== docRef.current?.character.entityId) return;
      mutate((current) =>
        JSON.stringify(current.realmLink) === JSON.stringify(link)
          ? current
          : {
              ...current,
              // 事件负载的 note 是可选的，PackDoc 里是定长字段，归一化再进文档
              realmLink: link ? { ...link, note: link.note ?? "" } : null,
            },
      );
      void dataRef.current.syncMeta();
    };
    window.addEventListener(PACK_REALM_EVENT, handler as EventListener);
    const api = window.electronAPI?.windowAPI;
    api?.on(PACK_REALM_EVENT, handler);
    return () => {
      window.removeEventListener(PACK_REALM_EVENT, handler as EventListener);
      api?.off(PACK_REALM_EVENT, handler);
    };
  }, [workId, mutate]);

  /** 等级项补列（小层数 / 战力当量）：改的是 novel_levels，两边共享同一张表 */
  const setRungMeta = useCallback(
    async (rungId: string, patch: { subLevels?: number; power?: number | null }) => {
      const ok = await writeLevelMeta(rungId, patch);
      if (ok) {
        await data.syncMeta();
        showToast("等级体系已更新（实体面板同步生效）", "success");
      } else {
        showToast("等级体系更新失败", "error");
      }
    },
    [data, showToast],
  );

  // ── 自动保存兜底（G-3） ──
  /**
   * 依赖里只放三个**标量**（开关 / 脏计数 / 最后编辑时刻）：
   * 此前依赖里直接放了 `data`，而它是每次渲染的新对象 —— 打字触发的每一次
   * 渲染都会把计时器清掉重建，等于「空闲计时」永远从最后一次渲染起算。
   * 面板里只要有周期渲染（toast 倒计时等），自动保存就再也不会触发。
   */
  useEffect(() => {
    if (!prefs.autoSave || data.dirty <= 0) return undefined;
    const timer = window.setTimeout(() => {
      void saveRef.current("自动保存").then((ok) => {
        if (ok) showToast("已自动保存", "info");
      });
    }, AUTOSAVE_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [prefs.autoSave, data.dirty, lastEditAt, showToast]);

  // ── 未保存闸门（G-2 / REQ-043） ──
  /**
   * 弹窗正在等答复时的 settle 回调。**用 ref 而不是 state**：它是一次性
   * 异步裁决的出口，进 state 会让弹窗每次重渲染都拿不到同一个函数。
   */
  const guardResolveRef = useRef<((allow: boolean) => void) | null>(null);

  /**
   * 唯一的「先处理后行动」入口：关闭面板 / 切章 / 切作品 / 退出应用都经过它。
   *
   * 返回 `true` = 可以继续那件事；`false` = 不能（用户取消，或前一个弹窗没答完）。
   */
  const requestGuard = useCallback(
    async (reason: PackGuardReason): Promise<boolean> => {
      // 已经有一个弹窗在等答复：本次动作直接取消。
      // 不能「新问题顶掉旧问题」—— 旧 Promise 会永远不 settle，
      // 它的调用方（例如切章）就永远停在 await 上，表现为「点章节没反应」。
      if (guardResolveRef.current) return false;
      if (data.dirty <= 0) {
        await data.flushDraft();
        return true;
      }
      return new Promise<boolean>((resolve) => {
        guardResolveRef.current = resolve;
        setGuardReason(reason);
        setGuardOpen(true);
      });
    },
    [data],
  );

  const settleGuard = useCallback((allow: boolean) => {
    const resolve = guardResolveRef.current;
    guardResolveRef.current = null;
    setGuardOpen(false);
    resolve?.(allow);
  }, []);

  const guardSaveAndProceed = useCallback(async () => {
    const ok = await data.save("手动保存");
    if (!ok) {
      // 保存失败不能照样放行：弹窗一收、面板/窗口一关，`saveFailed` 就随组件消失，
      // 用户只会看到「改动没了」，却从没被告知保存失败。留在原地等他重试。
      showToast("保存失败，草稿仍在本地，请在面板内重试", "error");
      return;
    }
    settleGuard(true);
  }, [data, settleGuard, showToast]);

  const guardDiscardAndProceed = useCallback(async () => {
    await data.revertAll();
    settleGuard(true);
  }, [data, settleGuard]);

  const guardCancel = useCallback(() => settleGuard(false), [settleGuard]);

  // 面板卸载时若还有弹窗在等答复，就地判为「取消」——
  // 否则那个 Promise 永远不 settle，它的调用方（如切章）会静默停在 await 上。
  useEffect(
    () => () => {
      guardResolveRef.current?.(false);
      guardResolveRef.current = null;
    },
    [],
  );

  /** 面板自己的关闭按钮 / 遮罩 / Esc —— 与外部关闭走同一道闸门 */
  const requestClose = useCallback(async () => {
    if (await requestGuard("关闭行囊")) onClose();
  }, [requestGuard, onClose]);

  // 外部关闭路径（顶栏图标 / Ctrl+Shift+B / 页面级 Esc）统一走这条桥，
  // 切章 / 切作品 / 退出应用则走下面的 `registerPackGuard` 闸门。
  // requestClose / requestGuard 每次编辑都会变身份，若在 effect 依赖里直接放它们，
  // 敲一个字就重注册一次 —— 用 ref 转发，注册只随 open 变动。
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);
  const requestGuardRef = useRef(requestGuard);
  useEffect(() => {
    requestGuardRef.current = requestGuard;
  }, [requestGuard]);

  useEffect(() => {
    if (!open) return undefined;
    registerPackCloser(() => requestCloseRef.current());
    registerPackGuard((reason) => requestGuardRef.current(reason));
    return () => {
      registerPackCloser(null);
      registerPackGuard(null);
    };
  }, [open]);

  /**
   * 武装主进程的关闭守卫：有未保存改动时，窗口真要销毁（退出应用 / 子窗关闭）
   * 会先回来问一句；脏计数归零即解除，常态退出不产生任何往返。
   */
  useEffect(() => {
    setCloseGuardEnabled(open && data.dirty > 0);
    return () => setCloseGuardEnabled(false);
  }, [open, data.dirty]);

  // 主进程的关闭询问 → 复用同一个弹窗；答复即「能不能关」。
  // 选「取消」时答复 false，主进程会取消本次退出（窗口/应用都还活着）。
  useEffect(() => {
    if (!open) return undefined;
    return onCloseRequest((reason) => {
      void requestGuardRef.current(reason).then((allow) => respondCloseRequest(allow));
    });
  }, [open]);

  // ═══════════════ 业务动作 ═══════════════

  const touch = useCallback(() => setLastEditAt(Date.now()), []);

  /**
   * 编辑入口的统一包装：改文档 + 记「最后编辑时间」（自动保存的判据）。
   *
   * ⚠️ 第二参数保留只为不改动几十个调用点，**已不再参与脏计数**：
   * 计数由 `usePackData` 按「与上次保存态的净差异」派生（见 `pack-dirty.ts`）。
   * 传 `0` 依旧表示「这次不算用户的设定改动」，但如今它只影响 `touch` 语义 ——
   * 真正的计数不再依赖调用方自觉。
   */
  const callMutate = useCallback(
    (recipe: Parameters<typeof mutate>[0]) => {
      mutate(recipe);
      touch();
    },
    [mutate, touch],
  );

  /** 境界的**唯一写入口**：所有境界改动都必须经过它（REQ-048 契约第 2 条）
   *
   *  境界改动现在**只进草稿**（mutate + dirty），点「保存」时由 usePackData
   *  统一写 novel_links 并广播 —— 与行囊其它设定数据同一套节奏，即时落库的
   *  只剩主角绑定那一格（它是跨模块共享的一格，判据 PRD §8.6.2）。 */
  const writeRealm = useCallback(
    async (
      position: RealmPosition,
      origin: "pack" | "r25",
      options: { carry?: boolean; delta?: number } = {},
    ): Promise<void> => {
      if (!doc || rungs.length === 0) return;
      /* 进位 / 夹取只在 `setRealm` 里算一次，文案用它回带的 `position`。
       *
       * 历史上这里另算了一份「展示用的 next」，而 setRealm 内部按同一规则再算一遍 ——
       * 两份规则一旦漂移就会出现「toast 说变了、数据没变」的假变更。
       * 「阶内进位」正是因为这里传了 carry、`{ delta: 1 }` 却漏了它而彻底点不动。 */
      const plan = setRealm(realmState, position, origin, options);
      if (plan.link || plan.realmRaw !== null) {
        callMutate((current) => ({
          ...current,
          realmLink:
            plan.link && JSON.stringify(current.realmLink) !== JSON.stringify(plan.link)
              ? { ...plan.link, id: plan.link.id || createNovelId("nl") }
              : current.realmLink,
          character:
            plan.realmRaw !== null
              ? { ...current.character, realmAt: plan.realmRaw ?? "" }
              : current.character,
        }));
        showToast(
          `境界已更新：${formatRealm(rungs, plan.position)}（保存后生效）`,
          "success",
        );
      }
    },
    [doc, rungs, realmState, callMutate, showToast],
  );

  // ── 属性（M1） ──
  const addAttribute = useCallback(
    (partial: Partial<PackAttribute> = {}) => {
      const id = createNovelId("pa");
      callMutate((current) => ({
        ...current,
        attributes: [
          ...current.attributes,
          {
            id,
            characterId: current.character.id,
            groupName: partial.groupName ?? DEFAULT_ATTR_GROUP,
            name: partial.name ?? "新属性",
            baseValue: partial.baseValue ?? 0,
            decimals: partial.decimals ?? 0,
            unit: partial.unit ?? "",
            sortOrder: current.attributes.length + 1,
            updatedAt: Date.now(),
          },
        ],
      }));
      return id;
    },
    [callMutate],
  );

  const updateAttribute = useCallback(
    (id: string, patch: Partial<PackAttribute>) => {
      callMutate((current) => ({
        ...current,
        attributes: current.attributes.map((attr) =>
          attr.id === id ? { ...attr, ...patch, updatedAt: Date.now() } : attr,
        ),
      }));
    },
    [callMutate],
  );

  /** 删除属性：相关加成词条一并清理（B-1 验收点），返回被清理条数 */
  const removeAttribute = useCallback(
    (id: string): number => {
      let removed = 0;
      callMutate((current) => {
        removed = current.modifiers.filter((mod) => mod.targetAttrId === id).length;
        return {
          ...current,
          attributes: current.attributes.filter((attr) => attr.id !== id),
          modifiers: current.modifiers.filter((mod) => mod.targetAttrId !== id),
        };
      });
      return removed;
    },
    [callMutate],
  );

  const countModifiersOfAttribute = useCallback(
    (id: string): number =>
      (doc?.modifiers ?? []).filter((mod) => mod.targetAttrId === id).length,
    [doc],
  );

  const reorderAttributes = useCallback(
    (orderedIds: string[]) => {
      callMutate((current) => ({
        ...current,
        attributes: current.attributes.map((attr) => {
          const index = orderedIds.indexOf(attr.id);
          return index < 0 ? attr : { ...attr, sortOrder: index + 1 };
        }),
      }));
    },
    [callMutate],
  );

  /** 整组改名：一次 mutation 完成，避免逐条改动把「未保存处数」灌水 */
  const renameAttributeGroup = useCallback(
    (from: string, to: string) => {
      callMutate((current) => ({
        ...current,
        attributes: current.attributes.map((attr) =>
          attr.groupName === from ? { ...attr, groupName: to } : attr,
        ),
      }));
    },
    [callMutate],
  );

  const applyAttrTemplate = useCallback(
    (templateName: string) => {
      const template = ATTR_TEMPLATES[templateName];
      if (!template) return;
      callMutate((current) => {
        const base = current.attributes.length;
        const created = template.map((item, index) => ({
          id: createNovelId("pa"),
          characterId: current.character.id,
          groupName: item.groupName,
          name: item.name,
          baseValue: item.baseValue,
          decimals: 0,
          unit: item.unit ?? "",
          sortOrder: base + index + 1,
          updatedAt: Date.now(),
        }));
        return { ...current, attributes: [...current.attributes, ...created] };
      });
      showToast(`已套用「${templateName}」属性模板（${template.length} 项）`, "success");
    },
    [callMutate, showToast],
  );

  // ── 装备部位（M2） ──
  const addSlot = useCallback(
    (name = "新部位") => {
      callMutate((current) => ({
        ...current,
        slots: [
          ...current.slots,
          {
            id: createNovelId("ps"),
            characterId: current.character.id,
            name,
            capacity: 1,
            accepts: [],
            enabled: true,
            note: "",
            sortOrder: current.slots.length + 1,
          },
        ],
      }));
    },
    [callMutate],
  );

  const updateSlot = useCallback(
    (id: string, patch: Partial<PackSlot>) => {
      callMutate((current) => ({
        ...current,
        slots: current.slots.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
      }));
    },
    [callMutate],
  );

  /** 删除部位：已穿戴物退回物品栏（不删除，§8.4 原则 5） */
  const removeSlot = useCallback(
    (id: string) => {
      callMutate((current) => ({
        ...current,
        slots: current.slots.filter((slot) => slot.id !== id),
        items: current.items.map((item) =>
          item.equippedSlotId === id
            ? { ...item, equippedSlotId: "", slotIndex: null, updatedAt: Date.now() }
            : item,
        ),
      }));
    },
    [callMutate],
  );

  /** 槽位数从 N 改成 M：超出的一件自动退回物品栏（明确告诉作者会退回） */
  const shrinkSlotCapacity = useCallback(
    (id: string, capacity: number) => {
      callMutate((current) => {
        const slot = current.slots.find((candidate) => candidate.id === id);
        if (!slot) return current;
        const next = Math.max(1, Math.floor(capacity));
        const overflow = current.items
          .filter((item) => item.equippedSlotId === id && (item.slotIndex ?? 0) >= next)
          .map((item) => item.id);
        return {
          ...current,
          slots: current.slots.map((candidate) =>
            candidate.id === id ? { ...candidate, capacity: next } : candidate,
          ),
          items: current.items.map((item) =>
            overflow.includes(item.id)
              ? { ...item, equippedSlotId: "", slotIndex: null, updatedAt: Date.now() }
              : item,
          ),
        };
      });
    },
    [callMutate],
  );

  const reorderSlots = useCallback(
    (orderedIds: string[]) => {
      callMutate((current) => ({
        ...current,
        slots: current.slots.map((slot) => {
          const index = orderedIds.indexOf(slot.id);
          return index < 0 ? slot : { ...slot, sortOrder: index + 1 };
        }),
      }));
    },
    [callMutate],
  );

  // ── 物品（M3） ──
  /**
   * 新增物品。**满格时拒绝**（F-5 原话：「显示背包已满警告并阻止新增」）。
   *
   * 拒绝而不是「照加、只是标红」：容量上限在网文里是叙事约束（灵石袋装不下更多），
   * 工具替作者守住它才有意义。返回 `null` 让调用方（含正文选区记账那条桥）
   * 与「没能新建」区分开 —— 那条桥本来就允许返回 null。
   *
   * ⚠️ 这里读 `docRef.current` 而不是 `doc`：`addItem` 被 `registerPackQuickAdd`
   * 那条桥引用，依赖数组里加 `doc` 会让它每次编辑都换身份、桥也要跟着重注册。
   * 满格判定必须是**最新的**物品数，所以只能走镜像。
   */
  const addItem = useCallback(
    (partial: Partial<PackItem> = {}): string | null => {
      const current = docRef.current;
      const capacity = capacityStatus(
        current?.items ?? [],
        current?.character.capacityLimit ?? 0,
      );
      if (capacity.full) {
        showToast(
          `物品栏已满（${capacity.used}/${capacity.limit} 格）· 到「负重 / 容量」里调高上限`,
          "warning",
        );
        return null;
      }
      const id = createNovelId("pi");
      callMutate((state) => ({
        ...state,
        items: [
          ...state.items,
          {
            id,
            characterId: state.character.id,
            name: partial.name ?? "新物品",
            category: partial.category ?? "杂物",
            qty: partial.qty ?? 1,
            rarity: partial.rarity ?? "common",
            icon: partial.icon ?? "",
            desc: partial.desc ?? "",
            tags: partial.tags ?? [],
            equippedSlotId: "",
            slotIndex: null,
            sourceChapterId: partial.sourceChapterId ?? "",
            weight: partial.weight ?? 0,
            updatedAt: Date.now(),
          },
        ],
      }));
      return id;
    },
    [callMutate, showToast],
  );

  /**
   * 快速记账桥（REQ-027）：正文选区 → 记入背包。
   *
   * 注册走 ref 转发（`addItem` 每次改动都会换身份），注册本身与本文件其它桥
   * 一样只随 `open` 变动 —— 否则敲一个字就重注册一次。
   *
   * **不在这里弹 toast**：记账的调用方（NovelPage）有自己的 toast，两边各弹一次
   * 会同时出现两个提示，而它们说的是同一件事。
   */
  const quickAddRef = useRef<(request: PackQuickAddRequest) => string | null>(() => null);
  useEffect(() => {
    quickAddRef.current = (request) =>
      addItem({
        name: request.name,
        category: request.category ?? "杂物",
        sourceChapterId: request.chapterId,
      });
  }, [addItem]);

  useEffect(() => {
    if (!open) return undefined;
    registerPackQuickAdd((request) => quickAddRef.current(request));
    return () => registerPackQuickAdd(null);
  }, [open]);

  const updateItem = useCallback(
    (id: string, patch: Partial<PackItem>) => {
      callMutate((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item,
        ),
      }));
    },
    [callMutate],
  );

  const removeItem = useCallback(
    (id: string) => {
      callMutate((current) => ({
        ...current,
        items: current.items.filter((item) => item.id !== id),
        modifiers: current.modifiers.filter(
          (mod) => !(mod.ownerType === "item" && mod.ownerId === id),
        ),
      }));
    },
    [callMutate],
  );

  /** 数量行内快调（B-3：原地 +/-，不打开弹窗；长按支持连续增减由组件负责） */
  const stepItemQty = useCallback(
    (id: string, delta: number) => {
      callMutate((current) => {
        const item = current.items.find((candidate) => candidate.id === id);
        if (!item) return current;
        const next = Math.min(QTY_MAX, stepQty(item.qty, delta));
        return {
          ...current,
          items: current.items.map((candidate) =>
            candidate.id === id
              ? { ...candidate, qty: next, updatedAt: Date.now() }
              : candidate,
          ),
        };
      });
    },
    [callMutate],
  );

  /**
   * 穿戴：槽位满时返回「需替换」信息而不是静默什么都不做（REQ-009）。
   *
   * 返回 `{ ok: true }` 表示已穿上；`{ ok: false, conflict }` 表示槽位已满，
   * 调用方需让作者选「替换哪一件」。**必须区分这两种结果** —— 早期版本用
   * `PackItem | null` 同时表达「成功」和「冲突」以外的第三种情况（静默失败），
   * 结果是在某些占位组合下点了没反应且不报错。
   */
  const equipItem = useCallback(
    (
      itemId: string,
      slotId: string,
      slotIndex?: number,
    ): { ok: boolean; conflict: PackItem | null } => {
      const current = doc;
      const slot = current?.slots.find((candidate) => candidate.id === slotId);
      const item = current?.items.find((candidate) => candidate.id === itemId);
      if (!current || !slot || !item) return { ok: false, conflict: null };
      if (slot.accepts.length > 0 && !slot.accepts.includes(item.category)) {
        showToast(`该部位仅接受：${slot.accepts.join(" / ")}`, "warning");
        return { ok: false, conflict: null };
      }
      const occupants = current.items.filter(
        (candidate) => candidate.equippedSlotId === slotId && candidate.id !== itemId,
      );
      let target = slotIndex;
      if (target === undefined) {
        const used = new Set(occupants.map((candidate) => candidate.slotIndex ?? 0));
        target = 0;
        while (used.has(target) && target < slot.capacity) target += 1;
      }
      if (target >= slot.capacity) {
        // 满位：把冲突对象交回给调用方，由 UI 决定替换谁
        return {
          ok: false,
          conflict: occupants.find((candidate) => (candidate.slotIndex ?? 0) === target) ??
            occupants[0] ??
            null,
        };
      }
      callMutate((state) => ({
        ...state,
        items: state.items.map((candidate) =>
          candidate.id === itemId
            ? { ...candidate, equippedSlotId: slotId, slotIndex: target ?? 0, updatedAt: Date.now() }
            : candidate,
        ),
      }));
      return { ok: true, conflict: null };
    },
    [doc, callMutate, showToast],
  );

  /**
   * 替换指定槽位上的既有装备（槽位满时的第二选项）。
   *
   * ⚠️ 必须**先把原占用者卸下**再放新物品：只改新物品的 slotIndex 会让同槽位
   * 出现两件，`isItemActive` 判定 `itemsInSlot.length > capacity` → 两件双双失效，
   * 界面看不出异常，只有总属性悄悄回落。
   */
  const replaceInSlot = useCallback(
    (itemId: string, slotId: string, slotIndex: number) => {
      callMutate((state) => ({
        ...state,
        items: state.items.map((candidate) => {
          if (candidate.id === itemId) {
            return { ...candidate, equippedSlotId: slotId, slotIndex, updatedAt: Date.now() };
          }
          if (candidate.equippedSlotId === slotId && (candidate.slotIndex ?? 0) === slotIndex) {
            return { ...candidate, equippedSlotId: "", slotIndex: null, updatedAt: Date.now() };
          }
          return candidate;
        }),
      }));
    },
    [callMutate],
  );

  const unequipItem = useCallback(
    (itemId: string) => {
      callMutate((state) => ({
        ...state,
        items: state.items.map((item) =>
          item.id === itemId
            ? { ...item, equippedSlotId: "", slotIndex: null, updatedAt: Date.now() }
            : item,
        ),
      }));
    },
    [callMutate],
  );

  // ── 负重与容量上限（REQ-033 / F-5） ──
  //
  // 上限是**这个角色的设定数据**（判据 §8.6.2：改了这个值，别人的这本书会变吗？
  // 会 —— 同一个角色在别的窗口打开也是这个上限），所以走草稿、计入未保存改动，
  // 而不是像面板宽度那样即改即存。
  //
  // 一次 mutation 改两个上限：它们是同一处 UI 上的两个输入框，分开写会让
  // 「两个都改了」变成两处未保存改动，脏计数虚高。
  const setLoadLimits = useCallback(
    (patch: { weightLimit?: number; capacityLimit?: number }) => {
      callMutate((current) => {
        const weightLimit =
          patch.weightLimit === undefined
            ? current.character.weightLimit
            : normalizeLimit(patch.weightLimit);
        const capacityLimit =
          patch.capacityLimit === undefined
            ? current.character.capacityLimit
            : normalizeLimit(patch.capacityLimit, true);
        if (
          weightLimit === current.character.weightLimit &&
          capacityLimit === current.character.capacityLimit
        ) {
          return current;
        }
        return {
          ...current,
          character: { ...current.character, weightLimit, capacityLimit },
        };
      });
    },
    [callMutate],
  );

  // ── 换装方案（REQ-032） ──
  //
  // 方案是**设定数据**（一套「战斗装」的定义属于这个角色），随草稿走：
  // 保存当前穿搭、一键套用、改名、删除。
  //
  // 空穿搭不给保存：存下一套「什么都没穿」的方案，套用时只会把身上的全脱了，
  // 而菜单里它的名字看起来和别的方案没差别 —— 这是个纯陷阱。
  const savePreset = useCallback(
    (name: string): string | null => {
      const current = docRef.current;
      if (!current) return null;
      const payload = buildPresetPayload(current.items);
      if (payload.length === 0) {
        showToast("当前没有穿戴任何装备，方案会是空的，先穿几件再存", "warning");
        return null;
      }
      const label = name.trim() || `方案 ${current.presets.length + 1}`;
      const id = createNovelId("pp");
      callMutate((state) => ({
        ...state,
        presets: [
          ...state.presets,
          {
            id,
            characterId: state.character.id,
            name: label,
            payload: serializePresetPayload(payload),
            note: "",
            sortOrder: state.presets.length + 1,
            updatedAt: Date.now(),
          },
        ],
      }));
      showToast(`已保存「${label}」（${payload.length} 件）`, "success");
      return id;
    },
    [callMutate, showToast],
  );

  const renamePreset = useCallback(
    (id: string, name: string) => {
      callMutate((state) => ({
        ...state,
        presets: state.presets.map((preset) =>
          preset.id === id ? { ...preset, name, updatedAt: Date.now() } : preset,
        ),
      }));
    },
    [callMutate],
  );

  const removePreset = useCallback(
    (id: string) => {
      callMutate((state) => ({
        ...state,
        presets: state.presets.filter((preset) => preset.id !== id),
      }));
    },
    [callMutate],
  );

  /** 套用前的读数（缺几件 / 几条位置已失效）：菜单里先告诉作者，别等他点完才发现 */
  const presetReadout = useCallback(
    (preset: PackPreset): PresetReadout => {
      const current = docRef.current;
      return readPreset(
        parsePresetPayload(preset.payload),
        current?.items ?? [],
        current?.slots ?? [],
      );
    },
    [],
  );

  const applyPresetById = useCallback(
    (presetId: string) => {
      const current = docRef.current;
      const preset = current?.presets.find((item) => item.id === presetId);
      if (!current || !preset) return;
      const entries = parsePresetPayload(preset.payload);
      // 先算一遍给提示用；真正的写入在 mutator 里按**当时**的文档重算
      // （两次之间隔着一次 setState，不能拿旧结果去写新文档）。
      const preview: ApplyPresetResult = applyPreset(current.items, entries, current.slots);
      callMutate((state) => ({
        ...state,
        items: applyPreset(state.items, entries, state.slots).items,
      }));
      const dirty = preview.missing > 0 || preview.broken > 0;
      showToast(
        `「${preset.name}」${describeApply(preview)}`,
        dirty ? "warning" : "success",
      );
    },
    [callMutate, showToast],
  );

  // ── 技能（M4） ──
  const addSkill = useCallback(
    (partial: Partial<PackSkill> = {}) => {
      const id = createNovelId("pk");
      callMutate((current) => ({
        ...current,
        skills: [
          ...current.skills,
          {
            id,
            characterId: current.character.id,
            name: partial.name ?? "新技能",
            desc: partial.desc ?? "",
            enabled: partial.enabled ?? true,
            proficiencyRaw: partial.proficiencyRaw ?? 0,
            tags: partial.tags ?? [],
            sortOrder: current.skills.length + 1,
            updatedAt: Date.now(),
          },
        ],
      }));
      return id;
    },
    [callMutate],
  );

  const updateSkill = useCallback(
    (id: string, patch: Partial<PackSkill>) => {
      callMutate((current) => ({
        ...current,
        skills: current.skills.map((skill) =>
          skill.id === id ? { ...skill, ...patch, updatedAt: Date.now() } : skill,
        ),
      }));
    },
    [callMutate],
  );

  const removeSkill = useCallback(
    (id: string) => {
      callMutate((current) => ({
        ...current,
        skills: current.skills.filter((skill) => skill.id !== id),
        modifiers: current.modifiers.filter(
          (mod) => !(mod.ownerType === "skill" && mod.ownerId === id),
        ),
      }));
    },
    [callMutate],
  );

  const stepProficiency = useCallback(
    (id: string, delta: number) => {
      callMutate((current) => ({
        ...current,
        skills: current.skills.map((skill) =>
          skill.id === id
            ? {
                ...skill,
                proficiencyRaw: Math.max(0, skill.proficiencyRaw + delta),
                updatedAt: Date.now(),
              }
            : skill,
        ),
      }));
    },
    [callMutate],
  );

  // ── 效果词条（C-1 / C-2，装备与技能共用） ──
  const addModifier = useCallback(
    (ownerType: PackModifier["ownerType"], ownerId: string, nature: PackModifier["nature"]) => {
      const id = createNovelId("pm");
      callMutate((current) => {
        const ownerMods = current.modifiers.filter(
          (mod) => mod.ownerType === ownerType && mod.ownerId === ownerId,
        );
        const blank: PackModifier = {
          id,
          ownerType,
          ownerId,
          nature,
          name: "",
          targetAttrId: nature === "cast" ? "" : (current.attributes[0]?.id ?? ""),
          op: "add",
          value: 0,
          valueUnit: nature === "cast" ? "攻击力%" : "",
          scaleByProficiency: false,
          // 持续型默认关：需要作者显式开启才计入（§9.2.1）
          active: false,
          defaultOn: false,
          cost: "",
          cooldown: null,
          duration: "",
          // 新增的效果默认不限时（NULL）：给个「1 回合」会让它下一拍就自己过期
          roundsLeft: null,
          target: nature === "cast" ? "单体" : "",
          trigger: "",
          condition: "",
          note: "",
          disabled: false,
          sortOrder: ownerMods.length + 1,
        };
        return touchCarrier(
          { ...current, modifiers: [...current.modifiers, blank] },
          { ownerType, ownerId },
        );
      });
      void logUsageEvent("pack_effect_add", { ownerType, nature });
      return id;
    },
    [callMutate],
  );

  const updateModifier = useCallback(
    (id: string, patch: Partial<PackModifier>) => {
      callMutate((current) => {
        const carrier = carrierOfModifier(current, id);
        return touchCarrier(
          {
            ...current,
            modifiers: current.modifiers.map((mod) =>
              mod.id === id ? { ...mod, ...patch } : mod,
            ),
          },
          carrier,
        );
      });
    },
    [callMutate],
  );

  const removeModifier = useCallback(
    (id: string) => {
      callMutate((current) => {
        // 宿主必须在过滤**之前**取：条目一删，carrierOfModifier 就查不到了
        const carrier = carrierOfModifier(current, id);
        return touchCarrier(
          { ...current, modifiers: current.modifiers.filter((mod) => mod.id !== id) },
          carrier,
        );
      });
    },
    [callMutate],
  );

  const duplicateModifier = useCallback(
    (id: string) => {
      callMutate((current) => {
        const source = current.modifiers.find((mod) => mod.id === id);
        if (!source) return current;
        return touchCarrier(
          {
            ...current,
            modifiers: [
              ...current.modifiers,
              {
                ...source,
                id: createNovelId("pm"),
                sortOrder: source.sortOrder + 0.5,
                active: false,
              },
            ],
          },
          carrierOfModifier(current, id),
        );
      });
    },
    [callMutate],
  );

  /** 持续型效果自己的开关（与载体开关完全分离，REQ-039） */
  const toggleModifierActive = useCallback(
    (id: string) => {
      callMutate((current) =>
        touchCarrier(
          {
            ...current,
            modifiers: current.modifiers.map((mod) =>
              mod.id === id ? { ...mod, active: !mod.active } : mod,
            ),
          },
          carrierOfModifier(current, id),
        ),
      );
    },
    [callMutate],
  );

  const toggleModifierDisabled = useCallback(
    (id: string) => {
      callMutate((current) =>
        touchCarrier(
          {
            ...current,
            modifiers: current.modifiers.map((mod) =>
              mod.id === id ? { ...mod, disabled: !mod.disabled } : mod,
            ),
          },
          carrierOfModifier(current, id),
        ),
      );
    },
    [callMutate],
  );

  // ── 状态效果（REQ-025：不挂在装备技能上的 sustained 型效果） ──
  const addStatus = useCallback(
    (partial: Partial<PackModifier> = {}) => {
      const current = doc;
      if (!current) return "";
      const id = createNovelId("pm");
      callMutate((state) => ({
        ...state,
        modifiers: [
          ...state.modifiers,
          {
            id,
            ownerType: "status",
            ownerId: state.character.id,
            nature: partial.nature ?? "sustained",
            name: partial.name ?? "新状态",
            targetAttrId: partial.targetAttrId ?? state.attributes[0]?.id ?? "",
            op: partial.op ?? "add",
            value: partial.value ?? 0,
            valueUnit: "",
            scaleByProficiency: false,
            active: partial.active ?? false,
            defaultOn: false,
            cost: partial.cost ?? "",
            cooldown: null,
            duration: partial.duration ?? "",
            roundsLeft: partial.roundsLeft ?? null,
            target: "",
            trigger: partial.trigger ?? "",
            condition: "",
            note: partial.note ?? "",
            disabled: false,
            sortOrder: state.modifiers.length + 1,
          },
        ],
      }));
      return id;
    },
    [doc, callMutate],
  );

  // ── 量纲体系（D-1） ──
  const upsertUnitSystem = useCallback(
    (
      kind: "ladder" | "ratio" | "threshold",
      use: "currency" | "proficiency",
      patch: { id?: string; name?: string; levels?: unknown; config?: Record<string, unknown> },
    ) => {
      callMutate((current) => {
        const existing = current.unitSystems.find((system) => {
          try {
            const config = JSON.parse(system.config || "{}") as { use?: string };
            return config.use === use;
          } catch {
            return false;
          }
        });
        if (existing) {
          return {
            ...current,
            unitSystems: current.unitSystems.map((system) =>
              system.id === existing.id
                ? {
                    ...system,
                    kind,
                    name: patch.name ?? system.name,
                    levels: patch.levels ? JSON.stringify(patch.levels) : system.levels,
                    config: JSON.stringify({ ...JSON.parse(system.config || "{}"), use, ...(patch.config ?? {}) }),
                  }
                : system,
            ),
          };
        }
        return {
          ...current,
          unitSystems: [
            ...current.unitSystems,
            {
              id: patch.id ?? createNovelId("pu"),
              characterId: current.character.id,
              name: patch.name ?? (use === "currency" ? "货币" : "熟练度"),
              kind,
              levels: JSON.stringify(patch.levels ?? []),
              config: JSON.stringify({ use, ...(patch.config ?? {}) }),
              isDefault: current.unitSystems.length === 0,
              sortOrder: current.unitSystems.length + 1,
            },
          ],
        };
      });
    },
    [callMutate],
  );

  const removeUnitSystem = useCallback(
    (id: string) => {
      callMutate((current) => ({
        ...current,
        // 删量纲不清空原始数值（§8.5 边缘情况：作者可能只是想换一套换算）
        unitSystems: current.unitSystems.filter((system) => system.id !== id),
      }));
    },
    [callMutate],
  );

  /** 从模板创建货币体系（1 金 = 100 银 = 10000 铜） */
  const applyCurrencyTemplate = useCallback(() => {
    upsertUnitSystem("ratio", "currency", {
      name: "货币",
      levels: CURRENCY_TEMPLATE,
      config: { autoCarry: true },
    });
    showToast("已套用货币模板（1 金 = 100 银 = 10000 铜）", "success");
  }, [upsertUnitSystem, showToast]);

  // ── 模块拼装（E-1） ──
  const setModuleEnabled = useCallback(
    (key: PackModuleKey, enabled: boolean) => {
      callMutate((current) => {
        const exists = current.layouts.some((layout) => layout.moduleKey === key);
        const fallback = DEFAULT_LAYOUTS.find((layout) => layout.key === key)?.sortOrder ?? 99;
        if (!exists) {
          return {
            ...current,
            layouts: [
              ...current.layouts,
              {
                characterId: current.character.id,
                moduleKey: key,
                enabled,
                sortOrder: fallback,
              },
            ],
          };
        }
        return {
          ...current,
          layouts: current.layouts.map((layout) =>
            layout.moduleKey === key ? { ...layout, enabled } : layout,
          ),
        };
      });
    },
    [callMutate],
  );

  const setModuleOrder = useCallback(
    (orderedKeys: PackModuleKey[]) => {
      callMutate((current) => {
        const byKey = new Map(current.layouts.map((layout) => [layout.moduleKey, layout]));
        const next: PackLayout[] = [];
        orderedKeys.forEach((key, index) => {
          const stored = byKey.get(key);
          next.push({
            characterId: current.character.id,
            moduleKey: key,
            enabled: stored?.enabled ?? true,
            sortOrder: (index + 1) * 10,
          });
        });
        return { ...current, layouts: next };
      });
    },
    [callMutate],
  );

  const resetModules = useCallback(() => {
    callMutate((current) => ({
      ...current,
      layouts: DEFAULT_LAYOUTS.map((layout) => ({
        characterId: current.character.id,
        moduleKey: layout.key,
        enabled: layout.enabled,
        sortOrder: layout.sortOrder * 10,
      })),
    }));
    showToast("已恢复默认模块组合", "success");
  }, [callMutate, showToast]);

  const toggleModuleCollapsed = useCallback(
    (key: PackModuleKey) => {
      // 折叠属于界面偏好：即改即存，不计入未保存改动（PRD §8.6.2 反面清单）
      setPrefs((previous) => ({
        ...previous,
        collapsed: { ...previous.collapsed, [key]: !previous.collapsed[key] },
      }));
    },
    [],
  );

  // ── 备注速记（REQ-031） ──
  const setCharacterNote = useCallback(
    (note: string) => {
      callMutate((current) => ({
        ...current,
        character: { ...current.character, note },
      }));
    },
    [callMutate],
  );

  const renameCharacter = useCallback(
    (name: string) => {
      callMutate((current) => ({
        ...current,
        character: { ...current.character, name },
      }));
    },
    [callMutate],
  );

  // ── 效果编辑器入口（装备 / 技能 / 状态共用一套） ──
  const openEffectEditor = useCallback(
    (ownerType: PackModifier["ownerType"], ownerId: string, title: string, modifierId?: string) => {
      setEditingOwner({ ownerType, ownerId, title });
      setEditingModifierId(modifierId ?? null);
    },
    [],
  );
  const closeEffectEditor = useCallback(() => {
    setEditingOwner(null);
    setEditingModifierId(null);
  }, []);

  // ── 面板开关（由 NovelPage 持有，这里只转发统计埋点） ──
  useEffect(() => {
    if (open) void logUsageEvent("pack_open", { workId });
  }, [open, workId]);

  const modifiersOf = useCallback(
    (ownerType: PackModifier["ownerType"], ownerId: string): PackModifier[] =>
      (doc?.modifiers ?? [])
        .filter((mod) => mod.ownerType === ownerType && mod.ownerId === ownerId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [doc],
  );

  /**
   * 本章初：当前章节里**时间最早**的那条盘点记录（REQ-029）。
   *
   * 不需要额外做「打开章节时自动落一条」的通道 —— 记录里存的正是**保存前的
   * 库内状态**，所以本章第一次保存落下的那条，恰好就是本章开始时角色的样子。
   * 少一条通道，也少一个「重开章节要不要覆盖」的判断题。
   *
   * 代价：本章一次都没保存过时没有起点。此时如实给空态，**不要**拿
   * `latestRecord` 冒充 —— 那是「上次保存之前」，不是「本章之初」，
   * 用它比出来的差异会把上一章末尾的改动也算进本章。
   */
  const chapterBaseline = useMemo(() => {
    if (!chapterId) return null;
    return meta.records.reduce<PackRecord | null>(
      (oldest, record) =>
        record.chapterId === chapterId && (!oldest || record.takenAt < oldest.takenAt)
          ? record
          : oldest,
      null,
    );
  }, [meta.records, chapterId]);

  const dirtyHint = useMemo(() => {
    if (data.saveFailed) return { tone: "error" as const, text: "保存失败 · 草稿已保留" };
    if (data.saving) return { tone: "busy" as const, text: "保存中…" };
    if (data.dirty > 0) {
      return {
        tone: "dirty" as const,
        text: `${data.dirty} 处改动未保存`,
        breathe: data.dirty >= DIRTY_BREATHE_AT,
      };
    }
    return { tone: "idle" as const, text: "已保存" };
  }, [data.saveFailed, data.saving, data.dirty]);

  return {
    // 数据
    loading: data.loading,
    loadError: data.loadError,
    doc,
    meta,
    dirty: data.dirty,
    saving: data.saving,
    saveFailed: data.saveFailed,
    savedAt: data.savedAt,
    latestRecord: data.latestRecord,
    chapterBaseline,
    dirtyHint,
    save: data.save,
    revertAll: data.revertAll,
    restoreFromRecord: data.restoreFromRecord,
    exportDraftJson: data.exportDraftJson,
    flushDraft: data.flushDraft,

    // 视图
    prefs,
    patchPrefs,
    toast,
    showToast,
    closeToast,
    editingOwner,
    editingModifierId,
    detailAttrId,
    setDetailAttrId,
    moduleManagerOpen,
    setModuleManagerOpen,
    unitManagerOpen,
    setUnitManagerOpen,
    slotManagerOpen,
    setSlotManagerOpen,
    recordDrawerOpen,
    setRecordDrawerOpen,
    guardOpen,
    guardReason,
    guardSaveAndProceed,
    guardDiscardAndProceed,
    guardCancel,
    inventoryKeyword,
    setInventoryKeyword,

    // 派生
    modules,
    enabledModules,
    moduleOf,
    statusModifiers,
    activeCarriers,
    summary,
    load,
    previewEquipDeltas,
    estimateOn,
    setEstimateOn,
    estimateEntries,
    estimateSummary,
    estimateDeltas,
    rungs,
    realmPos,
    panelRealmPos,
    realmText,
    panelRealmText,
    realmBound: Boolean(doc?.character.entityId),
    realmHint: doc?.character.entityId ? "" : UNBOUND_REALM_HINT,
    currencySystem,
    proficiencySystem,
    unitSystemOf,
    changedCount,
    isRecentlyChanged,
    buildModuleMarkdown,

    // 动作
    writeRealm,
    bindEntity,
    setRungMeta,
    addAttribute,
    updateAttribute,
    removeAttribute,
    countModifiersOfAttribute,
    reorderAttributes,
    renameAttributeGroup,
    applyAttrTemplate,
    addEstimate,
    updateEstimate,
    removeEstimate,
    clearEstimates,
    markAllChangesRead,
    addSlot,
    updateSlot,
    removeSlot,
    shrinkSlotCapacity,
    reorderSlots,
    addItem,
    updateItem,
    removeItem,
    stepItemQty,
    equipItem,
    replaceInSlot,
    unequipItem,
    setLoadLimits,
    savePreset,
    renamePreset,
    removePreset,
    presetReadout,
    applyPresetById,
    addSkill,
    updateSkill,
    removeSkill,
    stepProficiency,
    addModifier,
    updateModifier,
    removeModifier,
    duplicateModifier,
    toggleModifierActive,
    toggleModifierDisabled,
    addStatus,
    upsertUnitSystem,
    removeUnitSystem,
    applyCurrencyTemplate,
    setModuleEnabled,
    setModuleOrder,
    resetModules,
    toggleModuleCollapsed,
    setCharacterNote,
    renameCharacter,
    openEffectEditor,
    closeEffectEditor,
    modifiersOf,
    /**
     * 判定某载体当前是否在效（闸门 1，组件渲染徽标 / 停用态时用）。
     *
     * ⚠️ 只适用于**装备 / 技能**：它们的载体键就是 `ownerId`。状态效果的键是
     * 效果自己的 id（见 `carrierKeyOf`），拿 ownerId 来问必然得到 false ——
     * 这正是「状态开着但总属性不动」那个静默缺陷的成因，别再往这条路上加调用点。
     */
    isCarrierActive: (ownerType: PackModifier["ownerType"], ownerId: string): boolean =>
      activeCarriers.has(carrierKey(ownerType, ownerId)),

    // 关闭流程
    requestClose,
    natureMeta: NATURE_META,
  };
}

export type PackPanelApi = ReturnType<typeof usePackPanel>;
