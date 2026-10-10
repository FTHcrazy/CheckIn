/**
 * 书籍导入服务（书架侧）
 *
 * 编排三段：① 主进程弹框选文件并读回字节 → ② worker 内解码 + 拆章 →
 * ③ 主进程单事务落库（作品 + 卷 + 章）。
 *
 * 解析放在 worker（见 import.worker.ts），主界面不阻塞。
 * 与其它书架服务一致：本文件不含 React，只做 IPC / worker 编排。
 */

import type { NovelBundleDTO } from "@/shared/types/electron";
import { createShelfId } from "./bookshelf-service";
import type { ImportParseResult } from "../import/import.worker";

/** 导入进度回调：phase 文案 + 0~1 比例 */
export type ImportProgressHandler = (phase: string, ratio: number) => void;

/** 主进程返回的待解析文件 */
interface PickedFile {
  fileName: string;
  /** 文件字节（UTF-8 安全的 ArrayBuffer） */
  bytes: ArrayBuffer;
  size: number;
}

/** 落库返回的摘要 */
export interface ImportCommitResult {
  workId: string;
  volumeCount: number;
  chapterCount: number;
  wordCount: number;
}

/**
 * ① 弹出文件选择框并读回字节；用户取消返回 null。
 */
export async function pickImportFile(): Promise<PickedFile | null> {
  const result = await window.electronAPI!.novel.importPickFile();
  return result ?? null;
}

/**
 * ② 在 worker 中完成解码与拆章。
 *
 * 每次导入新建一个 worker，完成后立即 terminate——导入是低频操作，
 * 常驻一个 worker 只会白白占内存。若环境不支持 Worker（极老内核），
 * 降级到主线程同步解析，保证功能可用。
 */
export function parseInWorker(
  bytes: ArrayBuffer,
  fileName: string,
  onProgress?: ImportProgressHandler,
): Promise<ImportParseResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../import/import.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      // 降级：无 Worker 支持时同步解析（会阻塞，但至少能用）
      void parseOnMainThread(bytes).then(resolve, reject);
      return;
    }

    const cleanup = () => worker.terminate();

    worker.onmessage = (
      event: MessageEvent<
        | { type: "progress"; phase: string; ratio: number }
        | { type: "done"; result: ImportParseResult }
        | { type: "error"; message: string }
      >,
    ) => {
      const data = event.data;
      if (data.type === "progress") {
        onProgress?.(data.phase, data.ratio);
        return;
      }
      if (data.type === "done") {
        cleanup();
        resolve(data.result);
        return;
      }
      cleanup();
      reject(new Error(data.message || "解析失败"));
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "解析线程异常"));
    };

    // ArrayBuffer 走 transfer，避免大文件结构化克隆的整份拷贝
    worker.postMessage({ type: "parse", bytes, fileName }, [bytes]);
  });
}

/** 无 Worker 时的主线程降级解析 */
async function parseOnMainThread(bytes: ArrayBuffer): Promise<ImportParseResult> {
  const { detectEncoding } = await import("../import/import.worker");
  const { parseTxtBook, countWords } = await import("../import/novel-import-parser");
  const view = new Uint8Array(bytes);
  const { text, encoding } = detectEncoding(view);
  const book = parseTxtBook(text);
  const chapters = book.chapters.map((chapter) => ({
    title: chapter.title,
    content: chapter.content,
    volumeIndex: chapter.volumeIndex,
    wordCount: countWords(chapter.content),
  }));
  return {
    encoding,
    structured: book.structured,
    volumes: book.volumes,
    chapters,
    totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
  };
}

/**
 * ③ 把解析结果落库：一次 IPC 走主进程单事务。
 *
 * id 在渲染层生成（与新建作品 / 章节的既有约定一致，主进程只负责写入）。
 */
export async function commitImport(
  parsed: ImportParseResult,
  bookName: string,
): Promise<ImportCommitResult> {
  const workId = createShelfId("w");
  const now = Date.now();

  // 卷列表兜底：解析结果理论上至少有一条默认卷，但空数组会让下面
  // chapters 的 volumeId 全部悬空，这里显式保底造一卷。
  const sourceVolumes = parsed.volumes.length > 0 ? parsed.volumes : [{ name: "正文" }];
  const volumes = sourceVolumes.map((volume, index) => ({
    id: createShelfId("v"),
    name: volume.name || `第${index + 1}卷`,
    sort: index + 1,
  }));

  const chapters = parsed.chapters.map((chapter, index) => {
    const volumeIndex = Math.min(Math.max(chapter.volumeIndex, 0), volumes.length - 1);
    return {
      id: createShelfId("c"),
      volumeId: volumes[volumeIndex].id,
      title: chapter.title || `第${index + 1}章`,
      content: chapter.content,
      wordCount: chapter.wordCount,
      sort: index + 1,
    };
  });

  await window.electronAPI!.novel.importBook({
    work: { id: workId, name: bookName, createdAt: now },
    volumes,
    chapters,
  });

  return {
    workId,
    volumeCount: volumes.length,
    chapterCount: chapters.length,
    wordCount: parsed.totalWords,
  };
}

/** 复用类型导出，避免页面层重复声明 */
export type { ImportParseResult };
export type { NovelBundleDTO };
