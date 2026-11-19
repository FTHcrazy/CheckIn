/**
 * 天级相对时间（灵感 / 书卡时间戳）
 *
 * O-12 上提到窗口级：书架 IdeaRail 与编辑器全局灵感抽屉共用同一张灵感卡，
 * 时间口径必须一致，故工具函数也随卡一起下沉到窗口级 services 的兄弟目录。
 * bookshelf-utils.ts 原地 re-export，既有 import 路径不变。
 */

const clockOf = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const dayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 天级相对时间（卡片「昨天 23:41 更新」、灵感时间戳） */
export function formatDayLabel(timestamp: number, now: number = Date.now()): string {
  if (!timestamp) return "—";
  const diffDays = Math.floor(
    (new Date(dayKey(now)).getTime() - new Date(dayKey(timestamp)).getTime()) / 86_400_000,
  );
  if (diffDays <= 0) return `今天 ${clockOf(timestamp)}`;
  if (diffDays === 1) return `昨天 ${clockOf(timestamp)}`;
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 14) return "上周";
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
