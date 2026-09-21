import { buildSearchSnippet, type LastPosition } from "../novel-utils";
import { STORAGE_KEYS } from "../novel-config";
import type {
  EditorSettings,
  NovelBundle,
  NovelChapter,
  NovelEntity,
  NovelLink,
  NovelNote,
  NovelSnapshot,
  NovelVolume,
  NovelWork,
  OutlineEntry,
  SearchHit,
} from "../types";

/**
 * 小说编辑器数据服务（IPC 封装层）
 *
 * 全部数据持久化在主进程 userDb 的 novel_* 表（PRD v0.4 §7），
 * 这里只做语义化转发，不含业务逻辑、不导入 React。
 * 全书检索在渲染层基于已装载的章节内存完成（无 IPC 往返）。
 */

/** 生成带随机后缀的行 ID，避免同毫秒并发创建时碰撞 */
export function createNovelId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 拉取编辑器所需的全部数据（novel-editor-load） */
export async function fetchNovelBundle(): Promise<NovelBundle> {
  return window.electronAPI!.novel.editorLoad();
}

// ── userDb config 读写（R5 设置持久化 / R6 位置记忆） ──

/** 读取编辑器设置 JSON（键不存在返回 null，由上层合并默认值） */
export async function fetchEditorSettings(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(STORAGE_KEYS.settings);
}

/** 保存编辑器设置（整读整写，低频小数据） */
export async function saveEditorSettings(settings: EditorSettings): Promise<boolean> {
  return window.electronAPI!.novel.configSet(STORAGE_KEYS.settings, JSON.stringify(settings));
}

/** 读取上次续写位置 JSON（键不存在返回 null） */
export async function fetchLastPosition(): Promise<string | null> {
  return window.electronAPI!.novel.configGet(STORAGE_KEYS.position);
}

/** 保存上次续写位置（防抖后调用） */
export async function saveLastPosition(position: LastPosition): Promise<boolean> {
  return window.electronAPI!.novel.configSet(STORAGE_KEYS.position, JSON.stringify(position));
}

// ── 作品管理（R29） ──

/** 新建作品落库（novel-work-add；id 由渲染层生成） */
export async function addWork(work: NovelWork): Promise<boolean> {
  return window.electronAPI!.novel.addWork(work);
}

/** 作品重命名（novel-work-rename） */
export async function renameWork(workId: string, name: string): Promise<boolean> {
  return window.electronAPI!.novel.renameWork(workId, name);
}

/** 删除作品（novel-work-delete，主进程级联清理全部关联数据） */
export async function removeWork(workId: string): Promise<boolean> {
  return window.electronAPI!.novel.deleteWork(workId);
}

/** 重置摘要（novel-editor-reset-template 返回，toast 汇报用） */
export interface TemplateResetSummary {
  volumes: number;
  chapters: number;
  words: number;
  entities: number;
}

/**
 * 一键重置为模板书籍（调试）：主进程单事务清空全部 novel_* 表后
 * 重新播种模板数据（novel-template.ts 实时构建，改模板定义后重置即生效）。
 * 排版设置保留，续写位置由主进程一并清除。
 */
export async function resetTemplateBook(): Promise<TemplateResetSummary> {
  return window.electronAPI!.novel.resetTemplate();
}

/** 保存章节正文 + 字数（novel-chapter-save，主进程同事务写增量快照） */
export async function saveChapterContent(
  chapterId: string,
  content: string,
  wordCount: number,
): Promise<boolean> {
  return window.electronAPI!.novel.saveChapter(chapterId, content, wordCount);
}

/** 拉取某章节的历史快照（novel-snapshot-list） */
export async function fetchChapterSnapshots(
  chapterId: string,
): Promise<NovelSnapshot[]> {
  return window.electronAPI!.novel.listSnapshots(chapterId);
}

/** 全书检索：按章节聚合命中次数（内存计算，PRD R10） */
export async function searchAcrossBook(
  keyword: string,
  chapters: NovelChapter[],
): Promise<SearchHit[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];

  return chapters
    .map((chapter) => {
      const count = chapter.content.split(trimmed).length - 1;
      return {
        id: `${chapter.id}-${trimmed}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        count,
        snippet: buildSearchSnippet(chapter.content, trimmed),
      };
    })
    .filter((hit) => hit.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** 新建章节落库（novel-chapter-add；id 已由渲染层生成） */
export async function addChapter(chapter: NovelChapter): Promise<boolean> {
  return window.electronAPI!.novel.addChapter(chapter);
}

/** 章节重命名（novel-chapter-rename） */
export async function renameChapter(chapterId: string, title: string): Promise<boolean> {
  return window.electronAPI!.novel.renameChapter(chapterId, title);
}

/** 删除章节（novel-chapter-delete，主进程同事务清理历史快照） */
export async function removeChapter(chapterId: string): Promise<boolean> {
  return window.electronAPI!.novel.deleteChapter(chapterId);
}

/** 章节状态切换（novel-chapter-status） */
export async function setChapterStatus(
  chapterId: string,
  status: NovelChapter["status"],
): Promise<boolean> {
  return window.electronAPI!.novel.setChapterStatus(chapterId, status);
}

/** 章节大纲梗概保存（novel-chapter-outline，空串即清除） */
export async function saveChapterOutline(
  chapterId: string,
  note: string,
): Promise<boolean> {
  return window.electronAPI!.novel.saveChapterOutline(chapterId, note);
}

/** 章节批量重排 / 跨卷移动落库（novel-chapter-order） */
export async function saveChapterOrder(
  updates: Array<{ id: string; sort: number; volumeId: string }>,
): Promise<boolean> {
  return window.electronAPI!.novel.saveChapterOrder(updates);
}

/** 新建卷落库（novel-volume-add） */
export async function addVolume(volume: NovelVolume): Promise<boolean> {
  return window.electronAPI!.novel.addVolume(volume);
}

/** 卷命名（novel-volume-rename） */
export async function renameVolume(volumeId: string, name: string): Promise<boolean> {
  return window.electronAPI!.novel.renameVolume(volumeId, name);
}

/** 卷批量重排落库（novel-volume-order） */
export async function saveVolumeOrder(
  updates: Array<{ id: string; sort: number }>,
): Promise<boolean> {
  return window.electronAPI!.novel.saveVolumeOrder(updates);
}

/** 要素保存（novel-entity-save，upsert：新建 / 编辑 / 别名关联共用） */
export async function saveEntity(entity: NovelEntity): Promise<boolean> {
  return window.electronAPI!.novel.saveEntity(entity);
}

/** 新增要素关联（novel-link-add） */
export async function addLink(link: NovelLink): Promise<boolean> {
  return window.electronAPI!.novel.addLink(link);
}

/** 解除要素关联（novel-link-remove） */
export async function removeLink(linkId: string): Promise<boolean> {
  return window.electronAPI!.novel.removeLink(linkId);
}

/** 新增 / 更新灵感速记（novel-note-save，upsert 语义） */
export async function saveNote(note: NovelNote): Promise<boolean> {
  return window.electronAPI!.novel.saveNote(note);
}

/** 删除灵感速记（novel-note-remove） */
export async function removeNote(noteId: string): Promise<boolean> {
  return window.electronAPI!.novel.removeNote(noteId);
}

/** 新增 / 更新伏笔条目（novel-outline-entry-save，upsert 语义） */
export async function saveOutlineEntry(entry: OutlineEntry): Promise<boolean> {
  return window.electronAPI!.novel.saveOutlineEntry(entry);
}

/** 删除伏笔条目（novel-outline-entry-remove） */
export async function removeOutlineEntry(entryId: string): Promise<boolean> {
  return window.electronAPI!.novel.removeOutlineEntry(entryId);
}
