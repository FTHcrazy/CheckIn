/**
 * 导出组装（docs/novel-map-prd.md RM6 导出 PNG）
 *
 * 职责：
 * - buildExportCanvas：把地形 + 标注 + 贴章 +（可选）图例渲染到一张离屏 canvas
 *   - 范围：当前视图（按 viewport 裁剪）/ 整张地图
 *   - 倍率：1×/2×/4×（devicePixelRatio 叠加提升清晰度）
 *   - 开关：地形底图 / 地点标注 / 标注列表（图例）
 * - 渲染走与主画布同一套 map-render / map-symbols，保证所见即所得
 *
 * 落盘走主进程 saveDialog + 文件 IPC（见 services/map-service.exportPng）。
 * 纯函数（仅 buildExportCanvas 用到 DOM canvas，不 import React）。
 */

import type { BuiltWorld } from "./map-terrain";
import { drawTerrain } from "./map-render";
import { drawTiles } from "./map-tiles";
import {
  drawSymbol,
  findSymbol,
  TERRAIN_COLORS,
  TER_KEY,
  terrainLabel,
} from "./map-symbols";
import type { MapContent, MapAnnotation, MapStamp } from "@/shared/types/electron.d.ts";

export interface ExportOptions {
  range: "view" | "full";
  scale: number; // 1 | 2 | 4
  withTerrain: boolean;
  withAnnotations: boolean;
  withLegend: boolean;
  style?: "A" | "B" | "C";
  /** 当前视图裁剪框（世界坐标）；range=view 时必填 */
  viewBox?: { x: number; y: number; w: number; h: number };
}

const LEGEND_H = 96;

/** 构建导出 canvas（不含落盘） */
export function buildExportCanvas(
  world: BuiltWorld,
  content: MapContent,
  opts: ExportOptions,
): HTMLCanvasElement {
  const tileMode = (content as MapContent & { tileMode?: boolean }).tileMode;
  const style = opts.style ?? "A";

  let vx = 0;
  let vy = 0;
  let vw = world.width;
  let vh = world.height;
  if (opts.range === "view" && opts.viewBox) {
    vx = Math.max(0, opts.viewBox.x);
    vy = Math.max(0, opts.viewBox.y);
    vw = Math.min(world.width - vx, opts.viewBox.w);
    vh = Math.min(world.height - vy, opts.viewBox.h);
  }
  const outW = Math.max(1, Math.round(vw * opts.scale));
  const outH = Math.max(
    1,
    Math.round(vh * opts.scale) + (opts.withLegend ? LEGEND_H * opts.scale : 0),
  );

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.save();
  ctx.scale(opts.scale, opts.scale);
  ctx.translate(-vx, -vy);

  if (opts.withTerrain) {
    if (tileMode) drawTiles(ctx, world, style);
    else drawTerrain(ctx, world, { style });
  } else {
    ctx.fillStyle = "#f3f1ea";
    ctx.fillRect(vx, vy, vw, vh);
  }

  if (opts.withAnnotations) {
    drawAnnotations(ctx, content, style);
    drawStamps(ctx, content.stamps ?? [], style);
  }
  ctx.restore();

  if (opts.withLegend) drawLegendStrip(ctx, world, content, outW, vh * opts.scale, opts.scale);

  return canvas;
}

function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  content: MapContent,
  style: "A" | "B" | "C",
): void {
  for (const a of content.annotations) {
    if (a.type === "pin") drawPin(ctx, a, style);
    else if (a.type === "area") drawArea(ctx, a);
    else if (a.type === "label") drawLabel(ctx, a);
    else if (a.type === "line") drawLineAnno(ctx, content, a);
  }
}

function drawPin(ctx: CanvasRenderingContext2D, a: MapAnnotation, style: "A" | "B" | "C"): void {
  const color = a.kind ? kindColor(a.kind) : "#c0654f";
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.5;
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
  ctx.fillStyle = "#2a2a33";
  ctx.textAlign = a.x > 40 ? "left" : "left";
  ctx.fillText(a.name || "未命名", a.x + 9, a.y - 6);
  ctx.restore();
  void style;
}

function drawArea(ctx: CanvasRenderingContext2D, a: MapAnnotation): void {
  const w = a.w ?? 80;
  const h = a.h ?? 60;
  ctx.save();
  ctx.strokeStyle = "rgba(60,120,160,0.9)";
  ctx.fillStyle = "rgba(80,150,190,0.12)";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.roundRect?.(a.x, a.y, w, h, 6);
  if (!ctx.roundRect) ctx.rect(a.x, a.y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "600 13px sans-serif";
  ctx.fillStyle = "#2a2a33";
  ctx.fillText(a.name || "区域", a.x + 6, a.y + 18);
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, a: MapAnnotation): void {
  ctx.save();
  ctx.font = "italic 600 14px sans-serif";
  ctx.fillStyle = "#3a3a44";
  ctx.fillText(a.name || "标签", a.x, a.y);
  ctx.restore();
}

function drawLineAnno(
  ctx: CanvasRenderingContext2D,
  content: MapContent,
  a: MapAnnotation,
): void {
  const target = content.annotations.find((x) => x.id === (a as MapAnnotation & { to?: string }).to);
  ctx.save();
  ctx.strokeStyle = "rgba(120,120,140,0.8)";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  if (target) ctx.lineTo(target.x, target.y);
  ctx.stroke();
  ctx.restore();
}

function drawStamps(
  ctx: CanvasRenderingContext2D,
  stamps: MapStamp[],
  style: "A" | "B" | "C",
): void {
  const sorted = [...stamps].sort((p, q) => (p.z ?? 0) - (q.z ?? 0));
  for (const s of sorted) {
    const def = findSymbol(s.symbolKey);
    if (!def) continue;
    drawSymbol(ctx, def, s.x, s.y, 22 * (s.scale ?? 1), {
      rotation: s.rotation ?? 0,
      flip: s.flip ?? false,
      style,
      color: def.color,
    });
  }
}

/** 底部图例条：地形色卡 + 标注列表 */
function drawLegendStrip(
  ctx: CanvasRenderingContext2D,
  _world: BuiltWorld,
  content: MapContent,
  fullW: number,
  topY: number,
  scale: number,
): void {
  ctx.save();
  ctx.scale(scale, scale);
  const W = fullW / scale;
  const h = LEGEND_H;
  ctx.fillStyle = "rgba(248,246,240,0.96)";
  ctx.fillRect(0, topY / scale, W, h);
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath();
  ctx.moveTo(0, topY / scale);
  ctx.lineTo(W, topY / scale);
  ctx.stroke();

  ctx.font = "12px sans-serif";
  let x = 12;
  const y = topY / scale + 22;
  // 图例条目用固定步距 96px 平铺；12 类地形需要两行，行距 20px
  let row = 0;
  for (let i = 0; i < TER_KEY.length; i++) {
    if (x > W - 90) {
      x = 12;
      row++;
    }
    const ry = y + row * 20;
    ctx.fillStyle = TERRAIN_COLORS[i];
    ctx.fillRect(x, ry - 12, 14, 14);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeRect(x, ry - 12, 14, 14);
    ctx.fillStyle = "#333";
    ctx.fillText(terrainLabel(TER_KEY[i]), x + 18, ry - 1);
    x += 96;
  }
  ctx.fillStyle = "#555";
  ctx.font = "12px sans-serif";
  ctx.fillText(
    `标注 ${content.annotations.length} 个 · 贴章 ${(content.stamps ?? []).length} 个`,
    12,
    topY / scale + h - 14,
  );
  ctx.restore();
}

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
