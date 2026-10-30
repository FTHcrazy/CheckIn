import { useCallback, useRef, useState } from "react";
import { App } from "antd";
import {
  commitImport,
  parseInWorker,
  pickImportFile,
} from "../services/import-service";

/**
 * 书籍导入流程 Hook（书架侧）
 *
 * 三段式：选文件 → worker 解析 → 单事务落库。全程不上锁界面，
 * 只维护一个 `importing` 态给入口按钮做 loading，解析进度写进 `progress`。
 *
 * 完成/失败都用 antd message 轻提示（不切走用户当前操作），
 * 落库成功后回调 `onDone` 让书架静默刷新出新书。
 */

/** 进度阶段 → 中文文案 */
const PHASE_TEXT: Record<string, string> = {
  decode: "正在识别编码…",
  parse: "正在拆分章节…",
  finalize: "正在整理目录…",
};

/** 导入态 */
export interface ImportState {
  importing: boolean;
  /** 0~1；-1 表示尚未开始 */
  ratio: number;
  /** 当前阶段文案 */
  phase: string;
}

export interface UseBookImportOptions {
  /** 落库成功后回调（书架据此刷新） */
  onDone?: () => void;
}

export function useBookImport({ onDone }: UseBookImportOptions = {}) {
  const { message } = App.useApp();
  const [state, setState] = useState<ImportState>({
    importing: false,
    ratio: -1,
    phase: "",
  });
  /** 防重入：导入期间忽略再次点击（异步链路上的并发保护） */
  const runningRef = useRef(false);

  const startImport = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      const picked = await pickImportFile();
      if (!picked) return; // 用户取消

      setState({ importing: true, ratio: 0, phase: PHASE_TEXT.decode });

      const parsed = await parseInWorker(picked.bytes, picked.fileName, (phase, ratio) => {
        setState({ importing: true, ratio, phase: PHASE_TEXT[phase] ?? "正在处理…" });
      });

      setState({ importing: true, ratio: 0.95, phase: "正在写入书架…" });

      // 书名取文件名（去扩展名），与参考实现的 bookTitle 口径一致
      const bookName = picked.fileName.replace(/\.(txt|docx)$/i, "").trim() || "未命名书籍";
      const result = await commitImport(parsed, bookName);
      if (!result) throw new Error("写入失败");

      onDone?.();

      const tip =
        parsed.chapters.length > 0
          ? `《${bookName}》导入完成 · ${result.volumeCount} 卷 ${result.chapterCount} 章 · ${result.wordCount.toLocaleString()} 字`
          : `《${bookName}》导入完成`;
      message.success(tip);

      if (!parsed.structured) {
        message.info("未识别到章节结构，已按单章导入，可稍后手动拆分");
      }
    } catch (error) {
      message.error(
        `导入失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      runningRef.current = false;
      setState({ importing: false, ratio: -1, phase: "" });
    }
  }, [message, onDone]);

  return { ...state, startImport };
}
