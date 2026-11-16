import { describe, expect, it } from "vitest";
import {
  formatLogFileName,
  formatLogLine,
  formatStamp,
  isExpiredLogFile,
  sanitizeSegment,
  serializeMeta,
} from "./log-format";

/**
 * 日志格式守卫（1.47.0）
 *
 * 这些断言钉的是「排查体验」而不是实现细节：
 * - 时间精确到毫秒（同一秒内的多条记录要能排序）；
 * - 级别 / 窗口 / 模块三段方括号定宽，`grep "\[ERROR\]"` 或 `awk` 切列不会错位；
 * - 正文换行必须转义 —— 一旦出现裸换行，多行日志就无法按行解析；
 * - 目录名不得被窗口名里的 `../` 带出去。
 */
describe("日志格式化", () => {
  it("时间戳精确到毫秒，且补零", () => {
    const stamp = formatStamp(new Date(2026, 0, 5, 9, 3, 7, 42));
    expect(stamp).toBe("2026-01-05 09:03:07.042");
  });

  it("按天分文件：YYYY-MM-DD.log", () => {
    expect(formatLogFileName(new Date(2026, 9, 19, 23, 59, 59))).toBe(
      "2026-10-19.log",
    );
  });

  it("一行一条：级别 / 窗口 / 模块三段定宽标识", () => {
    const line = formatLogLine({
      date: new Date(2026, 9, 19, 15, 57, 47, 123),
      level: "info",
      window: "novel",
      module: "editor",
      message: "打开章节",
      meta: { id: 12 },
    });
    expect(line).toBe(
      '2026-10-19 15:57:47.123 [INFO ] [novel] [editor] 打开章节 {"id":12}',
    );
  });

  it("级别标签等宽（INFO 后补空格，ERROR 不补）", () => {
    const build = (level: "debug" | "info" | "warn" | "error") =>
      formatLogLine({
        date: new Date(2026, 0, 1),
        level,
        window: "main",
        module: "app",
        message: "x",
      });
    expect(build("debug")).toContain("[DEBUG]");
    expect(build("info")).toContain("[INFO ]");
    expect(build("warn")).toContain("[WARN ]");
    expect(build("error")).toContain("[ERROR]");
  });

  it("正文里的换行被转义，日志不会被顶成多行", () => {
    const line = formatLogLine({
      date: new Date(2026, 0, 1),
      level: "error",
      window: "main",
      module: "process",
      message: "第一行\n第二行\r\n第三行",
    });
    expect(line).not.toContain("\n");
    expect(line).toContain("第一行\\n第二行\\n第三行");
  });

  it("空窗口名 / 空模块名有兜底，不产生 `[] []` 空洞", () => {
    const line = formatLogLine({
      date: new Date(2026, 0, 1),
      level: "info",
      window: "  ",
      module: "",
      message: "x",
    });
    expect(line).toContain("[unknown] [app]");
  });

  it("meta 序列化容错：循环引用 / undefined / 函数都不抛", () => {
    expect(serializeMeta(undefined)).toBe("");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(serializeMeta(cyclic)).toContain("[object Object]");
    expect(serializeMeta({ fn: () => 1 })).toBe(" {}");
  });
});

describe("日志清理判定", () => {
  const now = new Date(2026, 9, 19, 10, 0, 0);

  it("保留窗口内不动，超期才清", () => {
    expect(isExpiredLogFile("2026-10-18.log", now, 7)).toBe(false);
    expect(isExpiredLogFile("2026-10-12.log", now, 7)).toBe(false);
    expect(isExpiredLogFile("2026-10-11.log", now, 7)).toBe(true);
  });

  it("非日期文件（ipc.log / 手放的 txt）一律不删", () => {
    expect(isExpiredLogFile("ipc.log", now, 7)).toBe(false);
    expect(isExpiredLogFile("notes.txt", now, 7)).toBe(false);
    expect(isExpiredLogFile("2026-10-19.log.bak", now, 7)).toBe(false);
  });

  it("保留 0 天时昨天的文件即过期（边界不越界删除当天）", () => {
    expect(isExpiredLogFile("2026-10-19.log", now, 0)).toBe(false);
    expect(isExpiredLogFile("2026-10-18.log", now, 0)).toBe(true);
  });
});

describe("日志目录名", () => {
  it("窗口名只保留安全字符，路径分隔符被中和", () => {
    expect(sanitizeSegment("novel")).toBe("novel");
    // 斜杠被替换成下划线 → 单段目录名，不可能逃出 logs 根
    expect(sanitizeSegment("../../etc")).toBe(".._.._etc");
    expect(sanitizeSegment("globalSetting")).toBe("globalSetting");
  });

  it("全非法字符时有兜底名", () => {
    expect(sanitizeSegment("")).toBe("unknown");
    expect(sanitizeSegment("中文")).toBe("unknown");
  });
});
