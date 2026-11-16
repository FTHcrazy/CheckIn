/**
 * 日志格式化的纯函数（不 import electron / db，可在 jsdom 下单测）
 *
 * 这些函数决定了「日志文件里长什么样」，是整个排查体验的地基：
 * - 每行以 `时间(毫秒) [级别] [窗口] [模块]` 开头，列位置固定，便于 grep / awk 切列；
 * - 正文里的换行一律转义成字面 `\n` —— 一行一条记录是多行日志能被工具处理的前提。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** 本地时间戳，精确到毫秒：`2026-10-19 15:57:47.123` */
export function formatStamp(date: Date = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    pad(date.getMilliseconds(), 3)
  );
}

/** 当天日志文件名：`2026-10-19.log` */
export function formatLogFileName(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`;
}

/** meta 序列化：循环引用 / BigInt 等一律降级成字符串，日志自身绝不能抛错 */
export function serializeMeta(meta: unknown): string {
  if (meta === undefined) return "";
  try {
    const text = JSON.stringify(meta);
    // JSON.stringify(undefined) / 函数 / symbol 会返回 undefined
    return text === undefined ? "" : ` ${text}`;
  } catch {
    try {
      return ` ${String(meta)}`;
    } catch {
      return " [unserializable]";
    }
  }
}

/**
 * 组装一行日志。
 *
 * 形如：`2026-10-19 15:57:47.123 [INFO ] [novel] [editor] 打开章节 {"id":12}`
 * 级别补空格对齐（`INFO ` / `WARN ` / `ERROR` / `DEBUG`），`grep "\[ERROR\]"` 时列不错位。
 */
export function formatLogLine(params: {
  date?: Date;
  level: LogLevel;
  window: string;
  module: string;
  message: string;
  meta?: unknown;
}): string {
  const { date = new Date(), level, window, module, message, meta } = params;
  const levelTag = level.toUpperCase().padEnd(5);
  const safeWindow = window.trim() || "unknown";
  const safeModule = module.trim() || "app";
  const oneLine = message.replace(/\r?\n/g, "\\n");
  return `${formatStamp(date)} [${levelTag}] [${safeWindow}] [${safeModule}] ${oneLine}${serializeMeta(meta)}`;
}

/** 文件名里的日期是否早于保留窗口（用于清理） */
export function isExpiredLogFile(
  fileName: string,
  now: Date,
  retentionDays: number,
): boolean {
  const matched = /^(\d{4})-(\d{2})-(\d{2})\.log$/.exec(fileName);
  if (!matched) return false;
  const fileDate = new Date(
    Number(matched[1]),
    Number(matched[2]) - 1,
    Number(matched[3]),
  );
  if (Number.isNaN(fileDate.getTime())) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor(
    (today.getTime() - fileDate.getTime()) / 86_400_000,
  );
  return diffDays > Math.max(0, retentionDays);
}

/** 目录名只允许安全字符，防止窗口名带路径分隔符逃逸 */
export function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 32);
  // 只剩下划线/点（例如全中文的窗口名被整体替换）时给个可读兜底，
  // 否则目录会叫 `__`，比 `unknown` 更难认。
  if (!/[a-zA-Z0-9]/.test(cleaned)) return "unknown";
  return cleaned;
}
