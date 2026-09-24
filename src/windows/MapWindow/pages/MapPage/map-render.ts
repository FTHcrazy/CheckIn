/**
 * 地图渲染器（docs/novel-map-prd.md §6 + §5.1 渲染约束）
 *
 * 设计要点：
 * - 地形栅格用 Canvas 绘制（0 DOM，满足「禁止逐格实例化 DOM / DOM ≤ 200」约束）：
 *   底色一次 fillRect + 程序化纹理（seed 派生散布，同 seed 同图案）
 * - 等值线（高程分带描边）、河流 ribbon、叠加型符号层（悬崖/岛屿/瀑布）均在此
 * - 所有绘制在世界像素坐标系进行；视口变换由组件在外层 ctx 上施加
 * - 纯函数（接收 ctx + world），不 import React，可独立单测
 *
 * 渲染约束 ③：缩放时符号随格子等比缩放、密度恒定 —— 纹理以 cell 为单位绘制即天然满足
 */

import type { BuiltWorld } from "./map-terrain";
import {
  TERRAIN_COLORS,
  TERRAIN_TEXTURE,
  drawCliff,
  drawIsland,
  drawWaterfall,
} from "./map-symbols";

type TexStyle = "A" | "B" | "C";

/** 轻量确定性 PRNG（mulberry32），seed 派生纹理散布 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RenderOptions {
  /** 符号风格 A/B/C（影响装饰/标注形状） */
  style?: TexStyle;
  /** 是否绘制等值线（高程分带） */
  contours?: boolean;
  /** 是否绘制河流 ribbon */
  rivers?: boolean;
  /** 是否绘制叠加型符号（悬崖/岛屿/瀑布） */
  features?: boolean;
  /** 设备像素比（导出时 >1 提升清晰度） */
  dpr?: number;
}

/** 绘制整张地形（底色 + 纹理） */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  world: BuiltWorld,
  opts: RenderOptions = {},
): void {
  const { cols, rows, cells, cell } = world;
  const style = opts.style ?? "A";
  const rng = mulberry32(world.snum ^ 0x9e3779b9);

  // ① 底色
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = cells[r * cols + c];
      ctx.fillStyle = TERRAIN_COLORS[t] ?? "#cccccc";
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }

  // ② 纹理（逐格轻量散布，恒定密度）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = cells[r * cols + c];
      drawCellTexture(ctx, TERRAIN_TEXTURE[t], c * cell, r * cell, cell, rng(), style);
    }
  }

  // ③ 等值线（高程分带：在 cell 边界做简化描边）
  if (opts.contours !== false) drawContours(ctx, world);

  // ④ 河流
  if (opts.rivers !== false) drawRiverRibbons(ctx, world);

  // ⑤ 叠加型符号
  if (opts.features !== false) drawOverlayFeatures(ctx, world, world.snum);
}

/**
 * 只画河流 ribbon（供 WebGL 地形层之上补画）。
 *
 * 为什么 GL 路径还需要它：GL 层的水体来自 cells（河常只有 1 格宽），
 * 而设计稿的水系观感靠 features 里的 ribbon 曲线水带表达（River*DTO）。
 * 两者互补：cells 给水面材质，ribbon 给明确走向。
 */
export function drawRiverRibbons(ctx: CanvasRenderingContext2D, world: BuiltWorld): void {
  for (const f of world.features) {
    if (f.type === "river" && f.pts) drawRiver(ctx, f.pts, world.cell);
  }
}

export function drawCellTexture(
  ctx: CanvasRenderingContext2D,
  tex: string,
  x: number,
  y: number,
  s: number,
  rnd: number,
  style: TexStyle,
): void {
  const cx = x + s / 2;
  const cy = y + s / 2;
  ctx.save();
  switch (tex) {
    case "wave": {
      // 大海：两行交错水平短弧浪纹
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1;
      for (let row = 0; row < 2; row++) {
        const yy = y + s * (0.35 + row * 0.32);
        ctx.beginPath();
        ctx.moveTo(x + 2, yy);
        ctx.quadraticCurveTo(cx, yy - 2.4, x + s - 2, yy);
        ctx.stroke();
      }
      break;
    }
    case "ripple": {
      // 湖泊：细密点状涟漪
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(x + 3 + rnd * (s - 6), y + 4 + ((rnd * 7) % (s - 6)), 0.9, 0, 6.3);
        ctx.fill();
      }
      break;
    }
    case "dune": {
      // 沙漠：同向新月形沙丘弧
      ctx.strokeStyle = "rgba(150,120,70,0.35)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x + 2, cy);
      ctx.quadraticCurveTo(cx, y + 3, x + s - 2, cy);
      ctx.stroke();
      break;
    }
    case "grass": {
      // 草原：稀疏草叶短线（密度最低）
      if (rnd > 0.55) {
        ctx.strokeStyle = "rgba(60,120,50,0.4)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(cx, y + s - 3);
        ctx.lineTo(cx + 1.5, y + 4);
        ctx.stroke();
      }
      break;
    }
    case "tree": {
      // 森林：成簇树冠（簇间留空地）
      if (rnd > 0.42) {
        const rr = 2.4 + rnd * 1.6;
        ctx.fillStyle = style === "B" ? "rgba(30,90,40,0.85)" : "rgba(45,110,55,0.8)";
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, 6.3);
        ctx.fill();
        ctx.strokeStyle = "rgba(40,70,35,0.6)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(cx, cy + rr);
        ctx.lineTo(cx, y + s - 2);
        ctx.stroke();
      }
      break;
    }
    case "ridge": {
      // 山地：折线山形符号连绵成脊
      if (rnd > 0.3) {
        ctx.strokeStyle = "rgba(70,60,50,0.7)";
        ctx.lineWidth = 1.1;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(x + 2, y + s - 3);
        ctx.lineTo(cx - 2, cy);
        ctx.lineTo(cx + 2, cy + 2);
        ctx.lineTo(x + s - 2, y + s - 3);
        ctx.stroke();
      }
      break;
    }
    case "snowcap": {
      // 雪山：山形 + 峰顶覆白
      if (rnd > 0.3) {
        ctx.strokeStyle = "rgba(80,80,95,0.75)";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(x + 2, y + s - 3);
        ctx.lineTo(cx, cy - 2);
        ctx.lineTo(x + s - 2, y + s - 3);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.moveTo(cx, cy - 3);
        ctx.lineTo(cx - 2.5, cy + 1);
        ctx.lineTo(cx + 2.5, cy + 1);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "lava": {
      // 熔岩（静态回退版）：岩壳底 + 交错橙黄岩浆沟 + 零星高光
      ctx.strokeStyle = "rgba(232,132,26,0.75)";
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + 2, y + s * 0.3);
      ctx.quadraticCurveTo(cx, cy + (rnd - 0.5) * s * 0.5, x + s - 2, y + s * 0.62);
      ctx.stroke();
      if (rnd > 0.45) {
        ctx.fillStyle = "rgba(255,196,84,0.85)";
        ctx.beginPath();
        ctx.arc(cx + (rnd - 0.5) * s * 0.4, cy, 1.3, 0, 6.3);
        ctx.fill();
      }
      break;
    }
    case "crystal": {
      // 雪原：极稀疏淡蓝冰晶点
      if (rnd > 0.82) {
        ctx.fillStyle = "rgba(150,180,220,0.5)";
        ctx.beginPath();
        ctx.arc(cx, cy, 1, 0, 6.3);
        ctx.fill();
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** 高程分带等值线（在地形上叠加淡描边，强化起伏） */
function drawContours(ctx: CanvasRenderingContext2D, world: BuiltWorld): void {
  const { cols, rows, cells, elev, cell } = world;
  ctx.save();
  ctx.strokeStyle = "rgba(40,40,55,0.10)";
  ctx.lineWidth = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = cells[r * cols + c];
      // 仅在陆地且相邻高程差较大处描边
      if (t === 0 || t === 1 || t === 2) continue;
      const e = elev[r * cols + c];
      const band = Math.floor(e * 8);
      const i2 = r * cols + c;
      if (c + 1 < cols && Math.floor(elev[i2 + 1] * 8) !== band) {
        ctx.beginPath();
        ctx.moveTo((c + 1) * cell, r * cell);
        ctx.lineTo((c + 1) * cell, (r + 1) * cell);
        ctx.stroke();
      }
      if (r + 1 < rows && Math.floor(elev[i2 + cols] * 8) !== band) {
        ctx.beginPath();
        ctx.moveTo(c * cell, (r + 1) * cell);
        ctx.lineTo((c + 1) * cell, (r + 1) * cell);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** 河流 ribbon（平滑曲线水带 + 两岸浅色岸线） */
function drawRiver(ctx: CanvasRenderingContext2D, pts: number[], cell: number): void {
  if (pts.length < 4) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // 岸线
  ctx.strokeStyle = "rgba(220,235,245,0.55)";
  ctx.lineWidth = cell * 0.55;
  strokePts(ctx, pts);
  // 水体
  ctx.strokeStyle = TERRAIN_COLORS[2];
  ctx.lineWidth = cell * 0.34;
  strokePts(ctx, pts);
  ctx.restore();
}

function strokePts(ctx: CanvasRenderingContext2D, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const mx = (pts[i] + pts[i - 2]) / 2;
    const my = (pts[i + 1] + pts[i - 1]) / 2;
    ctx.quadraticCurveTo(pts[i - 2], pts[i - 1], mx, my);
  }
  ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
  ctx.stroke();
}

/** 叠加型符号层（从 drawTerrain 拆出：GL 模式下由 Canvas2D 层单独绘制） */
export function drawOverlayFeatures(
  ctx: CanvasRenderingContext2D,
  world: BuiltWorld,
  seed: number,
): void {
  for (const f of world.features) {
    if (f.type === "cliff" && f.points) {
      drawCliff(ctx, f.points, seed);
    } else if (f.type === "island" && f.points && f.cells) {
      drawIsland(ctx, f.points[0].x, f.points[0].y, f.cells, world.cell);
    } else if (f.type === "waterfall" && f.points) {
      drawWaterfall(ctx, f.points[0].x, f.points[0].y);
    }
  }
}
