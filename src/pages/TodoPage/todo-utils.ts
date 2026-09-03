import type { TodoItem } from "./todo-db";

export const formatWorkHour = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "";
  return `${Number(value).toFixed(1).replace(/\.0$/, "")}h`;
};

export function getTotalRemainingWorkHour(
  id: number,
  list: TodoItem[],
): number {
  const current = list.find((item) => item.id === id);
  const children = list.filter((item) => item.parent_id === id);
  const currentValue =
    current && current.done === 0 && current.work_hour !== null
      ? Number(current.work_hour)
      : 0;
  const childrenValue = children.reduce(
    (sum, child) => sum + getTotalRemainingWorkHour(child.id, list),
    0,
  );
  return currentValue + childrenValue;
}

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
