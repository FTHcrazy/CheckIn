/**
 * 一致性校对 Worker（R-AI-10a）
 *
 * 为什么单独开线程：一致性校对要跑「精确索引 + 删一字近似」两趟，且是**全书**规模
 * （几千章、几十万字）。原先放在主线程按 8 章一批用 `requestIdleCallback` 让出，
 * 让出只是把卡顿摊薄成几百次小卡顿——扫描期间作者敲字仍会掉帧，而校对本身
 * 没有任何必须留在主线程的理由（纯函数、不碰 DOM、不碰 IPC）。
 *
 * 通信协议（见 ../store/consistency-runner.ts）：
 *   → { type: "start", entities, realmLevels }   建索引（一次）
 *   → { type: "chapters", chapters }             投递一批章；每批回一次 progress
 *   → { type: "finish" }                         收尾出结果
 *   ← { type: "progress", scanned }              已扫章数（驱动进度条与下一批）
 *   ← { type: "done", issues }                   全书结果
 *   ← { type: "error", message }                 线程内异常
 *
 * 分批而不是一次投全书：结构化克隆会整份复制字符串。一次投几十 MB 的正文
 * 等于让渲染进程瞬间多背一份内存，分批则峰值只有一批。
 */
import {
  createConsistencyScanner,
  type ConsistencyChapterInput,
  type ConsistencyEntityInput,
  type ConsistencyIssue,
  type ConsistencyLevelInput,
  type ConsistencyScanner,
} from "@/shared/novel/consistency";

/** 主线程 → worker */
export type ConsistencyWorkerRequest =
  | {
      type: "start";
      entities: ConsistencyEntityInput[];
      realmLevels: ConsistencyLevelInput[];
    }
  | { type: "chapters"; chapters: ConsistencyChapterInput[] }
  | { type: "finish" };

/** worker → 主线程 */
export type ConsistencyWorkerResponse =
  | { type: "progress"; scanned: number }
  | { type: "done"; issues: ConsistencyIssue[] }
  | { type: "error"; message: string };

/** 本次扫描的累加器；每次 `start` 重建，避免上一本的残渣混进这一本 */
let scanner: ConsistencyScanner | null = null;

function reply(message: ConsistencyWorkerResponse): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<ConsistencyWorkerRequest>) => {
  const data = event.data;
  try {
    if (data.type === "start") {
      scanner = createConsistencyScanner({
        entities: data.entities,
        realmLevels: data.realmLevels,
      });
      return;
    }

    if (data.type === "chapters") {
      // 协议保证 start 先到；缺失时直接忽略，让主线程按「无进展」超时兜底，
      // 而不是在这里抛错（抛错只会把一条协议 bug 掩盖成「线程异常」）。
      if (!scanner) return;
      for (const chapter of data.chapters) scanner.scanChapter(chapter);
      reply({ type: "progress", scanned: scanner.scanned });
      return;
    }

    if (!scanner) return;
    const issues = scanner.finalize();
    scanner = null;
    reply({ type: "done", issues });
  } catch (error) {
    scanner = null;
    reply({
      type: "error",
      message: error instanceof Error ? error.message : "校对线程异常",
    });
  }
};
