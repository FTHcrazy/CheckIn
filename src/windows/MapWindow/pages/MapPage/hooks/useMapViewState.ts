/**
 * 地图视图状态 Hook（AGENTS.md 6.2.1 状态分层 + PRD novel-map §6）
 *
 * 职责：
 * - 视口（缩放 / 平移 / 适配）
 * - 工具（选择 / 抓手 / 画笔 / 贴章 / 地点钉 / 区域框 / 标签 / 连线）
 * - 画笔参数（铺满地形 / 笔刷大小 / 形状）
 * - 选中（标注 id / 贴章 id）
 * - 左栏三态（标注 / 地形画笔 / 符号库）、面包屑下钻路径、图例页、对话框开关
 *
 * 不负责：content 数据本身（useMapData）与标注/贴章编辑草稿（页面内联更新）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { LAYOUT } from "../map-config";

export type MapTool =
  | "select"
  | "pan"
  | "brush"
  | "stamp"
  | "pin"
  | "area"
  | "label"
  | "line";

export type SideTab = "anno" | "terrain" | "symbol";

export interface Viewport {
  tx: number;
  ty: number;
  scale: number;
}

export interface DrillEntry {
  mapId: string;
  name: string;
}

export function useMapViewState() {
  const [viewport, setViewport] = useState<Viewport>({
    tx: 0,
    ty: 0,
    scale: LAYOUT.defaultScale,
  });
  const [tool, setTool] = useState<MapTool>("select");
  const [paintTerrain, setPaintTerrain] = useState(4); // 默认草原
  const [paintSize, setPaintSize] = useState<1 | 3 | 5>(1);
  const [brushShape, setBrushShape] = useState<"circle" | "rect">("circle");
  const [selectedAnno, setSelectedAnno] = useState<string | null>(null);
  const [selectedStamp, setSelectedStamp] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>("anno");
  const [drillPath, setDrillPath] = useState<DrillEntry[]>([]);
  const [legendOpen, setLegendOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const viewportRef = useRef(viewport);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  const zoomBy = useCallback(
    (factor: number, originX = 0, originY = 0) => {
      setViewport((vp) => {
        const nextScale = Math.max(
          LAYOUT.minScale,
          Math.min(LAYOUT.maxScale, vp.scale * factor),
        );
        if (nextScale === vp.scale) return vp;
        const k = nextScale / vp.scale;
        return {
          scale: nextScale,
          tx: originX - (originX - vp.tx) * k,
          ty: originY - (originY - vp.ty) * k,
        };
      });
    },
    [],
  );

  const zoomTo = useCallback((scale: number) => {
    setViewport((vp) => ({
      ...vp,
      scale: Math.max(LAYOUT.minScale, Math.min(LAYOUT.maxScale, scale)),
    }));
  }, []);

  const panBy = useCallback((dx: number, dy: number) => {
    setViewport((vp) => ({ ...vp, tx: vp.tx + dx, ty: vp.ty + dy }));
  }, []);

  const resetView = useCallback(() => {
    setViewport({ tx: 0, ty: 0, scale: LAYOUT.defaultScale });
  }, []);

  const fitView = useCallback(
    (containerW: number, containerH: number, worldW: number, worldH: number, pad = 40) => {
      const availW = containerW - pad * 2;
      const availH = containerH - pad * 2;
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / worldW, availH / worldH);
      setViewport({
        scale,
        tx: (containerW - worldW * scale) / 2,
        ty: (containerH - worldH * scale) / 2,
      });
    },
    [],
  );

  const select = useCallback((annoId: string | null, stampId: string | null = null) => {
    setSelectedAnno(annoId);
    setSelectedStamp(stampId);
  }, []);

  const pushDrill = useCallback((entry: DrillEntry) => {
    setDrillPath((p) => [...p, entry]);
  }, []);

  const popDrill = useCallback((levels = 1) => {
    setDrillPath((p) => p.slice(0, Math.max(0, p.length - levels)));
  }, []);

  return {
    viewport,
    viewportRef,
    tool,
    setTool,
    paintTerrain,
    setPaintTerrain,
    paintSize,
    setPaintSize,
    brushShape,
    setBrushShape,
    selectedAnno,
    selectedStamp,
    setSelectedAnno,
    setSelectedStamp,
    sideTab,
    setSideTab,
    drillPath,
    pushDrill,
    popDrill,
    legendOpen,
    setLegendOpen,
    generateOpen,
    setGenerateOpen,
    exportOpen,
    setExportOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    zoomBy,
    zoomTo,
    panBy,
    resetView,
    fitView,
    select,
  };
}
