/**
 * 导出 PNG 的通道薄封装（R27 / S5，RG-X 系列）
 *
 * 两条通道对应主进程的两件不同的事，这里各包一层、把「通道缺失」翻译成
 * 可读的失败码，而不是让调用方去判断 `api` 是不是 undefined：
 *
 * - `captureGraphPng` → `relation-window-export`：**取景**。把画布那一块截成
 *   PNG 字节 + 像素尺寸。画布根节点必须是可见、够大的，否则主进程会一直
 *   拿空图重试。
 *
 * - `exportBinary` → `novel-export-binary`：**存盘**。弹保存框 + 按字节写盘。
 *   刻意**不复用** `exportFile`（那是 `writeFile(path, content, "utf8")`）：
 *   用文本通道写二进制，会「不报错但图坏了」。
 *
 * 与 `relation-service.ts` 的分工：那边是「数据通道」，这里是「文件通道」。
 * 文件通道只在用户点了导出才走，所以不放进穷举 mock 的那五份测试里。
 */
import type { RelationCaptureRect, RelationCaptureResult } from "@/shared/types/electron";

/** 取景失败后的可读文案（主进程给的 message 已带细节，这里只兜底） */
const CAPTURE_FAILED = "导出失败，请把窗口置于前台后重试";

/**
 * 把画布根节点的矩形取成 PNG。
 *
 * 矩形由调用方用 `resolveCaptureRect()` 从 `getBoundingClientRect()` 算好，
 * 这里**不做二次换算**：主进程按 DIP 截，像素尺寸从 PNG 头回读。
 */
export async function captureGraphPng(rect: RelationCaptureRect): Promise<RelationCaptureResult> {
  const api = window.electronAPI?.novel;
  if (!api?.captureWindow) {
    return { ok: false, code: "unavailable", message: "数据通道不可用（预加载脚本未就绪）" };
  }
  try {
    return await api.captureWindow(rect);
  } catch (error) {
    return {
      ok: false,
      code: "db",
      message: `${CAPTURE_FAILED}（${error instanceof Error ? error.message : String(error)}）`,
    };
  }
}

/**
 * 把 PNG 字节交给主进程弹框落盘。返回写到的路径，取消返回 null。
 *
 * ⚠️ 这里的 `data` 必须是**字节**（Uint8Array / ArrayBuffer），不是 base64、
 * 不是 dataURL —— 主进程按 `Buffer.from()` 原样写盘。
 */
export async function exportBinary(
  defaultName: string,
  data: Uint8Array,
  ext = "png",
  filterName = "PNG 图片",
): Promise<{ path: string } | null> {
  const api = window.electronAPI?.novel;
  if (!api?.exportBinary) return null;
  try {
    return await api.exportBinary(defaultName, data, ext, filterName);
  } catch {
    return null;
  }
}
