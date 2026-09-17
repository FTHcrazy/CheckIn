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
