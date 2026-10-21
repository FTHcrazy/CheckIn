/**
 * 导出编排 hook（R27 / S5，RG-X 系列）
 *
 * 把「点导出 → 抑制覆盖物 → 等一帧 → 取景 → 弹框落盘」串成一条：
 *
 * 1. `exportPng()` 先给画布根节点挂 `is-exporting`（纯 CSS 抑制，见
 *    `utils/export-png.ts` 的 `EXPORT_HIDE_SELECTORS`），**等两帧**再截 ——
 *    一帧给 React 提交类名，一帧给合成器重绘，否则截出来仍带着工具栏。
 * 2. 取景矩形由 `resolveCaptureRect()` 从根节点 `getBoundingClientRect()` 现算，
 *    DPR 也现读（用户把窗口拖到另一块屏时两者都会变，不能缓存）。
 * 3. 拿到字节后立即 `finally` 摘掉类名，再交给 `exportBinary()` 弹框落盘。
 *
 * 为什么是「两帧」而不是「一次 setTimeout」：`requestAnimationFrame` 回调
 * 触发时浏览器已完成本次绘制排程，但类名是 React 在下一次 commit 才落到
 * DOM 上的，所以第一帧只是「让 React 提交」，第二帧才是「提交后的那一次
 * 重绘」。用 setTimeout(0) 也会被合成器合并进同一帧，反而可能截到旧画面。
 *
 * 失败 / 取消 / 异常三条路径都**保证摘掉类名**（`finally`），否则下一次
 * 导出会从一张没有工具栏的图上再截一层。
 */
import { useCallback, useRef, useState } from "react";
import { captureGraphPng, exportBinary } from "../services/export-graph-png";
import {
  EXPORT_CLASS,
  exportFileName,
  isRectUsable,
  resolveCaptureRect,
} from "../utils/export-png";

export type ExportOutcome = "ok" | "cancelled" | "failed";

export interface UseExportPngOptions {
  /** 根节点（画布容器）的引用；导出矩形以它为准 */
  rootRef: React.RefObject<HTMLElement | null>;
  /** 书名，拼进默认文件名（`<书名> 人物关系图.png`） */
  workName: string;
}

export interface UseExportPngResult {
  /** 导出是否正在进行（用来禁用按钮 / 防连点） */
  exporting: boolean;
  /**
   * 执行导出。返回 `ok`（已落盘）/ `cancelled`（保存框取消）/ `failed`
   * （取景或写盘失败，message 里带可读原因）。
   */
  exportPng: () => Promise<ExportOutcome>;
}

/** 取景失败后给用户的一句话（不暴露 IPC 细节） */
const EXPORT_FAILED = "导出失败，请把窗口置于前台后重试";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function useExportPng({ rootRef, workName }: UseExportPngOptions): UseExportPngResult {
  const [exporting, setExporting] = useState(false);
  // 防连点：state 更新是异步的，同帧点两次会用同一个 exporting=false 判断
  const busyRef = useRef(false);

  const exportPng = useCallback(async (): Promise<ExportOutcome> => {
    if (busyRef.current) return "failed";
    busyRef.current = true;
    setExporting(true);

    const root = rootRef.current;
    try {
      if (!root) return "failed";

      // 先抑制覆盖物，再等两帧让类名生效并重绘
      root.classList.add(EXPORT_CLASS);
      await nextFrame();
      await nextFrame();

      const rect = resolveCaptureRect(root.getBoundingClientRect());
      if (!isRectUsable(rect)) return "failed";

      const result = await captureGraphPng(rect);
      if (!result.ok) return "failed";

      const saved = await exportBinary(exportFileName(workName), result.png);
      return saved ? "ok" : "cancelled";
    } finally {
      const rootNode = rootRef.current;
      rootNode?.classList.remove(EXPORT_CLASS);
      busyRef.current = false;
      setExporting(false);
    }
  }, [rootRef, workName]);

  return { exporting, exportPng };
}

/** 供测试断言 / 上层反馈用的固定文案，避免文案漂移 */
export const EXPORT_FAILED_MESSAGE = EXPORT_FAILED;
