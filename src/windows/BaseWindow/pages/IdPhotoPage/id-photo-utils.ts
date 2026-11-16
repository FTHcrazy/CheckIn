/**
 * 证件照换底色的纯函数层（不依赖 DOM，可在 vitest 里直接验证）。
 *
 * 三件事在这里算完，绘制与编码留给 `id-photo-render.ts`：
 * 1. 前景在目标画布里的落位（contain 留白 / cover 裁切 + 垂直锚点）；
 * 2. 底色渐变的两个端点色；
 * 3. JPG 的 DPI 写入（改 JFIF 头，canvas 自己写不了）。
 */

import { clampByte, hexToRgb, shadeColor, type RgbColor } from "@/shared/utils/color";
import {
  OFFSET_MAX,
  OFFSET_MIN,
  type BackdropRender,
  type FitMode,
} from "./id-photo-types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 锚点夹到 `[-1, 1]`：拖动累积与手写参数都可能越界 */
export function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < OFFSET_MIN) return OFFSET_MIN;
  if (value > OFFSET_MAX) return OFFSET_MAX;
  return value;
}

/**
 * 把 `srcW×srcH` 放进 `dstW×dstH` 的落位矩形。
 *
 * `contain` 等比缩小到完全可见（四周留底色），`cover` 等比放大到铺满（超出裁掉）。
 * 位置由锚点 `offsetX/offsetY` 决定（-1 贴左/上、0 居中、1 贴右/下）。
 *
 * 两种模式共用一条公式 `(dst - size) * (1 + offset) / 2`：`cover` 时
 * `dst - size` 为负，锚点越大坐标越负，语义仍然是「贴向右/下」，不用分支。
 */
export function fitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: FitMode,
  offsetX = 0,
  offsetY = 0,
): Rect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { x: 0, y: 0, width: Math.max(0, dstW), height: Math.max(0, dstH) };
  }

  const scale =
    fit === "cover"
      ? Math.max(dstW / srcW, dstH / srcH)
      : Math.min(dstW / srcW, dstH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  const x = ((dstW - width) * (1 + clampOffset(offsetX))) / 2;
  const y = ((dstH - height) * (1 + clampOffset(offsetY))) / 2;

  return { x, y, width, height };
}

/**
 * 把屏幕上的一次拖动换算成锚点增量。
 *
 * 目标是「拖着图走」的直觉：手指移动多少像素，图就跟着移动多少像素。
 * 先按预览/成品的比例换成成品像素，再除以锚点可用的余量（`dst - scaled`）——
 * 余量越小，同样的拖动对应越大的锚点变化，因此贴边时不会出现「拖半天不动」。
 *
 * @param dragPx  屏幕上的位移（CSS 像素）
 * @param framePx 成品画框边长
 * @param previewPx 预览画布边长
 * @param scaledPx 前景缩放后的对应边长
 */
export function panDelta(
  dragPx: number,
  framePx: number,
  previewPx: number,
  scaledPx: number,
): number {
  const room = framePx - scaledPx;
  if (previewPx <= 0 || framePx <= 0 || Math.abs(room) < 0.5) return 0;
  return (2 * dragPx * (framePx / previewPx)) / room;
}

export interface BackdropStops {
  from: RgbColor;
  to: RgbColor;
}

/**
 * 底色渐变的端点色。
 *
 * - `solid`：两端同色；
 * - `gradient-y`：上深下浅（证件照打光的自然走向，深色底尤其明显）；
 * - `gradient-radial`：中心亮、四周深，模拟摄影棚背景布的中心柔光。
 *
 * 参考页把「纯色 / 上下渐变 / 中心渐变」三档交给服务端渲染，具体的明暗幅度
 * 前端看不到——这里的 ±16% 是本项目定的量，属于设计选择而非逆向结论。
 */
export function backdropStops(
  backdrop: string,
  render: BackdropRender,
): BackdropStops {
  const base = hexToRgb(backdrop) ?? { r: 255, g: 255, b: 255 };
  switch (render) {
    case "gradient-y":
      return { from: shadeColor(base, -0.16), to: shadeColor(base, 0.08) };
    case "gradient-radial":
      return { from: shadeColor(base, 0.1), to: shadeColor(base, -0.18) };
    default:
      return { from: base, to: base };
  }
}

/** 输出尺寸的合理区间：太小没有细节，太大 canvas 会先崩 */
export function clampDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 32) return 32;
  if (rounded > 4000) return 4000;
  return rounded;
}

/**
 * 改写 JPEG 的 JFIF 段，写入 DPI。
 *
 * canvas 的 `toBlob("image/jpeg")` 只会写一个默认 1:1 的密度，打印店按这个值
 * 排版会得到错误尺寸，所以证件照必须自己补。Chromium 产出的 JPEG 一定带
 * APP0/JFIF，找不到时兜底在 SOI 之后插一个。
 *
 * @returns 新数组（不修改入参）；非 JPEG 数据原样返回
 */
export function withJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const target = Math.round(
    Math.min(1200, Math.max(1, Number.isFinite(dpi) ? dpi : 300)),
  );
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) break;
    const marker = bytes[p + 1];
    // 填充字节与无条件段：只占 2 字节，没有长度字段
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += marker === 0xff ? 1 : 2;
      continue;
    }
    // SOS 之后是熵编码数据，再往后找段会误读像素
    if (marker === 0xda) break;

    const segLen = (bytes[p + 2] << 8) | bytes[p + 3];
    if (segLen < 2) break;

    const isJfif =
      marker === 0xe0 &&
      bytes[p + 4] === 0x4a && // J
      bytes[p + 5] === 0x46 && // F
      bytes[p + 6] === 0x49 && // I
      bytes[p + 7] === 0x46 && // F
      bytes[p + 8] === 0x00;

    if (isJfif && p + 16 <= bytes.length) {
      const out = new Uint8Array(bytes);
      out[p + 11] = 1; // units = dots per inch
      out[p + 12] = (target >> 8) & 0xff;
      out[p + 13] = target & 0xff;
      out[p + 14] = (target >> 8) & 0xff;
      out[p + 15] = target & 0xff;
      return out;
    }

    p += 2 + segLen;
  }

  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, // version 1.1
    0x01, // units = dpi
    (target >> 8) & 0xff, target & 0xff,
    (target >> 8) & 0xff, target & 0xff,
    0x00, 0x00, // 无缩略图
  ]);
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(bytes.subarray(2), 2 + app0.length);
  return out;
}

/** 导出文件名：`照片.jpg` + 尺寸 + 底色 → `照片-295x413-白底.jpg` */
export function buildIdPhotoName(
  name: string,
  width: number,
  height: number,
  backdropLabel: string,
  transparent = false,
): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name) || "photo";
  const suffix = transparent ? "透明底" : backdropLabel || "证件照";
  return `${base}-${width}x${height}-${suffix}.${transparent ? "png" : "jpg"}`;
}

/** 十六进制归一大写，供色块高亮比较 */
export function normalizeHex(hex: string): string {
  const parsed = hexToRgb(hex);
  return parsed
    ? `#${[parsed.r, parsed.g, parsed.b]
        .map((value) => clampByte(value).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()}`
    : "#FFFFFF";
}
