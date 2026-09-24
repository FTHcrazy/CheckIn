/**
 * 符号与配色库（docs/novel-map-prd.md §5.1 图例规格 + RM13 符号库）
 *
 * 设计要点：
 * - 9 类铺满型地形：每类一套「底色 + 纹理风格」，由 map-render 程序化绘制（canvas）
 * - 叠加型 3 类（悬崖/岛屿/瀑布）：符号绘制函数，画在地形层之上
 * - 贴章符号库：地点 8 + 地貌装饰 8，形状以 SVG path 单一来源，
 *   画布层用 Path2D 复用同一份 d（零素材依赖，规避贴图版权）
 * - 符号风格 A（圆润）/ B（尖锐）/ C（简约）：同一个 key 取不同 path
 *
 * 边界：纯数据 + 纯函数，不 import React / window，可独立单测。
 */

import { TER_KEY, T_SEA, T_LAKE, T_RIVER, T_LAVA } from "./map-terrain";
export { TER_KEY } from "./map-terrain";

// ── 铺满型地形配色 ──
// 说明（对齐 AGENTS.md 6.1.1 例外条例）：地形色属于**地物惯例色 / 业务数据**，
// 与「用户自定义活动配色」「地形图例」同性质，四套主题下保持一致，故允许硬编码。
// 单一事实源：Canvas2D 回退、PNG 导出图例、WebGL shader uniform 三处共用本数组，
// 禁止在 shader / 组件里各写一份，否则改一处会掉色。
export const TERRAIN_COLORS: readonly string[] = [
  "#2f6f9f", // 0 sea
  "#3f7ea6", // 1 lake
  "#4a90c2", // 2 river
  "#d8c187", // 3 desert
  "#8fb56a", // 4 grass
  "#4f8a48", // 5 forest
  "#9a8b76", // 6 mountain
  "#b7c2cf", // 7 snowmtn
  "#e7eef6", // 8 snowfield
  "#8f3b21", // 9 lava（岩壳底色，岩浆沟的高光由 shader / 纹理叠加）
];

/**
 * 地形分界描边色（手绘地图的「墨线」语义，逐条移植自设计稿 outlineLayer.BORDER_COLOR）。
 *
 * 用途：GL shader 与 Canvas2D 回退都会在每个地形区块的等值线上叠一道极窄的同调深色线。
 * 这是「一眼能分辨地貌」的关键——相邻地形（草原/森林、山地/沙漠）底色接近，
 * 只靠底色差异在高倍率下会糊成一片。
 *
 * sea / river / lava 在设计稿里没有专属描边（海岸另走「沙带 + 深岸线」两笔画），
 * 这里取其底色的加深近似，保证数组长度与 TERRAIN_COLORS 对齐。
 */
export const TERRAIN_BORDER_COLORS: readonly string[] = [
  "#24587f", // 0 sea
  "#3d7aa6", // 1 lake
  "#37729b", // 2 river
  "#bb9145", // 3 desert
  "#7ea358", // 4 grass
  "#4d7d3c", // 5 forest
  "#6d5840", // 6 mountain
  "#6f8298", // 7 snowmtn
  "#aec6da", // 8 snowfield
  "#6d2a15", // 9 lava
];

/** 海岸线配色（设计稿 outlineLayer：宽沙带 + 窄深岸线） */
export const COAST_SAND = "#e8d9ad";
export const COAST_LINE = "#456a85";

/** 水域地形索引（海岸线只画在「陆地↔水体」交界，湖/河之间不算海岸） */
export const WATER_TERRAIN: readonly number[] = [T_SEA, T_LAKE, T_RIVER];

/**
 * 会随时间流动的地形索引（水体的涌动、岩浆的缓慢环流）。
 * shader 与 Canvas2D 静态回退共用同一份判定，避免出现「GL 下会动、降级后不动」的认知割裂。
 */
export const FLUID_TERRAIN: readonly number[] = [T_SEA, T_LAKE, T_RIVER, T_LAVA];

/** 纹理风格枚举，与 TER_KEY 索引对应 */
export type TerrainTexture =
  | "wave"
  | "ripple"
  | "ribbon"
  | "dune"
  | "grass"
  | "tree"
  | "ridge"
  | "snowcap"
  | "crystal"
  | "lava";

export const TERRAIN_TEXTURE: readonly TerrainTexture[] = [
  "wave",
  "ripple",
  "ribbon",
  "dune",
  "grass",
  "tree",
  "ridge",
  "snowcap",
  "crystal",
  "lava",
];

export interface SymbolDef {
  key: string;
  name: string;
  group: "place" | "decor";
  /** 默认主题色（可由外部覆盖） */
  color: string;
  /** SVG path d（viewBox 0 0 24 24），按风格取形 */
  path: (style: "A" | "B" | "C") => string;
  /** 是否为填充型（否则仅描边） */
  filled?: boolean;
}

// ── 地点符号 8 ──
export const PLACE_SYMBOLS: readonly SymbolDef[] = [
  {
    key: "city",
    name: "城池",
    group: "place",
    color: "#c0654f",
    filled: true,
    path: (s) =>
      s === "B"
        ? "M5 20V9l7-4 7 4v11h-4v-5h-6v5z"
        : s === "C"
          ? "M6 19V10h12v9H6zM9 13h6"
          : "M5 20V9.5L12 5l7 4.5V20h-3.5v-5h-7v5z",
  },
  {
    key: "town",
    name: "城镇",
    group: "place",
    color: "#4f9a6a",
    filled: true,
    path: (s) =>
      s === "B"
        ? "M7 20v-8l5-3 5 3v8z"
        : s === "C"
          ? "M8 19V12h8v7H8z"
          : "M7 20v-7.5l5-3 5 3V20z",
  },
  {
    key: "village",
    name: "村庄",
    group: "place",
    color: "#5fae7c",
    filled: true,
    path: (s) =>
      s === "B"
        ? "M9 20v-6l3-2 3 2v6z"
        : "M9 20v-5.5l3-2 3 2V20z",
  },
  {
    key: "pass",
    name: "关卡",
    group: "place",
    color: "#cf9b4a",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M4 20l4-12 4 6 4-9 4 15M4 20h16"
        : "M4 20l4-11 4 6 4-8 4 13M4 20h16",
  },
  {
    key: "port",
    name: "港口",
    group: "place",
    color: "#3f86b8",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M12 4v12M12 16l-5 4M12 16l5 4M9 7h6"
        : "M12 4v11M8 9h8M12 15c-3 0-5 1.5-6 4 3-1 4-1 6-1s3 0 6 1c-1-2.5-3-4-6-4z",
  },
  {
    key: "ruins",
    name: "遗迹",
    group: "place",
    color: "#9a7bb0",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M6 20V10h4v3h4v-3h4v10M9 13v7M15 13v7"
        : "M6 20V11l2-2 2 2v9M14 20v-9l2-2 2 2v9",
  },
  {
    key: "temple",
    name: "神殿",
    group: "place",
    color: "#c79a3e",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M12 4l6 5v11H6V9zM9 20v-6h6v6"
        : "M12 4l7 6v10H5V10zM12 8v12",
  },
  {
    key: "mine",
    name: "矿洞",
    group: "place",
    color: "#7a8a99",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M6 20v-9a6 6 0 0112 0v9M10 11v9"
        : "M6 20v-8a6 6 0 0112 0v8M9 12v8M15 12v8",
  },
];

// ── 地貌装饰 8 ──
export const DECOR_SYMBOLS: readonly SymbolDef[] = [
  {
    key: "tree",
    name: "阔叶树",
    group: "decor",
    color: "#3f8a4a",
    filled: true,
    path: (s) =>
      s === "B"
        ? "M12 4l5 8H7zM12 12v8"
        : "M12 4a6 6 0 016 6 5 5 0 01-12 0 6 6 0 016-6zM12 13v7",
  },
  {
    key: "pine",
    name: "松树",
    group: "decor",
    color: "#357a44",
    filled: true,
    path: (s) =>
      s === "B"
        ? "M12 3l4 6-3 1 4 6H7l4-6-3-1zM12 16v5"
        : "M12 3l5 8H7zM12 9l4 7H8zM12 16v5",
  },
  {
    key: "rock",
    name: "岩石",
    group: "decor",
    color: "#8a8378",
    filled: true,
    path: (s) =>
      s === "B"
        ? "M6 19l4-9 6 3 3 6z"
        : "M6 19l5-8 4 2 4 6z",
  },
  {
    key: "tent",
    name: "帐篷",
    group: "decor",
    color: "#b06a3e",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M4 19l8-13 8 13zM12 6v13"
        : "M4 19l8-12 8 12zM9 19l3-6 3 6",
  },
  {
    key: "camp",
    name: "营火",
    group: "decor",
    color: "#d2772f",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M12 5c2 3-2 4 0 7M9 18h6M10 14c0 2 4 2 4 0"
        : "M12 6c2 3-2 4 0 6M8 18h8l-4-4z",
  },
  {
    key: "bridge",
    name: "桥",
    group: "decor",
    color: "#9a8050",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M3 16c6-6 12-6 18 0M3 16v3M21 16v3M7 14v4M17 14v4"
        : "M3 15c4-4 14-4 18 0M5 15v3M19 15v3",
  },
  {
    key: "boat",
    name: "船",
    group: "decor",
    color: "#3f86b8",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M4 16h16l-3 4H7zM12 4v12"
        : "M4 16h16l-2 4H6zM12 5v11",
  },
  {
    key: "flag",
    name: "旗",
    group: "decor",
    color: "#c0455a",
    filled: true,
    path: (s) =>
      s === "B"
        ? "M12 4v16M12 4l8 3-8 3z"
        : "M12 4v16M12 5l7 2-7 3z",
  },
];

export const ALL_SYMBOLS: readonly SymbolDef[] = [
  ...PLACE_SYMBOLS,
  ...DECOR_SYMBOLS,
];

export function findSymbol(key: string): SymbolDef | undefined {
  return ALL_SYMBOLS.find((s) => s.key === key);
}

/**
 * 在 2D 画布上绘制一个贴章符号（RM13 变换：位置/缩放/旋转/翻转）
 * 单源 path → Path2D，画布与导出共用
 */
export function drawSymbol(
  ctx: CanvasRenderingContext2D,
  def: SymbolDef,
  x: number,
  y: number,
  size: number,
  opts: { rotation?: number; flip?: boolean; scale?: number; color?: string; style?: "A" | "B" | "C" } = {},
): void {
  const scale = opts.scale ?? 1;
  const style = opts.style ?? "A";
  const color = opts.color ?? def.color;
  ctx.save();
  ctx.translate(x, y);
  if (opts.flip) ctx.scale(-1, 1);
  ctx.rotate(((opts.rotation ?? 0) * Math.PI) / 180);
  ctx.scale(scale, scale);
  // 符号基准 24×24，居中缩放至 size
  ctx.translate(-size / 2, -size / 2);
  const s = size / 24;
  ctx.scale(s, s);
  const p = new Path2D(def.path(style));
  if (def.filled) {
    ctx.fillStyle = color;
    ctx.fill(p);
    ctx.lineWidth = 1.4 / s;
    ctx.strokeStyle = "rgba(20,20,30,0.45)";
    ctx.stroke(p);
  } else {
    ctx.lineWidth = 1.6 / s;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.stroke(p);
  }
  ctx.restore();
}

/** 叠加型符号绘制：悬崖（带短刺粗线，刺向崖底） */
export function drawCliff(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  seed: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(60,50,40,0.85)";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  for (const pt of pts) {
    const r = ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 100) / 100;
    const ang = r * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x - Math.cos(ang) * 7, pt.y - Math.sin(ang) * 7 - 4);
    ctx.stroke();
    // 短刺
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x + Math.cos(ang) * 4, pt.y + Math.sin(ang) * 4 + 5);
    ctx.stroke();
  }
  ctx.restore();
}

/** 叠加型符号绘制：岛屿（椭圆地块 + 一圈沙滩描边） */
export function drawIsland(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cells: number[],
  cell: number,
): void {
  ctx.save();
  const rx = Math.max(10, (Math.sqrt(cells.length) * cell) / 2 + 4);
  const ry = rx * 0.78;
  ctx.fillStyle = "rgba(216,193,135,0.55)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(180,150,95,0.9)";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([3, 2]);
  ctx.stroke();
  ctx.restore();
}

/** 叠加型符号绘制：瀑布（竖向双线 + 下方水花点） */
export function drawWaterfall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(220,235,245,0.95)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 8);
  ctx.lineTo(x - 3, y + 5);
  ctx.moveTo(x + 3, y - 8);
  ctx.lineTo(x + 3, y + 5);
  ctx.stroke();
  ctx.fillStyle = "rgba(220,235,245,0.9)";
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(x - 4 + i * 2, y + 8, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 地形 key 名（导出图例/调试用） */
export function terrainName(index: number): string {
  return TER_KEY[index] ?? "unknown";
}
