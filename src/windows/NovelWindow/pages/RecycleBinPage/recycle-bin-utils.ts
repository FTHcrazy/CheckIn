/**
 * 回收站页面的纯函数（参数进、结果出，不碰 IPC 与 DOM）。
 *
 * 页面把「显示什么」全部交给这里，"调哪条通道" 交给 `hooks/useTrashBin`——
 * 这样筛选 / 计数 / 文案这些最容易被改坏的规则可以单测钉住。
 */
import { formatThousands } from "@/shared/utils/format";
import type { NovelTrashItemDTO, NovelTrashKind } from "@/shared/types/electron";

/** 类型筛选：`all` + 三种真实类型（与 `NovelTrashKind` 一一对应） */
export type TrashKindFilter = "all" | NovelTrashKind;

/** 类型标签：同一个列表里混着作品 / 卷 / 章节，必须一眼能分辨 */
export const TRASH_KIND_LABEL: Record<NovelTrashKind, string> = {
  work: "作品",
  volume: "卷",
  chapter: "章节",
};

/** 剩余天数的语义档：正常 / 3 天内（警示）/ 今天到期（危险） */
export type TrashUrgency = "normal" | "soon" | "urgent";

/**
 * 选中判据：`kind:id`。
 *
 * ⚠️ 只用 id 会把不同域撞在一起 —— 作品、卷、章节各自的主键互不相干，
 * 回收站里同时出现 `id = 3` 的作品和章节是常态。
 */
export function trashKey(item: Pick<NovelTrashItemDTO, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

/** 删除时间：列表里只到分钟（「删除于 10-22 21:14」），跨年也不影响判断 */
export function formatDeletedAt(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * 条目副标题：作品看规模，卷 / 章看「它原来属于哪儿」——
 * 后者才是找回时判断「这是哪一章」的依据。
 */
export function trashMetaText(item: NovelTrashItemDTO): string {
  const at = `删除于 ${formatDeletedAt(item.deletedAt)}`;
  const words = `${formatThousands(item.words)} 字`;
  if (item.kind === "work") {
    return `${item.volumes} 卷 · ${item.chapters} 章 · ${words} · ${at}`;
  }
  if (item.kind === "volume") {
    return `《${item.workName}》· ${item.chapters} 章 · ${words} · ${at}`;
  }
  // 书名号后直接接第一个分隔符（`《书名》· 第二卷`），比「《书名》 · 第二卷」紧；
  // 缺卷名时不留一个孤零零的空槽
  if (item.volumeName) {
    return `《${item.workName}》· ${item.volumeName} · ${words} · ${at}`;
  }
  return `《${item.workName}》· ${words} · ${at}`;
}

/** 各类型的条数（`all` = 总数），供分段切换与统计卡使用 */
export function countTrashKinds(
  items: readonly NovelTrashItemDTO[],
): Record<TrashKindFilter, number> {
  const counts: Record<TrashKindFilter, number> = {
    all: items.length,
    work: 0,
    volume: 0,
    chapter: 0,
  };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

/**
 * 类型 + 关键词过滤。
 *
 * 关键词同时匹配条目名与所属作品名 —— 回收站里的章节名往往是「第四章」这种
 * 毫无辨识度的短名，光靠它根本找不到东西，用户真正记得的是书名。
 */
export function filterTrashItems(
  items: readonly NovelTrashItemDTO[],
  kind: TrashKindFilter,
  keyword: string,
): NovelTrashItemDTO[] {
  const needle = keyword.trim().toLowerCase();
  return items.filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (!needle) return true;
    return (
      item.name.toLowerCase().includes(needle) ||
      item.workName.toLowerCase().includes(needle)
    );
  });
}

/** 剩余可恢复天数 → 文案 + 语义档（剩余 3 天内要显性提醒，否则「和刚删的一样」） */
export function daysLeftInfo(item: NovelTrashItemDTO): {
  text: string;
  urgency: TrashUrgency;
} {
  if (item.expired) return { text: "已过期", urgency: "urgent" };
  if (item.daysLeft <= 0) return { text: "今天内到期", urgency: "urgent" };
  return {
    text: `剩 ${item.daysLeft} 天`,
    urgency: item.daysLeft <= 3 ? "soon" : "normal",
  };
}

/** 最近一次删除（统计卡第二列）：空回收站返回 null，由页面渲染成「暂无」 */
export function latestDeleted(
  items: readonly NovelTrashItemDTO[],
): { at: string; workName: string } | null {
  if (items.length === 0) return null;
  const latest = items.reduce((max, item) =>
    item.deletedAt > max.deletedAt ? item : max,
  );
  return {
    at: formatDeletedAt(latest.deletedAt),
    // 作品条目自身没有 workName，标题就是它自己
    workName: latest.kind === "work" ? latest.name : latest.workName,
  };
}

/** 可见条目是否已全选（空列表不算全选，否则表头复选框会误亮） */
export function isAllSelected(
  visible: readonly NovelTrashItemDTO[],
  selected: ReadonlySet<string>,
): boolean {
  return visible.length > 0 && visible.every((item) => selected.has(trashKey(item)));
}

/** 单条勾选：返回新集合（不改原对象，避免 React 漏更新） */
export function toggleSelection(
  selected: ReadonlySet<string>,
  key: string,
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  if (checked) next.add(key);
  else next.delete(key);
  return next;
}

/**
 * 全选 / 取消全选：只增删**当前可见**的条目。
 *
 * 筛选后点「全选」不应该把看不见的条目一起选走 —— 那会让「批量彻底删除」
 * 顺手销毁用户没在看的条目。
 */
export function toggleSelectAll(
  selected: ReadonlySet<string>,
  visible: readonly NovelTrashItemDTO[],
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const item of visible) {
    const key = trashKey(item);
    if (checked) next.add(key);
    else next.delete(key);
  }
  return next;
}

/** 按选中集合取出条目（保持传入顺序，批量操作按列表顺序执行） */
export function pickSelected(
  items: readonly NovelTrashItemDTO[],
  selected: ReadonlySet<string>,
): NovelTrashItemDTO[] {
  return items.filter((item) => selected.has(trashKey(item)));
}
