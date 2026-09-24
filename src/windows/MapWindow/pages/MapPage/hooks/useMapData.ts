/**
 * 地图数据 Hook（PRD novel-map §6 渲染进程结构 + AGENTS.md 6.2.1 状态分层）
 *
 * 职责：
 * - 地图列表 CRUD（list / create / rename / delete）
 * - 当前地图文档加载（load → content 解析）
 * - 自动保存（800ms 防抖，对齐编辑器心智）
 * - 撤销 / 重做栈（RM9 涂刷、RM13 贴章、标注编辑统一入栈）
 * - 贴章对象层 CRUD + 层级 + 编组（RM13）
 * - 地块模型 / 符号风格切换
 * - 监听 map-open-request（单实例唤起）+ novel-map-updated（RM12 广播局部刷新）
 *
 * 不负责：画布缩放/平移/工具临时态（见 useMapViewState）与标注/贴章编辑草稿（页面内联更新）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listMaps,
  loadMap,
  addMap,
  renameMap,
  deleteMap,
  saveMap,
  parseContent,
  emptyContent,
  stringifyContent,
} from "../services/map-service";
import { randomSeed, buildWorld } from "../map-terrain";
import type { TerrainTemplates } from "../map-terrain";
import { RES_PRESETS, DEFAULT_RES, AUTOSAVE_DEBOUNCE_MS } from "../map-config";
import type {
  MapMetaDTO,
  MapContent,
  MapAnnotation,
  MapStamp,
} from "@/shared/types/electron.d.ts";

const HISTORY_CAP = 60;

export function useMapData() {
  const [maps, setMaps] = useState<MapMetaDTO[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [content, setContent] = useState<MapContent>(emptyContent());
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">(
    "idle",
  );
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const updatedAtRef = useRef(updatedAt);
  const currentIdRef = useRef(currentId);
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { updatedAtRef.current = updatedAt; }, [updatedAt]);
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);

  // 撤销栈：past = 历史快照，future = 重做快照
  const past = useRef<MapContent[]>([]);
  const future = useRef<MapContent[]>([]);

  const refreshUndoRedo = useCallback(() => {
    setCanUndo(past.current.length > 0);
    setCanRedo(future.current.length > 0);
  }, []);

  const refreshList = useCallback(async () => {
    const list = await listMaps();
    setMaps(list);
  }, []);

  const selectMap = useCallback(
    async (mapId: string) => {
      setLoading(true);
      try {
        const dto = await loadMap(mapId);
        if (dto) {
          setCurrentId(dto.id);
          const parsed = parseContent(dto.content);
          if (!parsed.stamps) parsed.stamps = [];
          setContent(parsed);
          setUpdatedAt(dto.updatedAt);
          past.current = [];
          future.current = [];
          refreshUndoRedo();
        }
      } finally {
        setLoading(false);
      }
    },
    [refreshUndoRedo],
  );

  const createMap = useCallback(
    async (
      name: string,
      seed: string,
      templates: TerrainTemplates,
      resKey: string = DEFAULT_RES,
    ) => {
      const preset =
        RES_PRESETS.find((p) => p.key === resKey) ?? RES_PRESETS[1];
      const world = buildWorld({
        cols: preset.cols,
        rows: preset.rows,
        seed,
        templates,
      });
      const newContent: MapContent = {
        terrain: {
          cols: world.cols,
          rows: world.rows,
          cells: Array.from(world.cells),
          // ⚠️ 只存河流：island / waterfall 由 worldFromContent 从 cells 重新派生，
          //    存了也没用（会被忽略），还会让 content 体积膨胀数倍。
          //    `pts` 必须透传 —— 旧实现漏掉它，导致存档再打开后河流 ribbon 整条消失。
          features: world.features
            .filter((f) => f.type === "river")
            .map((f) => ({
              id: f.id ?? `river_${Math.random().toString(36).slice(2, 8)}`,
              type: "river" as const,
              pts: f.pts,
              trib: f.trib,
              seed: f.seed,
            })),
          legendVersion: 2,
        },
        annotations: [],
        stamps: [],
        links: [],
        viewport: { x: 0, y: 0, scale: 0.75 },
      };
      const id = `map_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ok = await addMap({
        id,
        workId: null,
        name: name.trim() || "未命名地图",
        seed,
        content: stringifyContent(newContent),
      });
      if (ok) {
        await refreshList();
        await selectMap(id);
      }
      return id;
    },
    [refreshList, selectMap],
  );

  const flushSave = useCallback(async () => {
    const id = currentIdRef.current;
    if (!id) return;
    setSaveState("saving");
    try {
      const res = await saveMap(
        id,
        stringifyContent(contentRef.current),
        updatedAtRef.current,
      );
      if (res.ok) {
        setUpdatedAt(res.updatedAt);
        setSaveState("idle");
      } else {
        setSaveState("error");
      }
    } catch {
      setSaveState("error");
    }
  }, []);

  /**
   * 提交内容变更：先入撤销栈，再应用，再触发自动保存。
   *
   * 注意：**历史入栈与定时器必须写在 setContent 的 updater 之外**。
   * React StrictMode 会重复执行 updater（双调用），把副作用写进去会导致
   * 撤销栈被重复 push、定时器被重复创建。（修正前正是这个形态）
   */
  const updateContent = useCallback(
    (updater: (prev: MapContent) => MapContent, recordHistory = true) => {
      if (recordHistory) {
        past.current.push(contentRef.current);
        if (past.current.length > HISTORY_CAP) past.current.shift();
        future.current = [];
        refreshUndoRedo();
      }
      setContent((prev) => {
        const next = updater(prev);
        // 同步维护 ref，保证同一批事件里连续两次提交也能拿到正确快照
        contentRef.current = next;
        return next;
      });
      refreshUndoRedo();
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        void flushSave();
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [flushSave, refreshUndoRedo],
  );

  const undo = useCallback(() => {
    const last = past.current.pop();
    if (last === undefined) return;
    future.current.push(contentRef.current);
    if (future.current.length > HISTORY_CAP) future.current.shift();
    contentRef.current = last;
    setContent(last);
    refreshUndoRedo();
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => void flushSave(), AUTOSAVE_DEBOUNCE_MS);
  }, [refreshUndoRedo, flushSave]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(contentRef.current);
    if (past.current.length > HISTORY_CAP) past.current.shift();
    contentRef.current = next;
    setContent(next);
    refreshUndoRedo();
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => void flushSave(), AUTOSAVE_DEBOUNCE_MS);
  }, [refreshUndoRedo, flushSave]);

  // ── 贴章对象层 CRUD（RM13）──
  const addStamp = useCallback(
    (stamp: Omit<MapStamp, "id" | "z"> & { id?: string }) => {
      const id = stamp.id ?? `stamp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      updateContent((prev) => {
        const stamps = prev.stamps ?? [];
        const maxZ = stamps.reduce((m, s) => Math.max(m, s.z), 0);
        return {
          ...prev,
          stamps: [...stamps, { ...stamp, id, z: maxZ + 1 }],
        };
      });
      return id;
    },
    [updateContent],
  );

  const updateStamp = useCallback(
    (id: string, patch: Partial<MapStamp>) => {
      updateContent((prev) => ({
        ...prev,
        stamps: (prev.stamps ?? []).map((s) =>
          s.id === id ? { ...s, ...patch } : s,
        ),
      }));
    },
    [updateContent],
  );

  const removeStamp = useCallback(
    (id: string) => {
      updateContent((prev) => ({
        ...prev,
        stamps: (prev.stamps ?? []).filter((s) => s.id !== id),
      }));
    },
    [updateContent],
  );

  const reorderStamp = useCallback(
    (id: string, dir: "up" | "down" | "top" | "bottom") => {
      updateContent((prev) => {
        const stamps = [...(prev.stamps ?? [])].sort((a, b) => a.z - b.z);
        const idx = stamps.findIndex((s) => s.id === id);
        if (idx < 0) return prev;
        const zs = stamps.map((s) => s.z);
        if (dir === "up" && idx < stamps.length - 1) [zs[idx], zs[idx + 1]] = [zs[idx + 1], zs[idx]];
        if (dir === "down" && idx > 0) [zs[idx], zs[idx - 1]] = [zs[idx - 1], zs[idx]];
        if (dir === "top") {
          const max = Math.max(...zs) + 1;
          zs[idx] = max;
        }
        if (dir === "bottom") {
          const min = Math.min(...zs) - 1;
          zs[idx] = min;
        }
        stamps.forEach((s, i) => (s.z = zs[i]));
        return { ...prev, stamps };
      });
    },
    [updateContent],
  );

  const groupStamps = useCallback(
    (ids: string[], groupId: string) => {
      updateContent((prev) => ({
        ...prev,
        stamps: (prev.stamps ?? []).map((s) =>
          ids.includes(s.id) ? { ...s, groupId } : s,
        ),
      }));
    },
    [updateContent],
  );

  const ungroupStamps = useCallback(
    (groupId: string) => {
      updateContent((prev) => ({
        ...prev,
        stamps: (prev.stamps ?? []).map((s) =>
          s.groupId === groupId ? { ...s, groupId: null } : s,
        ),
      }));
    },
    [updateContent],
  );

  const setTileMode = useCallback(
    (tileMode: boolean) => {
      updateContent((prev) => ({ ...prev, tileMode }), false);
    },
    [updateContent],
  );

  const setSymbolStyle = useCallback(
    (symbolStyle: "A" | "B" | "C") => {
      updateContent((prev) => ({ ...prev, symbolStyle }), false);
    },
    [updateContent],
  );

  const renameCurrent = useCallback(
    async (name: string) => {
      if (!currentIdRef.current) return;
      await renameMap(currentIdRef.current, name);
      await refreshList();
    },
    [refreshList],
  );

  const removeMap = useCallback(
    async (mapId: string) => {
      await deleteMap(mapId);
      if (currentIdRef.current === mapId) {
        setCurrentId(null);
        setContent(emptyContent());
        setUpdatedAt(0);
        past.current = [];
        future.current = [];
        refreshUndoRedo();
      }
      await refreshList();
    },
    [refreshList, refreshUndoRedo],
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    const unsub = window.electronAPI!.receive("map-open-request", (data) => {
      const payload = data as { mapId?: string } | undefined;
      if (payload?.mapId) void selectMap(payload.mapId);
    });
    return unsub;
  }, [selectMap]);

  useEffect(() => {
    const unsub = window.electronAPI!.receive("novel-map-updated", (data) => {
      const payload = data as { mapId: string } | undefined;
      if (payload?.mapId && payload.mapId === currentIdRef.current) {
        void selectMap(payload.mapId);
      }
      void refreshList();
    });
    return unsub;
  }, [selectMap, refreshList]);

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  const upsertAnnotation = useCallback(
    (anno: MapAnnotation) => {
      updateContent((prev) => {
        const exists = prev.annotations.some((a) => a.id === anno.id);
        return {
          ...prev,
          annotations: exists
            ? prev.annotations.map((a) => (a.id === anno.id ? anno : a))
            : [...prev.annotations, anno],
        };
      });
    },
    [updateContent],
  );

  const deleteAnnotation = useCallback(
    (id: string) => {
      updateContent((prev) => ({
        ...prev,
        annotations: prev.annotations.filter((a) => a.id !== id),
      }));
    },
    [updateContent],
  );

  return {
    maps,
    currentId,
    content,
    updatedAt,
    loading,
    saveState,
    canUndo,
    canRedo,
    refreshList,
    selectMap,
    createMap,
    updateContent,
    flushSave,
    undo,
    redo,
    addStamp,
    updateStamp,
    removeStamp,
    reorderStamp,
    groupStamps,
    ungroupStamps,
    setTileMode,
    setSymbolStyle,
    renameCurrent,
    removeMap,
    upsertAnnotation,
    deleteAnnotation,
    randomSeed,
  };
}
