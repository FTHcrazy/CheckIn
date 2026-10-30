import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearPackDraft,
  fetchPackRecords,
  loadPackBundle,
  putPackDraft,
  savePackDocument,
} from "../services/pack-service";
import {
  notifyRealmLinkChanged,
  PACK_QUICK_ADDED_EVENT,
  readEventDetail,
  type PackQuickAddedEventDetail,
} from "../pack-config";
import { countNetChanges } from "../pack-dirty";
import type {
  PackAttrDef,
  PackBundleDTO,
  PackCategory,
  PackCharacter,
  PackGradeSystem,
  PackGroup,
  PackLayout,
  PackLevelSystem,
  PackMapping,
  PackModifier,
  PackPreset,
  PackRealmLink,
  PackRecord,
  PackUnitSystem,
} from "../types";
import type { PackAttrValue, PackItem, PackSkill, PackSlot } from "../types";
import { DRAFT_DEBOUNCE_MS } from "../types";
import { subscribeDualChannel } from "@/shared/novel/dual-channel";

/**
 * 一份完整的行囊文档（与草稿 payload / 正式表同构）
 *
 * 刻意不包含「界面偏好」——形态、宽度、折叠、视图、展示熟练度这些
 * 即改即存的项走 config，不进草稿（PRD §8.6.2 的边界定义）。
 */
export interface PackDoc {
  character: PackCharacter;
  /** 属性定义（作品级，1.39.0）：「这本书有哪些属性」的模型 */
  attrDefs: PackAttrDef[];
  /** 属性数值（角色级实例，defId 引用 attrDefs）。展示用组合视图走 `composeAttributes` */
  attributes: PackAttrValue[];
  /** 属性映射（1.35.0）：与属性同属设定数据，随草稿与盘点走 */
  mappings: PackMapping[];
  slots: PackSlot[];
  /** 载体分组（1.39.0 二期）：条目 groupId 引用这里的 id */
  groups: PackGroup[];
  /** 物品分类管理（1.40.0）：item.category 按名字引用这里的行 */
  categories: PackCategory[];
  items: PackItem[];
  skills: PackSkill[];
  modifiers: PackModifier[];
  unitSystems: PackUnitSystem[];
  layouts: PackLayout[];
  /** 换装方案（REQ-032）：与其它表一样属于设定数据，随草稿走 */
  presets: PackPreset[];
  /**
   * 「当前境界」绑定（novel_links 的 LEVEL_RELATION 行）。
   *
   * 原本即时落库、只存在于 meta；现按「行囊改动一律草稿化」的要求随草稿走：
   * 编辑只改这里，保存时若与上次保存态有差异才写 novel_links 并广播。
   * meta.realmLink 继续保留库内真值镜像（外部改动经 syncMeta 进来）。
   */
  realmLink: PackRealmLink | null;
}

export interface PackMeta {
  records: PackRecord[];
  levelSystems: PackLevelSystem[];
  /** 体系品阶投影（1.40.0）：设定域全部分类的根阶清单，物品 / 技能选品阶用 */
  gradeSystems: PackGradeSystem[];
  realmLink: PackRealmLink | null;
}

export type DirtyReason = "手动保存" | "自动保存" | "撤销到上次保存";

function fromBundle(bundle: PackBundleDTO): PackDoc | null {
  if (!bundle.character) return null;
  return {
    character: bundle.character,
    attrDefs: bundle.attrDefs ?? [],
    attributes: bundle.attributes,
    mappings: bundle.mappings ?? [],
    slots: bundle.slots,
    groups: bundle.groups ?? [],
    categories: bundle.categories ?? [],
    items: bundle.items,
    skills: bundle.skills,
    modifiers: bundle.modifiers,
    unitSystems: bundle.unitSystems,
    layouts: bundle.layouts,
    presets: bundle.presets ?? [],
    realmLink: bundle.realmLink,
  };
}

function parseDraft(payload: string): PackDoc | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") return null;
    const doc = parsed as Partial<PackDoc>;
    if (!doc.character || !doc.character.id) return null;
    return {
      character: doc.character,
      attrDefs: doc.attrDefs ?? [],
      attributes: doc.attributes ?? [],
      // `?? []` 是兼容旧草稿：属性映射引入之前写下的草稿没有这一格，
      // 少了兜底会让整份草稿被当成残缺而丢掉（里面是作者全部未保存的改动）
      mappings: doc.mappings ?? [],
      slots: doc.slots ?? [],
      groups: doc.groups ?? [],
      categories: doc.categories ?? [],
      items: doc.items ?? [],
      skills: doc.skills ?? [],
      modifiers: doc.modifiers ?? [],
      unitSystems: doc.unitSystems ?? [],
      layouts: doc.layouts ?? [],
      presets: doc.presets ?? [],
      realmLink: doc.realmLink ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 行囊数据层（装载 / 草稿 / 保存 / 回退）
 *
 * 关键设计（PRD §8.6）：
 * - 编辑只改内存 + 标脏 + 防抖写草稿；**写库只发生在「保存」**
 * - 保存前主进程先对改动前状态生成盘点记录 → 「撤销到上次保存」才有回退点
 * - 草稿落主进程表（跨窗口一份，崩溃不丢）
 */
export function usePackData(workId: string, chapterId: string) {
  const [loading, setLoading] = useState(true);
  const [doc, setDocState] = useState<PackDoc | null>(null);
  const [meta, setMeta] = useState<PackMeta>({
    records: [],
    levelSystems: [],
    gradeSystems: [],
    realmLink: null,
  });
  /**
   * 未保存改动处数 —— **派生值**，不是自增计数器（见 `pack-dirty.ts`）。
   *
   * 计数器版本在输入框上是错的：`updateAttribute(id, {name})` 每敲一个字调一次，
   * 「破境丹」= 3 处改动。这里只在**文档或基线真的变了**时重算一次，
   * 口径是「新增 / 修改 / 删除 / 移动的最终净变化」。
   */
  const [dirty, setDirty] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [loadError, setLoadError] = useState("");

  /** 上次保存态（内存镜像）：撤销全部改动回到这里 */
  const savedRef = useRef<PackDoc | null>(null);
  const draftTimerRef = useRef<number | null>(null);
  const docRef = useRef<PackDoc | null>(null);
  const dirtyRef = useRef(0);
  /**
   * 是否正在保存（同步标志，与 `saving` state 不同——state 更新是异步的，
   * 卸载 flush 这类同步路径读不到最新值）。
   *
   * 立身之本：`save()` 成功后主进程会清空草稿，但组件若在 `await` 期间卸载，
   * 卸载 cleanup 里的 `flushDraft()` 会拿**尚未重算为 0 的 dirtyRef** 再写一次
   * 脏草稿 → 库中已是新版文档、草稿却是旧脏版 → 下次打开草稿优先 → 用户看到
   * 「保存了却回退了」。`flushDraft` 据此跳过，让库中正式行成为唯一真相。
   */
  const savingRef = useRef(false);

  /**
   * 重算未保存处数。
   *
   * 唯一的写入口是它 —— 不要再往回调 `setDirty((n) => n + 1)`，那正是被换掉的
   * 计数器口径（敲 3 个字算 3 处）。基线取自 `savedRef`（上次保存态镜像）。
   *
   * 传 `baseline` 参数是为了「刚刚保存完」这一帧：此时 `savedRef.current` 已被
   * 推进到新文档，但 `docRef.current` 也已是同一份 → 差值为 0，正合预期。
   */
  const recomputeDirty = useCallback((next: PackDoc | null): void => {
    setDirty(countNetChanges(savedRef.current, next));
  }, []);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const applyBundle = useCallback((bundle: PackBundleDTO) => {
    const formal = fromBundle(bundle);
    savedRef.current = formal;
    const draft = bundle.draft ? parseDraft(bundle.draft.payload) : null;
    // ⚠️ 主角绑定（`character.entityId`）**永远以库里的正式行为准**，不从草稿取。
    // 它不是「设定数据」而是跨模块共享的一格（判据见 PRD §8.6.2「改了这个值
    // 别人的书会变吗」）：写入口唯一、即时落库，草稿只是编辑过程的中间态。
    // 否则会出现「右侧卡上戴着皇冠、行囊里还写着未指定」——因为草稿里存的是
    // 设主角之前那份快照，而草稿优先于正式行。
    const merged =
      draft && formal
        ? {
            ...draft,
            character: {
              ...draft.character,
              entityId: formal.character.entityId,
            },
            // 境界绑定随草稿走，但旧草稿（该字段引入前写的）没有这一格，
            // 不能让 `?? null` 把库里已有的绑定抹掉
            realmLink: draft.realmLink ?? formal.realmLink,
          }
        : (draft ?? formal);
    docRef.current = merged;
    setDocState(merged);
    // 计数一律以 savedRef（正式行基线）与当前文档的净差异重算 —— 草稿里存的
    // `dirtyCount` 是旧计数器口径的产物，只在没有正式行可比时当作兜底参考。
    // 重算的好处：装载后立刻是准确的（草稿里被改回去的部分不会算进来）。
    setDirty(formal ? countNetChanges(formal, merged) : (bundle.draft?.dirtyCount ?? 0));
    setSavedAt(bundle.records[0]?.takenAt ?? 0);
    setMeta({
      records: bundle.records,
      levelSystems: bundle.levelSystems,
      gradeSystems: bundle.gradeSystems ?? [],
      realmLink: bundle.realmLink,
    });
  }, []);

  // 装载：workId 变化时整体重来（首次使用由主进程播种主角与通用部位）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void loadPackBundle(workId)
      .then((bundle) => {
        if (cancelled) return;
        applyBundle(bundle);
      })
      .catch(() => {
        if (!cancelled) setLoadError("行囊数据装载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workId, applyBundle]);

  /**
   * 只把「展示名」从正式行同步进当前文档（换绑主角 / 要素库改名后）。
   *
   * 为什么单拎出来而不整体 replace：换绑发生在**别的界面**（右侧要素栏），
   * 此时行囊里可能正有未保存的编辑 —— 整体替换会把它们冲掉。
   * `displayName` 是纯派生值（由绑定的实体算出），独立刷新它没有副作用。
   */
  const putBundleCharacterName = useCallback((character: PackCharacter): void => {
    const current = docRef.current;
    if (!current) return;
    const displayName = character.displayName || character.name;
    if (current.character.displayName === displayName) return;
    const next: PackDoc = {
      ...current,
      character: { ...current.character, displayName },
    };
    docRef.current = next;
    setDocState(next);
  }, []);

  /** 只刷新元数据（盘点记录 / 等级体系 / 境界绑定），不覆盖正在编辑的文档 */
  const syncMeta = useCallback(async (): Promise<PackMeta | null> => {
    try {
      const bundle = await loadPackBundle(workId);
      const next: PackMeta = {
        records: bundle.records,
        levelSystems: bundle.levelSystems,
        gradeSystems: bundle.gradeSystems ?? [],
        realmLink: bundle.realmLink,
      };
      setMeta(next);
      if (bundle.character && !docRef.current) {
        const formal = fromBundle(bundle);
        savedRef.current = formal;
        docRef.current = formal;
        setDocState(formal);
        // 首次拿到的正式行即基线 → 净差异必然为 0
        setDirty(0);
      } else if (bundle.character && docRef.current) {
        /**
         * 文档已存在时也要跟两格：`displayName` 与 `realmLink`。
         *
         * `displayName` 由「绑定的是哪个实体」派生（见主进程 `toCharacterDto`），
         * 换绑主角后必须重算 —— 否则行囊头部会一直显示旧主角的名字。
         *
         * `realmLink` 同理但更隐蔽：换绑只改 `entityId` 那一格，文档里的
         * realmLink 仍留着**旧实体的 fromId**，而 `realmState.link` 优先取
         * doc —— 不换就会显示旧主角的境界，保存时还会把新主角的境界写到旧
         * 实体名下。仅在落点确实换了人时整体替换；未绑定时库内没有关系行
         * （§9.7.5「不绑定就不写 novel_links」），显式置空。
         *
         * 只动这两格，不整体替换文档：换绑发生在右侧要素栏，此时行囊里可能正有
         * 未保存的编辑，整体 replace 会把它们冲掉（这正是 syncMeta 的立身之本）。
         * 绑定那一格 `entityId` 由调用方（bindEntity / 事件监听）自己写。
         */
        putBundleCharacterName(bundle.character);
        const current = docRef.current;
        if ((current.realmLink?.fromId ?? "") !== bundle.character.entityId) {
          const link = next.realmLink;
          const patched: PackDoc = {
            ...current,
            realmLink: link ? { ...link, note: link.note ?? "" } : null,
          };
          docRef.current = patched;
          setDocState(patched);
          // realmLink 参与净变化计数（pack-dirty 的 realmSignature）：
          // 换了人就是一处未保存改动，下次保存才会把新绑定写进 novel_links
          // （幂等）并广播 —— 与「外部改了境界」的同步路径同一口径
          recomputeDirty(patched);
        }
      }
      return next;
    } catch {
      return null;
    }
  }, [workId, putBundleCharacterName, recomputeDirty]);

  /**
   * 把「别的渲染进程记的账」合并进当前文档（跨窗口快速记账，REQ-027）。
   *
   * 编辑器窗口里本地记账桥够不着（`runPackQuickAdd` 只在本渲染进程有效），
   * 于是落主进程：有草稿并草稿、没有直插正式表。本窗口的内存文档对这次
   * 写入**不知情** —— 不合并的话，下一次整文档保存连草稿一起清，刚记的
   * 物品凭空消失（纯静默的数据丢失）。
   *
   * 按 `itemId` 定位，**已存在就跳过**：广播可能重复到达（双通道各发一次、
   * 切网重连），合并必须幂等。装载失败静默返回 —— 不影响本地编辑，下次
   * 装载时这条物品本来就在草稿 / 正式表里，会自然带上。
   */
  const mergeExternalItem = useCallback(
    async (itemId: string): Promise<void> => {
      const current = docRef.current;
      if (!current || !itemId) return;
      if (current.items.some((item) => item.id === itemId)) return;
      let bundle: PackBundleDTO;
      try {
        bundle = await loadPackBundle(workId);
      } catch {
        return;
      }
      // 主进程两条落库路径都可能命中：无草稿时在正式表里，有草稿时在草稿里
      const draft = bundle.draft ? parseDraft(bundle.draft.payload) : null;
      const item =
        draft?.items.find((row) => row.id === itemId) ??
        bundle.items.find((row) => row.id === itemId);
      if (!item) return;
      // 等待装载的期间本地可能已经加过同 id 的物品（或文档被整体换掉），再判一次
      const latest = docRef.current;
      if (!latest || latest.items.some((row) => row.id === itemId)) return;
      const next: PackDoc = { ...latest, items: [...latest.items, item] };
      docRef.current = next;
      setDocState(next);
      recomputeDirty(next);
    },
    [workId, recomputeDirty],
  );

  /**
   * 订阅「记账成功」广播（跨窗口快速记账）。
   *
   * 双通道与其它行囊事件一致：同窗口 CustomEvent + 跨窗口 broadcast
   * （广播刻意排除发送者，所以两条都要接；`workId` 过滤别的作品）。
   */
  useEffect(() => {
    const handler = (...args: unknown[]): void => {
      const detail = readEventDetail<PackQuickAddedEventDetail>(args);
      if (!detail || typeof detail !== "object") return;
      if (detail.workId !== workId || !detail.itemId) return;
      void mergeExternalItem(detail.itemId);
    };
    return subscribeDualChannel(PACK_QUICK_ADDED_EVENT, handler);
  }, [workId, mergeExternalItem]);

  /**
   * 唯一的编辑入口：所有改动都经过它 → 重算净变化 → 防抖写草稿。
   *
   * ⚠️ 第二参数保留只为**不改动几十个调用点**，不再参与计数。
   *
   * 早期是 `dirtyDelta` 自增计数器（批量操作传条目数），但输入框每次 `onChange`
   * 都调一次 mutate，于是「破境丹」算 3 处、改回原样仍显示改过 —— 与作者要的
   * 「净变化」不符。现在计数一律由 `countNetChanges(savedRef, doc)` 派生，
   * 与调了多少次、每次建了几条都无关。
   */
  const mutate = useCallback(
    (recipe: (current: PackDoc) => PackDoc) => {
      /**
       * ⚠️ 不要改回 `setDocState((prev) => …)` 的 updater 形式。
       *
       * 之前是 updater 内部顺手标脏，而 **updater 必须是纯函数**：
       * StrictMode 下它会连跑两次，于是每次编辑都被记两次。这里先算后写，
       * 副作用留在 updater 外面。
       *
       * 代价是要自己推进 `docRef`：同一 tick 内连续多次 mutate（批量操作）
       * 读到的不能还是旧文档，否则后一次会把前一次的改动盖掉。
       */
      const prev = docRef.current;
      if (!prev) return;
      const next = recipe(prev);
      if (next === prev) return;
      docRef.current = next;
      setDocState(next);
      recomputeDirty(next);
    },
    [recomputeDirty],
  );

  /**
   * 不产生「新增/修改/删除」语义的文档替换（如绑定实体后同步境界行）。
   *
   * 计数仍然要重算 —— 境界那一格本身就参与净变化，跳过会让「改了境界」不计数。
   * 重算而非自增，所以它天然只在真的变了时才 +1。
   */
  const replaceDoc = useCallback(
    (next: PackDoc) => {
      // 与 mutate 同理：docRef 是「当前文档」的唯一真相，必须同步推进，
      // 否则紧随其后的一次 mutate 会基于旧文档计算、把这次替换盖掉
      docRef.current = next;
      setDocState(next);
      recomputeDirty(next);
    },
    [recomputeDirty],
  );

  // 草稿防抖写入（§9.6 问题 5：800ms 防抖；关闭面板时另有必写路径）
  useEffect(() => {
    if (!doc || dirty <= 0) return undefined;
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      void putPackDraft(doc.character.id, JSON.stringify(doc), dirty);
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [doc, dirty]);

  /** 关闭面板 / 切章 / 退出前的必写：确保草稿一定落库 */
  const flushDraft = useCallback(async (): Promise<void> => {
    const current = docRef.current;
    if (!current || dirtyRef.current <= 0) return;
    // 正在保存 → 跳过。保存成功后主进程已清空草稿、库中为最新文档；此时再写
    // 一次（dirtyRef 可能尚未重算为 0，因卸载发生在 await 期间）会留下**旧脏
    // 草稿**，下次装载草稿优先 → 用户看到「保存了却回退了」。
    if (savingRef.current) return;
    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    // P3-6：IPC reject 必须就地收住（仿编辑器 store 的 persistChapterNow 先例）。
    // 本函数有两个调用方：cleanup 里的 `void flushDraft()`（reject 即 unhandled
    // rejection）与面板 requestGuard 里的 await（reject 会把整个裁决链打断，
    // 用户卡在弹窗/切章上）。失败按 save() 的语义置 saveFailed —— 草稿仍在
    // 内存、脏数不清零，用户可经手动保存重试。
    try {
      await putPackDraft(current.character.id, JSON.stringify(current), dirtyRef.current);
    } catch {
      setSaveFailed(true);
    }
  }, []);

  /**
   * 卸载前 / 切作品前兜底 flush。
   *
   * 依赖里放 `workId` 不是为了在新作品上做什么，而是让 **cleanup 在换书的那一
   * 帧先跑一次** —— 此时 `docRef` 还是上一部作品的文档。防抖是 800ms，连续打字
   * 时每帧重置计时器，若组件在这期间被卸载或换书，整段连续输入就没机会落库了。
   * 卸载路径（远多于换书）也由同一条 cleanup 覆盖。
   */
  useEffect(
    () => () => {
      void flushDraft();
    },
    [workId, flushDraft],
  );

  const save = useCallback(
    async (reason: DirtyReason = "手动保存"): Promise<boolean> => {
      const current = docRef.current;
      if (!current) return false;
      // 进入保存态：置 savingRef（同步，卸载 flush 读得到）+ 取消在途草稿防抖
      // （保存成功会由主进程清空草稿，这里再落一次纯属多余且可能覆盖）
      savingRef.current = true;
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      setSaving(true);
      setSaveFailed(false);
      // 境界绑定随文档一起提交：与上次保存态比较，有差异才带上 realmLink
      // （主进程在同事务内幂等 upsert；无差异传 null 表示不动关联行）。
      // 未绑定（link 为 null）不产生写库 —— 与 §9.7.5「不绑定就不写 novel_links」一致。
      const prevLink = savedRef.current?.realmLink ?? null;
      const nextLink = current.realmLink;
      const linkChanged = nextLink != null && JSON.stringify(prevLink) !== JSON.stringify(nextLink);
      let ok: boolean;
      try {
        ok = await savePackDocument({
          ...current,
          // 只在确有变化时携带；否则显式 null（主进程不碰 novel_links）
          realmLink: linkChanged ? nextLink : null,
          reason,
          chapterId,
        });
      } catch {
        ok = false;
      }
      if (ok) {
        // ⚠️ 境界关联行已由 `novel-pack-save` 在同一事务里写好（TX-01 修复）：
        // 早期实现在此处再单独调 `writeRealmLink`，两步之间失败即半保存态
        // —— 文档已落库、函数却 return false 报「保存失败」。现在只有两种结果：
        // 全成功（文档 + 关联行）或全回滚，不再有中间态。
        if (linkChanged && nextLink) {
          notifyRealmLinkChanged(current.character.workId, nextLink, "pack");
          setMeta((previous) => ({ ...previous, realmLink: nextLink }));
        }
        savedRef.current = current;
        // 基线刚被推进到当前文档 —— 重算必然得 0（同一份文档比同一份文档）
        recomputeDirty(current);
        setSavedAt(Date.now());
        const records = await fetchPackRecords(current.character.id).catch(
          () => meta.records,
        );
        setMeta((previous) => ({ ...previous, records }));
      } else {
        // 失败不静默：草稿原样保留，状态回到「有未保存改动」
        setSaveFailed(true);
      }
      setSaving(false);
      savingRef.current = false;
      return ok;
    },
    [chapterId, meta.records, recomputeDirty],
  );

  /** 撤销全部改动：丢弃草稿，回到上次保存态 */
  const revertAll = useCallback(async (): Promise<void> => {
    const saved = savedRef.current;
    if (!saved) return;
    // 主角绑定不属于「可撤销的设定数据」：撤销的是行囊内的编辑，不该顺手
    // 把右侧栏设的主角也退回去（那份绑定在库里，撤销界面回退不了它）
    const current = docRef.current;
    const next = current
      ? { ...saved, character: { ...saved.character, entityId: current.character.entityId } }
      : saved;
    docRef.current = next;
    setDocState(next);
    // 主角绑定被刻意保留 → 它若与 savedRef 不同，仍会算出 1 处改动（正确：
    // 「撤销全部」撤的是设定数据，绑定那一格本就不该被撤掉）
    recomputeDirty(next);
    setSaveFailed(false);
    await clearPackDraft(saved.character.id);
  }, [recomputeDirty]);

  /** 撤销到上次保存：从最近一条盘点记录恢复（带确认由调用方负责） */
  const restoreFromRecord = useCallback(
    (record: PackRecord): boolean => {
      const restored = parseDraft(record.payload);
      if (!restored) return false;
      // 盘点记录是物品快照，不含境界绑定：恢复时保留当前草稿里的境界，
      // 不让 parseDraft 的默认值把它抹成 null
      const current = docRef.current;
      if (current && !restored.realmLink) restored.realmLink = current.realmLink;
      docRef.current = restored;
      setDocState(restored);
      // 恢复后与「上次保存态」的净差异 —— 可能是 0（正好回到保存态）也可能是 N
      recomputeDirty(restored);
      return true;
    },
    [recomputeDirty],
  );

  /** 导出当前草稿为 JSON（G-4：连续失败 3 次的逃生出口） */
  const exportDraftJson = useCallback((): string => {
    const current = docRef.current;
    return current ? JSON.stringify(current, null, 2) : "{}";
  }, []);

  const latestRecord = useMemo(() => meta.records[0] ?? null, [meta.records]);

  return {
    loading,
    loadError,
    doc,
    meta,
    dirty,
    saving,
    saveFailed,
    savedAt,
    latestRecord,
    mutate,
    replaceDoc,
    save,
    revertAll,
    restoreFromRecord,
    syncMeta,
    flushDraft,
    exportDraftJson,
  };
}
