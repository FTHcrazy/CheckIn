/**
 * 地图文档 store（模块级 zustand 单例）。
 *
 * 持有**文档本身**与撤销/重做栈，暴露全部会改变文档的编辑动作。
 *
 * ── 为什么从 useMapEditor 的 useState 迁到独立 store ──
 * 拆分前全部状态塞在一个 hook 里：doc / viewport / 选中态 / 撤销栈六七个
 * useState 平铺，任何一个变化都触发整棵树重渲染。拆开后：
 *   · 滚轮缩放只动 viewport store，不再惊动文档树；
 *   · 选中态只在选择/删除时变化，不再跟着每次缩放重渲染；
 *   · 文档编辑只动本 store，撤销/重做的账目与视图状态彻底解耦。
 *
 * 边界（对齐项目 useNovelEditorStore 范式）：
 *   · 本 store 不认识 viewport / selection store 以外的任何东西；
 *   · 跨 store 依赖用 getState() 现取现用，不闭包捕获（避免 React 闭包陷阱）；
 *   · 提供 resetMapDocStore() 供测试与「即关即销」窗口销毁时复位。
 */
import { create } from "zustand";
import {
  createElementId,
  createEmptyDocument,
  createLabelId,
  createPolylineId,
  docPolylines,
  ELEMENT_OPACITY_MAX,
  ELEMENT_OPACITY_MIN,
  ELEMENT_TINT_NONE,
  LABEL_ABOVE_ELEMENT,
  LABEL_DEFAULT_SIZE,
  type MapDocument,
  type MapElement,
  type MapLabel,
  type MapPolyline,
} from "../types";
import { applyMerge, planMerge } from "../regionEdit";
import { layerLockedOf, layerVisibleOf } from "../layerState";
import {
  ELEMENT_PASTE_OFFSET,
  HISTORY_LIMIT,
  REGION_SCHEMA_COMMIT_KEY,
  applySnapshot,
  snapshotOf,
  withLayerState,
} from "./docSnapshot";
import type { MapDocState } from "./mapDocState";
export {
  ELEMENT_PASTE_OFFSET,
  ELEMENT_SCALE_MAX,
  ELEMENT_SCALE_MIN,
  REGION_SCHEMA_COMMIT_KEY,
} from "./docSnapshot";
export type { DocSnapshot } from "./docSnapshot";

export const useMapDocStore = create<MapDocState>()((set, get) => ({
  doc: createEmptyDocument(),
  undoStack: [],
  redoStack: [],
  lastCommitKey: null,
  clipboard: null,

  commit: (mutate, coalesceKey) => {
    set((state) => {
      const prev = state.doc;
      // 键相同 = 同一次连续编辑的后续步骤：**只改文档，不再压快照**
      // （第一步已经记下了"这一串编辑之前"的状态）
      const coalesce = coalesceKey !== undefined && coalesceKey === state.lastCommitKey;
      const nextUndo = coalesce ? state.undoStack : [...state.undoStack, snapshotOf(prev)];
      return {
        doc: mutate(prev),
        undoStack: nextUndo.length > HISTORY_LIMIT ? nextUndo.slice(-HISTORY_LIMIT) : nextUndo,
        // 新编辑一律作废重做链（与既有行为一致）
        redoStack: [],
        lastCommitKey: coalesceKey ?? null,
      };
    });
  },

  breakCommitKey: () => {
    if (get().lastCommitKey === null) return;
    set({ lastCommitKey: null });
  },

  undo: () => {
    const { undoStack, doc } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    set({
      doc: applySnapshot(doc, prev),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, snapshotOf(doc)],
      // 架构 §6-8：撤销后必须断键，否则"撤销 + 接着改 schema"会被并进上一步
      lastCommitKey: null,
    });
  },

  redo: () => {
    const { redoStack, doc } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const mergedUndo = [...get().undoStack, snapshotOf(doc)];
    set({
      doc: applySnapshot(doc, next),
      undoStack: mergedUndo.length > HISTORY_LIMIT ? mergedUndo.slice(-HISTORY_LIMIT) : mergedUndo,
      redoStack: redoStack.slice(0, -1),
      // 架构 §6-8：重做后断键（同 undo 的理由）
      lastCommitKey: null,
    });
  },

  commitDragStart: (doc) => {
    set((state) => {
      const next = [...state.undoStack, snapshotOf(doc)];
      return {
        undoStack: next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next,
        redoStack: [],
        // 架构 §6-8：拖拽开始是一次独立的编辑动作 ⇒ 断键
        lastCommitKey: null,
      };
    });
  },

  placeSprite: (spriteId, world, currentLevel) => {
    const element: MapElement = {
      id: createElementId(),
      spriteId,
      x: world.x,
      y: world.y,
      scale: 1,
      rotation: 0,
      level: currentLevel,
    };
    get().commit((d) => ({ ...d, elements: [...d.elements, element] }));
    return element.id;
  },

  moveElementBy: (id, dxWorld, dyWorld) => {
    set((state) => {
      const prev = state.doc;
      return {
        doc: {
          ...prev,
          elements: prev.elements.map((el) =>
            el.id === id ? { ...el, x: el.x + dxWorld, y: el.y + dyWorld } : el,
          ),
          labels:
            prev.labels.length === 0
              ? prev.labels
              : prev.labels.map((l) =>
                  l.elementId === id ? { ...l, x: l.x + dxWorld, y: l.y + dyWorld } : l,
                ),
        },
      };
    });
  },

  removeSelected: (selectedId) => {
    if (!selectedId) return;
    get().commit((d) => ({
      ...d,
      elements: d.elements.filter((el) => el.id !== selectedId),
      labels:
        d.labels.length === 0 ? d.labels : d.labels.filter((l) => l.elementId !== selectedId),
    }));
  },

  clearAll: () => {
    if (get().doc.elements.length === 0) return;
    get().commit((d) => ({
      ...d,
      elements: [],
      labels: d.labels.filter((l) => !l.elementId),
    }));
  },

  updateElement: (id, patch, coalesceKey) => {
    const target = get().doc.elements.find((el) => el.id === id);
    if (!target) return;
    // clamp 先算好：值没变就**不进 commit**，否则滑杆拖到端点时每次 onChange
    // 都会压一步"看起来什么都没变"的空撤销。
    const next: MapElement = { ...target };
    if (patch.scale !== undefined) {
      next.scale = Math.min(8, Math.max(0.1, patch.scale));
    }
    if (patch.rotation !== undefined) {
      next.rotation = ((patch.rotation % 360) + 360) % 360;
    }
    if (patch.opacity !== undefined) {
      next.opacity = Math.min(ELEMENT_OPACITY_MAX, Math.max(ELEMENT_OPACITY_MIN, patch.opacity));
    }
    if (patch.tint !== undefined) {
      next.tint = Math.min(360, Math.max(ELEMENT_TINT_NONE, patch.tint));
    }
    if (patch.level !== undefined) {
      const lv = patch.level;
      // 非法层级（负数 / 非整数）直接忽略：层级数组是按序号索引的，脏值会让
      // 渲染层的容器查找落到 undefined 上
      if (lv === null || (Number.isInteger(lv) && lv >= 0)) next.level = lv;
    }
    if (
      next.scale === target.scale &&
      next.rotation === target.rotation &&
      next.opacity === target.opacity &&
      next.tint === target.tint &&
      next.level === target.level
    ) {
      return;
    }
    get().commit(
      (d) => ({ ...d, elements: d.elements.map((el) => (el.id === id ? next : el)) }),
      coalesceKey,
    );
  },

  reorderElement: (id, to) => {
    const els = get().doc.elements;
    const idx = els.findIndex((el) => el.id === id);
    if (idx < 0) return;
    // 已经在端点上：不进 commit（同 updateElement 的"空步"防抖）
    if (to === "front" && idx === els.length - 1) return;
    if (to === "back" && idx === 0) return;
    const el = els[idx];
    const rest = els.filter((e) => e.id !== id);
    get().commit((d) => ({
      ...d,
      elements: to === "front" ? [...rest, el] : [el, ...rest],
    }));
  },

  duplicateElement: (id) => {
    // B4-3：折线与素材同一套「复制一份」（新 id + 斜移，进撤销栈一步）
    const srcLine = docPolylines(get().doc).find((p) => p.id === id);
    if (srcLine) {
      const copy: MapPolyline = {
        ...srcLine,
        id: createPolylineId(),
        points: srcLine.points.map((p) => ({ x: p.x + ELEMENT_PASTE_OFFSET, y: p.y + ELEMENT_PASTE_OFFSET })),
      };
      get().commit((d) => ({ ...d, polylines: [...docPolylines(d), copy] }));
      return copy.id;
    }
    const src = get().doc.elements.find((el) => el.id === id);
    if (!src) return null;
    const copy: MapElement = {
      ...src,
      id: createElementId(),
      x: src.x + ELEMENT_PASTE_OFFSET,
      y: src.y + ELEMENT_PASTE_OFFSET,
    };
    get().commit((d) => ({ ...d, elements: [...d.elements, copy] }));
    return copy.id;
  },

  copyElement: (id) => {
    // B4-3：素材优先（两套 id 空间不重叠，`pl_` 前缀折线不会撞上）
    const srcLine = docPolylines(get().doc).find((p) => p.id === id);
    if (srcLine) {
      // 点列要克隆：剪贴板必须与文档对象**解引用**，之后拖节点不能把剪贴板一起拖变形
      set({
        clipboard: { ...srcLine, points: srcLine.points.map((p) => ({ x: p.x, y: p.y })) },
      });
      return;
    }
    const src = get().doc.elements.find((el) => el.id === id);
    if (!src) return;
    // 浅拷贝足够：素材字段全是原始值，且文档里的元素本就不可变更新
    set({ clipboard: { ...src } });
  },

  cutElement: (id) => {
    get().copyElement(id);
    // 复制到了才删：剪贴板为空说明 id 两边都不是（切一半会留下一半的困惑）
    if (!get().clipboard) return;
    if (docPolylines(get().doc).some((p) => p.id === id)) {
      get().removePolyline(id);
      return;
    }
    get().removeSelected(id);
  },

  pasteElement: () => {
    const clip = get().clipboard;
    if (!clip) return null;
    if ("points" in clip) {
      const copy: MapPolyline = {
        ...clip,
        id: createPolylineId(),
        points: clip.points.map((p) => ({
          x: p.x + ELEMENT_PASTE_OFFSET,
          y: p.y + ELEMENT_PASTE_OFFSET,
        })),
      };
      get().commit((d) => ({ ...d, polylines: [...docPolylines(d), copy] }));
      return copy.id;
    }
    const copy: MapElement = {
      ...clip,
      id: createElementId(),
      x: clip.x + ELEMENT_PASTE_OFFSET,
      y: clip.y + ELEMENT_PASTE_OFFSET,
    };
    get().commit((d) => ({ ...d, elements: [...d.elements, copy] }));
    return copy.id;
  },

  nudgeElement: (id, dxWorld, dyWorld) => {
    // B4-3：折线整体平移 = 所有点一起动（没有"联动地名"一说 —— 折线没有联动标注）
    if (docPolylines(get().doc).some((p) => p.id === id)) {
      get().commit(
        (d) => ({
          ...d,
          polylines: docPolylines(d).map((p) =>
            p.id === id
              ? { ...p, points: p.points.map((pt) => ({ x: pt.x + dxWorld, y: pt.y + dyWorld })) }
              : p,
          ),
        }),
        `nudge:${id}`,
      );
      return;
    }
    get().commit((d) => {
      let touched = false;
      const elements = d.elements.map((el) => {
        if (el.id !== id) return el;
        touched = true;
        return { ...el, x: el.x + dxWorld, y: el.y + dyWorld };
      });
      if (!touched) return d;
      const labels =
        d.labels.length === 0
          ? d.labels
          : d.labels.map((l) =>
              l.elementId === id ? { ...l, x: l.x + dxWorld, y: l.y + dyWorld } : l,
            );
      return { ...d, elements, labels };
      // 合并键让"连按十次方向键"只占一步撤销（第一次已记下"移动前"）
    }, `nudge:${id}`);
  },

  regenerateHierarchy: (regions) => {
    if (regions.length === 0) return;
    get().commit((d) => ({ ...d, regions }));
  },

  clearRegions: () => {
    if (get().doc.regions.length === 0) return;
    get().commit((d) => ({ ...d, regions: [] }));
  },

  addRegion: (region) => {
    // 不带合并键：每次落笔都是**一次独立的编辑**。用合并键会把"连续画三块"
    // 压成一步撤销 —— 用户按 Ctrl+Z 会一口气退掉三块，与"我最后画的那块"心智不符。
    get().commit((d) => ({ ...d, regions: [...d.regions, region] }));
  },

  generateLand: (land, regions, polylines) => {
    get().commit((d) => ({
      ...d,
      land,
      regions,
      // 陆地换了，旧自动水系必须同步换（否则河留在海面上）；手画的线保留
      ...(polylines === undefined
        ? {}
        : {
            polylines: [...docPolylines(d).filter((l) => l.origin !== "generated"), ...polylines],
          }),
    }));
  },

  applyGenerated: (parts) => {
    get().commit((d) => ({
      ...d,
      ...(parts.land === undefined ? {} : { land: parts.land }),
      ...(parts.elements === undefined ? {} : { elements: parts.elements }),
      ...(parts.labels === undefined ? {} : { labels: parts.labels }),
      ...(parts.regions === undefined ? {} : { regions: parts.regions }),
      ...(parts.bands === undefined ? {} : { terrainBands: parts.bands ?? undefined }),
      // 只换自动水系：手画的线（没写 origin）与用户改过的线一律留下
      ...(parts.polylines === undefined
        ? {}
        : {
            polylines: [
              ...docPolylines(d).filter((l) => l.origin !== "generated"),
              ...parts.polylines,
            ],
          }),
    }));
  },

  relabelElements: (entries) => {
    if (entries.length === 0) return;
    get().commit((d) => {
      const ids = new Set(entries.map((e) => e.elementId));
      // 摘掉这批素材身上的旧联动标注；手动标注与其余联动原样保留
      const kept = d.labels.filter((l) => !l.elementId || !ids.has(l.elementId));
      const added: MapLabel[] = [];
      for (const e of entries) {
        const text = e.text.trim();
        if (!text) continue;
        const el = d.elements.find((el) => el.id === e.elementId);
        if (!el) continue;
        added.push({
          id: createLabelId(),
          text,
          x: el.x,
          y: el.y - LABEL_ABOVE_ELEMENT,
          size: LABEL_DEFAULT_SIZE,
          level: el.level,
          elementId: el.id,
        });
      }
      if (added.length === 0 && kept.length === d.labels.length) return d;
      return { ...d, labels: [...kept, ...added] };
    });
  },

  setBaseImage: (id) => {
    if (id === get().doc.baseImageId) return;
    get().commit((d) => ({ ...d, baseImageId: id }));
  },

  clearLand: () => {
    if (!get().doc.land) return;
    // 纹理带与水系都跟着陆地走：陆地没了，旧陆地的带栅格与自动河湖一并清掉
    // （同一步撤销快照）。手画的线保留 —— 那是用户的，不是陆地的派生物。
    get().commit((d) => ({
      ...d,
      land: null,
      terrainBands: undefined,
      polylines: docPolylines(d).filter((l) => l.origin !== "generated"),
    }));
  },

  toggleRegions: () => {
    get().commit((d) => ({ ...d, showRegions: !d.showRegions }));
  },

  setLayerVisible: (id, visible) => {
    const doc = get().doc;
    // 值没变就不进 commit：面板可能被"回车 + 点击"双触发，空步白占一格撤销栈
    if (layerVisibleOf(doc, id) === visible) return;
    if (id === "region") {
      get().commit((d) => ({ ...d, showRegions: visible }));
      return;
    }
    get().commit((d) => withLayerState(d, id, { visible }));
  },

  toggleLayerVisible: (id) => {
    get().setLayerVisible(id, !layerVisibleOf(get().doc, id));
  },

  setLayerLocked: (id, locked) => {
    if (layerLockedOf(get().doc, id) === locked) return;
    get().commit((d) => withLayerState(d, id, { locked }));
  },

  /* ───────────── 折线（B4-2）───────────── */

  addPolyline: (polyline) => {
    // 少于 2 点的"线"画不出来，也不该进文档（绘制态已拦一次，这里是最后一道）
    if (polyline.points.length < 2) return;
    get().commit((d) => ({ ...d, polylines: [...docPolylines(d), polyline] }));
  },

  updatePolyline: (id, patch, coalesceKey) => {
    if (!docPolylines(get().doc).some((p) => p.id === id)) return;
    get().commit((d) => ({
      ...d,
      polylines: docPolylines(d).map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        // 清标签 / 把线宽调回 1 倍 ⇒ **删键**而不是写空值（零写入原则的延伸）：
        // 否则每份存档都会带上 `label: undefined` 这类"用户其实没设过"的痕迹。
        if (next.label === undefined || next.label === "") delete next.label;
        if (next.widthScale === 1) delete next.widthScale;
        return next;
      }),
    }), coalesceKey);
  },

  removePolyline: (id) => {
    if (!docPolylines(get().doc).some((p) => p.id === id)) return;
    get().commit((d) => ({ ...d, polylines: docPolylines(d).filter((p) => p.id !== id) }));
  },

  movePolylinePoint: (id, index, world) => {
    set((state) => {
      const list = docPolylines(state.doc);
      if (!list.some((p) => p.id === id)) return {};
      return {
        doc: {
          ...state.doc,
          polylines: list.map((p) =>
            p.id === id
              ? { ...p, points: p.points.map((pt, i) => (i === index ? { x: world.x, y: world.y } : pt)) }
              : p,
          ),
        },
      };
    });
  },

  insertPolylinePoint: (id, index, point) => {
    if (!docPolylines(get().doc).some((p) => p.id === id)) return;
    get().commit((d) => ({
      ...d,
      polylines: docPolylines(d).map((p) => {
        if (p.id !== id) return p;
        // 钳到合法插入位（双击判定与采样换算之间可能差一格）
        const at = Math.min(Math.max(index, 1), p.points.length);
        const points = [...p.points.slice(0, at), { x: point.x, y: point.y }, ...p.points.slice(at)];
        return { ...p, points };
      }),
    }));
  },

  deletePolylinePoint: (id, index) => {
    const target = docPolylines(get().doc).find((p) => p.id === id);
    if (!target) return;
    const remain = target.points.filter((_, i) => i !== index);
    if (remain.length < 2) {
      get().commit((d) => ({ ...d, polylines: docPolylines(d).filter((p) => p.id !== id) }));
      return;
    }
    // 闭合线删到只剩 2 点：闭环退化成零面积的来回线，自动改回开链
    //（只在真发生变化时写键，不给本来就开着的线添 `closed:false` 的痕迹）
    const openIt = target.closed && remain.length < 3;
    get().commit((d) => ({
      ...d,
      polylines: docPolylines(d).map((p) =>
        p.id === id ? { ...p, points: remain, ...(openIt ? { closed: false } : {}) } : p,
      ),
    }));
  },

  setStyle: (next) => {
    if (next === get().doc.style) return;
    get().commit((d) => ({ ...d, style: next }));
  },

  addLabel: (input) => {
    const text = input.text.trim();
    if (!text) return null;
    const label: MapLabel = {
      id: createLabelId(),
      text,
      x: input.x,
      y: input.y,
      size: input.size ?? LABEL_DEFAULT_SIZE,
      level: input.level,
    };
    get().commit((d) => ({ ...d, labels: [...d.labels, label] }));
    return label.id;
  },

  updateLabel: (id, patch) => {
    get().commit((d) => {
      const target = d.labels.find((l) => l.id === id);
      if (!target) return d;
      const text = patch.text === undefined ? target.text : patch.text.trim();
      if (!text) return { ...d, labels: d.labels.filter((l) => l.id !== id) };
      return {
        ...d,
        labels: d.labels.map((l) => (l.id === id ? { ...l, ...patch, text } : l)),
      };
    });
  },

  removeLabel: (id) => {
    get().commit((d) => ({
      ...d,
      labels: d.labels.length === 0 ? d.labels : d.labels.filter((l) => l.id !== id),
    }));
  },

  setElementLabel: (elementId, text, size = LABEL_DEFAULT_SIZE) => {
    const next = text.trim();
    get().commit((d) => {
      const el = d.elements.find((e) => e.id === elementId);
      if (!el) return d;
      const existing = d.labels.find((l) => l.elementId === elementId);
      if (existing && existing.text === next) return d;
      if (!next) {
        return existing ? { ...d, labels: d.labels.filter((l) => l.id !== existing.id) } : d;
      }
      if (existing) {
        return {
          ...d,
          labels: d.labels.map((l) => (l.id === existing.id ? { ...l, text: next } : l)),
        };
      }
      const label: MapLabel = {
        id: createLabelId(),
        text: next,
        x: el.x,
        y: el.y - LABEL_ABOVE_ELEMENT,
        size,
        level: el.level,
        elementId,
      };
      return { ...d, labels: [...d.labels, label] };
    });
  },

  embedSubmap: (regionId, submap, enterScale) => {
    get().commit((d) => ({
      ...d,
      regions: d.regions.map((r) =>
        r.id === regionId
          ? {
              ...r,
              submap,
              ...(enterScale === undefined ? {} : { submapEnterScale: enterScale }),
            }
          : r,
      ),
    }));
  },

  removeSubmap: (regionId) => {
    get().commit((d) => {
      const target = d.regions.find((r) => r.id === regionId);
      if (!target || !target.submap) return d;
      return {
        ...d,
        // 剥掉 submap 与 submapEnterScale（恢复为普通区块），其余字段不变
        regions: d.regions.map((r) => {
          if (r.id !== regionId) return r;
          const rest: Omit<typeof r, "submap" | "submapEnterScale"> = {
            id: r.id,
            parentId: r.parentId,
            level: r.level,
            name: r.name,
            seed: r.seed,
            polygon: r.polygon,
            color: r.color,
          };
          return rest;
        }),
      };
    });
  },

  mergeSubtree: (rootId) => {
    // store 内部**自己再算一次**计划，不信任调用方传来的预览（架构 §3.4 最后一步）：
    // 预览与执行之间可能有别的编辑插进来（虽然是同一 tick，但便宜且不会错）。
    const plan = planMerge(get().doc.regions, rootId);
    if (!plan) return { removed: 0, withSubmap: 0 };
    get().commit((d) => ({ ...d, regions: applyMerge(d.regions, plan) }));
    return { removed: plan.descendantIds.length, withSubmap: plan.withSubmap.length };
  },

  setRegionSchema: (schema, pruneLevelsAbove) => {
    get().commit((d) => {
      const regions =
        pruneLevelsAbove === undefined
          ? d.regions
          : d.regions.filter((r) => r.level < pruneLevelsAbove);
      return { ...d, regionSchema: schema, regions };
    }, REGION_SCHEMA_COMMIT_KEY);
  },
}));

/** 复位文档 store（测试隔离 + 窗口即关即销时清空） */
export function resetMapDocStore(doc: MapDocument): void {
  useMapDocStore.setState({
    doc,
    undoStack: [],
    redoStack: [],
    // 架构 §6-8：复位也必须断键，否则跨用例/跨窗口的第一个 schema 编辑会被吞掉快照
    lastCommitKey: null,
    // 剪贴板是会话级状态：换一张图 / 换一个用例，"上一次复制的东西"不该还粘得上
    clipboard: null,
  });
}
