import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createNovelId, logUsageEvent } from "../../../services/novel-service";
import { DEFAULT_LAYOUTS, QTY_MAX, registerPackCloser } from "../pack-config";
import {
  getPanelRealm,
  getRealm,
  setRealm,
  UNBOUND_REALM_HINT,
  type RealmState,
} from "../pack-realm";
import {
  buildActiveCarriers,
  carrierKey,
  carryRealm,
  clampRealm,
  computeSummary,
  formatRealm,
  sortLadder,
  stepQty,
  type LadderRung,
  type RealmPosition,
  type SummaryResult,
} from "../pack-utils";
import {
  fetchPackUiPrefsRaw,
  savePackUiPrefsRaw,
  writeLevelMeta,
  writeProtagonistBinding,
  writeRealmLink,
} from "../services/pack-service";
import {
  ATTR_TEMPLATES,
  DEFAULT_ATTR_GROUP,
  DEFAULT_UI_PREFS,
  NATURE_META,
  PACK_MODULES,
  type PackAttribute,
  type PackItem,
  type PackLayout,
  type PackModuleKey,
  type PackModuleState,
  type PackModifier,
  type PackSkill,
  type PackSlot,
  type PackUiPrefs,
  type PackUnitSystem,
} from "../types";
import { CURRENCY_TEMPLATE, PACK_PANEL } from "../pack-config";
import {
  notifyProtagonistChanged,
  notifyRealmLinkChanged,
  PACK_PROTAGONIST_EVENT,
  PACK_REALM_EVENT,
  readEventDetail,
  type PackProtagonistEventDetail,
  type PackRealmEventDetail,
} from "../pack-config";
import { usePackData, type PackDoc } from "./usePackData";
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
  const { doc, meta, mutate, syncMeta } = data;

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
  const [closeGuardOpen, setCloseGuardOpen] = useState(false);
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
    return buildActiveCarriers(
      doc.slots,
      doc.items,
      doc.skills,
      // ⚠️ 状态的载体键必须取 **效果自己的 id**，不能取 ownerId：
      // 所有 status 效果的 ownerId 都是同一个角色 id（多态表约定），用它会让
      // 全部状态折叠成单个 `status:<charId>` 键 —— 于是「全关」时 passive 状态
      // 被整条丢弃、「任一条 sustained 开着」时 passive 的开关彻底失效。
      statusModifiers.map((mod) => ({ id: mod.id, active: mod.active })),
    );
  }, [doc, statusModifiers]);

  const proficiency = useMemo(() => {
    const map: Record<string, number> = {};
    for (const skill of doc?.skills ?? []) map[skill.id] = skill.proficiencyRaw;
    return map;
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
      link: meta.realmLink,
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

  /** 通知实体面板重读同一行（§9.7.3 双向同步） */
  const notifyRealmChanged = useCallback(
    (link: RealmState["link"]) => {
      notifyRealmLinkChanged(doc?.character.workId ?? "", link, "pack");
    },
    [doc],
  );

  /** 境界的**唯一写入口**：所有境界改动都必须经过它（REQ-048 契约第 2 条） */
  const writeRealm = useCallback(
    async (
      position: RealmPosition,
      origin: "pack" | "r25",
      options: { carry?: boolean; delta?: number } = {},
    ): Promise<void> => {
      if (!doc || rungs.length === 0) return;
      const next = options.carry
        ? carryRealm(rungs, position, options.delta ?? 0)
        : clampRealm(rungs, position);
      const plan = setRealm(realmState, position, origin, options);
      let changed = false;
      if (plan.link) {
        const link = { ...plan.link, id: plan.link.id || createNovelId("nl") };
        const ok = await writeRealmLink(link);
        if (ok) {
          notifyRealmChanged(link);
          changed = true;
        }
      }
      if (plan.realmRaw !== null) {
        mutate(
          (current) => ({
            ...current,
            character: { ...current.character, realmAt: plan.realmRaw ?? "" },
          }),
          1,
        );
        changed = true;
      }
      if (changed) {
        await data.syncMeta();
        showToast(`境界已更新：${formatRealm(rungs, next)}`, "success");
      }
    },
    [doc, rungs, realmState, mutate, data, notifyRealmChanged, showToast],
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
      mutate(
        (current) => ({ ...current, character: { ...current.character, entityId } }),
        0,
      );
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
      mutate(
        (current) =>
          current.character.entityId === next
            ? current
            : { ...current, character: { ...current.character, entityId: next } },
        0,
      );
      void data.syncMeta();
    };
    window.addEventListener(PACK_PROTAGONIST_EVENT, handler as EventListener);
    const api = window.electronAPI?.windowAPI;
    api?.on(PACK_PROTAGONIST_EVENT, handler);
    return () => {
      window.removeEventListener(PACK_PROTAGONIST_EVENT, handler as EventListener);
      api?.off(PACK_PROTAGONIST_EVENT, handler);
    };
  }, [workId, mutate, syncMeta]);

  /**
   * 右侧要素栏改了「当前境界」：这里重读同一行。
   *
   * 反向靠 `notifyRealmChanged`（本面板写入时广播）。两边都不订阅对方，
   * 就会出现「一边改了、另一边还显示旧值」——这正是「看着像同源、实际各说各话」。
   * 只重读元数据（`syncMeta`），不重载文档，避免吃掉未保存的编辑。
   */
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const detail = readEventDetail<PackRealmEventDetail>(args);
      if (!detail || typeof detail !== "object") return;
      if (detail.workId !== workId) return;
      // 自己写的已经读过元数据了，不为自己再重读一次
      if (detail.origin === "pack") return;
      const link = detail.link;
      // 与本人无关的要素（另一本书 / 另一张角色卡）不触发重读
      if (link && link.fromId !== docRef.current?.character.entityId) return;
      void data.syncMeta();
    };
    window.addEventListener(PACK_REALM_EVENT, handler as EventListener);
    const api = window.electronAPI?.windowAPI;
    api?.on(PACK_REALM_EVENT, handler);
    return () => {
      window.removeEventListener(PACK_REALM_EVENT, handler as EventListener);
      api?.off(PACK_REALM_EVENT, handler);
    };
  }, [workId, syncMeta]);

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
  useEffect(() => {
    if (!prefs.autoSave || data.dirty <= 0) return undefined;
    const timer = window.setTimeout(() => {
      void data.save("自动保存").then((ok) => {
        if (ok) showToast("已自动保存", "info");
      });
    }, AUTOSAVE_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [prefs.autoSave, data, lastEditAt, showToast]);

  // ── 关闭拦截（G-2） ──
  const requestClose = useCallback(async () => {
    if (data.dirty > 0) {
      setCloseGuardOpen(true);
      return;
    }
    await data.flushDraft();
    onClose();
  }, [data, onClose]);

  const confirmSaveAndClose = useCallback(async () => {
    const ok = await data.save("手动保存");
    if (!ok) {
      // 保存失败不能照样关闭：面板一卸载 `saveFailed` 状态就随组件消失，
      // 用户只会看到「改动没了」，却从没被告知保存失败。留在原地等他重试。
      setCloseGuardOpen(false);
      showToast("保存失败，草稿仍在本地，请在面板内重试", "error");
      return;
    }
    setCloseGuardOpen(false);
    onClose();
  }, [data, onClose, showToast]);

  const confirmDiscardAndClose = useCallback(async () => {
    await data.revertAll();
    setCloseGuardOpen(false);
    onClose();
  }, [data, onClose]);

  const cancelClose = useCallback(() => setCloseGuardOpen(false), []);

  // 外部关闭路径（顶栏图标 / Ctrl+Shift+B / 页面级 Esc）统一走这条桥。
  // requestClose 每次编辑都会变身份，若在 effect 依赖里直接放它，敲一个字就重注册
  // 一次 —— 用 ref 转发，注册只随 open 变动。
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);
  useEffect(() => {
    if (!open) return undefined;
    registerPackCloser(() => requestCloseRef.current());
    return () => registerPackCloser(null);
  }, [open]);

  // ═══════════════ 业务动作 ═══════════════

  const touch = useCallback(() => setLastEditAt(Date.now()), []);

  const callMutate = useCallback(
    (recipe: Parameters<typeof mutate>[0], dirtyDelta = 1) => {
      mutate(recipe, dirtyDelta);
      touch();
    },
    [mutate, touch],
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
          attr.id === id ? { ...attr, ...patch } : attr,
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

  const applyAttrTemplate = useCallback(    (templateName: string) => {
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
        }));
        return { ...current, attributes: [...current.attributes, ...created] };
      }, template.length);
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
  const addItem = useCallback(
    (partial: Partial<PackItem> = {}) => {
      const id = createNovelId("pi");
      callMutate((current) => ({
        ...current,
        items: [
          ...current.items,
          {
            id,
            characterId: current.character.id,
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
            updatedAt: Date.now(),
          },
        ],
      }));
      return id;
    },
    [callMutate],
  );

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
          skill.id === id ? { ...skill, ...patch } : skill,
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
            ? { ...skill, proficiencyRaw: Math.max(0, skill.proficiencyRaw + delta) }
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
          target: nature === "cast" ? "单体" : "",
          trigger: "",
          condition: "",
          note: "",
          disabled: false,
          sortOrder: ownerMods.length + 1,
        };
        return { ...current, modifiers: [...current.modifiers, blank] };
      });
      void logUsageEvent("pack_effect_add", { ownerType, nature });
      return id;
    },
    [callMutate],
  );

  const updateModifier = useCallback(
    (id: string, patch: Partial<PackModifier>) => {
      callMutate((current) => ({
        ...current,
        modifiers: current.modifiers.map((mod) =>
          mod.id === id ? { ...mod, ...patch } : mod,
        ),
      }));
    },
    [callMutate],
  );

  const removeModifier = useCallback(
    (id: string) => {
      callMutate((current) => ({
        ...current,
        modifiers: current.modifiers.filter((mod) => mod.id !== id),
      }));
    },
    [callMutate],
  );

  const duplicateModifier = useCallback(
    (id: string) => {
      callMutate((current) => {
        const source = current.modifiers.find((mod) => mod.id === id);
        if (!source) return current;
        return {
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
        };
      });
    },
    [callMutate],
  );

  /** 持续型效果自己的开关（与载体开关完全分离，REQ-039） */
  const toggleModifierActive = useCallback(
    (id: string) => {
      callMutate((current) => ({
        ...current,
        modifiers: current.modifiers.map((mod) =>
          mod.id === id ? { ...mod, active: !mod.active } : mod,
        ),
      }));
    },
    [callMutate],
  );

  const toggleModifierDisabled = useCallback(
    (id: string) => {
      callMutate((current) => ({
        ...current,
        modifiers: current.modifiers.map((mod) =>
          mod.id === id ? { ...mod, disabled: !mod.disabled } : mod,
        ),
      }));
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
    closeGuardOpen,
    inventoryKeyword,
    setInventoryKeyword,

    // 派生
    modules,
    enabledModules,
    moduleOf,
    statusModifiers,
    activeCarriers,
    summary,
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
    /** 判定某载体当前是否在效（闸门 1，组件渲染徽标 / 停用态时用） */
    isCarrierActive: (ownerType: PackModifier["ownerType"], ownerId: string): boolean =>
      activeCarriers.has(carrierKey(ownerType, ownerId)),

    // 关闭流程
    requestClose,
    confirmSaveAndClose,
    confirmDiscardAndClose,
    cancelClose,
    natureMeta: NATURE_META,
  };
}

export type PackPanelApi = ReturnType<typeof usePackPanel>;
