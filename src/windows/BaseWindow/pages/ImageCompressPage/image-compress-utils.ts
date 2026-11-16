/**
 * 图片压缩页的纯函数层。
 *
 * 这里**不碰 DOM、不碰 canvas、不碰 File**：参数换算、体积口径、命名去重、
 * 二分搜索策略全在这一层，因此可以在 vitest 里直接跑（§6.6 第 5 条「可测性优先」）。
 * 真正解码 / 编码的部分在 `image-encoder.ts`。
 */

import type {
  CompressItem,
  CompressOptions,
  CompressSummary,
  OutputFormat,
  SupportedFormat,
} from "./image-compress-types";

/** PNG 调色板的上下限（低于 2 色没有意义，UPNG 也按真彩色处理） */
export const PNG_MIN_COLORS = 2;
export const PNG_MAX_COLORS = 256;

/** 单次编码是昂贵操作（几十到几百毫秒），二分步数必须封顶 */
const DEFAULT_SEARCH_STEPS = 8;

export const DEFAULT_OPTIONS: CompressOptions = {
  format: "auto",
  targetKb: 0,
  quality: 80,
  // 0 = 真彩色无损重编码。默认不量化，避免「一进来就把图压出色带」
  colors: 0,
  maxWidth: 0,
  maxHeight: 0,
  background: "#ffffff",
};

/** 字节数 → 人类可读（B / KB / MB，与两个参考工具的口径一致） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 压缩率：正数表示变小了，负数表示反而变大（原样保留时会走到这条）。
 * 用「原图 - 结果」除以原图，避免结果更小时出现负数百分比。
 */
export function savedPercent(origSize: number, outSize: number): number {
  if (origSize <= 0) return 0;
  return Math.round(((origSize - outSize) / origSize) * 100);
}

/** 等比缩放到 maxWidth × maxHeight 以内；**只缩不放**（参考工具同样钳到 1） */
export function scaleSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  let scale = 1;
  if (maxWidth > 0) scale = Math.min(scale, maxWidth / width);
  if (maxHeight > 0) scale = Math.min(scale, maxHeight / height);
  if (scale >= 1) return { width, height };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isSupportedFormat(type: string): type is SupportedFormat {
  return (
    type === "image/png" || type === "image/jpeg" || type === "image/webp"
  );
}

/**
 * 输出格式判定：`auto` 时能保持原格式就保持，不能（gif / bmp / avif / svg…）
 * 一律退到 JPEG —— 与参考工具一致，因为 canvas 对这些格式没有稳定的编码器。
 */
export function normalizeFormat(
  format: OutputFormat,
  origType: string,
): SupportedFormat {
  if (format !== "auto") return format;
  const type = origType.toLowerCase();
  return isSupportedFormat(type) ? type : "image/jpeg";
}

/** 无损格式（PNG）不读质量参数 */
export function isLossyFormat(type: SupportedFormat): boolean {
  return type !== "image/png";
}

export function extensionOf(type: SupportedFormat): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

/** 去掉最后一个扩展名；没有扩展名时原样返回 */
export function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 下载用的文件名：`照片.png` → `照片-压缩.png` */
export function buildOutputName(
  name: string,
  type: SupportedFormat,
  suffix = "-压缩",
): string {
  return `${stripExtension(name) || "image"}${suffix}.${extensionOf(type)}`;
}

/**
 * 重名去重（批量打包 zip 时同名文件会互相覆盖），冲突时补 `-2` `-3`。
 * 传入的 `used` 会被就地写入，方便一次遍历内连续判重。
 */
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const base = stripExtension(name);
  const ext = name.slice(base.length);
  let index = 2;
  let candidate = `${base}-${index}${ext}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${base}-${index}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/** 下载用的文件名：列表单张下载与批量打包共用同一口径 */
export function outputNameOf(
  item: Pick<CompressItem, "name" | "outType">,
): string {
  return buildOutputName(item.name, item.outType);
}

/** 汇总只统计已完成的条目：处理中的条目体积是旧值，算进去会得出假数字 */
export function summarize(
  items: ReadonlyArray<
    Pick<CompressItem, "status" | "origSize" | "outSize">
  >,
): CompressSummary {
  let doneCount = 0;
  let origSize = 0;
  let outSize = 0;
  for (const item of items) {
    if (item.status !== "done") continue;
    doneCount += 1;
    origSize += item.origSize;
    outSize += item.outSize;
  }
  return {
    doneCount,
    totalCount: items.length,
    origSize,
    outSize,
    savedBytes: Math.max(0, origSize - outSize),
    savedPercent: savedPercent(origSize, outSize),
  };
}

/** 整数参数钳制：NaN / 越界一律回到安全值 */
export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const int = Math.round(value);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

/** 一次编码的产物：体积用于判定，payload 用于最终落盘（不重复编码） */
export interface Probe<T> {
  size: number;
  payload: T;
}

/** 命中项额外带上参数值，便于展示「128 色 / 质量 72%」 */
export interface Encoded<T> extends Probe<T> {
  value: number;
}

export interface SearchOptions {
  min: number;
  max: number;
  targetBytes: number;
  /** 最大探测次数，默认 8 次 */
  steps?: number;
}

/**
 * 二分搜索「满足体积 <= 目标的**最大值**」，用于整数参数（PNG 色数）。
 *
 * 为什么返回 payload 而不是参数：每探测一次就是一次完整编码，收敛后再拿参数
 * 补编一次等于白跑一遍（参考工具也是复用最后一次的可接受结果）。
 * 全部探测都不达标时返回 null，由调用方决定降级策略。
 */
export async function searchMaxInt<T>(
  encode: (value: number) => Promise<Probe<T>>,
  options: SearchOptions,
): Promise<Encoded<T> | null> {
  const steps = options.steps ?? DEFAULT_SEARCH_STEPS;
  let lo = Math.ceil(options.min);
  let hi = Math.floor(options.max);
  let best: Encoded<T> | null = null;
  for (let i = 0; i < steps && lo <= hi; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    const result = await encode(mid);
    if (result.size <= options.targetBytes) {
      best = { value: mid, size: result.size, payload: result.payload };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * 二分搜索「满足体积 <= 目标的最大值」，用于连续参数（质量 / 缩放比例）。
 * 与整数版同样返回最后一次命中的产物。
 */
export async function searchMaxFloat<T>(
  encode: (value: number) => Promise<Probe<T>>,
  options: SearchOptions,
): Promise<Encoded<T> | null> {
  const steps = options.steps ?? DEFAULT_SEARCH_STEPS;
  let lo = options.min;
  let hi = options.max;
  let best: Encoded<T> | null = null;
  for (let i = 0; i < steps; i += 1) {
    const mid = (lo + hi) / 2;
    const result = await encode(mid);
    if (result.size <= options.targetBytes) {
      best = { value: mid, size: result.size, payload: result.payload };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

/** 按比例缩放尺寸（等比，最小 1px）；与 `scaleSize` 的区别是不按上限约束而是按倍率 */
export function scaledSize(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** 触摸批处理文件名用的时间戳（`20261104-1130`），仅用于 zip 内层目录名 */
export function archiveStamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}`;
}
