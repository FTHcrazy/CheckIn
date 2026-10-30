/**
 * 全局设定中心 · 引用方名单（R12，窗口私有只读 hook）
 *
 * 读 `novel-global-setting-refs`（主进程 `listGlobalRefs`，与 `countGlobalRefs`
 * 同口径），返回「哪几本书在引用这个全局分类」，按书名升序。
 *
 * ⚠️ **不写回 `useGlobalSetting.ts`** —— 那是数据层，本次一个字不动；R12 只是
 * 一个只读视图数据源，抽屉的 `loading` / `error` / `retry()` 视图态由本 hook 自持。
 *
 * 三条失败路径全部要有**可见出口**，没有一条允许白屏或静默：
 * - preload 缺通道 ⇒ 空名单 + `error` 非空（可重试），**不抛**；
 * - IPC reject ⇒ `error` 记原因 + `console.error` 原始错误；
 * - 名单条数与 `refCount` 不一致 ⇒ 由抽屉按 `refCount` 显示计数 + 警示（不在此处自造口径）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GlobalCategoryRef } from "@/shared/types/electron";

export type { GlobalCategoryRef };

export interface GsRefsState {
  refs: GlobalCategoryRef[];
  loading: boolean;
  /** 失败原因（null = 正常）。非空即渲染 Alert + 重试，不白屏、不静默 */
  error: string | null;
  open: (categoryId: string) => void;
  close: () => void;
  retry: () => void;
}

/** preload 里没有该通道（渲染层与主进程版本错位）时的提示 */
const REFS_CHANNEL_MISSING_HINT =
  "当前运行环境不支持读取引用方名单（渲染层与主进程版本不一致）。请完全退出应用后重启。";

/** IPC 拒绝原因 → 一行可读文案（原始错误对象另外打到控制台，便于定位） */
function describeRefsError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "未知错误（详情见开发者工具控制台）";
}

export function useGlobalSettingRefs(): GsRefsState {
  const [refs, setRefs] = useState<GlobalCategoryRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 最后一次请求的分类 id：`retry()` 用它重跑 */
  const lastIdRef = useRef<string | null>(null);
  /** 卸载后丢弃迟到的异步结果，避免对已销毁窗口 setState */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback((categoryId: string): void => {
    lastIdRef.current = categoryId;
    setLoading(true);
    setError(null);
    setRefs([]);

    const api = window.electronAPI?.novel;
    // ⚠️ 必须显式判空：preload 版本错位时这个方法是 undefined，直接调用是
    // **同步 TypeError**，而它由 open()（UI 回调）触发 —— 抛出会让 React 卸载
    // 整棵树，用户看到的是一片白屏。这里落到「可重试的空态」。
    if (!api || typeof api.globalCategoryRefs !== "function") {
      if (!aliveRef.current) return;
      setLoading(false);
      setError(REFS_CHANNEL_MISSING_HINT);
      return;
    }

    void api
      .globalCategoryRefs(categoryId)
      .then((result) => {
        if (!aliveRef.current) return;
        setRefs(Array.isArray(result) ? result : []);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!aliveRef.current) return;
        console.error("[GlobalSettingWindow] 引用方名单读取失败", reason);
        setRefs([]);
        setError(describeRefsError(reason));
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, []);

  const open = useCallback(
    (categoryId: string): void => {
      load(categoryId);
    },
    [load],
  );

  const retry = useCallback((): void => {
    const last = lastIdRef.current;
    if (!last) return;
    load(last);
  }, [load]);

  const close = useCallback((): void => {
    lastIdRef.current = null;
    setRefs([]);
    setError(null);
    setLoading(false);
  }, []);

  return { refs, loading, error, open, close, retry };
}
