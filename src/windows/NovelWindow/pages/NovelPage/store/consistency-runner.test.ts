import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createConsistencyScanner, type ConsistencyIssue } from "@/shared/novel/consistency";
import { startConsistencyScan } from "./consistency-runner";
import type { ConsistencyWorkerRequest } from "../workers/consistency.worker";

/**
 * 扫描执行器的行为契约（R-AI-10a 改为 Worker 后）
 *
 * 钉四件容易退化的事：
 * 1. 真的走 Worker（不是「建了线程但还在主线程算」）——按协议分批投递；
 * 2. 分批边界正确：投完最后一批要发 finish，不能少投也不能重复投；
 * 3. Worker 不可用 / 构造失败 / 半路崩溃三种情况都必须仍能出结果（功能不降级）；
 * 4. 取消要真的停（terminate + 不再回调），不能「取消了还在后台扫」。
 */

/** 章节构造：第 index 章，正文按模板拼 */
function chapterAt(index: number, content: string) {
  return { id: `c${index}`, title: `第${index + 1}章`, content };
}

/** 能造出「李元 → 李玄」这条真错字的最小章节集 */
function nearMissChapters(count: number) {
  const chapters = [chapterAt(0, "李玄开口。李玄点头。李玄走了。")];
  for (let i = 1; i < count; i += 1) {
    chapters.push(chapterAt(i, `第${i}段正文，无关内容。`));
  }
  chapters.push(chapterAt(count, "李元握刀。李元回头。"));
  return chapters;
}

const liXuan = [{ id: "e1", name: "李玄", type: "character" as const, aliases: [] }];

/**
 * 假 Worker：用真实扫描器实现协议，从而验证的是「主线程侧的编排」，
 * 而不是把扫描逻辑再写一遍。
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static beforeConstruct: (() => void) | null = null;

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: ConsistencyWorkerRequest[] = [];
  terminated = false;
  private scanner: ReturnType<typeof createConsistencyScanner> | null = null;

  constructor() {
    FakeWorker.beforeConstruct?.();
    FakeWorker.instances.push(this);
  }

  postMessage(message: ConsistencyWorkerRequest): void {
    this.posted.push(message);
    if (this.terminated) return;
    // 真实线程不会同步回包；用微任务保证顺序语义一致
    queueMicrotask(() => this.handle(message));
  }

  terminate(): void {
    this.terminated = true;
  }

  /** 模拟线程内部崩溃 */
  crash(): void {
    this.onerror?.({ message: "模拟线程崩溃" } as ErrorEvent);
  }

  private handle(message: ConsistencyWorkerRequest): void {
    if (this.terminated) return;
    if (message.type === "start") {
      this.scanner = createConsistencyScanner({
        entities: message.entities,
        realmLevels: message.realmLevels,
      });
      return;
    }
    if (message.type === "chapters") {
      for (const chapter of message.chapters) this.scanner?.scanChapter(chapter);
      this.onmessage?.({ data: { type: "progress", scanned: this.scanner?.scanned ?? 0 } } as MessageEvent);
      return;
    }
    const issues = this.scanner?.finalize() ?? [];
    this.onmessage?.({ data: { type: "done", issues } } as MessageEvent);
  }
}

interface Harness {
  done: Promise<ConsistencyIssue[]>;
  progress: number[];
  cancel: () => void;
}

function start(chapters: ReturnType<typeof nearMissChapters>): Harness {
  const progress: number[] = [];
  let resolveDone!: (issues: ConsistencyIssue[]) => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<ConsistencyIssue[]>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const handle = startConsistencyScan({
    chapters,
    entities: liXuan,
    realmLevels: [],
    onProgress: (scanned) => progress.push(scanned),
    onDone: resolveDone,
    onError: rejectDone,
  });
  return { done, progress, cancel: handle.cancel };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeWorker.instances = [];
  FakeWorker.beforeConstruct = null;
});

describe("startConsistencyScan · Worker 路径", () => {
  it("按协议分批投递：start → 每批 chapters → finish，一批不超过 50 章", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    // 120 章 ⇒ 50 + 50 + 20 三批
    const harness = start(nearMissChapters(120));
    const issues = await harness.done;

    const posted = FakeWorker.instances[0].posted;
    expect(posted[0].type).toBe("start");
    const chunks = posted.filter((item) => item.type === "chapters");
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      if (chunk.type !== "chapters") continue;
      expect(chunk.chapters.length).toBeLessThanOrEqual(50);
    }
    // 章数不能丢：三批合计必须等于全部待扫章
    const delivered = chunks.reduce(
      (sum, item) => sum + (item.type === "chapters" ? item.chapters.length : 0),
      0,
    );
    expect(delivered).toBe(121);
    expect(posted[posted.length - 1].type).toBe("finish");

    expect(issues.map((item) => item.found)).toContain("李元");
  });

  it("进度按已扫章数递增，末帧等于总章数", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const harness = start(nearMissChapters(120));
    await harness.done;

    expect(harness.progress).toEqual([...harness.progress].sort((a, b) => a - b));
    expect(harness.progress[harness.progress.length - 1]).toBe(121);
  });

  it("取消后 terminate 线程，且不再回调结果（不留后台扫描）", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    let doneCalled = false;
    const handle = startConsistencyScan({
      chapters: nearMissChapters(120),
      entities: liXuan,
      realmLevels: [],
      onProgress: () => {},
      onDone: () => {
        doneCalled = true;
      },
    });
    handle.cancel();

    const worker = FakeWorker.instances[0];
    expect(worker.terminated).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(doneCalled).toBe(false);
  });
});

describe("startConsistencyScan · 降级路径", () => {
  it("环境没有 Worker 时退回主线程分片，结果不打折", async () => {
    vi.stubGlobal("Worker", undefined);
    const harness = start(nearMissChapters(12));
    const issues = await harness.done;
    expect(issues.map((item) => item.found)).toContain("李元");
    expect(harness.progress[harness.progress.length - 1]).toBe(13);
  });

  it("Worker 构造抛错时退回主线程，界面不会卡在「正在扫描」", async () => {
    FakeWorker.beforeConstruct = () => {
      throw new Error("worker 脚本加载失败");
    };
    vi.stubGlobal("Worker", FakeWorker);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const harness = start(nearMissChapters(12));
    const issues = await harness.done;

    expect(issues.map((item) => item.found)).toContain("李元");
    expect(warn).toHaveBeenCalled();
  });

  it("线程中途崩溃也退回主线程从头扫完，而不是静默停在半本", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const harness = start(nearMissChapters(120));
    // 第一批投出去后线程崩掉
    FakeWorker.instances[0].crash();

    const issues = await harness.done;
    expect(issues.map((item) => item.found)).toContain("李元");
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });
});

describe("守卫", () => {
  it("store 不再自己跑扫描器（扫描引擎只能经 runner 落地）", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "src/windows/NovelWindow/pages/NovelPage/store/useConsistencyStore.ts",
      ),
      "utf8",
    );
    expect(source).toMatch(/from\s+["']\.\/consistency-runner["']/);
    // 一旦有人在 store 里重新 new 扫描器，扫描就回到主线程了
    expect(source).not.toMatch(/createConsistencyScanner/);
    expect(source).not.toMatch(/requestIdleCallback/);
  });
});
