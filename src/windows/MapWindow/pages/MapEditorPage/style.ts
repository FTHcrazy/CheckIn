/**
 * 全局风格预设（B4 / PRD §6.4）
 *
 * 【为什么是"一套数据出多种气质"】地图的骨相（海岸、区块、素材、地名）已经由
 * 前面几批定型，气质只差一层**色彩映射**。用 `ColorMatrixFilter` 做线性变换，
 * 三档风格共用一个场景图、一份烘焙纹理，切换成本是一次滤镜赋值 —— 除了海岸要
 * 重烘一遍（滤镜烘进纹理比逐帧过滤镜便宜，见 `coastBake.ts`）。
 *
 * 【为什么矩阵是常量而不是运行时算】三档的映射必须**可断言**：jsdom 里连 WebGL
 * 都没有，若风格由 `f.saturate().brightness()` 这类就地变换累积出来，测试只能
 * 去 replicate pixi 的内部实现。把 `saturate ∘ brightness` 先折成 20 元矩阵常量，
 * 断言就退化成"乘一遍、看结果落在哪个区间"，与渲染后端完全解耦。
 */
import { ColorMatrixFilter } from "pixi.js";
import type { ColorMatrix } from "pixi.js";
import type { MapStyle } from "./types";

/** 工具栏风格下拉的选项（顺序即界面顺序，"原色"永远第一且是默认） */
export const MAP_STYLES: ReadonlyArray<{ key: MapStyle; label: string }> = [
  { key: "none", label: "原色" },
  { key: "parchment", label: "羊皮纸" },
  { key: "ink", label: "墨色" },
];

/**
 * 羊皮纸矩阵（PRD §6.4 原值，行主序）。
 *
 * `R' = a·R + b·G + c·B + d·offset`，四行分别是 R' / G' / B' / A'。
 * 结构上是"去饱和 + 偏暖"：红色通道吃进一部分绿蓝（0.62/0.20/0.10），
 * 蓝色通道只留 0.52，于是纯白 (1,1,1) 映射成 (0.98, 0.88, 0.76) —— 米黄纸面。
 */
export const STYLE_MATRIX_PARCHMENT: readonly number[] = [
  0.62, 0.2, 0.1, 0, 0.06,
  0.16, 0.58, 0.1, 0, 0.04,
  0.08, 0.14, 0.52, 0, 0.02,
  0, 0, 0, 1, 0,
];

/**
 * 墨色矩阵 = `brightness(0.95) ∘ saturate(0.15)`（PRD §6.4 的两步就地变换）。
 *
 * 【怎么来的】先按 SVG 的 saturate 公式展开（`a = 1 - s = 0.85`）：
 *   sr = 0.213a = 0.18105，sg = 0.715a = 0.60775，sb = 0.072a = 0.0612
 *   行 i 的对角项再加 s = 0.15
 * 再把前三行整体乘 0.95（brightness 就是对角缩放，与 saturate 的乘积可交换地
 * 折进同一行）。于是：
 *   · 纯白 → (0.95, 0.95, 0.95)：**只略暗、不变色**（白本来就是无彩色）；
 *   · 纯红 → (0.31, 0.17, 0.17)：明显发灰，这就是"墨色"的来源。
 * 【自检】三行非偏移项之和都应等于 0.95 —— 这正好是"白色不被染色"的充要条件。
 */
export const STYLE_MATRIX_INK: readonly number[] = [
  0.3145, 0.5774, 0.0581, 0, 0,
  0.172, 0.7199, 0.0581, 0, 0,
  0.172, 0.5774, 0.2006, 0, 0,
  0, 0, 0, 1, 0,
];

/**
 * 风格 → 20 元矩阵（`null` = 不做任何映射）。
 *
 * 单独暴露纯函数版本：UI 要画"风格色卡"、测试要断言"纯白映射到哪"，
 * 都不该为此去 new 一个滤镜（那会把 `Filter` 的生命周期管到调用方头上）。
 */
export function styleMatrixOf(style: MapStyle): readonly number[] | null {
  if (style === "parchment") return STYLE_MATRIX_PARCHMENT;
  if (style === "ink") return STYLE_MATRIX_INK;
  return null;
}

/**
 * 造一个风格滤镜；`"none"` 返回 `null`（= 调用方赋空数组，零成本）。
 *
 * ⚠️ **每次调用都返回新实例**。切风格时必须在旧实例上 `destroy()` 再赋新的：
 * 在旧滤镜上累乘（`saturate` 之后再 `saturate`）会让"原色 → 墨色 → 原色"
 * 回不到原色 —— 矩阵变换不可逆，来回切几次画面就废了。
 */
export function filterFor(style: MapStyle): ColorMatrixFilter | null {
  const matrix = styleMatrixOf(style);
  if (!matrix) return null;
  const filter = new ColorMatrixFilter();
  // pixi 的 `matrix` 是定长 20 元数组（`ArrayFixed<number, 20>`），而我们对外
  // 暴露的是 `readonly number[]` —— 便于用 `every`/`map` 断言。这里先摊平成
  // 可变数组再转型：长度靠上面的常量与单测共同保证（少写一个数就是全黑）。
  filter.matrix = [...matrix] as unknown as ColorMatrix;
  return filter;
}
