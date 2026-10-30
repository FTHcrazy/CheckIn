/**
 * 一致性扫描执行器（R-AI-10a）
 *
 * 把「扫描跑在哪」这件事从 store 里剥出来，只做两件事：
 * 1. 优先在 Worker 里跑（`workers/consistency.worker.ts`），主线程全程可交互；
 * 2. Worker 起不来（无 Worker 支持 / 打包后脚本加载失败 / 线程崩溃）时退回
 *    主线程分片——功能不降级，只降速度。降级是**静默的**，因为作者不需要
 *    知道校对跑在哪条线程；只在控制台留一条 warn 方便排障。
 *
 * 协议分两段投递（详见 worker 文件头）：start 建索引 → 逐批 chapters →
 * finish 出结果。每收到一次 progress 才投下一批，天然形成背压：
 * worker 没消化完，主线程不会继续往里灌。
 */
import {
  createConsistencyScanner,
  type ConsistencyChapterInput,
  type ConsistencyEntityInput,
  type ConsistencyIssue,
  type ConsistencyLevelInput,
} from "@/shared/novel/consistency";
import type {
  ConsistencyWorkerRequest,
  ConsistencyWorkerResponse,
} from "../workers/consistency.worker";

/**
 * 单批投给 worker 的章数。
 *
 * 不受主线程预算约束（worker 独占一个线程，扫 50 章也就几十毫秒），
 * 只受「结构化克隆峰值」约束：50 章 ≈ 十几万字，复制成本可忽略，
 * 而 3000 章的书只产生 60 次来回，进度条更新足够平滑。
 */
const WORKER_CHUNK = 50;

/**
 * 主线程兜底时的单批章数。
 *
 * 比 worker 小一个数量级：主线程每批只能占用「一帧的空隙」，
 * 8 章 ≈ 几十毫秒，让出后敲字不掉帧。
 */
const INLINE_BATCH = 8;

export interface ConsistencyScanParams {
  chapters: ConsistencyChapterInput[];
  entities: ConsistencyEntityInput[];
  realmLevels: ConsistencyLevelInput[];
  /** 已扫章数 / 总章数（每批一次） */
  onProgress: (scanned: number, total: number) => void;
  onDone: (issues: ConsistencyIssue[]) => void;
  /** 两条路都失败时才会调用（当前实现里基本不可达，留作兜底出口） */
  onError?: (error: Error) => void;
}

/** 中止句柄：worker 直接 terminate，主线程路径取消下一次让出 */
export interface ConsistencyScanHandle {
  cancel: () => void;
}

/** 让出主线程：优先 idle 回调，退化到 setTimeout（jsdom / 老 Chromium 兜底） */
function scheduleIdle(task: () => void): () => void {
  const host = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof host.requestIdleCallback === "function") {
    const handle = host.requestIdleCallback(task, { timeout: 300 });
    return () => host.cancelIdleCallback?.(handle);
  }
  const handle = globalThis.setTimeout(task, 0);
  return () => globalThis.clearTimeout(handle);
}

/**
 * 启动一次全书扫描。
 *
 * 同一时刻只该有一个扫描在跑（由 store 保证）；本函数不持有跨次状态，
 * 每次调用都是独立的一次扫描。
 */
export function startConsistencyScan(params: ConsistencyScanParams): ConsistencyScanHandle {
  let cancelled = false;
  let worker: Worker | null = null;
  let stopInline: (() => void) | null = null;

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    worker?.terminate();
    worker = null;
    stopInline?.();
    stopInline = null;
  };

  /** worker 不可用 / 半路挂掉：退回主线程分片，从头重扫 */
  const fallbackToInline = (reason?: unknown) => {
    worker?.terminate();
    worker = null;
    if (cancelled) return;
    if (reason) {
      console.warn("[consistency] 校对线程不可用，退回主线程分片扫描", reason);
    }
    stopInline = startInlineScan(params, () => cancelled);
  };

  const total = params.chapters.length;
  if (total === 0) {
    params.onDone([]);
    return { cancel };
  }

  if (typeof Worker !== "function") {
    fallbackToInline();
    return { cancel };
  }

  try {
    worker = new Worker(new URL("../workers/consistency.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch (error) {
    fallbackToInline(error);
    return { cancel };
  }

  // 持有局部引用：cancel 会把 worker 置 null，但回调仍需要能 terminate 这一只
  const active = worker;
  let sent = 0;

  const sendNextChunk = () => {
    const end = Math.min(sent + WORKER_CHUNK, total);
    const chunk = params.chapters.slice(sent, end);
    sent = end;
    const message: ConsistencyWorkerRequest = { type: "chapters", chapters: chunk };
    active.postMessage(message);
  };

  active.onmessage = (event: MessageEvent<ConsistencyWorkerResponse>) => {
    if (cancelled) return;
    const data = event.data;

    if (data.type === "progress") {
      params.onProgress(data.scanned, total);
      // 还有没投的章就投下一批，否则收尾
      if (sent < total) sendNextChunk();
      else active.postMessage({ type: "finish" } satisfies ConsistencyWorkerRequest);
      return;
    }

    if (data.type === "done") {
      active.terminate();
      worker = null;
      params.onDone(data.issues);
      return;
    }

    fallbackToInline(new Error(data.message || "校对线程异常"));
  };

  active.onerror = (event) => {
    // 模块脚本加载失败（打包后路径/协议问题）会走到这里：必须兜住，
    // 否则作者看到的是「进度条停住」，而不是「扫完但慢一点」。
    fallbackToInline(new Error(event.message || "校对线程启动失败"));
  };

  active.postMessage({
    type: "start",
    entities: params.entities,
    realmLevels: params.realmLevels,
  } satisfies ConsistencyWorkerRequest);
  sendNextChunk();

  return { cancel };
}

/** 主线程分片兜底：与 worker 同一套扫描器，只是每批之间让出 */
function startInlineScan(
  params: ConsistencyScanParams,
  isCancelled: () => boolean,
): () => void {
  const total = params.chapters.length;
  const scanner = createConsistencyScanner({
    entities: params.entities,
    realmLevels: params.realmLevels,
  });
  let cursor = 0;
  let stopWaiting: (() => void) | null = null;

  const pump = () => {
    if (isCancelled()) return;
    try {
      const end = Math.min(cursor + INLINE_BATCH, total);
      for (; cursor < end; cursor += 1) {
        scanner.scanChapter(params.chapters[cursor]);
      }
      params.onProgress(cursor, total);

      if (cursor < total) {
        stopWaiting = scheduleIdle(pump);
        return;
      }
      stopWaiting = null;
      params.onDone(scanner.finalize());
    } catch (error) {
      stopWaiting = null;
      params.onError?.(error instanceof Error ? error : new Error("校对失败"));
    }
  };

  pump();
  return () => {
    stopWaiting?.();
    stopWaiting = null;
  };
}
