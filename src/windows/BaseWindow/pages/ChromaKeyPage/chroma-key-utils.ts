/**
 * 色键抠图的纯函数层（不依赖 DOM，可在 vitest 里直接验证像素）。
 *
 * 判定口径与参考实现一致：**逐通道差值的最大值**落在容差半径内即视为背景色。
 * 它等价于「r/g/b 三个闭区间同时命中」，但写成 max·abs 之后多了一个自然的位置
 * 放软边：差值离半径越近，alpha 越小，边缘不会留下一条硬切的锯齿。
 */

import {
  clampByte,
  toleranceRadius,
  rgbToHex,
  hexToRgb,
  formatRgb,
  type RgbColor,
} from "@/shared/utils/color";

// 颜色工具已上移到 shared（图片/证件照页共用一套判定口径），这里原样转发，
// 页面内既有 import 与测试不需要跟着改。
export { clampByte, toleranceRadius, rgbToHex, hexToRgb, formatRgb };
export type { RgbColor };

export interface ChromaKeyOptions {
  key: RgbColor;
  /** 容差 0-100（百分比，映射到 0-255 的逐通道允许差） */
  tolerance: number;
  /** 软边 0-100（0 = 硬切，与参考实现完全一致；>0 是本项目的增强项） */
  feather: number;
}

/** 抠图默认色键：纯绿（视频抠像的通行做法，与人像肤色差异最大） */
export const DEFAULT_KEY_COLOR: RgbColor = { r: 0, g: 255, b: 0 };
export const DEFAULT_TOLERANCE = 15;
export const DEFAULT_FEATHER = 0;

export interface ChromaKeyResult {
  /** 被完全抠掉的像素数 */
  removed: number;
  /** 被软边部分透明的像素数 */
  feathered: number;
}

/**
 * 就地修改 RGBA 像素：命中色键的像素 alpha 归零，软边区间按距离线性衰减。
 *
 * 不动 RGB 三通道——这是刻意的。参考实现同样只改 alpha，因为半透明边缘保留
 * 原色才是合成时的正确做法（去溢色属于另一个开关，不在本页范围内）。
 */
export function applyChromaKey(
  data: Uint8ClampedArray,
  options: ChromaKeyOptions,
): ChromaKeyResult {
  const keyR = clampByte(options.key.r);
  const keyG = clampByte(options.key.g);
  const keyB = clampByte(options.key.b);
  const radius = toleranceRadius(options.tolerance);
  const featherRadius = toleranceRadius(options.feather);
  const outer = radius + featherRadius;

  let removed = 0;
  let feathered = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    // 本来就透明的像素不参与统计，否则「去掉多少像素」会被上一次结果叠加放大
    if (alpha === 0) continue;

    const diff = Math.max(
      Math.abs(data[i] - keyR),
      Math.abs(data[i + 1] - keyG),
      Math.abs(data[i + 2] - keyB),
    );

    if (diff <= radius) {
      data[i + 3] = 0;
      removed += 1;
      continue;
    }

    if (featherRadius > 0 && diff <= outer) {
      const factor = (diff - radius) / featherRadius;
      data[i + 3] = clampByte(alpha * factor);
      feathered += 1;
    }
  }

  return { removed, feathered };
}

/** 命中比例（0-1），用于给用户一个「抠掉了多少」的量化反馈 */
export function removedRatio(removed: number, width: number, height: number): number {
  const total = width * height;
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, removed / total));
}

/** 导出文件名：`照片.png` → `照片-抠图.png`（导出恒为 PNG，透明通道必须保住） */
export function buildCutoutName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base || "image"}-抠图.png`;
}
