import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearPackDraft,
  fetchPackRecords,
  loadPackBundle,
  putPackDraft,
  savePackDocument,
} from "../services/pack-service";
import type {
  PackBundleDTO,
  PackCharacter,
  PackLayout,
  PackLevelSystem,
  PackModifier,
  PackRealmLink,
  PackRecord,
  PackUnitSystem,
} from "../types";
import type { PackAttribute, PackItem, PackSkill, PackSlot } from "../types";
import { DRAFT_DEBOUNCE_MS } from "../types";

/**
 * 一份完整的行囊文档（与草稿 payload / 正式表同构）
 *
 * 刻意不包含「界面偏好」——形态、宽度、折叠、视图、展示熟练度这些
 * 即改即存的项走 config，不进草稿（PRD §8.6.2 的边界定义）。
 */
export interface PackDoc {
  character: PackCharacter;
  attributes: PackAttribute[];
  slots: PackSlot[];
  items: PackItem[];
  skills: PackSkill[];
  modifiers: PackModifier[];
  unitSystems: PackUnitSystem[];
  layouts: PackLayout[];
}

export interface PackMeta {
  records: PackRecord[];
  levelSystems: PackLevelSystem[];
  realmLink: PackRealmLink | null;
}

export type DirtyReason = "手动保存" | "自动保存" | "撤销到上次保存";

function fromBundle(bundle: PackBundleDTO): PackDoc | null {
  if (!bundle.character) return null;
  return {
    character: bundle.character,
    attributes: bundle.attributes,
    slots: bundle.slots,
    items: bundle.items,
    skills: bundle.skills,
    modifiers: bundle.modifiers,
    unitSystems: bundle.unitSystems,
    layouts: bundle.layouts,
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
      attributes: doc.attributes ?? [],
      slots: doc.slots ?? [],
      items: doc.items ?? [],
      skills: doc.skills ?? [],
      modifiers: doc.modifiers ?? [],
      unitSystems: doc.unitSystems ?? [],
      layouts: doc.layouts ?? [],
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
    realmLink: null,
  });
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
          }
        : (draft ?? formal);
    setDocState(merged);
    setDirty(draft ? bundle.draft!.dirtyCount : 0);
    setSavedAt(bundle.records[0]?.takenAt ?? 0);
    setMeta({
      records: bundle.records,
      levelSystems: bundle.levelSystems,
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

  /** 只刷新元数据（盘点记录 / 等级体系 / 境界绑定），不覆盖正在编辑的文档 */
  const syncMeta = useCallback(async (): Promise<PackMeta | null> => {
    try {
      const bundle = await loadPackBundle(workId);
      const next: PackMeta = {
        records: bundle.records,
        levelSystems: bundle.levelSystems,
        realmLink: bundle.realmLink,
      };
      setMeta(next);
      if (bundle.character && !docRef.current) {
        const formal = fromBundle(bundle);
        savedRef.current = formal;
        setDocState(formal);
      }
      return next;
    } catch {
      return null;
    }
  }, [workId]);

  /**
   * 唯一的编辑入口：所有改动都经过它 → 标脏 → 防抖写草稿。
   * dirtyDelta 默认为 1（= 一处改动）；批量操作可传实际条目数。
   */
  const mutate = useCallback(
    (recipe: (current: PackDoc) => PackDoc, dirtyDelta = 1) => {
      setDocState((prev) => {
        if (!prev) return prev;
        const next = recipe(prev);
        if (next === prev) return prev;
        if (dirtyDelta > 0) setDirty((count) => count + dirtyDelta);
        return next;
      });
    },
    [],
  );

  /** 界面状态等不产生脏计数的文档替换（如绑定实体后同步境界行） */
  const replaceDoc = useCallback((next: PackDoc) => {
    setDocState(next);
  }, []);

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
    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    await putPackDraft(current.character.id, JSON.stringify(current), dirtyRef.current);
  }, []);

  const save = useCallback(
    async (reason: DirtyReason = "手动保存"): Promise<boolean> => {
      const current = docRef.current;
      if (!current) return false;
      setSaving(true);
      setSaveFailed(false);
      let ok: boolean;
      try {
        ok = await savePackDocument({ ...current, reason, chapterId });
      } catch {
        ok = false;
      }
      if (ok) {
        savedRef.current = current;
        setDirty(0);
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
      return ok;
    },
    [chapterId, meta.records],
  );

  /** 撤销全部改动：丢弃草稿，回到上次保存态 */
  const revertAll = useCallback(async (): Promise<void> => {
    const saved = savedRef.current;
    if (!saved) return;
    // 主角绑定不属于「可撤销的设定数据」：撤销的是行囊内的编辑，不该顺手
    // 把右侧栏设的主角也退回去（那份绑定在库里，撤销界面回退不了它）
    setDocState((current) =>
      current
        ? {
            ...saved,
            character: { ...saved.character, entityId: current.character.entityId },
          }
        : saved,
    );
    setDirty(0);
    setSaveFailed(false);
    await clearPackDraft(saved.character.id);
  }, []);

  /** 撤销到上次保存：从最近一条盘点记录恢复（带确认由调用方负责） */
  const restoreFromRecord = useCallback(
    (record: PackRecord): boolean => {
      const restored = parseDraft(record.payload);
      if (!restored) return false;
      setDocState(restored);
      setDirty((count) => count + 1);
      return true;
    },
    [],
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
