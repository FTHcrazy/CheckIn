/**
 * Map 数据访问层（docs/novel-map-prd.md §6 渲染进程结构）
 *
 * 职责：封装 window.electronAPI!.map，提供语义化 API（如 loadMap / saveMap）。
 * 边界：不 import React，不包含 UI 逻辑；Pages 通过本层访问数据，不直接调用 IPC。
 */
import type { MapDTO, MapMetaDTO, MapContent } from "@/shared/types/electron.d.ts";

interface MapSaveResult {
  ok: true;
  updatedAt: number;
}

interface MapSaveError {
  ok: false;
  reason: string;
}

export type MapSaveResponse = MapSaveResult | MapSaveError;

/** 列出全部地图（按 updated_at 倒序，不带 content） */
export function listMaps(): Promise<MapMetaDTO[]> {
  return window.electronAPI!.map.list();
}

/** 加载单图（带 content） */
export function loadMap(mapId: string): Promise<MapDTO | null> {
  return window.electronAPI!.map.load(mapId);
}

/** 新建地图 */
export function addMap(map: {
  id: string;
  workId: string | null;
  name: string;
  seed: string;
  content: string;
}): Promise<boolean> {
  return window.electronAPI!.map.add(map);
}

/** 重命名 */
export function renameMap(mapId: string, name: string): Promise<boolean> {
  return window.electronAPI!.map.rename(mapId, name);
}

/** 删除（主进程级联清理父图引用） */
export function deleteMap(mapId: string): Promise<boolean> {
  return window.electronAPI!.map.delete(mapId);
}

/** 保存（整文档 + schema 校验 + 环引用检测 + 乐观锁） */
export function saveMap(
  mapId: string,
  content: string,
  updatedAt: number,
): Promise<MapSaveResponse> {
  return window.electronAPI!.map.save(mapId, content, updatedAt);
}

/** 打开地图窗（由 WorkerWindow 调用，单实例唤起） */
export function openMapWindow(mapId?: string): void {
  window.electronAPI!.send("map-window-open", mapId ? { mapId } : undefined);
}

/** 读取作品绑定主地图的 mapId（RM7，走 config 键） */
export async function getWorkMapBinding(workId: string): Promise<string | null> {
  const v = await window.electronAPI!.novel.configGet(
    `novel_work_map_binding:${workId}`,
  );
  return v ?? null;
}

/** 设置作品绑定主地图（RM7） */
export function setWorkMapBinding(
  workId: string,
  mapId: string,
): Promise<boolean> {
  return window.electronAPI!.novel.configSet(
    `novel_work_map_binding:${workId}`,
    mapId,
  );
}

/** 解析 content JSON 为 MapContent */
export function parseContent(raw: string): MapContent {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as MapContent;
    }
  } catch {
    // fallthrough
  }
  return emptyContent();
}

/** 构造空画布文档 */
export function emptyContent(): MapContent {
  return {
    terrain: { cols: 80, rows: 50, cells: [], legendVersion: 1 },
    annotations: [],
    stamps: [],
    links: [],
    viewport: { x: 0, y: 0, scale: 0.75 },
    tileMode: false,
    symbolStyle: "A",
  };
}

/** 序列化 MapContent 为存储字符串 */
export function stringifyContent(content: MapContent): string {
  return JSON.stringify(content);
}

/** 导出 PNG（RM6）：渲染层生成 dataURL，主进程弹保存框写盘 */
export function exportPng(
  dataUrl: string,
  defaultName: string,
): Promise<{ ok: true; path: string } | { ok: false; cancelled?: boolean; reason?: string }> {
  return window.electronAPI!.map.exportPng(dataUrl, defaultName);
}
