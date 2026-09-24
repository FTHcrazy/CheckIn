/**
 * 地图渲染器（docs/novel-map-prd.md §6 + §5.1 渲染约束）
 *
 * 设计要点：
 * - 地形栅格用 Canvas 绘制（0 DOM，满足「禁止逐格实例化 DOM / DOM ≤ 200」约束）：
 *   底色一次 fillRect + 程序化纹理（seed 派生散布，同 seed 同图案）
 * - 等值线（高程分带描边）、河流 ribbon、叠加型符号层（岛屿/瀑布）均在此
 * - 所有绘制在世界像素坐标系进行；视口变换由组件在外层 ctx 上施加
 * - 纯函数（接收 ctx + world），不 import React，可独立单测
 *
 * 渲染约束 ③：缩放时符号随格子等比缩放、密度恒定 —— 纹理以 cell 为单位绘制即天然满足
 */

import type { BuiltWorld } from "./map-terrain";
import {
  TERRAIN_COLORS,
  TERRAIN_TEXTURE,
  drawIsland,
  drawMapFrame,
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
  /** 是否绘制叠加型符号（岛屿/瀑布） */
  features?: boolean;
  /** 是否绘制古地图双线图框（默认开） */
  frame?: boolean;
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
  if (opts.features !== false) drawOverlayFeatures(ctx, world);

  // ⑥ 古地图图框（最外层，后画压住边缘地形）
  if (opts.frame !== false) drawMapFrame(ctx, world);
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

/** 水体纹理：GL 地形层已负责水体质感（含动态涌浪/涟漪），2D 层补画时必须跳过，避免叠出双重水纹 */
const WATER_TEXTURES = new Set(["wave", "ripple", "ribbon"]);

/**
 * 只画**陆地地形图标**（供 WebGL 地形层之上补画）。
 *
 * 为什么需要它：GL 层给出的是连续的软色块 + 海岸线 + 起伏晕渲，
 * 「哪里是森林、哪里是沙丘、山脊朝哪」这类**可识别性**必须由图标承载 ——
 * 否则地图退化成一片渐变色域，用户只能靠颜色猜（实测就是这么被反馈的）。
 *
 * 水体（大海/湖泊/河流）刻意跳过：GL 侧已有动态水纹，再叠一层是重复。
 * 与 `drawTerrain` 用同一套 seed 派生，保证「GL ↔ Canvas2D 回退」图标位置完全一致。
 *
 * @param scale 当前视口缩放（screen px / world px）：用于细度守卫 ——
 *   每格屏幕像素 < `MIN_ICON_CELL_PX` 时图标只会糊成噪点，索性不画（省掉整张图的绘制开销）。
 */
export function drawTerrainIcons(
  ctx: CanvasRenderingContext2D,
  world: BuiltWorld,
  style: TexStyle = "A",
  scale = 1,
): void {
  if (world.cell * scale < MIN_ICON_CELL_PX) return;
  const { cols, rows, cells, cell } = world;
  const rng = mulberry32(world.snum ^ 0x9e3779b9);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = cells[r * cols + c];
      const tex = TERRAIN_TEXTURE[t];
      const rnd = rng();
      if (WATER_TEXTURES.has(tex)) continue;
      drawCellTexture(ctx, tex, c * cell, r * cell, cell, rnd, style);
    }
  }
}

/**
 * 图标细度下限（每格屏幕像素）。低于它时一格不到 4px，树/山符号退化成一两个杂点，
 * 既读不出地貌又白白吃掉整图绘制预算 —— 远景交给 GL 层的色块与晕渲即可。
 */
const MIN_ICON_CELL_PX = 4;

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
  const u = s / 16; // 以 16px 格为基准的缩放单位
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (tex) {
    case "wave": {
      // 大海：三行交错水平短弧浪纹（越靠下越密，模拟纵深）
      ctx.strokeStyle = "rgba(255,255,255,0.26)";
      ctx.lineWidth = Math.max(0.6, 0.9 * u);
      for (let row = 0; row < 3; row++) {
        const yy = y + s * (0.24 + row * 0.26);
        const inset = row % 2 === 0 ? 1.5 : 3;
        ctx.beginPath();
        ctx.moveTo(x + inset * u, yy);
        ctx.quadraticCurveTo(cx, yy - 2.2 * u, x + s - inset * u, yy);
        ctx.stroke();
      }
      break;
    }
    case "ripple": {
      // 湖泊：细密同心涟漪
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = Math.max(0.5, 0.7 * u);
      const rx = x + 3 * u + rnd * (s - 7 * u);
      const ry = y + 3.5 * u + ((rnd * 11) % (s - 8 * u));
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(rx, ry, 1.5 * i * u, 0.8 * i * u, 0, 0, 6.3);
        ctx.stroke();
      }
      break;
    }
    case "ribbon": {
      // 河流格本身：短浅色水痕（走向由 ribbon 承担）
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = Math.max(0.5, 0.8 * u);
      ctx.beginPath();
      ctx.moveTo(x + 3 * u, cy);
      ctx.lineTo(x + s - 3 * u, cy);
      ctx.stroke();
      break;
    }
    case "dune": {
      // 沙漠：同向新月形沙丘弧（两层）+ 风纹点
      ctx.strokeStyle = "rgba(150,120,70,0.34)";
      ctx.lineWidth = Math.max(0.6, 1 * u);
      ctx.beginPath();
      ctx.moveTo(x + 1 * u, cy - 1.5 * u);
      ctx.quadraticCurveTo(cx, y + 2 * u, x + s - 1 * u, cy - 1.5 * u);
      ctx.stroke();
      if (rnd > 0.45) {
        ctx.strokeStyle = "rgba(160,132,84,0.28)";
        ctx.beginPath();
        ctx.moveTo(x + 3.5 * u, cy + 3.5 * u);
        ctx.quadraticCurveTo(cx + 1 * u, cy + 1 * u, x + s - 3 * u, cy + 3 * u);
        ctx.stroke();
      }
      break;
    }
    case "grass": {
      // 草原：稀疏草叶（密度最低，视觉最「空」）
      const blades = rnd > 0.72 ? 2 : rnd > 0.34 ? 1 : 0;
      ctx.strokeStyle = "rgba(60,120,50,0.42)";
      ctx.lineWidth = Math.max(0.5, 0.75 * u);
      for (let i = 0; i < blades; i++) {
        const bx = x + 3.5 * u + ((rnd * 97 + i * 41) % (s - 7 * u));
        const by = y + s - 2.5 * u;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 1.4 * u, by - 4.5 * u);
        ctx.stroke();
      }
      break;
    }
    case "tree": {
      // 森林：树冠 + 树干（成簇散布，簇间留林间空地）
      if (rnd > 0.38) {
        const rr = (2.1 + rnd * 1.7) * u;
        const tx = cx + (rnd - 0.5) * 2.4 * u;
        const ty = cy - 1 * u;
        // 树影
        ctx.fillStyle = "rgba(30,60,30,0.22)";
        ctx.beginPath();
        ctx.ellipse(tx + rr * 0.35, ty + rr * 0.85, rr * 0.9, rr * 0.4, 0, 0, 6.3);
        ctx.fill();
        // 树干
        ctx.strokeStyle = "rgba(74,56,38,0.75)";
        ctx.lineWidth = Math.max(0.5, 0.8 * u);
        ctx.beginPath();
        ctx.moveTo(tx, ty + rr * 0.6);
        ctx.lineTo(tx, y + s - 1.5 * u);
        ctx.stroke();
        // 树冠
        ctx.fillStyle = style === "B" ? "rgba(28,86,38,0.88)" : "rgba(45,110,55,0.85)";
        ctx.beginPath();
        ctx.arc(tx, ty, rr, 0, 6.3);
        ctx.fill();
        ctx.fillStyle = "rgba(120,175,110,0.4)";
        ctx.beginPath();
        ctx.arc(tx - rr * 0.3, ty - rr * 0.3, rr * 0.45, 0, 6.3);
        ctx.fill();
      }
      break;
    }
    case "ridge": {
      // 山地：折线山形连绵成脊 + 山脚阴影线
      if (rnd > 0.26) {
        ctx.strokeStyle = "rgba(66,56,46,0.72)";
        ctx.lineWidth = Math.max(0.6, 1 * u);
        ctx.beginPath();
        ctx.moveTo(x + 1.5 * u, y + s - 3 * u);
        ctx.lineTo(cx - 2 * u, cy - 1.5 * u);
        ctx.lineTo(cx + 1.5 * u, cy + 1 * u);
        ctx.lineTo(x + s - 1.5 * u, y + s - 3 * u);
        ctx.stroke();
        // 右侧受光面
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.beginPath();
        ctx.moveTo(cx + 1.5 * u, cy + 1 * u);
        ctx.lineTo(x + s - 1.5 * u, y + s - 3 * u);
        ctx.lineTo(cx, y + s - 3 * u);
        ctx.closePath();
        ctx.fill();
        // 山脚阴影
        ctx.strokeStyle = "rgba(52,44,36,0.3)";
        ctx.lineWidth = Math.max(0.5, 0.7 * u);
        ctx.beginPath();
        ctx.moveTo(x + 2 * u, y + s - 1.5 * u);
        ctx.lineTo(x + s - 2 * u, y + s - 1.5 * u);
        ctx.stroke();
      }
      break;
    }
    case "snowcap": {
      // 雪山：山形 + 峰顶覆白 + 冷色侧影
      if (rnd > 0.26) {
        ctx.strokeStyle = "rgba(88,92,108,0.75)";
        ctx.lineWidth = Math.max(0.6, 1 * u);
        ctx.beginPath();
        ctx.moveTo(x + 1.5 * u, y + s - 2.5 * u);
        ctx.lineTo(cx, cy - 2.5 * u);
        ctx.lineTo(x + s - 1.5 * u, y + s - 2.5 * u);
        ctx.stroke();
        ctx.fillStyle = "rgba(214,226,240,0.75)";
        ctx.beginPath();
        ctx.moveTo(cx, cy - 2.5 * u);
        ctx.lineTo(x + s - 1.5 * u, y + s - 2.5 * u);
        ctx.lineTo(cx + 1 * u, y + s - 2.5 * u);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.moveTo(cx, cy - 3.2 * u);
        ctx.lineTo(cx - 2.4 * u, cy + 0.6 * u);
        ctx.lineTo(cx + 2.4 * u, cy + 0.6 * u);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "crystal": {
      // 雪原：极稀疏冰晶点 + 偶尔的冰裂纹
      if (rnd > 0.78) {
        ctx.strokeStyle = "rgba(150,180,220,0.55)";
        ctx.lineWidth = Math.max(0.4, 0.6 * u);
        const px = cx + (rnd - 0.5) * s * 0.5;
        const py = cy + (rnd - 0.5) * s * 0.5;
        ctx.beginPath();
        for (let a = 0; a < 3; a++) {
          const ang = (a * Math.PI) / 3;
          ctx.moveTo(px - Math.cos(ang) * 1.6 * u, py - Math.sin(ang) * 1.6 * u);
          ctx.lineTo(px + Math.cos(ang) * 1.6 * u, py + Math.sin(ang) * 1.6 * u);
        }
        ctx.stroke();
      }
      break;
    }
    case "lava": {
      // 熔岩（静态回退版）：岩壳底 + 交错岩浆沟 + 发光点
      ctx.strokeStyle = "rgba(232,132,26,0.78)";
      ctx.lineWidth = Math.max(0.7, 1.3 * u);
      ctx.beginPath();
      ctx.moveTo(x + 1.5 * u, y + s * 0.3);
      ctx.quadraticCurveTo(cx, cy + (rnd - 0.5) * s * 0.5, x + s - 1.5 * u, y + s * 0.62);
      ctx.stroke();
      if (rnd > 0.4) {
        ctx.strokeStyle = "rgba(255,196,84,0.8)";
        ctx.lineWidth = Math.max(0.5, 0.8 * u);
        ctx.beginPath();
        ctx.moveTo(cx, cy - 3 * u);
        ctx.lineTo(cx + 2 * u, cy + 3 * u);
        ctx.stroke();
      }
      if (rnd > 0.55) {
        ctx.fillStyle = "rgba(255,208,110,0.9)";
        ctx.beginPath();
        ctx.arc(cx + (rnd - 0.5) * s * 0.5, cy, 1.2 * u, 0, 6.3);
        ctx.fill();
      }
      break;
    }
    case "wetland": {
      // 沼泽：暗青苔甸 + 水洼 + 芦苇
      ctx.fillStyle = "rgba(58,92,86,0.55)";
      ctx.beginPath();
      ctx.ellipse(cx - 1.5 * u, cy + 1.5 * u, 3.2 * u, 2.1 * u, rnd * 0.6, 0, 6.3);
      ctx.fill();
      ctx.strokeStyle = "rgba(196,222,214,0.5)";
      ctx.lineWidth = Math.max(0.4, 0.6 * u);
      ctx.beginPath();
      ctx.ellipse(cx - 1.5 * u, cy + 1.5 * u, 3.2 * u, 2.1 * u, rnd * 0.6, 0, 6.3);
      ctx.stroke();
      if (rnd > 0.42) {
        ctx.strokeStyle = "rgba(126,158,96,0.7)";
        ctx.lineWidth = Math.max(0.4, 0.7 * u);
        for (let i = 0; i < 3; i++) {
          const bx = cx + (2 + i * 2) * u;
          ctx.beginPath();
          ctx.moveTo(bx, y + s - 1.5 * u);
          ctx.lineTo(bx + 0.8 * u, y + s - 6 * u);
          ctx.stroke();
        }
      }
      break;
    }
    case "rubble": {
      // 废墟：碎石块 + 断墙短线
      ctx.fillStyle = "rgba(120,112,100,0.6)";
      for (let i = 0; i < 3; i++) {
        const rx = x + (2 + ((rnd * 131 + i * 53) % (s - 6))) * u;
        const ry = y + (3 + ((rnd * 79 + i * 37) % (s - 7))) * u;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + 2 * u, ry - 0.6 * u);
        ctx.lineTo(rx + 2.4 * u, ry + 1.6 * u);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(96,88,76,0.7)";
      ctx.lineWidth = Math.max(0.6, 1.1 * u);
      ctx.beginPath();
      ctx.moveTo(x + 3 * u, cy + 2 * u);
      ctx.lineTo(x + s - 4 * u, cy - 2 * u);
      ctx.stroke();
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
export function drawOverlayFeatures(ctx: CanvasRenderingContext2D, world: BuiltWorld): void {
  for (const f of world.features) {
    if (f.type === "island" && f.points && f.cells) {
      drawIsland(ctx, f.points[0].x, f.points[0].y, f.cells, world.cell);
    } else if (f.type === "waterfall" && f.points) {
      const p = f.points[0];
      // 水帘朝低侧跌落：方向在派生时已按低侧法线算准（TerrainFeature.angle），渲染层不再反推
      drawWaterfall(ctx, p.x, p.y, world.cell, f.angle ?? Math.PI / 2);
    }
  }
}
