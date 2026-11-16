/**
 * 地貌纹理层（2.43.0）—— 全陆地底纹 + 草/沙/雪三带纹理，按气候带平铺。
 *
 * 【对齐什么】参考实现的一键成图按风格加载**面纹理五件套**（主纹理 / 草地 /
 * 沙漠 / 两极冰原 / 阴影层，`fpool/paints/*.png`），渲染时
 * `createPattern(img,"repeat")` 平铺、`source-atop` 裁进色块（证据见
 * `docs/review/map-vs-reference-render-analysis.md` 序 11 / E1~E5）。
 *
 * 【观感口径的两轮迭代（都由用户成图截图裁决）】
 *  - 第一轮：笔画式 tile（草茎 / **沙漠正弦波纹** / 雪粒）。用户判定
 *    「逆向目标根本没有波浪纹，质感比当前项目强很多」—— 根因是**方向错了**：
 *    参考的纹理是**有机的斑驳纸面**（大面积明暗晕染 + 细颗粒，像旧地图的
 *    上过色画布），不是"一笔一笔画出来的符号"。任何笔画式图案平铺后都会
 *    读出"重复的几何图案"（波纹/排线），与参考的质感是两种东西。
 *  - 第二轮（本版）：**无缝 fBm 值噪声斑驳** —— 逐像素双色调晕染（暗斑 +
 *    亮斑按噪声强度此消彼长）+ 高频颗粒 + 少量点噪。值噪声格点按周期回绕
 *    ⇒ tile 天然无缝；256² 的大 tile 让平铺周期在常用缩放下不可辨。
 *    （`grid_size:64` 的平铺口径随第一轮作废：那是参考的资源参数，我们要
 *    对齐的是观感 —— 64 世界单位的重复周期在 66% 缩放下肉眼可辨。）
 *
 * 【为什么程序生成而不是 AI 生成图 / 抓 png】参考的贴图本体拿不到（webroot
 * 资源）；斑驳噪声程序生成 ~几十 ms、无缝可保证、确定性可复现、不引入体积
 * 与版权负担 —— 与 `paperGrain.ts` 同一裁决。若后续观感仍不达标，再走
 * 「AI 生成纹理图入库」的路线（用户已授权）。
 *
 * 【分层结构】纹理带栅格由生成器随文档给出（`doc.terrainBands`，与布点用
 * 同一份格网与气候带判定），本模块只负责两件事：
 *   1. `makeTerrainTile` —— 四档各一张无缝 tile（底纹 + 三气候带，确定性）；
 *   2. `renderTerrainBandsCanvas` —— 先整画布铺底纹（海由渲染层的陆地掩膜
 *      裁掉），再把带栅格画成**横向合并 run** 的带纹理（pattern 以画布原点
 *      为锚跨格连续，无格缝）。
 *
 * MapCanvas 把这张画布变成一个 Sprite，压在区块填充之上、折线与素材之下，
 * 用陆地曲线做掩膜（与区块层同一条 `drawLandPath` —— "哪里是陆地"只有一个事实源）。
 *
 * 纯函数部分（`planTerrainRuns` / `zoneTextureKind`）可直接单测；
 * 画布函数在 jsdom（无 2D 上下文）返回 null，调用方必须容忍。
 */

import { mulberry32 } from "./domain/terrain-assets";
import type { SpriteZone } from "./domain/zones";
import type { TerrainBandGrid } from "./types";

/**
 * tile 边长（世界单位 = 像素）。
 *
 * 256 而非参考的 64：斑驳噪声的主波长 ~32~64px、叠加平铺周期后，64² 的
 * tile 在常用缩放下能读出"重复感"；256² 的无缝噪声让周期不可辨。成本
 * （每档 65k 像素 × 5 个倍频程，只在生成期算一次）可忽略。
 */
export const TEX_TILE_SIZE = 256;

/**
 * 全陆地底纹的不透明度（对齐参考 E5 的**块级 pattern**：`fpool/lines/*.png`
 * 以 `source-atop` 叠进每个国家块 —— 这层与气候带无关、块块都有）。
 *
 * 2.43.0 第三轮下调 0.55 → 0.35：AI 纸面纹理（`land-paper.png`，multiply
 * 叠加）接管了"高频质感"，程序底纹只保留"低频晕染"，两层都满配会糊成脏灰。
 */
export const TEX_BASE_ALPHA = 0.45;

/**
 * 暖色罩（整片陆地 multiply）：把各家色相统一压进"旧纸上的颜料"。
 *
 * 参考成图里陆地不管哪一国，底色都带一层共同的暖陶土调 —— 这正是"同一张
 * 旧地图"的整体感来源。0.16 的暖褐乘算只压色相不改明度层次。
 */
export const TEX_GLAZE_ALPHA = 0.16;
export const TEX_GLAZE_COLOR = "#d8b98e";

/**
 * AI 纸面纹理（`land-paper.png`）的叠加不透明度。
 *
 * 它是 **multiply** 混合（⚠️ 不能用 overlay：overlay 在浅色底上会往白里推，
 * 实测逐版都发白 —— 这是"一坨屎"那几版的直接原因）。纹理已预处理为
 * **中性灰阶、均值 0.86、对比 ×2**：乘算后整片压暗 ~13%，纤维与斑驳按像素
 * 起伏 —— 0.9 是"看得见颗粒但不脏"的实测值。
 */
export const LAND_PAPER_ALPHA = 0.9;

/** 纹理档；`null`（带映射）= 该带不铺带纹理（仍有全陆地底纹） */
export type TerrainTextureKind = "base" | "grass" | "desert" | "snow";

/** 气候带 → 纹理档的唯一映射（主带 `core` 不铺带纹理 —— 参考的主带没有面纹理） */
export function zoneTextureKind(zone: SpriteZone): TerrainTextureKind | null {
  switch (zone) {
    case "grass":
      return "grass";
    case "desert":
      return "desert";
    case "snow":
      return "snow";
    default:
      return null;
  }
}

/** 一片「气候带晕染团」：格心 + 抖动后的圆心、半径、底色 */
export interface TerrainBlob {
  kind: TerrainTextureKind;
  /** 画布内像素坐标（画布原点 = 栅格原点 = 陆地包围盒左上角） */
  x: number;
  y: number;
  r: number;
}

/** 整数格点的确定性哈希（0~1），用于晕染团圆心抖动（零 rng 消耗） */
function cellJitter(col: number, row: number, salt: number): number {
  const s = Math.sin(col * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 带栅格 → 晕染团计划（纯函数，可单测）。
 *
 * 【为什么不是矩形块】2.43.0 前两版按"同一带的横向格区间"填矩形 —— 用户成图
 * 截图里那些**方块补丁**就是 run 的边界：格网对齐的直角边在柔和色块上极其
 * 刺眼。改为**每格一个软边径向晕染**（圆心按格点哈希抖动 ±18% 格宽、半径
 * 0.8 格），相邻同带格自然融合成不规则色斑，带与带之间是渐变过渡 —— 观感
 * 是"水彩晕开"，不是"贴纸拼块"。
 */
export function planTerrainBlobs(bands: TerrainBandGrid): TerrainBlob[] {
  const blobs: TerrainBlob[] = [];
  const { cols, rows, cellSize, zones } = bands;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const zone = zones[row * cols + col];
      const kind = zone ? zoneTextureKind(zone) : null;
      if (!kind) continue;
      const jx = (cellJitter(col, row, 1) - 0.5) * 0.36 * cellSize;
      const jy = (cellJitter(col, row, 2) - 0.5) * 0.36 * cellSize;
      blobs.push({
        kind,
        x: (col + 0.5) * cellSize + jx,
        y: (row + 0.5) * cellSize + jy,
        r: cellSize * (0.72 + cellJitter(col, row, 3) * 0.12),
      });
    }
  }
  return blobs;
}

/** 各档固定 seed：同档同图（跨会话可复现，与 paperGrain 同纪律） */
const TILE_SEEDS: Record<TerrainTextureKind, number> = {
  base: 0x3f2d18,
  grass: 0x6ea4d1,
  desert: 0x5a3e21,
  snow: 0x8fa3b8,
};

/** 每档的斑驳配色：暗斑 / 亮斑（亮斑是"纸面反光"，不是颜色）+ 峰值 alpha */
const TILE_TONES: Record<
  TerrainTextureKind,
  { dark: readonly [number, number, number]; light: readonly [number, number, number]; peak: number }
> = {
  base: { dark: [92, 80, 62], light: [255, 250, 236], peak: 0.5 },
  grass: { dark: [84, 104, 50], light: [198, 210, 142], peak: 0.5 },
  desert: { dark: [148, 114, 64], light: [255, 240, 208], peak: 0.5 },
  snow: { dark: [118, 132, 148], light: [255, 255, 255], peak: 0.45 },
};

/**
 * 晕染团的中心不透明度。
 *
 * 团与团会重叠（同带相邻格半径 0.72~0.84 格），重叠处自然加深 ⇒ 大致是
 * "一带之内 0.2~0.45、带心最实、向带缘渐隐"的密度分布。比这更高会盖住
 * 区块色相（用户判定"一坨屎"的那版就是色块被纹理压花）。
 */
export const BLOB_ALPHA = 0.34;

/** 每档叠加的稀疏点噪（数量 / 颜色对 / 半径）：给斑驳加"牙齿" */
const TILE_SPECKS: Record<
  TerrainTextureKind,
  { count: number; colors: [string, string]; rMax: number }
> = {
  base: { count: 90, colors: ["rgba(84,72,56,0.3)", "rgba(255,252,242,0.32)"], rMax: 1.1 },
  grass: { count: 70, colors: ["rgba(70,90,40,0.4)", "rgba(160,180,100,0.35)"], rMax: 1.2 },
  desert: { count: 60, colors: ["rgba(128,96,52,0.4)", "rgba(235,214,170,0.35)"], rMax: 1.2 },
  snow: { count: 80, colors: ["rgba(140,154,170,0.4)", "rgba(255,255,255,0.5)"], rMax: 1.4 },
};

/**
 * 无缝值噪声：`cells × cells` 个随机格点，格点下标按周期回绕。
 *
 * 双线性插值 + smoothstep（五次曲线，二阶导连续，没有格点痕）。返回的
 * 取样函数在 `[0,size)` 上任意坐标取值 0~1，且 `f(x) === f(x + size)` ——
 * tile 平铺天然无缝，不需要 9 偏移重画那套笔画时代的补丁。
 */
function makeSeamlessNoise(
  size: number,
  cells: number,
  rng: () => number,
): (x: number, y: number) => number {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();
  const wrap = (v: number): number => ((v % cells) + cells) % cells;
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number): number => {
    const gx = (x / size) * cells;
    const gy = (y / size) * cells;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = fade(gx - x0);
    const fy = fade(gy - y0);
    const v00 = lattice[wrap(y0) * cells + wrap(x0)];
    const v10 = lattice[wrap(y0) * cells + wrap(x0 + 1)];
    const v01 = lattice[wrap(y0 + 1) * cells + wrap(x0)];
    const v11 = lattice[wrap(y0 + 1) * cells + wrap(x0 + 1)];
    return v00 + (v10 - v00) * fx + (v01 - v00) * fy + (v00 - v10 - v01 + v11) * fx * fy;
  };
}

/**
 * 5 个倍频程的 fBm：主波长 tile/4（大斑）到 tile/256（细颗粒），振幅逐层
 * 减半。归一化后 0~1、集中在 0.5 附近 —— 正是"斑驳"的形态：大部分纸面
 * 平缓、少数区域晕出明显的明暗团。
 */
function makeFbm(
  size: number,
  rng: () => number,
): (x: number, y: number) => number {
  const octaves = [
    makeSeamlessNoise(size, 4, rng),
    makeSeamlessNoise(size, 8, rng),
    makeSeamlessNoise(size, 16, rng),
    makeSeamlessNoise(size, 32, rng),
    makeSeamlessNoise(size, 64, rng),
  ];
  const amps = [1, 0.5, 0.25, 0.125, 0.0625];
  const total = amps.reduce((s, a) => s + a, 0);
  return (x: number, y: number): number => {
    let sum = 0;
    for (let i = 0; i < octaves.length; i += 1) sum += octaves[i](x, y) * amps[i];
    return sum / total;
  };
}

/**
 * 画一张斑驳 tile（默认 256²、透明底、双色调晕染 + 点噪）。
 *
 * 【逐像素双色调】`n = fbm`，`n > 0.5` 出亮斑（越亮越实）、`n < 0.5` 出暗斑
 * （越暗越实），0.5 附近透明 —— 一次遍历同时得到"明暗此消彼长"的有机晕染，
 * 正是参考"旧图上过色的画布"的形态。亮斑/暗斑颜色见 `TILE_TONES`：
 *   - 底纹 = 中性暖褐/米白（不偏色，整陆地铺 —— 对齐块级 pattern E5）；
 *   - 草地 = 深橄榄 / 亮草黄；沙漠 = 深沙褐 / 淡沙金（**没有波纹** ——
 *     参考根本没有波浪纹，第一轮的正弦弧线随笔画方案一起删除）；
 *   - 冰原 = 灰蓝 / 白。
 * 透明底：区块色从底下透出来，纹理只负责"质感"，不负责"颜色"。
 */
export function makeTerrainTile(
  kind: TerrainTextureKind,
  size = TEX_TILE_SIZE,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const getCtx = (): CanvasRenderingContext2D | null => {
    try {
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  };
  const ctx = getCtx();
  if (!ctx) return null;

  const rng = mulberry32(TILE_SEEDS[kind]);
  const tone = TILE_TONES[kind];
  const fbm = makeFbm(size, rng);

  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = (fbm(x, y) - 0.5) * 2; // -1（最暗）~ 1（最亮）
      const a = Math.min(1, Math.abs(t) * 1.6) * tone.peak;
      if (a < 0.01) continue;
      const [r, g, b] = t > 0 ? tone.light : tone.dark;
      const o = (y * size + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  // 点噪：斑驳上再撒稀疏小点（3×3 平铺偏移各画一遍 ⇒ 跨界无缝）
  const speck = TILE_SPECKS[kind];
  for (let i = 0; i < speck.count; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 0.4 + rng() * speck.rMax;
    ctx.fillStyle = speck.colors[rng() < 0.5 ? 0 : 1];
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return canvas;
}

/**
 * 带栅格 → 一整张世界尺寸的纹理画布。
 *
 * 画布原点 = 栅格原点（陆地包围盒左上角），调用方把 Sprite 摆在
 * `(bands.x, bands.y)` 即对齐世界坐标。所有格共用各自的 pattern（以画布
 * 原点为锚）⇒ 跨格连续、无周期性格缝。
 *
 * 【先铺全陆地底纹、再叠晕染团】底纹（`base` 档）整画布铺 —— 画布覆盖的是
 * 陆地包围盒，海的部分由渲染层的陆地掩膜裁掉，所以"整画布铺"天然等价于
 * "陆地全铺"（与区块层同一条 `drawLandPath` 事实源）。气候带以**软边晕染团**
 * 叠上去（见 `planTerrainBlobs`），主带/平原也有纸面颗粒、不再平涂。
 *
 * 返回 `null` 的情形（调用方必须容忍）：环境无 2D 上下文（jsdom）或栅格为空。
 */
export function renderTerrainBandsCanvas(bands: TerrainBandGrid): HTMLCanvasElement | null {
  if (bands.cols === 0 || bands.rows === 0) return null;
  if (typeof document === "undefined") return null;
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return null;

  const w = Math.max(1, Math.ceil(bands.cols * bands.cellSize));
  const h = Math.max(1, Math.ceil(bands.rows * bands.cellSize));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const getCtx = (): CanvasRenderingContext2D | null => {
    try {
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  };
  const ctx = getCtx();
  if (!ctx) return null;

  const tiles = new Map<TerrainTextureKind, CanvasPattern | null>();
  const patternOf = (kind: TerrainTextureKind): CanvasPattern | null => {
    let pat = tiles.get(kind);
    if (pat === undefined) {
      const tile = makeTerrainTile(kind);
      pat = tile ? ctx.createPattern(tile, "repeat") : null;
      tiles.set(kind, pat);
    }
    return pat;
  };

  // ① 全陆地底纹（海由渲染层的陆地掩膜裁掉）
  const basePat = patternOf("base");
  if (basePat) {
    ctx.save();
    ctx.globalAlpha = TEX_BASE_ALPHA;
    ctx.fillStyle = basePat;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // ①' 暖色罩：整片陆地统一到"旧纸上的颜料"（参考成图里各国共有的暖陶土调）
  ctx.save();
  ctx.globalAlpha = TEX_GLAZE_ALPHA;
  ctx.fillStyle = TEX_GLAZE_COLOR;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // ② 气候带晕染团（软边径向渐变，格与格之间自然融合 —— 没有矩形边界）
  for (const blob of planTerrainBlobs(bands)) {
    const [r, g, b] = TILE_TONES[blob.kind].dark;
    const grad = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
    grad.addColorStop(0, `rgba(${r},${g},${b},${BLOB_ALPHA})`);
    grad.addColorStop(0.55, `rgba(${r},${g},${b},${BLOB_ALPHA * 0.65})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(blob.x - blob.r, blob.y - blob.r, blob.r * 2, blob.r * 2);
  }
  return canvas;
}
