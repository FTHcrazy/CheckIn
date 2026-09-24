import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMapData } from "./hooks/useMapData";
import { useMapViewState, type MapTool } from "./hooks/useMapViewState";
import { worldFromContent, LI_PER_CELL, type BuiltWorld, type TerrainTemplates } from "./map-terrain";
import { viewExtentLi } from "./map-scale";
import { exportPng } from "./services/map-service";
import type { MapAnnotation, MapStamp } from "@/shared/types/electron.d.ts";
import MapTopBar from "./components/MapTopBar";
import MapSidebar from "./components/MapSidebar";
import MapCanvas from "./components/MapCanvas";
import AnnotationProps from "./components/AnnotationProps";
import StampPanel from "./components/StampPanel";
import GenerateDialog from "./components/GenerateDialog";
import ExportDialog from "./components/ExportDialog";
import LegendView from "./components/LegendView";
import MapStatusBar from "./components/MapStatusBar";
import MapIcon from "./components/MapIcon";
import { EnvironmentOutlined } from "@ant-design/icons";
import "./index.scss";

/**
 * 里程数值文案（千分位、不带单位）：用于「全图 W×H 里」这类拼接场景，
 * 单值展示请用 map-scale.formatLi（自动切「万里」）。
 */
function fmtLi(v: number): string {
  return Math.round(v).toLocaleString("zh-CN");
}

/**
 * MapPage —— 小说架空地图编辑器主页面（docs/novel-map-prd.md §4 产品结构）
 *
 * 布局：顶栏（地图切换/新建/导出/撤销/设置）+ 左栏三态（标注/地形/符号库）+
 * 中央画布（含工具轨/比例尺/面包屑/缩放条/图例入口/提示）+ 右栏属性/贴章面板 + 状态条。
 *
 * 状态分层（AGENTS.md 6.2.1）：useMapData（CRUD/自动保存/撤销栈/贴章/广播）+
 * useMapViewState（视口/工具/选中/面板/下钻/图例页）。
 */
export default function MapPage() {
  const mapData = useMapData();
  const view = useMapViewState();
  const [activeStampSymbol, setActiveStampSymbol] = useState<string | null>(null);
  const [magnetOn, setMagnetOn] = useState(true);
  const [cell, setCell] = useState<{ c: number; r: number } | null>(null);
  const [bindName] = useState<string | null>(null);
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const [regionSize, setRegionSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = canvasRegionRef.current;
    if (!el) return;
    const update = () => setRegionSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 从 content 重建可渲染 world ──
  const world = useMemo(() => {
    const t = mapData.content.terrain;
    if (!t.cells.length) return null;
    return worldFromContent({
      cols: t.cols,
      rows: t.rows,
      cells: t.cells,
      features: t.features,
      seed: mapData.currentId ?? "",
    });
  }, [mapData.content.terrain, mapData.currentId]);

  const selectedAnno = useMemo(
    () => mapData.content.annotations.find((a) => a.id === view.selectedAnno) ?? null,
    [mapData.content.annotations, view.selectedAnno],
  );
  const selectedStamp = useMemo(
    () => (mapData.content.stamps ?? []).find((s) => s.id === view.selectedStamp) ?? null,
    [mapData.content.stamps, view.selectedStamp],
  );

  // ── 键盘快捷键 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) mapData.redo();
        else mapData.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        mapData.redo();
        return;
      }
      const map: Record<string, MapTool> = { v: "select", h: "pan", b: "brush", s: "stamp", p: "pin", r: "area", t: "label", l: "line" };
      if (map[e.key.toLowerCase()]) view.setTool(map[e.key.toLowerCase()]);
      if (e.key === "Escape") view.popDrill(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapData, view]);

  // ── 画笔提交：松手后批量写入 terrain.cells ──
  const handlePaintCommit = useCallback(
    (buffer: Map<number, number>) => {
      if (buffer.size === 0) return;
      mapData.updateContent((prev) => {
        const cells = [...prev.terrain.cells];
        for (const [idx, terrain] of buffer) {
          if (idx >= 0 && idx < cells.length) cells[idx] = terrain;
        }
        return { ...prev, terrain: { ...prev.terrain, cells } };
      });
    },
    [mapData],
  );

  const handleRestoreGrass = useCallback(() => {
    mapData.updateContent((prev) => {
      const cells = prev.terrain.cells.map(() => 4);
      return { ...prev, terrain: { ...prev.terrain, cells } };
    });
  }, [mapData]);

  const handleAddAnnotation = useCallback(
    (a: MapAnnotation) => mapData.upsertAnnotation(a),
    [mapData],
  );
  const handleUpdateAnnoLive = useCallback(
    (id: string, patch: Partial<MapAnnotation>) =>
      mapData.updateContent((prev) => ({
        ...prev,
        annotations: prev.annotations.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }), false),
    [mapData],
  );
  const handleUpdateAnno = useCallback(
    (patch: Partial<MapAnnotation>) => {
      if (!view.selectedAnno) return;
      mapData.updateContent((prev) => ({
        ...prev,
        annotations: prev.annotations.map((x) => (x.id === view.selectedAnno ? { ...x, ...patch } : x)),
      }));
    },
    [mapData, view.selectedAnno],
  );
  const handleDeleteAnno = useCallback(() => {
    if (view.selectedAnno) {
      mapData.deleteAnnotation(view.selectedAnno);
      view.setSelectedAnno(null);
    }
  }, [mapData, view]);

  const handleAddStamp = useCallback(
    (s: Omit<MapStamp, "id" | "z">) => {
      const id = mapData.addStamp(s);
      view.setSelectedStamp(id);
      view.setSelectedAnno(null);
    },
    [mapData, view],
  );
  const handleUpdateStampLive = useCallback(
    (id: string, patch: Partial<MapStamp>) =>
      mapData.updateContent((prev) => ({
        ...prev,
        stamps: (prev.stamps ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }), false),
    [mapData],
  );
  const handleUpdateStamp = useCallback(
    (patch: Partial<MapStamp>) => {
      if (!view.selectedStamp) return;
      mapData.updateContent((prev) => ({
        ...prev,
        stamps: (prev.stamps ?? []).map((x) => (x.id === view.selectedStamp ? { ...x, ...patch } : x)),
      }));
    },
    [mapData, view.selectedStamp],
  );
  const handleDeleteStamp = useCallback(() => {
    if (view.selectedStamp) {
      mapData.removeStamp(view.selectedStamp);
      view.setSelectedStamp(null);
    }
  }, [mapData, view]);
  const handleReorderStamp = useCallback(
    (id: string, dir: "up" | "down" | "top" | "bottom") => mapData.reorderStamp(id, dir),
    [mapData],
  );
  const handleGroupStamp = useCallback(() => {
    if (view.selectedStamp) mapData.groupStamps([view.selectedStamp], `g_${Date.now().toString(36)}`);
  }, [mapData, view.selectedStamp]);
  const handleUngroupStamp = useCallback(() => {
    if (selectedStamp?.groupId) mapData.ungroupStamps(selectedStamp.groupId);
  }, [mapData, selectedStamp]);

  // ── 新建地图（随机成图）──
  const handleAdopt = useCallback(
    async (w: BuiltWorld, templates: TerrainTemplates, resKey: string) => {
      const id = await mapData.createMap(
        `云荒大陆_${mapData.randomSeed().slice(0, 4)}`,
        w.seed,
        templates,
        resKey,
      );
      void id;
      view.setGenerateOpen(false);
    },
    [mapData, view],
  );

  // ── 导出 ──
  const viewBox = useMemo(() => {
    const cw = regionSize.w || world?.width || 800;
    const ch = regionSize.h || world?.height || 500;
    const s = view.viewport.scale;
    return {
      x: -view.viewport.tx / s,
      y: -view.viewport.ty / s,
      w: cw / s,
      h: ch / s,
    };
  }, [view.viewport, world, regionSize]);

  /**
   * 状态条里的尺寸标注：**视野**随缩放实时变化（「全图」是图本身的属性、不随缩放变），
   * 与左下角比例尺一起回应「缩放时尺寸标注没变化」。
   */
  const extent = useMemo(
    () =>
      world
        ? viewExtentLi(view.viewport.scale, world.cell, regionSize.w, regionSize.h)
        : { w: 0, h: 0 },
    [world, view.viewport.scale, regionSize],
  );
  const scaleHint = world
    ? `${world.cols}×${world.rows} 格 · 1 格 = ${LI_PER_CELL} 里 · 全图 ${fmtLi(world.cols * LI_PER_CELL)}×${fmtLi(world.rows * LI_PER_CELL)} 里 · 视野 ${fmtLi(extent.w)}×${fmtLi(extent.h)} 里`
    : "—";

  const handleExport = useCallback(
    async (dataUrl: string) => {
      const res = await exportPng(dataUrl, mapData.content ? `map_${mapData.currentId ?? "export"}` : "map");
      if (res.ok) {
        // 导出成功（主进程已写盘）
      } else if (!res.cancelled) {
        // 导出失败
      }
    },
    [mapData],
  );

  const isEmpty = !mapData.currentId;

  return (
    <div className="mp-page">
      <MapTopBar
        maps={mapData.maps}
        currentId={mapData.currentId}
        currentName={mapData.currentId ? (mapData.maps.find((m) => m.id === mapData.currentId)?.name ?? "未命名地图") : ""}
        bindName={bindName}
        saveState={mapData.saveState}
        canUndo={mapData.canUndo}
        canRedo={mapData.canRedo}
        collapsed={view.sidebarCollapsed}
        onSelect={mapData.selectMap}
        onNew={() => view.setGenerateOpen(true)}
        onRename={(n) => void mapData.renameCurrent(n)}
        onDelete={() => mapData.currentId && void mapData.removeMap(mapData.currentId)}
        onExport={() => view.setExportOpen(true)}
        onUndo={mapData.undo}
        onRedo={mapData.redo}
        onToggleSidebar={() => view.setSidebarCollapsed((v) => !v)}
      />

      {isEmpty ? (
        <div className="mp-empty">
          <EnvironmentOutlined className="mp-empty__icon" />
          <h3>还没有地图</h3>
          <p>新建一张架空世界地图，1 分钟内拿到可用的底图</p>
          <button type="button" className="mp-empty__btn" onClick={() => view.setGenerateOpen(true)}>
            <MapIcon name="plus" size={16} /> 新建地图
          </button>
        </div>
      ) : (
        <div className="mp-body">
          {!view.sidebarCollapsed && (
            <MapSidebar
              content={mapData.content}
              tool={view.tool}
              sideTab={view.sideTab}
              setSideTab={view.setSideTab}
              paintTerrain={view.paintTerrain}
              setPaintTerrain={view.setPaintTerrain}
              paintSize={view.paintSize}
              setPaintSize={view.setPaintSize}
              brushShape={view.brushShape}
              setBrushShape={view.setBrushShape}
              selectedAnno={view.selectedAnno}
              onSelectAnno={(id) => view.select(id, null)}
              activeStampSymbol={activeStampSymbol}
              setActiveStampSymbol={setActiveStampSymbol}
              onAddAnnotation={(type) => {
                // 在画布中心放置一个新标注
                const cx = world ? world.width / 2 : 400;
                const cy = world ? world.height / 2 : 250;
                const id = `anno_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                handleAddAnnotation({ id, type, x: cx, y: cy, name: type === "pin" ? "新地点" : type === "area" ? "新区域" : type === "label" ? "新标签" : "连线", note: "", kind: type === "pin" ? "city" : undefined });
                view.setSelectedAnno(id);
              }}
              onAddStamp={(key) => {
                const cx = world ? world.width / 2 : 400;
                const cy = world ? world.height / 2 : 250;
                handleAddStamp({ symbolKey: key, x: cx, y: cy, scale: 1, rotation: 0, flip: false });
              }}
              onRestoreGrass={handleRestoreGrass}
              symbolStyle={mapData.content.symbolStyle ?? "A"}
              onSetTool={(t) => view.setTool(t as MapTool)}
              onReorderStamp={handleReorderStamp}
              onRemoveStamp={handleDeleteStamp}
              onGroupStamp={handleGroupStamp}
              magnetOn={magnetOn}
              setMagnetOn={setMagnetOn}
            />
          )}

          <div className="mp-canvas-region" ref={canvasRegionRef}>
            <MapCanvas
              world={world}
              content={mapData.content}
              viewport={view.viewport}
              tool={view.tool}
              paintTerrain={view.paintTerrain}
              paintSize={view.paintSize}
              brushShape={view.brushShape}
              selectedAnno={view.selectedAnno}
              selectedStamp={view.selectedStamp}
              activeStampSymbol={activeStampSymbol}
              drillPath={view.drillPath}
              onZoomBy={view.zoomBy}
              onZoomTo={view.zoomTo}
              onPanBy={view.panBy}
              onResetView={view.resetView}
              onFitView={view.fitView}
              onSelectTool={(t) => view.setTool(t as MapTool)}
              onPaintCommit={handlePaintCommit}
              onAddAnnotation={handleAddAnnotation}
              onUpdateAnnotation={handleUpdateAnnoLive}
              onSelectAnno={(id) => view.select(id, null)}
              onAddStamp={handleAddStamp}
              onUpdateStamp={handleUpdateStampLive}
              onSelectStamp={(id) => view.select(null, id)}
              onOpenLegend={() => view.setLegendOpen(true)}
              onPopDrill={view.popDrill}
              onCellHover={setCell}
            />
          </div>

          <div className="mp-props">
            {selectedStamp ? (
              <StampPanel
                stamp={selectedStamp}
                onUpdate={handleUpdateStamp}
                onDelete={handleDeleteStamp}
                onReorder={(dir) => handleReorderStamp(selectedStamp!.id, dir)}
                onGroup={handleGroupStamp}
                onUngroup={handleUngroupStamp}
              />
            ) : selectedAnno ? (
              <AnnotationProps
                annotation={selectedAnno}
                maps={mapData.maps.map((m) => ({ id: m.id, name: m.name }))}
                onUpdate={handleUpdateAnno}
                onDelete={handleDeleteAnno}
                onLocate={() => view.fitView(canvasRegionRef.current?.clientWidth ?? 0, canvasRegionRef.current?.clientHeight ?? 0, world?.width ?? 1, world?.height ?? 1)}
                onBindEntity={() => mapData.updateContent((prev) => ({ ...prev, annotations: prev.annotations.map((x) => (x.id === selectedAnno.id ? { ...x, entityId: `loc_${Date.now().toString(36)}` } : x)) }))}
                onBindSubMap={(mid) => handleUpdateAnno({ childMapId: mid })}
              />
            ) : (
              <div className="mp-props__empty">
                <MapIcon name="pin" size={20} />
                <span>选中标注或贴章查看属性</span>
              </div>
            )}
          </div>
        </div>
      )}

      <MapStatusBar
        cell={cell}
        zoomPct={Math.round(view.viewport.scale * 100)}
        annoCount={mapData.content.annotations.length}
        stampCount={(mapData.content.stamps ?? []).length}
        scaleHint={scaleHint}
        saveState={mapData.saveState}
        updatedAt={mapData.updatedAt}
      />

      <GenerateDialog
        open={view.generateOpen}
        onClose={() => view.setGenerateOpen(false)}
        onAdopt={handleAdopt}
        initialSeed={mapData.randomSeed()}
      />
      <ExportDialog
        open={view.exportOpen}
        onClose={() => view.setExportOpen(false)}
        world={world}
        content={mapData.content}
        viewBox={viewBox}
        mapName={mapData.currentId ?? "map"}
        onExport={handleExport}
      />
      <LegendView open={view.legendOpen} onClose={() => view.setLegendOpen(false)} />
    </div>
  );
}
