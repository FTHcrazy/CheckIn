/**
 * Voronoi 地块渲染（docs/novel-map-prd.md §4 地块模型切换：栅格 / Voronoi 地块）
 *
 * 实现：以「抖动格点 + 最近归属」近似地块观感 —— 每个栅格用确定性 jitter 的
 * 圆角多边形描边，形成有机手绘地块边界，避免 O(n²) 真实 Voronoi 计算。
 * 底色与纹理复用 map-render 的地形配色，仅叠加地块边界。
 *
 * 纯函数，不 import React。
 */

import type { BuiltWorld } from "./map-terrain";
import { TERRAIN_COLORS, TERRAIN_TEXTURE } from "./map-symbols";
import { drawCellTexture } from "./map-render";

/** 绘制 Voronoi 地块风格（在已绘制底色/纹理之上叠加地块边界） */
export function drawTiles(
  ctx: CanvasRenderingContext2D,
  world: BuiltWorld,
  style: "A" | "B" | "C" = "A",
): void {
  const { cols, rows, cells, cell } = world;
  // 底色 + 纹理（地块模式同样需要底质）
  // 注意：调用方若已 drawTerrain 则不要重复；此处独立提供完整绘制
  const rng = (() => {
    let a = (world.snum ^ 0x1234567) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  void rng;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = cells[r * cols + c];
      ctx.fillStyle = TERRAIN_COLORS[t] ?? "#cccccc";
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
  // 纹理（低密度，避免地块模式过花）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = cells[r * cols + c];
      drawCellTexture(ctx, TERRAIN_TEXTURE[t], c * cell, r * cell, cell, rng2(world.snum, c, r), style);
    }
  }

  // 地块边界（每格画圆角矩形虚描，形成有机分隔）
  ctx.save();
  ctx.strokeStyle = "rgba(40,40,55,0.18)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cell;
      const y = r * cell;
      const rad = 3 + rng2(world.snum + 9, c, r) * 3;
      roundRect(ctx, x + 1.5, y + 1.5, cell - 3, cell - 3, rad);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function rng2(seed: number, x: number, y: number): number {
  let h =
    Math.imul(x | 0, 374761393) +
    Math.imul(y | 0, 668265263) +
    Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
