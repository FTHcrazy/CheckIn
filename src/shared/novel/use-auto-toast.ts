/**
 * 轻提示（toast）自动消失的收口 hook（P3-3）。
 *
 * NovelPage（useNovelViewState）与行囊面板（usePackPanel）各有一份
 * 「setState → setTimeout 清 null → 卸载/更新时 clearTimeout」样板，时长与
 * tone 集合还悄悄漂移过（2.4s vs 2.6s；error 只有面板有）。收成一处后：
 * 计时清理规则只有一个权威实现 —— 卸载与每条新 toast 都先 clearTimeout，
 * 绝不在卸载后 setState。
 *
 * 展示组件（NovelToast / PackToast）与 `--app-*` 主题无关，纯页面级浮动层，
 * 状态形状保持 `{ id, text, tone }`：id 用 Date.now() 让「重复同文案」也能
 * 重置计时器（dep 是整个 toast 对象）。
 */
import { useCallback, useEffect, useState } from "react";

/** 语气集合取两处使用方的并集（error 只有面板在用，编辑器保留扩展余地） */
export type ToastTone = "success" | "info" | "warning" | "error";

export interface ToastPayload {
  /** 毫秒时间戳：既是 key 也是「同文案重复弹出时重置计时器」的依据 */
  id: number;
  text: string;
  tone: ToastTone;
}

/** 自动消失的轻提示。`durationMs` 由调用方给（各自沿用既有节奏，不在此拍板） */
export function useAutoToast(durationMs: number): {
  toast: ToastPayload | null;
  showToast: (text: string, tone?: ToastTone) => void;
  closeToast: () => void;
} {
  const [toast, setToast] = useState<ToastPayload | null>(null);

  const showToast = useCallback((text: string, tone: ToastTone = "success") => {
    setToast({ id: Date.now(), text, tone });
  }, []);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [toast, durationMs]);

  return { toast, showToast, closeToast };
}
