import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createNovelId, logUsageEvent } from "@/shared/services/novel-shared";
import type { NumberLabelStyle } from "@/shared/novel/number-label";
import { STORAGE_KEYS } from "@/shared/novel/constants";
import { parseWorkNumbering, workNumberingOf } from "@/shared/novel/work-numbering";
import {
  DEFAULT_LAYOUTS,
  QTY_MAX,
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
import { subscribeDualChannel } from "@/shared/novel/dual-channel";
import { useAutoToast, type ToastPayload } from "@/shared/novel/use-auto-toast";
import {
  buildActiveCarriersFrom,
  buildGroupOffCarriers,
  buildPackText,
  carrierKey,
  composeAttributes,
  computeHypotheticalSummary,
  computeSummary,
  countRecentChanges,
  formatRealm,
  hasRecentChange,
  proficiencySchemeOf,
  sortLadder,
  stepQty,
  summaryDeltas,
  type HypotheticalInput,
  type LadderRung,
  type PackExportContext,
  type PackExportKey,
  type ProficiencySchemeMeta,
  type RealmPosition,
  type SummaryDelta,
  type SummaryResult,
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
  renamePackCharacter,
  savePackUiPrefsRaw,
  writeProtagonistBinding,
} from "../services/pack-service";
import {
  ATTR_TEMPLATES,
  DEFAULT_ATTR_GROUP,
  DEFAULT_UI_PREFS,
  NATURE_META,
  PACK_MODULES,
  type PackAttrDef,
  type PackAttribute,
  type PackAttrValue,
  type PackCategory,
  type PackGradeSystem,
  type PackItem,
  type PackLayout,
  type PackMapping,
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
import {
  CURRENCY_TEMPLATE,
  isCorePackModule,
  PACK_UI_SAVE_DEBOUNCE_MS,
  PROFICIENCY_TEMPLATE,
} from "../pack-config";
import {
  notifyNameChanged,
  notifyProtagonistChanged,
  PACK_NAME_EVENT,
  PACK_PROTAGONIST_EVENT,
  PACK_REALM_EVENT,
  readEventDetail,
  type PackNameEventDetail,
  type PackProtagonistEventDetail,
  type PackRealmEventDetail,
} from "../pack-config";
import { coreFirstOrder } from "../pack-layout";
import { usePackData, type PackDoc } from "./usePackData";
import {
  onCloseRequest,
  respondCloseRequest,
  setCloseGuardEnabled,
} from "../services/pack-close-guard";
import { AUTOSAVE_IDLE_MS, DIRTY_BREATHE_AT } from "../types";

// 类型出处已收口到共享 hook（P3-3）；PackToastState 保留原名作为别名导出，
// PackToast 组件的 import 路径不变
export type PackToastState = ToastPayload;

interface UsePackPanelOptions {
  workId: string;
  chapterId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * 本书的序号数字样式（REQ-052 口径跟随本书 `numberStyle`）。
 *
 * 行囊是**独立窗口**，拿不到编辑器 store，只能读 config：
 * 先看本书规则（`novel_work_numbering`），无记录再回退全局排版设置
 * （`novel_editor_settings`）。两处都缺 / 坏 JSON 时回退应用默认「中文」——
 * 与编辑器 `DEFAULT_SETTINGS.numberStyle` 同口径，不另立一套。
 */
async function readWorkNumberStyle(workId: string): Promise<NumberLabelStyle> {
  const fallback: NumberLabelStyle = "chinese";
  const api = window.electronAPI;
  if (!api?.novel) return fallback;
  try {
    const [numberingRaw, settingsRaw] = await Promise.all([
      api.novel.configGet(STORAGE_KEYS.workNumbering),
      api.novel.configGet(STORAGE_KEYS.settings),
    ]);
    const rule = workNumberingOf(workId, parseWorkNumbering(numberingRaw ?? null));
    if (rule?.numberStyle) return rule.numberStyle;
    const parsed: unknown = settingsRaw ? JSON.parse(settingsRaw) : null;
    if (parsed && typeof parsed === "object") {
      const value = (parsed as { numberStyle?: unknown }).numberStyle;
      if (value === "arabic" || value === "chinese") return value;
    }
  } catch {
    // IPC / JSON 失败：回退默认，境界文案照常可渲染
  }
  return fallback;
}

/**
 * 库里的 layout 行 → 渲染用的模块状态。
 *
 * 缺失行的兜底必须与「出厂默认」同一口径（核心三块启用、其余关闭），否则
 * 同一个毛病会换个入口再犯一次：老库里没有新模块的行，兜底写 `true` 就意味着
 * 「以后每加一个模块，所有老书都自动多开一块」—— 这正是新书一屏全开的老毛病。
 */
function mergeLayouts(layouts: PackLayout[]): PackModuleState[] {
  const known = new Map(layouts.map((layout) => [layout.moduleKey, layout]));
  return PACK_MODULES.map((module, index) => {
    const stored = known.get(module.key);
    return {
      key: module.key,
      enabled: stored?.enabled ?? isCorePackModule(module.key),
      sortOrder: stored?.sortOrder ?? (index + 1) * 10,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

/** 共享的空加成数组：让「没有加成」的宿主拿到稳定引用，不击穿下游 memo */
const EMPTY_MODIFIERS: PackModifier[] = [];

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
    return parsed && typeof parsed === "object"
      ? (parsed as Partial<PackUiPrefs>)
      : {};
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
export function usePackPanel({
  workId,
  chapterId,
  open,
  onClose,
}: UsePackPanelOptions) {
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
    if (prefsTimerRef.current !== null)
      window.clearTimeout(prefsTimerRef.current);
    prefsTimerRef.current = window.setTimeout(() => {
      prefsTimerRef.current = null;
      void savePackUiPrefsRaw(JSON.stringify(prefs));
    }, PACK_UI_SAVE_DEBOUNCE_MS);
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
  // 轻提示：计时 / 清理由共享 hook 收口（P3-3），时长沿用面板节奏 2.6s
  const { toast, showToast, closeToast } = useAutoToast(2600);
  const [editingOwner, setEditingOwner] = useState<{
    ownerType: PackModifier["ownerType"];
    ownerId: string;
    title: string;
  } | null>(null);
  const [editingModifierId, setEditingModifierId] = useState<string | null>(
    null,
  );
  const [detailAttrId, setDetailAttrId] = useState<string | null>(null);
  const [moduleManagerOpen, setModuleManagerOpen] = useState(false);
  const [unitManagerOpen, setUnitManagerOpen] = useState(false);
  const [slotManagerOpen, setSlotManagerOpen] = useState(false);
  /** 分类管理弹窗（1.40.0）：物品分类改名 / 绑定体系品阶 */
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [recordDrawerOpen, setRecordDrawerOpen] = useState(false);
  /** 未保存闸门弹窗（关闭窗口 / 退出应用共用同一个） */
  const [guardOpen, setGuardOpen] = useState(false);
  const [guardReason, setGuardReason] = useState<PackGuardReason>("关闭行囊");
  const [inventoryKeyword, setInventoryKeyword] = useState("");
  const [lastEditAt, setLastEditAt] = useState(0);

  /**
   * 本书序号数字样式（REQ-052）：行囊境界文案里 `{n}` 模板的小层名要跟随它
   * （「第七层」/「第7层」）。装载一次即可 —— 序号规则是低频设置，
   * 与境界阶梯同属「跨窗口共享的那一份」，本面板只读不写。
   */
  const [numberStyle, setNumberStyle] = useState<NumberLabelStyle>("chinese");
  useEffect(() => {
    if (!workId) return undefined;
    let cancelled = false;
    void readWorkNumberStyle(workId).then((style) => {
      if (!cancelled) setNumberStyle(style);
    });
    return () => {
      cancelled = true;
    };
  }, [workId]);

  // ── 派生：模块布局、在效载体、汇总 ──
  const modules = useMemo(() => (doc ? mergeLayouts(doc.layouts) : []), [doc]);
  /** 展示顺序：核心三块钉顶，其余按作者排序跟后（规则见 coreFirstOrder） */
  const enabledModules = useMemo(
    () => coreFirstOrder(modules.filter((module) => module.enabled)),
    [modules],
  );

  const statusModifiers = useMemo(
    () =>
      doc ? doc.modifiers.filter((mod) => mod.ownerType === "status") : [],
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
      groups: doc.groups,
    });
  }, [doc]);

  /**
   * 停用组的载体键集合（闸门 0 归桶用）。
   *
   * 与 `activeCarriers` 分成两个 useMemo 是刻意的：前者决定「算不算」，
   * 这里决定「归哪个桶」—— 组停用的词条要进独立的 `groupOff` 桶
   * （与 expired / eventOnly 同层），而不是混进「在效」里装作没停用。
   */
  const groupOffCarriers = useMemo(() => {
    if (!doc) return new Set<string>();
    return buildGroupOffCarriers(doc.groups, doc.items, doc.skills);
  }, [doc]);

  const proficiency = useMemo(() => {
    const map: Record<string, number> = {};
    for (const skill of doc?.skills ?? []) map[skill.id] = skill.proficiencyRaw;
    return map;
  }, [doc]);

  /**
   * 属性组合视图（def ∪ value）：汇总 / 映射 / 效果编辑器 / 导出统一消费这一份，
   * 组合只发生在 `composeAttributes` 一个产出点（见该函数注释）。
   */
  const attrView: PackAttribute[] = useMemo(
    () => (doc ? composeAttributes(doc.attrDefs, doc.attributes) : []),
    [doc],
  );

  const summary: SummaryResult = useMemo(
    () =>
      computeSummary({
        attributes: attrView,
        modifiers: doc?.modifiers ?? [],
        mappings: doc?.mappings ?? [],
        activeCarriers,
        groupOffCarriers,
        proficiency,
      }),
    [doc, attrView, activeCarriers, groupOffCarriers, proficiency],
  );

  // ── 假想输入：一处能力，两条需求（REQ-018 换装预览 / REQ-037 估算模式）──
  const hypotheticalInput: HypotheticalInput = useMemo(
    () => ({
      attributes: attrView,
      slots: doc?.slots ?? [],
      items: doc?.items ?? [],
      skills: doc?.skills ?? [],
      groups: doc?.groups ?? [],
      modifiers: doc?.modifiers ?? [],
      // 映射必须在场：穿上「+20 力量」的剑，气血会因为「根骨/力量 → 气血」
      // 跟着涨 —— 少了它，预览与装上之后的总属性就对不上了
      mappings: doc?.mappings ?? [],
      proficiency,
    }),
    [doc, attrView, proficiency],
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
        computeHypotheticalSummary(hypotheticalInput, {
          equip: { itemId, slotId },
        }),
      ),
    [summary, hypotheticalInput],
  );

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

  // ── 多套熟练度体系（Phase 3 转正）──
  //
  // config.use === "proficiency" 的量纲现在允许**并存**（修为 / 剑意各一套），
  // 按 sortOrder 取第一套作**默认体系**：未绑定分组的技能、旧数据全部回落到它。
  // 分组绑了 `profSchemeId` 的，组内技能的档位 / 别名 / 进位跟随所绑体系。
  const proficiencySystems = useMemo(() => {
    const list: PackUnitSystem[] = [];
    for (const system of doc?.unitSystems ?? []) {
      try {
        const config = JSON.parse(system.config || "{}") as { use?: string };
        if (config.use === "proficiency") list.push(system);
      } catch {
        // config 坏了视为非熟练度体系，跳过
      }
    }
    return list.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [doc]);
  const proficiencySystem = proficiencySystems[0];

  /** systemId → 结构化元数据（levels 含 ratio / 别名 / autoCarry），解析只发生在这里 */
  const proficiencySchemes = useMemo(() => {
    const map = new Map<string, ProficiencySchemeMeta>();
    for (const system of proficiencySystems) {
      map.set(
        system.id,
        proficiencySchemeOf(system.levels, system.config),
      );
    }
    return map;
  }, [proficiencySystems]);

  /** 技能的熟练度体系解析：组绑定了体系就用那套，否则回落默认体系 */
  const schemeForSkill = useCallback(
    (skillGroupId: string): { system: PackUnitSystem | undefined; meta: ProficiencySchemeMeta } => {
      const boundId = skillGroupId
        ? (doc?.groups ?? []).find((group) => group.id === skillGroupId)?.profSchemeId
        : undefined;
      const system =
        (boundId
          ? proficiencySystems.find((candidate) => candidate.id === boundId)
          : undefined) ?? proficiencySystem;
      return {
        system,
        meta:
          (system && proficiencySchemes.get(system.id)) ??
          proficiencySchemeOf(system?.levels, system?.config),
      };
    },
    [doc, proficiencySystems, proficiencySystem, proficiencySchemes],
  );

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

  // ── 派生：体系品阶（1.40.0）──
  //
  // meta.gradeSystems 随装载 / syncMeta 刷新，与 levelSystems 同节奏；
  // 这里是全部「品阶 → 名字」翻译的唯一入口（组件与导出共用同一份）。

  /** 体系品阶投影：设定域全部分类的根阶清单（物品 / 技能选品阶用） */
  const gradeSystems: PackGradeSystem[] = useMemo(
    () => meta.gradeSystems ?? [],
    [meta.gradeSystems],
  );

  /** 品阶名翻译：levelId → 「神器」；等级被删 / id 悬空返回空串（chip 不显示） */
  const gradeNameOf = useCallback(
    (levelId: string): string => {
      if (!levelId) return "";
      for (const system of gradeSystems) {
        const level = system.levels.find((row) => row.id === levelId);
        if (level) return level.name;
      }
      return "";
    },
    [gradeSystems],
  );

  /** 分类绑定的体系 id（按名字反查；分类被删 → 空串 = 未绑定） */
  const categorySystemIdOf = useCallback(
    (categoryName: string): string =>
      doc?.categories.find((category) => category.name === categoryName)?.systemId ?? "",
    [doc],
  );

  /**
   * 物品 / 技能的品阶归属体系是否可判：品阶选择的前提是有体系可选。
   * 设定域一个体系都没有时，调用方给「去设定中心创建」的引导。
   */
  const hasGradeSystems = gradeSystems.length > 0;

  /** 导出用：levelId → 品阶名 的整表（buildPackText 的 context 吃纯数据） */
  const gradeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const system of gradeSystems) {
      for (const level of system.levels) map.set(level.id, level.name);
    }
    return map;
  }, [gradeSystems]);

  // ── 派生：面板文本导出（1.39.1：系统流小说的 txt 排版）──
  //
  // 组装交给纯函数（`buildPackText`），这里只负责把散落的派生拼成一份输入。
  // **不在渲染期调用**：`PackExportButton` 只在真正点菜单时才 build 一次。
  const buildModuleText = useCallback(
    (key: PackExportKey, label: string): string => {
      // 默认体系的档位 / 别名（Phase 3：技能行文案跟随别名）
      const defaultMeta =
        (proficiencySystem && proficiencySchemes.get(proficiencySystem.id)) ??
        proficiencySchemeOf(proficiencySystem?.levels, proficiencySystem?.config);

      let currencyLevels: Array<{ name: string; ratioToBase: number }> = [];
      let currencyAutoCarry = true;
      try {
        const parsed: unknown = JSON.parse(currencySystem?.levels || "[]");
        if (Array.isArray(parsed)) {
          currencyLevels = parsed as Array<{
            name: string;
            ratioToBase: number;
          }>;
        }
        const config = JSON.parse(currencySystem?.config || "{}") as {
          autoCarry?: boolean;
        };
        currencyAutoCarry = config.autoCarry !== false;
      } catch {
        currencyLevels = [];
      }

      const context: PackExportContext = {
        attributes: attrView,
        slots: doc?.slots ?? [],
        items: doc?.items ?? [],
        skills: doc?.skills ?? [],
        groups: doc?.groups ?? [],
        modifiers: doc?.modifiers ?? [],
        mappings: doc?.mappings ?? [],
        summary,
        proficiencyLevels: defaultMeta.levels,
        proficiencyAlias: defaultMeta.alias,
        gradeNames,
        currency: currencyLevels.length
          ? { levels: currencyLevels, autoCarry: currencyAutoCarry }
          : null,
      };
      return buildPackText(key, context, label);
    },
    [doc, attrView, summary, proficiencySystem, proficiencySchemes, currencySystem, gradeNames],
  );

  // ── 派生：境界（全部经由口子，禁止直接读字段 REQ-048） ──
  // 主进程投影已只出根阶（子层级折算成阶内层数），这里原样透传
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
        hasChildren: rung.hasChildren ?? false,
        subLabels: rung.subLabels,
        // 本阶生效的小层命名模板（REQ-052）：渲染层据此现场渲染「第七层」
        subPattern: rung.subPattern ?? "",
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
  const realmText = useMemo(
    () => formatRealm(rungs, realmPos, numberStyle),
    [rungs, realmPos, numberStyle],
  );
  const panelRealmText = useMemo(
    () => formatRealm(rungs, panelRealmPos, numberStyle),
    [rungs, panelRealmPos, numberStyle],
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
        entityId
          ? "已设为主角，境界与右侧角色卡同步"
          : "已取消主角，境界仅在行囊内使用",
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
    return subscribeDualChannel(PACK_PROTAGONIST_EVENT, handler);
  }, [workId, mutate]);

  /**
   * 右侧要素栏 / 要素库改了主角名：把新名同步进行囊（头部立刻跟着变）。
   *
   * 名字的单一事实源是实体，行囊只是它的一个展示面 —— 要素库改名后若不通知，
   * 行囊头部会一直显示旧名，直到下次重载（表现为「要素库里改了名，行囊没动」）。
   *
   * `origin === "pack"` 的是自己改的：文档已经更新过了，跳过避免重复 mutate。
   * 只改 `displayName` 一格，不重载整份文档 —— 否则未保存的编辑会被冲掉。
   */
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const detail = readEventDetail<PackNameEventDetail & { origin?: string }>(
        args,
      );
      if (!detail || typeof detail !== "object") return;
      if (detail.workId !== workId) return;
      if (detail.origin === "pack") return;
      const displayName = detail.displayName ?? "";
      if (!displayName) return;
      mutate((current) =>
        current.character.displayName === displayName
          ? current
          : { ...current, character: { ...current.character, displayName } },
      );
    };
    return subscribeDualChannel(PACK_NAME_EVENT, handler);
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
    return subscribeDualChannel(PACK_REALM_EVENT, handler);
  }, [workId, mutate]);

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
        // flushDraft 内部已收 IPC reject（P3-6），不会把裁决链打断
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

  // 面板自己的关闭按钮 / 遮罩 / Esc —— 同一道未保存闸门（G-2）。
  // 历史（P3-1）：这里曾把 requestClose / requestGuard 经 ref 转发注册到
  // pack-config 的进程内注册桥（closer / guard 两个方向），供面板还挂在
  // NovelPage 里时页面侧调用；拆窗后页面侧无调用方，桥已删 ——
  // 跨窗口的关闭拦截统一走下面的主进程 close-guard 三通道。
  // requestGuardRef 仍要保留：close-guard 的询问回调只随 open 注册一次，
  // 而 requestGuard 每次编辑都换身份 —— 经 ref 转发拿最新的。
  const requestGuardRef = useRef(requestGuard);
  useEffect(() => {
    requestGuardRef.current = requestGuard;
  }, [requestGuard]);

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
      void requestGuardRef
        .current(reason)
        .then((allow) => respondCloseRequest(allow));
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
            plan.link &&
            JSON.stringify(current.realmLink) !== JSON.stringify(plan.link)
              ? { ...plan.link, id: plan.link.id || createNovelId("nl") }
              : current.realmLink,
          character:
            plan.realmRaw !== null
              ? { ...current.character, realmAt: plan.realmRaw ?? "" }
              : current.character,
        }));
        showToast(
          `境界已更新：${formatRealm(rungs, plan.position, numberStyle)}（保存后生效）`,
          "success",
        );
      }
    },
    [doc, rungs, realmState, callMutate, showToast, numberStyle],
  );

  // ── 属性（M1 · 1.39.0 定义 / 数值分离）──
  //
  // 定义（attrDefs，作品级）回答「这本书有哪些属性」，数值（attributes，角色级）
  // 只回答「每条是多少」。增删改在这里一次拆成两份数据，调用方仍面对单一 API。
  const addAttribute = useCallback(
    (partial: Partial<PackAttrDef> & { baseValue?: number } = {}) => {
      const id = createNovelId("pa");
      callMutate((current) => {
        const baseValue = partial.baseValue ?? partial.defaultValue ?? 0;
        return {
          ...current,
          attrDefs: [
            ...current.attrDefs,
            {
              id,
              workId: current.character.workId,
              key: "",
              groupName: partial.groupName ?? DEFAULT_ATTR_GROUP,
              name: partial.name ?? "新属性",
              decimals: partial.decimals ?? 0,
              unit: partial.unit ?? "",
              defaultValue: baseValue,
              sortOrder: current.attrDefs.length + 1,
            },
          ],
          // 新建即初始化实例（值 = 默认值）：模型与数值同步出现，省一次「初始化」点击
          attributes: [
            ...current.attributes,
            {
              id,
              characterId: current.character.id,
              defId: id,
              baseValue,
              updatedAt: Date.now(),
            },
          ],
        };
      });
      return id;
    },
    [callMutate],
  );

  /**
   * 更新属性：patch 里的展示字段落到**定义**，baseValue 落到**数值行**。
   *
   * 定义字段的改动同样刷新数值行的 `updatedAt`（REQ-028 角标以行为单位 ——
   * 「改了属性名」也是「这条属性变了」）。数值行不存在时跳过：视图层会回落
   * defaultValue，缺打点只影响角标，不值得为此造一行空实例。
   */
  const updateAttribute = useCallback(
    (id: string, patch: Partial<PackAttribute>) => {
      callMutate((current) => {
        const defPatch: Partial<PackAttrDef> = {};
        if (patch.name !== undefined) defPatch.name = patch.name;
        if (patch.groupName !== undefined) defPatch.groupName = patch.groupName;
        if (patch.unit !== undefined) defPatch.unit = patch.unit;
        if (patch.decimals !== undefined) defPatch.decimals = patch.decimals;
        if (patch.sortOrder !== undefined) defPatch.sortOrder = patch.sortOrder;
        if (patch.defaultValue !== undefined) defPatch.defaultValue = patch.defaultValue;
        const hasDefPatch = Object.keys(defPatch).length > 0;
        if (!hasDefPatch && patch.baseValue === undefined) return current;
        const now = Date.now();
        return {
          ...current,
          attrDefs: hasDefPatch
            ? current.attrDefs.map((def) => (def.id === id ? { ...def, ...defPatch } : def))
            : current.attrDefs,
          attributes:
            patch.baseValue !== undefined && !current.attributes.some((value) => value.defId === id)
              ? [
                  ...current.attributes,
                  { id, characterId: current.character.id, defId: id, baseValue: patch.baseValue, updatedAt: now },
                ]
              : current.attributes.map((value) =>
                  value.defId === id
                    ? {
                        ...value,
                        ...(patch.baseValue !== undefined ? { baseValue: patch.baseValue } : null),
                        updatedAt: now,
                      }
                    : value,
                ),
        };
      });
    },
    [callMutate],
  );

  /**
   * 删除属性：删的是**定义**，实例数值行与引用它的效果 / 映射一并清理。
   *
   * 映射两端都指向定义 id，任一端落在被删定义上就整条清掉 —— 留着的话汇总会给
   * 它标一句「属性已删除」。`countMappingsOfAttribute` 会在确认框里把这件事
   * 说清楚，所以这里是「说好了再删」，不是静默改动。
   */
  const removeAttribute = useCallback(
    (id: string): number => {
      let removed = 0;
      callMutate((current) => {
        removed = current.modifiers.filter((mod) => mod.targetAttrId === id).length;
        return {
          ...current,
          attrDefs: current.attrDefs.filter((def) => def.id !== id),
          attributes: current.attributes.filter((value) => value.defId !== id),
          modifiers: current.modifiers.filter((mod) => mod.targetAttrId !== id),
          mappings: current.mappings.filter(
            (mapping) => mapping.sourceAttrId !== id && mapping.targetAttrId !== id,
          ),
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

  /** 删属性时会被连带清掉的映射条数（确认框要如实说明） */
  const countMappingsOfAttribute = useCallback(
    (id: string): number =>
      (doc?.mappings ?? []).filter(
        (mapping) => mapping.sourceAttrId === id || mapping.targetAttrId === id,
      ).length,
    [doc],
  );

  // 排序收在**定义**上（数值行不再携带 sortOrder，展示顺序跟着模型走）
  const reorderAttributes = useCallback(
    (orderedIds: string[]) => {
      callMutate((current) => ({
        ...current,
        attrDefs: current.attrDefs.map((def) => {
          const index = orderedIds.indexOf(def.id);
          return index < 0 ? def : { ...def, sortOrder: index + 1 };
        }),
      }));
    },
    [callMutate],
  );

  /** 套用属性模板：种的是**定义**（defaultValue 同步作为初始数值） */
  const applyAttrTemplate = useCallback(
    (templateName: string) => {
      const template = ATTR_TEMPLATES[templateName];
      if (!template) return;
      callMutate((current) => {
        const base = current.attrDefs.length;
        const now = Date.now();
        const createdDefs: PackAttrDef[] = [];
        const createdValues: PackAttrValue[] = [];
        template.forEach((item, index) => {
          const id = createNovelId("pa");
          createdDefs.push({
            id,
            workId: current.character.workId,
            key: "",
            groupName: item.groupName,
            name: item.name,
            decimals: 0,
            unit: item.unit ?? "",
            defaultValue: item.baseValue,
            sortOrder: base + index + 1,
          });
          createdValues.push({
            id,
            characterId: current.character.id,
            defId: id,
            baseValue: item.baseValue,
            updatedAt: now,
          });
        });
        return {
          ...current,
          attrDefs: [...current.attrDefs, ...createdDefs],
          attributes: [...current.attributes, ...createdValues],
        };
      });
      showToast(
        `已套用「${templateName}」属性模板（${template.length} 项）`,
        "success",
      );
    },
    [callMutate, showToast],
  );

  // ── 属性映射（M3，1.35.0） ──

  /**
   * 新增一条换算。
   *
   * 默认给一对**不同的**属性（源取第一条，目标取第一条不是源的）—— 否则新行一出现
   * 就带着「源与目标相同」的警告，用户第一眼看到的就是一个错误。
   * 属性不足两条时返回空串：没有「另一条属性」可折算，调用方据此给提示而不是
   * 造出一条必然无效的记录。
   */
  const addMapping = useCallback(
    (partial: Partial<PackMapping> = {}): string => {
      const current = docRef.current;
      if (!current || current.attrDefs.length < 2) return "";
      const sourceAttrId = partial.sourceAttrId ?? current.attrDefs[0].id;
      const targetAttrId =
        partial.targetAttrId ??
        current.attrDefs.find((attr) => attr.id !== sourceAttrId)?.id ??
        "";
      if (!targetAttrId || sourceAttrId === targetAttrId) return "";
      const id = createNovelId("pm");
      callMutate((doc0) => ({
        ...doc0,
        mappings: [
          ...doc0.mappings,
          {
            id,
            characterId: doc0.character.id,
            sourceAttrId,
            targetAttrId,
            // 默认 1：系数 0 在本功能里等于「停用」，不该拿它当新行的初值
            rate: partial.rate ?? 1,
            note: partial.note ?? "",
            sortOrder: doc0.mappings.length + 1,
            updatedAt: Date.now(),
          },
        ],
      }));
      return id;
    },
    [callMutate],
  );

  const updateMapping = useCallback(
    (id: string, patch: Partial<PackMapping>) => {
      callMutate((current) => ({
        ...current,
        mappings: current.mappings.map((mapping) =>
          mapping.id === id
            ? { ...mapping, ...patch, updatedAt: Date.now() }
            : mapping,
        ),
      }));
    },
    [callMutate],
  );

  const removeMapping = useCallback(
    (id: string) => {
      callMutate((current) => ({
        ...current,
        mappings: current.mappings.filter((mapping) => mapping.id !== id),
      }));
    },
    [callMutate],
  );

  const reorderMappings = useCallback(
    (orderedIds: string[]) => {
      callMutate((current) => ({
        ...current,
        mappings: current.mappings.map((mapping) => {
          const index = orderedIds.indexOf(mapping.id);
          return index < 0 ? mapping : { ...mapping, sortOrder: index + 1 };
        }),
      }));
    },
    [callMutate],
  );

  /** 按 sortOrder 排好的映射列表：映射模块与导出都读它，顺序只有这一个产出点 */
  const mappings = useMemo(
    () => [...(doc?.mappings ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [doc],
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
        slots: current.slots.map((slot) =>
          slot.id === id ? { ...slot, ...patch } : slot,
        ),
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
            ? {
                ...item,
                equippedSlotId: "",
                slotIndex: null,
                updatedAt: Date.now(),
              }
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
          .filter(
            (item) =>
              item.equippedSlotId === id && (item.slotIndex ?? 0) >= next,
          )
          .map((item) => item.id);
        return {
          ...current,
          slots: current.slots.map((candidate) =>
            candidate.id === id ? { ...candidate, capacity: next } : candidate,
          ),
          items: current.items.map((item) =>
            overflow.includes(item.id)
              ? {
                  ...item,
                  equippedSlotId: "",
                  slotIndex: null,
                  updatedAt: Date.now(),
                }
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

  // ── 物品分类管理（1.40.0）──
  //
  // item.category 存的是**分类名字符串**（compat：老数据零迁移），所以
  // 改名要把旧名字传播到所有物品行，删除要把物品退回「未分类」——
  // 与 removeGroup「组内条目退回未分组」同构。

  const addCategory = useCallback(
    (name = "新分类") => {
      const id = createNovelId("pcat");
      callMutate((current) => ({
        ...current,
        categories: [
          ...current.categories,
          {
            id,
            characterId: current.character.id,
            name,
            systemId: "",
            sortOrder:
              current.categories.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1,
          },
        ],
      }));
      return id;
    },
    [callMutate],
  );

  /**
   * 改分类名 / 换绑体系。改名会传播到物品行；与既有分类撞名时拒绝改名
   * （名字是物品行的关联键，重复会让「按名字找分类」出现二义），
   * 调用方据返回值提示。
   */
  const updateCategory = useCallback(
    (id: string, patch: Partial<Pick<PackCategory, "name" | "systemId">>): boolean => {
      let ok = true;
      callMutate((current) => {
        const row = current.categories.find((category) => category.id === id);
        if (!row) return current;
        let nextName = row.name;
        if (patch.name !== undefined && patch.name !== row.name) {
          const duplicated = current.categories.some(
            (category) => category.id !== id && category.name === patch.name,
          );
          if (duplicated) {
            ok = false;
            return current;
          }
          nextName = patch.name;
        }
        return {
          ...current,
          categories: current.categories.map((category) =>
            category.id === id
              ? {
                  ...category,
                  name: nextName,
                  systemId: patch.systemId ?? category.systemId,
                }
              : category,
          ),
          // 改名传播：物品行的 category 存的是名字
          items:
            nextName !== row.name
              ? current.items.map((item) =>
                  item.category === row.name
                    ? { ...item, category: nextName, updatedAt: Date.now() }
                    : item,
                )
              : current.items,
        };
      });
      return ok;
    },
    [callMutate],
  );

  /** 删除分类：分类下物品退回「未分类」。返回受影响物品数，供确认框报数 */
  const removeCategory = useCallback(
    (id: string): number => {
      let affected = 0;
      callMutate((current) => {
        const row = current.categories.find((category) => category.id === id);
        if (!row) return current;
        affected = current.items.filter((item) => item.category === row.name).length;
        return {
          ...current,
          categories: current.categories.filter((category) => category.id !== id),
          items: current.items.map((item) =>
            item.category === row.name
              ? { ...item, category: "", updatedAt: Date.now() }
              : item,
          ),
        };
      });
      return affected;
    },
    [callMutate],
  );

  // ── 物品（M3） ──
  /**
   * 新增物品。返回新条目的 id（调用方按它继续操作，如立刻展开详情行）。
   *
   * 不再有「满格拒绝」：格数上限随负重 / 容量一起下线（REQ-033 撤销），
   * 物品栏现在是纯清单，加多少条由作者自己决定。
   */
  const addItem = useCallback(
    (partial: Partial<PackItem> = {}): string | null => {
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
            groupId: partial.groupId ?? "",
            gradeId: partial.gradeId ?? "",
            qty: partial.qty ?? 1,
            rarity: partial.rarity ?? "common",
            icon: partial.icon ?? "",
            desc: partial.desc ?? "",
            tags: partial.tags ?? [],
            equippedSlotId: "",
            slotIndex: null,
            sourceChapterId: partial.sourceChapterId ?? "",
            updatedAt: Date.now(),
          },
        ],
      }));
      return id;
    },
    [callMutate],
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
  const quickAddRef = useRef<(request: PackQuickAddRequest) => string | null>(
    () => null,
  );
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
        (candidate) =>
          candidate.equippedSlotId === slotId && candidate.id !== itemId,
      );
      let target = slotIndex;
      if (target === undefined) {
        const used = new Set(
          occupants.map((candidate) => candidate.slotIndex ?? 0),
        );
        target = 0;
        while (used.has(target) && target < slot.capacity) target += 1;
      }
      if (target >= slot.capacity) {
        // 满位：把冲突对象交回给调用方，由 UI 决定替换谁
        return {
          ok: false,
          conflict:
            occupants.find(
              (candidate) => (candidate.slotIndex ?? 0) === target,
            ) ??
            occupants[0] ??
            null,
        };
      }
      callMutate((state) => ({
        ...state,
        items: state.items.map((candidate) =>
          candidate.id === itemId
            ? {
                ...candidate,
                equippedSlotId: slotId,
                slotIndex: target ?? 0,
                updatedAt: Date.now(),
              }
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
            return {
              ...candidate,
              equippedSlotId: slotId,
              slotIndex,
              updatedAt: Date.now(),
            };
          }
          if (
            candidate.equippedSlotId === slotId &&
            (candidate.slotIndex ?? 0) === slotIndex
          ) {
            return {
              ...candidate,
              equippedSlotId: "",
              slotIndex: null,
              updatedAt: Date.now(),
            };
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
            ? {
                ...item,
                equippedSlotId: "",
                slotIndex: null,
                updatedAt: Date.now(),
              }
            : item,
        ),
      }));
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
        showToast(
          "当前没有穿戴任何装备，方案会是空的，先穿几件再存",
          "warning",
        );
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
          preset.id === id
            ? { ...preset, name, updatedAt: Date.now() }
            : preset,
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
  const presetReadout = useCallback((preset: PackPreset): PresetReadout => {
    const current = docRef.current;
    return readPreset(
      parsePresetPayload(preset.payload),
      current?.items ?? [],
      current?.slots ?? [],
    );
  }, []);

  const applyPresetById = useCallback(
    (presetId: string) => {
      const current = docRef.current;
      const preset = current?.presets.find((item) => item.id === presetId);
      if (!current || !preset) return;
      const entries = parsePresetPayload(preset.payload);
      // 先算一遍给提示用；真正的写入在 mutator 里按**当时**的文档重算
      // （两次之间隔着一次 setState，不能拿旧结果去写新文档）。
      const preview: ApplyPresetResult = applyPreset(
        current.items,
        entries,
        current.slots,
      );
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
            groupId: partial.groupId ?? "",
            enabled: partial.enabled ?? true,
            proficiencyRaw: partial.proficiencyRaw ?? 0,
            gradeId: partial.gradeId ?? "",
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
          skill.id === id
            ? { ...skill, ...patch, updatedAt: Date.now() }
            : skill,
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
    (
      ownerType: PackModifier["ownerType"],
      ownerId: string,
      nature: PackModifier["nature"],
    ) => {
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
          // 1.39.1 起释放型也是属性加成：默认挂到第一个属性，作者再改
          targetAttrId: current.attrDefs[0]?.id ?? "",
          op: "add",
          value: 0,
          valueUnit: "",
          scaleByProficiency: false,
          // 持续型默认关：需要作者显式开启才计入（§9.2.1）
          active: false,
          defaultOn: false,
          cost: "",
          cooldown: null,
          duration: "",
          // 新增的效果默认不限时（NULL）：给个「1 回合」会让它下一拍就自己过期
          roundsLeft: null,
          target: "",
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
          {
            ...current,
            modifiers: current.modifiers.filter((mod) => mod.id !== id),
          },
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
            targetAttrId: partial.targetAttrId ?? state.attrDefs[0]?.id ?? "",
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
  //
  // Phase 3 起熟练度体系允许多套并存（修为 / 剑意）：`create: true` 跳过
  // 「按用途找现有那套」直接追加；其余路径保持旧行为 —— 传 id 按 id 改，
  // 没传 id 按用途匹配（货币模板 / 熟练度模板的既有调用都不带 id）。
  const upsertUnitSystem = useCallback(
    (
      kind: "ladder" | "ratio" | "threshold",
      use: "currency" | "proficiency",
      patch: {
        id?: string;
        name?: string;
        levels?: unknown;
        config?: Record<string, unknown>;
        /** 强制新建一套（多熟练度体系的「新增体系」入口） */
        create?: boolean;
      },
    ) => {
      callMutate((current) => {
        const byUse = () =>
          current.unitSystems.find((system) => {
            try {
              const config = JSON.parse(system.config || "{}") as {
                use?: string;
              };
              return config.use === use;
            } catch {
              return false;
            }
          });
        const existing = patch.create
          ? undefined
          : patch.id
            ? (current.unitSystems.find((system) => system.id === patch.id) ??
              byUse())
            : byUse();
        if (existing) {
          return {
            ...current,
            unitSystems: current.unitSystems.map((system) =>
              system.id === existing.id
                ? {
                    ...system,
                    kind,
                    name: patch.name ?? system.name,
                    levels: patch.levels
                      ? JSON.stringify(patch.levels)
                      : system.levels,
                    config: JSON.stringify({
                      ...JSON.parse(system.config || "{}"),
                      use,
                      ...(patch.config ?? {}),
                    }),
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

  /**
   * 套用熟练度模板（入门 / 熟练 / 大师）。
   *
   * 与货币模板成对：货币那边一直有这个入口，熟练度却只在量纲弹窗里能建 ——
   * 于是「熟练度开着、数值能填、但档位一个都看不到」成为常态，作者也找不到
   * 建立档位的地方（用户报障）。技能栏在「没有档位体系」时直接给出这个动作。
   */
  const applyProficiencyTemplate = useCallback(() => {
    upsertUnitSystem("threshold", "proficiency", {
      name: "熟练度",
      levels: PROFICIENCY_TEMPLATE,
    });
    showToast("已套用熟练度模板（入门 / 熟练 / 大师）", "success");
  }, [upsertUnitSystem, showToast]);

  // ── 模块拼装（E-1） ──
  const setModuleEnabled = useCallback(
    (key: PackModuleKey, enabled: boolean) => {
      callMutate((current) => {
        const exists = current.layouts.some(
          (layout) => layout.moduleKey === key,
        );
        const fallback =
          DEFAULT_LAYOUTS.find((layout) => layout.key === key)?.sortOrder ?? 99;
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
        const byKey = new Map(
          current.layouts.map((layout) => [layout.moduleKey, layout]),
        );
        const next: PackLayout[] = [];
        orderedKeys.forEach((key, index) => {
        const stored = byKey.get(key);
        next.push({
          characterId: current.character.id,
          moduleKey: key,
          // 缺失行沿用「核心三块启用」的出厂口径（与 mergeLayouts 同一规则）
          enabled: stored?.enabled ?? isCorePackModule(key),
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

  const toggleModuleCollapsed = useCallback((key: PackModuleKey) => {
    // 折叠属于界面偏好：即改即存，不计入未保存改动（PRD §8.6.2 反面清单）
    setPrefs((previous) => ({
      ...previous,
      collapsed: { ...previous.collapsed, [key]: !previous.collapsed[key] },
    }));
  }, []);

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

  /**
   * 改主角名。
   *
   * 名字的单一事实源是**要素库的实体**（绑定了主角时）：这里经 `novel-pack-rename`
   * 落库 —— 主进程按「绑没绑实体」决定改实体名还是改行囊内那格，并把最终名字
   * 回带。**不在本地自己拼**，因为「到底哪个名字生效」这件事只有库知道
   * （实体可能已被删、名可能被别的窗口改过）。
   *
   * 为什么不用 `mutate` 走草稿：名字与装备/属性不同，它不是「行囊里的设定数据」
   * 而是一格**跨模块共享的实体信息**（右侧要素栏 / 角色卡都显示同一个名字）。
   * 走草稿会让「行囊里改了名、要素库没变」，且保存后两边再次分叉 —— 与主角绑定
   * 同一判据（PRD §8.6.2「改了这个值别人的地方会变吗」→ 会）。
   *
   * 落库成功后：① 广播（要素库 / 别的窗口的同一格跟着变）；
   * ② 刷新本窗口文档里的 displayName（头部立刻显示新名）。
   */
  const renameCharacter = useCallback(
    async (name: string) => {
      const current = docRef.current;
      const workId = current?.character.workId;
      if (!current || !workId) return;
      const trimmed = name.trim();
      if (
        !trimmed ||
        trimmed === (current.character.displayName || current.character.name)
      ) {
        return;
      }
      const result = await renamePackCharacter(workId, trimmed).catch(
        () => null,
      );
      if (!result || !result.ok) {
        showToast("改名失败，请重试", "error");
        return;
      }
      mutate((doc) => ({
        ...doc,
        character: {
          ...doc.character,
          displayName: result.displayName,
          // 未绑定时主进程改的是行囊内那格，name 也要跟上，否则再次装载会打回旧名
          name:
            result.target === "character"
              ? result.displayName
              : doc.character.name,
        },
      }));
      notifyNameChanged(
        workId,
        result.displayName,
        "pack",
        result.target === "entity" ? current.character.entityId : "",
      );
    },
    [mutate, showToast],
  );

  // ── 效果编辑器入口（装备 / 技能 / 状态共用一套） ──
  const openEffectEditor = useCallback(
    (
      ownerType: PackModifier["ownerType"],
      ownerId: string,
      title: string,
      modifierId?: string,
    ) => {
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

  /*
   * 按 (ownerType, ownerId) 预建索引，一次建表供整棵面板复用。
   *
   * 原先每次调用都 filter + sort 全表一遍，而它在装备栏 / 技能栏 / 背包
   * 的**每一行**渲染里被调用（背包同一处还连调两次）：300 条加成 × 20 个
   * 宿主 ≈ 每次渲染几千次比较。更关键的是每次都返回新数组引用，直接把
   * 下游 `ModifierList` 的 groups memo 判成恒失效。
   */
  const modifiersByOwner = useMemo(() => {
    const map = new Map<string, PackModifier[]>();
    for (const mod of doc?.modifiers ?? []) {
      const key = `${mod.ownerType}:${mod.ownerId}`;
      const list = map.get(key);
      if (list) list.push(mod);
      else map.set(key, [mod]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [doc]);

  const modifiersOf = useCallback(
    (ownerType: PackModifier["ownerType"], ownerId: string): PackModifier[] =>
      // 空结果返回模块级常量：每次返回新 [] 会让下游 memo 白失效
      modifiersByOwner.get(`${ownerType}:${ownerId}`) ?? EMPTY_MODIFIERS,
    [modifiersByOwner],
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
        record.chapterId === chapterId &&
        (!oldest || record.takenAt < oldest.takenAt)
          ? record
          : oldest,
      null,
    );
  }, [meta.records, chapterId]);

  const dirtyHint = useMemo(() => {
    if (data.saveFailed)
      return { tone: "error" as const, text: "保存失败 · 草稿已保留" };
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
    categoryManagerOpen,
    setCategoryManagerOpen,
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
    groupOffCarriers,
    summary,
    mappings,
    previewEquipDeltas,
    rungs,
    realmPos,
    panelRealmPos,
    realmText,
    panelRealmText,
    /** 本书序号数字样式（REQ-052）：境界文案已并入，盘点记录的差异文案同样需要 */
    numberStyle,
    realmBound: Boolean(doc?.character.entityId),
    realmHint: doc?.character.entityId ? "" : UNBOUND_REALM_HINT,
    currencySystem,
    proficiencySystem,
    proficiencySystems,
    proficiencySchemes,
    schemeForSkill,
    unitSystemOf,
    gradeSystems,
    gradeNameOf,
    categorySystemIdOf,
    hasGradeSystems,
    /** 属性组合视图（def ∪ value，id = 定义 id）：展示组件统一消费这一份 */
    attrView,
    changedCount,
    isRecentlyChanged,
    buildModuleText,

    // 动作
    writeRealm,
    bindEntity,
    addAttribute,
    updateAttribute,
    removeAttribute,
    countModifiersOfAttribute,
    countMappingsOfAttribute,
    reorderAttributes,
    applyAttrTemplate,
    addMapping,
    updateMapping,
    removeMapping,
    reorderMappings,
    markAllChangesRead,
    addSlot,
    updateSlot,
    removeSlot,
    shrinkSlotCapacity,
    reorderSlots,
    addCategory,
    updateCategory,
    removeCategory,
    addItem,
    updateItem,
    removeItem,
    stepItemQty,
    equipItem,
    replaceInSlot,
    unequipItem,
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
    applyProficiencyTemplate,
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
    isCarrierActive: (
      ownerType: PackModifier["ownerType"],
      ownerId: string,
    ): boolean => activeCarriers.has(carrierKey(ownerType, ownerId)),

    // 关闭流程
    requestClose,
    natureMeta: NATURE_META,
  };
}

export type PackPanelApi = ReturnType<typeof usePackPanel>;
