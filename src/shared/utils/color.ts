/**
 * 颜色工具（纯函数，无 DOM）。
 *
 * 从色键抠图页抽出、图片与证件照两页共用：同一套 hex/rgb 互转与容差换算，
 * 避免两个页面各自维护一份实现后判定口径漂移。
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** 限制到 0-255 的整数像素值 */
export function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 255) return 255;
  return Math.round(value);
}

/** 百分比容差 → 0-255 的通道允许差 */
export function toleranceRadius(tolerance: number): number {
  const safe = Number.isFinite(tolerance)
    ? Math.min(100, Math.max(0, tolerance))
    : 0;
  return (safe / 100) * 255;
}

export function rgbToHex(color: RgbColor): string {
  const hex = (value: number): string =>
    clampByte(value).toString(16).padStart(2, "0");
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

/** 支持 `#rgb` / `#rrggbb`；非法输入返回 null（调用方保留原色，不要静默清成黑色） */
export function hexToRgb(hex: string): RgbColor | null {
  const value = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return {
      r: Number.parseInt(value[0] + value[0], 16),
      g: Number.parseInt(value[1] + value[1], 16),
      b: Number.parseInt(value[2] + value[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
    };
  }
  return null;
}

/** 用于 aria-label / 提示文案：`rgb(0, 255, 0)` */
export function formatRgb(color: RgbColor): string {
  return `rgb(${clampByte(color.r)}, ${clampByte(color.g)}, ${clampByte(color.b)})`;
}

/**
 * 明暗调整：`amount > 0` 向白靠，`amount < 0` 向黑靠，取值 -1 ~ 1。
 *
 * 证件照底色的渐变只用它算端点——不做整套 HSL 运算，因为证件照底色的差别
 * 本来就只有「深浅」一维，走 RGB 线性插值就够了，也不会把饱和色带偏。
 */
export function shadeColor(color: RgbColor, amount: number): RgbColor {
  const ratio = Number.isFinite(amount) ? Math.min(1, Math.max(-1, amount)) : 0;
  const target = ratio >= 0 ? 255 : 0;
  const t = Math.abs(ratio);
  return {
    r: clampByte(color.r + (target - color.r) * t),
    g: clampByte(color.g + (target - color.g) * t),
    b: clampByte(color.b + (target - color.b) * t),
  };
}

/** 逐通道差值取最大——与色键/证件照背景判定同一把尺子 */
export function colorDistance(a: RgbColor, b: RgbColor): number {
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
  );
}
