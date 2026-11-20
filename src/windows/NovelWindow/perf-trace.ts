/**
 * NovelWindow 性能打点工具（本地调试专用）
 *
 * 设计目标：
 * - **只在本地调试场景启用**：所有打点统一走 `rendererLog.debug`，主进程侧
 *   受 `settings.level` 门控过滤（默认 `info`，debug 权重更低）。正式环境默认
 *   不落盘、不产生任何 IO / 序列化开销；开发者把日志级别调到 `debug` 即启用，
 *   无需单独开关，也与现有「一个日志文件、靠模块列区分」的体系完全一致。
 * - **失败绝对静默**：打点不能反过来拖垮写作链路（`rendererLog` 内部已
 *   对桥缺失 / 异常静默降级，这里不再 try/catch 之外的额外分支）。
 * - **统一输出口径**：`module`（模块名）、`action`（操作标识）、`durationMs`
 *   （耗时，毫秒）、`status`（成功 / 失败 / 取消）作为固定 meta 字段，便于
 *   在日志里 `grep "module=xxx"` 后按 `durationMs` 排序做性能分析。
 *
 * ⚠️ 量控制（对齐 AGENTS §6.3.1 第 6 条）：只打「低频、关键」的链路节点，
 * 严禁把打点塞进每次键入 / 每帧渲染 / 高频状态变更里 —— 那会把日志刷爆。
 */
import { rendererLog } from "@/shared/log/renderer-logger";

/** 打点 meta 的统一字段（module / action 固定，便于 grep 切列） */
export interface PerfMeta {
  /** 操作标识：动词短语，如 "page-load" / "chapter-select" / "autosave" */
  action: string;
  /** 耗时（毫秒），未测量时不传 */
  durationMs?: number;
  /** 结果状态：成功 / 失败 / 取消 / 跳过 */
  status?: "ok" | "error" | "cancel" | "skip";
  /** 附加信息（id、数量等轻量字段，禁放正文 / 大对象） */
  extra?: Record<string, unknown>;
}

/** 统一打点出口：失败静默，不抛出、不阻塞 */
export function tracePerf(
  module: string,
  action: string,
  detail?: {
    durationMs?: number;
    status?: PerfMeta["status"];
    extra?: Record<string, unknown>;
  },
): void {
  rendererLog.debug(module, `perf:${action}`, {
    action,
    ...(detail?.durationMs !== undefined
      ? { durationMs: Math.round(detail.durationMs) }
      : {}),
    ...(detail?.status ? { status: detail.status } : {}),
    ...(detail?.extra ? { extra: detail.extra } : {}),
  });
}
