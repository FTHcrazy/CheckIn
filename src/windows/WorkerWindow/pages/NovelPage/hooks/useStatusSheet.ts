import { useCallback, useEffect, useRef, useState } from "react";
import { STATUS_SHEET_MOCK } from "../types";
import type { StatusBonus, StatusEntry, StatusSheetContent } from "../types";

/**
 * 保存状态机（对齐编辑器 SaveState 语义）。
 * 持久化链路（novel_status_sheets + IPC）打通前为本地模拟：
 * 「saving」阶段只是模拟 IPC 往返，刷新页面数据不保留。
 */
export type StatusSavePhase = "saved" | "pending" | "saving";

const DEBOUNCE_MS = 800;
const FAKE_ROUNDTRIP_MS = 300;

function cloneSheet(content: StatusSheetContent): StatusSheetContent {
  return JSON.parse(JSON.stringify(content)) as StatusSheetContent;
}

let uidSeed = 0;
/** 本地 mock id 生成；落库打通后由主进程生成 */
function uid(prefix: string): string {
  uidSeed += 1;
  return `${prefix}-mock-${uidSeed.toString(36)}`;
}

/** R4 口径：数值变化的行记 prevValue = 变更前值，未变化的行清空（主进程不感知） */
function applyPrevValueDiff(
  next: StatusSheetContent,
  committed: StatusSheetContent,
): StatusSheetContent {
  const committedById = new Map<string, StatusEntry>();
  for (const group of committed.groups) {
    for (const entry of group.entries) committedById.set(entry.id, entry);
  }
  for (const group of next.groups) {
    for (const entry of group.entries) {
      if (entry.kind !== "number") continue;
      const before = committedById.get(entry.id);
      entry.prevValue =
        before && before.value !== entry.value ? before.value : null;
    }
  }
  return next;
}

export interface StatusSheetController {
  content: StatusSheetContent;
  phase: StatusSavePhase;
  savedAt: Date | null;
  updateEntry: (
    entryId: string,
    patch: Partial<Pick<StatusEntry, "name" | "value" | "max" | "note" | "active">>,
  ) => void;
  addEntry: (groupId: string) => void;
  removeEntry: (entryId: string) => void;
  /** R4 一键回退：当前值与 prevValue 互换后照常走自动保存（可来回切换） */
  rollback: (entryId: string) => void;
  addBonus: (entryId: string, bonus: StatusBonus) => void;
  removeBonus: (entryId: string, index: number) => void;
  addGroup: () => void;
  /** 关闭浮层前 flush 待写数据（仅在有未保存修改时提交） */
  flushNow: () => void;
}

export function useStatusSheet(): StatusSheetController {
  const [content, setContent] = useState<StatusSheetContent>(() =>
    cloneSheet(STATUS_SHEET_MOCK),
  );
  const [phase, setPhase] = useState<StatusSavePhase>("saved");
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const contentRef = useRef(content);
  const phaseRef = useRef(phase);
  const committedRef = useRef(cloneSheet(STATUS_SHEET_MOCK));
  const debounceRef = useRef<number | null>(null);
  const roundtripRef = useRef<number | null>(null);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      if (roundtripRef.current !== null) window.clearTimeout(roundtripRef.current);
    },
    [],
  );

  /** 模拟落库：持久化打通后替换为 saveStatusSheet IPC 调用 */
  const commitNow = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (roundtripRef.current !== null) {
      window.clearTimeout(roundtripRef.current);
      roundtripRef.current = null;
    }
    const next = applyPrevValueDiff(
      cloneSheet(contentRef.current),
      committedRef.current,
    );
    committedRef.current = next;
    contentRef.current = next;
    setContent(next);
    setPhase("saved");
    setSavedAt(new Date());
  }, []);

  const scheduleSave = useCallback(() => {
    setPhase("pending");
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setPhase("saving");
      if (roundtripRef.current !== null) window.clearTimeout(roundtripRef.current);
      roundtripRef.current = window.setTimeout(commitNow, FAKE_ROUNDTRIP_MS);
    }, DEBOUNCE_MS);
  }, [commitNow]);

  const mutate = useCallback(
    (mutator: (draft: StatusSheetContent) => void) => {
      setContent((prev) => {
        const draft = cloneSheet(prev);
        mutator(draft);
        return draft;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const updateEntry = useCallback<StatusSheetController["updateEntry"]>(
    (entryId, patch) => {
      mutate((draft) => {
        for (const group of draft.groups) {
          const entry = group.entries.find((e) => e.id === entryId);
          if (entry) {
            Object.assign(entry, patch);
            return;
          }
        }
      });
    },
    [mutate],
  );

  const addEntry = useCallback<StatusSheetController["addEntry"]>(
    (groupId) => {
      mutate((draft) => {
        const group = draft.groups.find((g) => g.id === groupId);
        group?.entries.push({
          id: uid("se"),
          name: "新条目",
          kind: "number",
          value: "0",
          max: "",
          note: "",
        });
      });
    },
    [mutate],
  );

  const removeEntry = useCallback<StatusSheetController["removeEntry"]>(
    (entryId) => {
      mutate((draft) => {
        for (const group of draft.groups) {
          const idx = group.entries.findIndex((e) => e.id === entryId);
          if (idx > -1) {
            group.entries.splice(idx, 1);
            // R5 级联：指向被删条目的加成一并移除
            for (const other of draft.groups) {
              for (const entry of other.entries) {
                if (entry.bonuses?.some((b) => b.attrId === entryId)) {
                  entry.bonuses = entry.bonuses.filter((b) => b.attrId !== entryId);
                }
              }
            }
            return;
          }
        }
      });
    },
    [mutate],
  );

  const rollback = useCallback<StatusSheetController["rollback"]>(
    (entryId) => {
      mutate((draft) => {
        for (const group of draft.groups) {
          for (const entry of group.entries) {
            if (entry.id === entryId && entry.kind === "number" && entry.prevValue) {
              const current = entry.value;
              entry.value = entry.prevValue;
              entry.prevValue = current;
              return;
            }
          }
        }
      });
    },
    [mutate],
  );

  const addBonus = useCallback<StatusSheetController["addBonus"]>(
    (entryId, bonus) => {
      mutate((draft) => {
        for (const group of draft.groups) {
          const entry = group.entries.find((e) => e.id === entryId);
          if (entry) {
            entry.bonuses = [...(entry.bonuses ?? []), bonus];
            return;
          }
        }
      });
    },
    [mutate],
  );

  const removeBonus = useCallback<StatusSheetController["removeBonus"]>(
    (entryId, index) => {
      mutate((draft) => {
        for (const group of draft.groups) {
          const entry = group.entries.find((e) => e.id === entryId);
          if (entry?.bonuses && index > -1 && index < entry.bonuses.length) {
            entry.bonuses.splice(index, 1);
            return;
          }
        }
      });
    },
    [mutate],
  );

  const addGroup = useCallback<StatusSheetController["addGroup"]>(() => {
    mutate((draft) => {
      draft.groups.push({
        id: uid("sg"),
        name: `新分组 ${draft.groups.length + 1}`,
        entries: [],
      });
    });
  }, [mutate]);

  const flushNow = useCallback<StatusSheetController["flushNow"]>(() => {
    if (phaseRef.current !== "saved") commitNow();
  }, [commitNow]);

  return {
    content,
    phase,
    savedAt,
    updateEntry,
    addEntry,
    removeEntry,
    rollback,
    addBonus,
    removeBonus,
    addGroup,
    flushNow,
  };
}
