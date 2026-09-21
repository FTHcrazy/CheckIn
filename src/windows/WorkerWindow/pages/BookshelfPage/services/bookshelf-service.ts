/**
 * 书架数据服务（R32）
 *
 * 书架与编辑器（NovelPage）是同窗口的两个页面，按 AGENTS.md 页面隔离规范
 * 互不导入——这里对 preload 暴露的 novel 命名空间做薄封装，作为书架自己的
 * Service 层（不含业务逻辑、不导入 React）。
 *
 * 注意：SHELF_STORAGE_KEYS 与编辑器 novel-config.ts 的 STORAGE_KEYS 指向
 * 同一份 userDb config 数据（设置 / 位置记忆由编辑器写入、书架只读），
 * 键值若变更须两处同步。
 */

import type {
  NovelBundleDTO,
  NovelNoteDTO,
  NovelWorkDTO,
} from "@/shared/types/electron";

export const SHELF_STORAGE_KEYS = {
  /** 排版与写作设置（R5）：书架只读派生序号风格与今日目标 */
  settings: "novel_editor_settings",
  /** 上次续写位置（R6）：书架只读定位「继续写作」 */
  position: "novel_editor_position",
} as const;

/** 生成带随机后缀的行 ID（与编辑器 createNovelId 同构，避免跨页导入） */
export function createShelfId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 拉取全量数据包（novel-editor-load；空库时主进程播种「未命名作品」） */
export async function fetchShelfBundle(): Promise<NovelBundleDTO> {
  return window.electronAPI!.novel.editorLoad();
}

/** 今日写作聚合（含连续码字天数） */
export interface ShelfUsage {
  todayWords: number;
  saveCount: number;
  streakDays: number;
}

export async function fetchShelfUsage(): Promise<ShelfUsage> {
  return window.electronAPI!.novel.usageToday();
}

/** 读取编辑器设置原文 JSON（解析容错在 hooks 层） */
export async function fetchShelfSettingsRaw(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(SHELF_STORAGE_KEYS.settings);
}

/** 读取续写位置原文 JSON */
export async function fetchShelfPositionRaw(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(SHELF_STORAGE_KEYS.position);
}

/** 新建作品落库（id 由书架生成） */
export async function addShelfWork(work: NovelWorkDTO): Promise<boolean> {
  return window.electronAPI!.novel.addWork(work);
}

/** 新增 / 更新灵感速记（upsert） */
export async function saveShelfNote(note: NovelNoteDTO): Promise<boolean> {
  return window.electronAPI!.novel.saveNote(note);
}

/** 删除灵感速记 */
export async function removeShelfNote(noteId: string): Promise<boolean> {
  return window.electronAPI!.novel.removeNote(noteId);
}

/** 灵感归属迁移：归档到作品；workId 传 '' 退回未归属池 */
export async function moveShelfNote(noteId: string, workId: string): Promise<boolean> {
  return window.electronAPI!.novel.moveNote(noteId, workId);
}
