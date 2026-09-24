/**
 * 比例尺 / 尺寸标注换算（PRD novel-map §4 画布浮层 + 状态条「尺寸标注」）
 *
 * 为什么单独成文件：比例尺是**随缩放变化的纯数学**。旧实现把刻度条写死成
 * 「150px 长的一根线 + 固定文案」，于是缩放到 4× 时它还在标同一个里程 ——
 * 用户反馈的「当地图缩放时，地图尺寸标注没变化」就是它。
 *
 * 现在的口径：刻度条的**屏幕长度**保持在 ~maxPx（视觉稳定），而它代表的里程
 * 取「1/2/5 × 10ⁿ 里」的整齐值，随缩放逐档变化（缩得越大 → 里程越小、越精细）。
 *
 * 纯函数、不 import React，可独立单测（map-scale.test.ts）。
 */

import { LI_PER_CELL } from "./map-terrain";

/** 比例尺刻度：屏幕长度 → 里程 */
export interface ScaleBar {
  /** 主刻度条在屏幕上的长度（CSS px），恒 ≤ maxPx */
  px: number;
  /** 该长度代表的里程（里） */
  li: number;
  /** 刻度等分段数（2 = 中间一道半刻度；4 = 四等分） */
  segments: number;
  /** 展示文案，如「200 里」 */
  label: string;
}

/** 屏幕像素 / 里（`scale` = 视口缩放，screen px 每世界像素；`cell` = 每格世界像素） */
export function pxPerLi(scale: number, cell: number): number {
  if (!Number.isFinite(scale) || !Number.isFinite(cell) || scale <= 0 || cell <= 0) return 0;
  return (scale * cell) / LI_PER_CELL;
}

/**
 * 求比例尺：取「不超过 maxPx 的最大整齐里程」。
 * @param scale 视口缩放（screen px / world px）
 * @param cell 每格世界像素（BuiltWorld.cell）
 * @param maxPx 刻度条目标屏幕长度
 */
export function scaleBarFor(scale: number, cell: number, maxPx = 150): ScaleBar {
  const ppl = pxPerLi(scale, cell);
  if (ppl <= 0 || maxPx <= 0) return { px: 0, li: 0, segments: 2, label: "—" };
  const li = niceFloor(maxPx / ppl);
  if (li <= 0) return { px: 0, li: 0, segments: 2, label: "—" };
  const px = li * ppl;
  const lead = String(li).replace(".", "").replace(/^0+/, "")[0] ?? "1";
  return { px, li, segments: lead === "1" || lead === "5" ? 2 : 4, label: formatLi(li) };
}

/**
 * 当前视口跨度的里程（里）—— 状态条「视野」用，**随缩放实时变化**，
 * 是「尺寸标注要跟着缩放走」的第二个锚点。
 */
export function viewExtentLi(
  scale: number,
  cell: number,
  viewW: number,
  viewH: number,
): { w: number; h: number } {
  const ppl = pxPerLi(scale, cell);
  if (ppl <= 0 || !(viewW > 0) || !(viewH > 0)) return { w: 0, h: 0 };
  return { w: viewW / ppl, h: viewH / ppl };
}

/** 向下取「1 / 2 / 5 × 10ⁿ」的整齐值：刻度条的刻度必须是整数感，抖动会显廉价 */
export function niceFloor(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (v < 1) return Number(v.toFixed(2));
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const nice = f >= 5 ? 5 : f >= 2 ? 2 : 1;
  return nice * base;
}

/** 里程文案：≥1 万里 用「万」，其余带千分位 */
export function formatLi(li: number): string {
  if (!(li > 0)) return "—";
  if (li >= 10000) return `${trim(li / 10000)} 万里`;
  if (li < 1) return `${trim(li)} 里`;
  return `${li.toLocaleString("zh-CN")} 里`;
}

function trim(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}
