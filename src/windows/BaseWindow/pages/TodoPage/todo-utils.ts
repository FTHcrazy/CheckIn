export const formatWorkHour = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "";
  return `${Number(value).toFixed(1).replace(/\.0$/, "")}h`;
};

export const parseWorkHourTag = (rawText: string) => {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { content: "", workHour: null as number | null };
  }

  const match = trimmed.match(/(^|\s)#\s*(\d+(?:\.\d+)?)\s*h\b/i);
  if (!match) {
    return { content: trimmed, workHour: null as number | null };
  }

  const value = Number(match[2]);
  if (!Number.isFinite(value) || value < 0) {
    return { content: trimmed, workHour: null as number | null };
  }

  const cleaned = trimmed
    .replace(/(^|\s)#\s*(\d+(?:\.\d+)?)\s*h\b/gi, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    content: cleaned,
    workHour: value,
  };
};

/** 排序所需的最小结构：只关心完成状态 */
interface SortableByDone {
  done: number;
}

/**
 * 子项排序：未完成在前、已完成沉底，同组内保持原有顺序。
 *
 * 用「分区后拼接」而不是 sort：
 * - sort 需要比较函数，而完成状态只有 0/1 两个值，无法表达"保持原顺序"；
 *   现代引擎虽保证 sort 稳定，但依赖它会让意图不明确
 * - 拼接同时对「全部未完成」「全部已完成」的常见情况短路，直接复用原数组引用
 */
export function sortChildrenByDone<T extends SortableByDone>(children: T[]): T[] {
  const pending: T[] = [];
  const finished: T[] = [];
  children.forEach((child) => {
    (child.done === 1 ? finished : pending).push(child);
  });
  if (pending.length === 0 || finished.length === 0) return children;
  return [...pending, ...finished];
}
