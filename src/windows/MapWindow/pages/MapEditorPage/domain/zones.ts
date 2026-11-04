/**
 * 地貌带（素材体系的第三轴，见 docs/review/map-vs-reference-render-analysis.md §6 P0-1）
 *
 * **地形语义回答「画什么」，地貌带回答「用哪一族画风」。**
 * 同样是 `mountain` 配方，北境该长雪峰、腹地该长连绵山岭、南缘该长风蚀石林；
 * 同样是 `forest`，雪原不长阔叶树、沙漠不长针叶林。参考实现把山体素材拆成
 * 主池 / 丘陵 / 沙漠 / 雪原四池，按纬度取用 —— 这就是「同一张图里气候有差别」
 * 的全部机制，也是本项目「一张图处处同款」的主因之一。
 *
 * 分带锚点取自参考实现的两个判据（`r < H/4`、`r > 3H/4`）：北端 1/4 为雪带、
 * 南端 1/4 为沙带，中间再按中点切成主带 / 草带。**边界数值是重建值**，
 * 不是从压缩代码里读出的常量（见 review §7 L-2 同类局限）。
 *
 * 纯枚举 + 分带函数：**无 IO、无 React、无 PIXI**，不 import 任何模块。
 */

/**
 * 地貌带。
 *
 * - `snow`  雪带（北端）：雪峰 / 雪松 / 雪丘
 * - `core`  主带（腹地）：**同时是全带通用池**——人文、港渡、遗迹只标 core，
 *   它们在任何气候下都成立；地形专属的 core 素材在缺料时也靠它兜底
 * - `grass` 草带（南缘腹地）：圆丘 / 梯田 / 阔叶 / 疏树
 * - `desert` 沙带（南端）：沙丘 / 绿洲 / 风蚀岩 / 石林
 */
export type SpriteZone = "snow" | "core" | "grass" | "desert";

/** 全部地貌带（自北向南，遍历与校验用） */
export const SPRITE_ZONES: readonly SpriteZone[] = ["snow", "core", "grass", "desert"];

/** 中文名（生成摘要 / 面板展示） */
export const ZONE_LABELS: Record<SpriteZone, string> = {
  snow: "雪带",
  core: "主带",
  grass: "草带",
  desert: "沙带",
};

/**
 * 纬度分带阈值（相对**陆地纵向范围**的 0~1 比例，0 = 最北）。
 *
 * 【为什么相对陆地而不是相对纸张】陆地只占纸面中部 55%~70%，按纸张分带会把
 * 雪带整个压在海上，南北两头永远用不到 —— 分带必须跟着陆地走。
 */
export const ZONE_BAND_EDGES = { snow: 0.25, core: 0.52, desert: 0.75 } as const;

/** 是否为合法地貌带（外部输入 / 存档收敛口） */
export function isSpriteZone(value: unknown): value is SpriteZone {
  return typeof value === "string" && (SPRITE_ZONES as readonly string[]).includes(value);
}

/**
 * 按纬度取带。
 *
 * @param y      世界坐标 y（向下为正）
 * @param top    陆地包围盒上沿
 * @param height 陆地包围盒高度（≤0 视为退化，返回主带）
 */
export function zoneAtY(y: number, top: number, height: number): SpriteZone {
  if (!(height > 0)) return "core";
  const t = (y - top) / height;
  if (t < ZONE_BAND_EDGES.snow) return "snow";
  if (t < ZONE_BAND_EDGES.core) return "core";
  if (t < ZONE_BAND_EDGES.desert) return "grass";
  return "desert";
}
