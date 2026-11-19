/**
 * 灵感库筛选纯函数（O-12 上提到窗口级）
 *
 * 书架与编辑器全局抽屉必须按同一套三态判据筛选/计数，否则「归属到本书后
 * 立即出现在本书列表」这条单向流闭合会被两处不同的口径打断。
 * bookshelf-utils.ts 原地 re-export，既有 import 路径不变。
 */
import type { NovelNoteDTO } from "@/shared/types/electron";

export type IdeaFilter = "all" | "unassigned" | "pinned" | "archived";

/** 未归属灵感：workId 为空串（跨作品收集池） */
export const isUnassignedNote = (note: NovelNoteDTO): boolean => !note.workId;

export function countIdeaNotes(notes: NovelNoteDTO[]): Record<IdeaFilter, number> {
  const unassigned = notes.filter(isUnassignedNote).length;
  return {
    all: notes.length,
    unassigned,
    pinned: notes.filter((note) => note.pinned).length,
    archived: notes.length - unassigned,
  };
}

export function filterIdeaNotes(
  notes: NovelNoteDTO[],
  filter: IdeaFilter,
  keyword: string,
): NovelNoteDTO[] {
  const trimmed = keyword.trim().toLowerCase();
  return notes.filter((note) => {
    if (filter === "unassigned" && !isUnassignedNote(note)) return false;
    if (filter === "archived" && isUnassignedNote(note)) return false;
    if (filter === "pinned" && !note.pinned) return false;
    if (trimmed && !note.content.toLowerCase().includes(trimmed)) return false;
    return true;
  });
}
