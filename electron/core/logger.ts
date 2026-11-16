/**
 * 本地日志（主进程侧）
 *
 * 设计目标（1.47.0）：
 * - **按用户隔离**：`{userDataDir}/logs/`，未登录 / 登出落 `{userData}/logs/_anonymous/`。
 *   不同登录用户的日志永远不混在一个目录里。
 * - **按窗口分目录**：`{logsRoot}/{窗口名}/YYYY-MM-DD.log`，排查时先按窗口收敛范围。
 * - **每行自带定位标识**：`时间(毫秒) [级别] [窗口] [模块] 正文 {meta}`。
 * - **一个窗口一个文件**：IPC 通信记录不再单独成 `ipc.log`，而是按 DEBUG 级别
 *   并入所属窗口当天的 `YYYY-MM-DD.log`——排查时「业务日志 + 通信日志」在同一条
 *   时间轴上，不必再对着两个文件拼时序。
 *
 * 为什么不用 log4js：主进程产物是单文件 CJS bundle，引入第三方库要么打进 bundle
 * 增加体积、要么进 external 后必须随 asar 一起分发；而这里只需要「按天分文件 +
 * 追加写 + 分级」，自建 200 行足够，且能直接复用 `getUserDataDir()` 的隔离规则。
 *
 * ⚠️ 写入一律走 `createWriteStream(flags: "a")` 队列，不用 `appendFileSync`：
 * 主进程在保存 / 扫描期间会连续打日志，同步写会卡住事件循环（UI 掉帧）。
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getCurrentUserEmail, getUserDataDir } from "./db";
import {
  formatLogFileName,
  formatLogLine,
  isExpiredLogFile,
  sanitizeSegment,
  type LogLevel,
} from "./log-format";

export {
  formatLogFileName,
  formatLogLine,
  formatStamp,
  isExpiredLogFile,
} from "./log-format";
export type { LogLevel } from "./log-format";

/** 级别数值：只有 >= 当前阈值才落盘（debug 用于 IPC / 细节追踪） */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogSettings {
  /** 主日志文件的最低级别 */
  level: LogLevel;
  /** 是否记录 IPC 通信（DEBUG 级别，并入所属窗口当天日志） */
  ipc: boolean;
  /** 日志保留天数，超期文件在启动/跨天时清理 */
  retentionDays: number;
}

export const DEFAULT_LOG_SETTINGS: LogSettings = {
  level: "info",
  ipc: true,
  retentionDays: 7,
};

/** 未登录时的日志根目录名（不参与用户目录 hash） */
const ANONYMOUS_DIR = "_anonymous";

let settings: LogSettings = { ...DEFAULT_LOG_SETTINGS };

// ── 格式化：纯函数在 log-format.ts（可单测），这里只做落盘 ──────────

// ── 写入通道 ────────────────────────────────────────────────────

interface StreamHandle {
  stream: fs.WriteStream;
  /** 该句柄对应的文件名（跨天要换文件） */
  fileName: string;
}

const streams = new Map<string, StreamHandle>();
/** 已清理过的日期（每天只扫一次目录，不必每次写都扫） */
let lastPrunedDay = "";

/** 当前日志根目录；未登录走匿名目录 */
function resolveLogRoot(): string {
  const email = getCurrentUserEmail();
  if (!email) {
    return path.join(app.getPath("userData"), "logs", ANONYMOUS_DIR);
  }
  return path.join(getUserDataDir(email), "logs");
}

function streamFor(dir: string, fileName: string): fs.WriteStream {
  const key = path.join(dir, fileName);
  const cached = streams.get(key);
  if (cached) return cached.stream;

  fs.mkdirSync(dir, { recursive: true });
  const stream = fs.createWriteStream(key, { flags: "a", encoding: "utf8" });
  // 磁盘满 / 权限变化不该拖垮应用：吞掉错误，只留一条控制台提示
  stream.on("error", (error) => {
    console.error("[logger] 日志写入失败：", error);
  });
  streams.set(key, { stream, fileName });
  return stream;
}

/** 跨天时把旧句柄关掉，避免句柄一直指向昨天的文件 */
function dropStaleStreams(dir: string, keepFileNames: readonly string[]): void {
  for (const [key, handle] of streams) {
    if (path.dirname(key) !== dir) continue;
    if (keepFileNames.includes(handle.fileName)) continue;
    handle.stream.end();
    streams.delete(key);
  }
}

/** 每天第一次写入时清理超期文件（只扫窗口目录下的一层 .log） */
function pruneIfNeeded(root: string, now: Date): void {
  const dayKey = formatLogFileName(now);
  if (lastPrunedDay === `${root}#${dayKey}`) return;
  lastPrunedDay = `${root}#${dayKey}`;
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      for (const file of fs.readdirSync(dir)) {
        if (!isExpiredLogFile(file, now, settings.retentionDays)) continue;
        try {
          fs.rmSync(path.join(dir, file), { force: true });
        } catch {
          // 单个文件删不掉不影响后续
        }
      }
    }
  } catch {
    // 目录还不存在（首次运行）属正常
  }
}

function writeLine(
  level: LogLevel,
  windowName: string,
  moduleName: string,
  message: string,
  meta: unknown,
): void {
  try {
    const root = resolveLogRoot();
    const now = new Date();
    const dir = path.join(root, sanitizeSegment(windowName));
    const fileName = formatLogFileName(now);
    pruneIfNeeded(root, now);
    dropStaleStreams(dir, [fileName]);
    streamFor(dir, fileName).write(
      `${formatLogLine({
        date: now,
        level,
        window: windowName,
        module: moduleName,
        message,
        meta,
      })}\n`,
    );
  } catch (error) {
    // 日志系统自身故障必须静默降级到控制台
    console.error("[logger] 写日志失败：", error);
  }
}

// ── 对外 API ────────────────────────────────────────────────────

/**
 * 主日志：受 `settings.level` 控制
 *
 * 绝大多数场景用它。「高价值但默认级别看不见」的线索（IPC / AI 调用）走
 * `logAlways`，别把 `level` 调成 debug 当成唯一出路 —— 那会顺手把所有模块的
 * 流水都打开，一天几十万行。
 */
export function log(
  level: LogLevel,
  windowName: string,
  moduleName: string,
  message: string,
  meta?: unknown,
): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[settings.level]) return;
  writeLine(level, windowName, moduleName, message, meta);
}

/**
 * 无视 `settings.level` 阈值的一条记录（仍写进所属窗口当天日志）。
 *
 * 用量极克制：目前只有 IPC 与 AI 调用用它，理由是「默认 info 级别下如果它们
 * 全消失，排查调不通 / 模型乱答时就没有任何线索」。**不要**拿它当普通日志用——
 * 它绕过了用户亲手设的级别，滥用等于把级别设置废掉。
 */
export function logAlways(
  level: LogLevel,
  windowName: string,
  moduleName: string,
  message: string,
  meta?: unknown,
): void {
  writeLine(level, windowName, moduleName, message, meta);
}

/**
 * IPC 通信日志：并入所属窗口当天日志，模块名固定 `ipc`。
 *
 * 不受主日志级别阈值过滤（只看 `settings.ipc` 开关）——否则默认 info 级别下
 * 通信记录会全部消失，而它恰恰是排查「渲染层调不通主进程」的唯一线索。
 */
export function logIpc(params: {
  window: string;
  channel: string;
  direction: "invoke" | "send" | "reply" | "error";
  ok?: boolean;
  durationMs?: number;
  detail?: unknown;
}): void {
  if (!settings.ipc) return;
  const { window: win, channel, direction, ok, durationMs, detail } = params;
  const parts = [`${direction} ${channel}`];
  if (ok === false) parts.push("FAILED");
  if (typeof durationMs === "number") parts.push(`${Math.round(durationMs)}ms`);
  // 与 AI 记录共用同一条「绕过 level 阈值」的出口，别再各写一份
  logAlways(ok === false ? "warn" : "debug", win, "ipc", parts.join(" "), detail);
}

/** 生成绑定了窗口名的便捷 logger（窗口创建处用它，省得每处都传窗口） */
export function windowLogger(windowName: string) {
  return {
    debug: (moduleName: string, message: string, meta?: unknown) =>
      log("debug", windowName, moduleName, message, meta),
    info: (moduleName: string, message: string, meta?: unknown) =>
      log("info", windowName, moduleName, message, meta),
    warn: (moduleName: string, message: string, meta?: unknown) =>
      log("warn", windowName, moduleName, message, meta),
    error: (moduleName: string, message: string, meta?: unknown) =>
      log("error", windowName, moduleName, message, meta),
  };
}

/** 更新配置（Settings 窗口改级别 / 保留天数时经 IPC 调用） */
export function setLogSettings(next: Partial<LogSettings>): LogSettings {
  const level = next.level && next.level in LEVEL_WEIGHT ? next.level : settings.level;
  const retentionDays = Number.isFinite(next.retentionDays)
    ? Math.min(90, Math.max(1, Math.trunc(next.retentionDays as number)))
    : settings.retentionDays;
  settings = {
    level,
    ipc: typeof next.ipc === "boolean" ? next.ipc : settings.ipc,
    retentionDays,
  };
  return { ...settings };
}

export function getLogSettings(): LogSettings {
  return { ...settings };
}

/** 当前日志根目录（给「打开日志目录」用）；不存在时按当前身份返回预期路径 */
export function getLogRoot(): string {
  return resolveLogRoot();
}

/** 关闭全部句柄：`will-quit` 调一次，保证最后几行落盘 */
export function closeLogger(): void {
  for (const { stream } of streams.values()) {
    try {
      stream.end();
    } catch {
      // 进程退出阶段，忽略
    }
  }
  streams.clear();
}

/**
 * 启动期引导：`initDb()` 之后调用一次。
 *
 * ⚠️ 必须处理三件事：
 * 1. 注册晚于 `switchUserDb` 的补写（启动期有缓存用户时库里已切好）；
 * 2. 同一次登录会触发两次 `onSwitched`（`user-login` + `login-confirm`），
 *    这里只换根目录、不重开文件，天然幂等；
 * 3. 登出**不触发** lifecycle（`auth-logout` 只删 authDb 的用户行），
 *    由 `main.ts` 显式调 `resetToAnonymous()`。
 */
export function bootstrapLogger(): void {
  const email = getCurrentUserEmail();
  log("info", "main", "logger", "日志系统就绪", {
    root: resolveLogRoot(),
    anonymous: !email,
    settings,
  });
}

/**
 * 身份变化时切换日志根目录。
 *
 * 不需要关闭旧句柄（旧用户的文件句柄留着也是追加写，不会串数据），
 * 但要把「已清理日期」清空，否则切用户后会跳过新目录的清理。
 */
export function resetLogRoot(reason: string): void {
  lastPrunedDay = "";
  const root = resolveLogRoot();
  log("info", "main", "logger", `日志目录切换：${reason}`, { root });
}
