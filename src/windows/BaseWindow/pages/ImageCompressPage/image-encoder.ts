/**
 * 图片压缩的编码层（唯一接触 canvas / UPNG 的地方）。
 *
 * 两条编码路线，按**输出格式**分流，而不是按来源格式：
 * - PNG：走 UPNG.js 解码 → 可选调色板量化 → 重新 deflate。canvas 的
 *   `toBlob("image/png")` 只是把像素原样再压一遍，几乎不会变小，所以 PNG 必须走
 *   量化这条路（这也是参考工具 PNG 页同时加载 pako + UPNG 的原因）。
 * - JPEG / WebP：走 canvas `toBlob`，质量参数由浏览器编码器消费。
 *
 * 目标体积模式下两条路线都是「先找便宜的自由度，再动贵的」：
 * PNG 只能压色数（无损格式没有质量档），JPEG / WebP 先压质量、压到底再缩尺寸。
 */

import UPNG from "upng-js";
import {
  PNG_MAX_COLORS,
  PNG_MIN_COLORS,
  clampInt,
  normalizeFormat,
  scaledSize,
  scaleSize,
  searchMaxFloat,
  searchMaxInt,
  type Encoded,
  type Probe,
} from "./image-compress-utils";
import type { CompressOptions, SupportedFormat } from "./image-compress-types";

/** 目标体积模式下 PNG 的尺寸阶梯（从原尺寸开始逐级下探） */
const PNG_TARGET_SCALES = [1, 0.85, 0.7, 0.55, 0.42, 0.3, 0.2, 0.12];
/** 目标体积模式下 PNG 全档位失败后的兜底倍率 */
const PNG_FALLBACK_SCALE = 0.1;
/** JPEG / WebP 缩尺寸搜索的下限倍率 */
const LOSSY_MIN_SCALE = 0.08;

/** 让出主线程：单张图要连续编码多次，不给浏览器喘气就会整窗卡住 */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface RgbaSource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface CompressOutcome {
  /** null = 原样保留（压缩后反而更大，且格式没变） */
  blob: Blob | null;
  size: number;
  width: number;
  height: number;
  type: SupportedFormat;
  /** 实际生效的参数，用于列表展示 */
  applied: string;
  oversize: boolean;
}

export interface CompressResult extends CompressOutcome {
  /** 原图分辨率（结果可能被缩放，不能用结果反推） */
  origWidth: number;
  origHeight: number;
}

/** UPNG.encode 会原地改写输入，必须交一份独立内存 */
function toArrayBuffer(data: Uint8ClampedArray): ArrayBuffer {
  const copy = new Uint8ClampedArray(data.length);
  copy.set(data);
  return copy.buffer as ArrayBuffer;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建画布上下文，当前环境不支持图片处理");
  return ctx;
}

/** 等比缩放 RGBA（走 canvas 的高质量重采样，与参考工具一致） */
async function scaleRgba(
  source: RgbaSource,
  width: number,
  height: number,
): Promise<RgbaSource> {
  if (width === source.width && height === source.height) return source;
  const from = createCanvas(source.width, source.height);
  context2d(from).putImageData(
    new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
    0,
    0,
  );
  const to = createCanvas(width, height);
  const ctx = context2d(to);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(from, 0, 0, to.width, to.height);
  const out = ctx.getImageData(0, 0, to.width, to.height);
  return { data: out.data, width: to.width, height: to.height };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // 少数格式 createImageBitmap 不认，退回 <img> 解码
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片解码失败，格式可能不受支持"));
      image.src = url;
    });
  } finally {
    // 图片已解码进内存，object URL 可以稍后回收
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function bitmapSize(source: ImageBitmap | HTMLImageElement): {
  width: number;
  height: number;
} {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/** 把任意图片画进 canvas（先铺底色，透明区才不会在转 JPEG 时变黑） */
async function sourceToCanvas(
  file: File,
  background: string,
): Promise<HTMLCanvasElement> {
  const bitmap = await loadBitmap(file);
  const { width, height } = bitmapSize(bitmap);
  const canvas = createCanvas(width, height);
  const ctx = context2d(canvas);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
  if (!(bitmap instanceof HTMLImageElement) && typeof bitmap.close === "function") {
    bitmap.close();
  }
  return canvas;
}

function canvasToRgba(canvas: HTMLCanvasElement): RgbaSource {
  const data = context2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
  return { data: data.data, width: canvas.width, height: canvas.height };
}

/** 把画布等比缩到目标尺寸；尺寸不变时原样返回，避免白拷一份像素 */
function fitCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  if (width === canvas.width && height === canvas.height) return canvas;
  const scaled = createCanvas(width, height);
  const ctx = context2d(scaled);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  return scaled;
}

/** PNG 源码优先用 UPNG 解码（保留原始 alpha，不经 canvas 的白底合成） */
async function decodePng(file: File): Promise<RgbaSource | null> {
  try {
    const image = UPNG.decode(await file.arrayBuffer());
    const frames = UPNG.toRGBA8(image);
    const first = frames[0];
    if (!first) return null;
    return {
      data: new Uint8ClampedArray(first),
      width: image.width,
      height: image.height,
    };
  } catch {
    // 不是 PNG（或损坏 / 不支持的 PNG 变体）→ 交给 canvas 兜底
    return null;
  }
}

function encodePng(source: RgbaSource, colors: number): Blob {
  const buffer = UPNG.encode(
    [toArrayBuffer(source.data)],
    source.width,
    source.height,
    colors,
  );
  return new Blob([buffer], { type: "image/png" });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: SupportedFormat,
  quality: number | undefined,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`当前环境不支持 ${type} 编码`));
      },
      type,
      quality,
    );
  });
}

/** 按倍率缩放后用 canvas 编码；JPEG 必须先铺底色 */
async function encodeCanvasAt(
  source: HTMLCanvasElement,
  scale: number,
  type: SupportedFormat,
  quality: number | undefined,
  background: string,
): Promise<{ blob: Blob; width: number; height: number }> {
  const target = scaledSize(source.width, source.height, scale);
  const canvas = createCanvas(target.width, target.height);
  const ctx = context2d(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (type === "image/jpeg") {
    ctx.fillStyle = background || "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, type, quality);
  return { blob, width: canvas.width, height: canvas.height };
}

function describeColors(colors: number): string {
  return colors === 0 ? "真彩色无损" : `${colors} 色`;
}

function describeQuality(quality: number, scale: number): string {
  const percent = `${Math.round(quality * 100)}%`;
  return scale >= 0.999
    ? `质量 ${percent}`
    : `质量 ${percent} · 缩放 ${Math.round(scale * 100)}%`;
}

/** 收口：目标体积模式一律接受结果；否则「结果更大且格式没变」时原样保留 */
function finalize(
  blob: Blob,
  width: number,
  height: number,
  type: SupportedFormat,
  applied: string,
  targetBytes: number,
  file: File,
  oversize = false,
): CompressOutcome {
  const sameFormat = normalizeFormat("auto", file.type) === type;
  if (targetBytes === 0 && sameFormat && blob.size > file.size) {
    return {
      blob: null,
      size: file.size,
      width,
      height,
      type,
      applied: "原样保留",
      oversize: false,
    };
  }
  return { blob, size: blob.size, width, height, type, applied, oversize };
}

/** PNG + 目标体积：逐级缩小尺寸，每级二分色数，取第一个能压进目标的档位 */
async function compressPngToTarget(
  source: RgbaSource,
  targetBytes: number,
): Promise<CompressOutcome> {
  for (const scale of PNG_TARGET_SCALES) {
    const size = scaledSize(source.width, source.height, scale);
    const current = await scaleRgba(source, size.width, size.height);
    await tick();

    // 先用最少色探底：连 2 色都压不进目标，该档位再怎么量化都没用，直接缩尺寸
    const floorBlob = encodePng(current, PNG_MIN_COLORS);
    if (floorBlob.size > targetBytes) continue;

    const floor: Encoded<Blob> = {
      value: PNG_MIN_COLORS,
      size: floorBlob.size,
      payload: floorBlob,
    };
    const better = await searchMaxInt<Blob>(
      async (colors): Promise<Probe<Blob>> => {
        await tick();
        const blob = encodePng(current, colors);
        return { size: blob.size, payload: blob };
      },
      {
        // 2 色已验证可接受，搜索区间从 3 开始，省掉一次重复编码
        min: PNG_MIN_COLORS + 1,
        max: PNG_MAX_COLORS,
        targetBytes,
        steps: 8,
      },
    );

    const winner = better ?? floor;
    return {
      blob: winner.payload,
      size: winner.size,
      width: current.width,
      height: current.height,
      type: "image/png",
      applied: describeColors(winner.value),
      oversize: false,
    };
  }

  // 所有档位都压不进目标：退到最小尺寸 + 2 色，并如实标记超标
  const fallbackSize = scaledSize(
    source.width,
    source.height,
    PNG_FALLBACK_SCALE,
  );
  const fallback = await scaleRgba(
    source,
    fallbackSize.width,
    fallbackSize.height,
  );
  const blob = encodePng(fallback, PNG_MIN_COLORS);
  return {
    blob,
    size: blob.size,
    width: fallback.width,
    height: fallback.height,
    type: "image/png",
    applied: describeColors(PNG_MIN_COLORS),
    oversize: blob.size > targetBytes,
  };
}

/** JPEG / WebP + 目标体积：先二分质量，压到底仍超标再二分尺寸 */
async function compressLossyToTarget(
  source: HTMLCanvasElement,
  type: SupportedFormat,
  options: CompressOptions,
  targetBytes: number,
): Promise<CompressOutcome> {
  const full = await encodeCanvasAt(source, 1, type, 1, options.background);
  await tick();
  if (full.blob.size <= targetBytes) {
    return {
      blob: full.blob,
      size: full.blob.size,
      width: full.width,
      height: full.height,
      type,
      applied: describeQuality(1, 1),
      oversize: false,
    };
  }

  const byQuality = await searchMaxFloat<{ blob: Blob; width: number; height: number }>(
    async (quality): Promise<Probe<{ blob: Blob; width: number; height: number }>> => {
      await tick();
      const result = await encodeCanvasAt(source, 1, type, quality, options.background);
      return { size: result.blob.size, payload: result };
    },
    { min: 0.05, max: 1, targetBytes, steps: 8 },
  );
  if (byQuality) {
    return {
      blob: byQuality.payload.blob,
      size: byQuality.size,
      width: byQuality.payload.width,
      height: byQuality.payload.height,
      type,
      applied: describeQuality(byQuality.value, 1),
      oversize: false,
    };
  }

  const byScale = await searchMaxFloat<{ blob: Blob; width: number; height: number }>(
    async (scale): Promise<Probe<{ blob: Blob; width: number; height: number }>> => {
      await tick();
      // 缩尺寸时固定质量 0.5：此时质量已压到最低仍超标，再降质量只会换来噪点
      const result = await encodeCanvasAt(source, scale, type, 0.5, options.background);
      return { size: result.blob.size, payload: result };
    },
    { min: LOSSY_MIN_SCALE, max: 1, targetBytes, steps: 8 },
  );
  if (byScale) {
    return {
      blob: byScale.payload.blob,
      size: byScale.size,
      width: byScale.payload.width,
      height: byScale.payload.height,
      type,
      applied: describeQuality(0.5, byScale.value),
      oversize: false,
    };
  }

  const floor = await encodeCanvasAt(
    source,
    LOSSY_MIN_SCALE,
    type,
    0.3,
    options.background,
  );
  return {
    blob: floor.blob,
    size: floor.blob.size,
    width: floor.width,
    height: floor.height,
    type,
    applied: describeQuality(0.3, LOSSY_MIN_SCALE),
    oversize: floor.blob.size > targetBytes,
  };
}

/**
 * 压缩入口：一张文件 + 一组参数 → 结果。
 * 解码失败、编码器缺失都直接抛错，由调用方落到条目的 error 上展示。
 */
export async function compressImage(
  file: File,
  options: CompressOptions,
): Promise<CompressResult> {
  const type = normalizeFormat(options.format, file.type);
  const targetBytes = Math.max(0, Math.round(options.targetKb * 1024));
  /** 原图分辨率在解码那一刻记下来：结果可能被缩放，不能反推 */
  let origWidth = 0;
  let origHeight = 0;

  const outcome = await (async (): Promise<CompressOutcome> => {
    if (type === "image/png") {
      const decoded =
        (await decodePng(file)) ??
        canvasToRgba(await sourceToCanvas(file, options.background));
      origWidth = decoded.width;
      origHeight = decoded.height;
      const limit = scaleSize(
        decoded.width,
        decoded.height,
        options.maxWidth,
        options.maxHeight,
      );
      const source = await scaleRgba(decoded, limit.width, limit.height);
      await tick();

      if (targetBytes > 0) {
        return compressPngToTarget(source, targetBytes);
      }
      const colors =
        options.colors === 0
          ? 0
          : clampInt(options.colors, PNG_MIN_COLORS, PNG_MAX_COLORS, PNG_MAX_COLORS);
      const blob = encodePng(source, colors);
      return finalize(
        blob,
        source.width,
        source.height,
        type,
        describeColors(colors),
        0,
        file,
      );
    }

    // PNG 以外：canvas 路线
    const canvas = await sourceToCanvas(file, options.background);
    origWidth = canvas.width;
    origHeight = canvas.height;
    const limit = scaleSize(
      canvas.width,
      canvas.height,
      options.maxWidth,
      options.maxHeight,
    );
    const base = fitCanvas(canvas, limit.width, limit.height);

    if (targetBytes > 0) {
      return compressLossyToTarget(base, type, options, targetBytes);
    }

    const quality = clampInt(options.quality, 1, 100, 100) / 100;
    const result = await encodeCanvasAt(base, 1, type, quality, options.background);
    return finalize(
      result.blob,
      result.width,
      result.height,
      type,
      describeQuality(quality, 1),
      0,
      file,
    );
  })();

  return {
    ...outcome,
    origWidth: origWidth || outcome.width,
    origHeight: origHeight || outcome.height,
  };
}
