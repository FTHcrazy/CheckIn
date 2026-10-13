/**
 * 灵感速记（novel_notes）跨页同步事件（P2-4）
 *
 * 为什么需要它：书架与编辑器是同窗口的两个**常驻**页面（display 切换显隐，
 * 都不卸载），各自持一份 `bundle.notes` 内存快照。书架侧增删改灵感后，
 * 编辑器的快照不会自己变 —— 灵感面板显示旧内容，作者会基于旧笔记续写。
 *
 * 书架侧写完就广播本事件；编辑器侧（useNovelData）订阅后就地 patch
 * `bundle.notes`，不触发整体重载（重载会打断正在编辑的正文与面板状态）。
 *
 * 反方向（编辑器 → 书架）不需要事件：书架在每次变得可见时本来就静默
 * `refresh(true)` 重算（见 BookshelfPage 的 visible effect）。
 *
 * 事件定义放 `src/shared/novel/`：灵感是 novel 域数据，书架与编辑器都只是
 * 它的展示面；未来若第三个窗口也要消费灵感，直接订阅即可（P3-2 同方向）。
 */
import type { NovelNoteDTO } from "@/shared/types/electron";

/** 事件名（本窗口 CustomEvent 与跨窗口 broadcast 共用同一个名字） */
export const NOVEL_NOTE_EVENT = "novel-note-changed";

/** 事件负载 */
export interface NovelNoteChangedDetail {
  /** upsert = 新增或整行更新；remove = 按 noteId 摘除 */
  action: "upsert" | "remove";
  /** 该行归属的作品 id（remove 时缺省 —— 监听方按 noteId 过滤即可） */
  workId?: string;
  /** action=upsert 时的完整行（NovelNoteDTO 与编辑器侧 NovelNote 同构） */
  note?: NovelNoteDTO;
  /** action=remove 时要摘除的行 id */
  noteId?: string;
}

/**
 * 广播「灵感变了」。
 *
 * 两条路径都必须发：只发 CustomEvent 时其它窗口收不到；只发 broadcast 时
 * 同窗口内的监听不保证回环（广播刻意排除发送者）。两边各一次，
 * 与行囊域事件（pack-config 的 notify* 系列）同一套约定。
 */
export function notifyNoteChanged(detail: NovelNoteChangedDetail): void {
  window.dispatchEvent(new CustomEvent(NOVEL_NOTE_EVENT, { detail }));
  void window.electronAPI?.windowAPI.broadcast(NOVEL_NOTE_EVENT, detail);
}
