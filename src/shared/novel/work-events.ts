/**
 * 作品元数据（书名 / 题材 / 封面 / 删除）跨页同步事件（2.56.0）
 *
 * 为什么需要它：书架与编辑器是同窗口的两个常驻页面，各自持一份 bundle
 * 内存快照。书架右键改完书名 / 题材 / 封面（或删掉一部书）后，编辑器的
 * `bundle.works` 不会自己变 —— 顶栏的作品名、AI 的题材锚点、作品列表都还是
 * 旧值，作者会以为刚才那下没生效。
 *
 * 反方向（编辑器 → 书架）不需要事件：书架每次变得可见时本来就会静默
 * `refresh(true)`（见 BookshelfPage 的 visible effect）。
 *
 * 与 `novel-work-changed` 的区别：那条是「主窗口切到了哪本书 / 哪章」的
 * 上下文广播（行囊 / 关系窗口跟进用），负载带 chapterId + nonce；这里是
 * 「某一行作品数据本身变了」的行级补丁，两者不能混用。
 *
 * 负载只带**变化字段**，不带整行作品：编辑器侧的 NovelWork 还没有封面
 * 字段，整行覆盖会把类型口径悄悄换掉；行级补丁则天然兼容将来新增字段。
 */
import type { NovelWorkDTO } from "@/shared/types/electron";

/** 事件名（本窗口 CustomEvent 与跨窗口 broadcast 共用同一个名字） */
export const NOVEL_WORK_META_EVENT = "novel-work-meta-changed";

/** 允许跨页同步的作品字段（封面是可空的 data URL） */
export type WorkMetaPatch = Partial<
  Pick<NovelWorkDTO, "name" | "genre" | "cover">
>;

export interface NovelWorkMetaDetail {
  /** upsert = 字段变了；remove = 作品被移入回收站 */
  action: "upsert" | "remove";
  workId: string;
  /** action=upsert 时的变化字段；缺省字段保持不变 */
  patch?: WorkMetaPatch;
}

/**
 * 广播「作品元数据变了」。
 *
 * 两条路径都发：只发 CustomEvent 时其它窗口收不到；只发 broadcast 时同窗口
 * 内的监听不保证回环（广播刻意排除发送者）。与 note-events 同一套约定。
 */
export function notifyWorkMetaChanged(detail: NovelWorkMetaDetail): void {
  window.dispatchEvent(new CustomEvent(NOVEL_WORK_META_EVENT, { detail }));
  void window.electronAPI?.windowAPI.broadcast(NOVEL_WORK_META_EVENT, detail);
}
