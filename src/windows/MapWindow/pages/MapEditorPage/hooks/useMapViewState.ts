/**
 * 地图编辑器视图状态（§6.2.1 ViewState 层）。
 *
 * 负责层级 LOD 派生、缩放上下限、视口交互与选中态的可见性联动；
 * 不持有文档数据、不发起任何文档编辑动作。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  FIT_PADDING,
  ZOOM_LIMITS,
  fitScaleFor,
  fitToRect,
  type CanvasSize,
  type Viewport,
} from "../coords";
import {
  ELEMENT_PICK_MIN_WEIGHT,
  activeLevel,
  elementWeight,
  finestBlockLongEdge,
  levelAlphas as computeLevelAlphas,
  levelCountsOf,
  naturalScales,
  zoomLimitsForBlocks,
} from "../lod";
import type { MapDocument } from "../types";
import { BASE_BOUNDS, useMapViewportStore } from "../store/useMapViewportStore";
import { useMapSelectionStore } from "../store/useMapSelectionStore";

interface MapViewStateArgs {
  doc: MapDocument;
  viewport: Viewport;
  selectedId: string | null;
  canvasSize: CanvasSize;
}

export function useMapViewState({ doc, viewport, selectedId, canvasSize }: MapViewStateArgs) {  /* ───────────────── 层级 LOD（无极缩放的衔接） ───────────────── */

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

  return {
    regionScales,
    levelAlphas,
    currentLevel,
    zoomLimits,
    setViewport,
    setSelectedId,
    setSelectedRegionId,
    setSelectedPolylineId,
    setPendingSpriteId,
    fitView,
    applyViewport,
    handleWheel,
    handlePan,
  };
}
