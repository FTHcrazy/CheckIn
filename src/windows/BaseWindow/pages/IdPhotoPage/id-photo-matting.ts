/**
 * 人像背景抠除（纯函数，输入输出都是 RGBA 字节，可在 vitest 里直接验证）。
 *
 * 为什么不用色键那套「指定颜色 → 全图命中」：
 * 色键会把**人像内部**同色区域一起抠掉（白衬衫遇到白底就没了）。证件照要的
 * 是「从画面四边连通出去的那片背景」，所以这里做**边界漫水填充**：
 * 种子只取四条边上接近主色的像素，再向内扩散，被前景围住的同色区域不受影响。
 *
 * 参考页的人像分割在服务端（`/apiuser/process_photo`），前端拿不到算法；
 * 本模块是本项目的自研实现，仅共享其「透明底 + 前端合成底色」的产品思路。
 */

import {
  clampByte,
  rgbToHex,
  toleranceRadius,
  type RgbColor,
} from "@/shared/utils/color";
import type { MatteStats } from "./id-photo-types";

/** 超过这个像素数就不再漫水（Int32Array 栈会吃掉百 MB 级内存） */
const MAX_PIXELS = 40_000_000;

export interface MattingOptions {
  /** 背景容差 0-100（百分比 → 逐通道允许差） */
  tolerance: number;
  /** 边缘羽化半径（像素） */
  feather: number;
  /** 去色边强度 0-1 */
  decontaminate: number;
}

export interface MattingOutput {
  /** 就地修改后的副本，背景 alpha = 0 */
  data: Uint8ClampedArray;
  stats: MatteStats;
}

/**
 * 四条边的中位数色。
 *
 * 用中位数而不是平均值：人像肩膀常贴着底边，平均值会被衣服拉偏，
 * 中位数在这种情况下仍落在背景那一侧（背景通常占边长的多数）。
 */
function borderMedian(data: Uint8ClampedArray, width: number, height: number): RgbColor {
  const buckets = [
    new Uint32Array(256),
    new Uint32Array(256),
    new Uint32Array(256),
  ];
  let count = 0;

  const sample = (x: number, y: number): void => {
    const i = (y * width + x) * 4;
    if (data[i + 3] === 0) return;
    buckets[0][data[i]] += 1;
    buckets[1][data[i + 1]] += 1;
    buckets[2][data[i + 2]] += 1;
    count += 1;
  };

  for (let x = 0; x < width; x += 1) {
    sample(x, 0);
    if (height > 1) sample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sample(0, y);
    if (width > 1) sample(width - 1, y);
  }

  if (count === 0) return { r: 255, g: 255, b: 255 };

  const median = (histogram: Uint32Array): number => {
    const half = count / 2;
    let seen = 0;
    for (let value = 0; value < 256; value += 1) {
      seen += histogram[value];
      if (seen >= half) return value;
    }
    return 255;
  };

  return {
    r: median(buckets[0]),
    g: median(buckets[1]),
    b: median(buckets[2]),
  };
}

/**
 * 边界连通性漫水：只有从四边出发、逐步命中背景色的像素才算背景。
 *
 * 采用「与边界主色比较」而不是「与父像素比较」——后者会在渐变背景上逐步
 * 漂移，一路吃到人像里去；证件照背景本来就均匀，固定基准更安全。
 */
function floodBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  base: RgbColor,
): { mask: Uint8Array; removed: number; seeds: number; border: number } {
  const total = width * height;
  const mask = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  let border = 0;

  const accept = (index: number): boolean => {
    const i = index * 4;
    if (data[i + 3] === 0) return false;
    const diff = Math.max(
      Math.abs(data[i] - base.r),
      Math.abs(data[i + 1] - base.g),
      Math.abs(data[i + 2] - base.b),
    );
    return diff <= radius;
  };

  const push = (index: number): void => {
    if (visited[index]) return;
    visited[index] = 1;
    if (!accept(index)) return;
    stack[top] = index;
    top += 1;
  };

  for (let x = 0; x < width; x += 1) {
    border += 1;
    push(x);
    if (height > 1) {
      border += 1;
      push((height - 1) * width + x);
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    border += 1;
    push(y * width);
    if (width > 1) {
      border += 1;
      push(y * width + width - 1);
    }
  }

  // 种子数：初始入栈（= 通过 accept 的边界像素）；后续扩散会继续抬高 top，先取快照
  const seeds = top;
  let removed = 0;

  while (top > 0) {
    top -= 1;
    const index = stack[top];
    if (mask[index]) continue;
    mask[index] = 1;
    removed += 1;

    const x = index % width;
    const y = (index - x) / width;

    if (x > 0) push(index - 1);
    if (x + 1 < width) push(index + 1);
    if (y > 0) push(index - width);
    if (y + 1 < height) push(index + width);
  }

  // seeds 统计的是初始入栈量，后续扩散会继续抬高 top，这里用闭包外的快照
  return { mask, removed, seeds, border };
}

/**
 * 前景像素到最近背景像素的曼哈顿距离（两遍 chamfer 扫描，O(n) 且无额外队列）。
 *
 * 羽化靠它：距离 1 的像素接近全透明，到 `feather + 1` 才完全不透明，
 * 于是边缘得到一条可控宽度的过渡带，换底色后不会出现剪纸般的硬边。
 */
function distanceToBackground(
  mask: Uint8Array,
  width: number,
  height: number,
  feather: number,
): Uint8Array {
  const total = width * height;
  const dist = new Uint8Array(total);
  const cap = Math.min(254, feather + 1);

  for (let i = 0; i < total; i += 1) dist[i] = mask[i] ? 0 : cap;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let best = dist[i];
      if (x > 0 && dist[i - 1] + 1 < best) best = dist[i - 1] + 1;
      if (y > 0 && dist[i - width] + 1 < best) best = dist[i - width] + 1;
      dist[i] = best;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let best = dist[i];
      if (x + 1 < width && dist[i + 1] + 1 < best) best = dist[i + 1] + 1;
      if (y + 1 < height && dist[i + width] + 1 < best) best = dist[i + width] + 1;
      dist[i] = best;
    }
  }

  return dist;
}

/**
 * 抠出人像，返回透明前景。
 *
 * 顺序：边界主色 → 漫水 → 羽化 → 去色边。去色边放在羽化之后，因为
 * 它需要 alpha 才能反推「这个像素里有多少是原来的底色」。
 */
export function matteBackground(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  options: MattingOptions,
): MattingOutput {
  const data = new Uint8ClampedArray(source);
  const total = width * height;

  if (total <= 0 || total > MAX_PIXELS) {
    return {
      data,
      stats: { removedRatio: 0, feathered: 0, borderColor: "#FFFFFF", seedRatio: 0 },
    };
  }

  const radius = toleranceRadius(options.tolerance);
  const base = borderMedian(data, width, height);
  const { mask, removed, seeds, border } = floodBackground(
    data,
    width,
    height,
    radius,
    base,
  );

  const feather = Math.max(0, Math.min(20, Math.round(options.feather)));
  const dist = feather > 0 ? distanceToBackground(mask, width, height, feather) : null;

  const strength = Math.max(0, Math.min(1, options.decontaminate));
  let feathered = 0;

  for (let index = 0; index < total; index += 1) {
    const i = index * 4;
    if (data[i + 3] === 0) continue;

    if (mask[index]) {
      data[i + 3] = 0;
      continue;
    }

    // 羽化：距离越近越透明
    let alpha = 255;
    if (dist) {
      const d = dist[index];
      if (d <= feather) {
        alpha = clampByte((255 * d) / (feather + 1));
        if (alpha < 255) feathered += 1;
      }
    }
    data[i + 3] = clampByte((data[i + 3] * alpha) / 255);

    // 去色边：边缘像素是「前景 over 原底色」的混合，按 alpha 反解纯前景色。
    // 透明度越低，反解的除数越小、越容易把噪声放大成色块，所以强度跟着 alpha 折减。
    if (strength > 0 && data[i + 3] > 8 && data[i + 3] < 255) {
      const a = data[i + 3] / 255;
      const inverse = 1 - a;
      const local = strength * Math.min(1, a * 2);
      const restore = (channel: number, backdrop: number): number => {
        const pure = (channel - backdrop * inverse) / a;
        return clampByte(channel * (1 - local) + pure * local);
      };
      data[i] = restore(data[i], base.r);
      data[i + 1] = restore(data[i + 1], base.g);
      data[i + 2] = restore(data[i + 2], base.b);
    }
  }

  return {
    data,
    stats: {
      removedRatio: total > 0 ? removed / total : 0,
      feathered,
      borderColor: rgbToHex(base),
      seedRatio: border > 0 ? Math.min(1, seeds / border) : 0,
    },
  };
}

/** 边界主色是否为「够纯」的背景（供 UI 决定要不要提示「换张纯底照片」） */
export function isPlainBackdrop(seedRatio: number): boolean {
  return seedRatio >= 0.5;
}
