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
 *
 * ⚠️ 「水体只画一遍」是本文件最硬的一条约定（实测踩坑换来）：
 * - 地表（底色/纹理/等值线）一律读 `paintedCells(world)` = 抹掉河流的底质，
 *   **河格不再产生水面**；
 * - 河流由 `drawRiverRibbons` 按 feature 的 `pts` **单独绘制**（一条连续水带）。
 * 旧实现两边都画：GL 拿河格刷出一片宽水面（域扰动 + 覆盖度模糊把 1 格河吹到 ≈3 格），
 * 2D 层再按 pts 描一条窄水带 ⇒ 两条水体中心线/宽度都对不上，
 * 用户看到的就是「水道不是连贯的，不和谐」+「水里还有山的形状」。
 */

import type { BuiltWorld } from "./map-terrain";
import { paintedCells } from "./map-terrain";
import {
  TERRAIN_BORDER_COLORS,
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
  /** 当前视口缩放（screen px / world px），用于水带细度守卫与恒定岸线宽度 */
  scale?: number;
}

/** 绘制整张地形（底色 + 纹理） */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  world: BuiltWorld,
  opts: RenderOptions = {},
): void {
  const { cols, rows, cell } = world;
  /** 地表用「抹掉河流的底质」：河由 drawRiverRibbons 单独绘制，见文件头约定 */
  const cells = paintedCells(world);
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
  if (opts.rivers !== false) drawRiverRibbons(ctx, world, opts.scale ?? 1);

  // ⑤ 叠加型符号
  if (opts.features !== false) drawOverlayFeatures(ctx, world);

  // ⑥ 古地图图框（最外层，后画压住边缘地形）
  if (opts.frame !== false) drawMapFrame(ctx, world);
}

/**
 * 河道绘制参数（PRD §5.1「河流 = 蓝底 + 连续曲线水带 + 两岸浅色岸线」的落地口径）。
 * 半宽单位是「格」，随河程渐变；岸线按**屏幕像素**恒定，避免远景糊成一条黑线。
 */
const RIVER = {
  /** 主河：源头 → 河口的半宽（格） */
  mainHalfFrom: 0.15,
  mainHalfTo: 0.3,
  /** 支流：与主干交汇处 → 上游末端的半宽（格） */
  tribHalfFrom: 0.13,
  tribHalfTo: 0.07,
  /** 二次曲线平滑后的加密倍数（每个控制段插值点数） */
  subdiv: 6,
  /** 横向摆动：幅度（格）与沿程振荡次数（打散「严格过格中心」的栅格感） */
  wobbleAmp: 0.09,
  wobbleTurns: 2.2,
  /** 岸线屏幕宽度（px，恒定屏幕宽） */
  bankPx: 1.1,
  /** 远景守卫：水带最粗处屏幕半宽（px）低于此值则整条跳过 */
  minScreenHalfPx: 0.75,
  /** 端头圆弧的采样段数（源头的源头/河口入海都靠它收圆） */
  capSteps: 6,
} as const;

/**
 * 河道绘制（**水体唯一几何**）。
 *
 * 设计变更（2026-09）：
 * 1. 河道**只由本层绘制** —— GL/Canvas2D 的地表改用 `paintedCells`（河格回填成底质），
 *    不再刷出一片宽水面。之前两套水体各自成型、互相错位，是「水道不连贯」的根因。
 * 2. 宽度**沿程渐变**：主河自源头 ~0.15 格渐宽到河口 ~0.30 格，支流自交汇点 0.13 格
 *    向上游收细到 0.07 格 —— 一条折线只有一个 lineWidth，渐变必须自己生成轮廓多边形。
 * 3. 曲线平滑沿用「二次曲线取中点」老口径（与旧实现视觉连续），再叠一道正弦横向摆动，
 *    使河道不再逐格走「格中心」的楼梯。
 * 4. 支流已刻进 cells（见 map-terrain.addTributaries），交汇点与主干共格，天然接得上。
 *
 * @param scale 当前视口缩放：用于恒定屏幕岸线宽度与远景跳过
 */
export function drawRiverRibbons(
  ctx: CanvasRenderingContext2D,
  world: BuiltWorld,
  scale = 1,
): void {
  for (const f of world.features) {
    if (f.type !== "river" || !f.pts || f.pts.length < 4) continue;
    // 远景守卫：整条水带在屏幕上不足 1.5px 宽时只有噪点，交给 GL 的色块即可
    // （取最粗处判定：最粗处都不到 1.5px，整条就没救了）
    const widest = riverHalfWidth(!!f.trib, f.trib ? 0 : 1, world.cell);
    if (widest * scale < RIVER.minScreenHalfPx) continue;
    drawRiver(ctx, f.pts, world.cell, !!f.trib, scale, f.trib ? 1.7 : 0.0);
  }
}

/**
 * 河宽曲线：`t` = 沿程进度（0 → 1）。
 * - 主河（trib=false）：0 = 源头（细），1 = 河口（粗）
 * - 支流（trib=true）：0 = 与主干交汇处（粗），1 = 上游末端（细）
 * 返回**半宽**（世界像素）。抽成纯函数是为了可单测（宽度渐变是「一眼看出是河」的关键）。
 */
export function riverHalfWidth(trib: boolean, t: number, cell: number): number {
  const k = smoothStep(t < 0 ? 0 : t > 1 ? 1 : t);
  const half = trib
    ? RIVER.tribHalfFrom + (RIVER.tribHalfTo - RIVER.tribHalfFrom) * k
    : RIVER.mainHalfFrom + (RIVER.mainHalfTo - RIVER.mainHalfFrom) * k;
  return half * cell;
}

/** 单条河道：加密曲线 → 变宽轮廓 → 填充水体 + 描岸线 */
function drawRiver(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  cell: number,
  trib: boolean,
  scale: number,
  phase: number,
): void {
  const line = sampleRiver(pts, RIVER.subdiv);
  const m = line.length;
  if (m < 2) return;

  // 逐点法线（中心差分）+ 正弦横向摆动 + 变宽
  const centers: Pt[] = [];
  const normals: Pt[] = [];
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < m; i++) {
    const p = line[i];
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(m - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    const t = m > 1 ? i / (m - 1) : 0;
    const w = riverHalfWidth(trib, t, cell);
    const wob = Math.sin(t * Math.PI * 2 * RIVER.wobbleTurns + phase) * RIVER.wobbleAmp * cell;
    const cx = p.x + nx * wob;
    const cy = p.y + ny * wob;
    centers.push({ x: cx, y: cy });
    normals.push({ x: nx, y: ny });
    left.push({ x: cx + nx * w, y: cy + ny * w });
    right.push({ x: cx - nx * w, y: cy - ny * w });
  }

  // 轮廓：左岸顺行 → 河口圆头 → 右岸逆行 → 源头圆头
  const endHalf = riverHalfWidth(trib, 1, cell);
  const startHalf = riverHalfWidth(trib, 0, cell);
  // 端头切线方向直接由相邻中心点算，避免与法线符号约定耦合（弧顶必须朝路径外侧）
  const dirEnd = unit(centers[m - 2], centers[m - 1]);
  const dirStartBack = unit(centers[1], centers[0]);
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < m; i++) ctx.lineTo(left[i].x, left[i].y);
  // 河口圆头：自左岸绕到右岸，弧顶朝前（+dir）
  pushArc(ctx, centers[m - 1], normals[m - 1], dirEnd, endHalf);
  for (let i = m - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  // 源头圆头：自右岸绕回左岸，弧顶朝后（-dir）
  pushArc(ctx, centers[0], { x: -normals[0].x, y: -normals[0].y }, dirStartBack, startHalf);
  ctx.closePath();

  // 水体 + 岸线（岸线恒定屏幕宽度：世界坐标下要除以缩放）
  // save/restore：本层被外层画布直接调用，不能把 lineJoin/颜色泄漏给后续的标注绘制
  ctx.save();
  ctx.lineJoin = "round";
  ctx.fillStyle = TERRAIN_COLORS[2];
  ctx.fill();
  ctx.strokeStyle = TERRAIN_BORDER_COLORS[2];
  ctx.lineWidth = RIVER.bankPx / Math.max(scale, 0.01);
  ctx.stroke();
  ctx.restore();
}

interface Pt {
  x: number;
  y: number;
}

/** a → b 的单位向量（重合时返回 (1,0)，不抛错） */
function unit(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len < 1e-6 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
}

/**
 * 端头半圆：`u*cos(a) + v*sin(a)`（a: 0→π，u ⊥ v）就是一段半圆弧 ——
 * 起点在 `u` 侧、弧顶在 `v` 侧、终点在 `-u` 侧。河口的圆头与源头的起笔都靠它收干净。
 */
function pushArc(
  ctx: CanvasRenderingContext2D,
  at: Pt,
  u: Pt,
  v: Pt,
  r: number,
): void {
  for (let s = 1; s < RIVER.capSteps; s++) {
    const a = (Math.PI * s) / RIVER.capSteps;
    const c = Math.cos(a);
    const n = Math.sin(a);
    ctx.lineTo(at.x + (u.x * c + v.x * n) * r, at.y + (u.y * c + v.y * n) * r);
  }
}

/** 缓入缓出的河宽进度（河口增长快、源头细缓） */
function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 与旧实现同一套「二次曲线取中点」平滑，输出加密折线：
 * 逐段以 pts[k-1] 为控制点、mid(pts[k-1], pts[k]) 为终点做二次曲线，末点直连。
 */
function sampleRiver(pts: number[], subdiv: number): Pt[] {
  const n = pts.length / 2;
  const at = (i: number): Pt => ({ x: pts[i * 2], y: pts[i * 2 + 1] });
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  if (n < 2) return [];
  const out: Pt[] = [];
  let cursor = at(0);
  out.push(cursor);
  for (let i = 1; i < n; i++) {
    const control = at(i - 1);
    const end = i === n - 1 ? at(n - 1) : mid(at(i - 1), at(i));
    for (let s = 1; s <= subdiv; s++) {
      const t = s / subdiv;
      const mt = 1 - t;
      out.push({
        x: mt * mt * cursor.x + 2 * mt * t * control.x + t * t * end.x,
        y: mt * mt * cursor.y + 2 * mt * t * control.y + t * t * end.y,
      });
    }
    cursor = end;
  }
  return out;
}

/** 水体纹理：GL 地形层已负责水体质感（含动态涌浪/涟漪），2D 层补画时必须跳过，避免叠出双重水纹 */
const WATER_TEXTURES = new Set(["wave", "ripple", "ribbon"]);

/**
 * 图标抽样参数（PRD §5.1 渲染约束 ⑧：**图标是点缀，不是铺满的矩阵**）
 *
 * 为什么改：GL 层已经用逐地貌程序化材质（林冠团块 / 岩脊 / 沙丘条纹 / 水洼…）
 * 加 hillshade 把质感画出来了。2D 层若再「一格一个、钉死在格中心」地铺图标，
 * 等于把 GL 好不容易用域扰动揉掉的栅格感原样压回去 —— 这是与「游戏级手绘地图」
 * 观感差距最大的一处。
 *
 * 现在的口径 = **抖动栅格抽样**（jittered lattice，蓝噪声的廉价近似）：
 * - 候选点步距 `step` 格 ⇒ 候选数 = 全图的 1/step²，再叠加纹理内部原有的概率门
 *   （tree 62% / ridge 74% / crystal 22% …），森林实际落笔率约 15%（旧版 62%）。
 * - 位置 ±jitter 格抖动、边长 1.05~1.55 格（**≠ 一格**）、旋转 ±rotAmp
 *   ⇒ 符号不再对齐格心、不再等大、不再一律朝上。
 *
 * ⚠️ 只作用于 GL 补画层。`drawTerrain` 是「无 GL / 地块模式回退」，那里图标
 *   **就是**地表材质本身，必须保持逐格满密度，否则回退图会退化成纯色块。
 */
const ICON_SAMPLE = {
  /** 候选点步距（格） */
  step: 2,
  /** 位置抖动幅度（格，双向） */
  jitter: 0.55,
  /** 符号边长（格）：刻意**不等于 1**，是脱离「一格一符号」的关键 */
  sizeFrom: 1.05,
  sizeTo: 1.55,
  /** 旋转幅度（弧度）：轻微歪斜即手绘感，再大就成「贴反了」 */
  rotAmp: 0.1,
};

/** 候选点各自由度用的盐值（互不相关，改动会重排图案） */
const H = { size: 0x9e3779b1, jx: 0x85ebca77, jy: 0xc2b2ae3d, rot: 0x27d4eb2f, rnd: 0x165667b9 };

/**
 * 与迭代顺序无关的确定性哈希（0~1）。
 * 用哈希而不是 PRNG 序列：抽样一旦改成抖动栅格，遍历顺序不再是行优先全扫描，
 * 序列式 PRNG 会让「同一格在不同 step 下拿到不同随机数」，哈希则永远稳定。
 */
function siteHash(c: number, r: number, seed: number, salt: number): number {
  let h = Math.imul(c, 0x1f1f1f1f) ^ Math.imul(r, 0x8da6b343) ^ Math.imul(seed, 0x7feb352d) ^ salt;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 一个图标候选点（纯数据，便于单测断言「稀疏 / 去栅格 / 不入水」） */
export interface IconSite {
  /** 抖动后**中心所在格**的索引：落笔前的地形与水体判定都用它 */
  index: number;
  /** 该格的纹理名（已剔除水体纹理） */
  tex: string;
  /** 符号左上角世界坐标（≠ 格左上角） */
  x: number;
  y: number;
  /** 符号边长（世界像素，刻意 ≠ cell） */
  size: number;
  /** 旋转（弧度） */
  rot: number;
  /** 交给 drawCellTexture 的确定性随机数 */
  rnd: number;
}

/**
 * 抽样「手绘点缀」候选点（纯函数，可独立单测）。
 *
 * ⚠️ 落笔判定必须用**抖动后的中心**重取所在格：抖动会跨格，若沿用候选格判定，
 *    一棵抖动到海里的树就会被判成「陆地上」从而画进水里（正是上一轮修的 bug）。
 */
export function sampleIconSites(world: BuiltWorld, waterMask?: Uint8Array | null): IconSite[] {
  const { cols, rows, cells, cell, snum } = world;
  const out: IconSite[] = [];
  const step = ICON_SAMPLE.step;
  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const size =
        cell * (ICON_SAMPLE.sizeFrom + (ICON_SAMPLE.sizeTo - ICON_SAMPLE.sizeFrom) * siteHash(c, r, snum, H.size));
      const cx = (c + 0.5) * cell + (siteHash(c, r, snum, H.jx) - 0.5) * 2 * ICON_SAMPLE.jitter * cell;
      const cy = (r + 0.5) * cell + (siteHash(c, r, snum, H.jy) - 0.5) * 2 * ICON_SAMPLE.jitter * cell;
      const cc = Math.floor(cx / cell);
      const cr = Math.floor(cy / cell);
      if (cc < 0 || cr < 0 || cc >= cols || cr >= rows) continue;
      const i = cr * cols + cc;
      if (waterMask && waterMask[i]) continue;
      const tex = TERRAIN_TEXTURE[cells[i]];
      if (WATER_TEXTURES.has(tex)) continue;
      out.push({
        index: i,
        tex,
        x: cx - size / 2,
        y: cy - size / 2,
        size,
        rot: (siteHash(c, r, snum, H.rot) - 0.5) * 2 * ICON_SAMPLE.rotAmp,
        rnd: siteHash(c, r, snum, H.rnd),
      });
    }
  }
  return out;
}

/**
 * 只画**陆地地形图标**（供 WebGL 地形层之上补画）。
 *
 * 为什么需要它：GL 层给出的是连续的软色块 + 海岸线 + 起伏晕渲，
 * 「哪里是森林、哪里是沙丘、山脊朝哪」这类**可识别性**必须由图标承载 ——
 * 否则地图退化成一片渐变色域，用户只能靠颜色猜（实测就是这么被反馈的）。
 *
 * 但它是**点缀**：稀疏、错位、不等大（见 `ICON_SAMPLE`），不再是一格一个的矩阵。
 *
 * 水体（大海/湖泊/河流）刻意跳过：GL 侧已有动态水纹，再叠一层是重复。
 *
 * @param scale 当前视口缩放（screen px / world px）：用于细度守卫 ——
 *   每格屏幕像素 < `MIN_ICON_CELL_PX` 时图标只会糊成噪点，索性不画（省掉整张图的绘制开销）。
 * @param waterMask `buildGlWaterMask` 的产物（1 = GL 会把这格画成水面）：
 *   **水里不能长山** —— 只看 `cells` 的地形码是不够的，GL 的实际画面是模糊后的软场
 *   决定的，海岸/湖岸的软边会溢进相邻陆格。掩码把这类格一并跳过。
 */
export function drawTerrainIcons(
  ctx: CanvasRenderingContext2D,
  world: BuiltWorld,
  style: TexStyle = "A",
  scale = 1,
  waterMask?: Uint8Array | null,
): void {
  if (world.cell * scale < MIN_ICON_CELL_PX) return;
  for (const site of sampleIconSites(world, waterMask)) {
    ctx.save();
    if (site.rot !== 0) {
      // 绕符号中心旋转：先把中心平移到原点，转完再移回去
      const mx = site.x + site.size / 2;
      const my = site.y + site.size / 2;
      ctx.translate(mx, my);
      ctx.rotate(site.rot);
      ctx.translate(-mx, -my);
    }
    drawCellTexture(ctx, site.tex, site.x, site.y, site.size, site.rnd, style);
    ctx.restore();
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
  const { cols, rows, elev, cell } = world;
  const cells = paintedCells(world);
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
