/**
 * 地图画布组件（PRD novel-map §6 + RM2 画布基础 + RM9/RM13 交互）
 *
 * 渲染：单一 <canvas>，地形（map-render）在世界坐标系绘制 + 叠加标注/贴章/选中高亮，
 * 视口变换由外层 ctx 施加。DOM 仅含画布 + 浮层控件（≤ 200，满足渲染约束）。
 *
 * 交互：滚轮缩放（锚定光标）/ 空格或抓手平移 / 画笔涂刷（局部缓冲松手提交）/
 * 贴章放置与拖拽 / 地点钉·区域框·标签·连线放置 / 选择高亮。
 *
 * 样式就近 index.scss，仅用 var(--app-*)。
 */
import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as RPE, WheelEvent as RWE, KeyboardEvent as RKE } from "react";
import type { BuiltWorld } from "../../map-terrain";
import { drawTerrain } from "../../map-render";
import { drawTiles } from "../../map-tiles";
import { drawSymbol, findSymbol } from "../../map-symbols";
import type { MapContent, MapAnnotation, MapStamp } from "@/shared/types/electron.d.ts";
import MapIcon from "../MapIcon";
import "./index.scss";

export interface DrillEntry {
  mapId: string;
  name: string;
}

export interface MapCanvasProps {
  world: BuiltWorld | null;
  content: MapContent;
  viewport: { tx: number; ty: number; scale: number };
  tool: string;
  paintTerrain: number;
  paintSize: number;
  brushShape: "circle" | "rect";
  selectedAnno: string | null;
  selectedStamp: string | null;
  activeStampSymbol: string | null;
  drillPath: DrillEntry[];
  // 视口操作
  onZoomBy: (factor: number, ox: number, oy: number) => void;
  onZoomTo: (scale: number) => void;
  onPanBy: (dx: number, dy: number) => void;
  onResetView: () => void;
  onFitView: (cw: number, ch: number, ww: number, wh: number) => void;
  onSelectTool: (tool: string) => void;
  // 数据操作
  onPaintCommit: (buffer: Map<number, number>) => void;
  onAddAnnotation: (a: MapAnnotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<MapAnnotation>) => void;
  onSelectAnno: (id: string | null) => void;
  onAddStamp: (s: Omit<MapStamp, "id" | "z">) => void;
  onUpdateStamp: (id: string, patch: Partial<MapStamp>) => void;
  onSelectStamp: (id: string | null) => void;
  onOpenLegend: () => void;
  onPopDrill: (levels: number) => void;
  onCellHover?: (cell: { c: number; r: number } | null) => void;
}

const TOOLS: Array<{ key: string; icon: string; title: string }> = [
  { key: "select", icon: "select", title: "选择 V" },
  { key: "pan", icon: "hand", title: "抓手 H / 空格拖拽" },
  { key: "brush", icon: "brush", title: "地形画笔 B" },
  { key: "stamp", icon: "stamp", title: "贴章 S" },
  { key: "pin", icon: "pin", title: "地点钉 P" },
  { key: "area", icon: "frame", title: "区域框 R" },
  { key: "label", icon: "tag", title: "自由标签 T" },
  { key: "line", icon: "link", title: "连线 L" },
];

function kindColor(kind: string): string {
  const m: Record<string, string> = {
    city: "#c0654f",
    town: "#4f9a6a",
    village: "#5fae7c",
    pass: "#cf9b4a",
    port: "#3f86b8",
    mountain: "#9a7bb0",
    river: "#3f86b8",
    forest: "#4f8a48",
  };
  return m[kind] ?? "#c0654f";
}

export default function MapCanvas(props: MapCanvasProps) {
  const {
    world,
    content,
    viewport,
    tool,
    paintTerrain,
    paintSize,
    brushShape,
    selectedAnno,
    selectedStamp,
    activeStampSymbol,
    drillPath,
    onZoomBy,
    onPanBy,
    onPaintCommit,
    onAddAnnotation,
    onUpdateAnnotation,
    onSelectAnno,
    onAddStamp,
    onUpdateStamp,
    onSelectStamp,
    onOpenLegend,
    onPopDrill,
    onCellHover,
  } = props;

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintBuffer = useRef<Map<number, number>>(new Map());
  const drag = useRef<{
    mode: "none" | "pan" | "paint" | "moveAnno" | "moveStamp" | "area" | "line";
    lastX: number;
    lastY: number;
    startWX: number;
    startWY: number;
    lastWX: number;
    lastWY: number;
    moveId?: string;
    lineFrom?: { x: number; y: number };
    space?: boolean;
  }>({ mode: "none", lastX: 0, lastY: 0, startWX: 0, startWY: 0, lastWX: 0, lastWY: 0 });

  const worldSize = world ? { w: world.width, h: world.height } : { w: 1, h: 1 };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = host.clientWidth;
    const ch = host.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#eef1f8";
    ctx.fillRect(0, 0, cw, ch);
    if (!world) return;
    ctx.translate(viewport.tx, viewport.ty);
    ctx.scale(viewport.scale, viewport.scale);
    if (content.tileMode) drawTiles(ctx, world, content.symbolStyle ?? "A");
    else drawTerrain(ctx, world, { style: content.symbolStyle ?? "A" });
    for (const a of content.annotations) drawAnnotation(ctx, a, a.id === selectedAnno);
    const stamps = [...(content.stamps ?? [])].sort((p, q) => p.z - q.z);
    for (const s of stamps) drawStampOnCanvas(ctx, s, s.id === selectedStamp, content.symbolStyle ?? "A");
  }, [world, content, viewport, selectedAnno, selectedStamp]);

  useEffect(() => {
    draw();
  }, [draw]);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      sx,
      sy,
      x: (sx - viewport.tx) / viewport.scale,
      y: (sy - viewport.ty) / viewport.scale,
    };
  };

  const onWheel = (e: RWE) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    onZoomBy(factor, ox, oy);
  };

  const hitAnnotation = (x: number, y: number): MapAnnotation | null => {
    let best: MapAnnotation | null = null;
    let bestD = 18;
    for (const a of content.annotations) {
      const d = Math.hypot(a.x - x, a.y - 9 - y);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  };

  const hitStamp = (x: number, y: number): MapStamp | null => {
    const stamps = [...(content.stamps ?? [])].sort((p, q) => q.z - p.z);
    for (const s of stamps) {
      if (Math.hypot(s.x - x, s.y - y) < 16) return s;
    }
    return null;
  };

  const paintCellAt = (x: number, y: number) => {
    if (!world) return;
    const cc = Math.floor(x / world.cell);
    const cr = Math.floor(y / world.cell);
    const rad = paintSize;
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (brushShape === "circle" && dc * dc + dr * dr > rad * rad) continue;
        const c = cc + dc;
        const r = cr + dr;
        if (c < 0 || r < 0 || c >= world.cols || r >= world.rows) continue;
        paintBuffer.current.set(r * world.cols + c, paintTerrain);
      }
    }
  };

  const onPointerDown = (e: RPE) => {
    if (!world) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { x, y, sx, sy } = toWorld(e.clientX, e.clientY);
    if (tool === "pan" || drag.current.space || e.button === 1) {
      drag.current = { ...drag.current, mode: "pan", lastX: sx, lastY: sy };
      return;
    }
    if (tool === "brush") {
      drag.current = { ...drag.current, mode: "paint", lastX: sx, lastY: sy };
      paintCellAt(x, y);
      draw();
      return;
    }
    if (tool === "stamp" && activeStampSymbol) {
      onAddStamp({ symbolKey: activeStampSymbol, x, y, scale: 1, rotation: 0, flip: false });
      onSelectStamp(null);
      return;
    }
    if (tool === "pin" || tool === "label") {
      const id = newId();
      onAddAnnotation({
        id,
        type: tool === "pin" ? "pin" : "label",
        x,
        y,
        name: tool === "pin" ? "新地点" : "新标签",
        note: "",
        kind: tool === "pin" ? "city" : undefined,
      });
      onSelectAnno(id);
      return;
    }
    if (tool === "area") {
      drag.current = { ...drag.current, mode: "area", startWX: x, startWY: y, lastWX: x, lastWY: y };
      return;
    }
    if (tool === "line") {
      if (!drag.current.lineFrom) {
        drag.current.lineFrom = { x, y };
        return;
      }
      const from = drag.current.lineFrom;
      onAddAnnotation({
        id: newId(),
        type: "line",
        x: from.x,
        y: from.y,
        w: x - from.x,
        h: y - from.y,
        name: "连线",
        note: "",
      });
      drag.current.lineFrom = undefined;
      return;
    }
    // select
    const st = hitStamp(x, y);
    if (st) {
      onSelectStamp(st.id);
      onSelectAnno(null);
      drag.current = { ...drag.current, mode: "moveStamp", moveId: st.id, lastWX: x, lastWY: y };
      return;
    }
    const an = hitAnnotation(x, y);
    if (an) {
      onSelectAnno(an.id);
      onSelectStamp(null);
      drag.current = { ...drag.current, mode: "moveAnno", moveId: an.id, lastWX: x, lastWY: y };
      return;
    }
    onSelectAnno(null);
    onSelectStamp(null);
  };

  const onPointerMove = (e: RPE) => {
    const { x, y, sx, sy } = toWorld(e.clientX, e.clientY);
    if (world) {
      const c = Math.floor(x / world.cell);
      const r = Math.floor(y / world.cell);
      onCellHover?.(c >= 0 && r >= 0 && c < world.cols && r < world.rows ? { c, r } : null);
    }
    const d = drag.current;
    if (d.mode === "pan") {
      onPanBy(sx - d.lastX, sy - d.lastY);
      d.lastX = sx;
      d.lastY = sy;
    } else if (d.mode === "paint") {
      paintCellAt(x, y);
      draw();
    } else if (d.mode === "moveAnno" && d.moveId) {
      onUpdateAnnotation(d.moveId, { x, y });
    } else if (d.mode === "moveStamp" && d.moveId) {
      onUpdateStamp(d.moveId, { x, y });
    } else if (d.mode === "area") {
      d.lastWX = x;
      d.lastWY = y;
      draw();
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (d.mode === "paint") {
      if (paintBuffer.current.size) {
        onPaintCommit(new Map(paintBuffer.current));
        paintBuffer.current.clear();
      }
    } else if (d.mode === "area") {
      const w = Math.abs(d.lastWX - d.startWX);
      const h = Math.abs(d.lastWY - d.startWY);
      if (w > 4 && h > 4) {
        const id = newId();
        onAddAnnotation({
          id,
          type: "area",
          x: Math.min(d.startWX, d.lastWX),
          y: Math.min(d.startWY, d.lastWY),
          w,
          h,
          name: "新区域",
          note: "",
        });
        onSelectAnno(id);
      }
    }
    drag.current = { ...drag.current, mode: "none" };
  };

  const onKeyDown = (e: RKE) => {
    if (e.code === "Space") drag.current.space = true;
  };
  const onKeyUp = (e: RKE) => {
    if (e.code === "Space") drag.current.space = false;
  };

  const pct = Math.round(viewport.scale * 100);

  return (
    <div
      className="cv"
      ref={hostRef}
      tabIndex={0}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <canvas ref={canvasRef} className="cv__canvas" />

      <div className="scale-bar">
        <svg width="150" height="30">
          <line x1="6" y1="20" x2="146" y2="20" stroke="var(--app-text-secondary)" strokeWidth="2" />
          <line x1="6" y1="15" x2="6" y2="25" stroke="var(--app-text-secondary)" strokeWidth="2" />
          <line x1="76" y1="16" x2="76" y2="24" stroke="var(--app-text-secondary)" strokeWidth="1.5" />
          <line x1="146" y1="15" x2="146" y2="25" stroke="var(--app-text-secondary)" strokeWidth="2" />
        </svg>
        <div className="scale-bar__meta">
          1 格 = 25 里 · 全图 {world ? world.cols * 25 : 0}×{world ? world.rows * 25 : 0} 里
        </div>
      </div>

      <div className="tool-rail">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tool-rail__btn${tool === t.key ? " is-on" : ""}`}
            title={t.title}
            onClick={() => props.onSelectTool(t.key)}
          >
            <MapIcon name={t.icon} size={17} />
          </button>
        ))}
      </div>

      {drillPath.length > 0 && (
        <div className="crumb">
          <button type="button" className="crumb__up" title="返回上级 Esc" onClick={() => onPopDrill(1)}>
            <MapIcon name="chevron-up" size={14} />
          </button>
          {drillPath.map((d, i) => (
            <span key={d.mapId}>
              {i > 0 && <span className="crumb__sep">›</span>}
              <button type="button" className={i === drillPath.length - 1 ? "is-current" : ""}>{d.name}</button>
            </span>
          ))}
        </div>
      )}

      <div className="zoom-bar">
        <button type="button" className="icon-btn" title="缩小" onClick={() => onZoomBy(1 / 1.2, worldSize.w / 2, worldSize.h / 2)}>
          <MapIcon name="minus" size={15} />
        </button>
        <span className="zoom-bar__val">{pct}%</span>
        <button type="button" className="icon-btn" title="放大" onClick={() => onZoomBy(1.2, worldSize.w / 2, worldSize.h / 2)}>
          <MapIcon name="plus" size={15} />
        </button>
        <div className="tool-rail__sep" style={{ margin: "0 2px", height: 18 }} />
        <button type="button" className="icon-btn" title="适应画布" onClick={() => props.onFitView(hostRef.current?.clientWidth ?? 0, hostRef.current?.clientHeight ?? 0, worldSize.w, worldSize.h)}>
          <MapIcon name="target" size={15} />
        </button>
      </div>

      <button type="button" className="map-legend-chip" onClick={onOpenLegend}>
        <MapIcon name="map" size={14} /> 地形图例
      </button>

      <div className="map-hint">滚轮缩放 · 空格拖拽平移 · Ctrl+Z 撤销</div>
    </div>
  );
}

function newId(): string {
  return `anno_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function drawAnnotation(ctx: CanvasRenderingContext2D, a: MapAnnotation, selected: boolean): void {
  if (a.type === "pin") {
    const color = a.kind ? kindColor(a.kind) : "#c0654f";
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = selected ? "#fff" : "rgba(255,255,255,0.9)";
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.beginPath();
    ctx.arc(a.x, a.y - 9, 6, 0, 6.3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a.x - 3, a.y - 4);
    ctx.lineTo(a.x + 3, a.y - 4);
    ctx.lineTo(a.x, a.y + 3);
    ctx.closePath();
    ctx.fill();
    ctx.font = "600 13px sans-serif";
    ctx.fillStyle = selected ? "#1d2242" : "#2a2a33";
    ctx.fillText(a.name || "未命名", a.x + 9, a.y - 6);
    if (selected) {
      ctx.strokeStyle = "#5b6cf9";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(a.x - 12, a.y - 18, 24, 26);
      ctx.setLineDash([]);
    }
    ctx.restore();
  } else if (a.type === "area") {
    const w = a.w ?? 80;
    const h = a.h ?? 60;
    ctx.save();
    ctx.strokeStyle = selected ? "#1d2242" : "rgba(60,120,160,0.9)";
    ctx.fillStyle = "rgba(80,150,190,0.12)";
    ctx.lineWidth = selected ? 2.4 : 1.6;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.rect(a.x, a.y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "600 13px sans-serif";
    ctx.fillStyle = "#2a2a33";
    ctx.fillText(a.name || "区域", a.x + 6, a.y + 18);
    ctx.restore();
  } else if (a.type === "label") {
    ctx.save();
    ctx.font = "italic 600 14px sans-serif";
    ctx.fillStyle = "#3a3a44";
    ctx.fillText(a.name || "标签", a.x, a.y);
    ctx.restore();
  } else if (a.type === "line") {
    const w = a.w ?? 0;
    const h = a.h ?? 0;
    ctx.save();
    ctx.strokeStyle = selected ? "#1d2242" : "rgba(120,120,140,0.85)";
    ctx.lineWidth = selected ? 2.4 : 1.6;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + w, a.y + h);
    ctx.stroke();
    ctx.restore();
  }
}

function drawStampOnCanvas(ctx: CanvasRenderingContext2D, s: MapStamp, selected: boolean, style: "A" | "B" | "C"): void {
  const def = findSymbol(s.symbolKey);
  if (!def) return;
  drawSymbol(ctx, def, s.x, s.y, 22 * (s.scale ?? 1), {
    rotation: s.rotation ?? 0,
    flip: s.flip ?? false,
    style,
    color: def.color,
  });
  if (selected) {
    ctx.save();
    ctx.strokeStyle = "#5b6cf9";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(s.x - 16, s.y - 16, 32, 32);
    ctx.setLineDash([]);
    ctx.restore();
  }
}
