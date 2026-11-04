/**
 * 图片压缩页的领域类型。
 *
 * 与 UI 组件、编码器、store 三方共用，单独成文件避免互相 import 形成环。
 */

/** 用户可选的输出格式（auto = 保持原格式，无法保持时退化为 JPEG） */
export type OutputFormat = "auto" | "image/png" | "image/jpeg" | "image/webp";

/** 实际参与编码的格式 */
export type SupportedFormat = "image/png" | "image/jpeg" | "image/webp";

export interface CompressOptions {
  format: OutputFormat;
  /** 目标体积（KB），0 = 不限制体积，只按质量 / 色数编码 */
  targetKb: number;
  /** JPEG / WebP 质量 1-100（PNG 无损格式不读该值） */
  quality: number;
  /** PNG 调色板色数：0 = 真彩色（无损重编码），2-256 = 量化 */
  colors: number;
  /** 最大宽 / 高（等比缩放，0 = 不限；只缩不放） */
  maxWidth: number;
  maxHeight: number;
  /** JPEG 无透明通道，透明像素会被填成该底色 */
  background: string;
}

export type CompressStatus = "pending" | "working" | "done" | "error";

export interface CompressItem {
  id: number;
  file: File;
  name: string;
  origSize: number;
  origType: string;
  origWidth: number;
  origHeight: number;
  status: CompressStatus;
  outBlob: Blob | null;
  outSize: number;
  outWidth: number;
  outHeight: number;
  outType: SupportedFormat;
  /** 命中的参数（展示用，如「128 色」「质量 72%」），未压缩时为空串 */
  applied: string;
  /** 压缩结果不小于原文件 → 原样保留（两个参考工具都这么做） */
  passthrough: boolean;
  /** 目标体积模式下压到下限仍超标 */
  oversize: boolean;
  error: string;
  /** 原图缩略图（object URL，移除条目时回收） */
  previewUrl: string;
  /** 压缩结果（object URL，供对比弹窗与下载使用） */
  resultUrl: string;
}

export interface CompressSummary {
  /** 已完成压缩的条目数 */
  doneCount: number;
  totalCount: number;
  origSize: number;
  outSize: number;
  savedBytes: number;
  savedPercent: number;
}
