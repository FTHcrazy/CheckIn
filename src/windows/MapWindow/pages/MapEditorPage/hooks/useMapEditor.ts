import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assignPlacementNames,
  computeTerrainZones,
  elementSeedOf,
  generateMap,
  GRID_SIZES,
  installSpriteNamesResolver,
  landSeedOf,
  nameSeedOf,
  resolveGeneratorTuning,
  summarizeGeneration,
  type GeneratorGear,
  type GeneratorParams,
  type SpritePlacement,
} from "../domain/generator";
import { MAP_PRESETS } from "../domain/mapPresets";
import { SPRITE_ZONES, ZONE_LABELS } from "../domain/zones";
import {
  FIT_PADDING,
  ZOOM_LIMITS,
  fitScaleFor,
  fitToRect,
  hitTestElement,
  isCenterCovered,
  type CanvasSize,
} from "../coords";
import { SPRITES, SPRITE_CATEGORIES, SPRITE_MAP } from "../sprites";
import {
  DEFAULT_REGION_SCHEMA,
  REGION_LEVEL_COUNT_LIMITS,
  REGION_MAX_LEVELS,
  generateHierarchy,
  polygonArea,
  polygonCentroid,
  regionSchemaOf,
  type MapRegion,
  type Point,
  type RegionLevelDef,
} from "../regions";
import {
  ancestorPathOf,
  buildParentIdSet,
  checkManualRegion,
  createRegionId,
  isLeafRegion,
  manualRegionColor,
  manualRegionName,
  nextRegionOrdinal,
  type ManualRegionRejectCode,
} from "../regionEdit";
// 别名：本 hook 要暴露一个同名动作 `generateLand`，避免与纯函数撞名
import { generateLand as buildLand, landColorOf } from "../land";
import {
  activeLevel,
  elementSizeFactor,
  elementWeight,
  enterScaleForRegion,
  finestBlockLongEdge,
  levelAlphas as computeLevelAlphas,
  levelCountsOf,
  naturalScales,
  polygonLongEdge,
  zoomLimitsForBlocks,
  ELEMENT_PICK_MIN_WEIGHT,
} from "../lod";
import {
  type MapDocument,
  type MapElement,
  type MapLabel,
  type MapLabelSize,
  type MapLand,
  type MapPolyline,
  type MapStyle,
  type MapSubmap,
  type Rect,
  createLabelId,
  createElementId,
  createPolylineId,
  createSubmapId,
  docPolylines,
  LABEL_ABOVE_ELEMENT,
  LABEL_DEFAULT_SIZE,
} from "../types";
import { useTextureCache } from "./useTextureCache";
import { layerLockedOf } from "../layerState";
import type { MapLayerId } from "../layerState";
import {
  POLYLINE_PICK_PAD_PX,
  defaultStyleIdOf,
  effectiveWidthWorld,
  polylineStyleOf,
  type PolylineKind,
} from "../polylineStyle";
import { distanceToPath, smoothPolyline } from "../polylineGeometry";
import { useMapDocStore } from "../store/useMapDocStore";
import { useMapViewportStore, BASE_BOUNDS } from "../store/useMapViewportStore";
import { useMapSelectionStore } from "../store/useMapSelectionStore";

/**
 * 地图编辑器 facade hook。
 *
 * 状态已拆到三个模块级 zustand store（doc / viewport / selection），本 hook 只做
 * **派生计算与编排**：订阅三个 store 的标量，用 useMemo 派生 LOD（regionScales /
 * levelAlphas / currentLevel / zoomLimits），把跨 store 的动作串起来后以统一 API 暴露。
 *
 * 返回值与拆分前完全一致（零功能变更）——调用方（index.tsx、测试）无需改动。
 * 细粒度订阅的收益由 store 提供：滚轮缩放只触发订阅了 viewport 的组件重渲染。
 */
export function useMapEditor(canvasSize: CanvasSize) {
  const doc = useMapDocStore((s) => s.doc);
  const viewport = useMapViewportStore((s) => s.viewport);
  const selectedId = useMapSelectionStore((s) => s.selectedId);
  const selectedRegionId = useMapSelectionStore((s) => s.selectedRegionId);
  const selectedPolylineId = useMapSelectionStore((s) => s.selectedPolylineId);
  const pendingSpriteId = useMapSelectionStore((s) => s.pendingSpriteId);
  const undoStack = useMapDocStore((s) => s.undoStack);
  const redoStack = useMapDocStore((s) => s.redoStack);

  const { textures, ready } = useTextureCache();

  /* ───────────────── 层级定义（R-REG-01） ───────────────── */

  /**
   * 当前文档的**有效**层级定义（读时回落，见 `regionSchemaOf`）。
   *
   * 【层数的唯一事实源】`schema.length`。工具栏不再持有 `levelDepth`，生成陆地 /
   * 生成区块 / 圈定子图三处都从这里取层数 —— 第二事实源是这一轮要消灭的东西
   * （架构 §4-T3）。
   *
   * 【依赖为什么是 `doc.regionSchema` 而不是 `doc`】`regionSchemaOf` 只读这一个
   * 字段；依赖整个 `doc` 会让"移动素材 / 加地名"这类高频编辑都重算一次回落。
   */
  const schema = useMemo(() => regionSchemaOf(doc), [doc.regionSchema]);

  /** 改写层级定义（转 store，带合并键：同一配置面板连续编辑只压一步快照） */
  const setRegionSchema = useCallback(
    (next: RegionLevelDef[], pruneLevelsAbove?: number) => {
      useMapDocStore.getState().setRegionSchema(next, pruneLevelsAbove);
    },
    [],
  );

  /**
   * 主动断掉快照合并键（"一次连续调参结束"：失焦 / 关闭配置浮层 / 应用并生成）。
   *
   * 【为什么由 hook 转发而不是页面直接摸 store】页面（`index.tsx`）至今不 import
   * 任何 store，全部文档动作都从本 hook 走 —— 这条边界让"页面只做编排"可验证
   * （架构 §6-2）。断键是文档动作的一部分，理应同源。
   */
  const breakCommitKey = useCallback(() => {
    useMapDocStore.getState().breakCommitKey();
  }, []);

  /* ───────────────── 层级 LOD（无极缩放的衔接） ───────────────── */

  /**
   * 各级的"自然缩放"—— 在该缩放下，这一级的一块在屏幕上正好一个舒适大小。
   *
   * 用**实际生成结果**统计每级数量，而不是常量表 `REGION_LEVELS`：数量会被
   * `REGION_TOTAL_LIMIT` 截断，拿常量算出来的自然缩放会和画面对不上。
   */
  const regionScales = useMemo(() => {
    const counts = levelCountsOf(doc.regions);
    return counts.length === 0 ? [] : naturalScales(counts, BASE_BOUNDS);
  }, [doc.regions]);

  /** 各层级当前的可见权重（Σα ≡ 1），画布与工具栏共用同一份 */
  const levelAlphas = useMemo(
    () => (regionScales.length === 0 ? [] : computeLevelAlphas(viewport.scale, regionScales)),
    [regionScales, viewport.scale],
  );

  /**
   * 当前主导层级 —— 新放下的素材就归到这一级（也是工具栏层级胶囊显示的那一级）。
   *
   * `null` = 还没生成区块，此时素材层级无关（任何缩放下都可见）。
   */
  const currentLevel = useMemo(
    () => (regionScales.length === 0 ? null : activeLevel(viewport.scale, regionScales)),
    [regionScales, viewport.scale],
  );

  /**
   * 最细一级区块多边形的**长边**（世界单位）。
   *
   * 【只随区块变化重算】它要扫最细一级那 160 个多边形的全部顶点，绝不能进入
   * 视口（滚轮每格 / 拖拽每帧）的依赖路径。
   */
  const finestBlockLong = useMemo(() => {
    const levelCount = regionScales.length;
    if (levelCount === 0) return 0;
    return finestBlockLongEdge(doc.regions, levelCount - 1);
  }, [doc.regions, regionScales.length]);

  /**
   * 缩放上下限：由「层级 + 最细一级的实际块长边 + 画布尺寸」反推。
   */
  const zoomLimits = useMemo(() => {
    if (regionScales.length === 0) return ZOOM_LIMITS;
    const fitScale = fitScaleFor(BASE_BOUNDS, canvasSize, FIT_PADDING);
    return zoomLimitsForBlocks({
      scales: regionScales,
      fitScale,
      finestBlockLong,
      canvas: canvasSize,
    });
  }, [regionScales, finestBlockLong, canvasSize]);

  const setViewport = useMapViewportStore((s) => s.setViewport);
  const setSelectedId = useMapSelectionStore((s) => s.setSelectedId);
  const setSelectedRegionId = useMapSelectionStore((s) => s.setSelectedRegionId);
  const setSelectedPolylineId = useMapSelectionStore((s) => s.setSelectedPolylineId);
  const setPendingSpriteId = useMapSelectionStore((s) => s.setPendingSpriteId);

  /** 层级变化后把当前缩放夹回合法区间 */
  useEffect(() => {
    setViewport((vp) => {
      const s = Math.min(zoomLimits.max, Math.max(zoomLimits.min, vp.scale));
      return s === vp.scale ? vp : { ...vp, scale: s };
    });
  }, [zoomLimits, setViewport]);

  /**
   * 选中的素材若因层级切换而隐没，自动取消选中。
   */
  useEffect(() => {
    if (!selectedId) return;
    const el = doc.elements.find((e) => e.id === selectedId);
    if (!el) return;
    if (elementWeight(el.level, levelAlphas) < ELEMENT_PICK_MIN_WEIGHT) setSelectedId(null);
  }, [selectedId, doc.elements, levelAlphas, setSelectedId]);

  /** 首次拿到画布尺寸时，把底图适配进视口 */
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (didInitialFit.current) return;
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    didInitialFit.current = true;
    setViewport(() => fitToRect(BASE_BOUNDS, canvasSize, FIT_PADDING, zoomLimits));
  }, [canvasSize, zoomLimits, setViewport]);

  /** 适应窗口 */
  const fitView = useCallback(() => {
    setViewport(() => fitToRect(BASE_BOUNDS, canvasSize, FIT_PADDING, zoomLimits));
  }, [canvasSize, zoomLimits, setViewport]);

  /**
   * 直接落位一个具体视口（切图时恢复"上次看到哪"）。
   *
   * 【为什么页面不自己 import viewport store】"页面只做编排、所有视图/文档动作
   * 都从本 hook 走"是这条边界唯一的可验证形式（架构 §6-2）。切图恢复视口属于
   * 视图动作，理应从同一扇门进来。
   */
  const applyViewport = useCallback(
    (next: { x: number; y: number; scale: number }) => {
      setViewport(() => {
        const scale = Math.min(zoomLimits.max, Math.max(zoomLimits.min, next.scale));
        return { x: next.x, y: next.y, scale };
      });
    },
    [setViewport, zoomLimits.max, zoomLimits.min],
  );

  /** 缩放（滚轮，以光标为锚点） */
  const handleWheel = useCallback(
    (deltaY: number, anchor: { x: number; y: number }) => {
      useMapViewportStore.getState().handleWheel(deltaY, anchor, canvasSize, zoomLimits);
    },
    [canvasSize, zoomLimits],
  );

  /** 平移（拖动空白区域） */
  const handlePan = useCallback((dx: number, dy: number) => {
    useMapViewportStore.getState().handlePan(dx, dy);
  }, []);

  /**
   * 放置素材到世界坐标。
   *
   * @returns 是否真的落了位。`false` = 落位被避让拦截（P2-3：新素材的中心
   * 落进已有素材命中盒的呼吸边内），调用方应保留"待落位素材"的选中态并
   * 给出提示，让用户换个位置再点 —— 不是清掉重来。
   *
   * 【只拦新建，不拦移动】压住的素材要能被拖开解围，拦截若作用于
   * `moveElementBy` 就是死锁 —— 见 coords.isCenterCovered 的注释。
   */
  const placeSprite = useCallback(
    (spriteId: string, world: { x: number; y: number }): boolean => {
      const def = SPRITE_MAP[spriteId];
      if (!def) return false;
      // 避让（P2-3）：与命中测试同一条可见性门槛 + 同一套尺寸口径 ——
      // "看得见的素材"才拦，且拦的就是"点得中的那个盒 + 呼吸边"。
      if (
        isCenterCovered(
          world,
          doc.elements.flatMap((el) => {
            const d = SPRITE_MAP[el.spriteId];
            if (!d) return [];
            if (elementWeight(el.level, levelAlphas) < ELEMENT_PICK_MIN_WEIGHT) return [];
            return [
              {
                x: el.x,
                y: el.y,
                width: d.baseWidth,
                height: d.baseHeight,
                scale: el.scale * elementSizeFactor(el.level, levelAlphas.length),
              },
            ];
          }),
        )
      ) {
        return false;
      }
      const elementId = useMapDocStore.getState().placeSprite(spriteId, world, currentLevel);
      // 点要素带名（R-MAP-22「与地名联动」）：摆一个城市即出现默认名，
      // 双击可改。名池按「未占用优先」，全占用时数字后缀兜底。
      if (elementId && def.names?.length) {
        const labels = useMapDocStore.getState().doc.labels;
        const used = new Set(labels.map((l) => l.text));
        const free = def.names.find((n) => !used.has(n));
        const fallback = `${def.names[0]}·${labels.filter((l) =>
          def.names!.some((n) => l.text.startsWith(n)),
        ).length + 1}`;
        useMapDocStore.getState().setElementLabel(elementId, free ?? fallback);
      }
      setSelectedId(elementId);
      return true;
    },
    [currentLevel, setSelectedId, doc.elements, levelAlphas],
  );

  /**
   * 素材层是否锁定。
   *
   * 【为什么单独算一个常量】`pickElement` 的 `useCallback` 依赖必须含它：
   * 锁定只改 `doc.layerState`，`doc.elements` 的引用原样不动 —— 依赖写成
   * `[doc.elements]` 就会让回调一直闭着**锁定之前**的文档，
   * 表现为"锁了还能点中"（本功能写用例时就是这么被抓住的）。
   */
  const elementLayerLocked = layerLockedOf(doc, "element");

  /**
   * 命中测试：返回最上层（后放置 = 上层）被点中的元素。
   *
   * 【锁定语义（B4-1）】素材层锁定时**一律返回 `null`** —— 命中测试跳过该层是
   * 锁的唯一定义（渲染不变、LOD 不变，只是"点不中、改不了"）。
   *
   * `ignoreLock` 只给**提示**用：页面在"没命中但层被锁"时再问一次，就能说出
   * 「素材层已锁定」而不是让点击静默无反应（PRD §3.4 明写这是最差的结果）。
   * 除提示外的任何编辑路径都不得传它。
   */
  const pickElement = useCallback(
    (world: { x: number; y: number }, options?: { ignoreLock?: boolean }): MapElement | null => {
      if (!options?.ignoreLock && elementLayerLocked) return null;
      for (let i = doc.elements.length - 1; i >= 0; i -= 1) {
        const el = doc.elements[i];
        const def = SPRITE_MAP[el.spriteId];
        if (!def) continue;
        if (elementWeight(el.level, levelAlphas) < ELEMENT_PICK_MIN_WEIGHT) continue;
        if (
          hitTestElement(world, {
            x: el.x,
            y: el.y,
            width: def.baseWidth,
            height: def.baseHeight,
            scale: el.scale * elementSizeFactor(el.level, levelAlphas.length),
          })
        ) {
          return el;
        }
      }
      return null;
    },
    [doc.elements, elementLayerLocked, levelAlphas],
  );

  /** 按世界坐标增量移动已选中元素（拖拽中高频调用，不入撤销栈） */
  const moveElementBy = useCallback((id: string, dxWorld: number, dyWorld: number) => {
    useMapDocStore.getState().moveElementBy(id, dxWorld, dyWorld);
  }, []);

  /** 拖拽结束：把起始位置压入撤销栈 */
  const commitDragStart = useCallback((doc: MapDocument) => {
    useMapDocStore.getState().commitDragStart(doc);
  }, []);

  /** 删除选中素材（连带删掉联动地名；素材层锁定时不删） */
  const removeSelected = useCallback(() => {
    if (layerLockedOf(useMapDocStore.getState().doc, "element")) return;
    useMapDocStore.getState().removeSelected(selectedId);
    setSelectedId(null);
  }, [selectedId, setSelectedId]);

  /** 清空全部素材 */
  const clearAll = useCallback(() => {
    if (doc.elements.length === 0) return;
    // 锁定层不能被"清空画布"整批端掉：面板上那把锁的含义就是"别动这一层"
    if (layerLockedOf(useMapDocStore.getState().doc, "element")) return;
    useMapDocStore.getState().clearAll();
    setSelectedId(null);
  }, [doc.elements.length, setSelectedId]);

  /* ───────────────── 逻辑图层（B4-1：图层面板的两个开关） ───────────────── */

  /**
   * 切某层的可见性。
   *
   * 【为什么页面不直接摸 store】沿用既有边界（架构 §6-2）：页面只做编排，
   * 所有文档动作从本 hook 走。这里多一层转发几乎零成本，却让"图层可见性
   * 是不是被某个动作顺带改了"只需要在一个文件里查。
   */
  const toggleLayerVisible = useCallback((id: MapLayerId) => {
    useMapDocStore.getState().toggleLayerVisible(id);
  }, []);

  /** 切某层的锁定（只影响命中与编辑，不改渲染） */
  const toggleLayerLock = useCallback((id: MapLayerId) => {
    const store = useMapDocStore.getState();
    store.setLayerLocked(id, !layerLockedOf(store.doc, id));
  }, []);

  /* ───────────────── 折线（B4-2 / R-MAP-26） ───────────────── */

  /** 文档里的折线（读点唯一出口，见 `docPolylines`） */
  const polylines = docPolylines(doc);
  /** 折线层是否锁定（命中测试跳过的依据） */
  const polylineLayerLocked = layerLockedOf(doc, "polyline");
  /** 当前选中的折线；`null` = 未选中（或刚被删掉） */
  const selectedPolyline = useMemo(
    () => (selectedPolylineId ? polylines.find((p) => p.id === selectedPolylineId) ?? null : null),
    [polylines, selectedPolylineId],
  );

  /**
   * 折线命中测试（返回最上层 = 后画的那条）。
   *
   * 【为什么先平滑再算距离】画面上是一条曲线，用户是照着**看得见的曲线**去点的。
   * 若只对控制点之间的直边算距离，弯出去的那一段就成了"看得见却点不中"。
   * 采样数与渲染同一个常量，于是"看得见的线"与"点得中的线"必然是同一条。
   *
   * 【容差 = 线宽/2 + 6px】见 `POLYLINE_PICK_PAD_PX`：纯按线宽算的话，
   * 一条 1px 的小径根本点不中。
   */
  const pickPolyline = useCallback(
    (
      world: { x: number; y: number },
      options?: { ignoreLock?: boolean },
    ): MapPolyline | null => {
      if (!options?.ignoreLock && polylineLayerLocked) return null;
      const px = 1 / Math.max(1e-6, viewport.scale);
      for (let i = polylines.length - 1; i >= 0; i -= 1) {
        const line = polylines[i];
        // 层级权重为 0 的线在画面上不存在，点不中它（与素材同一条规则）
        if (elementWeight(line.level, levelAlphas) < ELEMENT_PICK_MIN_WEIGHT) continue;
        const style = polylineStyleOf(line.styleId, line.kind);
        const width = effectiveWidthWorld(style, line.widthScale, viewport.scale);
        // 与 drawPolyline 同一条退化守卫：<3 点的闭环按开链算（命中与画面一致）
        const closed = line.closed && line.points.length >= 3;
        const path = smoothPolyline(line.points, closed);
        if (distanceToPath(path, world, closed) <= width / 2 + POLYLINE_PICK_PAD_PX * px) {
          return line;
        }
      }
      return null;
    },
    [polylines, polylineLayerLocked, levelAlphas, viewport.scale],
  );

  /**
   * 落一条新折线并选中它（绘制态收尾的唯一出口）。
   *
   * `level` 取**落笔时**的主导层级（`currentLevel`），与素材同规则：在郡那一级画的
   * 河属于郡，缩到洲去看时就该退场。少于 2 点直接丢弃 —— 一个点画不出线。
   */
  const addPolyline = useCallback(
    (
      points: readonly Point[],
      options?: { kind?: PolylineKind; styleId?: string; label?: string; closed?: boolean },
    ): string | null => {
      if (points.length < 2) return null;
      const kind = options?.kind ?? "road";
      const line: MapPolyline = {
        id: createPolylineId(),
        kind,
        styleId: options?.styleId ?? defaultStyleIdOf(kind),
        points: points.map((p) => ({ x: p.x, y: p.y })),
        closed: options?.closed === true,
        level: currentLevel,
      };
      if (options?.label) line.label = options.label;
      useMapDocStore.getState().addPolyline(line);
      setSelectedPolylineId(line.id);
      return line.id;
    },
    [currentLevel, setSelectedPolylineId],
  );

  /** 改折线属性（样式 / 层级 / 线宽 / 标签）；`coalesceKey` 让滑杆一次拖动只占一步撤销 */
  const updatePolyline = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<MapPolyline, "styleId" | "kind" | "level" | "label" | "closed" | "widthScale">
      >,
      coalesceKey?: string,
    ) => {
      useMapDocStore.getState().updatePolyline(id, patch, coalesceKey);
    },
    [],
  );

  /** 删除折线（并清掉选中，否则属性面板会挂在一个已不存在的对象上） */
  const removePolyline = useCallback(
    (id: string) => {
      useMapDocStore.getState().removePolyline(id);
      if (selectedPolylineId === id) setSelectedPolylineId(null);
    },
    [selectedPolylineId, setSelectedPolylineId],
  );

  /** 拖节点（高频、不入撤销栈；快照由拖拽开始时的 `commitDragStart` 记一次） */
  const movePolylinePoint = useCallback(
    (id: string, index: number, world: { x: number; y: number }) => {
      useMapDocStore.getState().movePolylinePoint(id, index, world);
    },
    [],
  );

  /** 双击线段插点 / 双击节点删点（各记一步撤销） */
  const insertPolylinePoint = useCallback(
    (id: string, index: number, point: { x: number; y: number }) => {
      useMapDocStore.getState().insertPolylinePoint(id, index, point);
    },
    [],
  );

  const deletePolylinePoint = useCallback(
    (id: string, index: number) => {
      useMapDocStore.getState().deletePolylinePoint(id, index);
      // 删到只剩 1 点时 store 会整条删掉 —— 选中也要跟着清
      const still = docPolylines(useMapDocStore.getState().doc).some((p) => p.id === id);
      if (!still) setSelectedPolylineId(null);
    },
    [setSelectedPolylineId],
  );

  /* ───────────────── 素材属性 / 剪贴板 / 微移（R-MAP-23 / R-MAP-25） ───────────────── */

  /**
   * 改素材属性（属性面板滑杆的唯一出口）。
   *
   * 【为什么转发而不是让面板直接摸 store】"页面只做编排、文档动作都从本 hook 走"
   * 是既有边界（架构 §6-2）：面板将来要加"改属性前先选中"之类的编排时才有落点。
   */
  const updateElement = useCallback(
    (
      id: string,
      patch: Partial<Pick<MapElement, "scale" | "rotation" | "opacity" | "tint" | "level">>,
      coalesceKey?: string,
    ) => {
      useMapDocStore.getState().updateElement(id, patch, coalesceKey);
    },
    [],
  );

  /** 置顶 / 置底选中素材 */
  const reorderSelected = useCallback(
    (to: "front" | "back") => {
      if (!selectedId) return;
      useMapDocStore.getState().reorderElement(selectedId, to);
    },
    [selectedId],
  );

  /** 复制一份选中素材并选中新副本（Ctrl+D） */
  /**
   * 复制一份选中对象（素材或折线，B4-3 起折线同享）并选中新那份。
   *
   * 【为什么按选中类型分流而不是 store 内部猜】两类选中互斥但**并存于两个
   * 字段**：id 落在哪个字段里，返回的新 id 就该回填到同一个字段 ——
   * 否则"复制一条河"后面板浮出的是素材属性。
   */
  const duplicateSelected = useCallback(() => {
    if (selectedPolylineId) {
      const nextId = useMapDocStore.getState().duplicateElement(selectedPolylineId);
      if (nextId) setSelectedPolylineId(nextId);
      return nextId;
    }
    if (!selectedId) return null;
    const nextId = useMapDocStore.getState().duplicateElement(selectedId);
    if (nextId) setSelectedId(nextId);
    return nextId;
  }, [selectedId, selectedPolylineId, setSelectedId, setSelectedPolylineId]);

  /** 复制选中对象进剪贴板（Ctrl+C；文档不变）。折线与素材同一块剪贴板 */
  const copySelected = useCallback(() => {
    if (selectedPolylineId) {
      useMapDocStore.getState().copyElement(selectedPolylineId);
      return;
    }
    if (!selectedId) return;
    useMapDocStore.getState().copyElement(selectedId);
  }, [selectedId, selectedPolylineId]);

  /** 剪切选中对象（Ctrl+X = 复制 + 删除） */
  const cutSelected = useCallback(() => {
    if (selectedPolylineId) {
      useMapDocStore.getState().cutElement(selectedPolylineId);
      setSelectedPolylineId(null);
      return;
    }
    if (!selectedId) return;
    useMapDocStore.getState().cutElement(selectedId);
    setSelectedId(null);
  }, [selectedId, selectedPolylineId, setSelectedId, setSelectedPolylineId]);

  /**
   * 粘贴剪贴板对象并选中（Ctrl+V；剪贴板不消耗，可连续粘贴）。
   * 粘贴出来的类型跟随剪贴板内容：复制的是河，贴出来的也是河。
   */
  const pasteClipboard = useCallback(() => {
    const nextId = useMapDocStore.getState().pasteElement();
    if (!nextId) return null;
    // 与 store 的形态判定同一把尺子：折线带 `points`，素材没有
    const clip = useMapDocStore.getState().clipboard;
    if (clip && "points" in clip) setSelectedPolylineId(nextId);
    else setSelectedId(nextId);
    return nextId;
  }, [setSelectedId, setSelectedPolylineId]);

  /** 方向键 / WASD 微移选中对象（素材联动地名；折线整体平移。连按合并为一步撤销） */
  const nudgeSelected = useCallback(
    (dxWorld: number, dyWorld: number) => {
      const id = selectedPolylineId ?? selectedId;
      if (!id) return;
      useMapDocStore.getState().nudgeElement(id, dxWorld, dyWorld);
    },
    [selectedId, selectedPolylineId],
  );

  /**
   * 按当前层级定义生成一棵区块树。
   *
   * @param land 陆地（决定种子与多岛切分）
   * @param overrideDepth 可选的层级深度覆盖 —— **仅供测试与"临时截断"用**，
   *   界面不再传：层数的唯一事实源是 `schema.length`（架构 §2.5）。
   * @param schemaOverride 可选的层级定义覆盖 —— 只在"刚写完 schema 的同一次调用"里用：
   *   React 的 `doc` 订阅要到下次渲染才更新，而 `generateLand` / `regenerateHierarchy`
   *   需要在**同一个事件**里读到刚写进去的那份（见 `liveSchema` 的注释）。
   * @param seedOverride 可选的种子覆盖（B3「只换分区」档用）：缺省沿用陆地种子
   *   —— 那意味着"同一块陆地重摇区块"结果不变，作为重掷档必须换种子。
   *
   * 【counts 的来源变了，几何算法没变】数量取自 schema 的 `count`（那是
   * "生成时的目标数量"的语义），生成器内部的 Voronoi / 崎岖化 / 父子共享边界
   * 一个字都没动 —— 所以 `DEFAULT_REGION_SCHEMA` 下的产出与改前逐字节一致。
   */
  const buildRegions = useCallback(
    (
      land: MapLand | null,
      overrideDepth?: number,
      schemaOverride?: readonly RegionLevelDef[],
      seedOverride?: number,
    ): MapRegion[] => {
      const active = schemaOverride ?? schema;
      const depth = Math.max(
        REGION_LEVEL_COUNT_LIMITS.min,
        Math.min(REGION_MAX_LEVELS, Math.round(overrideDepth ?? active.length)),
      );
      // 深度可能超过 schema 长度（测试里传 4 而文档只配了 2 级）：缺的层级回落默认数量，
      // 保证 `generateHierarchy` 拿到的 counts 长度与 depth 一致。
      const counts = Array.from({ length: depth }, (_, level) => {
        const def = active[level] ?? DEFAULT_REGION_SCHEMA[level];
        return Math.max(1, Math.round(def?.count ?? 1));
      });
      const seed =
        seedOverride ?? (land ? land.seed : Math.floor(Math.random() * 0x7fffffff));

      if (!land || land.polygons.length === 0) {
        return generateHierarchy({ seed, bounds: BASE_BOUNDS, levelCounts: counts, schema: active });
      }

      const areas = land.polygons.map((ring) => Math.max(1e-6, polygonArea(ring)));
      const total = areas.reduce((sum, a) => sum + a, 0);
      const out: MapRegion[] = [];
      for (let i = 0; i < land.polygons.length; i += 1) {
        const share = areas[i] / Math.max(1e-9, total);
        /**
         * 【level0 也按面积分摊（2.40.0 起）】旧口径把 level0（大陆）**强制为每岛
         * 1 块**，理由是"一块大陆就该是一块完整的大陆区块"。砍掉大陆/洲之后
         * level0 变成**国家**，"每岛 1 个国家"恰恰是错的 —— 一块陆地上本来就有
         * 十几二十个国家。因此每一级统一用 `count × share`（多岛时按面积分配，
         * 单岛时 share = 1 ⇒ 与 schema 设定逐值相同）。
         *
         * 【代价与兜底】`Math.max(1, …)` 保证小岛也不会分到 0 块；总数仍受
         * `REGION_TOTAL_LIMIT` 在 `generateHierarchy` 内截断。
         */
        out.push(
          ...generateHierarchy({
            seed,
            bounds: BASE_BOUNDS,
            levelCounts: counts.map((c) => Math.max(1, Math.round(c * share))),
            schema: active,
            container: land.polygons[i],
            idPrefix: `i${i}_`,
          }),
        );
      }
      return out;
    },
    [schema],
  );

  /**
   * "生成动作"应当读到的那份文档 —— **从 store 现取，不用闭包里的 `doc`**。
   *
   * 【为什么必须现取】「应用并生成区块」是同一事件里的**两次**写：先
   * `setRegionSchema` 再 `regenerateHierarchy`。zustand 的 `set` 是同步的，所以
   * `getState()` 立刻能读到新 schema；而闭包里的 `doc` 还是上一次渲染的那份 ——
   * 用它去生成会得到"配置成 2 级、却按 4 级切出来"（且不报错）。
   */
  const liveDoc = useCallback(() => useMapDocStore.getState().doc, []);

  /**
   * 重新生成区块树。
   *
   * 【手画块保留】只替换自动生成的区块（PRD §8-Q4）：`origin === "manual"` 的区块
   * 原样留在 `regions` 里。T5 之前手画能力还没上线，`kept` 恒为空 —— 但过滤先写好，
   * 免得 T5 再回来改同一段（架构 §2.5）。
   */
  const regenerateHierarchy = useCallback(
    (levelCount?: number) => {
      const current = liveDoc();
      const active = regionSchemaOf(current);
      const generated = buildRegions(current.land, levelCount, active);
      const kept = current.regions.filter((r) => r.origin === "manual");
      useMapDocStore
        .getState()
        .regenerateHierarchy(kept.length > 0 ? [...generated, ...kept] : generated);
    },
    [buildRegions, liveDoc],
  );

  /** 清除全部区块（可撤销） */
  const clearRegions = useCallback(() => {
    useMapDocStore.getState().clearRegions();
  }, []);

  /**
   * 生成陆地。
   *
   * @param seed 陆地种子；缺省随机
   * @param options `splitRegions`（缺省 **false**）= 是否同时在陆地内划出区块
   *
   * 【签名变更（破坏性）】旧签名的第二参是 `levelCount`（层级深度）。层级深度在
   * R-REG-01 之后只由文档的 `regionSchema` 决定，留着它会变成第二个事实源 ——
   * 而且 `generateLand(seed, 3)` 会静默把 3 当成 options 对象（`opts.splitRegions`
   * 为 undefined ⇒ 走"不分区"，不报错），是典型的静默错误。因此**不留兼容重载**，
   * 由类型系统当唯一护栏（架构 §4-T2 与 §6-6）。
   *
   * 【手画块保留（主理人裁决 1）】手画区块是最贵的用户成果，绝不能被一次「生成陆地」
   * 抹掉：
   *   · `splitRegions: false` ⇒ `regions` = 原有的手画块（自动块全清）；
   *   · `splitRegions: true`  ⇒ `regions` = 新生成的自动块 + 手画块。
   * 代价是手画块是基于**旧陆地**画的，坐标可能与新陆地失配 —— 所以页面在
   * `manualCount > 0` 时必须先告知（文案在 index.tsx 的 `handleGenerateLand`）。
   */
  const generateLand = useCallback(
    (seed?: number, options?: { splitRegions?: boolean }) => {
      const nextSeed = (Math.floor(seed ?? Math.random() * 0x7fffffff) >>> 0) || 1;
      const land = buildLand({ seed: nextSeed, bounds: BASE_BOUNDS });
      if (land.polygons.length === 0) return;
      // R-REG-02：**默认不分区**。"一键出图"的老习惯由「同时划出区块」勾选恢复。
      const splitRegions = options?.splitRegions === true;
      // 手画块与 schema 都从 store 现取（理由见 `liveDoc`）：本动作从前一次点击的
      // 闭包里拿 `doc` 时，刚改过层级定义就会按旧配置切分。
      const current = liveDoc();
      const kept = current.regions.filter((r) => r.origin === "manual");
      const regions = splitRegions
        ? [...buildRegions(land, undefined, regionSchemaOf(current)), ...kept]
        : kept;
      useMapDocStore.getState().generateLand(land, regions);
    },
    [buildRegions, liveDoc],
  );

  /** 清除陆地 */
  const clearLand = useCallback(() => {
    useMapDocStore.getState().clearLand();
  }, []);

  /** 切换「显示分区」 */
  const toggleRegions = useCallback(() => {
    useMapDocStore.getState().toggleRegions();
  }, []);

  /** 切换全局风格预设 */
  const setStyle = useCallback((next: MapStyle) => {
    useMapDocStore.getState().setStyle(next);
  }, []);

  /** 新建一条地名 */
  const addLabel = useCallback(
    (input: { x: number; y: number; text: string; level: number | null; size?: MapLabelSize }) =>
      useMapDocStore.getState().addLabel(input),
    [],
  );

  /** 改一条地名 */
  const updateLabel = useCallback(
    (id: string, patch: Partial<Pick<MapLabel, "text" | "x" | "y" | "size" | "level">>) => {
      useMapDocStore.getState().updateLabel(id, patch);
    },
    [],
  );

  const removeLabel = useCallback((id: string) => {
    useMapDocStore.getState().removeLabel(id);
  }, []);

  /** 给某个素材起名（有则改、无则建） */
  const setElementLabel = useCallback(
    (elementId: string, text: string, size?: MapLabelSize) => {
      useMapDocStore.getState().setElementLabel(elementId, text, size);
    },
    [],
  );

  /** 选中素材绑定的地名 */
  const elementLabelOf = useCallback(
    (elementId: string | null): MapLabel | null =>
      elementId ? doc.labels.find((l) => l.elementId === elementId) ?? null : null,
    [doc.labels],
  );

  /** 撤销 / 重做 */
  const undo = useCallback(() => {
    useMapDocStore.getState().undo();
    setSelectedId(null);
  }, [setSelectedId]);

  const redo = useCallback(() => {
    useMapDocStore.getState().redo();
    setSelectedId(null);
  }, [setSelectedId]);

  /* ───────────────── 嵌套子地图（Phase 2） ───────────────── */

  /**
   * 选中的区块（由 `selectedRegionId` 派生）。`null` = 未选中区块。
   *
   * 【为什么用派生而不是单独存引用】`selectedRegionId` 是选择 store 里的**标量**，
   * 区块本体随 `doc.regions` 不可变更新；另存一份引用会与文档树脱节（撤销重做后
   * 指向旧对象）。派生读取保证"选区永远指向当前文档里的那一块"。
   */
  const selectedRegion = useMemo(
    () => (selectedRegionId ? doc.regions.find((r) => r.id === selectedRegionId) ?? null : null),
    [selectedRegionId, doc.regions],
  );

  /**
   * 叶子判定索引：`doc.regions` 不变时可复用（O(n) 一次建好）。
   *
   * 【为什么不放进渲染的每帧路径】`drawOverlay` 的依赖含 `viewport.scale`，
   * 滚轮每格都会跑一遍 —— 在那里建索引等于每次缩放都扫 600 块（架构 §5-6）。
   */
  const parentIdSet = useMemo(() => buildParentIdSet(doc.regions), [doc.regions]);

  /**
   * 选中的区块是否**叶子**（没有任何区块以它为父）。
   *
   * 【判据是结构，不是 `level === maxLevel`】合并会造出 `level` 更浅的叶子
   * （把"国家"的郡全合并掉后，"国家"是叶子但 `level = 2`），按 level 判会让
   * 用户做完合并立刻失去选中反馈（PRD §6-A / 团队裁决 #1）。
   */
  const selectedIsLeaf = useMemo(
    () => (selectedRegion ? isLeafRegion(selectedRegion.id, parentIdSet) : false),
    [selectedRegion, parentIdSet],
  );

  /**
   * 选中区块的**祖先链 + 自身**（根 → 父 → 自身），供面板面包屑。
   *
   * `[]` = 未选中。祖先被合并过导致断链时 `ancestorPathOf` 会自行停下，
   * 面包屑因此不会出现空段（空名段由面板再过滤一次）。
   */
  const regionPath = useMemo(
    () =>
      selectedRegion ? [...ancestorPathOf(doc.regions, selectedRegion.id), selectedRegion] : [],
    [selectedRegion, doc.regions],
  );

  /**
   * 点选区块：设置选中区块，并清掉素材选中（两者互斥）。
   */
  const pickRegion = useCallback(
    (regionId: string | null) => {
      setSelectedRegionId(regionId);
      if (regionId) setSelectedId(null);
    },
    [setSelectedRegionId, setSelectedId],
  );

  /**
   * 计算区块多边形的轴对齐包围盒（世界坐标），子图 bounds / 贴合变换都用它。
   */
  const regionBoundsOf = useCallback((polygon: Point[]): Rect => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of polygon) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, []);

  /**
   * 把视口推进到一个区块（"进入子图"）。
   *
   * 【为什么"进入子图"只是推视口】子图的区块树已经挂在 `region.submap` 上、
   * 由渲染层按 `submapEnterWeight` 渐入，它没有独立坐标系需要切换 ——
   * "进入"在数据上等于"把视口推到这块地的包围盒"。这样返回全景也只是再
   * 聚焦一次整张纸，不需要维护一套"当前在哪个子图"的路径栈。
   */
  const focusRegion = useCallback(
    (regionId: string) => {
      const region = doc.regions.find((r) => r.id === regionId);
      if (!region || region.polygon.length < 3) return;
      const rect = regionBoundsOf(region.polygon);
      if (rect.width <= 0 || rect.height <= 0) return;
      // 下限取子图渐入阈值：level-0 的大陆边缘就是纸边，"适配包围盒"得到的缩放
      // 可能低于渐入阈值 —— 那样推进过去依旧看不见子图，等于没进去。
      useMapViewportStore.getState().focusRect(rect, canvasSize, zoomLimits, region.submapEnterScale);
    },
    [doc.regions, regionBoundsOf, canvasSize, zoomLimits],
  );

  /** 路径 A：把一张已有的子地图绑定到指定区块（内容来自外部） */
  const embedSubmap = useCallback((regionId: string, submap: MapSubmap) => {
    useMapDocStore.getState().embedSubmap(regionId, submap);
  }, []);

  /** 移除区块上的子图（恢复为普通区块） */
  const removeSubmap = useCallback((regionId: string) => {
    useMapDocStore.getState().removeSubmap(regionId);
  }, []);

  /**
   * 合并子树（转 store，不再叠加任何逻辑）。
   *
   * @returns `removed` = 删除的后代数量；`withSubmap` = 其中带子图的数量。
   *   页面用它拼 `message.success("已合并 N 个子区块（可撤销）")`。
   *
   * 【为什么不在 hook 里做计划】预览（弹窗）与执行（store）必须**各自**算一次：
   * 预览是为了显示数量，执行是为了真的删；让执行信任调用方传进来的计划，
   * 就等于把"文档可能已被改动"这件事留给调用方保证（架构 §3.4）。
   */
  const mergeSubtree = useCallback((rootId: string) => {
    return useMapDocStore.getState().mergeSubtree(rootId);
  }, []);

  /**
   * 手画落库（R-REG-03 的唯一入口）。
   *
   * @param polygon 草稿顶点（世界坐标，首尾**不**重复）
   * @returns `ok:false` 时 `code` 是**枚举**（文案由页面查表，见架构 §5）；
   *   `ok:true` 时 `region` 是刚写进文档的那一条（页面可能拿它做后续选中）。
   *
   * 【校验只调 `checkManualRegion`】自交 / 同父兄弟 / 祖先链 / 父包含 / 层级封顶 /
   * 总数上限六类判定已经在纯函数里写全了，这里再补一遍就等于有两份规则 ——
   * 而两份规则迟早会在边界上打架（T1 的用例正是按那个函数写的）。
   *
   * 【文档从 store 现取】与 `regenerateHierarchy` 同理：草稿是"跨多次事件累积"的
   * React 状态，而落笔这一下必须看到**此刻**的 `doc.regions`（其间可能发生过撤销、
   * 生成、合并）。闭包里那份可能是上一次渲染的。
   *
   * 【失败不产生快照】`commit` 只在这一条的最后调用一次；任何 `ok:false` 分支
   * 都在它之前返回（PRD R-REG-03 边界⑧ 的另一半：Esc 也不产生快照）。
   */
  const addManualRegion = useCallback(
    (polygon: readonly Point[]): ManualRegionAddResult => {
      const current = useMapDocStore.getState().doc;
      const active = regionSchemaOf(current);
      const selectedRegionId = useMapSelectionStore.getState().selectedRegionId;
      const parent = selectedRegionId
        ? current.regions.find((r) => r.id === selectedRegionId) ?? null
        : null;

      const check = checkManualRegion({
        polygon,
        parent,
        regions: current.regions,
        levelCount: active.length,
      });
      if (!check.ok) return { ok: false, code: check.code, conflict: check.conflict };

      const level = parent ? parent.level + 1 : 0;
      const ordinal = nextRegionOrdinal(current.regions, level);
      const region: MapRegion = {
        id: createRegionId(),
        parentId: parent ? parent.id : null,
        level,
        name: manualRegionName(active, level, ordinal),
        // 质心作为种子点（与生成器的 `seed` 同语义：一个"这块地的代表点"）
        seed: polygonCentroid(check.polygon),
        polygon: check.polygon,
        // 有父块 ⇒ 继承父色相微抖；无父块 ⇒ 黄金角分散（见 `manualRegionColor`）
        color: manualRegionColor({ parentColor: parent ? parent.color : null, ordinal }),
        origin: "manual",
      };
      useMapDocStore.getState().addRegion(region);
      return { ok: true, region };
    },
    [],
  );

  /**
   * 路径 B：圈定一个区块，在该区块内**现场生成**一张子图（「先生成大地图，再圈定
   * 区域生成对应小地图」）。子图内容用 `generateHierarchy` 的 `container` 参数
   * 在区块多边形内切分，边界天然重合（与 boundary 篇「共享几何」同源）。
   *
   * @param regionId 被圈定的区块
   * @param levelCount 子图自己的层级数（缺省 1 = 只切一层，子图内部再往下是二期）
   */
  const carveSubmap = useCallback(
    (regionId: string, levelCount = 1) => {
      const region = doc.regions.find((r) => r.id === regionId);
      if (!region || region.polygon.length < 3) return;

      const bounds = regionBoundsOf(region.polygon);
      if (bounds.width <= 0 || bounds.height <= 0) return;

      // ── 坐标域：把区块搬到「子图本地坐标」再切分 ──
      //
      // 【为什么必须搬】`MapSubmap.bounds` 的约定是**子图本地坐标**（见
      // `fitSubmapTransform` 的注释），渲染时子图内容会被 `p × scale + 区块中心`
      // 映射回父图世界。如果这里直接用父图世界坐标生成分区，渲染就会**再把它们
      // 平移一次区块中心** —— 只有包围盒中心恰好是原点时才碰巧对得上，否则
      // 整个子图会偏移到区块外面（且不报错、只在画面上"看起来偏了"）。
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      const localBounds = {
        x: -bounds.width / 2,
        y: -bounds.height / 2,
        width: bounds.width,
        height: bounds.height,
      };
      const localContainer = region.polygon.map((p) => ({ x: p.x - cx, y: p.y - cy }));

      // 子图区块树：在区块多边形容器内现场切分（复用既有 generateHierarchy）
      const depth = Math.max(
        REGION_LEVEL_COUNT_LIMITS.min,
        Math.min(REGION_MAX_LEVELS, Math.round(levelCount)),
      );
      // 子图暂不写自己的 `regionSchema`（`MapSubmap.regionSchema` 只加了类型字段），
      // 层级名与数量沿用父文档这份 —— 缺字段时读父文档正是 PRD §5.3 的约定。
      const counts = schema.slice(0, depth).map((l) => l.count);
      const subRegions = generateHierarchy({
        seed: region.seed ? region.seed.x * 1000 + region.seed.y : Math.random() * 0x7fffffff,
        bounds: localBounds,
        levelCounts: counts,
        schema,
        container: localContainer,
        idPrefix: `sm_${regionId}_`,
      });

      const submap: MapSubmap = {
        id: createSubmapId(),
        bounds: localBounds,
        land: null,
        regions: subRegions,
        elements: [],
        labels: [],
        style: doc.style,
        baseImageId: doc.baseImageId,
      };

      // 自动渐入阈值：区块屏幕长边 ≈ LOD_BLOCK_PX 时淡入
      const enterScale = enterScaleForRegion(polygonLongEdge(region.polygon));

      // 一次 commit 原子完成「挂子图 + 写渐入阈值」，撤销栈只记一步
      useMapDocStore.getState().embedSubmap(regionId, submap, enterScale);
    },
    [doc.regions, doc.style, doc.baseImageId, regionBoundsOf, schema],
  );

  /* ───────────────── 一键成图（B3 / R-MAP-21）───────────────── */

  /**
   * 上一次生成器的产物（五档局部重掷的原料）。
   *
   * 【为什么是 ref 而不是 state】placements / elementIds 是几百条的数组，
   * 不参与渲染 —— 进 state 等于每次生成都白渲染整棵树。
   */
  const lastGenRef = useRef<{
    params: GeneratorParams;
    seed: number;
    placements: SpritePlacement[];
    elementIds: string[];
  } | null>(null);
  /**
   * 生成会话的轻量镜像（state）：hasGenerated / lastParams 要参与渲染
   * （弹层按钮 disabled），渲染期不得读 ref（react-hooks/refs）——
   * 所以"有没有生成过"用 state 表达，重资产留在 ref。
   */
  const [lastGenMeta, setLastGenMeta] = useState<{ params: GeneratorParams; seed: number } | null>(
    null,
  );
  /** 局部重掷计数：同档连点每次都要不同结果（盐值随自增计数翻转） */
  const gearCounterRef = useRef({ land: 0, sprites: 0, names: 0, regions: 0 });

  /**
   * 生成器编排（五档重掷的唯一入口）。
   *
   * @returns 结果摘要文案（弹层展示）；空串 = 本次没有可写的变更。
   *
   * 五档语义（review §5.3 铁律 3）：
   *   · all      换一张（新 base seed）：陆地 + 素材 + 地名 +（可选）区块全换；
   *   · land     只换陆地：素材与地名**保持原位**（可能落到新海面上——
   *              v1 已知取舍，返回文案会说明）；区块自动块随新陆地重建；
   *   · sprites  只换素材：陆地不动（landSeed 不变 ⇒ 逐字节同形），
   *              素材子流换盐重新选材布点，地名随之重排；
   *   · names    只换地名：素材一个不动，地名子流换盐重排；
   *   · regions  只换分区：走既有 buildRegions（换种子）。
   */
  const generateFullMap = useCallback(
    (params: GeneratorParams, gear: GeneratorGear): string => {
      const store = useMapDocStore.getState();
      const preset = MAP_PRESETS.find((p) => p.id === params.presetId) ?? MAP_PRESETS[0];
      const current = store.doc;
      const sizeOf = spriteSizeOf;

      /** 布点 → 文档素材实例（顺序与 placements 对齐，names[i] ↔ elements[i]） */
      const toElements = (ps: readonly SpritePlacement[]): MapElement[] =>
        ps.map((p) => ({
          id: createElementId(),
          spriteId: p.spriteId,
          x: p.x,
          y: p.y,
          scale: p.scale,
          rotation: p.rotation,
          // 镜像翻转（P1-4）：生成器按素材 flippable 摇出的翻面随实例落档，
          // 渲染侧按它做 scale.x 取反（见 MapCanvas / submapRender）
          flipX: p.flipX,
          // 生成的是"成品图对象"：任何缩放下都可见（层级无关）
          level: null,
        }));

      /** 布点名 → 联动地名标注（挂在素材头顶，与手动落位同款） */
      const toLabels = (
        named: readonly { index: number; text: string }[],
        elements: readonly MapElement[],
        ps: readonly SpritePlacement[],
      ): MapLabel[] =>
        named.flatMap((n) => {
          const el = elements[n.index];
          const p = ps[n.index];
          if (!el || !p) return [];
          return [
            {
              id: createLabelId(),
              text: n.text,
              x: el.x,
              y: el.y - LABEL_ABOVE_ELEMENT,
              size: LABEL_DEFAULT_SIZE,
              level: el.level,
              elementId: el.id,
            } satisfies MapLabel,
          ];
        });

      // ── all（或从未生成过，等价 all）──────────────────────────
      if (gear === "all" || !lastGenRef.current) {
        const seed = (Math.floor(Math.random() * 0x7fffffff) >>> 0) || 1;
        const gen = generateMap({
          seed,
          bounds: BASE_BOUNDS,
          preset,
          richness: params.richness,
          mode: params.mode,
          pool: SPRITES,
          sizeOf,
          // 内容开关 / 山体·河流密度 / 要素大小：缺省全开+正常，与 2.39.0 逐实例一致
          tuning: resolveGeneratorTuning(params),
          // 大陆形状 / 底色：缺省「正常」/羊皮纸 = 与 2.40.0 逐字节一致
          shape: params.shapeId,
          landColorId: params.landColorId,
        });
        const named =
          params.mode === "full" && params.withLabels
            ? assignPlacementNames(gen.placements, preset, seed)
            : [];
        const elements = toElements(gen.placements);
        const labels = toLabels(named, elements, gen.placements);
        // 手画块保留（与「生成陆地」同一裁决）：自动块按勾选态重建
        const kept = current.regions.filter((r) => r.origin === "manual");
        const regions = params.withRegions
          ? [...buildRegions(gen.land, undefined, regionSchemaOf(current)), ...kept]
          : kept;
        // 纹理带随全量生成走；骨架档不带（gen.bands = undefined → 显式清掉旧带）
        store.applyGenerated({ land: gen.land, elements, labels, regions, bands: gen.bands ?? null });
        lastGenRef.current = {
          params,
          seed,
          placements: gen.placements,
          elementIds: elements.map((e) => e.id),
        };
        setLastGenMeta({ params, seed });
        gearCounterRef.current = { land: 0, sprites: 0, names: 0, regions: 0 };
        setSelectedId(null);
        setSelectedRegionId(null);
        return summaryTextOf(gen.land, gen.placements, labels.length, seed);
      }

      const last = lastGenRef.current;
      // 局部重掷的 preset 只认**上一次生成**的参数：弹层里改了预设再点重掷，
      // 换名的池子也不能跟着变 —— 那等于偷偷换了配方
      const lastPreset = MAP_PRESETS.find((p) => p.id === last.params.presetId) ?? MAP_PRESETS[0];

      // ── land：只换陆地（素材/地名原位保留）────────────────────
      if (gear === "land") {
        gearCounterRef.current.land += 1;
        const landSeed =
          ((landSeedOf(last.seed) ^ Math.imul(gearCounterRef.current.land, 0x27d4eb2d)) >>> 0) || 1;
        const land = buildLand({
          seed: landSeed,
          bounds: BASE_BOUNDS,
          // 「只换陆地」也跟随弹层里选的形状与底色（与 all 档同一套参数）
          shape: last.params.shapeId,
        });
        land.baseColor = landColorOf(last.params.landColorId).color;
        const kept = current.regions.filter((r) => r.origin === "manual");
        const regions = [...buildRegions(land, undefined, regionSchemaOf(current)), ...kept];
        // 纹理带跟新陆地重算（同配方同档位；纯几何，不消耗任何子流骰子）
        const bands = computeTerrainZones(
          land,
          lastPreset.climate,
          Math.max(8, GRID_SIZES[last.params.richness]),
        );
        store.applyGenerated({ land, regions, bands });
        return `已重掷陆地（${land.polygons.length} 块）：素材与地名保持原位，落在海面上的可手动挪回陆地（可撤销）`;
      }

      // ── sprites：只换素材（陆地逐字节不动）────────────────────
      if (gear === "sprites") {
        gearCounterRef.current.sprites += 1;
        const elementSeed =
          (elementSeedOf(last.seed) ^ Math.imul(gearCounterRef.current.sprites, 0x85ebca6b)) >>> 0;
        const gen = generateMap({
          seed: last.seed,
          bounds: BASE_BOUNDS,
          preset: lastPreset,
          richness: last.params.richness,
          mode: "full",
          pool: SPRITES,
          sizeOf,
          elementSeed,
          // 只换素材 = 同一套配方（含勾选态 / 密度档 / 要素大小）重摇布点
          tuning: resolveGeneratorTuning(last.params),
        });
        const named = last.params.withLabels
          ? assignPlacementNames(gen.placements, lastPreset, last.seed)
          : [];
        const elements = toElements(gen.placements);
        const labels = toLabels(named, elements, gen.placements);
        store.applyGenerated({ land: gen.land, elements, labels, bands: gen.bands });
        lastGenRef.current = {
          ...last,
          placements: gen.placements,
          elementIds: elements.map((e) => e.id),
        };
        setSelectedId(null);
        setSelectedRegionId(null);
        return `已重掷素材：${elements.length} 个（陆地与区块不变，可撤销）`;
      }

      // ── names：只换地名（素材一个不动）────────────────────────
      if (gear === "names") {
        gearCounterRef.current.names += 1;
        const nameSeed =
          (nameSeedOf(last.seed) ^ Math.imul(gearCounterRef.current.names, 0xc2b2ae35)) >>> 0;
        // 本批素材的旧联动名不算"占用"（它们就是要被换掉的）
        const lastIds = new Set(last.elementIds);
        const taken = new Set(
          current.labels
            .filter((l) => !l.elementId || !lastIds.has(l.elementId))
            .map((l) => l.text),
        );
        const named = assignPlacementNames(last.placements, lastPreset, last.seed, {
          taken,
          nameSeed,
        });
        const entries = named.flatMap((n) => {
          const elementId = last.elementIds[n.index];
          return elementId ? [{ elementId, text: n.text }] : [];
        });
        store.relabelElements(entries);
        return `已重掷 ${entries.length} 个地名（素材不动，可撤销）`;
      }

      // ── regions：只换分区（换种子重切）────────────────────────
      gearCounterRef.current.regions += 1;
      const regionsSeed =
        ((current.land?.seed ?? 1) ^ Math.imul(gearCounterRef.current.regions, 0x9e3779b9)) >>> 0 || 1;
      const kept = current.regions.filter((r) => r.origin === "manual");
      const generated = buildRegions(current.land, undefined, regionSchemaOf(current), regionsSeed);
      store.applyGenerated({ regions: [...generated, ...kept] });
      return `已重掷区块：${generated.length} 块（手画块保留，可撤销）`;
    },
    [buildRegions, setSelectedId, setSelectedRegionId],
  );

  return {
    doc,
    viewport,
    selectedId,
    selectedRegionId,
    selectedRegion,
    /** 选中区块的祖先链 + 自身（根 → 父 → 自身）；`[]` = 未选中 */
    regionPath,
    /** 选中区块是否叶子（决定画布画三笔还是容器态、面板「合并」是否 disabled） */
    selectedIsLeaf,
    pendingSpriteId,
    images: textures,
    imagesReady: ready,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    /** 当前文档的有效层级定义（读时回落；层数的唯一事实源 = `schema.length`） */
    schema,
    setRegionSchema,
    /** 断掉"连续调参"的快照合并键（失焦 / 关闭配置浮层时调） */
    breakCommitKey,
    levelAlphas,
    currentLevel,
    regionScales,
    zoomLimits,
    setSelectedId,
    setSelectedRegionId,
    pickRegion,
    setPendingSpriteId,
    handleWheel,
    handlePan,
    fitView,
    applyViewport,
    placeSprite,
    pickElement,
    /* ── 折线（B4-2）── */
    polylines,
    /** 当前选中的折线 id（选中态唯一来源） */
    selectedPolylineId,
    selectedPolyline,
    polylineLayerLocked,
    setSelectedPolylineId,
    pickPolyline,
    addPolyline,
    updatePolyline,
    removePolyline,
    movePolylinePoint,
    insertPolylinePoint,
    deletePolylinePoint,
    moveElementBy,
    commitDragStart,
    removeSelected,
    clearAll,
    toggleLayerVisible,
    toggleLayerLock,
    updateElement,
    reorderSelected,
    duplicateSelected,
    copySelected,
    cutSelected,
    pasteClipboard,
    nudgeSelected,
    regenerateHierarchy,
    clearRegions,
    generateLand,
    clearLand,
    toggleRegions,
    setStyle,
    addLabel,
    updateLabel,
    removeLabel,
    setElementLabel,
    elementLabelOf,
    undo,
    redo,
    embedSubmap,
    removeSubmap,
    mergeSubtree,
    addManualRegion,
    carveSubmap,
    focusRegion,
    /** 一键成图（B3）：params + 五档重掷，返回摘要文案 */
    generateFullMap,
    /** 是否已有生成器产物（局部重掷按钮的 disabled 依据；state 镜像，可渲染期读） */
    hasGenerated: lastGenMeta !== null,
    /** 上一次生成的参数（局部重掷沿用；null = 还没生成过） */
    lastGeneratorParams: lastGenMeta?.params ?? null,
    setBaseImage: useCallback((id: string) => {
      useMapDocStore.getState().setBaseImage(id);
    }, []),
  };
}

/**
 * 手画落库的结果。
 *
 * 【为什么是判别联合而不是 `MapRegion | null`】页面必须能区分"成功"与"为什么失败"：
 * 失败时要按 `code` 查文案（8 个拒绝原因各一句），`null` 会把它们糊成一个"不行"。
 * `conflict` 只在"与某个具体区块冲突"时才带（重叠 / 越界），文案里要嵌它的名字。
 */
export type ManualRegionAddResult =
  | { ok: true; region: MapRegion }
  | { ok: false; code: ManualRegionRejectCode; conflict?: { id: string; name: string } };

export type MapEditorApi = ReturnType<typeof useMapEditor>;

/* ───────────────── 一键成图（B3 / R-MAP-21）装配 ───────────────── */

// domain 层禁 import sprites.ts（架构 §六）：素材名池经此注入一次
installSpriteNamesResolver((id) => SPRITE_MAP[id]?.names);

/** spriteId → 渲染尺寸（生成器碰撞用）；未登记 id 走缺省，不抛错 */
function spriteSizeOf(spriteId: string): { width: number; height: number } {
  const def = SPRITE_MAP[spriteId];
  return def ? { width: def.baseWidth, height: def.baseHeight } : { width: 90, height: 70 };
}

/** 结果摘要（review §5.3）：分类计数用面板同款中文标签 */
function summaryTextOf(
  land: MapLand,
  placements: readonly SpritePlacement[],
  namedCount: number,
  seed: number,
): string {
  const s = summarizeGeneration(land, placements, namedCount, (id) => SPRITE_MAP[id]?.category);
  const parts = SPRITE_CATEGORIES.map((c) =>
    s.byCategory[c.key] ? `${c.label} ${s.byCategory[c.key]}` : "",
  ).filter(Boolean);
  if (s.byCategory.other) parts.push(`其他 ${s.byCategory.other}`);
  // 地貌带分布（P0-1 的可核对产物）：分带失效会在这里立刻现形 ——
  // 如果一张温带图「沙带」占了大半，说明带过滤没生效或格网跨了纬度
  const bands = SPRITE_ZONES.map((z) => (s.byZone[z] ? `${ZONE_LABELS[z]} ${s.byZone[z]}` : ""))
    .filter(Boolean)
    .join(" / ");
  return `已生成：陆地 ${s.landCount} 块 · ${parts.join(" · ")} · 地名 ${s.namedCount}${bands ? ` · 分带 ${bands}` : ""}（seed ${seed}，可撤销）`;
}
