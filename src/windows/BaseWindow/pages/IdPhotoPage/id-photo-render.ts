/**
 * 证件照的绘制与编码（页面里唯一接触 canvas 的层）。
 *
 * 产品流程与参考页一致：先得到**透明底前景**，再在前端把目标底色铺在它下面。
 * 好处是换底色完全不用重算抠图——颜色改成什么都是同一张透明底上的一次合成，
 * 点一下色块立刻出新图。
 */

import { rgbToHex } from "@/shared/utils/color";
import type { IdPhotoOptions } from "./id-photo-types";
import { backdropStops, fitRect, withJpegDpi } from "./id-photo-utils";

export interface Size {
  width: number;
  height: number;
}

/** 底色填充（纯色 / 上下渐变 / 中心渐变） */
function fillBackdrop(
  ctx: CanvasRenderingContext2D,
  size: Size,
  options: IdPhotoOptions,
): void {
  const stops = backdropStops(options.backdrop, options.render);
  const from = rgbToHex(stops.from);
  const to = rgbToHex(stops.to);

  if (options.render === "gradient-y") {
    const gradient = ctx.createLinearGradient(0, 0, 0, size.height);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
  } else if (options.render === "gradient-radial") {
    const gradient = ctx.createRadialGradient(
      size.width / 2,
      size.height * 0.42,
      0,
      size.width / 2,
      size.height * 0.42,
      Math.max(size.width, size.height) * 0.78,
    );
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = from;
  }

  ctx.fillRect(0, 0, size.width, size.height);
}

export interface ComposeParams {
  /** 透明底前景（原分辨率） */
  foreground: CanvasImageSource;
  foregroundSize: Size;
  options: IdPhotoOptions;
  /** true = 只输出前景，不铺底色（导出透明底用） */
  transparent?: boolean;
}

/** 在目标尺寸的画布上合成一张证件照 */
export function composePhoto(
  ctx: CanvasRenderingContext2D,
  params: ComposeParams,
): void {
  const { foreground, foregroundSize, options, transparent } = params;
  const { width, height } = options;

  ctx.clearRect(0, 0, width, height);
  if (!transparent) fillBackdrop(ctx, { width, height }, options);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const rect = fitRect(
    foregroundSize.width,
    foregroundSize.height,
    width,
    height,
    options.fit,
    options.offsetX,
    options.offsetY,
  );
  ctx.drawImage(foreground, rect.x, rect.y, rect.width, rect.height);
}

/** 导出 PNG（透明底用；DPI 不写，PNG 的 pHYs 不在本页范围内） */
export async function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/png");
  });
}

/**
 * 导出 JPG，并把 DPI 写进 JFIF 头。
 *
 * canvas 自己只会写 1:1 的默认密度，打印店按那个值排版会得到错误尺寸，
 * 所以证件的成品必须补这一步（纯字节改写，见 `withJpegDpi`）。
 */
export async function toJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
  dpi: number,
): Promise<Blob | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (value) => resolve(value),
      "image/jpeg",
      Math.min(1, Math.max(0.3, quality)),
    );
  });
  if (!blob) return null;

  const raw = new Uint8Array(await blob.arrayBuffer());
  const patched = withJpegDpi(raw, dpi);
  const buffer = patched.buffer.slice(
    patched.byteOffset,
    patched.byteOffset + patched.byteLength,
  ) as ArrayBuffer;
  return new Blob([buffer], { type: "image/jpeg" });
}
