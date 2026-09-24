/**
 * 符号与配色库（docs/novel-map-prd.md §5.1 图例规格 + RM13 符号库）
 *
 * 设计要点：
 * - 12 类铺满型地形：每类一套「底色 + 纹理风格」，由 map-render 程序化绘制（canvas）
 * - 叠加型 2 类（岛屿/瀑布）：符号绘制函数，画在地形层之上（由栅格派生，不入存档）
 * - 贴章符号库：地点 8 + 地貌装饰 8，形状以 SVG path 单一来源，
 *   画布层用 Path2D 复用同一份 d（零素材依赖，规避贴图版权）
 * - 符号风格 A（圆润）/ B（尖锐）/ C（简约）：同一个 key 取不同 path
 *
 * 边界：纯数据 + 纯函数，不 import React / window，可独立单测。
 */

import { TER_KEY, TER_META, T_SEA, T_LAKE, T_RIVER, T_LAVA } from "./map-terrain";
export { TER_KEY, TER_META } from "./map-terrain";

/**
 * 地形中文名（图例 / 侧栏 / PNG 图例三处共用）。
 * 单一事实源 = map-terrain.TER_META，禁止各处再各写一份映射表
 * （历史遗留的四份 `terrainCn()` 副本已由此取代）。
 */
export function terrainLabel(key: string): string {
  const i = TER_KEY.indexOf(key as (typeof TER_KEY)[number]);
  return i >= 0 ? (TER_META[i]?.name ?? key) : key;
}

/** 地形说明文案（图例用） */
export function terrainDesc(key: string): string {
  const i = TER_KEY.indexOf(key as (typeof TER_KEY)[number]);
  return i >= 0 ? (TER_META[i]?.desc ?? "") : "";
}
export { T_LAVA };

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
  "#5c7d63", // 10 marsh（暗青苔甸，与草原/森林拉开灰绿水感）
  "#b3a795", // 11 ruins（灰白碎石土，夹断墙残垣线）
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
  "#45604b", // 10 marsh
  "#8a8172", // 11 ruins
];

/** 海岸线配色（设计稿 outlineLayer：宽沙带 + 窄深岸线） */
export const COAST_SAND = "#e8d9ad";
export const COAST_LINE = "#456a85";

/** 图外「纸面」底色（画布留白 / 导出底 / GL 清屏色三处共用同一份） */
export const MAP_PAPER = "#e6e0d2";
/** 图框（双线画框）配色：外粗内细，模仿古地图边框 */
export const MAP_FRAME = "#5a4a34";

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
  | "lava"
  | "wetland"
  | "rubble";

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
  "wetland",
  "rubble",
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
  // ── 热门小说高频地点（宗门 / 秘境 / 魔渊）──
  {
    key: "sect",
    name: "宗门",
    group: "place",
    color: "#8b6fc4",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M12 3l7 4v3H5V7zM7 10v8M12 10v8M17 10v8M4 20h16"
        : "M12 3.5l7 3.5H5zM6.5 20V9M12 20V9M17.5 20V9M4 20h16",
  },
  {
    key: "secret",
    name: "秘境",
    group: "place",
    color: "#4aa3b8",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M12 3c4 3 6 6 6 9a6 6 0 01-12 0c0-3 2-6 6-9zM12 12v9"
        : "M12 4c3.5 3 5.5 5.5 5.5 8.2A5.5 5.5 0 016.5 12.2C6.5 9.5 8.5 7 12 4zM12 23v-9",
  },
  {
    key: "abyss",
    name: "魔渊",
    group: "place",
    color: "#7b4b6b",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M4 6c4 4 12 4 16 0M7 11c3 3 7 3 10 0M10 16c1.5 1.5 2.5 1.5 4 0"
        : "M4 6c4 3 12 3 16 0M6.5 11c3 3 8 3 11 0M10 16c1.5 2 2.9 2 4 0",
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
  // ── 热门小说高频地貌装饰（火山 / 农田 / 断垣）──
  {
    key: "volcano",
    name: "火山",
    group: "decor",
    color: "#b2502f",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M3 20l6-14h6l6 14zM9 9l3 2 3-2"
        : "M3 20l6.5-13h5L21 20zM9.5 10c1.5 1.5 3.5 1.5 5 0",
  },
  {
    key: "farmland",
    name: "农田",
    group: "decor",
    color: "#93a848",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M4 18h16M4 20h16M6 18v-4M10 18v-4M14 18v-4M18 18v-4M5 14h14"
        : "M4 17h16v4H4zM4 17c4-3 12-3 16 0M8 17v4M12 17v4M16 17v4",
  },
  {
    key: "arch",
    name: "断垣",
    group: "decor",
    color: "#9d968a",
    filled: false,
    path: (s) =>
      s === "B"
        ? "M5 20V9h3v4h3V7h3v6h3V10h3v10M4 20h16"
        : "M5 20V10h3.5v3.5H12V8h3.5v5.5H19V20",
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

/** 叠加型符号绘制：岛屿（椭圆地块 + 沙滩描边 + 中央微地貌） */
export function drawIsland(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cells: number[],
  cell: number,
): void {
  ctx.save();
  const rx = Math.max(8, (Math.sqrt(Math.max(2, cells.length)) * cell) / 2 + cell * 0.3);
  const ry = rx * 0.78;
  // 沙洲（比陆地大一圈）
  ctx.fillStyle = "rgba(232,217,173,0.8)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // 陆块
  ctx.fillStyle = "rgba(143,181,106,0.95)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.74, ry * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  // 岸线
  ctx.strokeStyle = "rgba(69,106,133,0.75)";
  ctx.lineWidth = Math.max(0.6, cell * 0.06);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  // 中央微地貌：一撮树
  ctx.fillStyle = "rgba(58,110,62,0.9)";
  const r = Math.max(1.6, cell * 0.16);
  ctx.beginPath();
  ctx.arc(cx - r * 0.9, cy - r * 0.4, r, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.9, cy + r * 0.5, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 叠加型符号绘制：瀑布（崖唇 + 双水帘 + 水潭溅点）。
 *
 * 落点由 map-terrain 吸附到**高差格边中点**（山地与低地交界 ∩ 河道），
 * 因此不会再出现旧版「白双竖线孤零零漂在湖面中央」的怪图案。
 * 尺寸全部随 cell 缩放，缩放时不会变形。
 */
export function drawWaterfall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  angle = Math.PI / 2,
): void {
  const u = Math.max(0.55, cell / 16);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle - Math.PI / 2); // 默认朝下（+y）
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // ① 崖唇：横贯的两道短横线（说明「水从这里跌落」）
  ctx.strokeStyle = "rgba(58,46,34,0.85)";
  ctx.lineWidth = 1.5 * u;
  ctx.beginPath();
  ctx.moveTo(-6 * u, -1.5 * u);
  ctx.lineTo(6 * u, -1.5 * u);
  ctx.stroke();
  ctx.lineWidth = 1.1 * u;
  ctx.beginPath();
  ctx.moveTo(-4.5 * u, -4 * u);
  ctx.lineTo(4.5 * u, -4 * u);
  ctx.stroke();

  // ② 水帘：三条逐渐收窄的竖线
  ctx.strokeStyle = "rgba(226,240,250,0.95)";
  for (let i = -1; i <= 1; i++) {
    ctx.lineWidth = (1.5 - Math.abs(i) * 0.4) * u;
    ctx.beginPath();
    ctx.moveTo(i * 2.6 * u, -1 * u);
    ctx.lineTo(i * 2.2 * u, 6.5 * u);
    ctx.stroke();
  }

  // ③ 水潭：椭圆 + 溅点
  ctx.fillStyle = "rgba(150,192,214,0.85)";
  ctx.beginPath();
  ctx.ellipse(0, 7.5 * u, 5 * u, 2.1 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(236,246,252,0.9)";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc((i - 1) * 3 * u, 4.6 * u - i * 0.6 * u, 0.9 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 地图图框（双线画框，古地图惯用）——画在世界坐标系最外层，
 * 让「地图之外的留白」看起来是有意为之的版面，而不是渲染漏白。
 */
export function drawMapFrame(
  ctx: CanvasRenderingContext2D,
  world: { width: number; height: number; cell: number },
): void {
  const { width: w, height: h, cell } = world;
  const c = Math.max(6, cell);
  ctx.save();
  ctx.lineJoin = "miter";
  // 外粗框
  ctx.strokeStyle = "rgba(90,74,52,0.55)";
  ctx.lineWidth = c * 0.34;
  ctx.strokeRect(-c * 0.17, -c * 0.17, w + c * 0.34, h + c * 0.34);
  // 内细框
  ctx.strokeStyle = "rgba(90,74,52,0.32)";
  ctx.lineWidth = c * 0.09;
  ctx.strokeRect(c * 0.62, c * 0.62, w - c * 1.24, h - c * 1.24);
  // 四角折角装饰
  ctx.strokeStyle = "rgba(90,74,52,0.5)";
  ctx.lineWidth = c * 0.16;
  const k = c * 2.2;
  for (const [px, py, sx, sy] of [
    [0, 0, 1, 1],
    [w, 0, -1, 1],
    [0, h, 1, -1],
    [w, h, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(px + sx * k, py);
    ctx.lineTo(px, py);
    ctx.lineTo(px, py + sy * k);
    ctx.stroke();
  }
  ctx.restore();
}

/** 地形 key 名（导出图例/调试用） */
export function terrainName(index: number): string {
  return TER_KEY[index] ?? "unknown";
}
